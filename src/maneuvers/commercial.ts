import { fullPower, fl, fullFlaps, pwT, type AircraftProfile, type Cert } from '../data/aircraft';
import {
  D2R, FT, G, KT, angDiff, finalize, lerp, levelPitch, smoothstep, tasFromIas, wrap360,
} from '../engine/kinematics';
import { Sim, runwayFrame } from '../engine/sim';
import type { ManeuverRun, Step, Tolerance } from '../engine/types';
import { airworkRun, cruiseSim, setupText } from './airwork';
import { TrackBuilder, hdg3 } from './groundTrack';
import { APT, END, finalToStop, run, tdTolerance } from './takeoffLanding';

/*
 * Commercial Pilot maneuvers. Technique follows the school's ASEL Maneuvers
 * Guide; speeds and power come from the aircraft profile.
 */

const n = (x: number) => Math.round(x).toLocaleString();

function needs(ac: AircraftProfile) {
  const p = ac.procedures.pattern, q = ac.procedures.perf;
  if (!p || !q) throw new Error(`${ac.shortName} has no commercial profile`);
  return { p, q };
}
const turned = (from: number, sim: Sim, dir: 1 | -1) => {
  const d = angDiff(from, sim.s.hdg) * dir;
  return d < -5 ? d + 360 : d;
};

// ─────────────────────────────────────────────────────────────── Chandelle
export function buildChandelle(ac: AircraftProfile, _cert: Cert = 'commercial'): ManeuverRun {
  const { q } = needs(ac);
  const alt = q.airworkAltFt, entry = ac.cruiseKias, endKias = q.stallCleanKias + 6, maxPitch = 12.5;
  const sim = cruiseSim(ac, alt, q.airworkGroundFt, 360);
  const s = sim.s;
  const dir = -1 as const;                        // left chandelle
  const pLevel = levelPitch(ac, entry, 0);
  sim.for(5, () => sim.holdAlt(alt, 500));
  sim.mark('roll');
  sim.power(fullPower(ac));
  sim.tgt.accel = 6; sim.tgt.vsRate = 400;
  sim.rollTo(30 * dir, 3, () => { s.pitch = lerp(pLevel, pLevel + 2, smoothstep(0, 3, s.t - sim.marks.roll)); sim.tgt.vs = 200; });
  sim.mark('first');
  // First 90°: constant 30° bank, pitch increasing steadily to its maximum.
  sim.until(() => turned(360, sim, dir) >= 90, () => {
    const u = Math.min(1, turned(360, sim, dir) / 90);
    s.bank = 30 * dir;
    s.pitch = lerp(pLevel + 2, maxPitch, u);
    sim.tgt.ias = lerp(entry, entry - (entry - endKias) * 0.55, u);
    sim.tgt.vs = lerp(300, 950, u);
    s.rudderBias = 0.12 * u;
  });
  sim.mark('second');
  // Second 90°: pitch held, bank rolled out at a constant rate, speed decaying to just above the stall.
  sim.until(() => turned(360, sim, dir) >= 178, () => {
    const u = Math.min(1, (turned(360, sim, dir) - 90) / 90);
    s.bank = Math.min(-5, 30 * dir * (1 - u));
    s.pitch = maxPitch;
    sim.tgt.ias = lerp(entry - (entry - endKias) * 0.55, endKias, u);
    sim.tgt.vs = lerp(950, 250, u);
    s.rudderBias = 0.12 + 0.16 * u;               // more right rudder as speed falls, even in a left turn
  });
  sim.rollTo(0, 1.2);
  s.hdg = 180;
  sim.mark('hold');
  sim.for(2.5, () => { s.pitch = maxPitch; sim.tgt.ias = endKias; sim.tgt.vs = 100; });
  sim.mark('recover');
  const top = s.alt;
  const t0 = s.t;
  sim.tgt.ias = entry; sim.tgt.accel = 1.4;
  sim.until(() => s.ias >= entry - 4, () => {
    s.pitch = lerp(maxPitch, levelPitch(ac, s.ias, 0), smoothstep(0, 5, s.t - t0));
    sim.tgt.vs = 0; sim.tgt.vsRate = 150;
    s.rudderBias = lerp(s.rudderBias, 0, 0.02);
  });
  s.pitch = undefined;
  sim.power(ac.pw.cruise);
  sim.mark('cruise');
  sim.for(4, () => { sim.tgt.vs = 0; });
  const m = sim.marks;
  const gain = Math.round((top - alt) / 10) * 10;
  const steps: Step[] = [
    { id: 'setup', title: 'Set up and clear the area', start: 0, end: m.roll, detail: setupText(q, [
      `Cruise: ${pwT(ac, ac.pw.cruise)}, ${ac.text.cruiseSetup}, ${entry} KIAS (at or below Va), flaps and gear up.`,
      'Pick a reference off the wingtip in the direction of turn — that is your 90° point. Heading bug on the entry heading.',
    ]) },
    { id: 'roll', title: 'Roll to 30° and add full power', start: m.roll, end: m.first, detail: [
      'Roll into a coordinated 30° bank and smoothly apply full power together.',
      'Begin a climbing turn.',
    ] },
    { id: 'first', title: 'First 90°: constant bank, pitch increasing', start: m.first, end: m.second, detail: [
      'Hold 30° of bank.',
      `Raise the pitch at a steady rate so it reaches its maximum, about ${maxPitch}°, at the 90° point.`,
      'Airspeed decreases steadily; add right rudder as it slows.',
    ] },
    { id: 'second', title: 'Second 90°: constant pitch, bank decreasing', start: m.second, end: m.hold, detail: [
      'At the 90° point (the heading bug crosses the nose reference), hold the pitch and start rolling out at a constant rate.',
      'Wings should reach level exactly at 180°.',
      'Keep increasing back pressure to hold the pitch as the airspeed falls.',
    ] },
    { id: 'hold', title: 'At 180°: wings level, just above the stall', start: m.hold, end: m.recover, detail: [
      `Wings level on the reciprocal heading, about ${endKias} KIAS — just above the stall, not stalled.`,
      'Hold it momentarily.',
    ] },
    { id: 'recover', title: 'Lower the nose, accelerate', start: m.recover, end: m.cruise, detail: [
      'Lower the nose to level flight without losing altitude.',
      'Let it accelerate, then reduce to cruise power.',
    ] },
    { id: 'cruise', title: 'Cruise', start: m.cruise, end: 0, detail: [`About ${gain} ft gained in the turn.`] },
  ];
  return airworkRun({
    id: 'chandelle', title: 'Chandelles', acsCode: 'CA.V.C', acsTask: 'Area V, Task C',
    objective: 'A maximum-performance 180° climbing turn: 30° bank and rising pitch for the first 90°, then pitch held while the bank rolls out, finishing just above the stall.',
    sim, steps,
    tolerances: [
      { id: 'bank', label: 'Bank, first 90°', unit: '°', standard: 'About 30°', value: (f) => Math.abs(f.bank), target: 30, minus: 5, plus: 5, windows: [[m.first, m.second]] },
      { id: 'hdg', label: 'Rollout heading', unit: '°', standard: '180° point ±10°', value: (f) => 180 + angDiff(180, f.heading), target: 180, minus: 10, plus: 10, windows: [[m.hold, m.recover]] },
      { id: 'spd', label: 'Airspeed at 180°', unit: 'kt', standard: 'Just above the stall', value: (f) => f.ias, target: q.stallCleanKias + 5, minus: 4, plus: 5, windows: [[m.hold, m.recover]] },
    ],
    bugs: { altitudeFt: alt, heading: 360, ias: entry },
    notes: ['Shown to the left. To the right, more right rudder is needed in the second half.'],
  });
}

// ─────────────────────────────────────────────────────────────── Lazy eights
export function buildLazyEight(ac: AircraftProfile, _cert: Cert = 'commercial'): ManeuverRun {
  const { q } = needs(ac);
  const alt = q.airworkAltFt, entry = ac.cruiseKias;
  const minKias = Math.round(Math.max(q.stallCleanKias * 1.3, entry - 28));
  const H = 250;                                   // ft gained at the 90° point
  const sim = cruiseSim(ac, alt, q.airworkGroundFt, 360);
  const s = sim.s;
  const pLevel = levelPitch(ac, entry, 0);
  sim.for(5, () => sim.holdAlt(alt, 500));
  const marks = sim.marks;
  const half = (dir: 1 | -1, key: string, from: number) => {
    sim.mark(`${key}0`);
    let seen = { p45: false, p90: false, p135: false };
    sim.until(() => turned(from, sim, dir) >= 179.5, () => {
      const phi = Math.min(180, Math.max(0, turned(from, sim, dir)));
      const r = phi * D2R;
      // About 15° at the 45° point, 30° at 90°, back through 15° at 135°.
      s.bank = dir * Math.max(7, 30 * (1 - Math.abs(phi - 90) / 90) ** 0.9);
      // Highest pitch at 45°, level at 90°, lowest at 135°.
      const up = Math.sin(2 * r);
      s.pitch = pLevel + (up > 0 ? 11 : 8.5) * up + (entry - s.ias) * 0.04;
      s.ias = entry - (entry - minKias) * Math.sin(r) ** 1.3;
      sim.tgt.ias = s.ias;
      s.alt = alt + H * Math.sin(r) ** 2;
      s.vs = 0; sim.tgt.vs = 0;
      s.rudderBias = 0.1 * Math.sin(r);
      if (!seen.p45 && phi >= 45) { seen.p45 = true; sim.mark(`${key}45`); }
      if (!seen.p90 && phi >= 90) { seen.p90 = true; sim.mark(`${key}90`); }
      if (!seen.p135 && phi >= 135) { seen.p135 = true; sim.mark(`${key}135`); }
    }, 200);
    s.bank = 0; s.hdg = wrap360(from + 180 * dir); s.alt = alt; s.ias = entry;
    sim.mark(`${key}180`);
  };
  half(1, 'R', 360);
  half(-1, 'L', 180);
  s.pitch = undefined; s.rudderBias = 0;
  sim.for(4, () => { sim.tgt.vs = 0; });
  const m = marks;
  const pts = (key: string, side: string): Step[] => [
    { id: `${key}a`, title: `${side}: climbing turn to the 45° point`, start: m[`${key}0`], end: m[`${key}45`], detail: [
      'Start a gradual climbing turn — pitch and bank increase together, slowly.',
      'At 45°: pitch is at its highest (about 12–15° in the guide), bank about 15°.',
    ] },
    { id: `${key}b`, title: `${side}: over the top at 90°`, start: m[`${key}45`], end: m[`${key}90`], detail: [
      'Pitch decreases while bank keeps increasing.',
      `At 90°: bank is at its maximum, about 30°; the nose is passing through the horizon; airspeed is at its minimum, about ${minKias} KIAS.`,
    ] },
    { id: `${key}c`, title: `${side}: descending to the 135° point`, start: m[`${key}90`], end: m[`${key}135`], detail: [
      'The nose continues below the horizon as the bank starts rolling out.',
      'At 135°: lowest pitch, bank about 15°, airspeed increasing.',
    ] },
    { id: `${key}d`, title: `${side}: back to level at 180°`, start: m[`${key}135`], end: m[`${key}180`], detail: [
      'Raise the nose and continue rolling out.',
      'At 180°: wings level, entry altitude and entry airspeed — then straight into the next turn.',
    ] },
  ];
  const steps: Step[] = [
    { id: 'setup', title: 'Set up and clear the area', start: 0, end: m.R0, detail: setupText(q, [
      `Cruise: ${pwT(ac, ac.pw.cruise)}, ${ac.text.cruiseSetup}, ${entry} KIAS (at or below Va). Power stays constant throughout.`,
      'Pick a prominent reference on the horizon 90° to the right (first turn shown to the right).',
    ]) },
    ...pts('R', 'Right'),
    ...pts('L', 'Left'),
    { id: 'done', title: 'Complete on the entry heading', start: m.L180, end: 0, detail: ['Same altitude, airspeed and heading as at entry.'] },
  ];
  const at180: [number, number][] = [[m.R180 - 0.3, m.R180 + 0.6], [m.L180 - 0.3, m.L180 + 2]];
  return airworkRun({
    id: 'lazy-eight', title: 'Lazy Eights', acsCode: 'CA.V.D', acsTask: 'Area V, Task D',
    objective: 'Two symmetrical 180° turns in opposite directions with pitch, bank and airspeed changing continuously and smoothly.',
    sim, steps,
    tolerances: [
      { id: 'alt', label: 'Altitude at 180° points', unit: 'ft', standard: '±100 ft', value: (f) => f.altFt, target: alt, minus: 100, plus: 100, windows: at180 },
      { id: 'ias', label: 'Airspeed at 180° points', unit: 'kt', standard: '±10 kt', value: (f) => f.ias, target: entry, minus: 10, plus: 10, windows: at180 },
      { id: 'bank', label: 'Bank at 90° points', unit: '°', standard: 'About 30°', value: (f) => Math.abs(f.bank), target: 30, minus: 5, plus: 5, windows: [[m.R90 - 1, m.R90 + 1], [m.L90 - 1, m.L90 + 1]] },
      { id: 'hdg', label: 'Heading at 180° points', unit: '°', standard: '±10°', value: (f) => Math.min(Math.abs(angDiff(180, f.heading)), Math.abs(angDiff(360, f.heading))), target: 0, minus: 0, plus: 10, windows: at180 },
    ],
    bugs: { altitudeFt: alt, heading: 360, ias: entry },
    notes: ['Nothing is held constant except power: if the picture stops changing, the maneuver has flattened out.'],
  });
}

// ─────────────────────────────────────────────────────────────── Eights on pylons
export function buildEightsOnPylons(ac: AircraftProfile, _cert: Cert = 'commercial'): ManeuverRun {
  const g = ac.procedures.sTurns;
  if (!g) throw new Error(`${ac.shortName} has no ground-reference profile`);
  const ground = g.groundElevFt, ias = g.ias;
  const tas = tasFromIas(ias, ground + 800);
  const r = 420, D = 840;                           // sin(30°) = r / D
  const leg = Math.sqrt(D * D - r * r);
  const tb = new TrackBuilder({ e: -900 * Math.cos(30 * D2R), n: 900 * Math.sin(30 * D2R), track: 120 }, g.windFromDeg, g.windKt, tas);
  tb.straight(900);
  tb.mark('mid1');
  tb.straight(leg);
  tb.mark('arcB');
  tb.arc(r, 120, -1); tb.mark('B1');
  tb.arc(r, 120, -1); tb.mark('B2');
  tb.straight(leg); tb.mark('mid2'); tb.straight(leg);
  tb.mark('arcA');
  tb.arc(r, 120, 1); tb.mark('A1');
  tb.arc(r, 120, 1); tb.mark('A2');
  tb.straight(leg); tb.mark('mid3');
  tb.straight(500);
  const pivotal = (gsMs: number) => (gsMs / KT) ** 2 / 11.3;
  const raw = tb.toRaw((qq) => ground + pivotal(qq.gs), ias, g.rpm);
  const frames = finalize(raw, ac, { trim: 0.2, cruiseRpm: g.rpm });
  const duration = frames[frames.length - 1].t;
  const m = tb.marks;
  const pa = frames.map((f) => f.altFt - ground);
  const lo = Math.round(Math.min(...pa) / 10) * 10, hi = Math.round(Math.max(...pa) / 10) * 10;
  const steps: Step[] = [
    { id: 'entry', title: 'Enter diagonally between the pylons', start: 0, end: m.arcB, detail: [
      'Pick two pylons about ½–1 mile apart on a line perpendicular to the wind, with landing options nearby.',
      `Pivotal altitude ≈ groundspeed² ÷ 11.3. At ${Math.round(tas)} kt in calm air that is about ${n(tas * tas / 11.3)} ft AGL.`,
      `Cruise ${pwT(ac, g.rpm)}, ${ias} KIAS, at or below Va. Wind ${hdg3(g.windFromDeg)}° at ${g.windKt} kt.`,
      'Cross midway between the pylons at 45° to their line, with the wind behind.',
    ] },
    { id: 'b1', title: 'First pylon: roll in, wingtip on the pylon', start: m.arcB, end: m.B1, detail: [
      'As the pylon comes abeam, roll in — about 30–40° at the steepest.',
      'Put your wingtip reference (not the nose) on the pylon and keep it there.',
      'Pylon drifting ahead of the reference: you are too high — descend. Drifting behind: too low — climb.',
    ] },
    { id: 'b2', title: 'Turning upwind: descend with groundspeed', start: m.B1, end: m.B2, detail: [
      'Groundspeed falls as you turn into the wind, so pivotal altitude falls — ease the nose down.',
      `Across the maneuver the pivotal altitude ranges from about ${n(lo)} to ${n(hi)} ft AGL.`,
      'Correct with pitch (altitude) only — never with rudder, and not by changing bank to "hold" the pylon.',
    ] },
    { id: 'cross', title: 'Roll out, cross to the second pylon', start: m.B2, end: m.arcA, detail: [
      'Roll wings level and fly the diagonal back between the pylons, crabbing for wind.',
    ] },
    { id: 'a1', title: 'Second pylon: turn the other way', start: m.arcA, end: m.A1, detail: [
      'Roll in the opposite direction and place the other wingtip reference on the pylon.',
      'Groundspeed is higher on the downwind side: climb to stay at pivotal altitude.',
    ] },
    { id: 'a2', title: 'Complete the eight', start: m.A1, end: m.A2, detail: [
      'Follow the pivotal altitude down again as the groundspeed drops.',
    ] },
    { id: 'exit', title: 'Roll out and exit', start: m.A2, end: duration, detail: ['Wings level on the entry diagonal. Clear the area.'] },
  ];
  const win: [number, number][] = [[m.arcB, m.A2]];
  const tolerances: Tolerance[] = [
    { id: 'piv', label: 'Off pivotal altitude', unit: 'ft', standard: 'Pylon held on the reference', value: (f) => f.altFt - ground - (f.gs ** 2) / 11.3, target: 0, minus: 60, plus: 60, windows: [[m.arcB + 4, m.B2 - 4], [m.arcA + 4, m.A2 - 4]] },
    { id: 'bank', label: 'Bank at the steepest point', unit: '°', standard: 'About 30–40°', value: (f) => Math.abs(f.bank), target: 20, minus: 20, plus: 20, windows: win },
    { id: 'ias', label: 'Airspeed', unit: 'kt', standard: 'At or below Va', value: (f) => f.ias, target: ias, minus: 10, plus: 10, windows: win },
  ];
  return {
    id: 'eights-on-pylons', title: 'Eights on Pylons', acsCode: 'CA.V.E', acsTask: 'Area V, Task E',
    objective: 'A figure eight around two pylons, holding each pylon on the wingtip reference by changing altitude as groundspeed changes.',
    frames, dt: 0.05, duration, steps, tolerances,
    scene: {
      groundElevFt: ground, roads: [],
      markers: [{ east: D, north: 0, kind: 'silo', label: 'Pylon' }, { east: -D, north: 0, kind: 'silo', label: 'Pylon' }],
      labels: [{ east: D, north: 0, altFt: ground + 140, text: 'Pylon 1' }, { east: -D, north: 0, altFt: ground + 140, text: 'Pylon 2' }],
      frameRadius: D + r + 250, frameCenter: [0, 0],
      wind: { fromDeg: g.windFromDeg, kt: g.windKt },
    },
    bugs: { altitudeFt: Math.round((ground + (lo + hi) / 2) / 10) * 10, heading: 120, ias },
    notes: [
      `Wind ${hdg3(g.windFromDeg)}° at ${g.windKt} kt. The altitude you see changing is the pivotal altitude following the groundspeed.`,
      'The ground track is shown as circles for clarity; flown for real, the radius changes slightly with the wind.',
    ],
  };
}

// ─────────────────────────────────────────────────────────────── Steep spiral
export function buildSteepSpiral(ac: AircraftProfile, _cert: Cert = 'commercial'): ManeuverRun {
  const g = ac.procedures.sTurns, { q } = needs(ac);
  if (!g) throw new Error(`${ac.shortName} has no ground-reference profile`);
  const ground = g.groundElevFt, vg = ac.speeds.vg;
  const startAlt = ground + 4500;
  const tas = tasFromIas(vg, startAlt - 800);
  const R = Math.round(((tas * KT) ** 2) / (G * Math.tan(40 * D2R)) / 10) * 10;
  const sink = q.glideFpm * 1.45;                  // idle, about 40° of bank
  const tb = new TrackBuilder({ e: -R, n: 700, track: 180 }, g.windFromDeg, g.windKt, tas);
  tb.straight(700);
  tb.mark('enter');
  tb.arc(R, 360, -1); tb.mark('t1');
  tb.arc(R, 360, -1); tb.mark('t2');
  tb.arc(R, 360, -1); tb.mark('t3');
  tb.straight(500);
  const m = tb.marks;
  const t0 = m.enter - 6;
  const raw = tb.toRaw((qq) => startAlt - (Math.max(0, qq.t - t0) / 60) * sink, vg, ac.rpm.idle);
  raw.forEach((rr) => { if (rr.t < t0) { rr.rpm = ac.pw.reduce; } });
  const frames = finalize(raw, ac, { trim: 0.3, cruiseRpm: ac.pw.cruise });
  const duration = frames[frames.length - 1].t;
  const endAgl = frames[frames.length - 1].altFt - ground;
  const inArc = frames.filter((f) => f.t > m.enter + 2 && f.t < m.t3 - 2);
  const maxB = Math.max(...inArc.map((f) => Math.abs(f.bank))), minB = Math.min(...inArc.map((f) => Math.abs(f.bank)));
  const steps: Step[] = [
    { id: 'setup', title: 'Set up high over the point', start: 0, end: m.enter, detail: [
      `Start high enough to finish three turns by 1,500 ft AGL — shown from ${n(startAlt)} ft MSL (${n(startAlt - ground)} ft AGL).`,
      'Clear the area, especially below. Pick a ground reference point with landing options.',
      `Power idle, pitch for best glide ${vg} KIAS, trim. ${ac.text.cruiseSetup.includes('fuel pump') ? 'Fuel pump ON.' : ''}`.trim(),
      'Enter on the downwind side with the point off the wing.',
    ] },
    { id: 't1', title: 'First turn: steepest bank downwind', start: m.enter, end: m.t1, detail: [
      `Roll in and keep a constant radius around the point: steepest downwind (about ${Math.round(maxB)}°), shallowest upwind (about ${Math.round(minB)}°). Never more than 60°.`,
      `Hold ${vg} KIAS with pitch — the nose is lower in the steeper part of the turn.`,
    ] },
    { id: 't2', title: 'Second turn: clear the engine', start: m.t1, end: m.t2, detail: [
      'Once per turn, briefly advance the power (to about 65%) to clear the engine, holding airspeed with a slight pitch up, then back to idle.',
      'Keep dividing attention: the point, airspeed, altitude remaining, traffic.',
    ] },
    { id: 't3', title: 'Third turn: plan the rollout', start: m.t2, end: m.t3, detail: [
      'Same radius, same airspeed.',
      'Roll out toward the specified heading or reference.',
    ] },
    { id: 'exit', title: 'Roll out and recover', start: m.t3, end: duration, detail: [
      `Wings level on the rollout heading, about ${n(endAgl)} ft AGL — no lower than 1,500 ft AGL.`,
      'Apply power, establish a climb or continue to a simulated emergency approach.',
    ] },
  ];
  const win: [number, number][] = [[m.enter, m.t3]];
  return {
    id: 'steep-spiral', title: 'Steep Spiral', acsCode: 'CA.V.B', acsTask: 'Area V, Task B',
    objective: 'Three gliding 360° turns of constant radius around a ground point at a constant airspeed, correcting for wind with bank.',
    frames, dt: 0.05, duration, steps,
    tolerances: [
      { id: 'ias', label: 'Airspeed', unit: 'kt', standard: '±10 kt', value: (f) => f.ias, target: vg, minus: 10, plus: 10, windows: win },
      { id: 'bank', label: 'Bank', unit: '°', standard: 'No more than 60°', value: (f) => Math.abs(f.bank), target: 30, minus: 30, plus: 30, windows: win },
      { id: 'hdg', label: 'Rollout heading', unit: '°', standard: '±10°', value: (f) => 180 + angDiff(180, f.heading), target: 180, minus: 10, plus: 10, windows: [[m.t3 + 3, duration]] },
      { id: 'agl', label: 'Height at completion', unit: 'ft', standard: 'No lower than 1,500 ft AGL', value: (f) => f.altFt - ground, target: 2500, minus: 1000, plus: 3000, windows: [[m.t3, duration]] },
    ],
    scene: {
      groundElevFt: ground, roads: [],
      markers: [{ east: 0, north: 0, kind: 'silo', label: 'Point' }],
      frameRadius: R * 2.6, frameCenter: [0, 120],
      wind: { fromDeg: g.windFromDeg, kt: g.windKt },
    },
    bugs: { altitudeFt: ground + 1500, heading: 180, ias: vg },
    notes: [`Wind ${hdg3(g.windFromDeg)}° at ${g.windKt} kt. Radius about ${n(R / FT)} ft.`],
  };
}

// ─────────────────────────────────────────────────────────────── Power-off 180°
export function buildPowerOff180(ac: AircraftProfile, _cert: Cert = 'commercial'): ManeuverRun {
  const { p, q } = needs(ac);
  const rf = runwayFrame(APT, END);
  const aim = rf.threshold + 1000 * FT;
  const vg = ac.speeds.vg, full = fullFlaps(ac);
  const offset = 850;
  const downwind = wrap360(rf.hdg + 180), baseHdg = wrap360(rf.hdg + (rf.traffic === 'left' ? 90 : -90));
  const tpa = APT.elevFt + APT.tpaAglFt;

  const fly = (ext: number) => {
    const st = rf.at(aim + 600, offset);
    const sim = new Sim(ac, {
      east: st.e, north: st.n, hdg: downwind, altFt: tpa, elevFt: APT.elevFt,
      ias: p.downwindKias, rpm: p.downwindRpm, flaps: 0, onGround: false, throttle: 0.5, trim: 0.2,
    });
    const s = sim.s;
    sim.until(() => rf.along(sim.pos()) <= aim, () => { sim.tgt.vs = 0; });
    sim.mark('abeam'); sim.marks.idle = s.t;
    sim.power(ac.rpm.idle);
    sim.tgt.ias = vg; sim.tgt.accel = 1.5; sim.tgt.trim = 0.4;
    const glide = () => {
      const slowing = s.ias > vg + 1;
      sim.tgt.vs = -(slowing ? 150 : q.glideFpm) * (1 + s.flaps / full * 0.35) / Math.cos(s.bank * D2R) ** 1.2;
      sim.tgt.vsRate = 250;
    };
    sim.for(ext, glide);
    sim.mark('base');
    sim.turnTo(baseHdg, 30, glide);
    sim.tgt.flaps = ac.flapDetents[1];
    const v = tasFromIas(vg, s.alt) * KT;
    const lead = (v * v) / (G * Math.tan(30 * D2R)) + v * 1.3;
    sim.until(() => rf.lateral(sim.pos()) <= lead, glide, 60);
    sim.mark('finalTurn');
    sim.turnTo(rf.hdg, 30, glide);
    s.hdg = rf.hdg;
    sim.mark('final');
    const h = sim.agl, d = aim + 12 - rf.along(sim.pos());
    const path = Math.atan2(h * FT, d) / D2R;
    return { sim, path };
  };
  let best = fly(4);
  for (let ext = 5; ext <= 40; ext += 1) {
    const c = fly(ext);
    if (Math.abs(c.path - 6) < Math.abs(best.path - 6)) best = c;
  }
  const { sim, path } = best;
  const s = sim.s;
  sim.tgt.flaps = full; sim.tgt.ias = p.finalKias; sim.tgt.accel = 1;
  // Slide onto the centerline over the first seconds of final.
  const tF = s.t;
  const origTick = sim.tick.bind(sim);
  sim.tick = (ga?: number) => {
    const off = rf.lateral(sim.pos());
    const k = smoothstep(0, 8, s.t - tF) * 0.08;
    s.e -= rf.side.e * off * k; s.n -= rf.side.n * off * k;
    origTick(ga);
  };
  finalToStop(sim, rf, { aimAlong: aim - 30, pathDeg: path, tdKias: p.touchdownKias, decel: p.landingDecel, idleAtAlong: -1e9 });
  const m = sim.marks;
  const steps: Step[] = [
    { id: 'downwind', title: 'Downwind at pattern altitude', start: 0, end: m.abeam, detail: [
      `${n(tpa)} ft MSL (${n(APT.tpaAglFt)} ft AGL), ${p.downwindKias} KIAS, ${pwT(ac, p.downwindRpm)}.`,
      ac.text.beforeLanding,
      'Pick the touchdown point — the 1,000 ft markers shown. Note the wind.',
    ] },
    { id: 'abeam', title: 'Abeam the point: power idle', start: m.abeam, end: m.base, detail: [
      'Close the throttle abeam the touchdown point. No power from here on unless safety requires it.',
      `Pitch for best glide, ${vg} KIAS, and trim.`,
    ] },
    { id: 'base', title: 'Turn base — judge it by the wind', start: m.base, end: m.finalTurn, detail: [
      'Turn base a few seconds after abeam (sooner with a strong headwind on final).',
      `First notch of flaps (${fl(ac, ac.flapDetents[1])}) only if you are clearly high. Flaps cannot be taken back.`,
      'On base, check the picture: aim point steady means on glidepath; moving up means low.',
    ] },
    { id: 'final', title: 'Turn final, manage the energy', start: m.finalTurn, end: m.flare, detail: [
      'Roll out on the centerline.',
      `High: add flaps (${fl(ac, full)}), then slip. Low: hold flaps and keep best glide — never stretch the glide by raising the nose.`,
      `Slow toward ${p.finalKias} KIAS once the point is made.`,
    ] },
    { id: 'flare', title: 'Flare and touch down on the point', start: m.flare, end: m.touchdown + 0.5, detail: [
      `Touch down on the main wheels at about ${p.touchdownKias} KIAS, on or within 200 ft beyond the point.`,
    ] },
    { id: 'rollout', title: 'Rollout', start: m.touchdown + 0.5, end: 0, detail: ['Lower the nosewheel, hold the centerline, brake as needed.'] },
  ];
  return run({
    id: 'power-off-180', title: 'Power-Off 180° Accuracy Approach', acsCode: 'CA.IV.M', acsTask: 'Area IV, Task M',
    objective: 'From abeam the touchdown point at pattern altitude, glide with the power at idle to a touchdown on or within 200 ft beyond the point.',
    sim, rf, steps,
    tolerances: [
      { id: 'vg', label: 'Glide speed', unit: 'kt', standard: '±10 kt', value: (f) => f.ias, target: vg, minus: 10, plus: 10, windows: [[m.abeam + 12, m.final]] },
      tdTolerance(rf, aim, m.touchdown, 200, 'Minus 0 / plus 200 ft'),
    ],
    bugs: { altitudeFt: tpa, heading: rf.hdg, ias: vg },
    notes: ['Calm wind shown. The base turn point is the main variable: later with a tailwind on base or when high.'],
    labels: [{ east: rf.at(aim).e, north: rf.at(aim).n, altFt: APT.elevFt + 60, text: 'Touchdown point' }],
  }, p.downwindRpm);
}

// ─────────────────────────────────────────────────────────────── Accelerated stall
export function buildAcceleratedStall(ac: AircraftProfile, _cert: Cert = 'commercial'): ManeuverRun {
  const { q } = needs(ac);
  const ground = q.airworkGroundFt, alt = ground + 3500, cruise = ac.cruiseKias;
  const entry = Math.max(80, Math.round(q.stallCleanKias * 1.19 + 16));
  const accelStall = Math.round(q.stallCleanKias * Math.sqrt(1 / Math.cos(45 * D2R)));
  const horn = accelStall + q.stallWarnMarginKt;
  const sim = cruiseSim(ac, alt, ground, 360);
  const s = sim.s;
  const hold = () => sim.holdAlt(alt, 500);
  sim.for(5, hold);
  sim.mark('slow');
  sim.power(ac.pw.reduce); sim.tgt.ias = entry; sim.tgt.accel = 1.3;
  sim.until(() => s.ias <= entry + 0.3, hold);
  sim.mark('bank');
  sim.rollTo(-45, 4.5, hold);
  sim.mark('pull');
  sim.tgt.ias = horn - 1; sim.tgt.accel = 2.2;
  const tP = s.t;
  sim.until(() => s.ias <= horn, () => {
    hold();
    s.elevBias = lerp(0.1, 0.5, smoothstep(entry, horn, s.ias));
    s.pitch = levelPitch(ac, s.ias, 0) + 3 + 2.5 * smoothstep(0, 6, s.t - tP);
  });
  s.warn = 'STALL';
  sim.mark('horn');
  sim.for(0.8, hold);
  sim.mark('recover');
  const tR = s.t;
  sim.power(fullPower(ac));
  sim.tgt.ias = cruise; sim.tgt.accel = 2;
  sim.rollTo(0, 3.5, () => {
    s.elevBias = lerp(0.5, -0.15, smoothstep(0, 1, s.t - tR));
    s.pitch = lerp(s.pitch ?? 6, levelPitch(ac, s.ias, 0), 0.08);
    if (s.ias > horn + 2) s.warn = undefined;
    sim.tgt.vs = -150;
    s.rudderBias = 0.05;
  });
  s.warn = undefined; s.pitch = undefined;
  sim.until(() => s.ias >= cruise - 5, () => { hold(); s.elevBias = lerp(s.elevBias, 0, 0.05); s.rudderBias = lerp(s.rudderBias, 0, 0.03); });
  sim.power(ac.pw.cruise);
  sim.mark('cruise');
  sim.for(4, hold);
  const m = sim.marks;
  const steps: Step[] = [
    { id: 'setup', title: 'Set up and clear the area', start: 0, end: m.slow, detail: [
      `No lower than 3,000 ft AGL — shown at ${n(alt)} ft MSL (${n(alt - ground)} ft AGL).`,
      'Clearing turns first (not animated).',
      `Cruise: ${pwT(ac, ac.pw.cruise)}, ${ac.text.cruiseSetup}, flaps up.`,
    ] },
    { id: 'slow', title: `Slow to ${entry} KIAS`, start: m.slow, end: m.bank, detail: [
      `Reduce power to ${pwT(ac, ac.pw.reduce)} and hold altitude.`,
      `${entry} KIAS is well below Va (${ac.speeds.va[ac.speeds.va.length - 1].kias}–${ac.speeds.va[0].kias} KIAS), so the wing stalls before the structure is overloaded.`,
    ] },
    { id: 'bank', title: 'Roll to 45° of bank', start: m.bank, end: m.pull, detail: [
      'Smooth, coordinated roll to about 45°, holding altitude with back pressure.',
    ] },
    { id: 'pull', title: 'Increase back pressure', start: m.pull, end: m.horn, detail: [
      'Firmly and steadily increase back pressure to hold altitude as the airspeed falls about 1 kt per second.',
      `At 45° the load factor is 1.41 G: the wing stalls near ${accelStall} KIAS instead of ${q.stallCleanKias}.`,
      'Keep it coordinated — a skid here invites a spin.',
    ] },
    { id: 'horn', title: 'First indication of the stall', start: m.horn, end: m.recover, detail: [
      `Stall warning or buffet at about ${horn} KIAS — well above the wings-level stall speed.`,
      'Recover at the first indication.',
    ] },
    { id: 'recover', title: 'Recover', start: m.recover, end: m.cruise, detail: [
      'Reduce the angle of attack: relax the back pressure.',
      'Roll wings level with coordinated controls and add power.',
      'Return to the entry altitude and cruise.',
    ] },
    { id: 'cruise', title: 'Cruise', start: m.cruise, end: 0, detail: ['Straight and level, trimmed. Clear the area.'] },
  ];
  return airworkRun({
    id: 'accelerated-stall', title: 'Accelerated Stalls', acsCode: 'CA.VII.D', acsTask: 'Area VII, Task D',
    objective: 'In a 45° banked level turn, increase back pressure to the first indication of a stall at a speed above the unaccelerated stall speed, then recover.',
    sim, steps,
    tolerances: [
      { id: 'bank', label: 'Bank', unit: '°', standard: 'About 45°', value: (f) => Math.abs(f.bank), target: 45, minus: 5, plus: 5, windows: [[m.pull, m.recover]] },
      { id: 'agl', label: 'Height above ground', unit: 'ft', standard: 'No lower than 3,000 ft AGL', value: (f) => f.altFt - ground, target: 3500, minus: 500, plus: 1500, windows: [[m.bank, m.cruise]] },
      { id: 'coord', label: 'Coordination (ball)', unit: '', standard: 'Centered', value: (f) => f.slip, target: 0, minus: 0.2, plus: 0.2, windows: [[m.bank, m.recover]] },
    ],
    bugs: { altitudeFt: alt, heading: 360, ias: entry },
    notes: ['The red STALL annunciation on the PFD stands in for the stall warning.'],
  });
}
