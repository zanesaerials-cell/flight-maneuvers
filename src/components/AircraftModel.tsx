import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { AircraftProfile } from '../data/aircraft';
import { MODEL_RIGS, type ModelRig } from '../data/modelRigs';
import type { Frame } from '../engine/types';
import { D2R } from '../engine/kinematics';
import { setModelLoading } from '../store/loading';
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
    if (!url) { setModelLoading(false); return; }
    setModelLoading(true);
    loadModel(url)
      .then((s) => { if (live) setScene(s); })
      .catch(() => { /* stand-in stays */ })
      .finally(() => { if (live) setModelLoading(false); });
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


function Loaded({ scene, rig, getFrame }: { scene: THREE.Group; rig: ModelRig; getFrame: () => Frame }) {
  const gl = useThree((st) => st.gl);
  useEffect(() => { gl.localClippingEnabled = true; }, [gl]);
  const discs = useRef<(THREE.Mesh | null)[]>([]);
  const blur = useRef<(THREE.Mesh | null)[]>([]);
  const spool = useRef({ t: -99, run: [] as number[], lv: [] as number[] });
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
    // Folding gear: each part (or door built here) hangs from a pivot group that turns
    // about its hinge axis during its own slice of the retraction sequence.
    // Clipping planes are kept in model space and copied to world space every frame.
    const clipTo = (o: THREE.Object3D, local: THREE.Plane[]) => {
      const world = local.map((p) => p.clone());
      o.traverse((m) => {
        const mesh = m as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((mt) => { const c = mt.clone(); c.clippingPlanes = world; return c; });
        mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
      });
      return { local, world };
    };
    for (const n of rig.hide ?? []) { const o = root.getObjectByName(n); if (o) o.visible = false; }
    const doorMat = new THREE.MeshStandardMaterial({ color: '#f3f3f1', roughness: 0.6, metalness: 0 });
    const movers = (rig.retraction ?? []).flatMap((mv) => {
      let part: THREE.Object3D | undefined;
      if (mv.panel) {
        // Built where it sits with its pivot at 0°; the pivot then turns it each frame.
        const { at, size } = mv.panel;
        part = new THREE.Mesh(new THREE.BoxGeometry(...size), doorMat);
        part.position.set(...at);
        root.add(part);
      } else part = root.getObjectByName(mv.part ?? '') ?? undefined;
      if (!part) return [];
      const pivot = new THREE.Group();
      pivot.position.set(...mv.pivot);
      root.add(pivot);
      root.updateMatrixWorld(true);
      pivot.attach(part);             // keeps the part exactly where it was
      const planes: THREE.Plane[] = [];
      // Doors that overlap when shut are each trimmed at the centreline.
      if (mv.keep) planes.push(new THREE.Plane(new THREE.Vector3(mv.keep === 'left' ? -1 : 1, 0, 0), 0));
      if (mv.below !== undefined) planes.push(new THREE.Plane(new THREE.Vector3(0, -1, 0), mv.below));
      return [{ mv, pivot, clip: planes.length ? clipTo(part, planes) : undefined }];
    });
    // Without a folding sequence, gear legs simply slide up and are clipped where they meet the airframe.
    const gear = rig.retraction ? [] : (rig.gear ?? []).map((n) => root.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o)
      .map((o) => {
        const box = new THREE.Box3().setFromObject(o);
        const local = new THREE.Plane(new THREE.Vector3(0, -1, 0), box.max.y - 0.02);
        const world = local.clone();
        o.traverse((m) => {
          const mesh = m as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((mt) => {
            const c = mt.clone(); c.clippingPlanes = [world]; c.clipShadows = true; return c;
          });
          mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
        });
        return { o, y0: o.position.y, travel: box.max.y - box.min.y, local, world };
      });
    // Glass reads better slightly tinted and see-through from outside.
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && /glass/i.test(m.name)) { m.transparent = true; m.opacity = Math.min(m.opacity, 0.55); m.depthWrite = false; }
    });
    return { root, pivots, spinners, gear, movers };
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
    // On a twin the first propeller is the left engine; it winds down to a stop (feathered) when that engine has failed.
    const stopped = (i: number) => twin && i === 0 && !!f.oei;
    if (built.pivots.prop) built.pivots.prop.rotation.z += dt * (6 + 30 * Math.max(f.c.throttle, 0.15));
    // Spin rates ease toward their targets so a propeller spools and winds down instead of
    // switching speed in one frame. Scrubbing the timeline far jumps straight to the target.
    const k = 1 - Math.exp(-Math.min(dt, 0.1) / 0.6);
    const jump = Math.abs(f.t - spool.current.t) > 1;
    spool.current.t = f.t;
    built.spinners.forEach((sp, i) => {
      const target = stopped(i) ? 0 : 1;
      const run = spool.current.run[i] = jump || spool.current.run[i] === undefined ? target : spool.current.run[i] + (target - spool.current.run[i]) * k * 0.5;
      const lv = spool.current.lv[i] = jump || spool.current.lv[i] === undefined ? lever(i) : spool.current.lv[i] + (lever(i) - spool.current.lv[i]) * k;
      // Spun slowly enough that the blades stay visible; the disc adds the blur at power.
      const rate = (5 + 14 * Math.max(lv, 0.12)) * run;
      if (run < 0.02 && stopped(i)) {
        // Feathered: settle the blades on the nearest blade position.
        const step = (Math.PI * 2) / 3;
        sp.rotation.z += (Math.round(sp.rotation.z / step) * step - sp.rotation.z) * k;
      } else sp.rotation.z += dt * rate * (i === 0 ? 1 : -1);
      const d = blur.current[i];
      if (d) {
        const m = d.material as THREE.MeshBasicMaterial;
        m.opacity = (0.04 + 0.12 * lv) * run * run;
        d.visible = m.opacity > 0.005;
      }
    });
    discs.current.forEach((d, i) => {
      if (!d) return;
      (d.material as THREE.MeshBasicMaterial).opacity = 0.1 + 0.16 * lever(i);
    });
    // Gear: u = 0 down, 1 up with doors shut. Each part eases through its own slice.
    const g = THREE.MathUtils.clamp(f.c.gear, 0, 1);
    const u = 1 - g;
    built.root.updateMatrixWorld();
    built.movers.forEach(({ mv, pivot, clip }) => {
      const k = THREE.MathUtils.smoothstep(u, mv.span[0], mv.span[1]);
      const a = THREE.MathUtils.degToRad(mv.from + (mv.to - mv.from) * k);
      if (mv.axis === 'x') pivot.rotation.x = a; else pivot.rotation.z = a;
      if (clip) clip.local.forEach((p, i) => clip.world[i].copy(p).applyMatrix4(built.root.matrixWorld));
    });
    const ease = g * g * (3 - 2 * g);
    built.gear.forEach(({ o, y0, travel, local, world }) => {
      o.position.y = y0 + (1 - ease) * travel;
      o.visible = g > 0.002;
      world.copy(local).applyMatrix4(built.root.matrixWorld);
    });
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
