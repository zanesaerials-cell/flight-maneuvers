import { fullPower, fl, flapUpOne, fullFlaps, pwT, type AircraftProfile, type Cert } from '../data/aircraft';
import { angDiff, lerp, levelPitch, smoothstep } from '../engine/kinematics';
import type { Sim } from '../engine/sim';
import type { ManeuverRun, Step, Tolerance } from '../engine/types';
import { airworkRun, cruiseSim, setupText, stageFlaps } from './airwork';

/*
 * Flight Instructor demonstration stalls: secondary, cross-controlled and
 * elevator trim. Each is entered from a glide in the landing configuration
 * and recovered at the first indication, as an instructor would demonstrate it.
 */

const n = (x: number) => Math.round(x).toLocaleString();

function needs(ac: AircraftProfile) {
  const p = ac.procedures.pattern, q = ac.procedures.perf;
  if (!p || !q) throw new Error(`${ac.shortName} has no stall profile`);
  return { p, q };
}

/** Cruise → landing configuration glide at approach speed. Returns when stabilized. */
function toApproachGlide(sim: Sim, alt: number, flapsWant: number, kias: number, trim: number) {
  const ac = sim.ac, s = sim.s;
  sim.for(5, () => sim.holdAlt(alt, 500));
  sim.mark('slow');
  sim.power(ac.pw.reduce); sim.gearDown(); sim.tgt.ias = kias; sim.tgt.accel = 1.3;
  sim.until(() => s.ias <= kias + 0.3, () => {
    sim.holdAlt(alt, 500);
    stageFlaps(sim, flapsWant);
    sim.tgt.trim = lerp(0.15, trim, smoothstep(ac.cruiseKias, kias, s.ias));
  });
  sim.mark('glide');
  sim.power(ac.rpm.idle);
  sim.for(7, () => { sim.tgt.vs = -500; sim.tgt.vsRate = 200; });
}

/** Proper recovery: AOA down, wings level, full power, clean up, climb back and return to cruise. */
function recoverAndClimb(sim: Sim, alt: number, fromPitch: number) {
  const ac = sim.ac, s = sim.s, q = ac.procedures.perf!;
  const t0 = s.t;
  sim.power(fullPower(ac));
  sim.tgt.ias = q.balkedClimbKias; sim.tgt.accel = 3;
  sim.until(() => s.ias >= q.balkedClimbKias - 2, () => {
    const u = smoothstep(0, 1.5, s.t - t0);
    s.pitch = lerp(fromPitch, 2, u);
    s.bank = lerp(s.bank, 0, 0.06);
    s.elevBias = lerp(s.elevBias, -0.2, 0.08);
    s.rudderBias = lerp(s.rudderBias, 0.3, 0.08);
    s.aileronBias = lerp(s.aileronBias, 0, 0.1);
    s.slip = lerp(s.slip, 0, 0.1);
    sim.tgt.vs = lerp(s.vs, 0, 0.05); sim.tgt.vsRate = 600;
    sim.tgt.trim = 0.3;
    if (s.t - t0 > 1) sim.tgt.flaps = Math.min(s.flaps, q.balkedFlaps);
    if (s.ias > q.stallFlaps30Kias + q.stallWarnMarginKt + 2) s.warn = undefined;
  });
  s.pitch = undefined; s.warn = undefined; s.bank = 0; s.slip = 0; s.aileronBias = 0;
  sim.mark('climb');
  const tC = s.t;
  sim.tgt.ias = q.balkedFlapsUpKias; sim.tgt.accel = 1;
  sim.until(() => s.t - tC > 6 && s.alt >= alt - 70, () => {
    sim.tgt.vs = 600; sim.tgt.vsRate = 250;
    s.elevBias = lerp(s.elevBias, 0.05, 0.02);
    sim.gearUp();
    if (s.ias >= q.balkedFlapsUpKias - 1 && Math.abs(s.flaps - sim.tgt.flaps) < 0.5) sim.tgt.flaps = flapUpOne(ac, s.flaps);
  }, 240);
  sim.mark('level');
  sim.tgt.flaps = 0; sim.tgt.ias = ac.cruiseKias; sim.tgt.accel = 1.2; sim.tgt.trim = 0.15;
  sim.until(() => s.ias >= ac.cruiseKias - 5, () => { sim.holdAlt(alt, 500); s.rudderBias = lerp(s.rudderBias, 0, 0.02); });
  sim.power(ac.pw.cruise);
  sim.for(4, () => { sim.holdAlt(alt, 500); s.rudderBias = lerp(s.rudderBias, 0, 0.05); });
}

const recoverySteps = (ac: AircraftProfile, m: Record<string, number>, from: number): Step[] => {
  const q = ac.procedures.perf!;
  return [
    { id: 'recover', title: 'Recover', start: from, end: m.climb, detail: [
      'Reduce the angle of attack first — forward pressure until the warning stops.',
      'Neutralize the controls, level the wings with coordinated inputs.',
      `Full power, right rudder; flaps to ${fl(ac, q.balkedFlaps)}.`,
    ] },
    { id: 'climb', title: 'Climb and clean up', start: m.climb, end: m.level, detail: [
      `Positive rate${ac.retractable ? ', gear UP' : ''}, ${q.balkedClimbKias} KIAS; remaining flaps up one notch at a time above ${q.balkedFlapsUpKias} KIAS.`,
    ] },
    { id: 'level', title: 'Level off, cruise', start: m.level, end: 0, detail: ['Back at the entry altitude: cruise power, trim, clear the area.'] },
  ];
};

const baseTolerances = (m: Record<string, number>, alt: number, a: number, b: number): Tolerance[] => [
  { id: 'hdg', label: 'Heading', unit: '°', standard: '±10°', value: (f) => 360 + angDiff(360, f.heading), target: 360, minus: 10, plus: 10, windows: [[a, b]] },
  { id: 'ret', label: 'Back to altitude', unit: 'ft', standard: '±100 ft', value: (f) => f.altFt, target: alt, minus: 100, plus: 100, windows: [[m.level + 2, m.level + 8]] },
];

const entrySteps = (ac: AircraftProfile, m: Record<string, number>, flapsWant: number, kias: number, extra: string[] = []): Step[] => {
  const q = ac.procedures.perf!;
  return [
    { id: 'setup', title: 'Set up and clear the area', start: 0, end: m.slow, detail: setupText(q, ['This is an instructor demonstration: brief what the student will see and why it happens.']) },
    { id: 'config', title: 'Approach configuration and glide', start: m.slow, end: m.entry, detail: [
      `Power to ${pwT(ac, ac.pw.reduce)}${ac.retractable ? ', gear DOWN' : ''}, flaps ${fl(ac, flapsWant)}, slow to ${kias} KIAS.`,
      'Power idle and establish a normal glide, as on final.',
      ...extra,
    ] },
  ];
};

// ─────────────────────────────────────────────────────────────── Secondary stall
export function buildSecondaryStall(ac: AircraftProfile, _cert: Cert = 'cfi'): ManeuverRun {
  const { p, q } = needs(ac);
  const alt = q.airworkAltFt, full = fullFlaps(ac), stallK = q.stallFlaps30Kias, hornK = stallK + q.stallWarnMarginKt;
  const sim = cruiseSim(ac, alt, q.airworkGroundFt);
  const s = sim.s;
  const horn = () => { s.warn = s.ias <= hornK ? 'STALL' : undefined; };
  toApproachGlide(sim, alt, full, p.finalKias, 0.55);
  sim.mark('entry');
  // First stall.
  let t0 = s.t;
  const p0 = levelPitch(ac, s.ias, s.flaps) - 4;
  sim.tgt.ias = stallK - 1; sim.tgt.accel = 1.5;
  sim.until(() => s.ias <= stallK, () => {
    s.pitch = lerp(p0, 11, smoothstep(0, 4, s.t - t0));
    s.elevBias = lerp(0, 0.65, smoothstep(p.finalKias, stallK, s.ias));
    sim.tgt.vs = -350; sim.tgt.vsRate = 150; horn();
  });
  sim.mark('stall1');
  t0 = s.t;
  sim.for(1.2, () => { s.pitch = lerp(11, 3, smoothstep(0, 1.2, s.t - t0)); sim.tgt.vs = -950; sim.tgt.vsRate = 900; horn(); });
  // Improper recovery: power comes in but the nose is hauled up before flying speed.
  sim.mark('improper');
  t0 = s.t;
  sim.power(fullPower(ac));
  sim.tgt.ias = stallK + 5; sim.tgt.accel = 2.5;
  sim.for(2, () => { s.pitch = lerp(3, 0, smoothstep(0, 1, s.t - t0)); s.elevBias = lerp(0.65, 0.1, smoothstep(0, 1, s.t - t0)); sim.tgt.vs = -600; horn(); s.rudderBias = 0.25; });
  t0 = s.t;
  sim.tgt.ias = stallK; sim.tgt.accel = 2.2;
  sim.until(() => s.ias <= stallK + 0.2 && s.t - t0 > 2, () => {
    s.pitch = lerp(0, 14, smoothstep(0, 2, s.t - t0));
    s.elevBias = lerp(0.1, 0.75, smoothstep(0, 1.5, s.t - t0));
    sim.tgt.vs = lerp(-600, 150, smoothstep(0, 2, s.t - t0)); sim.tgt.vsRate = 600; horn();
  });
  s.warn = 'STALL';
  sim.mark('stall2');
  t0 = s.t;
  sim.for(1.2, () => { s.pitch = lerp(14, 5, smoothstep(0, 1.2, s.t - t0)); sim.tgt.vs = -1000; sim.tgt.vsRate = 1000; });
  sim.mark('recover');
  recoverAndClimb(sim, alt, 5);
  const m = sim.marks;
  const steps: Step[] = [
    ...entrySteps(ac, m, full, p.finalKias),
    { id: 'stall1', title: 'First stall', start: m.entry, end: m.improper, detail: [
      'Raise the nose to a landing attitude and hold it until the full stall: warning, buffet, break.',
    ] },
    { id: 'improper', title: 'Improper recovery', start: m.improper, end: m.stall2, detail: [
      'Power comes in, but the pilot hurries to stop the altitude loss and pulls the nose up before the wing is flying again.',
      'This is the common student error being demonstrated: abrupt back pressure, or not lowering the nose enough.',
      'The angle of attack goes straight back past critical.',
    ] },
    { id: 'stall2', title: 'Secondary stall', start: m.stall2, end: m.recover, detail: [
      'The airplane stalls again — this time with power on and more altitude already lost.',
    ] },
    ...recoverySteps(ac, m, m.recover),
  ];
  return airworkRun({
    id: 'secondary-stall', title: 'Secondary Stall (Demonstration)', acsCode: 'AI.X.H', acsTask: 'Area X, Task H',
    objective: 'Show how rushing a stall recovery — raising the nose before flying speed is regained — produces a second stall, then recover correctly.',
    sim, steps, tolerances: baseTolerances(m, alt, m.entry, m.climb),
    bugs: { altitudeFt: alt, heading: 360, ias: p.finalKias },
    notes: ['Teaching point: recovery is about angle of attack, not altitude. Accept the altitude loss until the wing is flying.'],
  });
}

// ─────────────────────────────────────────────────────────────── Cross-controlled stall
export function buildCrossControlStall(ac: AircraftProfile, _cert: Cert = 'cfi'): ManeuverRun {
  const { p, q } = needs(ac);
  const alt = Math.max(q.airworkAltFt, q.airworkGroundFt + 3000);
  const flapsWant = 0, glideK = p.baseKias, stallK = q.stallCleanKias + 2, hornK = stallK + q.stallWarnMarginKt;
  const sim = cruiseSim(ac, alt, q.airworkGroundFt);
  const s = sim.s;
  toApproachGlide(sim, alt, flapsWant, glideK, 0.4);
  sim.mark('entry');
  sim.rollTo(-25, 3, () => { sim.tgt.vs = -500; });
  sim.mark('skid');
  const t0 = s.t, p0 = levelPitch(ac, s.ias, s.flaps) - 4;
  sim.tgt.ias = hornK - 0.5; sim.tgt.accel = 1.6;
  sim.until(() => s.ias <= hornK, () => {
    const u = smoothstep(0, 5, s.t - t0);
    s.bank = -25;
    s.rudderBias = -0.65 * u;                       // too much rudder into the turn
    s.aileronBias = 0.45 * u;                       // opposite aileron holding the bank
    s.slip = 0.85 * u;                              // ball thrown to the outside: a skid
    s.pitch = lerp(p0, 9, u);
    s.elevBias = lerp(0, 0.6, u);
    sim.tgt.vs = -400; sim.tgt.vsRate = 150;
  });
  s.warn = 'STALL';
  sim.mark('horn');
  sim.for(0.8, () => { sim.tgt.vs = -500; });
  sim.mark('recover');
  recoverAndClimb(sim, alt, 9);
  const m = sim.marks;
  const steps: Step[] = [
    ...entrySteps(ac, m, flapsWant, glideK, ['Flaps stay up for this demonstration; many airplanes limit slips and skids with flaps extended.']),
    { id: 'turn', title: 'Medium-banked gliding turn', start: m.entry, end: m.skid, detail: [
      'Roll into a 25° bank, as on a base-to-final turn.',
      'Imagine having overshot the runway centerline.',
    ] },
    { id: 'skid', title: 'Rudder in, opposite aileron, back pressure', start: m.skid, end: m.horn, detail: [
      'To tighten the turn without steepening the bank, the pilot adds rudder toward the turn — a skid.',
      'The bank tries to increase, so opposite aileron is held to stop it. The controls are now crossed.',
      'The nose drops with the skid, so back pressure is added. Ball is thrown to the outside of the turn.',
      'The inside wing is now slower and at a higher angle of attack than the outside wing.',
    ] },
    { id: 'horn', title: 'First indication of the stall', start: m.horn, end: m.recover, detail: [
      `Warning or buffet at about ${hornK} KIAS. Recover now.`,
      'Left to develop, the inside wing drops sharply and the airplane rolls toward inverted — at pattern altitude there is no room to recover.',
    ] },
    ...recoverySteps(ac, m, m.recover),
  ];
  return airworkRun({
    id: 'cross-control-stall', title: 'Cross-Controlled Stall (Demonstration)', acsCode: 'AI.X.F', acsTask: 'Area X, Task F',
    objective: 'Show how a skidding base-to-final turn with crossed controls leads to a stall with little warning, and recover at the first indication.',
    sim, steps,
    tolerances: [
      { id: 'agl', label: 'Height above ground', unit: 'ft', standard: 'Recover above 1,500 ft AGL', value: (f) => f.altFt - q.airworkGroundFt, target: 3000, minus: 1500, plus: 2500, windows: [[m.entry, m.climb]] },
      { id: 'ret', label: 'Back to altitude', unit: 'ft', standard: '±100 ft', value: (f) => f.altFt, target: alt, minus: 100, plus: 100, windows: [[m.level + 2, m.level + 8]] },
    ],
    bugs: { altitudeFt: alt, heading: 360, ias: glideK },
    notes: [`Shown at ${n(alt)} ft MSL. Teaching point: fix an overshoot with a coordinated turn or a go-around, never with rudder.`],
  });
}

// ─────────────────────────────────────────────────────────────── Elevator trim stall
export function buildElevatorTrimStall(ac: AircraftProfile, _cert: Cert = 'cfi'): ManeuverRun {
  const { p, q } = needs(ac);
  const alt = q.airworkAltFt, full = fullFlaps(ac), stallK = q.stallFlaps30Kias + 2, hornK = stallK + q.stallWarnMarginKt;
  const sim = cruiseSim(ac, alt, q.airworkGroundFt);
  const s = sim.s;
  toApproachGlide(sim, alt, full, p.finalKias, 0.8);
  sim.mark('entry');
  sim.for(3, () => { sim.tgt.vs = -500; });
  sim.mark('power');
  const t0 = s.t, p0 = levelPitch(ac, s.ias, s.flaps) - 4;
  sim.power(fullPower(ac));
  sim.tgt.ias = hornK - 0.5; sim.tgt.accel = 2.4;
  sim.until(() => s.ias <= hornK, () => {
    const u = smoothstep(0, 4, s.t - t0);
    s.pitch = lerp(p0, 20, u);                      // the nose-up trim takes over
    s.elevBias = 0;
    s.rudderBias = 0.05;                            // not enough right rudder: it yaws left
    s.slip = 0.5 * u;
    s.yaw = -4 * u;
    sim.tgt.vs = lerp(-500, 700, u); sim.tgt.vsRate = 500;
  });
  s.warn = 'STALL';
  sim.mark('horn');
  sim.for(0.8);
  sim.mark('recover');
  s.yaw = 0;
  recoverAndClimb(sim, alt, 20);
  const m = sim.marks;
  const steps: Step[] = [
    ...entrySteps(ac, m, full, p.finalKias, ['Trim nose-up for the glide, as you would on final.']),
    { id: 'trimmed', title: 'Trimmed glide on "final"', start: m.entry, end: m.power, detail: [
      `${p.finalKias} KIAS, flaps ${fl(ac, full)}, power idle, trimmed hands-off with a lot of nose-up trim.`,
    ] },
    { id: 'power', title: 'Go-around power, no forward pressure', start: m.power, end: m.horn, detail: [
      'Full power, as for a go-around — but the pilot does not hold the nose down or re-trim.',
      'Thrust and propwash on the nose-up-trimmed tail pitch the airplane up well above a normal climb attitude.',
      'Torque and P-factor yaw and roll it left; the ball slides right.',
      'Airspeed falls quickly.',
    ] },
    { id: 'horn', title: 'First indication of the stall', start: m.horn, end: m.recover, detail: [
      `Warning or buffet at about ${hornK} KIAS, nose very high. Recover now.`,
    ] },
    ...recoverySteps(ac, m, m.recover).map((st, i) => (i === 0 ? { ...st, detail: [
      'Firm forward pressure to a normal climb attitude — expect to push hard against the trim.',
      'Right rudder to center the ball; trim nose down to relieve the pressure.',
      `Flaps to ${fl(ac, q.balkedFlaps)} and continue the go-around.`,
    ] } : st)),
  ];
  return airworkRun({
    id: 'elevator-trim-stall', title: 'Elevator Trim Stall (Demonstration)', acsCode: 'AI.X.G', acsTask: 'Area X, Task G',
    objective: 'Show what happens when go-around power is applied with full approach trim and no forward pressure, and recover at the first indication.',
    sim, steps, tolerances: baseTolerances(m, alt, m.entry, m.power),
    bugs: { altitudeFt: alt, heading: 360, ias: p.finalKias },
    notes: ['Teaching point: on every go-around, the first job is to hold the pitch attitude and re-trim.'],
  });
}

export const _cfiCert: Cert = 'cfi';
