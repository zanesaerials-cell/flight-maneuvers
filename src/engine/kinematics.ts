import type { AircraftProfile } from '../data/aircraft';
import type { ControlState, Frame } from './types';

export const G = 9.80665;
export const KT = 0.514444;       // m/s per knot
export const FT = 0.3048;         // m per foot
export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
export const wrap360 = (d: number) => ((d % 360) + 360) % 360;
/** Signed shortest difference b − a, in (−180, 180]. */
export const angDiff = (a: number, b: number) => {
  const d = wrap360(b - a);
  return d > 180 ? d - 360 : d;
};
export const lerpAngle = (a: number, b: number, u: number) => wrap360(a + angDiff(a, b) * u);
export const smoothstep = (e0: number, e1: number, x: number) => {
  const u = clamp((x - e0) / (e1 - e0), 0, 1);
  return u * u * (3 - 2 * u);
};
/** Cosine ease 0→1. */
export const ease = (u: number) => (1 - Math.cos(Math.PI * clamp(u, 0, 1))) / 2;

/** True airspeed from indicated, standard day, ~2 % per 1,000 ft. */
export const tasFromIas = (ias: number, altFt: number) => ias * (1 + 0.02 * (altFt / 1000));

/** Raw kinematic sample produced by a maneuver script before controls are derived. */
export interface RawSample {
  t: number;
  east: number;
  north: number;
  altFt: number;
  heading: number;
  bank: number;
  ias: number;
  tas: number;
  rpm: number;
  flaps: number;
}

export interface FinalizeOptions {
  trim: number;
  cruiseRpm: number;
}

/**
 * Turns raw kinematics into full frames: pitch attitude, load factor,
 * vertical speed, ground track and — most importantly for students —
 * the control inputs that produce that motion.
 */
export function finalize(raw: RawSample[], ac: AircraftProfile, opts: FinalizeOptions): Frame[] {
  const n = raw.length;
  const d = (i: number, f: (s: RawSample) => number, angular = false) => {
    const a = raw[Math.max(0, i - 1)];
    const b = raw[Math.min(n - 1, i + 1)];
    const dt = b.t - a.t || 1;
    return (angular ? angDiff(f(a), f(b)) : f(b) - f(a)) / dt;
  };

  const frames: Frame[] = raw.map((s, i) => {
    const ve = d(i, (r) => r.east);
    const vn = d(i, (r) => r.north);
    const gsMs = Math.hypot(ve, vn);
    const track = gsMs > 0.5 ? wrap360(Math.atan2(ve, vn) * R2D) : s.heading;
    const vsi = (d(i, (r) => r.altFt) * 60);
    const turnRate = d(i, (r) => r.heading, true);
    const rollRate = d(i, (r) => r.bank);
    const loadFactor = 1 / Math.cos(s.bank * D2R);

    // Pitch attitude: level-flight attitude for the speed/flap setting,
    // plus the extra angle of attack a bank demands, plus any climb angle.
    const levelPitch = 1.5 + (95 - s.ias) * 0.15 - s.flaps * 0.08;
    const aoaInTurn = 3.0 * (loadFactor - 1) / (Math.SQRT2 - 1);
    const climb = Math.atan2(vsi * FT / 60, s.tas * KT) * R2D;
    const pitch = levelPitch + aoaInTurn + climb;

    const powerAbove = (s.rpm - opts.cruiseRpm) / 100;
    const c: ControlState = {
      // Roll rate needs aileron; once established in a steep bank a little
      // opposite aileron stops the overbanking tendency.
      aileron: clamp(rollRate / 22, -1, 1) - Math.sign(s.bank) * 0.07 * smoothstep(25, 45, Math.abs(s.bank)),
      // Back pressure to make the extra lift a bank demands.
      elevator: clamp(0.55 * (loadFactor - 1) + vsi / 4000, -1, 1),
      // Rudder with aileron to cancel adverse yaw, plus a touch of right
      // rudder when power comes up (P-factor / slipstream).
      rudder: clamp(rollRate / 30 + 0.05 * powerAbove, -1, 1),
      throttle: clamp((s.rpm - ac.rpm.idle) / (ac.rpm.max - ac.rpm.idle), 0, 1),
      mixture: 1,
      flaps: s.flaps,
      trim: opts.trim,
    };

    return {
      t: s.t, east: s.east, north: s.north, altFt: s.altFt,
      heading: wrap360(s.heading), track, pitch, bank: s.bank, slip: 0,
      ias: s.ias, tas: s.tas, gs: gsMs / KT, vsi, rpm: s.rpm,
      turnRate, loadFactor, c,
    };
  });

  // Gentle smoothing of control inputs so the yoke and pedals move like hands and feet.
  const win = 4;
  const keys: (keyof ControlState)[] = ['aileron', 'elevator', 'rudder'];
  const smoothed = frames.map((f, i) => {
    const c = { ...f.c };
    for (const k of keys) {
      let sum = 0, cnt = 0;
      for (let j = Math.max(0, i - win); j <= Math.min(n - 1, i + win); j++) { sum += frames[j].c[k]; cnt++; }
      c[k] = sum / cnt;
    }
    return c;
  });
  frames.forEach((f, i) => { f.c = smoothed[i]; });
  return frames;
}

/** Interpolated frame at time t. */
export function sampleAt(frames: Frame[], dt: number, t: number): Frame {
  const last = frames.length - 1;
  const x = clamp(t / dt, 0, last);
  const i = Math.min(Math.floor(x), last - 1);
  const u = x - i;
  const a = frames[i];
  const b = frames[i + 1] ?? a;
  const L = (k: keyof Frame) => lerp(a[k] as number, b[k] as number, u);
  const c = {} as ControlState;
  (Object.keys(a.c) as (keyof ControlState)[]).forEach((k) => { c[k] = lerp(a.c[k], b.c[k], u); });
  return {
    t,
    east: L('east'), north: L('north'), altFt: L('altFt'),
    heading: lerpAngle(a.heading, b.heading, u),
    track: lerpAngle(a.track, b.track, u),
    pitch: L('pitch'), bank: L('bank'), slip: L('slip'),
    ias: L('ias'), tas: L('tas'), gs: L('gs'), vsi: L('vsi'), rpm: L('rpm'),
    turnRate: L('turnRate'), loadFactor: L('loadFactor'), c,
  };
}

/** Resample a variable-step series onto a fixed dt grid (linear, angle-aware). */
export function resample(samples: RawSample[], dt: number): RawSample[] {
  const out: RawSample[] = [];
  const end = samples[samples.length - 1].t;
  let j = 0;
  for (let t = 0; t <= end + 1e-9; t += dt) {
    while (j < samples.length - 2 && samples[j + 1].t < t) j++;
    const a = samples[j], b = samples[j + 1] ?? a;
    const u = b.t > a.t ? clamp((t - a.t) / (b.t - a.t), 0, 1) : 0;
    out.push({
      t,
      east: lerp(a.east, b.east, u), north: lerp(a.north, b.north, u),
      altFt: lerp(a.altFt, b.altFt, u), heading: lerpAngle(a.heading, b.heading, u),
      bank: lerp(a.bank, b.bank, u), ias: lerp(a.ias, b.ias, u), tas: lerp(a.tas, b.tas, u),
      rpm: lerp(a.rpm, b.rpm, u), flaps: lerp(a.flaps, b.flaps, u),
    });
  }
  return out;
}
