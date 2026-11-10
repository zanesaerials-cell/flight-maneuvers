import type { AircraftProfile } from '../data/aircraft';
import type { ManeuverRun } from '../engine/types';
import { buildSteepTurns } from './steepTurns';
import { buildSTurns } from './sTurns';
import { buildPattern } from './pattern';

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
  { id: 'normal-takeoff', title: 'Normal Takeoff and Climb', acsCode: 'PA.IV.A', group: 'Takeoffs and landings', summary: 'Rotation, Vy climb, traffic pattern departure.' },
  { id: 'normal-landing', title: 'Normal Approach and Landing', acsCode: 'PA.IV.B', group: 'Takeoffs and landings', summary: 'Stabilized approach, flare and touchdown.' },
  { id: 'soft-takeoff', title: 'Soft-Field Takeoff and Climb', acsCode: 'PA.IV.C', group: 'Takeoffs and landings', summary: 'Weight off the nosewheel, ground effect acceleration.' },
  { id: 'soft-landing', title: 'Soft-Field Approach and Landing', acsCode: 'PA.IV.D', group: 'Takeoffs and landings', summary: 'Touch down at minimum speed, nose held off.' },
  { id: 'short-takeoff', title: 'Short-Field Takeoff and Max Climb', acsCode: 'PA.IV.E', group: 'Takeoffs and landings', summary: 'Full power on the brakes, Vx over the obstacle.' },
  { id: 'short-landing', title: 'Short-Field Approach and Landing', acsCode: 'PA.IV.F', group: 'Takeoffs and landings', summary: 'Precise approach speed and touchdown point.' },
  { id: 'forward-slip', title: 'Forward Slip to a Landing', acsCode: 'PA.IV.M', group: 'Takeoffs and landings', summary: 'Crossed controls to lose altitude without gaining speed.' },
  { id: 'go-around', title: 'Go-Around / Rejected Landing', acsCode: 'PA.IV.N', group: 'Takeoffs and landings', summary: 'Power, attitude, flaps up in stages.' },
  { id: 'steep-turns', title: 'Steep Turns', acsCode: 'PA.V.A', group: 'Performance and ground reference', summary: '360° each way at 45° of bank.', build: buildSteepTurns, needs: 'steepTurns' },
  { id: 's-turns', title: 'S-Turns', acsCode: 'PA.V.B', group: 'Performance and ground reference', summary: 'Half-circles across a road, 10 kt wind.', build: buildSTurns, needs: 'sTurns' },
  { id: 'rectangular-course', title: 'Rectangular Course', acsCode: 'PA.V.B', group: 'Performance and ground reference', summary: 'Pattern-shaped wind correction around a field.' },
  { id: 'turns-around-point', title: 'Turns Around a Point', acsCode: 'PA.V.B', group: 'Performance and ground reference', summary: 'Constant radius around a point, 10 kt wind.' },
  { id: 'slow-flight', title: 'Maneuvering During Slow Flight', acsCode: 'PA.VII.A', group: 'Slow flight and stalls', summary: 'Flight at an airspeed just above the stall warning.' },
  { id: 'power-off-stall', title: 'Power-Off Stalls', acsCode: 'PA.VII.B', group: 'Slow flight and stalls', summary: 'Approach configuration stall and recovery.' },
  { id: 'power-on-stall', title: 'Power-On Stalls', acsCode: 'PA.VII.C', group: 'Slow flight and stalls', summary: 'Departure configuration stall and recovery.' },
];

export const isReady = (m: ManeuverDef, ac: AircraftProfile) =>
  !!m.build && ac.available && (!m.needs || !!ac.procedures[m.needs]);
