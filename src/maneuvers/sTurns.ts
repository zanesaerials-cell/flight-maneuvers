import type { AircraftProfile } from '../data/aircraft';
import {
  D2R, FT, G, KT, R2D, angDiff, finalize, resample, tasFromIas, wrap360, type RawSample,
} from '../engine/kinematics';
import type { ManeuverRun, Step, Tolerance } from '../engine/types';

const DT = 0.05;

/**
 * S-turns across a road — ACS PA.V.B (ground reference maneuvers).
 *
 * The ground track is two perfect semicircles. Everything else — groundspeed,
 * wind-correction (crab) angle and the bank needed at each point — is solved
 * from the wind, so the steep-on-downwind / shallow-on-upwind pattern falls
 * out of the physics rather than being hand-drawn.
 */
export function buildSTurns(ac: AircraftProfile): ManeuverRun {
  const p = ac.procedures.sTurns;
  if (!p) throw new Error(`${ac.shortName} has no S-turn profile`);

  const R = p.radiusM;
  const altFt = p.groundElevFt + p.aglFt;
  const tas = tasFromIas(p.ias, altFt);
  const tasMs = tas * KT;
  // Wind blows toward (from + 180).
  const wTo = (p.windFromDeg + 180) * D2R;
  const W = { e: Math.sin(wTo) * p.windKt * KT, n: Math.cos(wTo) * p.windKt * KT };
  const downwind = wrap360(p.windFromDeg + 180);

  /** Groundspeed and heading needed to hold a given ground track. */
  const solve = (trackDeg: number) => {
    const u = { e: Math.sin(trackDeg * D2R), n: Math.cos(trackDeg * D2R) };
    const along = W.e * u.e + W.n * u.n;
    const perp = { e: W.e - along * u.e, n: W.n - along * u.n };
    const gs = along + Math.sqrt(tasMs * tasMs - (perp.e ** 2 + perp.n ** 2));
    const va = { e: gs * u.e - W.e, n: gs * u.n - W.n };
    return { gs, heading: wrap360(Math.atan2(va.e, va.n) * R2D) };
  };

  // The road runs perpendicular to the wind, through the origin.
  // The layout below assumes a north wind (downwind = 180); rotate for others later.
  const pts: { t: number; east: number; north: number; heading: number; gs: number }[] = [];
  let t = 0;
  const marks: Record<string, number> = {};

  // Entry leg: straight downwind toward the road.
  const entryLen = 700;
  {
    const { gs, heading } = solve(downwind);
    for (let d = 0; d <= entryLen; d += 2) {
      pts.push({ t, east: 0, north: entryLen - d, heading, gs });
      if (d < entryLen) t += 2 / gs;
    }
  }
  marks.cross1 = t;

  const arc = (center: [number, number], from: number, to: number, dir: -1 | 1) => {
    const dchi = 0.25 * (to > from ? 1 : -1);
    const count = Math.round(Math.abs(to - from) / 0.25);
    for (let i = 1; i <= count; i++) {
      const chi = from + i * dchi;
      const c = chi * D2R;
      // Left turn: position = C + R(cos χ, −sin χ). Right turn: C + R(−cos χ, sin χ).
      const east = center[0] + R * (dir === -1 ? Math.cos(c) : -Math.cos(c));
      const north = center[1] + R * (dir === -1 ? -Math.sin(c) : Math.sin(c));
      const { gs, heading } = solve(wrap360(chi));
      t += (R * Math.abs(dchi) * D2R) / gs;
      pts.push({ t, east, north, heading, gs });
    }
  };

  // First half: downwind side, turning left from downwind (180) through east to upwind (0).
  arc([R, 0], 180, 0, -1);
  marks.cross2 = t;
  // Second half: upwind side, turning right from upwind (0) through east back to downwind (180).
  arc([3 * R, 0], 0, 180, 1);
  marks.cross3 = t;

  // Exit leg downwind.
  {
    const { gs, heading } = solve(downwind);
    for (let d = 2; d <= 600; d += 2) {
      t += 2 / gs;
      pts.push({ t, east: 4 * R, north: -d, heading, gs });
    }
  }

  const rawVar: RawSample[] = pts.map((q) => ({
    t: q.t, east: q.east, north: q.north, altFt, heading: q.heading,
    bank: 0, ias: p.ias, tas, rpm: p.rpm, flaps: 0,
  }));
  const raw = resample(rawVar, DT);

  // Bank required for the heading rate at each instant: tan φ = V·ψ̇ / g.
  const n = raw.length;
  const k = 6;
  const bankRaw = raw.map((_, i) => {
    const a = raw[Math.max(0, i - k)], b = raw[Math.min(n - 1, i + k)];
    const rate = (angDiff(a.heading, b.heading) * D2R) / (b.t - a.t || 1);
    return Math.atan((tasMs * rate) / G) * R2D;
  });
  // Real roll-in takes a second or two; blend across the road crossings.
  const w = 14;
  raw.forEach((r, i) => {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) { s += bankRaw[j]; c++; }
    r.bank = s / c;
  });

  const frames = finalize(raw, ac, { trim: 0.2, cruiseRpm: p.rpm });
  const duration = frames[frames.length - 1].t;

  const inArc = frames.filter((f) => f.t > marks.cross1 + 1 && f.t < marks.cross3 - 1);
  const maxBank = Math.max(...inArc.map((f) => Math.abs(f.bank)));
  const minBankNearCross2 = Math.min(...frames.filter((f) => Math.abs(f.t - marks.cross2) < 3 && Math.abs(f.t - marks.cross2) > 1.2).map((f) => Math.abs(f.bank)));
  const gsDown = solve(downwind).gs / KT;
  const gsUp = solve(p.windFromDeg).gs / KT;
  const crab = Math.max(...inArc.map((f) => Math.abs(angDiff(f.track, f.heading))));
  const mid1 = (marks.cross1 + marks.cross2) / 2;
  const mid2 = (marks.cross2 + marks.cross3) / 2;

  const steps: Step[] = [
    {
      id: 'setup', title: 'Set up downwind toward the road', start: 0, end: marks.cross1,
      detail: [
        'Pick a straight road (or section line) perpendicular to the wind, with emergency landing spots nearby.',
        `Altitude 600–1,000 ft AGL. Shown at ${p.aglFt} ft AGL (${altFt.toLocaleString()} ft MSL).`,
        `Power about ${p.rpm.toLocaleString()} RPM for ${p.ias} KIAS, trimmed for level flight.`,
        `Enter on the downwind side heading ${String(Math.round(downwind)).padStart(3, '0')}° with the ${p.windKt} kt wind at your tail.`,
        'Clear the area before you start.',
      ],
    },
    {
      id: 'cross-1', title: 'Cross the road — steepest bank', start: marks.cross1, end: mid1,
      detail: [
        `Groundspeed is highest here (about ${Math.round(gsDown)} kt), so the bank is steepest — about ${Math.round(maxBank)}°.`,
        'Cross the road wings level, then roll into the left turn immediately.',
        'Coordinated left aileron and left rudder; back pressure to hold altitude.',
      ],
    },
    {
      id: 'shallow', title: 'Shallow the bank as you turn into the wind', start: mid1, end: marks.cross2,
      detail: [
        'As the turn carries you crosswind and then into the wind, groundspeed falls — gradually decrease the bank.',
        `Crabbing into the wind keeps the semicircle round: the nose points up to about ${Math.round(crab)}° into the wind from the ground track.`,
        'Aim to arrive back at the road wings level, heading straight into the wind.',
      ],
    },
    {
      id: 'cross-2', title: 'Cross upwind — shallowest bank, reverse', start: marks.cross2, end: mid2,
      detail: [
        `Groundspeed is lowest here (about ${Math.round(gsUp)} kt), so the bank is shallowest — about ${Math.round(minBankNearCross2)}°.`,
        'Cross the road wings level heading into the wind, then roll into the right turn.',
        'Start with a shallow bank — rolling in too steep here is the most common error.',
      ],
    },
    {
      id: 'steepen', title: 'Steepen the bank as you turn downwind', start: mid2, end: marks.cross3,
      detail: [
        'Groundspeed rises as the tail comes into the wind — progressively steepen the bank.',
        `Back near the road, bank is about ${Math.round(maxBank)}° again; keep it under 45°.`,
        'Hold altitude with back pressure as the bank increases.',
      ],
    },
    {
      id: 'complete', title: 'Cross the road wings level downwind', start: marks.cross3, end: duration,
      detail: [
        'Roll out so the wings are level directly over the road, heading downwind.',
        'Continue the pattern or exit. Altitude and airspeed within standards throughout.',
      ],
    },
  ];

  const window: [number, number][] = [[marks.cross1, marks.cross3]];
  const tolerances: Tolerance[] = [
    {
      id: 'alt', label: 'Altitude', unit: 'ft', standard: '±100 ft',
      value: (f) => f.altFt, target: altFt, minus: 100, plus: 100, windows: window,
    },
    {
      id: 'ias', label: 'Airspeed', unit: 'kt', standard: '±10 kt',
      value: (f) => f.ias, target: p.ias, minus: 10, plus: 10, windows: window,
    },
    {
      id: 'agl', label: 'Height above ground', unit: 'ft', standard: '600–1,000 ft AGL',
      value: (f) => f.altFt - p.groundElevFt, target: 800, minus: 200, plus: 200, windows: window,
    },
    {
      id: 'bank', label: 'Bank', unit: '°', standard: 'No more than 45°',
      value: (f) => Math.abs(f.bank), target: 22.5, minus: 22.5, plus: 22.5, windows: window,
    },
  ];

  return {
    id: 's-turns',
    title: 'S-Turns',
    acsCode: 'PA.V.B',
    acsTask: 'Area V, Task B',
    objective: 'Two equal half-circles either side of a road, correcting for wind so the ground track stays round.',
    frames, dt: DT, duration, steps, tolerances,
    scene: {
      groundElevFt: p.groundElevFt,
      roads: [{ from: [-2500, 0], to: [4000, 0], width: 10 }],
      frameRadius: Math.max(2.4 * R, 700),
      frameCenter: [2 * R, 0],
      wind: { fromDeg: p.windFromDeg, kt: p.windKt },
    },
    bugs: { altitudeFt: altFt, heading: downwind, ias: p.ias },
    notes: [
      `Wind ${String(p.windFromDeg).padStart(3, '0')}° at ${p.windKt} kt. The magenta line is the ground track; the shadow shows it on the ground.`,
      `Ground-track radius ${Math.round(R / FT).toLocaleString()} ft, chosen so the steepest bank stays under 45°.`,
    ],
  };
}
