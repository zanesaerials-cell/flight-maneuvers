import { pwT, type AircraftProfile } from '../data/aircraft';
import {
  D2R, FT, G, KT, R2D, angDiff, finalize, resample, tasFromIas, wrap360, type RawSample,
} from '../engine/kinematics';
import type { ManeuverRun, Step, Tolerance } from '../engine/types';

const DT = 0.05;

/**
 * Ground-reference maneuvers flown along an exact ground track in wind.
 * The track is built from straight legs and constant-radius arcs; groundspeed,
 * crab angle and the bank needed at each point are solved from the wind triangle.
 */
export class TrackBuilder {
  pts: { t: number; e: number; n: number; hdg: number; gs: number }[] = [];
  t = 0;
  e: number; n: number; track: number;
  private W: { e: number; n: number };
  private tasMs: number;
  marks: Record<string, number> = {};

  constructor(start: { e: number; n: number; track: number }, windFrom: number, windKt: number, tasKt: number) {
    this.e = start.e; this.n = start.n; this.track = start.track;
    const to = (windFrom + 180) * D2R;
    this.W = { e: Math.sin(to) * windKt * KT, n: Math.cos(to) * windKt * KT };
    this.tasMs = tasKt * KT;
    this.push();
  }

  solve(track: number) {
    const u = { e: Math.sin(track * D2R), n: Math.cos(track * D2R) };
    const along = this.W.e * u.e + this.W.n * u.n;
    const perp = { e: this.W.e - along * u.e, n: this.W.n - along * u.n };
    const gs = along + Math.sqrt(this.tasMs ** 2 - (perp.e ** 2 + perp.n ** 2));
    const va = { e: gs * u.e - this.W.e, n: gs * u.n - this.W.n };
    return { gs, hdg: wrap360(Math.atan2(va.e, va.n) * R2D) };
  }
  private push() { const { gs, hdg } = this.solve(this.track); this.pts.push({ t: this.t, e: this.e, n: this.n, hdg, gs }); }
  mark(k: string) { this.marks[k] = this.t; }

  straight(len: number) {
    const step = 2;
    const { gs } = this.solve(this.track);
    for (let d = step; d <= len + 1e-6; d += step) {
      this.e += Math.sin(this.track * D2R) * step;
      this.n += Math.cos(this.track * D2R) * step;
      this.t += step / gs;
      this.push();
    }
  }

  /** Constant-radius arc; dir −1 = left, +1 = right. */
  arc(radius: number, turnDeg: number, dir: -1 | 1) {
    const toCenter = this.track + dir * 90;
    const c = { e: this.e + Math.sin(toCenter * D2R) * radius, n: this.n + Math.cos(toCenter * D2R) * radius };
    const step = 0.25;
    const count = Math.round(turnDeg / step);
    for (let i = 1; i <= count; i++) {
      this.track += dir * step;
      const back = this.track - dir * 90;
      const { gs } = this.solve(this.track);
      this.e = c.e + Math.sin(back * D2R) * radius;
      this.n = c.n + Math.cos(back * D2R) * radius;
      this.t += (radius * step * D2R) / gs;
      this.push();
    }
    this.track = wrap360(this.track);
  }

  /** Raw samples on a fixed time grid with bank solved from heading rate (tan φ = V·ψ̇/g). */
  toRaw(alt: number | ((q: { t: number; gs: number }) => number), ias: number, rpm: number, gear = 1): RawSample[] {
    const tas = this.tasMs / KT;
    const altOf = typeof alt === 'number' ? () => alt : alt;
    const rawVar: RawSample[] = this.pts.map((q) => ({ t: q.t, east: q.e, north: q.n, altFt: altOf(q), heading: q.hdg, bank: 0, ias, tas, rpm, flaps: 0, gear }));
    const raw = resample(rawVar, DT);
    const n = raw.length, k = 6;
    const bankRaw = raw.map((_, i) => {
      const a = raw[Math.max(0, i - k)], b = raw[Math.min(n - 1, i + k)];
      return Math.atan((this.tasMs * (angDiff(a.heading, b.heading) * D2R) / (b.t - a.t || 1)) / G) * R2D;
    });
    const w = 14;
    raw.forEach((r, i) => {
      let s = 0, c = 0;
      for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) { s += bankRaw[j]; c++; }
      r.bank = s / c;
    });
    return raw;
  }
}

function common(ac: AircraftProfile) {
  const p = ac.procedures.sTurns;
  if (!p) throw new Error(`${ac.shortName} has no ground-reference profile`);
  const altFt = p.groundElevFt + p.aglFt;
  return { p, altFt, tas: tasFromIas(p.ias, altFt) };
}

export function grTolerances(altFt: number, ias: number, window: [number, number][]): Tolerance[] {
  return [
    { id: 'alt', label: 'Altitude', unit: 'ft', standard: '±100 ft', value: (f) => f.altFt, target: altFt, minus: 100, plus: 100, windows: window },
    { id: 'ias', label: 'Airspeed', unit: 'kt', standard: '±10 kt', value: (f) => f.ias, target: ias, minus: 10, plus: 10, windows: window },
    { id: 'bank', label: 'Bank', unit: '°', standard: 'No more than 45°', value: (f) => Math.abs(f.bank), target: 22.5, minus: 22.5, plus: 22.5, windows: window },
  ];
}

export const hdg3 = (h: number) => String(Math.round(wrap360(h)) || 360).padStart(3, '0');

// ─────────────────────────────────────────────────────────────── Rectangular course
export function buildRectangularCourse(ac: AircraftProfile): ManeuverRun {
  const { p, altFt, tas } = common(ac);
  // Field 1,200 m east–west × 800 m north–south; fly ¼ nm outside its edges, left turns.
  const fw = 1200, fh = 800, off = 460, r = 400;
  const west = -fw / 2 - off, east = fw / 2 + off, south = -fh / 2 - off, north = fh / 2 + off;
  // Enter on a 45° to the downwind leg, then fly the full rectangle once and a bit.
  // Start so the 45° entry turn rolls out exactly on the downwind leg (x = west).
  const r0 = 320, entryLen = 600;
  const startE = west - (1 - Math.SQRT1_2) * r0 - entryLen * Math.SQRT1_2;
  const tb = new TrackBuilder({ e: startE, n: north + 1300, track: 135 }, p.windFromDeg, p.windKt, tas);
  tb.straight(entryLen);
  tb.arc(r0, 45, 1);                            // right turn onto the downwind leg (track 180)
  tb.mark('downwind');
  tb.straight(Math.max(50, (tb.n - (south + r))));
  tb.mark('turnBase');
  tb.arc(r, 90, -1);
  tb.mark('base');
  tb.straight(Math.max(50, (east - r) - tb.e));
  tb.mark('turnFinal');
  tb.arc(r, 90, -1);
  tb.mark('final');
  tb.straight(Math.max(50, (north - r) - tb.n));
  tb.mark('turnCross');
  tb.arc(r, 90, -1);
  tb.mark('cross');
  tb.straight(Math.max(50, tb.e - (west + r)));
  tb.mark('turnDown');
  tb.arc(r, 90, -1);
  tb.mark('downwind2');
  tb.straight(900);
  tb.mark('end');

  const raw = tb.toRaw(altFt, p.ias, p.rpm);
  const frames = finalize(raw, ac, { trim: 0.2, cruiseRpm: p.rpm });
  const duration = frames[frames.length - 1].t;
  const m = tb.marks;
  const crab = (t0: number, t1: number) => Math.max(...frames.filter((f) => f.t > t0 + 2 && f.t < t1 - 2).map((f) => Math.abs(angDiff(f.track, f.heading))));
  const bankIn = (t0: number, t1: number) => Math.max(...frames.filter((f) => f.t > t0 && f.t < t1).map((f) => Math.abs(f.bank)));
  const steps: Step[] = [
    { id: 'entry', title: 'Enter at 45° to the downwind leg', start: 0, end: m.downwind, detail: [
      `Pick a rectangular field with emergency landing options; ${p.aglFt} ft AGL (600–1,000 ft).`,
      `${p.ias} KIAS, about ${pwT(ac, p.rpm)}. Wind ${hdg3(p.windFromDeg)}° at ${p.windKt} kt.`,
      'Fly about ¼ mile outside the field boundary, as in a traffic pattern. Clear the area.',
    ] },
    { id: 'downwind', title: 'Downwind leg', start: m.downwind, end: m.turnBase, detail: [
      'Tailwind: groundspeed is highest. No crab needed with the wind straight behind you.',
      'Keep the same distance from the field edge all the way down.',
    ] },
    { id: 'base-turn', title: 'Turn to base — steepest bank', start: m.turnBase, end: m.base, detail: [
      `Highest groundspeed going in, so the steepest bank of the course: about ${Math.round(bankIn(m.turnBase, m.base))}°.`,
      'Turn more than 90° — roll out crabbed into the wind.',
    ] },
    { id: 'base', title: 'Base leg — crab into the wind', start: m.base, end: m.turnFinal, detail: [
      `Crosswind from the left: the nose points about ${Math.round(crab(m.base, m.turnFinal))}° into the wind to hold the track.`,
    ] },
    { id: 'final-turn', title: 'Turn upwind — medium to shallow', start: m.turnFinal, end: m.final, detail: [
      'Groundspeed falls as you turn into the wind — reduce bank through the turn.',
      'Turn less than 90°, since you are already crabbed.',
    ] },
    { id: 'upwind', title: 'Upwind leg', start: m.final, end: m.turnCross, detail: [
      'Headwind: groundspeed is lowest; no crab.',
    ] },
    { id: 'cross-turn', title: 'Turn crosswind — shallowest bank', start: m.turnCross, end: m.cross, detail: [
      `Lowest groundspeed, so the shallowest bank: about ${Math.round(bankIn(m.turnCross, m.cross))}°.`,
      'Turn less than 90° and roll out crabbed into the wind.',
    ] },
    { id: 'cross', title: 'Crosswind leg — crab into the wind', start: m.cross, end: m.turnDown, detail: [
      `Wind from the right now: nose about ${Math.round(crab(m.cross, m.turnDown))}° right of the track.`,
    ] },
    { id: 'down-turn', title: 'Turn downwind — bank increasing', start: m.turnDown, end: m.downwind2, detail: [
      'Groundspeed increases as the tail swings into the wind — steepen the bank to keep the corner square.',
      'Turn more than 90° to come off the crab.',
    ] },
    { id: 'done', title: 'Back on downwind', start: m.downwind2, end: duration, detail: ['Continue around or exit. Altitude and airspeed within standards throughout.'] },
  ];
  const window: [number, number][] = [[m.downwind, m.end]];
  return {
    id: 'rectangular-course', title: 'Rectangular Course', acsCode: 'PA.V.B', acsTask: 'Area V, Task B',
    objective: 'Fly a constant distance outside a rectangular field, correcting for wind on every leg and adjusting bank in every corner.',
    frames, dt: DT, duration, steps, tolerances: grTolerances(altFt, p.ias, window),
    scene: {
      groundElevFt: p.groundElevFt,
      roads: [
        { from: [-fw / 2, -fh / 2], to: [fw / 2, -fh / 2], width: 6 }, { from: [fw / 2, -fh / 2], to: [fw / 2, fh / 2], width: 6 },
        { from: [fw / 2, fh / 2], to: [-fw / 2, fh / 2], width: 6 }, { from: [-fw / 2, fh / 2], to: [-fw / 2, -fh / 2], width: 6 },
      ],
      markers: [{ east: 0, north: 0, kind: 'field', width: fw, length: fh, heading: 0 }],
      frameRadius: Math.max(east - west, north - south) / 2 * 1.25,
      frameCenter: [0, 120],
      wind: { fromDeg: p.windFromDeg, kt: p.windKt },
    },
    bugs: { altitudeFt: altFt, heading: 180, ias: p.ias },
    notes: [`Wind ${hdg3(p.windFromDeg)}° at ${p.windKt} kt. The field's edges are drawn as roads.`],
  };
}

// ─────────────────────────────────────────────────────────────── Turns around a point
export function buildTurnsAroundPoint(ac: AircraftProfile): ManeuverRun {
  const { p, altFt, tas } = common(ac);
  const R = p.radiusM;
  const downwind = wrap360(p.windFromDeg + 180);
  // Enter downwind with the point off the left wing; two full left turns.
  const tb = new TrackBuilder({ e: -R, n: 700, track: downwind }, p.windFromDeg, p.windKt, tas);
  tb.straight(700);
  tb.mark('enter');
  tb.arc(R, 90, -1); tb.mark('q1');
  tb.arc(R, 90, -1); tb.mark('q2');
  tb.arc(R, 90, -1); tb.mark('q3');
  tb.arc(R, 90, -1); tb.mark('lap1');
  tb.arc(R, 360, -1); tb.mark('lap2');
  tb.straight(600);
  const raw = tb.toRaw(altFt, p.ias, p.rpm);
  const frames = finalize(raw, ac, { trim: 0.2, cruiseRpm: p.rpm });
  const duration = frames[frames.length - 1].t;
  const m = tb.marks;
  const inArc = frames.filter((f) => f.t > m.enter + 2 && f.t < m.lap2 - 2);
  const maxB = Math.max(...inArc.map((f) => Math.abs(f.bank))), minB = Math.min(...inArc.map((f) => Math.abs(f.bank)));
  const maxCrab = Math.max(...inArc.map((f) => Math.abs(angDiff(f.track, f.heading))));
  const steps: Step[] = [
    { id: 'entry', title: 'Enter downwind, point off the left wing', start: 0, end: m.enter, detail: [
      `Pick a prominent point (a silo here) with landing options nearby; ${p.aglFt} ft AGL.`,
      `${p.ias} KIAS, about ${pwT(ac, p.rpm)}. Wind ${hdg3(p.windFromDeg)}° at ${p.windKt} kt.`,
      `Enter on the downwind side so the first bank is the steepest. Radius about ${Math.round(R / FT).toLocaleString()} ft.`,
    ] },
    { id: 'downwind', title: 'Abeam the point downwind — steepest bank', start: m.enter, end: m.q1, detail: [
      `Highest groundspeed: steepest bank, about ${Math.round(maxB)}°.`,
      'Shallow the bank as the turn carries you crosswind.',
    ] },
    { id: 'crosswind1', title: 'Crosswind — crab toward the point', start: m.q1, end: m.q2, detail: [
      `Wind pushes you away from the point: nose angled up to about ${Math.round(maxCrab)}° toward the wind.`,
      'Bank continues to decrease as groundspeed drops.',
    ] },
    { id: 'upwind', title: 'Upwind — shallowest bank', start: m.q2, end: m.q3, detail: [
      `Lowest groundspeed: shallowest bank, about ${Math.round(minB)}°.`,
      'Then start increasing bank as you turn back downwind.',
    ] },
    { id: 'crosswind2', title: 'Crosswind — steepen the bank', start: m.q3, end: m.lap1, detail: [
      'Wind now pushes you toward the point: crab outward and steepen the bank as groundspeed builds.',
    ] },
    { id: 'lap2', title: 'Second turn', start: m.lap1, end: m.lap2, detail: [
      'Same pattern: steep downwind, shallow upwind, constant radius over the ground.',
      'Divide attention: the point, the altimeter, and traffic.',
    ] },
    { id: 'exit', title: 'Exit on the entry heading', start: m.lap2, end: duration, detail: ['Roll out on the downwind heading and clear the area.'] },
  ];
  const window: [number, number][] = [[m.enter, m.lap2]];
  return {
    id: 'turns-around-point', title: 'Turns Around a Point', acsCode: 'PA.V.B', acsTask: 'Area V, Task B',
    objective: 'Constant-radius circles around a ground point, varying bank with groundspeed and crabbing to correct for wind drift.',
    frames, dt: DT, duration, steps, tolerances: grTolerances(altFt, p.ias, window),
    scene: {
      groundElevFt: p.groundElevFt, roads: [],
      markers: [{ east: 0, north: 0, kind: 'silo', label: 'Point' }],
      frameRadius: R * 2.2, frameCenter: [0, 150],
      wind: { fromDeg: p.windFromDeg, kt: p.windKt },
    },
    bugs: { altitudeFt: altFt, heading: downwind, ias: p.ias },
    notes: [`Wind ${hdg3(p.windFromDeg)}° at ${p.windKt} kt. The shadow line shows the circle over the ground.`],
  };
}
