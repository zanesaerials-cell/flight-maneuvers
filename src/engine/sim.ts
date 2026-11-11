import type { AircraftProfile } from '../data/aircraft';
import type { AirportDef } from '../data/airports';
import {
  D2R, FT, G, KT, R2D, angDiff, clamp, ease, finalize, tasFromIas, wrap360, type RawSample,
} from './kinematics';
import type { Frame } from './types';

export const SIM_DT = 0.05;
export type V2 = { e: number; n: number };
export const dirVec = (deg: number): V2 => ({ e: Math.sin(deg * D2R), n: Math.cos(deg * D2R) });

/** Runway geometry for one landing/takeoff direction, scene origin at the runway centre. */
export function runwayFrame(apt: AirportDef, end: string) {
  const rwy = apt.runways[0];
  const low = rwy.ends[0] === end;
  const hdg = wrap360(low ? rwy.magHeading : rwy.magHeading + 180);
  const L = rwy.lengthFt * FT;
  const u = dirVec(hdg);
  const traffic = apt.traffic[end] ?? 'left';
  const side = dirVec(hdg + (traffic === 'left' ? -90 : 90));
  return {
    rwy, hdg, L, u, side, traffic,
    threshold: -L / 2,
    departEnd: L / 2,
    along: (q: V2) => q.e * u.e + q.n * u.n,
    lateral: (q: V2) => q.e * side.e + q.n * side.n,
    at: (along: number, lat = 0): V2 => ({ e: u.e * along + side.e * lat, n: u.n * along + side.n * lat }),
    scene: { center: [0, 0] as [number, number], heading: rwy.magHeading, lengthM: L, widthM: rwy.widthFt * FT, ends: rwy.ends },
  };
}

export interface SimStart {
  east: number; north: number; hdg: number; altFt: number; elevFt: number;
  ias: number; rpm: number; flaps: number; onGround: boolean; throttle: number; trim: number;
}

/**
 * A scripted flight: the script sets targets (speed, power, flaps, vertical
 * speed, bank) and advances time; the sim moves the airplane and records
 * frames. Everything is deterministic, so a maneuver always flies the same.
 */
export class Sim {
  readonly ac: AircraftProfile;
  readonly elev: number;
  s: {
    t: number; e: number; n: number; hdg: number; bank: number; ias: number; rpm: number; flaps: number;
    alt: number; vs: number; dist: number; throttle: number; trim: number;
    elevBias: number; rudderBias: number; aileronBias: number; slip: number;
    onGround: boolean; pitch?: number; warn?: string;
    /** Heading minus track, held without turning (forward slip). */
    yaw: number; noTurn: boolean;
  };
  tgt: { ias: number; accel: number; flaps: number; rpm: number; throttle: number; trim: number; vs: number; vsRate: number };
  raw: RawSample[] = [];
  ground: boolean[] = [];
  marks: Record<string, number> = {};
  rollTime = 2.5;

  constructor(ac: AircraftProfile, st: SimStart) {
    this.ac = ac;
    this.elev = st.elevFt;
    this.s = {
      t: 0, e: st.east, n: st.north, hdg: st.hdg, bank: 0, ias: st.ias, rpm: st.rpm, flaps: st.flaps,
      alt: st.altFt, vs: 0, dist: 0, throttle: st.throttle, trim: st.trim,
      elevBias: 0, rudderBias: 0, aileronBias: 0, slip: 0, onGround: st.onGround, yaw: 0, noTurn: false,
    };
    this.tgt = { ias: st.ias, accel: 1, flaps: st.flaps, rpm: st.rpm, throttle: st.throttle, trim: st.trim, vs: 0, vsRate: 250 };
    this.record();
  }

  get agl() { return this.s.alt - this.elev; }
  pos(): V2 { return { e: this.s.e, n: this.s.n }; }
  mark(k: string) { this.marks[k] = this.s.t; }

  private approach(cur: number, tgt: number, rate: number) { return cur + clamp(tgt - cur, -rate * SIM_DT, rate * SIM_DT); }

  record() {
    const s = this.s;
    this.raw.push({
      t: s.t, east: s.e, north: s.n, altFt: s.alt, heading: wrap360(s.hdg), bank: s.bank,
      ias: s.ias, tas: tasFromIas(s.ias, s.alt), rpm: s.rpm, flaps: s.flaps,
      throttle: s.throttle, trim: s.trim, elevBias: s.elevBias, rudderBias: s.rudderBias,
      aileronBias: s.aileronBias, slip: s.slip,
      ...(s.pitch !== undefined ? { pitch: s.pitch } : {}),
      ...(s.warn ? { warn: s.warn } : {}),
    });
    this.ground.push(s.onGround);
  }

  /** One time step. On the ground, pass the longitudinal acceleration (m/s²). */
  tick(groundAccel?: number) {
    const s = this.s, g = this.tgt;
    if (groundAccel !== undefined) s.ias = Math.max(0, s.ias + (groundAccel / KT) * SIM_DT);
    else s.ias = this.approach(s.ias, g.ias, g.accel);
    s.flaps = this.approach(s.flaps, g.flaps, 3);
    s.rpm = this.approach(s.rpm, g.rpm, 300);
    s.throttle = this.approach(s.throttle, g.throttle, 0.6);
    s.trim = this.approach(s.trim, g.trim, 0.15);
    if (!s.onGround) {
      s.vs = this.approach(s.vs, g.vs, g.vsRate);
      s.alt += (s.vs / 60) * SIM_DT;
    }
    const tasMs = Math.max(0.1, tasFromIas(s.ias, s.alt) * KT);
    if (!s.onGround && !s.noTurn && Math.abs(s.bank) > 0.01) {
      s.hdg += (G * Math.tan(s.bank * D2R) / tasMs) * R2D * SIM_DT;
    }
    const gs = tasMs * Math.cos(Math.atan2((s.vs * FT) / 60, tasMs));
    const track = s.hdg - s.yaw;
    s.e += Math.sin(track * D2R) * gs * SIM_DT;
    s.n += Math.cos(track * D2R) * gs * SIM_DT;
    s.dist += gs * SIM_DT;
    s.t += SIM_DT;
    this.record();
  }

  /** Advance until the condition is true (each step runs `during` first). */
  until(cond: () => boolean, during?: () => void, maxSec = 600) {
    const t0 = this.s.t;
    while (!cond() && this.s.t - t0 < maxSec) { during?.(); this.tick(); }
  }
  for(sec: number, during?: () => void) {
    const end = this.s.t + sec;
    while (this.s.t < end - 1e-9) { during?.(); this.tick(); }
  }

  /** Smoothly change bank to `to` over `sec`. */
  rollTo(to: number, sec = this.rollTime, during?: () => void) {
    const from = this.s.bank, t0 = this.s.t;
    while (this.s.t - t0 < sec) { this.s.bank = from + (to - from) * ease((this.s.t - t0 + SIM_DT) / sec); during?.(); this.tick(); }
    this.s.bank = to;
  }

  /** Heading change used up rolling out from `bank` — start the rollout this early. */
  rolloutLead(bank: number) {
    const v = tasFromIas(this.s.ias, this.s.alt) * KT;
    let h = 0;
    for (let t = 0; t < this.rollTime; t += SIM_DT) h += (G * Math.tan(Math.abs(bank) * (1 - ease(t / this.rollTime)) * D2R) / v) * R2D * SIM_DT;
    return h;
  }

  /** Coordinated turn to a heading at `bank` degrees (direction picked automatically unless given). */
  turnTo(hdg: number, bank: number, during?: () => void, dir?: -1 | 1) {
    const sg = Math.sign(angDiff(this.s.hdg, hdg));
    const d: -1 | 1 = dir ?? (sg < 0 ? -1 : 1);
    const b = Math.abs(bank) * d;
    this.rollTo(b, this.rollTime, during);
    let turned = 0;
    const need = () => {
      const diff = angDiff(this.s.hdg, hdg) * d;
      return diff < 0 ? diff + 360 : diff;
    };
    // Guard against an immediate stop when the target is almost behind the start.
    while (need() > this.rolloutLead(b) || turned < 5) {
      const h0 = this.s.hdg;
      during?.(); this.tick();
      turned += Math.abs(this.s.hdg - h0);
      if (turned > 720) break;
    }
    this.rollTo(0, this.rollTime, during);
    this.s.hdg = wrap360(this.s.hdg);
  }

  /** Vertical-speed law that captures an altitude, starting the level-off ~10 % of VSI early. */
  holdAlt(altFt: number, maxFpm = 700, captureFt = 70) {
    const toGo = altFt - this.s.alt;
    const rate = Math.abs(toGo) > captureFt ? maxFpm : maxFpm * (Math.abs(toGo) / captureFt);
    this.tgt.vs = Math.sign(toGo) * rate;
  }

  /** Build frames; pitch is smoothed so overrides blend into the computed attitude. */
  build(cruiseRpm: number): Frame[] {
    const frames = finalize(this.raw, this.ac, { trim: 0, cruiseRpm });
    const n = frames.length, w = 6;
    const p = frames.map((f) => f.pitch);
    frames.forEach((f, i) => {
      let sum = 0, cnt = 0;
      for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) { sum += p[j]; cnt++; }
      f.pitch = sum / cnt;
      if (this.ground[i]) { f.vsi = 0; f.loadFactor = 1; }
    });
    return frames;
  }
}

/** Glide-path law for an approach: vertical speed that tracks a path to the aim point, then flares. */
export function approachLaw(sim: Sim, distToAimM: number, pathDeg: number, flareFt = 15, flareGain = 25, touchdownFpm = 80) {
  const s = sim.s;
  const gsMs = tasFromIas(s.ias, s.alt) * KT;
  const hPath = Math.max(0, distToAimM) * Math.tan(pathDeg * D2R) / FT;
  const h = sim.agl;
  if (h > flareFt) {
    const vPath = -gsMs * Math.tan(pathDeg * D2R) / FT * 60;
    sim.tgt.vs = clamp(vPath + (hPath - h) * 6, -1200, 300);
    sim.tgt.vsRate = 200;
  } else {
    // Round-out: sink rate shrinks with height so the mains touch gently (about 4 s from 15 ft).
    sim.tgt.vs = -(h * flareGain + touchdownFpm);
    sim.tgt.vsRate = 450;
  }
}
