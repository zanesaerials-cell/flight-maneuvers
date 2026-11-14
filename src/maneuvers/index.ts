import type { AircraftProfile, Cert } from '../data/aircraft';
import type { ManeuverRun } from '../engine/types';
import { buildSteepTurns } from './steepTurns';
import { buildSTurns } from './sTurns';
import { buildPattern } from './pattern';
import {
  buildForwardSlip, buildGoAround, buildNormalLanding, buildNormalTakeoff,
  buildShortLanding, buildShortTakeoff, buildSoftLanding, buildSoftTakeoff,
} from './takeoffLanding';
import { buildRectangularCourse, buildTurnsAroundPoint } from './groundTrack';
import {
  buildEmergencyApproach, buildEmergencyDescent, buildPowerOffStall, buildPowerOnStall, buildSlowFlight,
} from './airwork';
import {
  buildAcceleratedStall, buildChandelle, buildEightsOnPylons, buildLazyEight, buildPowerOff180, buildSteepSpiral,
} from './commercial';
import { buildCrossControlStall, buildElevatorTrimStall, buildSecondaryStall } from './cfi';
import {
  buildEngineFailureAfterLiftoff, buildOeiLanding, buildOeiManeuvering, buildRejectedTakeoff, buildVmcDemo,
} from './multi';
import { certInfo } from './standards';

type Builder = (ac: AircraftProfile, cert: Cert) => ManeuverRun;

export interface ManeuverDef {
  id: string;
  title: string;
  group: string;
  summary: string;
  build: Builder;
  /** Checkride sections this maneuver belongs to. */
  certs: Cert[];
  /** Which procedure block an aircraft profile needs for this maneuver. */
  needs: keyof AircraftProfile['procedures'];
  /** Task letter per section where it differs from the builder's own code, e.g. { commercial: 'CA.V.A' }. */
  codes?: Partial<Record<Cert, string>>;
}

const ALL: Cert[] = ['private', 'commercial', 'cfi', 'multi'];
const SE: Cert[] = ['private', 'commercial', 'cfi'];
const COM: Cert[] = ['commercial', 'cfi'];
const TL = 'Takeoffs, landings and go-arounds';
const PERF = 'Performance and ground reference';
const SLOW = 'Slow flight and stalls';
const EMER = 'Emergency operations';
const ME = 'Multi-engine operations';

/** Every maneuver, in checkride order. */
export const MANEUVERS: ManeuverDef[] = [
  { id: 'traffic-pattern', title: 'Pattern Lap — Conway (KCXW) Rwy 22', group: TL, summary: 'Takeoff, all four legs, configuration and power at each point, landing.', build: (ac, c) => buildPattern(ac, c), certs: ALL, needs: 'pattern' },
  { id: 'normal-takeoff', title: 'Normal Takeoff and Climb', group: TL, summary: 'Rotation, Vy climb, departure.', build: buildNormalTakeoff, certs: ALL, needs: 'pattern' },
  { id: 'normal-landing', title: 'Normal Approach and Landing', group: TL, summary: 'Stabilized approach, flare and touchdown.', build: buildNormalLanding, certs: ALL, needs: 'pattern' },
  { id: 'soft-takeoff', title: 'Soft-Field Takeoff and Climb', group: TL, summary: 'Weight off the nosewheel, ground effect acceleration.', build: buildSoftTakeoff, certs: SE, needs: 'perf' },
  { id: 'soft-landing', title: 'Soft-Field Approach and Landing', group: TL, summary: 'Touch down at minimum speed, nose held off.', build: buildSoftLanding, certs: SE, needs: 'perf' },
  { id: 'short-takeoff', title: 'Short-Field Takeoff and Max Climb', group: TL, summary: 'Full power on the brakes, obstacle-clearance climb.', build: buildShortTakeoff, certs: ALL, needs: 'perf' },
  { id: 'short-landing', title: 'Short-Field Approach and Landing', group: TL, summary: 'Precise approach speed and touchdown point.', build: buildShortLanding, certs: ALL, needs: 'perf' },
  { id: 'forward-slip', title: 'Forward Slip to a Landing', group: TL, summary: 'Crossed controls to lose altitude without gaining speed.', build: buildForwardSlip, certs: ['private', 'cfi'], needs: 'perf' },
  { id: 'power-off-180', title: 'Power-Off 180° Accuracy Approach', group: TL, summary: 'Idle abeam the point, glide to touchdown within 200 ft.', build: buildPowerOff180, certs: COM, needs: 'perf' },
  { id: 'go-around', title: 'Go-Around / Rejected Landing', group: TL, summary: 'Power, attitude, clean up in stages.', build: buildGoAround, certs: ALL, needs: 'perf' },

  { id: 'steep-turns', title: 'Steep Turns', group: PERF, summary: '360° each way: 45° bank Private, 50° Commercial.', build: buildSteepTurns, certs: ALL, needs: 'steepTurns' },
  { id: 'steep-spiral', title: 'Steep Spiral', group: PERF, summary: 'Three gliding turns around a point.', build: buildSteepSpiral, certs: COM, needs: 'sTurns' },
  { id: 'chandelle', title: 'Chandelles', group: PERF, summary: 'Maximum-performance 180° climbing turn.', build: buildChandelle, certs: COM, needs: 'perf' },
  { id: 'lazy-eight', title: 'Lazy Eights', group: PERF, summary: 'Two symmetrical 180° turns, everything changing.', build: buildLazyEight, certs: COM, needs: 'perf' },
  { id: 'eights-on-pylons', title: 'Eights on Pylons', group: PERF, summary: 'Pivotal altitude around two pylons, 10 kt wind.', build: buildEightsOnPylons, certs: COM, needs: 'sTurns' },
  { id: 's-turns', title: 'S-Turns', group: PERF, summary: 'Half-circles across a road, 10 kt wind.', build: (ac) => buildSTurns(ac), certs: ['private', 'cfi'], needs: 'sTurns' },
  { id: 'rectangular-course', title: 'Rectangular Course', group: PERF, summary: 'Wind correction around a field, 10 kt wind.', build: (ac) => buildRectangularCourse(ac), certs: ['private', 'cfi'], needs: 'sTurns' },
  { id: 'turns-around-point', title: 'Turns Around a Point', group: PERF, summary: 'Constant radius around a point, 10 kt wind.', build: (ac) => buildTurnsAroundPoint(ac), certs: ['private', 'cfi'], needs: 'sTurns' },

  { id: 'slow-flight', title: 'Maneuvering During Slow Flight', group: SLOW, summary: 'Flight just above the stall warning.', build: buildSlowFlight, certs: ALL, needs: 'perf' },
  { id: 'power-off-stall', title: 'Power-Off Stalls', group: SLOW, summary: 'Approach configuration stall and recovery.', build: buildPowerOffStall, certs: ALL, needs: 'perf' },
  { id: 'power-on-stall', title: 'Power-On Stalls', group: SLOW, summary: 'Departure configuration stall and recovery.', build: buildPowerOnStall, certs: ALL, needs: 'perf' },
  { id: 'accelerated-stall', title: 'Accelerated Stalls', group: SLOW, summary: 'Stall in a 45° banked turn, recover at first indication.', build: buildAcceleratedStall, certs: ['commercial', 'cfi', 'multi'], needs: 'perf' },
  { id: 'secondary-stall', title: 'Secondary Stall (Demonstration)', group: SLOW, summary: 'What a rushed recovery causes.', build: buildSecondaryStall, certs: ['cfi'], needs: 'perf' },
  { id: 'cross-control-stall', title: 'Cross-Controlled Stall (Demonstration)', group: SLOW, summary: 'The skidding base-to-final turn.', build: buildCrossControlStall, certs: ['cfi'], needs: 'perf' },
  { id: 'elevator-trim-stall', title: 'Elevator Trim Stall (Demonstration)', group: SLOW, summary: 'Go-around power with approach trim.', build: buildElevatorTrimStall, certs: ['cfi'], needs: 'perf' },

  { id: 'emergency-descent', title: 'Emergency Descent', group: EMER, summary: 'Idle, steep descending turn, controlled level-off.', build: buildEmergencyDescent, certs: ALL, needs: 'perf' },
  { id: 'emergency-approach', title: 'Emergency Approach and Landing', group: EMER, summary: 'Engine failure: best glide, best field, checklist, approach.', build: buildEmergencyApproach, certs: SE, needs: 'perf' },
  { id: 'engine-failure-takeoff-roll', title: 'Engine Failure During Takeoff Before Vmc', group: ME, summary: 'Both power levers idle, stop on the runway.', build: buildRejectedTakeoff, certs: ['multi'], needs: 'perf' },
  { id: 'engine-failure-after-liftoff', title: 'Engine Failure After Liftoff', group: ME, summary: 'Blue line, drill, feather, single-engine climb.', build: buildEngineFailureAfterLiftoff, certs: ['multi'], needs: 'perf' },
  { id: 'oei-approach-landing', title: 'Approach and Landing, One Engine Inoperative', group: ME, summary: 'Vyse until assured, rudder with every power change.', build: buildOeiLanding, certs: ['multi'], needs: 'perf' },
  { id: 'oei-maneuvering', title: 'Maneuvering With One Engine Inoperative', group: ME, summary: 'Failure in cruise, drill, turns on one engine.', build: buildOeiManeuvering, certs: ['multi'], needs: 'perf' },
  { id: 'vmc-demo', title: 'Vmc Demonstration', group: ME, summary: 'Loss of directional control and recovery.', build: buildVmcDemo, certs: ['multi'], needs: 'perf' },
];

export const isReady = (m: ManeuverDef, ac: AircraftProfile, cert: Cert) =>
  ac.available && ac.certs.includes(cert) && m.certs.includes(cert) && !!ac.procedures[m.needs];

export const maneuversFor = (ac: AircraftProfile, cert: Cert) => MANEUVERS.filter((m) => isReady(m, ac, cert));

/** Build a maneuver and stamp it with the right ACS document and task code for the section. */
export function buildManeuver(m: ManeuverDef, ac: AircraftProfile, cert: Cert): ManeuverRun {
  const run = m.build(ac, cert);
  const info = certInfo(cert);
  const own = run.acsCode.split('.')[0];
  // Private and Commercial share area and task letters for the common tasks; instructor demonstrations keep their own code.
  const code = own === 'AI' ? run.acsCode : run.acsCode.replace(/^[A-Z]+/, info.prefix);
  return { ...run, acsCode: code, acsDoc: own === 'AI' ? 'Flight Instructor ACS' : info.acsDoc };
}
