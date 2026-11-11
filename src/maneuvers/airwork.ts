import type { AircraftProfile } from '../data/aircraft';
import { D2R, angDiff, lerp, smoothstep } from '../engine/kinematics';
import { SIM_DT, Sim, dirVec } from '../engine/sim';
import type { ManeuverRun, SceneLabel, SceneMarker, Step, Tolerance } from '../engine/types';

/*
 * Slow flight, stalls and emergencies, flown over open farmland.
 * Stall speeds, power settings and configuration come from the aircraft profile.
 */

const n = (x: number) => Math.round(x).toLocaleString();

function needs(ac: AircraftProfile) {
  const p = ac.procedures.pattern, q = ac.procedures.perf;
  if (!p || !q) throw new Error(`${ac.shortName} has no airwork profile`);
  return { p, q };
}

function cruiseSim(ac: AircraftProfile, altFt: number, groundFt: number, hdg = 360) {
  return new Sim(ac, {
    east: 0, north: 0, hdg, altFt, elevFt: groundFt, ias: 95, rpm: 2300, flaps: 0, onGround: false, throttle: 0.75, trim: 0.15,
  });
}

/** Flaps in stages as the airspeed allows (POH: 10° below 110, more below 85). */
function stageFlaps(sim: Sim, want: number) {
  const ias = sim.s.ias;
  const allowed = ias < 85 ? 30 : ias < 110 ? 10 : 0;
  const stage = ias < 70 ? 30 : ias < 80 ? 20 : 10;
  sim.tgt.flaps = Math.min(want, allowed, stage);
}

function airworkRun(base: {
  id: string; title: string; acsCode: string; acsTask: string; objective: string;
  sim: Sim; steps: Step[]; tolerances: Tolerance[]; bugs: ManeuverRun['bugs']; notes: string[];
  labels?: SceneLabel[]; markers?: SceneMarker[]; roads?: ManeuverRun['scene']['roads'];
}): ManeuverRun {
  const frames = base.sim.build(2300);
  const duration = frames[frames.length - 1].t;
  base.steps[base.steps.length - 1].end = duration;
  // Frame the flight path and any ground features it refers to.
  const es = [...frames.map((f) => f.east), ...(base.markers ?? []).map((m) => m.east)];
  const ns = [...frames.map((f) => f.north), ...(base.markers ?? []).map((m) => m.north)];
  const cx = (Math.min(...es) + Math.max(...es)) / 2, cn = (Math.min(...ns) + Math.max(...ns)) / 2;
  const radius = Math.max(500, Math.max(Math.max(...es) - Math.min(...es), Math.max(...ns) - Math.min(...ns)) / 2 * 1.15);
  return {
    id: base.id, title: base.title, acsCode: base.acsCode, acsTask: base.acsTask, objective: base.objective,
    frames, dt: SIM_DT, duration, steps: base.steps, tolerances: base.tolerances,
    scene: { groundElevFt: base.sim.elev, roads: base.roads ?? [], labels: base.labels, markers: base.markers, frameRadius: radius, frameCenter: [cx, cn] },
    bugs: base.bugs, notes: base.notes,
  };
}

const setupText = (q: { airworkAltFt: number; airworkGroundFt: number }, extra: string[] = []) => [
  `At least 1,500 ft AGL — shown at ${n(q.airworkAltFt)} ft MSL (${n(q.airworkAltFt - q.airworkGroundFt)} ft AGL).`,
  'Two 90° clearing turns first (not animated). Pick a heading and an outside reference.',
  ...extra,
];

// ─────────────────────────────────────────────────────────────── Slow flight
export function buildSlowFlight(ac: AircraftProfile): ManeuverRun {
  const { q } = needs(ac);
  const alt = q.airworkAltFt;
  const sim = cruiseSim(ac, alt, q.airworkGroundFt);
  const s = sim.s;
  const hold = (a = alt) => sim.holdAlt(a, 500);
  sim.for(5, () => hold());
  sim.mark('slow');
  sim.tgt.rpm = 1500; sim.tgt.throttle = 0.4; sim.tgt.ias = q.slowFlightKias; sim.tgt.accel = 1.3;
  sim.until(() => s.ias <= q.slowFlightKias + 0.3, () => {
    hold();
    stageFlaps(sim, 30);
    sim.tgt.trim = lerp(0.15, 0.7, smoothstep(95, q.slowFlightKias, s.ias));
    if (s.ias < q.slowFlightKias + 8) { sim.tgt.rpm = q.slowFlightRpm; sim.tgt.throttle = 0.62; }
    s.rudderBias = 0.15 * smoothstep(70, q.slowFlightKias, s.ias);
  });
  sim.mark('established');
  sim.for(10, () => hold());
  sim.mark('turnL');
  sim.tgt.rpm = q.slowFlightRpm + 100;
  sim.turnTo(270, 15, () => hold(), -1);
  sim.mark('turnR');
  sim.turnTo(360, 15, () => hold(), 1);
  sim.tgt.rpm = q.slowFlightRpm;
  sim.for(4, () => hold());
  sim.mark('climb');
  sim.tgt.rpm = 2350; sim.tgt.throttle = 1; s.rudderBias = 0.28;
  sim.until(() => s.alt >= alt + 199, () => sim.holdAlt(alt + 200, 350, 40));
  sim.tgt.rpm = q.slowFlightRpm; sim.tgt.throttle = 0.62; s.rudderBias = 0.15;
  sim.for(4, () => hold(alt + 200));
  sim.mark('descend');
  sim.tgt.rpm = 1600; sim.tgt.throttle = 0.42; s.rudderBias = 0.05;
  sim.until(() => s.alt <= alt + 1, () => sim.holdAlt(alt, 400, 40));
  sim.tgt.rpm = q.slowFlightRpm; sim.tgt.throttle = 0.62; s.rudderBias = 0.15;
  sim.mark('back');
  sim.for(4, () => hold());
  sim.mark('recover');
  sim.tgt.rpm = 2400; sim.tgt.throttle = 1; s.rudderBias = 0.25;
  sim.tgt.ias = 95; sim.tgt.accel = 1.2; sim.tgt.trim = 0.15;
  sim.until(() => s.ias >= 90, () => {
    hold();
    const ias = s.ias;
    sim.tgt.flaps = ias < 55 ? 20 : ias < 65 ? 10 : 0;
    s.rudderBias = lerp(0.25, 0.02, smoothstep(55, 90, ias));
  });
  sim.tgt.rpm = 2300; sim.tgt.throttle = 0.75; s.rudderBias = 0;
  sim.mark('cruise');
  sim.for(5, () => hold());
  const m = sim.marks;
  const level: [number, number][] = [[m.established, m.climb], [m.back, m.recover]];
  const steps: Step[] = [
    { id: 'setup', title: 'Set up and clear the area', start: 0, end: m.slow, detail: setupText(q, ['Cruise, trimmed, heading 360°.']) },
    { id: 'slow', title: 'Power back, configure, slow down', start: m.slow, end: m.established, detail: [
      'Power to about 1,500 RPM and hold altitude with increasing back pressure.',
      'Flaps 10° below 110 KIAS, then 20° and 30° below 85 KIAS.',
      `Approaching ${q.slowFlightKias} KIAS, add power (about ${n(q.slowFlightRpm)} RPM) to stop the deceleration. Trim nose up.`,
      'Right rudder increases as power goes up at low speed.',
    ] },
    { id: 'level', title: `Straight and level at ${q.slowFlightKias} KIAS`, start: m.established, end: m.turnL, detail: [
      `About ${q.slowFlightKias - q.stallFlaps30Kias} kt above the stall — slow enough that any more angle of attack would bring the stall warning.`,
      'Pitch controls airspeed; power controls altitude. Controls feel soft and sluggish.',
      'Nose-high attitude: watch for traffic ahead and below the nose.',
    ] },
    { id: 'turnL', title: 'Turn left, 15° bank', start: m.turnL, end: m.turnR, detail: [
      'Shallow bank, coordinated — expect more rudder than usual.',
      'A little more power holds altitude in the turn.',
    ] },
    { id: 'turnR', title: 'Turn right back to 360°', start: m.turnR, end: m.climb, detail: ['Same technique; more right rudder with the power and P-factor.'] },
    { id: 'climb', title: 'Climb 200 ft', start: m.climb, end: m.descend, detail: [
      `Full power, hold ${q.slowFlightKias} KIAS with pitch, lots of right rudder. Level off and reset power.`,
    ] },
    { id: 'descend', title: 'Descend 200 ft', start: m.descend, end: m.recover, detail: ['Reduce power, hold airspeed with pitch, level off on the original altitude.'] },
    { id: 'recover', title: 'Recover to cruise', start: m.recover, end: m.cruise, detail: [
      'Full power, right rudder, lower the nose slightly to hold altitude.',
      'Flaps up in stages as airspeed increases: 20°, 10°, then up.',
      'Accelerate, trim, and set cruise power.',
    ] },
    { id: 'cruise', title: 'Cruise', start: m.cruise, end: 0, detail: ['Straight and level, trimmed. Clear the area.'] },
  ];
  return airworkRun({
    id: 'slow-flight', title: 'Maneuvering During Slow Flight', acsCode: 'PA.VII.A', acsTask: 'Area VII, Task A',
    objective: 'Straight-and-level flight, turns, climbs and descents at an airspeed just above the stall warning, without activating it.',
    sim, steps,
    tolerances: [
      { id: 'alt', label: 'Altitude', unit: 'ft', standard: '±100 ft', value: (f) => f.altFt, target: alt, minus: 100, plus: 100, windows: level },
      { id: 'ias', label: 'Airspeed', unit: 'kt', standard: '+10 / −0 kt', value: (f) => f.ias, target: q.slowFlightKias + 5, minus: 5, plus: 5, windows: [[m.established, m.recover]] },
      { id: 'hdg', label: 'Heading', unit: '°', standard: '±10°', value: (f) => 360 + angDiff(360, f.heading), target: 360, minus: 10, plus: 10, windows: [[m.established, m.turnL], [m.climb, m.recover]] },
      { id: 'bank', label: 'Bank in turns', unit: '°', standard: 'Specified ±10°', value: (f) => Math.abs(f.bank), target: 15, minus: 10, plus: 10, windows: [[m.turnL + 3, m.turnR - 3], [m.turnR + 3, m.climb - 7]] },
    ],
    bugs: { altitudeFt: alt, heading: 360, ias: q.slowFlightKias },
    notes: ['No stall warning at any point — that is the standard.'],
  });
}

// ─────────────────────────────────────────────────────────────── Stalls
function stall(ac: AircraftProfile, kind: 'off' | 'on'): ManeuverRun {
  const { p, q } = needs(ac);
  const alt = q.airworkAltFt;
  const sim = cruiseSim(ac, alt, q.airworkGroundFt);
  const s = sim.s;
  const stallKias = kind === 'off' ? q.stallFlaps30Kias : q.stallCleanKias - 4;
  const hornKias = stallKias + q.stallWarnMarginKt;
  const horn = () => { s.warn = s.ias <= hornKias + 0.01 ? 'STALL' : undefined; };
  const hold = () => sim.holdAlt(alt, 500);

  sim.for(5, () => hold());
  sim.mark('slow');
  sim.tgt.rpm = 1500; sim.tgt.throttle = 0.4; sim.tgt.accel = 1.3;
  const entryKias = kind === 'off' ? p.finalKias : p.rotateKias;
  sim.tgt.ias = entryKias;
  sim.until(() => s.ias <= entryKias + 0.3, () => {
    hold();
    if (kind === 'off') stageFlaps(sim, 30);
    sim.tgt.trim = lerp(0.15, 0.55, smoothstep(95, entryKias, s.ias));
  });
  sim.mark('config');
  if (kind === 'off') {
    // Stabilized descent in the landing configuration.
    sim.for(8, () => { sim.tgt.vs = -500; sim.tgt.vsRate = 200; });
  } else {
    sim.for(4, () => hold());
  }
  sim.mark('pitchUp');
  const t0 = s.t;
  const p0 = 1.5 + (95 - s.ias) * 0.15 - s.flaps * 0.08 + (kind === 'off' ? -4 : 0);
  const pitchTarget = kind === 'off' ? 11 : 16;
  if (kind === 'off') { sim.tgt.rpm = ac.rpm.idle; sim.tgt.throttle = 0; }
  else { sim.tgt.rpm = q.powerOnStallRpm; sim.tgt.throttle = 0.8; }
  sim.tgt.ias = stallKias - 1; sim.tgt.accel = kind === 'off' ? 1.4 : 1.0;
  sim.until(() => s.ias <= stallKias, () => {
    const u = smoothstep(0, 4, s.t - t0);
    s.pitch = lerp(p0, pitchTarget, u);
    s.elevBias = lerp(0, 0.65, smoothstep(0, 1, (entryKias - s.ias) / (entryKias - stallKias)));
    s.rudderBias = kind === 'on' ? 0.3 * u : 0;
    sim.tgt.vs = kind === 'off' ? -350 : lerp(400, 0, smoothstep(entryKias, stallKias, s.ias));
    sim.tgt.vsRate = 150;
    const was = s.warn;
    horn();
    if (!was && s.warn && sim.marks.horn === undefined) sim.mark('horn');
  });
  sim.mark('stall');
  // The break: the nose pitches down on its own and the sink rate builds.
  const t1 = s.t;
  sim.tgt.vs = -950; sim.tgt.vsRate = 900;
  sim.for(1.2, () => { s.pitch = lerp(pitchTarget, pitchTarget - 8, smoothstep(0, 1.2, s.t - t1)); horn(); });
  sim.mark('recover');
  // Reduce angle of attack, level the wings, add full power, right rudder.
  sim.tgt.throttle = 1; sim.tgt.rpm = kind === 'off' ? p.takeoffRpm : p.climbRpm;
  const climbKias = kind === 'off' ? q.balkedClimbKias : ac.speeds.vx;
  sim.tgt.ias = climbKias; sim.tgt.accel = 3;
  const t2 = s.t;
  sim.until(() => s.ias >= climbKias - 2, () => {
    const u = smoothstep(0, 1.5, s.t - t2);
    s.pitch = lerp(pitchTarget - 8, 2, u);
    s.elevBias = lerp(0.65, -0.2, u);
    s.rudderBias = 0.3;
    sim.tgt.vs = lerp(-950, 0, smoothstep(0.5, 3.5, s.t - t2)); sim.tgt.vsRate = 500;
    if (kind === 'off' && s.t - t2 > 1) sim.tgt.flaps = q.balkedFlaps;
    horn();
  });
  s.pitch = undefined; s.warn = undefined;
  sim.mark('climb');
  sim.tgt.ias = kind === 'off' ? q.balkedFlapsUpKias : p.climbKias; sim.tgt.accel = 1;
  const tClimb = s.t;
  sim.until(() => s.t - tClimb > 6 && s.alt >= alt - 70, () => {
    sim.tgt.vs = 600; sim.tgt.vsRate = 250;
    s.elevBias = lerp(s.elevBias, 0.05, 0.02);
    if (kind === 'off' && s.ias >= q.balkedFlapsUpKias - 1) sim.tgt.flaps = s.flaps > 10.5 ? 10 : 0;
    if (kind === 'off' && s.flaps <= 10.1 && s.ias >= q.balkedFlapsUpKias - 1) sim.tgt.flaps = 0;
  });
  sim.mark('level');
  sim.tgt.flaps = 0; sim.tgt.ias = 95; sim.tgt.accel = 1.2; sim.tgt.trim = 0.15;
  sim.until(() => s.ias >= 90, () => { hold(); s.rudderBias = lerp(s.rudderBias, 0, 0.02); });
  sim.tgt.rpm = 2300; sim.tgt.throttle = 0.75;
  sim.for(5, () => { hold(); s.rudderBias = lerp(s.rudderBias, 0, 0.05); });
  const m = sim.marks;
  const frames = sim.raw;
  const minAlt = Math.min(...frames.filter((f) => f.t >= m.stall).map((f) => f.altFt));
  const atStall = frames.find((f) => f.t >= m.stall)!.altFt;
  const loss = Math.round((atStall - minAlt) / 10) * 10;

  const off = kind === 'off';
  const steps: Step[] = [
    { id: 'setup', title: 'Set up and clear the area', start: 0, end: m.slow, detail: setupText(q) },
    { id: 'config', title: off ? 'Landing configuration' : 'Slow to liftoff speed', start: m.slow, end: m.config, detail: off ? [
      'Power to about 1,500 RPM, hold altitude while slowing.',
      `Flaps in stages to ${p.finalFlaps}° (10° below 110, more below 85 KIAS). Trim.`,
    ] : [
      'Power to about 1,500 RPM, hold altitude while slowing.',
      `Takeoff/departure configuration: flaps up. Slow to about ${p.rotateKias} KIAS (rotation speed). Trim.`,
    ] },
    off
      ? { id: 'descent', title: `Stabilized descent at ${p.finalKias} KIAS`, start: m.config, end: m.pitchUp, detail: [
        'Establish a normal approach descent, about 500 fpm, as if on final.',
      ] }
      : { id: 'power', title: 'Set climb power', start: m.config, end: m.pitchUp, detail: [
        `Hold altitude at ${p.rotateKias} KIAS, then set at least 65% power (about ${n(q.powerOnStallRpm)} RPM shown).`,
      ] },
    { id: 'pitch', title: off ? 'Power idle, raise to a landing attitude' : 'Raise the nose to a climb attitude', start: m.pitchUp, end: m.horn, detail: off ? [
      'Close the throttle and smoothly raise the nose to the landing attitude.',
      'Hold heading with rudder; keep the wings level (or up to 20° bank if specified).',
    ] : [
      `Smoothly raise the nose to about ${pitchTarget}° — an attitude that induces the stall.`,
      'Lots of right rudder: high power, high angle of attack.',
    ] },
    { id: 'horn', title: 'Stall warning', start: m.horn, end: m.stall, detail: [
      `Stall horn at about ${hornKias} KIAS. Keep increasing back pressure.`,
      'Cues: horn, mushy controls, buffet, high nose attitude, quiet airflow.',
    ] },
    { id: 'stall', title: 'The stall', start: m.stall, end: m.recover, detail: [
      `Full stall at about ${stallKias} KIAS indicated: buffet and the nose pitches down even with full back pressure.`,
      'Private ACS: recover promptly after the full stall occurs.',
    ] },
    { id: 'recover', title: 'Recover', start: m.recover, end: m.climb, detail: off ? [
      'Reduce the angle of attack first: forward elevator pressure until the stall warning stops.',
      'Level the wings with coordinated aileron and rudder.',
      'Full power, right rudder; flaps to 20° promptly.',
    ] : [
      'Reduce the angle of attack first: forward elevator pressure until the stall warning stops.',
      'Level the wings; full power, right rudder.',
    ] },
    { id: 'climb', title: off ? 'Climb, flaps up in stages' : `Climb at Vx/Vy`, start: m.climb, end: m.level, detail: off ? [
      `Positive rate, ${q.balkedClimbKias} KIAS: flaps to 10°, then up above ${q.balkedFlapsUpKias} KIAS.`,
      'Climb back to the starting altitude.',
    ] : [
      `Accelerate to Vx (${ac.speeds.vx} KIAS), then Vy (${p.climbKias} KIAS), and climb back to altitude.`,
    ] },
    { id: 'level', title: 'Level off, cruise', start: m.level, end: 0, detail: [`About ${loss} ft lost in the recovery. Level off, set cruise power, trim.`] },
  ];
  return airworkRun({
    id: off ? 'power-off-stall' : 'power-on-stall',
    title: off ? 'Power-Off Stalls' : 'Power-On Stalls',
    acsCode: off ? 'PA.VII.B' : 'PA.VII.C', acsTask: off ? 'Area VII, Task B' : 'Area VII, Task C',
    objective: off
      ? 'Stall in the approach-to-landing configuration, recognize it, and recover promptly with minimum altitude loss.'
      : 'Stall in the takeoff/departure configuration at high power, recognize it, and recover promptly with minimum altitude loss.',
    sim, steps,
    tolerances: [
      { id: 'hdg', label: 'Heading', unit: '°', standard: '±10°', value: (f) => 360 + angDiff(360, f.heading), target: 360, minus: 10, plus: 10, windows: [[m.pitchUp, m.climb]] },
      { id: 'bank', label: 'Bank', unit: '°', standard: 'Wings level (or ≤20° ±10°)', value: (f) => Math.abs(f.bank), target: 0, minus: 0, plus: 10, windows: [[m.pitchUp, m.climb]] },
      { id: 'ret', label: 'Back to altitude', unit: 'ft', standard: '±100 ft', value: (f) => f.altFt, target: alt, minus: 100, plus: 100, windows: [[m.level + 2, m.level + 8]] },
    ],
    bugs: { altitudeFt: alt, heading: 360, ias: off ? p.finalKias : p.rotateKias },
    notes: [
      'Stall speeds vary with weight, CG and bank; numbers shown are for a typical training weight.',
      'The red STALL annunciation on the PFD stands in for the stall horn.',
    ],
  });
}
export const buildPowerOffStall = (ac: AircraftProfile) => stall(ac, 'off');
export const buildPowerOnStall = (ac: AircraftProfile) => stall(ac, 'on');

// ─────────────────────────────────────────────────────────────── Emergency descent
export function buildEmergencyDescent(ac: AircraftProfile): ManeuverRun {
  const { q } = needs(ac);
  const startAlt = q.airworkAltFt + 1000, endAlt = q.airworkAltFt - 1000;
  const sim = cruiseSim(ac, startAlt, q.airworkGroundFt);
  const s = sim.s;
  sim.for(5, () => sim.holdAlt(startAlt, 500));
  sim.mark('idle');
  sim.tgt.rpm = 1100; sim.tgt.throttle = 0;
  sim.for(1.5, () => sim.holdAlt(startAlt, 500));
  sim.mark('roll');
  sim.rollTo(-q.emergencyDescentBank, 4.5, () => { sim.tgt.vs = -1200; sim.tgt.vsRate = 400; });
  sim.mark('descend');
  sim.tgt.ias = q.emergencyDescentKias; sim.tgt.accel = 2.5;
  sim.until(() => s.alt <= endAlt + 350, () => { sim.tgt.vs = -2000; sim.tgt.vsRate = 400; });
  sim.mark('rollout');
  sim.rollTo(0, 4.5, () => { sim.holdAlt(endAlt, 2000, 250); });
  sim.until(() => Math.abs(s.alt - endAlt) < 3, () => sim.holdAlt(endAlt, 2000, 250));
  sim.mark('level');
  sim.tgt.rpm = 2300; sim.tgt.throttle = 0.75; sim.tgt.ias = 95; sim.tgt.accel = 1.2;
  sim.for(10, () => sim.holdAlt(endAlt, 500));
  const m = sim.marks;
  const steps: Step[] = [
    { id: 'setup', title: 'Emergency — get down now', start: 0, end: m.idle, detail: [
      `Cruise at ${n(startAlt)} ft MSL. Example: smoke or fire in the cabin.`,
      'Clear the area below, especially in the direction of the turn.',
    ] },
    { id: 'idle', title: 'Throttle idle, mixture rich', start: m.idle, end: m.roll, detail: [
      'Close the throttle; mixture rich as you descend into thicker air.',
    ] },
    { id: 'turn', title: `Roll into a ${q.emergencyDescentBank}° bank`, start: m.roll, end: m.descend, detail: [
      'A steep bank (30–45°) keeps positive load on the airplane while the nose goes down and lets you see below.',
    ] },
    { id: 'descend', title: `Descend at ${q.emergencyDescentKias} KIAS`, start: m.descend, end: m.rollout, detail: [
      `Pitch for ${q.emergencyDescentKias} KIAS in smooth air (below Vno ${ac.speeds.vno}). In turbulence, stay at or below Va.`,
      'Some techniques use full flaps below the flap limit speed instead — follow the POH and your instructor.',
      'Expect around 2,000 fpm down. Watch for the airspeed creeping up.',
    ] },
    { id: 'rollout', title: 'Lead the level-off', start: m.rollout, end: m.level, detail: [
      'Start rolling out and raising the nose about 10% of the descent rate early (≈200–300 ft).',
    ] },
    { id: 'level', title: 'Level off, power back', start: m.level, end: 0, detail: [
      `Level at ${n(endAlt)} ft and set power. In a real emergency, continue to a landing.`,
    ] },
  ];
  return airworkRun({
    id: 'emergency-descent', title: 'Emergency Descent', acsCode: 'PA.IX.A', acsTask: 'Area IX, Task A',
    objective: 'Lose altitude as fast as safely possible: power idle, a steep descending turn at the appropriate airspeed, then a controlled level-off.',
    sim, steps,
    tolerances: [
      { id: 'ias', label: 'Airspeed', unit: 'kt', standard: '+0 / −10 kt', value: (f) => f.ias, target: q.emergencyDescentKias - 5, minus: 5, plus: 5, windows: [[m.descend + 10, m.rollout]] },
      { id: 'bank', label: 'Bank', unit: '°', standard: '30–45°', value: (f) => Math.abs(f.bank), target: 37.5, minus: 7.5, plus: 7.5, windows: [[m.descend, m.rollout]] },
      { id: 'alt', label: 'Level-off altitude', unit: 'ft', standard: '±100 ft', value: (f) => f.altFt, target: endAlt, minus: 100, plus: 100, windows: [[m.level, m.level + 8]] },
    ],
    bugs: { altitudeFt: endAlt, heading: 360, ias: q.emergencyDescentKias },
    notes: ['Shown clean at the smooth-air speed; flap and speed choices vary by POH and condition.'],
  });
}

// ─────────────────────────────────────────────────────────────── Emergency approach
export function buildEmergencyApproach(ac: AircraftProfile): ManeuverRun {
  const { p, q } = needs(ac);
  const alt = q.airworkAltFt, ground = q.airworkGroundFt;
  const sim = cruiseSim(ac, alt, ground);
  const s = sim.s;
  const vg = ac.speeds.vg;
  const glide = () => { sim.tgt.vs = -q.glideFpm * (1 / Math.cos(s.bank * D2R)) ** 1.2; sim.tgt.vsRate = 200; };
  sim.for(4, () => sim.holdAlt(alt, 500));
  sim.mark('fail');
  sim.tgt.rpm = ac.rpm.idle; sim.tgt.throttle = 0;
  sim.tgt.ias = vg; sim.tgt.accel = 3; sim.tgt.trim = 0.35;
  // Trade the excess speed for altitude, then settle into the glide.
  sim.until(() => s.ias <= vg + 0.5, () => { sim.tgt.vs = 250; sim.tgt.vsRate = 300; });
  sim.mark('glide');
  sim.for(2, glide);
  sim.mark('field');
  sim.turnTo(300, 20, glide, -1);
  sim.mark('checklist');
  sim.for(20, glide);
  sim.mark('key');
  sim.turnTo(120, 30, glide, -1);
  sim.mark('downwind');
  sim.for(16, glide);
  sim.mark('base');
  sim.turnTo(30, 30, glide, -1);
  sim.for(8, glide);
  sim.mark('finalTurn');
  sim.turnTo(300, 30, glide, -1);
  sim.mark('final');
  sim.tgt.flaps = 20; sim.tgt.ias = 65;
  sim.until(() => sim.agl <= 500, () => { sim.tgt.vs = -950; sim.tgt.vsRate = 150; });
  sim.mark('terminate');
  // Evaluator terminates: go around.
  sim.tgt.throttle = 1; sim.tgt.rpm = p.climbRpm - 50; sim.tgt.vs = 300; sim.tgt.vsRate = 500;
  sim.for(3, () => { s.rudderBias = Math.min(0.25, s.rudderBias + 0.2 * SIM_DT); s.elevBias = -0.1; });
  sim.tgt.flaps = 0; sim.tgt.ias = p.climbKias; sim.tgt.trim = 0.25;
  sim.for(14, () => { sim.tgt.vs = p.climbFpm; s.elevBias = lerp(s.elevBias, 0.05, 0.03); });
  const m = sim.marks;

  // Place the selected field on the final approach course, ahead of the termination point.
  const fr = sim.raw.find((r) => r.t >= m.terminate)!;
  const u = dirVec(300);
  const fieldStart = { e: fr.east + u.e * 950, n: fr.north + u.n * 950 };
  const fieldLen = 650;
  const fieldCenter = { e: fieldStart.e + u.e * fieldLen / 2, n: fieldStart.n + u.n * fieldLen / 2 };
  const failAt = sim.raw.find((r) => r.t >= m.fail)!;
  const steps: Step[] = [
    { id: 'cruise', title: 'Cruise', start: 0, end: m.fail, detail: [`${n(alt)} ft MSL (${n(alt - ground)} ft AGL), cruise power.`] },
    { id: 'fail', title: 'Engine failure — airspeed', start: m.fail, end: m.field, detail: [
      `Pitch for best glide, ${vg} KIAS, and trim. Trade any excess airspeed for altitude first.`,
      'A: Airspeed — the first thing, every time.',
    ] },
    { id: 'field', title: 'Best field — turn toward it', start: m.field, end: m.checklist, detail: [
      'B: Best field — into the wind if possible, long, smooth, no wires.',
      'Turn toward it right away; you can always adjust once there.',
    ] },
    { id: 'checklist', title: 'Checklist — try a restart', start: m.checklist, end: m.key, detail: [
      'C: Checklist (C172S engine failure in flight): airspeed 68 KIAS; fuel shutoff valve ON; fuel selector BOTH; fuel pump ON; mixture RICH; ignition BOTH (START if the prop has stopped).',
      'If no restart: 121.5 / 7700, brief passengers, doors unlatched before touchdown, master off when landing is assured.',
    ] },
    { id: 'key', title: 'Plan the approach — high key', start: m.key, end: m.downwind, detail: [
      'Circle down near the field to a downwind position, keeping it in sight.',
      'Glide turns: medium bank only; they cost extra altitude.',
    ] },
    { id: 'downwind', title: 'Downwind and base for the field', start: m.downwind, end: m.final, detail: [
      'Judge the base turn so you arrive a little high — you can always lose altitude, never gain it.',
    ] },
    { id: 'final', title: 'Final — flaps when the field is made', start: m.final, end: m.terminate, detail: [
      'Once the field is assured, extend flaps to steepen the approach.',
      'Aim about one-third of the way into the field.',
    ] },
    { id: 'terminate', title: 'Evaluator terminates — go around', start: m.terminate, end: 0, detail: [
      'In training the approach ends at a safe altitude (500 ft AGL shown): full power, climb, flaps up.',
    ] },
  ];
  const label = (t: number, text: string): SceneLabel => { const r = sim.raw.find((x) => x.t >= t)!; return { east: r.east, north: r.north, altFt: r.altFt + 150, text }; };
  return airworkRun({
    id: 'emergency-approach', title: 'Emergency Approach and Landing', acsCode: 'PA.IX.B', acsTask: 'Area IX, Task B',
    objective: 'After a simulated engine failure: best glide, pick a field, run the checklist, and fly a planned approach that would make the field.',
    sim, steps,
    tolerances: [
      { id: 'vg', label: 'Best glide speed', unit: 'kt', standard: '±10 kt', value: (f) => f.ias, target: vg, minus: 10, plus: 10, windows: [[m.glide, m.final]] },
    ],
    bugs: { altitudeFt: ground + 500, heading: 300, ias: vg },
    notes: ['The field is placed where this glide would arrive; in practice you choose the field first and plan to it.'],
    markers: [{ east: fieldCenter.e, north: fieldCenter.n, kind: 'field', width: 90, length: fieldLen, heading: 300, label: 'Selected field' }],
    labels: [
      { east: failAt.east, north: failAt.north, altFt: failAt.altFt + 150, text: 'Engine failure' },
      label(m.key + 3, 'High key'),
      { east: fieldCenter.e, north: fieldCenter.n, altFt: ground + 80, text: 'Selected field' },
    ],
  });
}

