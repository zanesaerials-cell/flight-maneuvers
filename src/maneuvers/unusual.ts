import { fullPower, pwT, type AircraftProfile, type Cert } from '../data/aircraft';
import { lerp, levelPitch, smoothstep } from '../engine/kinematics';
import type { ManeuverRun, Step } from '../engine/types';
import { airworkRun, cruiseSim } from './airwork';

/*
 * Recovery from unusual flight attitudes, as on the checkride: the instructor
 * puts the airplane in a nose-high, then a nose-low attitude; the student
 * recognizes each on the instruments and recovers in the right order.
 */

const n = (x: number) => Math.round(x).toLocaleString();

export function buildUnusualAttitudes(ac: AircraftProfile, cert: Cert = 'private'): ManeuverRun {
  void cert;
  const q = ac.procedures.perf;
  if (!q) throw new Error(`${ac.shortName} has no airwork profile`);
  const alt = q.airworkAltFt + 500, ground = q.airworkGroundFt;
  const sim = cruiseSim(ac, alt, ground, 360);
  const s = sim.s;
  const cruise = ac.cruiseKias;
  const vne = ac.arcs.yellowHigh;
  const highTop = Math.round(Math.max(q.stallCleanKias + 14, cruise - 30));
  const lowTop = Math.round(Math.min(cruise + 25, vne - 12));
  const hold = () => sim.holdAlt(alt, 400);

  sim.for(5, hold);

  // ── Nose high: climbing turn, airspeed bleeding off ──────────────────────────
  sim.mark('setHigh');
  let t0 = s.t;
  sim.tgt.ias = highTop; sim.tgt.accel = 1.6;
  sim.until(() => s.ias <= highTop + 1, () => {
    const u = smoothstep(0, 4, s.t - t0);
    s.pitch = lerp(levelPitch(ac, s.ias, 0), 17, u);
    s.bank = lerp(0, -30, u);
    sim.tgt.vs = lerp(0, 1100, u); sim.tgt.vsRate = 900;
  }, 25);
  sim.mark('recogHigh');
  sim.for(2, () => { s.pitch = 17; sim.tgt.vs = 900; });
  sim.mark('recoverHigh');
  t0 = s.t;
  sim.power(fullPower(ac)); s.rudderBias = 0.25;
  sim.tgt.ias = cruise; sim.tgt.accel = 1.2;
  sim.for(5, () => {
    const u = smoothstep(0, 4, s.t - t0);
    s.pitch = lerp(17, levelPitch(ac, s.ias, 0), u);      // nose to the horizon
    s.bank = lerp(s.bank, 0, 0.06);                        // level the wings
    sim.tgt.vs = lerp(900, 0, u); sim.tgt.vsRate = 900;
  });
  s.pitch = undefined; s.bank = 0;
  const highAlt = s.alt;
  sim.power(ac.pw.cruise); s.rudderBias = 0;
  sim.mark('stableHigh');
  sim.for(6, () => sim.holdAlt(highAlt, 300));

  // ── Nose low: descending spiral, airspeed building ──────────────────────────
  sim.mark('setLow');
  t0 = s.t;
  sim.tgt.ias = lowTop; sim.tgt.accel = 2.2;
  sim.until(() => s.ias >= lowTop - 1, () => {
    const u = smoothstep(0, 4, s.t - t0);
    s.pitch = lerp(levelPitch(ac, s.ias, 0), -11, u);
    s.bank = lerp(0, 45, u);
    sim.tgt.vs = lerp(0, -1700, u); sim.tgt.vsRate = 1100;
  }, 25);
  sim.mark('recogLow');
  sim.for(1.5, () => { s.pitch = -11; sim.tgt.vs = -1700; });
  sim.mark('recoverLow');
  t0 = s.t;
  sim.power(ac.rpm.idle);
  sim.for(2.5, () => { s.bank = lerp(s.bank, 0, 0.1); s.pitch = -10; sim.tgt.vs = -1500; });   // wings level first
  s.bank = 0;
  const t1 = s.t;
  sim.tgt.ias = cruise; sim.tgt.accel = 1.2;
  sim.for(5, () => {
    const u = smoothstep(0, 4.5, s.t - t1);
    s.pitch = lerp(-10, levelPitch(ac, s.ias, 0), u);     // then ease the nose up
    sim.tgt.vs = lerp(-1500, 0, u); sim.tgt.vsRate = 700;
  });
  s.pitch = undefined;
  const lowAlt = s.alt;
  sim.power(ac.pw.cruise);
  sim.mark('stableLow');
  sim.for(6, () => sim.holdAlt(lowAlt, 300));
  void t0;
  const m = sim.marks;

  const steps: Step[] = [
    { id: 'setup', title: 'Set up: eyes on the instruments', start: 0, end: m.setHigh, detail: [
      `Cruise at ${n(alt)} ft MSL (${n(alt - ground)} ft AGL), ${cruise} KIAS, clear of traffic.`,
      'On the checkride the student is under a view-limiting device; the instructor flies the airplane into the attitude and hands it back.',
      'Use the attitude indicator to tell nose high from nose low, then cross-check altimeter, airspeed and vertical speed.',
    ] },
    { id: 'high', title: 'Nose-high attitude develops', start: m.setHigh, end: m.recogHigh, detail: [
      'Nose above the horizon on the attitude indicator, banked.',
      `Altimeter climbing, VSI showing a climb, airspeed decreasing toward ${highTop} KIAS — approaching a stall.`,
    ] },
    { id: 'recogHigh', title: 'Recognize: nose high', start: m.recogHigh, end: m.recoverHigh, detail: [
      'Airspeed decreasing, altitude increasing: nose high. Act before the stall warning.',
    ] },
    { id: 'recoverHigh', title: 'Recover: power, nose down, wings level', start: m.recoverHigh, end: m.stableHigh, detail: [
      `Add full power (${pwT(ac, fullPower(ac))}), right rudder as needed.`,
      'At the same time lower the nose to the horizon and level the wings with coordinated aileron and rudder.',
      'Stop the climb on the altimeter and VSI, then trim.',
    ] },
    { id: 'stableHigh', title: 'Straight and level, cruise power', start: m.stableHigh, end: m.setLow, detail: [
      `Back to ${pwT(ac, ac.pw.cruise)}, trimmed, wings level.`,
    ] },
    { id: 'low', title: 'Nose-low attitude develops', start: m.setLow, end: m.recogLow, detail: [
      'Nose below the horizon on the attitude indicator, steep bank.',
      `Altimeter unwinding, VSI showing a steep descent, airspeed increasing toward ${lowTop} KIAS.`,
    ] },
    { id: 'recogLow', title: 'Recognize: nose low', start: m.recogLow, end: m.recoverLow, detail: [
      'Airspeed increasing, altitude decreasing: nose low, a spiral is developing.',
    ] },
    { id: 'recoverLow', title: 'Recover: power idle, wings level, then nose up', start: m.recoverLow, end: m.stableLow, detail: [
      'Power to idle.',
      'Level the wings first: pulling while banked only tightens the spiral and loads the airframe.',
      `Then smoothly raise the nose to the horizon, staying below Vne (${vne} KIAS) and within load limits. Trim.`,
    ] },
    { id: 'stableLow', title: 'Straight and level, cruise power', start: m.stableLow, end: 0, detail: [
      `Back to ${pwT(ac, ac.pw.cruise)} as the airspeed settles, trimmed. Cruise checklist when appropriate.`,
    ] },
  ];

  return airworkRun({
    id: 'unusual-attitudes', title: 'Recovery From Unusual Flight Attitudes', acsCode: 'PA.VIII.E', acsTask: 'Area VIII, Task E',
    objective: 'Recognize nose-high and nose-low attitudes on the instruments and recover with prompt, coordinated, correctly sequenced control inputs.',
    sim, steps,
    tolerances: [
      { id: 'hi', label: 'Nose-high: airspeed stays above stall', unit: 'kt', standard: 'No stall', value: (f) => f.ias, target: highTop + 10, minus: highTop + 10 - q.stallCleanKias - 3, plus: cruise, windows: [[m.recoverHigh, m.stableHigh]] },
      { id: 'lo', label: 'Nose-low: airspeed stays below Vne', unit: 'kt', standard: `Below ${vne} KIAS`, value: (f) => f.ias, target: (lowTop + q.stallCleanKias) / 2, minus: (lowTop - q.stallCleanKias) / 2, plus: vne - (lowTop + q.stallCleanKias) / 2 - 1, windows: [[m.recoverLow, m.stableLow]] },
    ],
    bugs: { altitudeFt: alt, heading: 360, ias: cruise },
    notes: ['Recognize and perform the correct, coordinated and smooth flight control application to recover.'],
  });
}
