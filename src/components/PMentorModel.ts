import * as THREE from 'three';
import { PM, pmentorRig, ySpan } from '../data/pmentorShape';

/**
 * Tecnam P-Mentor, built in code for this app (an original model, not derived from
 * any third-party mesh). Published dimensions: length 6.74 m, span 9.00 m,
 * height 2.50 m, wing area 11.9 m² (128 sq ft), cabin width 1.19 m, two-blade MT
 * constant-speed propeller. Plain white.
 *
 * Model frame (same as every model in the app): nose −Z, right wing +X, up +Y,
 * metres, origin at the CG. Movable parts are separate named objects so the app
 * can hinge them: aileronL/R, flapL/R, elevator (the all-moving stabilator),
 * rudder, prop. Hinge lines and the prop hub are exported for the rig.
 */

// ── Materials ────────────────────────────────────────────────────────────────
function materials() {
  return {
    // Double-sided so every generated surface shades correctly whichever way it was wound.
    white: new THREE.MeshStandardMaterial({ name: 'paint', color: '#f5f6f4', roughness: 0.42, metalness: 0.05, side: THREE.DoubleSide }),
    grey: new THREE.MeshStandardMaterial({ name: 'grey', color: '#8a9096', roughness: 0.5, metalness: 0.4 }),
    dark: new THREE.MeshStandardMaterial({ name: 'interior', color: '#2b2f34', roughness: 0.85 }),
    tire: new THREE.MeshStandardMaterial({ name: 'tire', color: '#151617', roughness: 0.95 }),
    prop: new THREE.MeshStandardMaterial({ name: 'prop', color: '#1d1f22', roughness: 0.6, side: THREE.DoubleSide }),
    tipPaint: new THREE.MeshStandardMaterial({ name: 'tips', color: '#f2c230', roughness: 0.5, side: THREE.DoubleSide }),
    glass: new THREE.MeshStandardMaterial({ name: 'glass', color: '#4a6274', roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
  };
}

// ── Airfoils ─────────────────────────────────────────────────────────────────
/** NACA 4-digit section as a closed loop (upper TE→LE, lower LE→TE), chord 0..1. */
function naca(m: number, p: number, t: number, n = 28, from = 0, to = 1): [number, number][] {
  const pts = (side: 1 | -1) => {
    const out: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const b = (i / n) * Math.PI;
      const xn = (1 - Math.cos(b)) / 2;                 // cosine spacing: dense at LE and TE
      const x = from + (to - from) * xn;
      const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
      const yc = p > 0 ? (x < p ? (m / (p * p)) * (2 * p * x - x * x) : (m / ((1 - p) ** 2)) * (1 - 2 * p + 2 * p * x - x * x)) : 0;
      out.push([x, yc + side * yt]);
    }
    return out;
  };
  const up = pts(1).reverse(), lo = pts(-1);
  return [...up, ...lo.slice(from === 0 ? 1 : 0)];
}

/**
 * Extrude a closed 2D loop (u along the chord, v thickness) between stations.
 * Each station maps (u, v) to a point in the model frame. Smooth around the loop,
 * flat caps at both ends.
 */
function extrude(loop: [number, number][], stations: ((u: number, v: number) => THREE.Vector3)[], mat: THREE.Material, name: string) {
  const L = loop.length, S = stations.length;
  const pos: number[] = [], idx: number[] = [];
  for (const st of stations) for (const [u, v] of loop) { const p = st(u, v); pos.push(p.x, p.y, p.z); }
  for (let s = 0; s < S - 1; s++) for (let i = 0; i < L; i++) {
    const a = s * L + i, b = s * L + ((i + 1) % L), c = (s + 1) * L + i, d = (s + 1) * L + ((i + 1) % L);
    idx.push(a, c, b, b, c, d);
  }
  const side = new THREE.BufferGeometry();
  side.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  side.setIndex(idx);
  side.computeVertexNormals();
  const group = new THREE.Group();
  group.name = name;
  group.add(new THREE.Mesh(side, mat));
  // End caps
  const tri = THREE.ShapeUtils.triangulateShape(loop.map(([u, v]) => new THREE.Vector2(u, v)), []);
  for (const [k, st] of [[0, stations[0]], [1, stations[S - 1]]] as const) {
    const cp: number[] = [];
    for (const [u, v] of loop) { const p = st(u, v); cp.push(p.x, p.y, p.z); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
    g.setIndex(tri.flatMap(([a, b, c]) => (k === 0 ? [a, b, c] : [a, c, b])));
    g.computeVertexNormals();
    group.add(new THREE.Mesh(g, mat));
  }
  return group;
}

// ── Lofted bodies ────────────────────────────────────────────────────────────
interface Section { z: number; w: number; top: number; bot: number; n?: number }

/**
 * Section at z: each dimension follows a monotone cubic (PCHIP) through the control
 * sections, so the surface is smooth with no flat spots and no overshoot.
 */
function sectionAt(secs: Section[], z: number): Section {
  const zs = secs.map((s) => s.z);
  const f = (key: 'w' | 'top' | 'bot' | 'n') => pchip(zs, secs.map((s) => (key === 'n' ? s.n ?? 2.4 : s[key])), z);
  return { z, w: f('w'), top: f('top'), bot: f('bot'), n: f('n') };
}
function pchip(xs: number[], ys: number[], x: number) {
  const n = xs.length;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  const h = xs.slice(1).map((v, i) => v - xs[i]);
  const d = h.map((hi, i) => (ys[i + 1] - ys[i]) / hi);
  const m = ys.map((_, i) => {
    if (i === 0) return d[0];
    if (i === n - 1) return d[n - 2];
    if (d[i - 1] * d[i] <= 0) return 0;
    const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
    return (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
  });
  let i = 0; while (x > xs[i + 1]) i++;
  const t = (x - xs[i]) / h[i], t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
}

/** Superellipse loft along Z. `half` builds only the upper half (for the canopy). */
function loft(secs: Section[], rings: number, seg: number, mat: THREE.Material, name: string, half = false) {
  const z0 = secs[0].z, z1 = secs[secs.length - 1].z;
  const pos: number[] = [], idx: number[] = [];
  const M = half ? seg + 1 : seg;
  for (let r = 0; r <= rings; r++) {
    const s = sectionAt(secs, z0 + ((z1 - z0) * r) / rings);
    const mid = (s.top + s.bot) / 2, hh = (s.top - s.bot) / 2, e = 2 / (s.n ?? 2.4);
    for (let j = 0; j < M; j++) {
      const th = half ? (j / seg) * Math.PI : (j / seg) * Math.PI * 2;
      const c = Math.cos(th), sn = Math.sin(th);
      const x = s.w * Math.sign(c) * Math.abs(c) ** e;
      const y = half ? s.bot + (s.top - s.bot) * Math.abs(sn) ** e : mid + hh * Math.sign(sn) * Math.abs(sn) ** e;
      pos.push(x, y, s.z);
    }
  }
  for (let r = 0; r < rings; r++) for (let j = 0; j < (half ? seg : M); j++) {
    const jn = half ? j + 1 : (j + 1) % M;
    const a = r * M + j, b = r * M + jn, c = (r + 1) * M + j, d = (r + 1) * M + jn;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.name = name;
  return m;
}

// ── The airplane ─────────────────────────────────────────────────────────────
export function buildPMentor(): THREE.Group {
  const mat = materials();
  const root = new THREE.Group();
  root.name = 'p-mentor';

  // Fuselage: cowling behind the spinner, wide cabin, turtle deck behind the canopy, slim tail cone.
  const fuselage: Section[] = [
    { z: -1.97, w: 0.2, top: 0.07, bot: -0.2, n: 2.2 },
    { z: -1.75, w: 0.36, top: 0.13, bot: -0.36, n: 2.4 },
    { z: -1.35, w: 0.45, top: 0.19, bot: -0.45, n: 2.6 },
    { z: -0.95, w: 0.52, top: 0.24, bot: -0.5, n: 2.8 },
    { z: -0.55, w: 0.6, top: 0.27, bot: -0.53, n: 3 },
    { z: 0.05, w: 0.62, top: 0.28, bot: -0.53, n: 3 },
    { z: 0.6, w: 0.6, top: 0.36, bot: -0.5, n: 3 },
    { z: 1.0, w: 0.52, top: 0.5, bot: -0.43, n: 2.8 },
    { z: 1.6, w: 0.36, top: 0.42, bot: -0.3, n: 2.6 },
    { z: 2.4, w: 0.22, top: 0.32, bot: -0.15, n: 2.4 },
    { z: 3.2, w: 0.14, top: 0.28, bot: -0.04, n: 2.3 },
    { z: 3.9, w: 0.09, top: 0.27, bot: 0.03, n: 2.2 },
    { z: 4.42, w: 0.03, top: 0.24, bot: 0.12, n: 2 },
  ];
  root.add(loft(fuselage, 90, 48, mat.white, 'fuselage'));

  // Bubble canopy from the windshield base to the turtle deck.
  const canopy: Section[] = [
    { z: -0.95, w: 0.5, top: 0.25, bot: 0.24, n: 2.2 },
    { z: -0.6, w: 0.58, top: 0.5, bot: 0.27, n: 2.3 },
    { z: -0.1, w: 0.61, top: 0.63, bot: 0.28, n: 2.4 },
    { z: 0.45, w: 0.59, top: 0.62, bot: 0.3, n: 2.4 },
    { z: 1.0, w: 0.51, top: 0.51, bot: 0.49, n: 2.4 },
  ];
  root.add(loft(canopy, 40, 32, mat.glass, 'canopy', true));
  // Canopy frame bow and the cabin seen through it.
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.018, 6, 40, Math.PI), mat.grey);
  bow.position.set(0, 0.28, 0.42); bow.scale.set(1, 0.57, 1); root.add(bow);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.02, 1.8), mat.dark); floor.position.set(0, 0.27, 0.0); root.add(floor);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.1, 0.16), mat.dark); panel.position.set(0, 0.32, -0.68); root.add(panel);
  for (const x of [-0.27, 0.27]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.07), mat.dark);
    seat.position.set(x, 0.43, 0.38); seat.rotation.x = -0.2; root.add(seat);
  }

  // Spinner and two-blade propeller.
  const sp = PM.spinner;
  // Rounded spinner: half an ellipsoid pointing forward.
  const spinner = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat.white);
  spinner.rotation.x = -Math.PI / 2;                 // dome (+Y) now points forward (−Z)
  spinner.scale.set(sp.r, sp.baseZ - sp.tipZ, sp.r);
  spinner.position.set(0, sp.y, sp.baseZ);
  const prop = new THREE.Group(); prop.name = 'prop';
  const hub = pmentorRig().propHub;
  for (const s of [1, -1]) {
    const blade = extrude(naca(0, 0, 0.12, 10), [0.13, 0.5, 0.82, 1].map((r) => {
      const chord = 0.11 - 0.05 * r ** 2 + (r < 0.2 ? 0.02 : 0);
      const twist = (35 - 22 * r) * Math.PI / 180;
      return (u: number, v: number) => {
        // Chord in the plane of rotation, turned by the blade angle; thickness perpendicular to it.
        const cu = (u - 0.3) * chord, cv = v * chord;
        const x = cu * Math.cos(twist) - cv * Math.sin(twist), z = cu * Math.sin(twist) + cv * Math.cos(twist);
        return new THREE.Vector3(s * x, s * r * PM.propRadius, z);
      };
    }), mat.prop, 'blade');
    prop.add(blade);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.09, 0.012), mat.tipPaint);
    tip.position.set(0, s * PM.propRadius * 0.95, 0); prop.add(tip);
  }
  prop.position.set(...hub);
  root.add(prop, spinner);

  // Wing: fixed front 73 % of chord over the whole span; flaps and ailerons aft of the hinge.
  const w = PM.wing;
  const at = (x: number) => (u: number, v: number) => new THREE.Vector3(x, ySpan(x) + v * w.chord, w.le + u * w.chord);
  const front = naca(0.04, 0.4, 0.15, 30, 0, w.hingeAt - 0.01);
  for (const s of [-1, 1]) {
    root.add(extrude(front, [at(s * w.rootX), at(s * w.tipX)], mat.white, 'wing'));
    // Rounded tip
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 8), mat.white);
    tip.scale.set(0.16, 0.19, w.chord * 0.95);
    tip.position.set(s * (w.tipX + 0.01), ySpan(w.tipX) + 0.025, w.le + w.chord * 0.48); root.add(tip);
    const aft = naca(0.04, 0.4, 0.15, 14, w.hingeAt, 1);
    const L = s < 0 ? 'L' : 'R';
    for (const [name, [a, b]] of [[`flap${L}`, PM.flapSpan], [`aileron${L}`, PM.aileronSpan]] as const) {
      root.add(extrude(aft, [at(s * a), at(s * b)], mat.white, name));
    }
    // Short fixed trailing edge between flap and aileron, and outboard of the aileron.
    root.add(extrude(aft, [at(s * PM.flapSpan[1]), at(s * PM.aileronSpan[0])], mat.white, 'wingTe'));
    root.add(extrude(aft, [at(s * PM.aileronSpan[1]), at(s * w.tipX)], mat.white, 'wingTe'));
  }

  // All-moving stabilator.
  const st = PM.stab;
  const stabAt = (x: number) => (u: number, v: number) => new THREE.Vector3(x, st.y + v * st.chord * (1 - 0.15 * Math.abs(x) / st.span), st.le + u * st.chord * (1 - 0.15 * Math.abs(x) / st.span) + 0.06 * Math.abs(x) / st.span);
  root.add(extrude(naca(0, 0, 0.1, 22), [stabAt(-st.span), stabAt(0), stabAt(st.span)], mat.white, 'elevator'));

  // Fin and rudder.
  const f = PM.fin;
  const finAt = (y: number) => {
    const u0 = (y - f.rootY) / (f.tipY - f.rootY);
    const le = f.rootLe + (f.tipLe - f.rootLe) * u0, c = f.rootChord + (f.tipChord - f.rootChord) * u0;
    return (u: number, v: number) => new THREE.Vector3(v * c, y, le + u * c);
  };
  root.add(extrude(naca(0, 0, 0.1, 24, 0, f.hingeAt - 0.01), [finAt(f.rootY - 0.05), finAt(f.tipY)], mat.white, 'fin'));
  root.add(extrude(naca(0, 0, 0.1, 12, f.hingeAt, 1), [finAt(f.rootY - 0.2), finAt(f.tipY)], mat.white, 'rudder'));
  const finCap = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 6), mat.white);
  finCap.scale.set(0.035, 0.05, f.tipChord * 0.98); finCap.position.set(0, f.tipY, f.tipLe + f.tipChord * 0.5); root.add(finCap);

  // Fixed tricycle gear with wheel fairings.
  const wh = PM.wheels;
  const wheel = (x: number, z: number, r: number) => {
    const g = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.TorusGeometry(r - 0.055, 0.055, 10, 24), mat.tire);
    tire.rotation.y = Math.PI / 2; g.add(tire);
    const hubM = new THREE.Mesh(new THREE.CylinderGeometry(r - 0.06, r - 0.06, 0.09, 16), mat.grey);
    hubM.rotation.z = Math.PI / 2; g.add(hubM);
    const pant = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), mat.white);
    pant.scale.set(0.11, r * 0.85, r * 2.6); pant.position.set(0, 0.045, 0.04); g.add(pant);
    g.position.set(x, wh.groundY + r, z);
    return g;
  };
  for (const s of [-1, 1]) {
    root.add(wheel(s * wh.mainX, wh.mainZ, wh.mainR));
    // Spring-steel leg from the fuselage side to the axle.
    const top = new THREE.Vector3(s * 0.42, -0.46, wh.mainZ), bot = new THREE.Vector3(s * (wh.mainX - 0.08), wh.groundY + wh.mainR + 0.05, wh.mainZ);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.035, top.distanceTo(bot), 0.12), mat.white);
    leg.position.copy(top).add(bot).multiplyScalar(0.5);
    leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(bot).normalize());
    root.add(leg);
  }
  root.add(wheel(0, wh.noseZ, wh.noseR));
  const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.62, 10), mat.grey);
  strut.position.set(0, -0.72, wh.noseZ + 0.02); root.add(strut);

  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return root;
}
