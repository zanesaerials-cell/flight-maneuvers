import { fl, flapUpOne, pwFrac, pwT, type AircraftProfile, type Cert } from '../data/aircraft';
import { std } from './standards';
import { KCXW } from '../data/airports';
import { FT, lerp, levelPitch, smoothstep, wrap360 } from '../engine/kinematics';
import { SIM_DT, Sim, approachLaw, runwayFrame } from '../engine/sim';
import type { Frame, ManeuverRun, SceneLabel, Step, Tolerance } from '../engine/types';

/*
 * Takeoff and landing variants, all flown on runway 22 at Conway (KCXW), calm wind.
 * Each one isolates its phase: takeoffs end established in the climb, landings
 * start on a stabilized final.
 */

export const APT = KCXW;
export const END = '22';

export type Rf = ReturnType<typeof runwayFrame>;
const fmtH = (h: number) => String(Math.round(wrap360(h)) || 360).padStart(3, '0');
const n = (x: number) => Math.round(x).toLocaleString();

function needs(ac: AircraftProfile) {
  const p = ac.procedures.pattern, q = ac.procedures.perf;
  if (!p || !q) throw new Error(`${ac.shortName} has no takeoff/landing profile`);
  return { p, q };
}

export function groundSim(ac: AircraftProfile, rf: Rf, startAlong: number, rolling = 0, flaps = 0) {
  const at = rf.at(startAlong);
  const sim = new Sim(ac, {
    east: at.e, north: at.n, hdg: rf.hdg, altFt: APT.elevFt, elevFt: APT.elevFt,
    ias: rolling, rpm: ac.pw.taxi, flaps, onGround: true, throttle: pwFrac(ac, ac.pw.taxi), trim: 0,
  });
  sim.s.pitch = 0.5;
  sim.raw[0].pitch = 0.5;
  return sim;
}

export function finalSim(ac: AircraftProfile, rf: Rf, distFromAim: number, aimAlong: number, aglFt: number, ias: number, flaps: number, rpm: number, trim: number, pathDeg = 3.5) {
  const at = rf.at(aimAlong - distFromAim);
  const sim = new Sim(ac, {
    east: at.e, north: at.n, hdg: rf.hdg, altFt: APT.elevFt + aglFt, elevFt: APT.elevFt,
    ias, rpm, flaps, onGround: false, throttle: (rpm - ac.rpm.idle) / (ac.rpm.max - ac.rpm.idle), trim,
  });
  // Already established on the glidepath: descending at the path's rate.
  const fpm = -ias * 101.27 * Math.tan((pathDeg * Math.PI) / 180);
  sim.s.vs = fpm; sim.tgt.vs = fpm;
  return sim;
}

/** Ground roll to rotation, with right rudder growing as P-factor builds. */
export function takeoffRoll(sim: Sim, rotateKias: number, accel: number, opts: { tailLow?: boolean } = {}) {
  const s = sim.s;
  const t0 = s.t;
  sim.tgt.throttle = 1;
  sim.tgt.rpm = sim.ac.procedures.pattern!.takeoffRpm;
  s.pitch = 0.5;
  while (s.ias < rotateKias) {
    s.rudderBias = 0.08 + 0.18 * (s.ias / rotateKias);
    if (opts.tailLow) s.elevBias = 0.12 * smoothstep(20, 40, s.ias);
    sim.tick(accel * smoothstep(0, 2.5, s.t - t0));
  }
}

/** Rotate, lift off, then hand pitch back to the flight model. */
export function rotateAndLiftOff(sim: Sim, liftoffKias: number, accel: number, rotPitch = 8) {
  const s = sim.s;
  sim.mark('rotate');
  const t0 = s.t;
  while (s.ias < liftoffKias) {
    s.elevBias = Math.min(0.35, s.elevBias + 0.4 * SIM_DT);
    s.pitch = lerp(0.5, rotPitch, smoothstep(0, 2.2, s.t - t0));
    sim.tick(accel * 0.85);
  }
  s.onGround = false;
  sim.mark('liftoff');
}

/** Fly the final approach to touchdown, then roll out to taxi speed. */
export function finalToStop(sim: Sim, rf: Rf, o: {
  aimAlong: number; pathDeg: number; tdKias: number; decel: number; idleAtAlong: number;
  flareGain?: number; touchdownFpm?: number; flareFt?: number; flareRpm?: number;
  noseHigh?: boolean; flapsUpOnRollout?: boolean; endKias?: number;
}) {
  const s = sim.s;
  let flaring = false;
  sim.until(() => s.alt <= APT.elevFt + 0.05, () => {
    const along = rf.along(sim.pos());
    if (along > o.idleAtAlong && !sim.marks.idle) {
      sim.mark('idle');
      sim.tgt.rpm = o.flareRpm ?? sim.ac.rpm.idle;
      sim.tgt.throttle = o.flareRpm ? 0.25 : 0;
    }
    approachLaw(sim, o.aimAlong - along, o.pathDeg, o.flareFt ?? 15, o.flareGain, o.touchdownFpm);
    if (sim.agl <= (o.flareFt ?? 15) && !flaring) {
      flaring = true; sim.mark('flare');
      sim.tgt.ias = o.tdKias; sim.tgt.accel = 4;
    }
    if (flaring) s.elevBias = Math.min(o.noseHigh ? 0.7 : 0.5, s.elevBias + 0.25 * SIM_DT);
  }, 400);
  s.alt = APT.elevFt; s.vs = 0; s.onGround = true;
  sim.mark('touchdown');
  const t0 = s.t;
  const tdPitch = levelPitch(sim.ac, s.ias, s.flaps) + 2;
  if (o.flapsUpOnRollout) sim.tgt.flaps = 0;
  sim.tgt.rpm = sim.ac.rpm.idle; sim.tgt.throttle = 0;
  while (s.ias > (o.endKias ?? 12)) {
    const holdUntil = o.noseHigh ? s.ias > 25 : s.t - t0 < 1.5;
    s.pitch = holdUntil ? tdPitch : lerp(s.pitch ?? tdPitch, 0.5, 0.04);
    s.elevBias = o.noseHigh ? 0.8 : Math.max(0.2, s.elevBias - 0.1 * SIM_DT);
    s.rudderBias = Math.max(0, s.rudderBias - 0.2 * SIM_DT);
    sim.tick(-o.decel * smoothstep(0, 1.5, s.t - t0));
  }
  for (let i = 0; i < 30; i++) sim.tick(-0.8);
}

/** Keep climbing at `fpm` until passing `aglFt` (no level-off — the climb continues). */
export function climbTo(sim: Sim, aglFt: number, fpm: number, during?: () => void) {
  sim.until(() => sim.agl >= aglFt - 1, () => { if (sim.agl > 60) sim.gearUp(); sim.s.elevBias = Math.max(0.05, sim.s.elevBias - 0.2 * SIM_DT); sim.tgt.vs = fpm; sim.tgt.vsRate = 250; during?.(); }, 300);
}

export function run(base: {
  id: string; title: string; acsCode: string; acsTask: string; objective: string;
  sim: Sim; rf: Rf; steps: Step[]; tolerances: Tolerance[]; bugs: ManeuverRun['bugs']; notes: string[]; labels?: SceneLabel[];
}, cruiseRpm: number): ManeuverRun {
  const frames: Frame[] = base.sim.build(cruiseRpm);
  const duration = frames[frames.length - 1].t;
  base.steps[base.steps.length - 1].end = duration;
  const es = frames.map((f) => f.east), ns = frames.map((f) => f.north);
  const cx = (Math.min(...es) + Math.max(...es)) / 2, cn = (Math.min(...ns) + Math.max(...ns)) / 2;
  const radius = Math.max(600, Math.max(Math.max(...es) - Math.min(...es), Math.max(...ns) - Math.min(...ns)) / 2 * 1.15);
  return {
    id: base.id, title: base.title, acsCode: base.acsCode, acsTask: base.acsTask, objective: base.objective,
    frames, dt: SIM_DT, duration, steps: base.steps, tolerances: base.tolerances,
    scene: {
      groundElevFt: APT.elevFt, roads: [],
      runways: [base.rf.scene],
      labels: base.labels,
      frameRadius: radius, frameCenter: [cx, cn],
    },
    bugs: base.bugs,
    notes: ['Calm wind, runway 22 at Conway (KCXW), field elevation 276 ft.', ...base.notes],
  };
}

export const gearUpLine = (ac: AircraftProfile) => (ac.retractable ? ['Positive rate, no usable runway remaining: gear UP.'] : []);
export const gearDownLine = (ac: AircraftProfile) => (ac.retractable ? ['Gear DOWN — three green, confirmed again on final.'] : []);
export const lineupText = (ac: AircraftProfile, rf: Rf, flaps: number, extra: string[] = []) => [
  `Runway ${END}, ${n(rf.rwy.lengthFt)} × ${rf.rwy.widthFt} ft. Before-takeoff checklist complete; announce on the CTAF.`,
  `Flaps ${fl(ac, flaps)}, ${ac.text.lineup}, heading bug ${fmtH(rf.hdg)}.`,
  ...extra,
];

// ─────────────────────────────────────────────────────────────── Normal takeoff
export function buildNormalTakeoff(ac: AircraftProfile, cert: Cert = 'private'): ManeuverRun {
  const st = std(cert); void st;
  const { p } = needs(ac);
  const rf = runwayFrame(APT, END);
  const sim = groundSim(ac, rf, rf.threshold + 15, 0, p.takeoffFlaps);
  sim.s.flaps = p.takeoffFlaps; sim.tgt.flaps = p.takeoffFlaps;
  sim.for(2.5);
  sim.mark('roll');
  takeoffRoll(sim, p.rotateKias, p.groundAccel);
  rotateAndLiftOff(sim, p.liftoffKias, p.groundAccel);
  const s = sim.s;
  s.pitch = undefined;
  sim.tgt.ias = p.climbKias; sim.tgt.accel = 1.2; sim.tgt.rpm = p.climbRpm; sim.tgt.trim = 0.25;
  climbTo(sim, 150, p.climbFpm, () => { s.rudderBias = Math.max(0.12, s.rudderBias - 0.05 * SIM_DT); });
  sim.mark('vy');
  climbTo(sim, 600, p.climbFpm, () => { if (sim.agl > 300) sim.tgt.flaps = 0; });
  sim.mark('climb');
  sim.for(8, () => sim.holdAlt(APT.elevFt + 1100, p.climbFpm));

  const m = sim.marks;
  const steps: Step[] = [
    { id: 'lineup', title: `Line up on runway ${END}`, start: 0, end: m.roll, detail: lineupText(ac, rf, p.takeoffFlaps, ['Centered on the centerline, nosewheel straight.']) },
    { id: 'roll', title: 'Takeoff roll', start: m.roll, end: m.rotate, detail: [
      'Smoothly apply full power. Check engine gauges in the green.',
      'Right rudder to hold the centerline as P-factor and slipstream build.',
      'Ailerons neutral in calm wind; airspeed alive.',
    ] },
    { id: 'rotate', title: `Rotate at ${p.rotateKias} KIAS`, start: m.rotate, end: m.liftoff + 2, detail: [
      'Gentle back pressure to raise the nose to the takeoff attitude.',
      `Let it fly off at about ${p.liftoffKias} KIAS.`,
    ] },
    { id: 'vy', title: `Accelerate to Vy, ${p.climbKias} KIAS`, start: m.liftoff + 2, end: m.vy, detail: [
      'Lower the nose slightly to let airspeed build to Vy.',
      'Keep right rudder in to hold the ball centered and track the centerline.',
      'Positive rate of climb — trim.',
      ...gearUpLine(ac),
    ] },
    { id: 'climb', title: 'Climb out at Vy', start: m.vy, end: m.climb, detail: [
      `Hold ${p.climbKias} KIAS with pitch, about 10° nose up, full power.`,
      ...(p.takeoffFlaps > 0 ? ['At a safe altitude (about 300 ft AGL shown), flaps up.'] : []),
      'Maintain runway heading and the extended centerline.',
      'Engine gauges green; clear the area ahead.',
    ] },
    { id: 'done', title: 'Established in the climb', start: m.climb, end: 0, detail: [
      'Continue straight out or turn crosswind once past the departure end and within 300 ft of pattern altitude.',
    ] },
  ];
  return run({
    id: 'normal-takeoff', title: 'Normal Takeoff and Climb', acsCode: 'PA.IV.A', acsTask: 'Area IV, Task A',
    objective: 'Takeoff from a hard surface with directional control, rotation at the POH speed and a climb at Vy.',
    sim, rf, steps,
    tolerances: [
      { id: 'vy', label: 'Climb speed (Vy)', unit: 'kt', standard: st.climb.label, value: (f) => f.ias, target: p.climbKias, minus: st.climb.minus, plus: st.climb.plus, windows: [[m.vy, m.climb + 8]] },
      { id: 'cl', label: 'Centerline', unit: 'ft', standard: 'On centerline', value: (f) => rf.lateral({ e: f.east, n: f.north }) / FT, target: 0, minus: 10, plus: 10, windows: [[m.roll, m.liftoff]] },
    ],
    bugs: { altitudeFt: APT.elevFt + APT.tpaAglFt, heading: rf.hdg, ias: p.climbKias },
    notes: [],
  }, p.downwindRpm);
}

// ─────────────────────────────────────────────────────────────── Normal landing
export function buildNormalLanding(ac: AircraftProfile, cert: Cert = 'private'): ManeuverRun {
  const st = std(cert); void st;
  const { p } = needs(ac);
  const rf = runwayFrame(APT, END);
  const aim = rf.threshold + 1000 * FT;
  const path = 3.5;
  const dist = 2100;
  const sim = finalSim(ac, rf, dist, aim, dist * Math.tan(path * Math.PI / 180) / FT, p.finalKias, p.finalFlaps, p.abeamRpm, 0.45);
  sim.tgt.ias = p.finalKias;
  sim.for(0.5);
  finalToStop(sim, rf, { aimAlong: aim - Math.max(0, p.finalKias - 65) * 2.2, pathDeg: path, tdKias: p.touchdownKias, decel: p.landingDecel, idleAtAlong: rf.threshold - 20 });
  const m = sim.marks;
  const mid = (m.idle - 0) * 0.55;
  const steps: Step[] = [
    { id: 'final', title: 'Stabilized on final', start: 0, end: mid, detail: [
      `Flaps ${fl(ac, p.finalFlaps)}, ${p.finalKias} KIAS, about ${pwT(ac, p.abeamRpm)}, trimmed.`,
      ...gearDownLine(ac),
      'On centerline, on a steady glidepath of roughly 3–4°, about 500 fpm down.',
      'Aim point is the 1,000 ft markers — it stays fixed in the windshield when the path is right.',
    ] },
    { id: 'aim', title: 'Hold the aim point', start: mid, end: m.idle, detail: [
      'Pitch for airspeed, power for the path: aim point moving up means you are getting low — add a little power.',
      'Small corrections only; stay stabilized below 500 ft AGL.',
    ] },
    { id: 'threshold', title: 'Over the threshold — power idle', start: m.idle, end: m.flare, detail: [
      'Close the throttle smoothly.',
      'Shift your eyes toward the far end of the runway.',
    ] },
    { id: 'flare', title: 'Round-out and flare', start: m.flare, end: m.touchdown + 0.5, detail: [
      'Begin the round-out about 10–15 ft above the runway.',
      'Increase back pressure as the airplane settles, holding it just off the runway.',
      `Touch down on the main wheels first at about ${p.touchdownKias} KIAS, close to the stall.`,
    ] },
    { id: 'rollout', title: 'Rollout', start: m.touchdown + 0.5, end: 0, detail: [
      'Lower the nosewheel gently; rudder for the centerline.',
      'Brake as needed. Flaps up and after-landing checklist once clear of the runway.',
    ] },
  ];
  return run({
    id: 'normal-landing', title: 'Normal Approach and Landing', acsCode: 'PA.IV.B', acsTask: 'Area IV, Task B',
    objective: 'Stabilized approach at the recommended speed and a touchdown at or within 400 ft beyond the selected point.',
    sim, rf, steps,
    tolerances: [
      { id: 'app', label: 'Approach speed', unit: 'kt', standard: st.approach.label, value: (f) => f.ias, target: p.finalKias, minus: st.approach.minus, plus: st.approach.plus, windows: [[0, m.flare]] },
      tdTolerance(rf, aim, m.touchdown, st.tdNormal, `At or within ${st.tdNormal} ft beyond`),
    ],
    bugs: { altitudeFt: APT.elevFt + APT.tpaAglFt, heading: rf.hdg, ias: p.finalKias },
    notes: ['Aim point: the 1,000 ft aiming-point markers.'],
  }, p.downwindRpm);
}

export function tdTolerance(rf: Rf, aim: number, tdT: number, beyond: number, std: string): Tolerance {
  return {
    id: 'td', label: 'Touchdown past aim point', unit: 'ft', standard: std,
    value: (f: Frame) => (rf.along({ e: f.east, n: f.north }) - aim) / FT, target: beyond / 2, minus: beyond / 2, plus: beyond / 2,
    windows: [[tdT, tdT + 0.1]],
  };
}

// ─────────────────────────────────────────────────────────────── Soft-field takeoff
export function buildSoftTakeoff(ac: AircraftProfile, cert: Cert = 'private'): ManeuverRun {
  const st = std(cert); void st;
  const { p, q } = needs(ac);
  const rf = runwayFrame(APT, END);
  const sim = groundSim(ac, rf, rf.threshold - 25, 8, q.softTakeoffFlaps);
  const s = sim.s;
  sim.tgt.flaps = q.softTakeoffFlaps; s.flaps = q.softTakeoffFlaps;
  sim.power(ac.pw.taxi);
  sim.mark('taxi');
  // Rolling onto the runway without stopping, full back pressure.
  while (rf.along(sim.pos()) < rf.threshold + 5) { s.elevBias = Math.min(0.8, s.elevBias + 0.5 * SIM_DT); s.pitch = 0.5; sim.tick(0); }
  sim.mark('roll');
  const t0 = s.t;
  sim.tgt.throttle = 1; sim.tgt.rpm = p.takeoffRpm;
  // Nose comes up as soon as the elevator has authority; ease off to hold a modest nose-high attitude.
  while (s.ias < q.softLiftoffKias) {
    const up = smoothstep(18, 32, s.ias);
    s.pitch = lerp(0.5, 7.5, up);
    s.elevBias = lerp(0.8, 0.45, up);
    s.rudderBias = 0.1 + 0.15 * (s.ias / q.softLiftoffKias);
    if (up > 0.5 && !sim.marks.noseUp) sim.mark('noseUp');
    sim.tick(p.groundAccel * 0.85 * smoothstep(0, 2.5, s.t - t0));
  }
  s.onGround = false;
  sim.mark('liftoff');
  // Level off in ground effect and accelerate.
  sim.tgt.ias = ac.speeds.vx; sim.tgt.accel = 1.6;
  sim.until(() => s.ias >= ac.speeds.vx - 0.5, () => {
    sim.holdAlt(APT.elevFt + 8, 200, 6);
    s.pitch = lerp(s.pitch ?? 5, 3, 0.03);
    s.elevBias = lerp(s.elevBias, 0.05, 0.03);
  });
  s.pitch = undefined;
  sim.mark('climb');
  sim.tgt.ias = p.climbKias; sim.tgt.rpm = p.climbRpm; sim.tgt.trim = 0.25;
  climbTo(sim, 300, p.climbFpm);
  sim.mark('flapsUp');
  sim.tgt.flaps = 0;
  climbTo(sim, 600, p.climbFpm);
  sim.mark('done');
  sim.for(6, () => sim.holdAlt(APT.elevFt + 1000, p.climbFpm));
  const m = sim.marks;
  const steps: Step[] = [
    { id: 'taxi', title: 'Roll onto the runway without stopping', start: 0, end: m.roll, detail: lineupText(ac, rf, q.softTakeoffFlaps, [
      'Hold full back elevator while taxiing to take weight off the nosewheel.',
      'Keep moving — stopping on a soft surface can bog the wheels down.',
    ]) },
    { id: 'roll', title: 'Full power, nose up early', start: m.roll, end: m.noseUp, detail: [
      'Smoothly apply full throttle while still rolling.',
      'Keep full back pressure; as the elevator gains authority the nosewheel lifts.',
      'Right rudder for the centerline.',
    ] },
    { id: 'attitude', title: 'Hold the nose-high attitude', start: m.noseUp, end: m.liftoff, detail: [
      'Ease back pressure to hold a modest nose-high attitude — the wing, not the nosewheel, carries the weight.',
      `The airplane lifts off at about ${q.softLiftoffKias} KIAS, below normal rotation speed.`,
    ] },
    { id: 'effect', title: 'Level off in ground effect', start: m.liftoff, end: m.climb, detail: [
      'Immediately lower the nose slightly to stay within a few feet of the runway.',
      `Accelerate in ground effect to Vx (${ac.speeds.vx} KIAS) or Vy before climbing.`,
      'Climbing too early at low speed can settle the airplane back onto the surface.',
    ] },
    { id: 'climb', title: `Climb at Vy, ${p.climbKias} KIAS`, start: m.climb, end: m.flapsUp, detail: [
      'Raise the nose to the Vy attitude, full power, right rudder.',
      `Flaps stay at ${fl(ac, q.softTakeoffFlaps)} until a safe altitude.`,
      ...gearUpLine(ac),
    ] },
    { id: 'flaps', title: 'Flaps up at a safe altitude', start: m.flapsUp, end: 0, detail: [
      'At 300 ft AGL, retract the flaps slowly with positive rate and climb speed.',
      'Trim and continue the climb.',
    ] },
  ];
  return run({
    id: 'soft-takeoff', title: 'Soft-Field Takeoff and Climb', acsCode: 'PA.IV.C', acsTask: 'Area IV, Task C',
    objective: 'Get the weight onto the wings as early as possible, lift off at the lowest practical speed, and accelerate in ground effect before climbing.',
    sim, rf, steps,
    tolerances: [
      { id: 'climb', label: 'Climb speed', unit: 'kt', standard: st.climb.label, value: (f) => f.ias, target: p.climbKias, minus: st.climb.minus, plus: st.climb.plus, windows: [[m.climb + 6, m.done + 6]] },
      { id: 'ge', label: 'Height in ground effect', unit: 'ft', standard: 'Within a few feet', value: (f) => f.altFt - APT.elevFt, target: 8, minus: 8, plus: 12, windows: [[m.liftoff + 2, m.climb]] },
    ],
    bugs: { altitudeFt: APT.elevFt + APT.tpaAglFt, heading: rf.hdg, ias: p.climbKias },
    notes: ['Shown on the paved runway; the technique is the same on grass, sand or mud.'],
  }, p.downwindRpm);
}

// ─────────────────────────────────────────────────────────────── Soft-field landing
export function buildSoftLanding(ac: AircraftProfile, cert: Cert = 'private'): ManeuverRun {
  const st = std(cert); void st;
  const { p, q } = needs(ac);
  const rf = runwayFrame(APT, END);
  const aim = rf.threshold + 1000 * FT;
  const path = 3.5, dist = 1900;
  const sim = finalSim(ac, rf, dist, aim, dist * Math.tan(path * Math.PI / 180) / FT, q.softApproachKias, p.finalFlaps, p.abeamRpm, 0.5);
  sim.for(0.5);
  finalToStop(sim, rf, {
    aimAlong: aim, pathDeg: path, tdKias: q.softTouchdownKias, decel: 0.9, idleAtAlong: rf.threshold - 20,
    flareRpm: ac.pw.softFlare, flareGain: 18, touchdownFpm: 50, noseHigh: true, endKias: 10,
  });
  const m = sim.marks;
  const steps: Step[] = [
    { id: 'final', title: 'Stabilized on final', start: 0, end: m.idle, detail: [
      `Flaps ${fl(ac, p.finalFlaps)}, ${q.softApproachKias} KIAS, trimmed.`,
      'Same stabilized approach as normal, aiming to touch down as softly and slowly as possible.',
    ] },
    { id: 'power', title: 'Keep a little power in the flare', start: m.idle, end: m.flare, detail: [
      'Reduce power but do not close the throttle — a small amount lets you control the sink rate.',
    ] },
    { id: 'flare', title: 'Flare and touch down at minimum speed', start: m.flare, end: m.touchdown + 0.5, detail: [
      'Hold the airplane 1–2 ft off the surface as long as possible.',
      `Touch down nose-high at the slowest possible speed, about ${q.softTouchdownKias} KIAS.`,
    ] },
    { id: 'rollout', title: 'Hold the nosewheel off', start: m.touchdown + 0.5, end: 0, detail: [
      'Keep increasing back pressure to hold the nosewheel off as long as the elevator allows.',
      'Lower it gently; avoid braking, and keep a little power to keep rolling on a soft surface.',
    ] },
  ];
  return run({
    id: 'soft-landing', title: 'Soft-Field Approach and Landing', acsCode: 'PA.IV.D', acsTask: 'Area IV, Task D',
    objective: 'Touch down softly at the lowest possible speed and keep weight off the nosewheel through the rollout.',
    sim, rf, steps,
    tolerances: [
      { id: 'app', label: 'Approach speed', unit: 'kt', standard: st.approach.label, value: (f) => f.ias, target: q.softApproachKias, minus: st.approach.minus, plus: st.approach.plus, windows: [[0, m.flare]] },
      { id: 'sink', label: 'Sink rate at touchdown', unit: 'fpm', standard: 'As soft as possible', value: (f) => -f.vsi, target: 50, minus: 50, plus: 100, windows: [[m.touchdown - 0.4, m.touchdown - 0.05]] },
    ],
    bugs: { altitudeFt: APT.elevFt + APT.tpaAglFt, heading: rf.hdg, ias: q.softApproachKias },
    notes: ['Shown on the paved runway; the technique is the same on grass, sand or mud.'],
  }, p.downwindRpm);
}

// ─────────────────────────────────────────────────────────────── Short-field takeoff
export function buildShortTakeoff(ac: AircraftProfile, cert: Cert = 'private'): ManeuverRun {
  const st = std(cert); void st;
  const { p, q } = needs(ac);
  const rf = runwayFrame(APT, END);
  const sim = groundSim(ac, rf, rf.threshold + 8, 0, q.shortTakeoffFlaps);
  const s = sim.s;
  s.flaps = q.shortTakeoffFlaps; sim.tgt.flaps = q.shortTakeoffFlaps;
  sim.for(2);
  sim.mark('brakes');
  sim.tgt.throttle = 1; sim.tgt.rpm = p.takeoffRpm;
  sim.for(3, () => { s.rudderBias = 0.06; });
  sim.mark('roll');
  takeoffRoll(sim, q.shortObstacleKias - 5, p.groundAccel * 1.05, { tailLow: true });
  rotateAndLiftOff(sim, q.shortObstacleKias - 2, p.groundAccel, 10);
  s.pitch = undefined;
  sim.tgt.ias = q.shortObstacleKias; sim.tgt.accel = 1.2; sim.tgt.rpm = p.climbRpm; sim.tgt.trim = 0.25;
  const obstacleAlong = rf.along(sim.pos()) + 160;
  climbTo(sim, 60, 760);
  sim.mark('cleared');
  sim.tgt.ias = p.climbKias; sim.tgt.accel = 0.9;
  sim.until(() => s.ias >= Math.min(p.climbKias - 2, q.shortObstacleKias + 4), () => sim.holdAlt(APT.elevFt + 1000, 600));
  sim.mark('flaps');
  sim.tgt.flaps = 0;
  sim.tgt.rpm = p.climbRpm;
  climbTo(sim, 450, p.climbFpm);
  sim.mark('vy');
  sim.for(8, () => sim.holdAlt(APT.elevFt + 1000, p.climbFpm));
  const m = sim.marks;
  const ob = rf.at(obstacleAlong);
  const steps: Step[] = [
    { id: 'lineup', title: 'Use all the runway', start: 0, end: m.brakes, detail: lineupText(ac, rf, q.shortTakeoffFlaps, ['Line up at the very start of the runway — every foot behind you is wasted.']) },
    { id: 'brakes', title: 'Full power on the brakes', start: m.brakes, end: m.roll, detail: [
      'Hold the brakes and smoothly apply full throttle.',
      'Check engine gauges before releasing.',
    ] },
    { id: 'roll', title: 'Release brakes, slightly tail low', start: m.roll, end: m.rotate, detail: [
      'Release the brakes and keep the centerline with rudder.',
      'Hold a slightly tail-low attitude so the airplane is ready to fly.',
    ] },
    { id: 'rotate', title: 'Rotate and lift off', start: m.rotate, end: m.liftoff + 1.5, detail: [
      'Rotate smoothly as you approach obstacle-clearance speed.',
    ] },
    { id: 'obstacle', title: `Climb at ${q.shortObstacleKias} KIAS over the obstacle`, start: m.liftoff + 1.5, end: m.cleared, detail: [
      `Climb at ${q.shortObstacleKias} KIAS with flaps ${fl(ac, q.shortTakeoffFlaps)} until all obstacles are cleared.`,
      'Shown clearing a 50 ft obstacle beyond the liftoff point.',
      'Steep nose-up attitude — keep the ball centered with right rudder.',
    ] },
    { id: 'accelerate', title: 'Accelerate, then flaps up', start: m.cleared, end: m.vy, detail: [
      'Lower the nose slightly and accelerate.',
      ...gearUpLine(ac),
      ...(q.shortTakeoffFlaps > 0 ? ['Retract the flaps slowly once accelerating with a positive rate.'] : []),
      `Continue to Vy, ${p.climbKias} KIAS.`,
    ] },
    { id: 'vy', title: 'Climb at Vy', start: m.vy, end: 0, detail: ['Full power, trimmed, on the extended centerline.'] },
  ];
  return run({
    id: 'short-takeoff', title: 'Short-Field Takeoff and Max Climb', acsCode: 'PA.IV.E', acsTask: 'Area IV, Task E',
    objective: 'Use the minimum runway and climb at the obstacle-clearance speed until a 50 ft obstacle is cleared, then accelerate to Vy.',
    sim, rf, steps,
    tolerances: [
      { id: 'vx', label: 'Obstacle clearance speed', unit: 'kt', standard: st.approach.label, value: (f) => f.ias, target: q.shortObstacleKias, minus: st.approach.minus, plus: st.approach.plus, windows: [[m.liftoff + 3, m.cleared]] },
      { id: 'vy', label: 'Climb speed (Vy)', unit: 'kt', standard: st.climb.label, value: (f) => f.ias, target: p.climbKias, minus: st.climb.minus, plus: st.climb.plus, windows: [[m.vy, m.vy + 8]] },
    ],
    bugs: { altitudeFt: APT.elevFt + APT.tpaAglFt, heading: rf.hdg, ias: q.shortObstacleKias },
    notes: ['The 50 ft obstacle is a marker for the demonstration; at Conway the runway end is clear.'],
    labels: [{ east: ob.e, north: ob.n, altFt: APT.elevFt + 50, text: '50 ft obstacle' }],
  }, p.downwindRpm);
}

// ─────────────────────────────────────────────────────────────── Short-field landing
export function buildShortLanding(ac: AircraftProfile, cert: Cert = 'private'): ManeuverRun {
  const st = std(cert); void st;
  const { p, q } = needs(ac);
  const rf = runwayFrame(APT, END);
  const aim = rf.threshold + 1000 * FT;
  const path = 4.5, dist = 1600;
  const sim = finalSim(ac, rf, dist, aim, dist * Math.tan(path * Math.PI / 180) / FT, q.shortApproachKias, p.finalFlaps, ac.pw.shortApproach, 0.5, path);
  sim.for(0.5);
  finalToStop(sim, rf, {
    aimAlong: aim - 25, pathDeg: path, tdKias: q.shortTouchdownKias, decel: 3.6, idleAtAlong: aim - 260,
    flareGain: 32, touchdownFpm: 110, flareFt: 10, flapsUpOnRollout: true,
  });
  const m = sim.marks;
  const steps: Step[] = [
    { id: 'final', title: 'Steep, stabilized final', start: 0, end: m.idle, detail: [
      `Flaps ${fl(ac, p.finalFlaps)}, ${q.shortApproachKias} KIAS — the short-field approach speed. Hold it precisely.`,
      ...gearDownLine(ac),
      'A steeper path to clear a 50 ft obstacle, with power controlling the descent.',
      'Pick the touchdown point — here the 1,000 ft markers — and keep it fixed in the windshield.',
    ] },
    { id: 'idle', title: 'Power idle as the obstacle is cleared', start: m.idle, end: m.flare, detail: [
      'Reduce power smoothly; the airplane is already slow, so there is little float.',
    ] },
    { id: 'flare', title: 'Short flare, firm touchdown on the point', start: m.flare, end: m.touchdown + 0.5, detail: [
      'A brief round-out — do not let it float.',
      `Touch down main wheels first at about ${q.shortTouchdownKias} KIAS, on or just past the point.`,
    ] },
    { id: 'brake', title: 'Flaps up, simulate heavy braking', start: m.touchdown + 0.5, end: 0, detail: [
      'Retract the flaps to put weight on the wheels.',
      'Full back elevator. Simulate heavy braking: say it out loud and brake normally, unless the examiner or CFI asks for real maximum braking.',
    ] },
  ];
  return run({
    id: 'short-landing', title: 'Short-Field Approach and Landing', acsCode: 'PA.IV.F', acsTask: 'Area IV, Task F',
    objective: 'Steep, slow, precise approach and a touchdown at or within the standard distance beyond the selected point, with maximum braking.',
    sim, rf, steps,
    tolerances: [
      { id: 'app', label: 'Approach speed', unit: 'kt', standard: st.approach.label, value: (f) => f.ias, target: q.shortApproachKias, minus: st.approach.minus, plus: st.approach.plus, windows: [[0, m.flare]] },
      tdTolerance(rf, aim, m.touchdown, st.tdShort, `At or within ${st.tdShort} ft beyond`),
    ],
    bugs: { altitudeFt: APT.elevFt + APT.tpaAglFt, heading: rf.hdg, ias: q.shortApproachKias },
    notes: ['Touchdown point: the 1,000 ft aiming-point markers.'],
  }, p.downwindRpm);
}

// ─────────────────────────────────────────────────────────────── Forward slip
export function buildForwardSlip(ac: AircraftProfile, cert: Cert = 'private'): ManeuverRun {
  const st = std(cert); void st;
  const { p, q } = needs(ac);
  const rf = runwayFrame(APT, END);
  const aim = rf.threshold + 1000 * FT;
  const path = 3.5, dist = 2300;
  const high = dist * Math.tan(path * Math.PI / 180) / FT + 450;
  const sim = finalSim(ac, rf, dist, aim, high, q.slipKias, q.slipFlaps, ac.rpm.idle, 0.3, 4.4);
  const s = sim.s;
  sim.tgt.rpm = ac.rpm.idle; sim.tgt.throttle = 0;
  sim.tgt.vs = -500; s.vs = -500;
  sim.for(4);
  sim.mark('slip');
  // Into the slip: left wing low, right rudder, nose yawed right of the track.
  const t0 = s.t;
  const onPath = () => {
    const d = aim - rf.along(sim.pos());
    return sim.agl <= d * Math.tan(path * Math.PI / 180) / FT + 30;
  };
  sim.until(onPath, () => {
    const u = smoothstep(0, 3, s.t - t0);
    s.noTurn = true;
    s.bank = -12 * u;
    s.yaw = 16 * u;
    s.hdg = rf.hdg + s.yaw;
    s.rudderBias = 0.75 * u;
    s.aileronBias = -0.35 * u;
    s.slip = -0.75 * u;
    sim.tgt.vs = lerp(-500, -1150, u); sim.tgt.vsRate = 300;
    sim.tgt.ias = q.slipKias;
  });
  sim.mark('recover');
  const t1 = s.t;
  sim.until(() => s.t - t1 >= 3, () => {
    const u = 1 - smoothstep(0, 3, s.t - t1);
    s.bank = -12 * u; s.yaw = 16 * u; s.hdg = rf.hdg + s.yaw;
    s.rudderBias = 0.75 * u; s.aileronBias = -0.35 * u; s.slip = -0.75 * u;
    approachLaw(sim, aim - rf.along(sim.pos()), path);
  });
  s.noTurn = false; s.yaw = 0; s.hdg = rf.hdg; s.bank = 0; s.rudderBias = 0; s.aileronBias = 0; s.slip = 0;
  sim.mark('normal');
  sim.power(ac.pw.softFlare);
  finalToStop(sim, rf, { aimAlong: aim - 20, pathDeg: path, tdKias: p.touchdownKias + 6, decel: p.landingDecel, idleAtAlong: rf.threshold - 20 });
  const m = sim.marks;
  const steps: Step[] = [
    { id: 'high', title: 'High on final', start: 0, end: m.slip, detail: [
      `About ${n(450)} ft above a normal glidepath, power at idle, ${q.slipKias} KIAS, flaps ${fl(ac, q.slipFlaps)}.`,
      'The aim point is moving down the windshield — more altitude to lose than distance allows.',
      ...(ac.text.slipNote ? [ac.text.slipNote] : []),
    ] },
    { id: 'slip', title: 'Forward slip', start: m.slip, end: m.recover, detail: [
      'Lower one wing (left shown) with aileron and apply opposite (right) rudder.',
      'The nose yaws away from the low wing, but the ground track stays on the centerline.',
      'Pitch to hold airspeed; the sideways fuselage adds drag and the descent steepens with no speed gain.',
      'Ball is deflected — that is expected in a slip.',
    ] },
    { id: 'recover', title: 'Recover from the slip', start: m.recover, end: m.normal, detail: [
      'Back on a normal glidepath: level the wings and neutralize the rudder together.',
      'Recover well before the flare so the airplane is aligned for touchdown.',
    ] },
    { id: 'land', title: 'Normal approach and touchdown', start: m.normal, end: m.touchdown + 0.5, detail: [
      'Flare and touch down on the main wheels, nose aligned with the centerline.',
    ] },
    { id: 'rollout', title: 'Rollout', start: m.touchdown + 0.5, end: 0, detail: ['Lower the nosewheel, rudder for the centerline, brake as needed.'] },
  ];
  return run({
    id: 'forward-slip', title: 'Forward Slip to a Landing', acsCode: 'PA.IV.M', acsTask: 'Area IV, Task M',
    objective: 'Use a forward slip to lose excess altitude on final while tracking the centerline, then recover and land.',
    sim, rf, steps,
    tolerances: [
      { id: 'spd', label: 'Airspeed in the slip', unit: 'kt', standard: st.approach.label, value: (f) => f.ias, target: q.slipKias, minus: st.approach.minus, plus: st.approach.plus, windows: [[m.slip, m.recover]] },
      { id: 'trk', label: 'Ground track vs centerline', unit: 'ft', standard: 'On centerline', value: (f) => rf.lateral({ e: f.east, n: f.north }) / FT, target: 0, minus: 20, plus: 20, windows: [[m.slip, m.touchdown]] },
      tdTolerance(rf, aim, m.touchdown, st.tdNormal, `At or within ${st.tdNormal} ft beyond`),
    ],
    bugs: { altitudeFt: APT.elevFt + APT.tpaAglFt, heading: rf.hdg, ias: q.slipKias },
    notes: ['In a crosswind, slip with the low wing into the wind.'],
  }, p.downwindRpm);
}

// ─────────────────────────────────────────────────────────────── Go-around
export function buildGoAround(ac: AircraftProfile, cert: Cert = 'private'): ManeuverRun {
  const st = std(cert); void st;
  const { p, q } = needs(ac);
  const rf = runwayFrame(APT, END);
  const aim = rf.threshold + 1000 * FT;
  const path = 3.5, dist = 1500;
  const sim = finalSim(ac, rf, dist, aim, dist * Math.tan(path * Math.PI / 180) / FT, p.finalKias, p.finalFlaps, p.abeamRpm, 0.45);
  const s = sim.s;
  sim.until(() => sim.agl <= 160, () => approachLaw(sim, aim - rf.along(sim.pos()), path));
  sim.mark('decide');
  // Power — full throttle, right rudder; attitude — stop the descent; flaps to 20 right away.
  sim.tgt.throttle = 1; sim.tgt.rpm = p.climbRpm;
  sim.tgt.vs = 0; sim.tgt.vsRate = 350;
  sim.for(2, () => { s.rudderBias = Math.min(0.25, s.rudderBias + 0.15 * SIM_DT); s.elevBias = Math.max(-0.25, s.elevBias - 0.15 * SIM_DT); });
  sim.mark('flaps20');
  sim.tgt.flaps = q.balkedFlaps; sim.tgt.ias = q.balkedClimbKias; sim.tgt.accel = 1; sim.tgt.trim = 0.3;
  sim.until(() => s.flaps <= q.balkedFlaps + 0.1, () => { sim.tgt.vs = 150; });
  sim.mark('climb');
  sim.gearUp();
  sim.until(() => s.ias >= q.balkedFlapsUpKias && sim.agl > 300, () => {
    sim.holdAlt(APT.elevFt + 1000, 550);
    sim.tgt.ias = s.alt - APT.elevFt > 250 ? q.balkedFlapsUpKias + 1 : q.balkedClimbKias;
    s.elevBias = Math.min(-0.05, s.elevBias + 0.03 * SIM_DT);
  });
  sim.mark('flaps10');
  sim.tgt.flaps = flapUpOne(ac, q.balkedFlaps);
  sim.for(4, () => sim.holdAlt(APT.elevFt + 1000, 600));
  sim.mark('flapsUp');
  sim.tgt.flaps = 0; sim.tgt.ias = p.climbKias; sim.tgt.trim = 0.25;
  sim.until(() => s.flaps < 0.1 && s.ias >= p.climbKias - 1, () => { sim.holdAlt(APT.elevFt + 1000, p.climbFpm); s.elevBias = lerp(s.elevBias, 0.05, 0.02); });
  sim.mark('vy');
  sim.for(10, () => sim.holdAlt(APT.elevFt + 1000, p.climbFpm));
  const m = sim.marks;
  const steps: Step[] = [
    { id: 'final', title: 'Short final — not working out', start: 0, end: m.decide, detail: [
      `Normal approach: flaps ${fl(ac, p.finalFlaps)}, ${p.finalKias} KIAS.`,
      'Something is wrong — traffic on the runway, unstable approach, or a bounce. Decide early and commit.',
    ] },
    { id: 'power', title: 'Power — full throttle', start: m.decide, end: m.flaps20, detail: [
      'Smoothly apply full power; right rudder for the left-turning tendencies.',
      'Stop the descent: raise the nose to a level-to-climb attitude.',
      'Expect strong nose-up force from the approach trim — hold forward pressure and trim nose down.',
    ] },
    { id: 'flaps20', title: `Flaps to ${fl(ac, q.balkedFlaps)}`, start: m.flaps20, end: m.climb, detail: [
      `Retract flaps to ${fl(ac, q.balkedFlaps)} right away.`,
      `Climb at ${q.balkedClimbKias} KIAS.`,
    ] },
    { id: 'positive', title: 'Positive rate, accelerate', start: m.climb, end: m.flaps10, detail: [
      'Confirm a positive rate of climb on the VSI and altimeter.',
      ...gearUpLine(ac),
      'Move to the side of the runway if needed to keep conflicting traffic in sight; announce the go-around.',
    ] },
    { id: 'flaps10', title: 'Flaps up in stages', start: m.flaps10, end: m.vy, detail: [
      `Clear of obstacles, at a safe altitude and ${q.balkedFlapsUpKias} KIAS: retract the remaining flaps in stages.`,
      `Accelerate to Vy, ${p.climbKias} KIAS.`,
    ] },
    { id: 'vy', title: 'Climb at Vy, rejoin the pattern', start: m.vy, end: 0, detail: ['Trimmed, full power, on the extended centerline (or offset to the side).'] },
  ];
  return run({
    id: 'go-around', title: 'Go-Around / Rejected Landing', acsCode: 'PA.IV.N', acsTask: 'Area IV, Task N',
    objective: 'Make a timely decision, apply power, stop the descent and clean up in stages while transitioning to a climb.',
    sim, rf, steps,
    tolerances: [
      { id: 'balked', label: 'Balked-landing climb speed', unit: 'kt', standard: st.approach.label, value: (f) => f.ias, target: q.balkedClimbKias, minus: st.approach.minus, plus: st.approach.plus, windows: [[m.climb + 2, m.climb + 7]] },
      { id: 'vy', label: 'Climb speed (Vy)', unit: 'kt', standard: st.climb.label, value: (f) => f.ias, target: p.climbKias, minus: st.climb.minus, plus: st.climb.plus, windows: [[m.vy, m.vy + 10]] },
    ],
    bugs: { altitudeFt: APT.elevFt + APT.tpaAglFt, heading: rf.hdg, ias: q.balkedClimbKias },
    notes: [],
  }, p.downwindRpm);
}
