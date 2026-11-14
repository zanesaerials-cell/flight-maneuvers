import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { AircraftProfile } from '../data/aircraft';
import { MODEL_RIGS, type ModelRig } from '../data/modelRigs';
import type { Frame } from '../engine/types';
import { D2R } from '../engine/kinematics';
import { Cessna172, WHEEL_CONTACTS as PROCEDURAL_CONTACTS } from './Cessna172';

export const rigFor = (ac: AircraftProfile): ModelRig => MODEL_RIGS[ac.id] ?? MODEL_RIGS.c172s;
/** Tire contact points of the model on screen; the scene keeps these on the runway. */
export const wheelContactsFor = (ac: AircraftProfile) => rigFor(ac).wheelContacts.map((p) => new THREE.Vector3(...p));

/**
 * The airplane's 3D model. Models with separate control-surface parts are
 * rigged to their hinge lines; single-mesh models are shown as they are with
 * spinning propeller discs. While a model loads, or if its file is not
 * present, a built-in stand-in is shown.
 */
export function AircraftModel({ ac, getFrame }: { ac: AircraftProfile; getFrame: () => Frame }) {
  const rig = rigFor(ac);
  const url = ac.model?.url;
  const [scene, setScene] = useState<THREE.Group | null>(null);
  useEffect(() => {
    let live = true;
    setScene(null);
    if (!url) return;
    loadModel(url).then((s) => { if (live) setScene(s); }).catch(() => { /* stand-in stays */ });
    return () => { live = false; };
  }, [url]);
  if (scene) return <Loaded scene={scene} rig={rig} getFrame={getFrame} />;
  // Raise the stand-in so its tires sit where the detailed model's do.
  const lift = PROCEDURAL_CONTACTS[0].y - rig.wheelContacts[0][1];
  return <group position={[0, -lift, 0]}><Cessna172 getFrame={getFrame} lowWing={rig.fallback === 'low-wing'} twin={ac.engines === 2} /></group>;
}

const pending = new Map<string, Promise<THREE.Group>>();
/**
 * Loads a GLB once. A page can embed files as base64 in
 * window.__MODELS_B64[url] (used where .glb files can't be served);
 * otherwise the file is fetched from public/.
 */
function loadModel(url: string) {
  let p = pending.get(url);
  if (!p) {
    p = (async () => {
      const embedded = (window as unknown as { __MODELS_B64?: Record<string, string> }).__MODELS_B64?.[url];
      let buf: ArrayBuffer;
      if (embedded) {
        const bin = atob(embedded);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        buf = bytes.buffer;
      } else {
        const res = await fetch(url);
        const type = res.headers.get('content-type') ?? '';
        if (!res.ok || type.includes('text/html')) throw new Error(`Model not available: ${url}`);
        buf = await res.arrayBuffer();
      }
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      return (await loader.parseAsync(buf, '')).scene;
    })();
    pending.set(url, p);
  }
  return p;
}

const GEAR_TRAVEL = 0.55;   // metres a retracting gear leg slides up before it disappears

function Loaded({ scene, rig, getFrame }: { scene: THREE.Group; rig: ModelRig; getFrame: () => Frame }) {
  const discs = useRef<(THREE.Mesh | null)[]>([]);
  const blur = useRef<(THREE.Mesh | null)[]>([]);
  const built = useMemo(() => {
    const root = scene.clone(true);
    root.updateMatrixWorld(true);
    const pivots: Record<string, THREE.Group> = {};
    for (const [name, [a, b]] of Object.entries(rig.hinges ?? {})) {
      const part = root.getObjectByName(name);
      if (!part) continue;
      const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
      // The rudder hinge runs up the fin (+Y); all others run spanwise (+X).
      const local = name === 'rudder' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      const outer = new THREE.Group();
      outer.position.copy(A);
      outer.quaternion.setFromUnitVectors(local, B.clone().sub(A).normalize());
      const inner = new THREE.Group();
      outer.add(inner);
      root.add(outer);
      root.updateMatrixWorld(true);
      inner.attach(part);           // keeps the part exactly where it was
      pivots[name] = inner;
    }
    const prop = rig.propHub && root.getObjectByName('prop');
    if (prop && rig.propHub) {
      const hub = new THREE.Group();
      hub.position.set(...rig.propHub);
      const spin = new THREE.Group();
      hub.add(spin);
      root.add(hub);
      root.updateMatrixWorld(true);
      spin.attach(prop);
      pivots.prop = spin;
    }
    // Separate propellers: re-parent each onto a hub that spins about the fore-aft axis.
    const spinners: THREE.Group[] = [];
    for (const pr of rig.props ?? []) {
      const part = root.getObjectByName(pr.name);
      const hub = new THREE.Group();
      hub.position.set(...pr.at);
      const spin = new THREE.Group();
      hub.add(spin);
      root.add(hub);
      root.updateMatrixWorld(true);
      if (part) spin.attach(part);
      spinners.push(spin);
    }
    // Keep each part's own offset: the compressed file stores one on the node.
    const gear = (rig.gear ?? []).map((n) => root.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o)
      .map((o) => ({ o, y0: o.position.y }));
    // Glass reads better slightly tinted and see-through from outside.
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && /glass/i.test(m.name)) { m.transparent = true; m.opacity = Math.min(m.opacity, 0.55); m.depthWrite = false; }
    });
    return { root, pivots, spinners, gear };
  }, [scene, rig]);

  useFrame((_, dt) => {
    const f = getFrame();
    const twin = (rig.props?.length ?? 0) > 1;
    // Positive rotation about a +X hinge moves the trailing edge down.
    const ail = f.c.aileron * 0.3;
    const flap = f.c.flaps * D2R;
    const el = -f.c.elevator * 0.4;                   // pull: trailing edge up
    for (const [name, piv] of Object.entries(built.pivots)) {
      if (name.startsWith('aileronR')) piv.rotation.x = -ail;      // right stick: right aileron up
      else if (name.startsWith('aileronL')) piv.rotation.x = ail;  //              left aileron down
      else if (name.startsWith('flap')) piv.rotation.x = flap;
      else if (name.startsWith('elevator')) piv.rotation.x = el;
      else if (name.startsWith('rudder')) piv.rotation.y = f.c.rudder * 0.38;   // right pedal: rudder to the right
    }
    const lever = (i: number) => (twin && i === 1 ? f.c.throttleR : f.c.throttle);
    // On a twin the first propeller is the left engine; it stops (feathered) when that engine has failed.
    const stopped = (i: number) => twin && i === 0 && !!f.oei;
    if (built.pivots.prop) built.pivots.prop.rotation.z += dt * (6 + 30 * Math.max(f.c.throttle, 0.15));
    built.spinners.forEach((sp, i) => {
      if (stopped(i)) return;
      // Spun slowly enough that the blades stay visible; the disc adds the blur at power.
      sp.rotation.z += dt * (5 + 14 * Math.max(lever(i), 0.12)) * (i === 0 ? 1 : -1);
    });
    blur.current.forEach((d, i) => {
      if (!d) return;
      d.visible = !stopped(i);
      (d.material as THREE.MeshBasicMaterial).opacity = 0.04 + 0.12 * lever(i);
    });
    discs.current.forEach((d, i) => {
      if (!d) return;
      d.visible = !stopped(i);
      (d.material as THREE.MeshBasicMaterial).opacity = 0.1 + 0.16 * lever(i);
    });
    // Retractable gear slides up into the nacelles and nose, then disappears.
    const g = THREE.MathUtils.clamp(f.c.gear, 0, 1);
    built.gear.forEach(({ o, y0 }) => { o.position.y = y0 + (1 - g) * GEAR_TRAVEL; o.visible = g > 0.03; });
  });

  return (
    <group>
      <primitive object={built.root} />
      {rig.props?.map((d, i) => (
        <mesh key={d.name} ref={(m) => { blur.current[i] = m; }} position={[d.at[0], d.at[1], d.at[2] - 0.02]}>
          <circleGeometry args={[d.radius, 48]} />
          <meshBasicMaterial color="#cfd5db" transparent opacity={0.1} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      ))}
      {rig.propDiscs?.map((d, i) => (
        <mesh key={i} ref={(m) => { discs.current[i] = m; }} position={d.at}>
          <circleGeometry args={[d.radius, 40]} />
          <meshBasicMaterial color="#d8dde2" transparent opacity={0.2} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}
