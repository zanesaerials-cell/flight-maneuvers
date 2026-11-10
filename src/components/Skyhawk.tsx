import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Frame } from '../engine/types';
import { D2R } from '../engine/kinematics';

/**
 * Low-poly high-wing trainer in the proportions of a 172 (11 m span, 8.3 m long).
 * Nose points to −Z, right wing to +X, up is +Y. Origin near the CG.
 * Control surfaces and the propeller move with the frame's control state.
 * Swap this component for a glTF model later; keep the same surface names.
 */
export function Skyhawk({ getFrame }: { getFrame: () => Frame }) {
  const lAil = useRef<THREE.Group>(null);
  const rAil = useRef<THREE.Group>(null);
  const lFlap = useRef<THREE.Group>(null);
  const rFlap = useRef<THREE.Group>(null);
  const elev = useRef<THREE.Group>(null);
  const rud = useRef<THREE.Group>(null);
  const prop = useRef<THREE.Group>(null);

  const mats = useMemo(() => ({
    white: new THREE.MeshStandardMaterial({ color: '#f2f4f5', flatShading: true, roughness: 0.55 }),
    stripe: new THREE.MeshStandardMaterial({ color: '#2b5c8a', flatShading: true, roughness: 0.5 }),
    glass: new THREE.MeshStandardMaterial({ color: '#28323c', flatShading: true, roughness: 0.15, metalness: 0.4 }),
    dark: new THREE.MeshStandardMaterial({ color: '#2a2d31', flatShading: true, roughness: 0.8 }),
    tire: new THREE.MeshStandardMaterial({ color: '#141516', flatShading: true, roughness: 0.9 }),
    surface: new THREE.MeshStandardMaterial({ color: '#dfe3e6', flatShading: true, roughness: 0.55 }),
    red: new THREE.MeshStandardMaterial({ color: '#ff3b30', emissive: '#ff2a1f', emissiveIntensity: 1.2 }),
    green: new THREE.MeshStandardMaterial({ color: '#30d158', emissive: '#22c24a', emissiveIntensity: 1.2 }),
    disc: new THREE.MeshBasicMaterial({ color: '#d0d4d8', transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
  }), []);

  const finGeo = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(3.0, 0.45); s.lineTo(4.32, 0.45); s.lineTo(4.32, 2.0); s.lineTo(4.02, 2.0); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.09, bevelEnabled: false });
    g.translate(0, 0, -0.045);
    g.rotateY(-Math.PI / 2);
    return g;
  }, []);

  useFrame((_, dt) => {
    const f = getFrame();
    const ail = f.c.aileron * 0.35;
    // Right yoke: right aileron up, left aileron down.
    if (rAil.current) rAil.current.rotation.x = -ail;
    if (lAil.current) lAil.current.rotation.x = ail;
    const flap = f.c.flaps * D2R;
    if (rFlap.current) rFlap.current.rotation.x = flap;
    if (lFlap.current) lFlap.current.rotation.x = flap;
    // Pull: elevator trailing edge up.
    if (elev.current) elev.current.rotation.x = -f.c.elevator * 0.45;
    // Right pedal: rudder trailing edge left.
    if (rud.current) rud.current.rotation.y = -f.c.rudder * 0.45;
    if (prop.current) prop.current.rotation.z += dt * 9;
  });

  const box = (args: [number, number, number], pos: [number, number, number], m: THREE.Material, key?: string) => (
    <mesh key={key} position={pos} material={m}><boxGeometry args={args} /></mesh>
  );

  return (
    <group>
      {/* Fuselage */}
      <mesh position={[0, 0.05, -2.75]} rotation={[Math.PI / 2, 0, 0]} scale={[0.95, 1, 1]} material={mats.white}>
        <cylinderGeometry args={[0.5, 0.42, 1.1, 8]} />
      </mesh>
      {box([1.12, 1.3, 2.5], [0, 0.22, -1.0], mats.white)}
      {box([1.14, 0.12, 2.52], [0, -0.2, -1.0], mats.stripe)}
      <mesh position={[0, 0.3, 2.05]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 0.95]} material={mats.white}>
        <cylinderGeometry args={[0.13, 0.62, 3.6, 8]} />
      </mesh>
      {/* Windshield and side windows */}
      <mesh position={[0, 0.62, -2.05]} rotation={[-0.75, 0, 0]} material={mats.glass}><boxGeometry args={[1.0, 0.7, 0.04]} /></mesh>
      {box([1.16, 0.5, 1.5], [0, 0.55, -1.0], mats.glass)}
      {/* Spinner and propeller */}
      <mesh position={[0, 0.05, -3.45]} rotation={[-Math.PI / 2, 0, 0]} material={mats.white}>
        <coneGeometry args={[0.2, 0.45, 8]} />
      </mesh>
      <group ref={prop} position={[0, 0.05, -3.36]}>
        {box([1.9, 0.14, 0.04], [0, 0, 0], mats.dark)}
        <mesh material={mats.disc}><circleGeometry args={[0.96, 24]} /></mesh>
      </group>
      {/* Wing: main box plus hinged flaps and ailerons */}
      {box([11, 0.14, 1.15], [0, 0.95, -1.12], mats.white)}
      {box([11.02, 0.02, 0.18], [0, 1.03, -1.55], mats.stripe)}
      <group ref={lFlap} position={[-1.85, 0.93, -0.55]}>{box([2.5, 0.08, 0.42], [0, 0, 0.21], mats.surface)}</group>
      <group ref={rFlap} position={[1.85, 0.93, -0.55]}>{box([2.5, 0.08, 0.42], [0, 0, 0.21], mats.surface)}</group>
      <group ref={lAil} position={[-4.3, 0.93, -0.55]}>{box([2.3, 0.07, 0.38], [0, 0, 0.19], mats.surface)}</group>
      <group ref={rAil} position={[4.3, 0.93, -0.55]}>{box([2.3, 0.07, 0.38], [0, 0, 0.19], mats.surface)}</group>
      {/* Nav lights: red left, green right */}
      <mesh position={[-5.52, 0.95, -1.4]} material={mats.red}><sphereGeometry args={[0.07, 6, 6]} /></mesh>
      <mesh position={[5.52, 0.95, -1.4]} material={mats.green}><sphereGeometry args={[0.07, 6, 6]} /></mesh>
      {/* Struts */}
      {[-1, 1].map((s) => (
        <Strut key={s} from={[s * 0.55, -0.3, -1.0]} to={[s * 2.6, 0.88, -1.15]} material={mats.white} />
      ))}
      {/* Tail */}
      {box([3.4, 0.07, 0.62], [0, 0.33, 3.82], mats.white)}
      <group ref={elev} position={[0, 0.33, 4.13]}>{box([3.3, 0.06, 0.45], [0, 0, 0.22], mats.surface)}</group>
      <mesh geometry={finGeo} material={mats.white} />
      <group ref={rud} position={[0, 0, 4.32]}>{box([0.07, 1.65, 0.42], [0, 1.2, 0.21], mats.surface)}</group>
      {box([0.1, 0.7, 0.5], [0, 1.25, 4.05], mats.stripe)}
      {/* Gear */}
      {[-1, 1].map((s) => (
        <group key={s}>
          <Strut from={[s * 0.45, -0.42, -0.55]} to={[s * 1.25, -1.15, -0.6]} material={mats.dark} radius={0.04} />
          <mesh position={[s * 1.25, -1.25, -0.6]} rotation={[0, 0, Math.PI / 2]} material={mats.tire}>
            <cylinderGeometry args={[0.2, 0.2, 0.14, 10]} />
          </mesh>
          {box([0.2, 0.32, 0.75], [s * 1.25, -1.2, -0.6], mats.white)}
        </group>
      ))}
      <Strut from={[0, -0.3, -2.75]} to={[0, -1.15, -2.85]} material={mats.dark} radius={0.04} />
      <mesh position={[0, -1.25, -2.85]} rotation={[0, 0, Math.PI / 2]} material={mats.tire}>
        <cylinderGeometry args={[0.17, 0.17, 0.12, 10]} />
      </mesh>
    </group>
  );
}

function Strut({ from, to, material, radius = 0.05 }: {
  from: [number, number, number]; to: [number, number, number]; material: THREE.Material; radius?: number;
}) {
  const { pos, quat, len } = useMemo(() => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const dir = b.clone().sub(a);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    return { pos: a.add(b).multiplyScalar(0.5), quat: q, len: dir.length() };
  }, [from, to]);
  return (
    <mesh position={pos} quaternion={quat} material={material}>
      <cylinderGeometry args={[radius, radius, len, 6]} />
    </mesh>
  );
}
