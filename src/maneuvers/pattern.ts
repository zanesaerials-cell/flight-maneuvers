import type { AircraftProfile } from '../data/aircraft';
import { KCXW, type AirportDef } from '../data/airports';
import {
  D2R, FT, G, KT, R2D, angDiff, clamp, ease, finalize, lerp, smoothstep, tasFromIas, wrap360, type RawSample,
} from '../engine/kinematics';
import type { ManeuverRun, SceneLabel, Step, Tolerance } from '../engine/types';

const DT = 0.05;

type V2 = { e: number; n: number };
const dir = (deg: number): V2 => ({ e: Math.sin(deg * D2R), n: Math.cos(deg * D2R) });
const dot = (a: V2, b: V2) => a.e * b.e + a.n * b.n;

/**
 * One full traffic pattern lap: normal takeoff, upwind, crosswind, downwind,
 * base, final, normal landing and rollout. Calm wind, left traffic.
 *
 * Scene north is magnetic north so headings match the PFD and runway numbers.
 * The runway centre is the scene origin.
 */
export function buildPattern(ac: AircraftProfile, apt: AirportDef = KCXW, runwayEnd = '22'): ManeuverRun {
  const p = ac.procedures.pattern;
  if (!p) throw new Error(`${ac.shortName} has no pattern profile`);

  const rwy = apt.runways[0];
  const lowEnd = rwy.ends[0] === runwayEnd;
  const rwyHdg = wrap360(lowEnd ? rwy.magHeading : rwy.magHeading + 180);
  const traffic = apt.traffic[runwayEnd] ?? 'left';
  const turnSign = traffic === 'left' ? -1 : 1;
  const L = rwy.lengthFt * FT;
  const elev = apt.elevFt;
  const tpa = elev + apt.tpaAglFt;

  const u = dir(rwyHdg);                         // along the runway, direction of takeoff/landing
  const side = dir(rwyHdg + 90 * turnSign);      // toward the downwind leg
  const along = (q: V2) => dot(q, u);
  const lateral = (q: V2) => dot(q, side);
  const threshold = -L / 2;                      // along-coordinate of the landing threshold
  const departEnd = L / 2;
  const tdAlong = threshold + 1150 * FT;         // touchdown point
  const aimAlong = threshold + 1000 * FT;        // ACS "specified point"

  // ---------- Live state ----------
  const s = {
    t: 0, e: 0, n: 0, hdg: rwyHdg, bank: 0, ias: 0, rpm: 1000, flaps: p.takeoffFlaps,
    alt: elev, vs: 0, dist: 0, throttle: 0.15, trim: 0, elevBias: 0, rudderBias: 0, onGround: true,
  };
  const start = { e: u.e * (threshold + 15), n: u.n * (threshold + 15) };
  s.e = start.e; s.n = start.n;
  const target = { ias: 0, accel: 1.2, flaps: p.takeoffFlaps, rpm: 1000, throttle: 0.15, trim: 0, vs: 0 };
  const raw: RawSample[] = [];
  const ground: boolean[] = [];
  const dists: number[] = [];
  const marks: Record<string, number> = {};
  const mark = (k: string) => { marks[k] = s.t; };

  const approach = (cur: number, tgt: number, rate: number) =>
    cur + clamp(tgt - cur, -rate * DT, rate * DT);

  const record = () => {
    raw.push({
      t: s.t, east: s.e, north: s.n, altFt: s.alt, heading: wrap360(s.hdg), bank: s.bank,
      ias: s.ias, tas: tasFromIas(s.ias, s.alt), rpm: s.rpm, flaps: s.flaps,
      throttle: s.throttle, trim: s.trim, elevBias: s.elevBias, rudderBias: s.rudderBias,
    });
    ground.push(s.onGround);
    dists.push(s.dist);
  };

  const tick = (groundAccel?: number) => {
    if (groundAccel !== undefined) {
      s.ias = Math.max(0, s.ias + (groundAccel / KT) * DT);
    } else {
      s.ias = approach(s.ias, target.ias, target.accel);
    }
    s.flaps = approach(s.flaps, target.flaps, 3);
    s.rpm = approach(s.rpm, target.rpm, 250);
    s.throttle = approach(s.throttle, target.throttle, 0.5);
    s.trim = approach(s.trim, target.trim, 0.15);
    if (!s.onGround) {
      s.vs = approach(s.vs, target.vs, 250);           // fpm per second
      s.alt += (s.vs / 60) * DT;
    }
    const tasMs = Math.max(0.1, tasFromIas(s.ias, s.alt) * KT);
    if (!s.onGround && Math.abs(s.bank) > 0.01) {
      s.hdg += (G * Math.tan(s.bank * D2R) / tasMs) * R2D * DT;
    }
    // Calm wind: track = heading, groundspeed = TAS (horizontal component).
    const gs = tasMs * Math.cos(Math.atan2(s.vs * FT / 60, tasMs));
    s.e += Math.sin(s.hdg * D2R) * gs * DT;
    s.n += Math.cos(s.hdg * D2R) * gs * DT;
    s.dist += gs * DT;
    s.t += DT;
    record();
  };

  // Climb with automatic level-off at pattern altitude (lead ≈ 10 % of VSI).
  const climbLaw = () => {
    const toGo = tpa - s.alt;
    target.vs = toGo > 70 ? p.climbFpm : Math.max(0, p.climbFpm * (toGo / 70));
  };

  /** Heading change used up while rolling out of a turn — the lead. */
  const rollTime = 2.5;
  const rolloutLead = (iasKt: number, bank: number) => {
    const v = tasFromIas(iasKt, tpa) * KT;
    let h = 0;
    for (let t = 0; t < rollTime; t += DT) h += (G * Math.tan(bank * (1 - ease(t / rollTime)) * D2R) / v) * R2D * DT;
    return h;
  };
  /** Lateral distance a 90° turn moves the airplane, used to start turns early. */
  const turnTransfer = (iasKt: number, bank: number) => {
    const v = tasFromIas(iasKt, tpa) * KT;
    let h = 0, x = 0, b = 0, t = 0;
    const lead = rolloutLead(iasKt, bank);
    let phase = 0, t0 = 0;
    while (phase < 3 && t < 120) {
      if (phase === 0) { b = bank * ease(t / rollTime); if (t >= rollTime) phase = 1; }
      else if (phase === 1) { b = bank; if (h >= 90 - lead) { phase = 2; t0 = t; } }
      else { b = bank * (1 - ease((t - t0) / rollTime)); if (t - t0 >= rollTime) phase = 3; }
      h += (G * Math.tan(b * D2R) / v) * R2D * DT;
      x += Math.sin(h * D2R) * v * DT;
      t += DT;
    }
    return x;
  };

  const turnTo = (newHdg: number, during?: () => void) => {
    const dirSign = Math.sign(angDiff(s.hdg, newHdg)) || turnSign;
    const bank = p.turnBankDeg * dirSign;
    const t0 = s.t;
    while (s.t - t0 < rollTime) { s.bank = bank * ease((s.t - t0 + DT) / rollTime); during?.(); tick(); }
    while (Math.abs(angDiff(s.hdg, newHdg)) > rolloutLead(s.ias, p.turnBankDeg)) { s.bank = bank; during?.(); tick(); }
    const t1 = s.t;
    while (s.t - t1 < rollTime) { s.bank = bank * (1 - ease((s.t - t1 + DT) / rollTime)); during?.(); tick(); }
    s.bank = 0;
  };

  const pos = (): V2 => ({ e: s.e, n: s.n });

  // ---------- Script ----------
  record();
  // Lined up on the runway, brakes held.
  for (let i = 0; i < 40; i++) tick(0);
  mark('roll');
  // Takeoff roll: smooth full throttle, accelerate to rotation speed.
  target.throttle = 1; target.rpm = p.takeoffRpm;
  while (s.ias < p.rotateKias) {
    s.rudderBias = 0.08 + 0.18 * (s.ias / p.rotateKias);
    tick(p.groundAccel * smoothstep(0, 3, s.t - marks.roll));
  }
  mark('rotate');
  // Rotate: lift the nosewheel, fly off.
  while (s.ias < p.liftoffKias) { s.elevBias = approach(s.elevBias, 0.35, 0.4); tick(p.groundAccel * 0.85); }
  s.onGround = false;
  mark('liftoff');
  // Initial climb: accelerate to Vy, full power.
  target.ias = p.climbKias; target.accel = 1.2; target.rpm = p.climbRpm; target.trim = 0.25;
  const climbUntil = (cond: () => boolean) => {
    while (!cond()) { s.elevBias = approach(s.elevBias, 0.05, 0.1); climbLaw(); tick(); }
  };
  climbUntil(() => s.ias >= p.climbKias - 1 || s.t - marks.liftoff > 8);
  mark('vy');
  // Upwind: past the departure end and within 300 ft of pattern altitude.
  climbUntil(() => s.alt >= tpa - 300 && along(pos()) > departEnd);
  mark('crosswindTurn');
  const crosswindHdg = wrap360(rwyHdg + 90 * turnSign);
  turnTo(crosswindHdg, climbLaw);
  mark('crosswind');
  // Crosswind leg: finish the climb, level off, set cruise power.
  const xferDw = turnTransfer(p.downwindKias, p.turnBankDeg);
  let leveled = false;
  while (lateral(pos()) < p.downwindOffsetM - xferDw) {
    climbLaw();
    if (!leveled && s.alt > tpa - 5) {
      leveled = true; mark('level');
      target.ias = p.downwindKias; target.accel = 0.8; target.trim = 0.1;
    }
    if (leveled && s.ias > p.downwindKias - 4) { target.rpm = p.downwindRpm; target.throttle = 0.72; }
    tick();
  }
  mark('downwindTurn');
  const downwindHdg = wrap360(rwyHdg + 180);
  turnTo(downwindHdg, () => {
    climbLaw();
    if (!leveled && s.alt > tpa - 5) { leveled = true; mark('level'); target.ias = p.downwindKias; target.accel = 0.8; target.trim = 0.1; }
    if (leveled && s.ias > p.downwindKias - 4) { target.rpm = p.downwindRpm; target.throttle = 0.72; }
  });
  target.rpm = p.downwindRpm; target.throttle = 0.72; target.ias = p.downwindKias; target.trim = 0.1;
  mark('downwind');
  // Downwind: level at pattern altitude until abeam the touchdown end of the runway.
  while (along(pos()) > threshold) { target.vs = 0; tick(); }
  mark('abeam');
  // Abeam the numbers: power back, first notch of flaps, start down.
  target.rpm = p.abeamRpm; target.throttle = 0.4; target.ias = p.abeamKias; target.accel = 1.0; target.flaps = p.abeamFlaps; target.trim = 0.3;
  // Turn base when the threshold is 45° behind the wing: distance past it equals the lateral offset.
  while (threshold - along(pos()) < lateral(pos())) tick();
  mark('baseTurn');
  const baseHdg = wrap360(rwyHdg - 90 * turnSign);
  turnTo(baseHdg);
  mark('base');
  target.flaps = p.baseFlaps; target.ias = p.baseKias; target.trim = 0.38;
  const xferFinal = turnTransfer(p.baseKias, p.turnBankDeg);
  while (lateral(pos()) > xferFinal) tick();
  mark('finalTurn');
  turnTo(rwyHdg);
  mark('final');
  const finalStartIdx = raw.length - 1;
  const lateralErr = lateral(pos());
  target.flaps = p.finalFlaps; target.ias = p.finalKias; target.trim = 0.45;
  // Final: stabilized, then flare and touch down at the touchdown point.
  while (along(pos()) < tdAlong) {
    const toGo = tdAlong - along(pos());
    if (along(pos()) > threshold - 30 && target.rpm !== ac.rpm.idle) { mark('threshold'); target.rpm = ac.rpm.idle; target.throttle = 0; }
    if (toGo < 150) {
      target.ias = lerp(p.touchdownKias, p.finalKias, toGo / 150);
      target.accel = 3;
      s.elevBias = lerp(0.5, 0.15, toGo / 150);
    }
    tick();
  }
  s.onGround = true;
  s.vs = 0; target.vs = 0;
  mark('touchdown');
  // Rollout: nosewheel down, brakes as needed.
  while (s.ias > 15) {
    s.elevBias = approach(s.elevBias, 0.2, 0.15);
    s.rudderBias = approach(s.rudderBias, 0, 0.2);
    tick(-p.landingDecel * smoothstep(0, 2, s.t - marks.touchdown));
  }
  for (let i = 0; i < 40; i++) tick(-1);
  mark('end');

  // ---------- Remove the small lateral miss left by the final turn ----------
  for (let i = finalStartIdx; i < raw.length; i++) {
    const k = 1 - smoothstep(0, 10, raw[i].t - marks.final);
    raw[i].east -= side.e * lateralErr * (1 - k);
    raw[i].north -= side.n * lateralErr * (1 - k);
  }

  // ---------- Descent profile from abeam to touchdown ----------
  // A straight descent path (≈ 600 fpm at 80 kt) that blends into a
  // rounded flare in the last 120 m so vertical speed is near zero at touchdown.
  const iAbeam = raw.findIndex((r) => r.t >= marks.abeam);
  const iTd = raw.findIndex((r) => r.t >= marks.touchdown);
  const S = dists[iTd] - dists[iAbeam];
  const H = apt.tpaAglFt * FT;
  const sf = 120;
  const a = H / (S - sf / 2);
  const c = a / (2 * sf);
  for (let i = iAbeam; i <= iTd; i++) {
    const rem = dists[iTd] - dists[i];
    const h = rem > sf ? a * rem + (H - a * S) : c * rem * rem;
    const blend = smoothstep(0, 250, dists[i] - dists[iAbeam]);
    raw[i].altFt = elev + (H - (H - h) * blend) / FT;
  }
  for (let i = iTd; i < raw.length; i++) raw[i].altFt = elev;

  const frames = finalize(raw, ac, { trim: 0, cruiseRpm: p.downwindRpm });

  // ---------- Attitudes the generic model does not cover ----------
  const groundPitch = 0.5;
  const tRot = marks.rotate, tLift = marks.liftoff, tTd = marks.touchdown;
  frames.forEach((f, i) => {
    if (f.t < tRot) f.pitch = groundPitch;
    else if (f.t < tLift + 3) {
      const rotPitch = lerp(groundPitch, 9, ease((f.t - tRot) / (tLift - tRot + 1)));
      f.pitch = lerp(rotPitch, f.pitch, smoothstep(tLift, tLift + 3, f.t));
    }
    if (f.t >= tTd) f.pitch = lerp(frames[iTd].pitch, groundPitch, ease((f.t - tTd) / 4));
    if (ground[i]) { f.vsi = 0; }
    f.loadFactor = ground[i] ? 1 : f.loadFactor;
  });

  const duration = frames[frames.length - 1].t;

  // ---------- Leg labels in the 3D scene ----------
  const at = (t: number) => frames[Math.min(frames.length - 1, Math.round(t / DT))];
  const label = (t: number, text: string): SceneLabel => { const f = at(t); return { east: f.east, north: f.north, altFt: f.altFt + 120, text }; };
  const labels = [
    label((marks.vy + marks.crosswindTurn) / 2, 'Upwind'),
    label((marks.crosswind + marks.downwindTurn) / 2, 'Crosswind'),
    label((marks.downwind + marks.abeam) / 2, 'Downwind'),
    label((marks.base + marks.finalTurn) / 2, 'Base'),
    label((marks.final + marks.threshold) / 2, 'Final'),
  ];

  // ---------- Steps ----------
  const rwyName = runwayEnd.replace(/^0/, '');
  const fmtH = (h: number) => String(Math.round(wrap360(h)) || 360).padStart(3, '0');
  const tpaS = tpa.toLocaleString();
  const steps: Step[] = [
    {
      id: 'lineup', title: `Line up on runway ${rwyName}`, start: 0, end: marks.roll,
      detail: [
        `${apt.name}: runway ${rwy.ends.map((x) => x.replace(/^0/, '')).join('/')}, ${rwy.lengthFt.toLocaleString()} × ${rwy.widthFt} ft, field elevation ${elev} ft.`,
        `${traffic === 'left' ? 'Left' : 'Right'} traffic, pattern altitude ${tpaS} ft MSL (${apt.tpaAglFt.toLocaleString()} ft AGL).`,
        'Before-takeoff checklist complete. Announce your departure on the CTAF.',
        `Flaps ${p.takeoffFlaps}° (POH allows 0–10°), mixture rich, heading bug on runway heading ${fmtH(rwyHdg)}.`,
      ],
    },
    {
      id: 'roll', title: 'Takeoff roll', start: marks.roll, end: marks.rotate,
      detail: [
        'Smoothly apply full throttle. Check RPM and engine gauges in the green.',
        'Right rudder to hold the centerline as P-factor and slipstream build.',
        'Check airspeed alive.',
      ],
    },
    {
      id: 'rotate', title: `Rotate at ${p.rotateKias} KIAS`, start: marks.rotate, end: marks.liftoff + 2,
      detail: [
        'Gentle back pressure to lift the nosewheel.',
        `The airplane flies off at about ${p.liftoffKias} KIAS — let it, don't pull it off.`,
      ],
    },
    {
      id: 'climb', title: `Climb at Vy, ${p.climbKias} KIAS`, start: marks.liftoff + 2, end: marks.crosswindTurn,
      detail: [
        `Pitch about 10° nose up for ${p.climbKias} KIAS, full power (about ${p.climbRpm.toLocaleString()} RPM).`,
        'Keep right rudder in — the ball stays centered.',
        'Trim to relieve back pressure.',
        `Stay on runway heading until past the departure end and within 300 ft of pattern altitude (${(tpa - 300).toLocaleString()} ft).`,
      ],
    },
    {
      id: 'crosswind', title: 'Turn crosswind', start: marks.crosswindTurn, end: marks.downwindTurn,
      detail: [
        `Clear left, then a climbing ${traffic} turn at ${p.turnBankDeg}° bank to ${fmtH(crosswindHdg)}.`,
        `Level off at ${tpaS} ft — start leveling about 70 ft early.`,
        `Let it accelerate, then reduce to ${p.downwindRpm.toLocaleString()} RPM and trim.`,
      ],
    },
    {
      id: 'downwind', title: 'Downwind', start: marks.downwindTurn, end: marks.abeam,
      detail: [
        `Turn to ${fmtH(downwindHdg)}, about ${(p.downwindOffsetM / 1852).toFixed(1)} nm from the runway — the runway sits about halfway up the strut.`,
        `${tpaS} ft, ${p.downwindRpm.toLocaleString()} RPM, about ${p.downwindKias} KIAS.`,
        'Before-landing checklist: fuel selector BOTH, mixture rich, landing light on, seatbelts.',
        'Announce downwind on the CTAF.',
      ],
    },
    {
      id: 'abeam', title: 'Abeam the numbers', start: marks.abeam, end: marks.baseTurn,
      detail: [
        `Power to ${p.abeamRpm.toLocaleString()} RPM.`,
        `Below 110 KIAS, flaps ${p.abeamFlaps}°.`,
        `Pitch for ${p.abeamKias} KIAS and trim — the descent starts on its own.`,
      ],
    },
    {
      id: 'base', title: 'Turn base', start: marks.baseTurn, end: marks.finalTurn,
      detail: [
        'Turn when the runway threshold is about 45° behind the wing.',
        `${p.turnBankDeg}° bank to ${fmtH(baseHdg)}. Announce base.`,
        `Flaps ${p.baseFlaps}° (below 85 KIAS), ${p.baseKias} KIAS, trim.`,
        'Look down the final approach path for traffic before turning final.',
      ],
    },
    {
      id: 'final', title: 'Turn final, stabilize', start: marks.finalTurn, end: marks.threshold,
      detail: [
        `Lead the turn so you roll out on the extended centerline, heading ${fmtH(rwyHdg)}.`,
        `Flaps ${p.finalFlaps}°, ${p.finalKias} KIAS (POH: 60–70 KIAS with full flaps). Trim.`,
        `Pick your aim point — shown 1,000 ft down the runway. Keep it fixed in the windshield.`,
        'Stabilized: on speed, on centerline, about 500 fpm down.',
      ],
    },
    {
      id: 'flare', title: 'Flare and touch down', start: marks.threshold, end: marks.touchdown + 1,
      detail: [
        'Over the threshold, power to idle.',
        'Begin the round-out about 10–15 ft above the runway, eyes toward the far end.',
        `Hold it off with increasing back pressure. Main wheels first, about ${p.touchdownKias} KIAS.`,
      ],
    },
    {
      id: 'rollout', title: 'Rollout', start: marks.touchdown + 1, end: duration,
      detail: [
        'Lower the nosewheel gently and keep the centerline with rudder.',
        'Brake as needed. Flaps up and after-landing checklist once clear of the runway.',
      ],
    },
  ];

  const tolerances: Tolerance[] = [
    {
      id: 'climb', label: 'Climb speed (Vy)', unit: 'kt', standard: '+10 / −5 kt',
      value: (f) => f.ias, target: p.climbKias, minus: 5, plus: 10,
      windows: [[marks.vy, marks.crosswindTurn]],
    },
    {
      id: 'tpa', label: 'Pattern altitude', unit: 'ft', standard: '±100 ft',
      value: (f) => f.altFt, target: tpa, minus: 100, plus: 100,
      windows: [[marks.downwind, marks.abeam]],
    },
    {
      id: 'dwspd', label: 'Downwind airspeed', unit: 'kt', standard: '±10 kt',
      value: (f) => f.ias, target: p.downwindKias, minus: 10, plus: 10,
      windows: [[marks.downwind, marks.abeam]],
    },
    {
      id: 'final', label: 'Approach speed', unit: 'kt', standard: '+10 / −5 kt',
      value: (f) => f.ias, target: p.finalKias, minus: 5, plus: 10,
      windows: [[marks.final + 4, marks.threshold]],
    },
    {
      id: 'td', label: 'Touchdown past aim point', unit: 'ft', standard: '0 to +400 ft',
      value: (f) => (along({ e: f.east, n: f.north }) - aimAlong) / FT, target: 200, minus: 200, plus: 200,
      windows: [[marks.touchdown, marks.touchdown + 0.6]],
    },
  ];

  // Frame the whole pattern in the top view.
  const es = frames.map((f) => f.east), ns = frames.map((f) => f.north);
  const cx = (Math.min(...es) + Math.max(...es)) / 2, cn = (Math.min(...ns) + Math.max(...ns)) / 2;
  const radius = Math.max(Math.max(...es) - Math.min(...es), Math.max(...ns) - Math.min(...ns)) / 2 * 1.1;

  return {
    id: 'traffic-pattern',
    title: `Pattern Lap, ${apt.id}`,
    acsCode: 'PA.III.B',
    acsTask: 'Area III, Task B (with IV.A and IV.B)',
    objective: `A full circuit from runway ${rwyName}: normal takeoff and climb, ${traffic} traffic at pattern altitude, normal approach and landing.`,
    frames, dt: DT, duration, steps, tolerances,
    scene: {
      groundElevFt: elev,
      roads: [],
      runways: [{ center: [0, 0], heading: rwy.magHeading, lengthM: L, widthM: rwy.widthFt * FT, ends: rwy.ends }],
      labels,
      frameRadius: radius,
      frameCenter: [cx, cn],
    },
    bugs: { altitudeFt: tpa, heading: rwyHdg, ias: p.finalKias },
    notes: [
      'Calm wind. The map uses magnetic north so headings match the runway numbers.',
      ...apt.notes,
      'Verify runway and pattern data in the current Chart Supplement before flying.',
    ],
  };
}
