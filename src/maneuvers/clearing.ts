import { pwT, vaFor, type AircraftProfile, type Cert } from '../data/aircraft';
import { angDiff } from '../engine/kinematics';
import type { ManeuverRun, Step } from '../engine/types';
import { MODEL_RIGS } from '../data/modelRigs';
import { airworkRun, cruiseSim } from './airwork';

/*
 * What happens before every airwork maneuver: clearing turns, a radio call to
 * the practice-area traffic, altitude and airspeed set, and the airplane
 * configured. Flown at the airwork altitude over open farmland.
 */

const n = (x: number) => Math.round(x).toLocaleString();
const CLEARING_BANK = 30;

export function buildClearingTurns(ac: AircraftProfile, cert: Cert = 'private'): ManeuverRun {
  void cert;
  const q = ac.procedures.perf;
  if (!q) throw new Error(`${ac.shortName} has no airwork profile`);
  const alt = q.airworkAltFt, ground = q.airworkGroundFt;
  const sim = cruiseSim(ac, alt, ground, 360);
  const hold = () => sim.holdAlt(alt, 300);
  const entry = Math.min(ac.procedures.steepTurns?.entryIas ?? ac.cruiseKias, ac.cruiseKias);
  const va = vaFor(ac, Infinity);
  const agl = alt - ground;
  const highWing = MODEL_RIGS[ac.id]?.fallback === 'high-wing';

  sim.for(4, hold);
  sim.mark('left');
  sim.turnTo(270, CLEARING_BANK, hold, -1);
  sim.for(2, hold);
  sim.mark('right');
  sim.turnTo(360, CLEARING_BANK, hold, 1);
  sim.mark('radio');
  sim.for(10, hold);
  sim.mark('altspd');
  sim.tgt.ias = entry; sim.tgt.accel = 1;
  sim.for(10, hold);
  sim.mark('configure');
  sim.for(12, hold);
  sim.mark('ready');
  sim.for(5, hold);
  const m = sim.marks;

  const steps: Step[] = [
    { id: 'area', title: 'Pick the practice area', start: 0, end: m.left, detail: [
      `High enough to recover by at least 1,500 ft AGL — shown at ${n(alt)} ft MSL (${n(agl)} ft AGL).`,
      'Away from towns, airports and people, with a field you could land in if the engine quit.',
      'Note a prominent landmark to orient on and an entry heading (360° here).',
    ] },
    { id: 'left', title: `Clearing turn left, 90°`, start: m.left, end: m.right, detail: [
      `Look left before rolling, then ${CLEARING_BANK}° bank and hold altitude.`,
      highWing
        ? 'High wing: lift the left wing slightly before rolling in to see under it into the turn.'
        : 'Low wing: look well out past the wingtip; the wing hides the area below you.',
      'Scan ahead, above and below the airspace you will maneuver in.',
      'Roll out on 270°.',
    ] },
    { id: 'right', title: 'Clearing turn right, back to the entry heading', start: m.right, end: m.radio, detail: [
      'Look right before rolling, then turn back to 360°. Together the two turns clear the whole area, including behind you.',
      'If you spot traffic, keep it in sight and wait, or move somewhere else.',
    ] },
    { id: 'radio', title: 'Radio call', start: m.radio, end: m.altspd, detail: [
      'On the practice-area frequency (CTAF or the one your school uses):',
      `“Area traffic, ${ac.shortName} [callsign], ${n(alt)} feet, [position from the landmark], maneuvering for the next [time], area traffic.”`,
      'Listen for others working the same area before you start.',
    ] },
    { id: 'altspd', title: 'Set altitude and airspeed', start: m.altspd, end: m.configure, detail: [
      `Altitude: on a round number, ${n(alt)} ft, altimeter set. Heading bug on the entry heading.`,
      `Airspeed: ${entry} KIAS, at or below maneuvering speed (Va ${va} KIAS at maximum weight; less when lighter). Power about ${pwT(ac, ac.pw.cruise)}.`,
      'Trim for hands-off level flight.',
    ] },
    { id: 'configure', title: `Configure the ${ac.shortName}`, start: m.configure, end: m.ready, detail: [
      ...ac.text.preManeuver,
      'Then set up for the maneuver itself (flaps, gear and power as its first step says).',
    ] },
    { id: 'ready', title: 'Ready: note the heading and begin', start: m.ready, end: 0, detail: [
      'Pick an outside reference on the entry heading, check the area one more time, and start the maneuver.',
    ] },
  ];

  return airworkRun({
    id: 'clearing-turns', title: 'Clearing Turns and Pre-Maneuver Checks', acsCode: 'PA.V.A', acsTask: 'Skill element in every Area V and VII task: “Clear the area”',
    objective: 'Clear the area, announce your intentions, set altitude and airspeed, and configure the airplane before starting any airwork maneuver.',
    sim, steps,
    tolerances: [
      { id: 'alt', label: 'Altitude in the clearing turns', unit: 'ft', standard: '±100 ft', value: (f) => f.altFt, target: alt, minus: 100, plus: 100, windows: [[m.left, m.radio]] },
      { id: 'hdg', label: 'Back on the entry heading', unit: '°', standard: '±10°', value: (f) => 360 + angDiff(360, f.heading), target: 360, minus: 10, plus: 10, windows: [[m.radio + 1, m.ready]] },
    ],
    bugs: { altitudeFt: alt, heading: 360, ias: entry },
    notes: ['Clearing turns, the radio call and the checklist come before every airwork maneuver: steep turns, slow flight, stalls, ground reference and the Commercial maneuvers.'],
  });
}
