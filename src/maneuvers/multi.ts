import { fl, pwFrac, pwT, type AircraftProfile, type Cert } from '../data/aircraft';
import { FT, angDiff, lerp, levelPitch, smoothstep } from '../engine/kinematics';
import { SIM_DT, Sim, approachLaw, runwayFrame } from '../engine/sim';
import type { ManeuverRun, Step } from '../engine/types';
import { airworkRun, cruiseSim } from './airwork';
import {
  APT, END, finalSim, finalToStop, groundSim, lineupText, rotateAndLiftOff, run, takeoffRoll, tdTolerance,
} from './takeoffLanding';

/*
 * Multi-engine tasks. The left engine is the one failed in every scenario.
 * Speeds come from the AFM (Vmca, Vyse); the drill wording is generic and the
 * AFM checklist governs.
 */

const n = (x: number) => Math.round(x).toLocaleString();

function needs(ac: AircraftProfile) {
  const p = ac.procedures.pattern, q = ac.procedures.perf, mu = ac.multi;
  if (!p || !q || !mu) throw new Error(`${ac.shortName} has no multi-engine profile`);
  return { p, q, mu };
}

/** Left engine failed (or at idle / zero thrust); right engine at `v`. */
function oei(sim: Sim, v: number, opts: { failed?: boolean; rudder?: number; bank?: number } = {}) {
  const ac = sim.ac, s = sim.s;
  sim.tgt.rpm = v;
  sim.tgt.throttle = 0;                             // left lever
  s.throttleR = lerp(s.throttleR ?? s.throttle, pwFrac(ac, v), 0.08);
  if (opts.failed !== undefined) s.oei = opts.failed;
  const need = opts.rudder ?? 0.55 * pwFrac(ac, v);
  s.rudderBias = lerp(s.rudderBias, need, 0.06);    // right rudder: step on the good engine
  s.slip = lerp(s.slip, need > 0.1 ? 0.45 : 0, 0.06); // zero sideslip: ball half out toward the good engine
  // A few degrees of bank into the operating engine holds a straight track; it is not a turn.
  if (opts.bank !== undefined) { s.bank = lerp(s.bank, opts.bank, 0.05); s.noTurn = true; }
}
const bothLevers = (sim: Sim) => { sim.s.throttleR = undefined; sim.s.noTurn = false; };
/**
 * Both engines back: over `secs` the right lever eases to match the left, and the
 * bank, ball and rudder held for single-engine flight blend out instead of snapping.
 */
function restoreBoth(sim: Sim, secs: number, each?: () => void) {
  const s = sim.s;
  sim.for(secs, () => {
    s.throttleR = lerp(s.throttleR ?? s.throttle, s.throttle, 0.1);
    s.bank = lerp(s.bank, 0, 0.06); s.slip = lerp(s.slip, 0, 0.08); s.rudderBias = lerp(s.rudderBias, 0, 0.08);
    s.noTurn = true;
    each?.();
  });
  bothLevers(sim); s.bank = 0; s.slip = 0;
}
/** Roll the single-engine bank out to wings level before a turn. */
function levelWings(sim: Sim, secs: number, each: () => void) {
  const s = sim.s;
  sim.for(secs, () => { each(); s.bank = lerp(s.bank, 0, 0.08); s.noTurn = true; });
  s.bank = 0; s.noTurn = false;
}

const drill = (ac: AircraftProfile, mu: NonNullable<AircraftProfile['multi']>) => [
  `Control: pitch for ${mu.vyse} KIAS (blue line), rudder toward the operating engine, 2–3° of bank into it.`,
  'Power: both power levers full forward.',
  `Drag: flaps ${fl(ac, 0)}, gear UP.`,
  'Identify: dead foot, dead engine. Verify: retard the suspected power lever — no change.',
  `Feather: ${mu.feather}.`,
];

// ─────────────────────────────────────────────────────────────── Vmc demonstration
export function buildVmcDemo(ac: AircraftProfile, _cert: Cert = 'multi'): ManeuverRun {
  const { q, mu } = needs(ac);
  const ground = q.airworkGroundFt, alt = Math.max(q.airworkAltFt, ground + 4000);
  const sim = cruiseSim(ac, alt, ground);
  const s = sim.s;
  const start = mu.vyse + 10;
  sim.for(4, () => sim.holdAlt(alt, 500));
  sim.mark('config');
  sim.power(ac.pw.reduce); sim.tgt.ias = start; sim.tgt.accel = 1.6;
  sim.until(() => s.ias <= start + 0.3, () => sim.holdAlt(alt, 500));
  sim.mark('setpower');
  // Left engine to idle (windmilling), right engine to maximum.
  const tS = s.t;
  sim.for(4, () => { oei(sim, ac.rpm.max, { bank: 4 }); sim.holdAlt(alt, 500); s.pitch = levelPitch(ac, s.ias, 0) + 2 * smoothstep(0, 4, s.t - tS); });
  sim.mark('slow');
  // Raise the nose to lose about 1 kt per second.
  const stopAt = mu.vmc + 2;
  const tD = s.t, pD = s.pitch ?? 2;
  sim.tgt.ias = stopAt - 0.5; sim.tgt.accel = 1;
  sim.until(() => s.ias <= stopAt, () => {
    const u = smoothstep(start, stopAt, s.ias);
    oei(sim, ac.rpm.max, { bank: 5, rudder: lerp(0.5, 1, u) });
    s.pitch = lerp(pD, 12, smoothstep(0, 10, s.t - tD));
    sim.tgt.vs = 250; sim.tgt.vsRate = 150;
    if (s.ias <= q.stallCleanKias + q.stallWarnMarginKt) s.warn = 'STALL';
  });
  sim.mark('loss');
  // Full rudder is in and the nose starts to move toward the dead engine.
  const hd0 = s.hdg;
  sim.for(1.8, () => { oei(sim, ac.rpm.max, { bank: 5, rudder: 1 }); s.hdg -= 3 * SIM_DT; });
  sim.mark('recover');
  const tR = s.t;
  sim.tgt.ias = mu.vyse; sim.tgt.accel = 2.2;
  sim.until(() => s.ias >= mu.vyse - 1, () => {
    const u = smoothstep(0, 2, s.t - tR);
    oei(sim, lerp(ac.rpm.max, ac.pw.reduce, u) + (s.ias > mu.vmc + 6 ? (ac.rpm.max - ac.pw.reduce) * smoothstep(mu.vmc + 6, mu.vyse, s.ias) : 0), { bank: 3 });
    s.pitch = lerp(12, -2, u);
    s.hdg = lerp(s.hdg, hd0, 0.02);
    sim.tgt.vs = -500; sim.tgt.vsRate = 400;
    s.warn = undefined;
  });
  s.hdg = hd0;
  sim.mark('vyse');
  s.pitch = undefined;
  sim.for(6, () => { oei(sim, ac.rpm.max, { bank: 2.5 }); sim.tgt.vs = mu.oeiClimbFpm; sim.tgt.vsRate = 200; });
  sim.mark('restore');
  sim.power(ac.pw.cruise); sim.tgt.ias = ac.cruiseKias; sim.tgt.accel = 1.3;
  restoreBoth(sim, 3, () => { sim.tgt.vs = 0; });
  sim.for(5, () => { sim.tgt.vs = 0; s.rudderBias = lerp(s.rudderBias, 0, 0.1); });
  const m = sim.marks;
  const steps: Step[] = [
    { id: 'setup', title: 'Set up and clear the area', start: 0, end: m.config, detail: [
      `Recover no lower than 3,000 ft AGL — shown at ${n(alt)} ft MSL (${n(alt - ground)} ft AGL).`,
      'Clearing turns first (not animated). Brief the recovery before you start.',
    ] },
    { id: 'config', title: 'Configure: takeoff configuration', start: m.config, end: m.setpower, detail: [
      `Gear UP, flaps ${fl(ac, 0)} (takeoff setting), trim for takeoff.`,
      `Slow to about ${start} KIAS (about 10 kt above Vyse/Vsse ${mu.vsse}).`,
    ] },
    { id: 'power', title: 'Left engine idle, right engine maximum', start: m.setpower, end: m.slow, detail: [
      'Reduce the left power lever to idle (propeller windmilling); set maximum takeoff power on the right.',
      'Right rudder to hold heading and bank up to 5° toward the operating engine.',
    ] },
    { id: 'slow', title: 'Slow at 1 kt per second', start: m.slow, end: m.loss, detail: [
      'Raise the nose to lose about 1 knot per second.',
      'More and more right rudder is needed to hold heading as the airspeed drops.',
      `Published Vmca is ${mu.vmc} KIAS (red radial). Actual Vmc falls with altitude, so the stall warning may come first.`,
    ] },
    { id: 'loss', title: 'Loss of directional control', start: m.loss, end: m.recover, detail: [
      'With full rudder applied the nose starts to yaw toward the dead engine: that is Vmc for this condition.',
      'Recover at the first sign of loss of directional control or any stall indication, whichever comes first.',
    ] },
    { id: 'recover', title: 'Recover: reduce power, lower the nose', start: m.recover, end: m.vyse, detail: [
      'Together: reduce power on the operating engine enough to stop the yaw, and lower the nose to reduce the angle of attack.',
      `Regain control, then add power back as the airspeed passes Vmc toward ${mu.vyse} KIAS.`,
      'Never recover by adding power on the idle engine alone.',
    ] },
    { id: 'vyse', title: `Vyse ${mu.vyse} KIAS, straight flight`, start: m.vyse, end: m.restore, detail: [
      'Hold blue line on the entry heading with 2–3° of bank and the ball half out toward the operating engine.',
    ] },
    { id: 'restore', title: 'Restore both engines', start: m.restore, end: 0, detail: ['Bring the left engine power back smoothly and return to cruise.'] },
  ];
  return airworkRun({
    id: 'vmc-demo', title: 'Vmc Demonstration', acsCode: 'CA.X.B', acsTask: 'Area X, Task B',
    objective: 'Show the loss of directional control as airspeed decays with one engine at idle and the other at full power, and recover promptly.',
    sim, steps,
    tolerances: [
      { id: 'hdg', label: 'Heading', unit: '°', standard: '±20°', value: (f) => 360 + angDiff(360, f.heading), target: 360, minus: 20, plus: 20, windows: [[m.setpower, m.vyse]] },
      { id: 'bank', label: 'Bank toward operating engine', unit: '°', standard: 'Up to 5°', value: (f) => f.bank, target: 2.5, minus: 2.5, plus: 3, windows: [[m.slow, m.loss]] },
      { id: 'agl', label: 'Height above ground', unit: 'ft', standard: 'No lower than 3,000 ft AGL', value: (f) => f.altFt - ground, target: 4500, minus: 1500, plus: 1500, windows: [[m.setpower, m.restore]] },
    ],
    bugs: { altitudeFt: alt, heading: 360, ias: mu.vyse },
    notes: [
      'The left engine is idled here. Check the AFM for whether this airplane has a critical engine.',
      'Do not let the airspeed go below the published Vmca with an engine actually shut down.',
    ],
  });
}

// ─────────────────────────────────────────────────────────────── Engine failure during takeoff (before Vmc)
export function buildRejectedTakeoff(ac: AircraftProfile, _cert: Cert = 'multi'): ManeuverRun {
  const { p, mu } = needs(ac);
  const rf = runwayFrame(APT, END);
  const sim = groundSim(ac, rf, rf.threshold + 15);
  const s = sim.s;
  sim.for(2.5);
  sim.mark('roll');
  takeoffRoll(sim, Math.round(mu.vmc * 0.6), p.groundAccel);
  sim.mark('fail');
  // Left engine fails: the airplane swings left.
  const t0 = s.t;
  s.oei = true; s.noTurn = true;
  while (s.t - t0 < 0.9) { s.throttleR = 1; sim.tgt.throttle = 0; s.hdg = rf.hdg - 4 * smoothstep(0, 0.9, s.t - t0); s.rudderBias = 0.2; sim.tick(p.groundAccel * 0.3); }
  sim.mark('abort');
  const t1 = s.t, h1 = s.hdg;
  sim.tgt.rpm = ac.rpm.idle;
  while (s.ias > 3) {
    const u = smoothstep(0, 2, s.t - t1);
    s.throttleR = lerp(s.throttleR ?? 1, 0, 0.2);
    s.hdg = lerp(h1, rf.hdg, u);
    s.rudderBias = lerp(0.7, 0, u);
    s.elevBias = 0.3;
    // Steer back to the centerline.
    const off = rf.lateral(sim.pos());
    s.e -= rf.side.e * off * 0.03; s.n -= rf.side.n * off * 0.03;
    sim.tick(-3.4 * smoothstep(0, 1.2, s.t - t1));
  }
  s.hdg = rf.hdg; s.noTurn = false;
  sim.mark('stopped');
  for (let i = 0; i < 60; i++) sim.tick(-1);
  const m = sim.marks;
  const stopDist = Math.round((rf.along({ e: s.e, n: s.n }) - (rf.threshold + 15)) / FT / 10) * 10;
  const steps: Step[] = [
    { id: 'lineup', title: `Line up on runway ${END}`, start: 0, end: m.roll, detail: lineupText(ac, rf, p.takeoffFlaps, [
      `Takeoff briefing: any failure or abnormality before ${p.rotateKias} KIAS (rotation) — power levers idle, stop straight ahead.`,
    ]) },
    { id: 'roll', title: 'Takeoff roll', start: m.roll, end: m.fail, detail: [
      'Both power levers smoothly full forward; check both LOAD indications equal.',
      'Airspeed alive; keep the centerline.',
    ] },
    { id: 'fail', title: 'Engine failure below Vmc', start: m.fail, end: m.abort, detail: [
      `Left engine fails at about ${Math.round(mu.vmc * 0.6)} KIAS, well below Vmca ${mu.vmc}.`,
      'The airplane yaws toward the dead engine. Below Vmc the rudder cannot hold full power on one engine.',
    ] },
    { id: 'abort', title: 'Both power levers idle, stop', start: m.abort, end: m.stopped, detail: [
      'Immediately close both power levers — that removes the yaw.',
      'Rudder and nosewheel steering to regain the centerline; brake as required.',
    ] },
    { id: 'stopped', title: 'Stopped on the runway', start: m.stopped, end: 0, detail: [
      `Stopped about ${n(stopDist)} ft from brake release.`,
      'Secure as required and advise on the radio.',
    ] },
  ];
  return run({
    id: 'engine-failure-takeoff-roll', title: 'Engine Failure During Takeoff Before Vmc', acsCode: 'CA.IX.E', acsTask: 'Area IX, Task E',
    objective: 'Recognize an engine failure on the takeoff roll below Vmc, close both power levers and stop on the runway under control.',
    sim, rf, steps,
    tolerances: [
      { id: 'cl', label: 'Distance from centerline', unit: 'ft', standard: 'Stay on the runway', value: (f) => rf.lateral({ e: f.east, n: f.north }) / FT, target: 0, minus: 30, plus: 30, windows: [[m.fail, m.stopped]] },
    ],
    bugs: { altitudeFt: APT.elevFt + APT.tpaAglFt, heading: rf.hdg, ias: p.rotateKias },
    notes: ['On a checkride the examiner simulates this with a power lever below 50% of Vmc.'],
  }, p.downwindRpm);
}

// ─────────────────────────────────────────────────────────────── Engine failure after liftoff
export function buildEngineFailureAfterLiftoff(ac: AircraftProfile, _cert: Cert = 'multi'): ManeuverRun {
  const { p, mu } = needs(ac);
  const rf = runwayFrame(APT, END);
  const sim = groundSim(ac, rf, rf.threshold + 15);
  const s = sim.s;
  sim.for(2.5);
  sim.mark('roll');
  takeoffRoll(sim, p.rotateKias, p.groundAccel);
  rotateAndLiftOff(sim, p.liftoffKias, p.groundAccel);
  s.pitch = undefined;
  sim.tgt.ias = Math.max(p.climbKias, mu.vyse); sim.tgt.accel = 1.4; sim.tgt.rpm = p.climbRpm; sim.tgt.trim = 0.25;
  sim.until(() => sim.agl >= 400, () => { sim.tgt.vs = p.climbFpm; if (sim.agl > 60) sim.gearUp(); s.elevBias = Math.max(0.05, s.elevBias - 0.2 * SIM_DT); });
  sim.mark('fail');
  s.oei = true;
  const tF = s.t;
  sim.tgt.ias = mu.vyse; sim.tgt.accel = 1.2;
  // Startle: yaw and roll toward the dead engine, then control.
  sim.for(3, () => {
    const u = smoothstep(0, 3, s.t - tF);
    oei(sim, ac.rpm.max, { failed: true, bank: lerp(-6, 3, u), rudder: lerp(0.1, 0.6, u) });
    s.noTurn = true; s.hdg = rf.hdg - 5 * Math.sin(Math.PI * u);
    sim.tgt.vs = lerp(p.climbFpm, 50, u); sim.tgt.vsRate = 600;
  });
  s.hdg = rf.hdg;
  sim.mark('drill');
  sim.for(7, () => { oei(sim, ac.rpm.max, { bank: 2.5 }); sim.tgt.vs = 80; });
  sim.mark('feather');
  sim.for(5, () => { oei(sim, ac.rpm.max, { bank: 2.5 }); sim.tgt.vs = mu.oeiClimbFpm; });
  sim.mark('climb');
  sim.until(() => sim.agl >= 600, () => { oei(sim, ac.rpm.max, { bank: 2.5 }); sim.tgt.vs = mu.oeiClimbFpm; sim.tgt.vsRate = 150; }, 400);
  sim.mark('done');
  sim.for(6, () => { oei(sim, ac.rpm.max, { bank: 2.5 }); sim.tgt.vs = mu.oeiClimbFpm; });
  const m = sim.marks;
  const steps: Step[] = [
    { id: 'lineup', title: `Line up on runway ${END}`, start: 0, end: m.roll, detail: lineupText(ac, rf, p.takeoffFlaps, [
      `Takeoff briefing: failure after liftoff with the gear up — fly blue line ${mu.vyse} KIAS, run the drill, climb straight ahead.`,
    ]) },
    { id: 'takeoff', title: 'Normal takeoff', start: m.roll, end: m.fail, detail: [
      `Rotate at ${p.rotateKias} KIAS, climb at ${Math.max(p.climbKias, mu.vyse)} KIAS.`,
      'Positive rate, no usable runway remaining: gear UP.',
    ] },
    { id: 'fail', title: 'Left engine fails', start: m.fail, end: m.drill, detail: [
      'Yaw and roll toward the dead engine.',
      `Control first: rudder toward the operating engine, level the wings, pitch for ${mu.vyse} KIAS (blue line). Lower the nose — the climb attitude is much flatter on one engine.`,
    ] },
    { id: 'drill', title: 'Power, drag, identify, verify', start: m.drill, end: m.feather, detail: drill(ac, mu).slice(1, 4) },
    { id: 'feather', title: 'Feather the failed engine', start: m.feather, end: m.climb, detail: [
      `${mu.feather[0].toUpperCase()}${mu.feather.slice(1)}.`,
      'Trim; 2–3° of bank toward the operating engine, ball half out — zero sideslip gives the best climb.',
    ] },
    { id: 'climb', title: `Climb at Vyse, ${mu.vyse} KIAS`, start: m.climb, end: m.done, detail: [
      `Expect only about ${mu.oeiClimbFpm} fpm. Hold blue line exactly: a few knots off costs most of the climb.`,
      'Straight ahead to a safe altitude, then the engine-securing checklist and a return to land.',
    ] },
    { id: 'done', title: 'Safe altitude', start: m.done, end: 0, detail: ['Declare an emergency, complete the AFM checklist, plan the single-engine approach.'] },
  ];
  return run({
    id: 'engine-failure-after-liftoff', title: 'Engine Failure After Liftoff', acsCode: 'CA.IX.F', acsTask: 'Area IX, Task F',
    objective: 'Keep control after an engine failure in the initial climb, establish Vyse, complete the drill and climb out on one engine.',
    sim, rf, steps,
    tolerances: [
      { id: 'vyse', label: 'Vyse (blue line)', unit: 'kt', standard: '±5 kt', value: (f) => f.ias, target: mu.vyse, minus: 5, plus: 5, windows: [[m.drill, m.done + 6]] },
      { id: 'hdg', label: 'Heading', unit: '°', standard: '±10°', value: (f) => rf.hdg + angDiff(rf.hdg, f.heading), target: rf.hdg, minus: 10, plus: 10, windows: [[m.fail, m.done + 6]] },
    ],
    bugs: { altitudeFt: APT.elevFt + APT.tpaAglFt, heading: rf.hdg, ias: mu.vyse },
    notes: ['Simulated in training with a power lever, never below 400 ft AGL; zero thrust replaces an actual feather.'],
  }, p.downwindRpm);
}

// ─────────────────────────────────────────────────────────────── Approach and landing, one engine inoperative
export function buildOeiLanding(ac: AircraftProfile, _cert: Cert = 'multi'): ManeuverRun {
  const { p, mu } = needs(ac);
  const rf = runwayFrame(APT, END);
  const aim = rf.threshold + 1000 * FT;
  const path = 3, dist = 3000;
  const appFlaps = ac.flapDetents[1];
  const sim = finalSim(ac, rf, dist, aim, dist * Math.tan(path * Math.PI / 180) / FT, mu.oeiApproachKias, appFlaps, 55, 0.4, path);
  const s = sim.s;
  s.oei = true;
  const pwr = 55;
  sim.mark('final');
  sim.until(() => sim.agl <= 300, () => { approachLaw(sim, aim - rf.along(sim.pos()), path); oei(sim, pwr, { failed: true, bank: 2 }); });
  sim.mark('assured');
  sim.tgt.flaps = p.finalFlaps; sim.tgt.ias = p.finalKias; sim.tgt.accel = 0.8;
  sim.until(() => sim.agl <= 60, () => { approachLaw(sim, aim - rf.along(sim.pos()), path); oei(sim, pwr - 10, { failed: true, bank: 2 }); });
  // Power off over the threshold: rudder comes out with the power.
  const origTick = sim.tick.bind(sim);
  sim.tick = (ga?: number) => {
    s.throttleR = lerp(s.throttleR ?? 0, pwFrac(ac, sim.tgt.rpm), 0.1);
    s.rudderBias = lerp(s.rudderBias, 0.5 * pwFrac(ac, sim.tgt.rpm), 0.08);
    s.slip = lerp(s.slip, 0, 0.05); s.bank = lerp(s.bank, 0, 0.08);
    origTick(ga);
  };
  finalToStop(sim, rf, { aimAlong: aim + 40, pathDeg: path, tdKias: p.touchdownKias, decel: p.landingDecel, idleAtAlong: rf.threshold - 20 });
  const m = sim.marks;
  const steps: Step[] = [
    { id: 'final', title: 'Single-engine final', start: 0, end: m.assured, detail: [
      `Left engine secured (feathered). Gear DOWN, flaps ${fl(ac, appFlaps)}, ${mu.oeiApproachKias} KIAS — no slower than Vyse until the landing is assured.`,
      `About ${pwT(ac, pwr)} on the operating engine; right rudder and a little bank into it, trimmed.`,
      'Plan a normal glidepath. A go-around on one engine may not be possible: decide early.',
    ] },
    { id: 'assured', title: 'Landing assured: landing flaps', start: m.assured, end: m.idle, detail: [
      `Flaps ${fl(ac, p.finalFlaps)}, slow to ${p.finalKias} KIAS.`,
      'Every power change needs a rudder change: less power, less right rudder.',
    ] },
    { id: 'idle', title: 'Power idle, rudder neutral', start: m.idle, end: m.flare, detail: [
      'Close the operating power lever and take the rudder out with it so the nose stays straight.',
    ] },
    { id: 'flare', title: 'Flare and touch down', start: m.flare, end: m.touchdown + 0.5, detail: [
      'Normal round-out, main wheels first, on the centerline.',
    ] },
    { id: 'rollout', title: 'Rollout', start: m.touchdown + 0.5, end: 0, detail: ['Brake as needed; expect asymmetric drag from the feathered propeller.'] },
  ];
  return run({
    id: 'oei-approach-landing', title: 'Approach and Landing, One Engine Inoperative', acsCode: 'CA.IX.G', acsTask: 'Area IX, Task G',
    objective: 'Fly a stabilized approach with one engine inoperative at no less than Vyse until landing is assured, and touch down within 400 ft beyond the point.',
    sim, rf, steps,
    tolerances: [
      { id: 'app', label: 'Approach speed', unit: 'kt', standard: '±5 kt, not below Vyse until assured', value: (f) => f.ias, target: mu.oeiApproachKias, minus: 0.5, plus: 5, windows: [[0, m.assured]] },
      tdTolerance(rf, aim, m.touchdown, 400, 'At or within 400 ft beyond'),
    ],
    bugs: { altitudeFt: APT.elevFt + APT.tpaAglFt, heading: rf.hdg, ias: mu.oeiApproachKias },
    notes: ['In training the "failed" engine is set to zero thrust rather than shut down.'],
  }, p.downwindRpm);
}

// ─────────────────────────────────────────────────────────────── Maneuvering with one engine inoperative
export function buildOeiManeuvering(ac: AircraftProfile, _cert: Cert = 'multi'): ManeuverRun {
  const { q, mu } = needs(ac);
  const ground = q.airworkGroundFt, alt = Math.max(q.airworkAltFt, ground + 3500);
  const sim = cruiseSim(ac, alt, ground);
  const s = sim.s;
  const spd = mu.vyse + 10;
  const level = (pw: number, bank?: number) => { oei(sim, pw, { bank }); sim.holdAlt(alt, 300); };
  sim.for(5, () => sim.holdAlt(alt, 500));
  sim.mark('fail');
  s.oei = true;
  const tF = s.t;
  sim.tgt.ias = spd; sim.tgt.accel = 1;
  sim.for(3, () => { const u = smoothstep(0, 3, s.t - tF); oei(sim, ac.rpm.max, { failed: true, bank: lerp(-5, 3, u), rudder: lerp(0.1, 0.55, u) }); s.noTurn = true; s.hdg = 360 - 4 * Math.sin(Math.PI * u); sim.holdAlt(alt, 300); });
  s.noTurn = false; s.hdg = 360;
  sim.mark('drill');
  sim.for(8, () => level(ac.rpm.max, 2.5));
  sim.mark('feather');
  sim.for(6, () => level(ac.rpm.max, 2.5));
  sim.mark('turnR');
  const pwHold = 85;
  levelWings(sim, 1.5, () => { oei(sim, pwHold, {}); sim.holdAlt(alt, 300); });
  sim.turnTo(90, 15, () => { oei(sim, pwHold, {}); sim.holdAlt(alt, 300); }, 1);
  sim.mark('turnL');
  sim.turnTo(360, 15, () => { oei(sim, pwHold, {}); sim.holdAlt(alt, 300); }, -1);
  sim.mark('restart');
  s.hdg = 360;
  sim.for(6, () => level(pwHold, 2.5));
  s.oei = false;
  sim.mark('both');
  sim.power(ac.pw.cruise); sim.tgt.ias = ac.cruiseKias; sim.tgt.accel = 1.2;
  restoreBoth(sim, 3, () => sim.holdAlt(alt, 300));
  sim.for(7, () => { sim.holdAlt(alt, 300); s.rudderBias = lerp(s.rudderBias, 0, 0.08); });
  const m = sim.marks;
  const steps: Step[] = [
    { id: 'cruise', title: 'Cruise', start: 0, end: m.fail, detail: [
      `No lower than 3,000 ft AGL — shown at ${n(alt)} ft MSL. ${pwT(ac, ac.pw.cruise)}, gear UP, flaps ${fl(ac, 0)}.`,
    ] },
    { id: 'fail', title: 'Left engine fails', start: m.fail, end: m.drill, detail: [
      'Yaw and roll toward the dead engine. Stop it with rudder, level the wings, hold altitude.',
    ] },
    { id: 'drill', title: 'Run the drill', start: m.drill, end: m.feather, detail: drill(ac, mu).slice(1, 4) },
    { id: 'feather', title: 'Feather and secure', start: m.feather, end: m.turnR, detail: [
      `${mu.feather[0].toUpperCase()}${mu.feather.slice(1)}. Complete the AFM engine-securing checklist.`,
      `Trim for ${spd} KIAS; 2–3° of bank into the operating engine, ball half out.`,
      'Monitor the operating engine: temperatures and load.',
    ] },
    { id: 'turnR', title: 'Turn toward the operating engine', start: m.turnR, end: m.turnL, detail: [
      'Shallow bank (15° shown), coordinated for single-engine flight.',
      `Hold altitude with pitch and about ${pwT(ac, pwHold)}.`,
    ] },
    { id: 'turnL', title: 'Turn toward the dead engine', start: m.turnL, end: m.restart, detail: [
      'Turns toward the dead engine are acceptable with airspeed well above Vmc and shallow bank.',
    ] },
    { id: 'restart', title: 'Restart (AFM airstart)', start: m.restart, end: m.both, detail: [
      'Within the AFM restart envelope (80–120 KIAS and the maximum restart altitude), follow the airstart checklist.',
    ] },
    { id: 'both', title: 'Both engines, cruise', start: m.both, end: 0, detail: ['Warm the restarted engine as the AFM requires, then set cruise power on both.'] },
  ];
  return airworkRun({
    id: 'oei-maneuvering', title: 'Maneuvering With One Engine Inoperative', acsCode: 'CA.X.A', acsTask: 'Area X, Task A',
    objective: 'After an engine failure in cruise: keep control, run the drill, feather, and fly straight, level and turning on one engine.',
    sim, steps,
    tolerances: [
      { id: 'alt', label: 'Altitude', unit: 'ft', standard: '±100 ft', value: (f) => f.altFt, target: alt, minus: 100, plus: 100, windows: [[m.fail, m.both]] },
      { id: 'hdg', label: 'Heading (straight flight)', unit: '°', standard: '±10°', value: (f) => 360 + angDiff(360, f.heading), target: 360, minus: 10, plus: 10, windows: [[m.fail, m.turnR], [m.restart, m.both]] },
      { id: 'spd', label: 'Airspeed', unit: 'kt', standard: '±10 kt, never below Vmc', value: (f) => f.ias, target: spd, minus: 10, plus: 30, windows: [[m.drill, m.both]] },
    ],
    bugs: { altitudeFt: alt, heading: 360, ias: spd },
    notes: ['An actual shutdown is done only above 3,000 ft AGL and within gliding distance of a suitable airport.'],
  });
}
