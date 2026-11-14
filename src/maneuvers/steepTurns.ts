import { pwT, vaFor, type AircraftProfile, type Cert } from '../data/aircraft';
import { std } from './standards';
import {
  D2R, G, KT, R2D, angDiff, ease, finalize, tasFromIas, wrap360, type RawSample,
} from '../engine/kinematics';
import type { ManeuverRun, Step, Tolerance } from '../engine/types';

const DT = 0.05;

/**
 * Steep turns — ACS PA.V.A.
 * A 360° turn to the left at 45° bank, roll out on the entry heading,
 * then immediately a 360° turn to the right. Calm wind.
 */
export function buildSteepTurns(ac: AircraftProfile, cert: Cert = 'private'): ManeuverRun {
  const p0 = ac.procedures.steepTurns;
  if (!p0) throw new Error(`${ac.shortName} has no steep-turn profile`);
  const p = { ...p0, bankDeg: std(cert).steepBank };
  const gearUp = ac.retractable ? 0 : 1;

  const entryHeading = 360;
  const tas = tasFromIas(p.entryIas, p.altitudeFt);
  const tasMs = tas * KT;
  const rollTime = p.bankDeg / p.rollRateDps;
  const rpmRampTime = 2.0;

  // How much heading the airplane gains while rolling out — this is the lead.
  let rolloutLead = 0;
  for (let t = 0; t < rollTime; t += DT) {
    const bank = p.bankDeg * (1 - ease(t / rollTime));
    rolloutLead += (G * Math.tan(bank * D2R) / tasMs) * R2D * DT;
  }

  const raw: RawSample[] = [];
  const s = { t: 0, east: 0, north: 0, heading: entryHeading, bank: 0, rpm: p.entryRpm };
  const marks: Record<string, number> = {};
  const push = () => raw.push({
    t: s.t, east: s.east, north: s.north, altFt: p.altitudeFt,
    heading: wrap360(s.heading), bank: s.bank, ias: p.entryIas, tas, rpm: s.rpm, flaps: 0, gear: gearUp,
  });
  const integrate = () => {
    const rate = (G * Math.tan(s.bank * D2R) / tasMs) * R2D;
    s.heading += rate * DT;
    s.east += Math.sin(s.heading * D2R) * tasMs * DT;
    s.north += Math.cos(s.heading * D2R) * tasMs * DT;
    s.t += DT;
    push();
    return Math.abs(rate * DT);
  };
  const rpmToward = (rampStart: number) => Math.min(1, (s.t - rampStart) / rpmRampTime);

  const straight = (seconds: number) => {
    const end = s.t + seconds;
    while (s.t < end - 1e-9) integrate();
  };

  const turn = (dir: -1 | 1, key: string) => {
    let turned = 0;
    // Roll in. Power comes up as the bank passes 30°.
    marks[`${key}RollIn`] = s.t;
    const t0 = s.t;
    let powerStart = -1;
    const rpmFrom = s.rpm;
    while (s.t - t0 < rollTime) {
      s.bank = dir * p.bankDeg * ease((s.t - t0 + DT) / rollTime);
      if (powerStart < 0 && Math.abs(s.bank) >= 30) { powerStart = s.t; marks[`${key}Power`] = s.t; }
      if (powerStart >= 0) s.rpm = rpmFrom + (p.turnRpm - rpmFrom) * ease(rpmToward(powerStart));
      turned += integrate();
    }
    s.bank = dir * p.bankDeg;
    marks[`${key}Hold`] = s.t;
    // Hold until the remaining turn equals the rollout lead.
    while (turned < 360 - rolloutLead) {
      if (powerStart >= 0) s.rpm = rpmFrom + (p.turnRpm - rpmFrom) * ease(rpmToward(powerStart));
      turned += integrate();
    }
    marks[`${key}RollOut`] = s.t;
    marks[`${key}RollOutHdg`] = wrap360(s.heading);
    const t1 = s.t;
    const rpmTop = s.rpm;
    while (s.t - t1 < rollTime) {
      const u = (s.t - t1 + DT) / rollTime;
      s.bank = dir * p.bankDeg * (1 - ease(u));
      s.rpm = rpmTop + (p.entryRpm - rpmTop) * ease(Math.min(1, (s.t - t1) / (rollTime * 0.9)));
      turned += integrate();
    }
    s.bank = 0;
    s.rpm = p.entryRpm;
    marks[`${key}Level`] = s.t;
  };

  push();
  straight(7);
  turn(-1, 'L');
  straight(2.5);
  turn(1, 'R');
  straight(6);

  const frames = finalize(raw, ac, { trim: 0.15, cruiseRpm: p.entryRpm });
  const duration = frames[frames.length - 1].t;

  const vaList = ac.speeds.va.map((v) => `${v.kias} KIAS at ${v.weightLb.toLocaleString()} lb`).join(', ');
  void vaFor;
  const leadL = Math.round(angDiff(entryHeading, marks.LRollOutHdg));
  const leadR = Math.round(Math.abs(angDiff(entryHeading, marks.RRollOutHdg)));
  const fmtHdg = (h: number) => String(Math.round(wrap360(h)) || 360).padStart(3, '0');
  const agl = p.altitudeFt - p.groundElevFt;
  const turnRateDps = (G * Math.tan(p.bankDeg * D2R) / tasMs) * R2D;

  const steps: Step[] = [
    {
      id: 'setup', title: 'Set up and clear the area', start: 0, end: marks.LRollIn,
      detail: [
        `Altitude no lower than 1,500 ft AGL. Shown at ${p.altitudeFt.toLocaleString()} ft MSL (${agl.toLocaleString()} ft AGL).`,
        'Make clearing turns before you start (not animated).',
        `Power ${pwT(ac, p.entryRpm)}, stabilize at ${p.entryIas} KIAS, ${ac.text.cruiseSetup}.`,
        `Entry speed must not exceed Va for your weight: ${vaList}.`,
        'Trim for level flight. Note the entry heading, 360°, and pick a reference on the horizon.',
      ],
    },
    {
      id: 'roll-left', title: `Roll into a ${p.bankDeg}° left bank`, start: marks.LRollIn, end: marks.LHold,
      detail: [
        'Smooth left aileron with coordinated left rudder — keep the ball centered.',
        `Passing 30° of bank, add back pressure to hold altitude and add a little power (to ${pwT(ac, p.turnRpm)}) to hold airspeed.`,
        'Eyes outside: watch where the cowling sits on the horizon.',
      ],
    },
    {
      id: 'hold-left', title: `Hold ${p.bankDeg}° through 360°`, start: marks.LHold, end: marks.LRollOut,
      detail: [
        `Load factor is about ${(1 / Math.cos(p.bankDeg * D2R)).toFixed(2)} G, so stall speed rises about ${Math.round((Math.sqrt(1 / Math.cos(p.bankDeg * D2R)) - 1) * 100)}%.`,
        'Hold slight opposite (right) aileron to stop the overbanking tendency.',
        'Keep the horizon picture fixed; cross-check altimeter and VSI.',
        `At this speed the turn rate is about ${turnRateDps.toFixed(1)}°/s — a full circle in about ${Math.round(360 / turnRateDps)} s.`,
      ],
    },
    {
      id: 'rollout-left', title: `Roll out on 360° — lead by about ${leadL}°`, start: marks.LRollOut, end: marks.LLevel,
      detail: [
        `Begin the rollout passing about ${fmtHdg(marks.LRollOutHdg)}° (lead of roughly half the bank angle).`,
        'Right aileron with coordinated right rudder.',
        'Release back pressure — add a little forward pressure so the nose does not balloon.',
        `Reduce power back to ${pwT(ac, p.entryRpm)}.`,
      ],
    },
    {
      id: 'roll-right', title: `Reverse into a ${p.bankDeg}° right bank`, start: marks.LLevel, end: marks.RHold,
      detail: [
        'Check altitude and heading, then roll straight into the right turn.',
        'Right aileron with coordinated right rudder.',
        `Passing 30°, back pressure and power to ${pwT(ac, p.turnRpm)} again.`,
      ],
    },
    {
      id: 'hold-right', title: `Hold ${p.bankDeg}° through 360°`, start: marks.RHold, end: marks.RRollOut,
      detail: [
        'Same picture, opposite side: the cowling sits differently against the horizon from the left seat.',
        'Opposite (left) aileron as needed to hold the bank.',
        'Watch the VSI for an early trend and correct with small back-pressure changes.',
      ],
    },
    {
      id: 'rollout-right', title: `Roll out on 360° — lead by about ${leadR}°`, start: marks.RRollOut, end: marks.RLevel,
      detail: [
        `Begin the rollout passing about ${fmtHdg(marks.RRollOutHdg)}°.`,
        'Left aileron with coordinated left rudder, release back pressure.',
        `Power back to ${pwT(ac, p.entryRpm)}.`,
      ],
    },
    {
      id: 'complete', title: 'Straight and level, maneuver complete', start: marks.RLevel, end: duration,
      detail: [
        'Wings level on the entry heading, altitude and airspeed within standards.',
        'Clear the area and return to cruise.',
      ],
    },
  ];

  const tolerances: Tolerance[] = [
    {
      id: 'alt', label: 'Altitude', unit: 'ft', standard: '±100 ft',
      value: (f) => f.altFt, target: p.altitudeFt, minus: 100, plus: 100,
      windows: [[marks.LRollIn, marks.RLevel]],
    },
    {
      id: 'ias', label: 'Airspeed', unit: 'kt', standard: '±10 kt',
      value: (f) => f.ias, target: p.entryIas, minus: 10, plus: 10,
      windows: [[marks.LRollIn, marks.RLevel]],
    },
    {
      id: 'bank', label: 'Bank', unit: '°', standard: `${p.bankDeg}° ±5°`,
      value: (f) => Math.abs(f.bank), target: p.bankDeg, minus: 5, plus: 5,
      windows: [[marks.LHold, marks.LRollOut], [marks.RHold, marks.RRollOut]],
    },
    {
      id: 'hdg', label: 'Rollout heading', unit: '°', standard: '±10° of entry',
      value: (f) => entryHeading + angDiff(entryHeading, f.heading), target: entryHeading, minus: 10, plus: 10,
      windows: [[marks.LLevel, marks.LLevel + 2.5], [marks.RLevel, duration]],
    },
  ];

  return {
    id: 'steep-turns',
    title: 'Steep Turns',
    acsCode: 'PA.V.A',
    acsTask: 'Area V, Task A',
    objective: `Two 360° turns at ${p.bankDeg}° of bank, left then right, rolling out on the entry heading.`,
    frames, dt: DT, duration, steps, tolerances,
    scene: {
      groundElevFt: p.groundElevFt,
      roads: [
        { from: [-3000, -1200], to: [3000, -1200], width: 8 },
        { from: [1600, -3000], to: [1600, 3000], width: 8 },
      ],
      frameRadius: 420,
      frameCenter: [frames.reduce((a, f) => a + f.east, 0) / frames.length, frames.reduce((a, f) => a + f.north, 0) / frames.length],
    },
    bugs: { altitudeFt: p.altitudeFt, heading: entryHeading, ias: p.entryIas },
    notes: [
      'Calm wind is shown so the circle is clean. In wind, the ground track drifts but the cockpit picture is the same.',
      'Exact power and attitude vary with weight, density altitude and the individual airplane.',
    ],
  };
}
