import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { Frame } from '../engine/types';
import { D2R } from '../engine/kinematics';
import { C172S_HINGES, C172S_MODEL_URL, C172S_PROP_HUB, C172S_WHEEL_CONTACTS } from '../data/c172sRig';
import { Cessna172, WHEEL_CONTACTS as PROCEDURAL_CONTACTS } from './Cessna172';

/** Tire contact points of the model on screen; the scene keeps these on the runway. */
export const WHEEL_CONTACTS = C172S_WHEEL_CONTACTS.map((p) => new THREE.Vector3(...p));

/**
 * The detailed 172 model (CC BY 4.0, KOG_THORNS — see public/models/LICENSE-c172s.txt),
 * with every control surface re-parented onto a pivot on its hinge line.
 * While it loads, or if it can't be loaded, the procedural model stands in.
 */
export function C172Model({ getFrame }: { getFrame: () => Frame }) {
  const [scene, setScene] = useState<THREE.Group | null>(null);
  useEffect(() => {
    let live = true;
    loadModel().then((s) => { if (live) setScene(s); }).catch((e) => console.warn('C172S model unavailable, using the built-in model.', e));
    return () => { live = false; };
  }, []);
  if (scene) return <Rigged scene={scene} getFrame={getFrame} />;
  // Raise the stand-in so its tires sit where the detailed model's do.
  const lift = PROCEDURAL_CONTACTS[0].y - WHEEL_CONTACTS[0].y;
  return <group position={[0, -lift, 0]}><Cessna172 getFrame={getFrame} /></group>;
}

let pending: Promise<THREE.Group> | null = null;
/**
 * Loads the GLB once. A page can embed the file as base64 in
 * window.__C172S_GLB_B64 (used where .glb files can't be served);
 * otherwise it is fetched from public/models.
 */
function loadModel() {
  pending ??= (async () => {
    const embedded = (window as unknown as { __C172S_GLB_B64?: string }).__C172S_GLB_B64;
    let buf: ArrayBuffer;
    if (embedded) {
      const bin = atob(embedded);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      buf = bytes.buffer;
    } else {
      const res = await fetch(C172S_MODEL_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      buf = await res.arrayBuffer();
    }
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.parseAsync(buf, '');
    return gltf.scene;
  })();
  return pending;
}

function Rigged({ scene, getFrame }: { scene: THREE.Group; getFrame: () => Frame }) {
  const rig = useMemo(() => {
    const root = scene.clone(true);
    root.updateMatrixWorld(true);
    const pivots: Record<string, THREE.Group> = {};

    for (const [name, [a, b]] of Object.entries(C172S_HINGES)) {
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

    const prop = root.getObjectByName('prop');
    if (prop) {
      const hub = new THREE.Group();
      hub.position.set(...C172S_PROP_HUB);
      const spin = new THREE.Group();
      hub.add(spin);
      root.add(hub);
      root.updateMatrixWorld(true);
      spin.attach(prop);
      pivots.prop = spin;
    }

    // Glass reads better slightly tinted and see-through from outside.
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && /glass/i.test(m.name)) { m.transparent = true; m.opacity = Math.min(m.opacity, 0.55); m.depthWrite = false; }
    });
    return { root, pivots };
  }, [scene]);

  useFrame((_, dt) => {
    const f = getFrame();
    const p = rig.pivots;
    // Positive rotation about a +X hinge moves the trailing edge down.
    const ail = f.c.aileron * 0.3;
    if (p.aileronR) p.aileronR.rotation.x = -ail;     // right yoke: right aileron up
    if (p.aileronL) p.aileronL.rotation.x = ail;      //             left aileron down
    const flap = f.c.flaps * D2R;
    if (p.flapR) p.flapR.rotation.x = flap;
    if (p.flapL) p.flapL.rotation.x = flap;
    const el = -f.c.elevator * 0.4;                   // pull: trailing edge up
    if (p.elevatorR) p.elevatorR.rotation.x = el;
    if (p.elevatorL) p.elevatorL.rotation.x = el;
    if (p.rudder) p.rudder.rotation.y = f.c.rudder * 0.38;   // right pedal: rudder to the right
    const spin = THREE.MathUtils.clamp((f.rpm - 600) / 1800, 0, 1);
    if (p.prop) p.prop.rotation.z += dt * (6 + 30 * spin);
  });

  return <primitive object={rig.root} />;
}
