import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Frame } from '../engine/types';
import { D2R } from '../engine/kinematics';

/**
 * Cessna 172S, built procedurally to published dimensions:
 * 8.28 m long, 11.0 m span, 2.72 m tall, 76 in (1.93 m) prop,
 * 1.73° dihedral, 1.63 m root chord tapering to 1.13 m outboard,
 * 8 ft 4 in (2.54 m) main gear track.
 *
 * Axes: nose −Z, right wing +X, up +Y. The origin is the centre of gravity.
 * Every movable surface rotates about its real hinge line.
 *
 * WHEEL_CONTACTS lists the tire contact points so the scene can place the
 * airplane on the runway at any pitch attitude.
 */

// ---- Key stations (metres) -------------------------------------------------
const WING_LE_Z = -0.35;
const ROOT_CHORD = 1.63;
const TIP_CHORD = 1.13;
const TAPER_START = 2.5;
const SEMISPAN = 5.5;
const WING_Y = 0.70;                 // chord line at the root
const DIHEDRAL = 1.73 * D2R;
const MAIN_AXLE: [number, number] = [1.27, 0.32];   // x (half track), z
const NOSE_AXLE_Z = -1.42;
const MAIN_TIRE_R = 0.215;          // 6.00-6
const NOSE_TIRE_R = 0.18;           // 5.00-5
const GROUND_Y = -1.25;             // tire bottom with zero pitch

export const WHEEL_CONTACTS = [
  new THREE.Vector3(-MAIN_AXLE[0], GROUND_Y, MAIN_AXLE[1]),
  new THREE.Vector3(MAIN_AXLE[0], GROUND_Y, MAIN_AXLE[1]),
  new THREE.Vector3(0, GROUND_Y, NOSE_AXLE_Z),
];

const chordAt = (x: number) => {
  const a = Math.abs(x);
  return a <= TAPER_START ? ROOT_CHORD : ROOT_CHORD + (TIP_CHORD - ROOT_CHORD) * ((a - TAPER_START) / (SEMISPAN - TAPER_START));
};
const wingYAt = (x: number) => WING_Y + Math.max(0, Math.abs(x) - 0.56) * Math.tan(DIHEDRAL);

// ---- Geometry helpers ------------------------------------------------------

/** Skins a list of equal-length rings into a smooth surface, with flat caps. */
function loft(rings: THREE.Vector3[][], caps = true, colorOf?: (p: THREE.Vector3) => THREE.Color): THREE.BufferGeometry {
  const m = rings[0].length;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const push = (p: THREE.Vector3) => {
    pos.push(p.x, p.y, p.z);
    if (colorOf) { const c = colorOf(p); col.push(c.r, c.g, c.b); }
  };
  rings.forEach((r) => r.forEach(push));
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < m; j++) {
      const a = i * m + j, b = i * m + ((j + 1) % m), c = (i + 1) * m + j, d = (i + 1) * m + ((j + 1) % m);
      idx.push(a, c, b, b, c, d);
    }
  }
  if (caps) {
    for (const [ri, flip] of [[0, true], [rings.length - 1, false]] as const) {
      const ring = rings[ri];
      const center = ring.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / m);
      const ci = pos.length / 3;
      push(center);
      for (let j = 0; j < m; j++) {
        const a = ri * m + j, b = ri * m + ((j + 1) % m);
        if (flip) idx.push(ci, a, b); else idx.push(ci, b, a);
      }
    }
  }
  // Make every closed surface face outward (positive signed volume), whatever order the rings came in.
  if (caps) {
    let vol = 0;
    for (let k = 0; k < idx.length; k += 3) {
      const [a, b, c] = [idx[k], idx[k + 1], idx[k + 2]].map((q) => new THREE.Vector3(pos[q * 3], pos[q * 3 + 1], pos[q * 3 + 2]));
      vol += a.dot(b.clone().cross(c));
    }
    if (vol < 0) for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (colorOf) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** NACA 4-digit section, closed loop over chord fraction [from, to]. Returns [x/c, y/c]. */
function airfoil(t: number, m: number, p: number, from = 0, to = 1, n = 22): [number, number][] {
  const yt = (x: number) => 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
  const yc = (x: number) => (m === 0 ? 0 : x < p ? (m / (p * p)) * (2 * p * x - x * x) : (m / ((1 - p) ** 2)) * (1 - 2 * p + 2 * p * x - x * x));
  const xs: number[] = [];
  for (let i = 0; i <= n; i++) {
    const u = (1 - Math.cos((Math.PI * i) / n)) / 2;
    xs.push(from + (to - from) * u);
  }
  const upper = [...xs].reverse().map((x) => [x, yc(x) + yt(x)] as [number, number]);
  const lower = xs.slice(1, -1).map((x) => [x, yc(x) - yt(x)] as [number, number]);
  return [...upper, ...lower];
}

/** Wing panel between spanwise stations, built from a chord-fraction slice of the airfoil. */
function wingPanel(xs: number[], from: number, to: number) {
  const sec = airfoil(0.12, 0.02, 0.4, from, to);
  return loft(xs.map((x) => {
    const c = chordAt(x), y0 = wingYAt(x);
    // 3° washout toward the tip, about the quarter chord
    const tw = -3 * D2R * Math.max(0, (Math.abs(x) - TAPER_START) / (SEMISPAN - TAPER_START));
    return sec.map(([u, v]) => {
      const dz = (u - 0.25) * c, dy = v * c;
      return new THREE.Vector3(x, y0 + dy * Math.cos(tw) - dz * Math.sin(tw), WING_LE_Z + 0.25 * c + dz * Math.cos(tw) + dy * Math.sin(tw));
    });
  }));
}

/** Tail surface: symmetric section lofted between stations given as [x, leZ, chord, y]. */
function tailPanel(st: [number, number, number, number][], from: number, to: number, vertical = false) {
  const sec = airfoil(0.09, 0, 0.4, from, to, 16);
  return loft(st.map(([s, le, c, h]) => sec.map(([u, v]) =>
    vertical ? new THREE.Vector3(v * c, s, le + u * c) : new THREE.Vector3(s, h + v * c, le + u * c))));
}

function superRing(z: number, yc: number, hw: number, hh: number, n: number, k = 40, bottomFlat = 1) {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < k; i++) {
    const a = (i / k) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    const e = 2 / n;
    const x = hw * Math.sign(c) * Math.abs(c) ** e;
    let y = hh * Math.sign(s) * Math.abs(s) ** e;
    if (y < 0) y *= bottomFlat;
    pts.push(new THREE.Vector3(x, yc + y, z));
  }
  return pts;
}

/** Fuselage stations: z, centre height, half width, half height, squareness. */
const FUSE: [number, number, number, number, number][] = [
  [-2.30, -0.02, 0.17, 0.17, 2.0],
  [-2.22, -0.02, 0.33, 0.30, 2.1],
  [-2.05, 0.00, 0.44, 0.37, 2.4],
  [-1.70, 0.03, 0.51, 0.43, 2.7],
  [-1.25, 0.06, 0.54, 0.49, 2.9],
  [-0.95, 0.09, 0.555, 0.54, 3.0],
  [-0.65, 0.12, 0.56, 0.61, 3.1],
  [-0.35, 0.13, 0.56, 0.66, 3.2],
  [0.30, 0.13, 0.56, 0.66, 3.2],
  [1.00, 0.15, 0.54, 0.62, 3.0],
  [1.60, 0.18, 0.46, 0.54, 2.8],
  [2.30, 0.21, 0.36, 0.44, 2.6],
  [3.20, 0.24, 0.25, 0.32, 2.4],
  [4.20, 0.25, 0.16, 0.22, 2.3],
  [5.10, 0.24, 0.09, 0.15, 2.2],
  [5.55, 0.23, 0.05, 0.11, 2.0],
];

function fuseAt(z: number) {
  let i = 0;
  while (i < FUSE.length - 2 && FUSE[i + 1][0] < z) i++;
  const a = FUSE[i], b = FUSE[i + 1];
  const u = THREE.MathUtils.clamp((z - a[0]) / (b[0] - a[0]), 0, 1);
  const s = u * u * (3 - 2 * u);
  return a.map((v, k) => (k === 0 ? z : v + (b[k] - v) * s)) as [number, number, number, number, number];
}

const C = {
  white: new THREE.Color('#f4f5f6'),
  navy: new THREE.Color('#1f3a68'),
  silver: new THREE.Color('#9aa4ae'),
  glass: new THREE.Color('#1b2630'),
  frame: new THREE.Color('#e4e7ea'),
};

/** Livery and windows painted as vertex colours on the fuselage skin. */
function fuselageColor(p: THREE.Vector3): THREE.Color {
  const { x, y, z } = p;
  const ax = Math.abs(x);
  // Windshield: front upper, between cowl and roof.
  if (z > -1.18 && z < -0.38 && y > 0.36 + (z + 1.18) * 0.05) {
    return ax < 0.06 ? C.frame : C.glass;   // centre strip
  }
  // Side windows: two per side, split by the door post; then the small rear window.
  if (ax > 0.3 && y > 0.2 && y < 0.68) {
    if (z > -0.32 && z < 0.98 && !(z > 0.24 && z < 0.31)) return C.glass;
    if (z > 1.08 && z < 1.85 && y < 0.62 - (z - 1.08) * 0.35) return C.glass;
  }
  // Rear overhead (omni-vision) window
  if (z > 1.08 && z < 1.65 && y > 0.66 && ax < 0.28) return C.glass;
  // Swoosh stripes rising toward the tail
  if (z > -1.9) {
    const rise = Math.max(0, z - 0.8) * 0.085;
    const c1 = -0.20 + rise;
    if (y > c1 - 0.06 && y < c1 + 0.06 && ax > 0.05) return C.navy;
    if (y > c1 - 0.13 && y < c1 - 0.09 && ax > 0.05) return C.silver;
  }
  return C.white;
}

function lathe(profile: [number, number][], segments = 20) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}

/** Group whose child rotates about the hinge line A→B (geometry given in model coordinates). */
function useHinge(a: THREE.Vector3, b: THREE.Vector3, geo: THREE.BufferGeometry) {
  return useMemo(() => {
    const dir = b.clone().sub(a).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
    const m = new THREE.Matrix4().compose(a, q, new THREE.Vector3(1, 1, 1)).invert();
    const g = geo.clone().applyMatrix4(m);
    return { position: a, quaternion: q, geometry: g };
  }, [a, b, geo]);
}

function Hinged({ a, b, geo, mat, rotRef }: {
  a: THREE.Vector3; b: THREE.Vector3; geo: THREE.BufferGeometry; mat: THREE.Material; rotRef: React.RefObject<THREE.Group>;
}) {
  const h = useHinge(a, b, geo);
  return (
    <group position={h.position} quaternion={h.quaternion}>
      <group ref={rotRef}><mesh geometry={h.geometry} material={mat} /></group>
    </group>
  );
}

function tube(from: THREE.Vector3, to: THREE.Vector3, rx: number, ry: number, mat: THREE.Material, key?: string) {
  const dir = to.clone().sub(from);
  const len = dir.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return (
    <mesh key={key} position={from.clone().add(to).multiplyScalar(0.5)} quaternion={q} scale={[rx, 1, ry]} material={mat}>
      <cylinderGeometry args={[1, 1, len, 12]} />
    </mesh>
  );
}

// ---- Component -------------------------------------------------------------

export function Cessna172({ getFrame, lowWing = false, twin = false }: { getFrame: () => Frame; lowWing?: boolean; twin?: boolean }) {
  void twin;
  // The same wing mounted under the fuselage, without struts, stands in for low-wing types.
  const wingDrop = lowWing ? -1.0 : 0;
  const lAil = useRef<THREE.Group>(null), rAil = useRef<THREE.Group>(null);
  const lFlap = useRef<THREE.Group>(null), rFlap = useRef<THREE.Group>(null);
  const lElev = useRef<THREE.Group>(null), rElev = useRef<THREE.Group>(null);
  const rud = useRef<THREE.Group>(null);
  const prop = useRef<THREE.Group>(null);
  const disc = useRef<THREE.MeshBasicMaterial>(null);

  const mats = useMemo(() => ({
    skin: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.05 }),
    white: new THREE.MeshStandardMaterial({ color: '#f4f5f6', roughness: 0.4, metalness: 0.05, side: THREE.DoubleSide }),
    surface: new THREE.MeshStandardMaterial({ color: '#eceef0', roughness: 0.45, metalness: 0.05, side: THREE.DoubleSide }),
    navy: new THREE.MeshStandardMaterial({ color: '#1f3a68', roughness: 0.45 }),
    grey: new THREE.MeshStandardMaterial({ color: '#5b6168', roughness: 0.6, metalness: 0.3 }),
    dark: new THREE.MeshStandardMaterial({ color: '#2a2d31', roughness: 0.8 }),
    tire: new THREE.MeshStandardMaterial({ color: '#17181a', roughness: 0.95 }),
    blade: new THREE.MeshStandardMaterial({ color: '#2b2e33', roughness: 0.6, side: THREE.DoubleSide }),
    tip: new THREE.MeshStandardMaterial({ color: '#f2c200', roughness: 0.5, side: THREE.DoubleSide }),
    red: new THREE.MeshStandardMaterial({ color: '#ff3b30', emissive: '#ff2a1f', emissiveIntensity: 1.4 }),
    green: new THREE.MeshStandardMaterial({ color: '#30d158', emissive: '#22c24a', emissiveIntensity: 1.4 }),
    whiteLight: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 1 }),
    chrome: new THREE.MeshStandardMaterial({ color: '#c9ced3', roughness: 0.25, metalness: 0.8 }),
  }), []);

  const geo = useMemo(() => {
    // Fuselage skin
    const rings: THREE.Vector3[][] = [];
    for (let z = FUSE[0][0]; z <= FUSE[FUSE.length - 1][0] + 1e-6; z += 0.025) {
      const [, yc, hw, hh, n] = fuseAt(z);
      rings.push(superRing(z, yc, hw, hh, n, 112, z > -1.3 && z < 1.6 ? 0.92 : 1));
    }
    const fuselage = loft(rings, true, fuselageColor);

    // Wing: centre section, inboard (flap) and outboard (aileron) panels cut at the hinge, tips.
    const span = (a: number, b: number, steps = 6) => Array.from({ length: steps + 1 }, (_, i) => a + ((b - a) * i) / steps);
    const HINGE = 0.74;
    const wingParts = [
      wingPanel(span(-0.56, 0.56, 2), 0, 1),
      wingPanel(span(0.56, 3.0), 0, HINGE), wingPanel(span(-3.0, -0.56), 0, HINGE),
      wingPanel(span(3.0, 5.15), 0, HINGE), wingPanel(span(-5.15, -3.0), 0, HINGE),
      wingPanel(span(5.15, 5.42, 2), 0, 1), wingPanel(span(-5.42, -5.15, 2), 0, 1),
    ];
    const tipCap = (sgn: number) => wingPanel(sgn > 0 ? span(5.42, SEMISPAN, 3) : span(-SEMISPAN, -5.42, 3), 0, 1);
    const flapR = wingPanel(span(0.58, 2.98), HINGE + 0.005, 1);
    const flapL = wingPanel(span(-2.98, -0.58), HINGE + 0.005, 1);
    const ailR = wingPanel(span(3.02, 5.13), HINGE + 0.005, 1);
    const ailL = wingPanel(span(-5.13, -3.02), HINGE + 0.005, 1);
    const hingePt = (x: number) => new THREE.Vector3(x, wingYAt(x), WING_LE_Z + HINGE * chordAt(x));

    // Horizontal tail: span 3.45 m, root chord 1.12, tip 0.78, hinge at 55 %.
    const ht: [number, number, number, number][] = [];
    for (let i = 0; i <= 5; i++) {
      const s = 1.72 * (i / 5);
      const c = 1.12 - 0.34 * (i / 5);
      ht.push([s, 4.62 + (1.12 - c) * 0.35, c, 0.12]);
    }
    const mirror = (a: [number, number, number, number][]) => a.map(([s, le, c, h]) => [-s, le, c, h] as [number, number, number, number]).reverse();
    const stabR = tailPanel(ht, 0, 0.55), stabL = tailPanel(mirror(ht), 0, 0.55);
    const elevR = tailPanel(ht.map(([s, le, c, h]) => [Math.max(s, 0.12), le, c, h]), 0.56, 1);
    const elevL = tailPanel(mirror(ht).map(([s, le, c, h]) => [Math.min(s, -0.12), le, c, h]), 0.56, 1);
    const elevHinge = (s: number) => { const c = 1.12 - 0.34 * (Math.abs(s) / 1.72); return new THREE.Vector3(s, 0.12, 4.62 + (1.12 - c) * 0.35 + 0.555 * c); };

    // Fin: swept leading edge, straight rudder hinge at z 5.38.
    const fin: [number, number, number, number][] = [];
    const rudderSt: [number, number, number, number][] = [];
    for (let i = 0; i <= 6; i++) {
      const y = 0.32 + (1.47 - 0.32) * (i / 6);
      const le = 3.95 + (5.0 - 3.95) * (i / 6);
      const hingeZ = 5.38;
      fin.push([y, le, hingeZ - le, 0]);
      const teZ = 5.86 - 0.12 * (i / 6);
      rudderSt.push([y, hingeZ + 0.005, teZ - hingeZ, 0]);
    }
    const finGeo = tailPanel(fin, 0, 1, true);
    const rudGeo = tailPanel(rudderSt, 0, 1, true);
    // Dorsal fin fillet
    const dorsal = new THREE.Shape();
    dorsal.moveTo(2.7, 0.0); dorsal.lineTo(4.1, 0.0); dorsal.lineTo(4.1, 0.42); dorsal.closePath();
    const dorsalGeo = new THREE.ExtrudeGeometry(dorsal, { depth: 0.06, bevelEnabled: false });
    dorsalGeo.translate(0, 0, -0.03); dorsalGeo.rotateY(-Math.PI / 2); dorsalGeo.translate(0, 0.42, 0);

    // Spinner and blades
    const spinner = lathe([[0, 0.34], [0.08, 0.31], [0.14, 0.24], [0.17, 0.12], [0.18, 0]], 24);
    spinner.rotateX(-Math.PI / 2); spinner.translate(0, -0.02, -2.3);
    const bladeRings: THREE.Vector3[][] = [];
    for (let i = 0; i <= 10; i++) {
      const r = 0.14 + (0.965 - 0.14) * (i / 10);
      const chord = 0.13 - 0.05 * (i / 10);
      const twist = (32 - 20 * (i / 10)) * D2R;
      bladeRings.push(airfoil(0.1, 0.03, 0.4, 0, 1, 8).map(([u, v]) => {
        const cx = (u - 0.4) * chord, cy = v * chord;
        return new THREE.Vector3(cx * Math.cos(twist) - cy * Math.sin(twist), r, cx * Math.sin(twist) + cy * Math.cos(twist));
      }));
    }
    const blade = loft(bladeRings);

    const pant = lathe([[0, -0.42], [0.1, -0.36], [0.16, -0.18], [0.17, 0.05], [0.13, 0.3], [0.05, 0.45], [0, 0.48]], 16);
    pant.rotateX(Math.PI / 2);

    return {
      fuselage, wingParts, tipCaps: [tipCap(1), tipCap(-1)], flapR, flapL, ailR, ailL, hingePt,
      stabR, stabL, elevR, elevL, elevHinge, finGeo, rudGeo, dorsalGeo, spinner, blade, pant,
    };
  }, []);

  const hp = geo.hingePt;
  const hinges = useMemo(() => ({
    flapR: [hp(0.58), hp(2.98)], flapL: [hp(-2.98), hp(-0.58)],
    ailR: [hp(3.02), hp(5.13)], ailL: [hp(-5.13), hp(-3.02)],
    elevR: [geo.elevHinge(0.12), geo.elevHinge(1.72)], elevL: [geo.elevHinge(-1.72), geo.elevHinge(-0.12)],
  }), [geo, hp]);

  useFrame((_, dt) => {
    const f = getFrame();
    const ail = f.c.aileron * 0.3;
    // Hinge axes point toward +X, so +rotation moves the trailing edge down.
    if (rAil.current) rAil.current.rotation.x = -ail;   // right yoke: right aileron up
    if (lAil.current) lAil.current.rotation.x = ail;    //             left aileron down
    const flap = f.c.flaps * D2R;
    if (rFlap.current) rFlap.current.rotation.x = flap;
    if (lFlap.current) lFlap.current.rotation.x = flap;
    const el = -f.c.elevator * 0.4;                     // pull: trailing edge up
    if (rElev.current) rElev.current.rotation.x = el;
    if (lElev.current) lElev.current.rotation.x = el;
    if (rud.current) rud.current.rotation.y = f.c.rudder * 0.38;  // right pedal: rudder to the right
    const spin = THREE.MathUtils.clamp((f.rpm - 600) / 1800, 0, 1);
    if (prop.current) prop.current.rotation.z += dt * (4 + 10 * spin);
    if (disc.current) disc.current.opacity = 0.05 + 0.13 * spin;
  });

  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const mainAxleY = GROUND_Y + MAIN_TIRE_R;
  const noseAxleY = GROUND_Y + NOSE_TIRE_R;

  return (
    <group>
      <mesh geometry={geo.fuselage} material={mats.skin} />

      <group position={[0, wingDrop, 0]}>
      {/* Wing */}
      {geo.wingParts.map((g, i) => <mesh key={i} geometry={g} material={mats.white} />)}
      {geo.tipCaps.map((g, i) => <mesh key={`t${i}`} geometry={g} material={mats.white} />)}
      <Hinged a={hinges.flapR[0]} b={hinges.flapR[1]} geo={geo.flapR} mat={mats.surface} rotRef={rFlap} />
      <Hinged a={hinges.flapL[0]} b={hinges.flapL[1]} geo={geo.flapL} mat={mats.surface} rotRef={lFlap} />
      <Hinged a={hinges.ailR[0]} b={hinges.ailR[1]} geo={geo.ailR} mat={mats.surface} rotRef={rAil} />
      <Hinged a={hinges.ailL[0]} b={hinges.ailL[1]} geo={geo.ailL} mat={mats.surface} rotRef={lAil} />
      {/* Nav lights: red left, green right, white strobes */}
      <mesh position={[-SEMISPAN + 0.02, wingYAt(SEMISPAN), WING_LE_Z + 0.25]} material={mats.red}><sphereGeometry args={[0.05, 8, 8]} /></mesh>
      <mesh position={[SEMISPAN - 0.02, wingYAt(SEMISPAN), WING_LE_Z + 0.25]} material={mats.green}><sphereGeometry args={[0.05, 8, 8]} /></mesh>

      </group>
      {/* Lift struts */}
      {!lowWing && [-1, 1].map((s) => tube(v(s * 0.5, -0.36, -0.02), v(s * 2.55, wingYAt(2.55) - 0.08, 0.02), 0.045, 0.02, mats.white, `s${s}`))}

      {/* Empennage */}
      <mesh geometry={geo.stabR} material={mats.white} />
      <mesh geometry={geo.stabL} material={mats.white} />
      <Hinged a={hinges.elevR[0]} b={hinges.elevR[1]} geo={geo.elevR} mat={mats.surface} rotRef={rElev} />
      <Hinged a={hinges.elevL[0]} b={hinges.elevL[1]} geo={geo.elevL} mat={mats.surface} rotRef={lElev} />
      <mesh geometry={geo.finGeo} material={mats.white} />
      <mesh geometry={geo.dorsalGeo} material={mats.white} />
      <group position={[0, 0, 5.385]}>
        <group ref={rud}>
          <mesh geometry={geo.rudGeo} material={mats.navy} position={[0, 0, -5.385]} />
        </group>
      </group>
      <mesh position={[0, 1.5, 5.1]} material={mats.red}><boxGeometry args={[0.07, 0.07, 0.16]} /></mesh>

      {/* Engine: intakes, exhaust, spinner, propeller */}
      {[-1, 1].map((s) => (
        <mesh key={`in${s}`} position={[s * 0.24, -0.08, -2.2]} material={mats.dark}><boxGeometry args={[0.16, 0.12, 0.05]} /></mesh>
      ))}
      <mesh position={[0.2, -0.42, -1.55]} rotation={[0.3, 0, 0]} material={mats.grey}><cylinderGeometry args={[0.03, 0.03, 0.22, 8]} /></mesh>
      <mesh geometry={geo.spinner} material={mats.white} />
      <group ref={prop} position={[0, -0.02, -2.32]}>
        {[0, Math.PI].map((r) => (
          <group key={r} rotation={[0, 0, r]}>
            <mesh geometry={geo.blade} material={mats.blade} />
            <mesh position={[0, 0.93, 0]} material={mats.tip}><boxGeometry args={[0.08, 0.07, 0.02]} /></mesh>
          </group>
        ))}
        <mesh>
          <circleGeometry args={[0.965, 40]} />
          <meshBasicMaterial ref={disc} color="#d8dde2" transparent opacity={0.12} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      </group>

      {/* Main gear: tapered spring-steel legs, wheel pants, tires */}
      {[-1, 1].map((s) => (
        <group key={`mg${s}`}>
          {tube(v(s * 0.42, -0.52, MAIN_AXLE[1] - 0.05), v(s * (MAIN_AXLE[0] - 0.1), mainAxleY + 0.05, MAIN_AXLE[1]), 0.05, 0.022, mats.grey)}
          <mesh position={[s * MAIN_AXLE[0], mainAxleY, MAIN_AXLE[1]]} rotation={[0, 0, Math.PI / 2]} material={mats.tire}>
            <torusGeometry args={[MAIN_TIRE_R - 0.06, 0.065, 10, 24]} />
          </mesh>
          <mesh position={[s * MAIN_AXLE[0], mainAxleY + 0.09, MAIN_AXLE[1] - 0.05]} scale={[0.72, 1.3, 1.1]} geometry={geo.pant} material={mats.white} />
        </group>
      ))}
      {/* Nose gear: oleo strut, fork, pant, tire */}
      {tube(v(0, -0.35, -1.55), v(0, noseAxleY + 0.2, NOSE_AXLE_Z - 0.02), 0.045, 0.045, mats.chrome)}
      <mesh position={[0, noseAxleY, NOSE_AXLE_Z]} rotation={[0, 0, Math.PI / 2]} material={mats.tire}>
        <torusGeometry args={[NOSE_TIRE_R - 0.055, 0.055, 10, 22]} />
      </mesh>
      <mesh position={[0, noseAxleY + 0.08, NOSE_AXLE_Z - 0.03]} scale={[0.62, 1.1, 0.9]} geometry={geo.pant} material={mats.white} />

      {/* Antennas and steps */}
      <mesh position={[0, 0.86, 0.9]} rotation={[0.5, 0, 0]} material={mats.dark}><boxGeometry args={[0.02, 0.28, 0.06]} /></mesh>
      <mesh position={[0, 0.84, 1.5]} rotation={[0.35, 0, 0]} material={mats.dark}><boxGeometry args={[0.015, 0.22, 0.05]} /></mesh>
      {[-1, 1].map((s) => (
        <mesh key={`st${s}`} position={[s * 0.62, -0.52, 0.0]} material={mats.grey}><boxGeometry args={[0.12, 0.02, 0.1]} /></mesh>
      ))}
    </group>
  );
}
