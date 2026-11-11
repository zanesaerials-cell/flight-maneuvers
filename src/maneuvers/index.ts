import type { AircraftProfile } from '../data/aircraft';
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

export interface ManeuverDef {
  id: string;
  title: string;
  acsCode: string;
  group: string;
  summary: string;
  build?: (ac: AircraftProfile) => ManeuverRun;
  /** Which procedure block an aircraft profile needs for this maneuver. */
  needs?: keyof AircraftProfile['procedures'];
}

/** Private Pilot ACS (FAA-S-ACS-6C) maneuvers, in checkride order. */
export const MANEUVERS: ManeuverDef[] = [
  { id: 'traffic-pattern', title: 'Pattern Lap — Conway (KCXW) Rwy 22', acsCode: 'PA.III.B', group: 'Takeoffs and landings', summary: 'Takeoff, all four legs, flaps and power at each point, landing.', build: (ac) => buildPattern(ac), needs: 'pattern' },
  { id: 'normal-takeoff', title: 'Normal Takeoff and Climb', acsCode: 'PA.IV.A', group: 'Takeoffs and landings', summary: 'Rotation, Vy climb, traffic pattern departure.', build: buildNormalTakeoff, needs: 'pattern' },
  { id: 'normal-landing', title: 'Normal Approach and Landing', acsCode: 'PA.IV.B', group: 'Takeoffs and landings', summary: 'Stabilized approach, flare and touchdown.', build: buildNormalLanding, needs: 'pattern' },
  { id: 'soft-takeoff', title: 'Soft-Field Takeoff and Climb', acsCode: 'PA.IV.C', group: 'Takeoffs and landings', summary: 'Weight off the nosewheel, ground effect acceleration.', build: buildSoftTakeoff, needs: 'perf' },
  { id: 'soft-landing', title: 'Soft-Field Approach and Landing', acsCode: 'PA.IV.D', group: 'Takeoffs and landings', summary: 'Touch down at minimum speed, nose held off.', build: buildSoftLanding, needs: 'perf' },
  { id: 'short-takeoff', title: 'Short-Field Takeoff and Max Climb', acsCode: 'PA.IV.E', group: 'Takeoffs and landings', summary: 'Full power on the brakes, 56 KIAS over the obstacle.', build: buildShortTakeoff, needs: 'perf' },
  { id: 'short-landing', title: 'Short-Field Approach and Landing', acsCode: 'PA.IV.F', group: 'Takeoffs and landings', summary: 'Precise approach speed and touchdown point.', build: buildShortLanding, needs: 'perf' },
  { id: 'forward-slip', title: 'Forward Slip to a Landing', acsCode: 'PA.IV.M', group: 'Takeoffs and landings', summary: 'Crossed controls to lose altitude without gaining speed.', build: buildForwardSlip, needs: 'perf' },
  { id: 'go-around', title: 'Go-Around / Rejected Landing', acsCode: 'PA.IV.N', group: 'Takeoffs and landings', summary: 'Power, attitude, flaps up in stages.', build: buildGoAround, needs: 'perf' },
  { id: 'steep-turns', title: 'Steep Turns', acsCode: 'PA.V.A', group: 'Performance and ground reference', summary: '360° each way at 45° of bank.', build: buildSteepTurns, needs: 'steepTurns' },
  { id: 's-turns', title: 'S-Turns', acsCode: 'PA.V.B', group: 'Performance and ground reference', summary: 'Half-circles across a road, 10 kt wind.', build: buildSTurns, needs: 'sTurns' },
  { id: 'rectangular-course', title: 'Rectangular Course', acsCode: 'PA.V.B', group: 'Performance and ground reference', summary: 'Pattern-shaped wind correction around a field, 10 kt wind.', build: buildRectangularCourse, needs: 'sTurns' },
  { id: 'turns-around-point', title: 'Turns Around a Point', acsCode: 'PA.V.B', group: 'Performance and ground reference', summary: 'Constant radius around a point, 10 kt wind.', build: buildTurnsAroundPoint, needs: 'sTurns' },
  { id: 'slow-flight', title: 'Maneuvering During Slow Flight', acsCode: 'PA.VII.A', group: 'Slow flight and stalls', summary: 'Flight at an airspeed just above the stall warning.', build: buildSlowFlight, needs: 'perf' },
  { id: 'power-off-stall', title: 'Power-Off Stalls', acsCode: 'PA.VII.B', group: 'Slow flight and stalls', summary: 'Approach configuration stall and recovery.', build: buildPowerOffStall, needs: 'perf' },
  { id: 'power-on-stall', title: 'Power-On Stalls', acsCode: 'PA.VII.C', group: 'Slow flight and stalls', summary: 'Departure configuration stall and recovery.', build: buildPowerOnStall, needs: 'perf' },
  { id: 'emergency-descent', title: 'Emergency Descent', acsCode: 'PA.IX.A', group: 'Emergency operations', summary: 'Idle, steep descending turn, controlled level-off.', build: buildEmergencyDescent, needs: 'perf' },
  { id: 'emergency-approach', title: 'Emergency Approach and Landing', acsCode: 'PA.IX.B', group: 'Emergency operations', summary: 'Engine failure: best glide, best field, checklist, approach.', build: buildEmergencyApproach, needs: 'perf' },
];

export const isReady = (m: ManeuverDef, ac: AircraftProfile) =>
  !!m.build && ac.available && (!m.needs || !!ac.procedures[m.needs]);
