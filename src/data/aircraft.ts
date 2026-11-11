/**
 * Airframe profiles.
 *
 * Every number a maneuver script uses comes from here, so adding an aircraft
 * means adding a profile — the maneuver code does not change.
 *
 * C172S values: Cessna 172S Skyhawk NAV III (G1000) POH/AFM. Verify against the
 * revision on board your airplane; the POH always governs.
 */

export type AvionicsSuite = 'g1000' | 'g3x-touch';
export type PrimaryControl = 'yoke' | 'stick';

export interface SteepTurnSettings {
  altitudeFt: number;       // demo altitude MSL
  groundElevFt: number;     // terrain elevation under the demo
  entryIas: number;         // KIAS, must be at or below Va for the weight
  entryRpm: number;
  turnRpm: number;          // power added as bank passes 30°
  bankDeg: number;
  rollRateDps: number;      // nominal roll rate for a smooth entry
}

export interface GroundRefSettings {
  aglFt: number;            // ACS: 600–1,000 ft AGL
  groundElevFt: number;
  ias: number;
  rpm: number;
  radiusM: number;          // ground-track radius chosen so max bank stays under 45°
  windFromDeg: number;
  windKt: number;
}

export interface PatternSettings {
  takeoffFlaps: number;
  groundAccel: number;      // m/s², sea-level standard day, max weight
  rotateKias: number;
  liftoffKias: number;
  climbKias: number;        // Vy for the pattern climb
  climbFpm: number;
  takeoffRpm: number;       // static full-throttle
  climbRpm: number;         // full throttle at climb speed
  downwindKias: number;
  downwindRpm: number;
  abeamRpm: number;
  abeamFlaps: number;
  abeamKias: number;
  baseFlaps: number;
  baseKias: number;
  finalFlaps: number;
  finalKias: number;
  touchdownKias: number;
  turnBankDeg: number;
  downwindOffsetM: number;  // distance from runway centerline to downwind leg
  landingDecel: number;     // m/s² with moderate braking
}

/** Numbers for the takeoff/landing variants, slow flight, stalls and emergencies. */
export interface PerfSettings {
  airworkAltFt: number;          // MSL for airwork
  airworkGroundFt: number;       // terrain under airwork
  // Short field
  shortTakeoffFlaps: number;
  shortObstacleKias: number;     // climb speed until a 50 ft obstacle is cleared
  shortApproachKias: number;
  shortTouchdownKias: number;
  // Soft field
  softTakeoffFlaps: number;
  softLiftoffKias: number;
  softApproachKias: number;
  softTouchdownKias: number;
  // Go-around (balked landing)
  balkedFlaps: number;
  balkedClimbKias: number;
  balkedFlapsUpKias: number;
  // Forward slip
  slipFlaps: number;
  slipKias: number;
  // Slow flight and stalls
  slowFlightKias: number;        // full flaps, a few knots above the stall warning
  slowFlightRpm: number;
  stallFlaps30Kias: number;      // indicated, power off
  stallCleanKias: number;
  stallWarnMarginKt: number;     // horn sounds this far above the stall
  powerOnStallRpm: number;
  // Emergencies
  emergencyDescentKias: number;
  emergencyDescentBank: number;
  glideFpm: number;              // clean, at best glide
}

export interface AircraftProfile {
  id: 'c172s' | 'p-mentor' | 'da42';
  name: string;
  shortName: string;
  available: boolean;
  blurb: string;
  avionics: AvionicsSuite;
  primaryControl: PrimaryControl;
  engines: 1 | 2;
  source: string;
  speeds: {
    vso: number; vs1: number; vr: number; vx: number; vy: number;
    vg: number; vno: number; vne: number;
    va: { weightLb: number; kias: number }[];
    vfe: { flaps: string; kias: number }[];
  };
  /** Airspeed tape colour bands, KIAS. */
  arcs: { whiteLow: number; whiteHigh: number; greenLow: number; greenHigh: number; yellowHigh: number };
  rpm: { idle: number; max: number; greenLow: number; greenHigh: number };
  flapDetents: number[];
  procedures: {
    steepTurns?: SteepTurnSettings;
    sTurns?: GroundRefSettings;
    pattern?: PatternSettings;
    perf?: PerfSettings;
  };
}

export const C172S: AircraftProfile = {
  id: 'c172s',
  name: 'Cessna 172S Skyhawk',
  shortName: 'C172S',
  available: true,
  blurb: 'G1000 NAV III · 180 hp Lycoming IO-360-L2A · fixed-pitch prop',
  avionics: 'g1000',
  primaryControl: 'yoke',
  engines: 1,
  source: 'Cessna 172S NAV III (G1000) POH/AFM — speeds and power settings',
  speeds: {
    vso: 40, vs1: 48, vr: 55, vx: 62, vy: 74, vg: 68, vno: 129, vne: 163,
    va: [
      { weightLb: 2550, kias: 105 },
      { weightLb: 2200, kias: 98 },
      { weightLb: 1900, kias: 88 },
    ],
    vfe: [
      { flaps: '10°', kias: 110 },
      { flaps: '10°–30°', kias: 85 },
    ],
  },
  arcs: { whiteLow: 40, whiteHigh: 85, greenLow: 48, greenHigh: 129, yellowHigh: 163 },
  rpm: { idle: 650, max: 2700, greenLow: 2100, greenHigh: 2700 },
  flapDetents: [0, 10, 20, 30],
  procedures: {
    steepTurns: {
      altitudeFt: 3000,
      groundElevFt: 1000,
      entryIas: 95,
      entryRpm: 2300,
      turnRpm: 2400,
      bankDeg: 45,
      rollRateDps: 10,
    },
    sTurns: {
      aglFt: 800,
      groundElevFt: 1000,
      ias: 90,
      rpm: 2200,
      radiusM: 330,
      windFromDeg: 360,
      windKt: 10,
    },
    pattern: {
      takeoffFlaps: 0,
      groundAccel: 1.35,
      rotateKias: 55,
      liftoffKias: 58,
      climbKias: 74,
      climbFpm: 700,
      takeoffRpm: 2350,
      climbRpm: 2500,
      downwindKias: 90,
      downwindRpm: 2200,
      abeamRpm: 1500,
      abeamFlaps: 10,
      abeamKias: 80,
      baseFlaps: 20,
      baseKias: 75,
      finalFlaps: 30,
      finalKias: 65,
      touchdownKias: 48,
      turnBankDeg: 20,
      downwindOffsetM: 1300,
      landingDecel: 2.2,
    },
    perf: {
      airworkAltFt: 3000,
      airworkGroundFt: 1000,
      shortTakeoffFlaps: 10,
      shortObstacleKias: 56,
      shortApproachKias: 61,
      shortTouchdownKias: 45,
      softTakeoffFlaps: 10,
      softLiftoffKias: 45,
      softApproachKias: 61,
      softTouchdownKias: 42,
      balkedFlaps: 20,
      balkedClimbKias: 60,
      balkedFlapsUpKias: 65,
      slipFlaps: 0,
      slipKias: 65,
      slowFlightKias: 50,
      slowFlightRpm: 1950,
      stallFlaps30Kias: 40,
      stallCleanKias: 48,
      stallWarnMarginKt: 6,
      powerOnStallRpm: 2300,
      emergencyDescentKias: 120,
      emergencyDescentBank: 40,
      glideFpm: 700,
    },
  },
};

const placeholder = (
  id: AircraftProfile['id'],
  name: string,
  shortName: string,
  blurb: string,
  avionics: AvionicsSuite,
  primaryControl: PrimaryControl,
  engines: 1 | 2,
): AircraftProfile => ({
  ...C172S,
  id, name, shortName, blurb, avionics, primaryControl, engines,
  available: false,
  source: 'Profile not yet entered',
  procedures: {},
});

export const P_MENTOR = placeholder(
  'p-mentor', 'Tecnam P-Mentor', 'P-Mentor',
  'G3X Touch · Rotax 912 iSc3 · stick', 'g3x-touch', 'stick', 1,
);

export const DA42 = placeholder(
  'da42', 'Diamond DA42 Twin Star', 'DA42',
  'G1000 · twin Austro AE300 · stick', 'g1000', 'stick', 2,
);

export const AIRCRAFT: AircraftProfile[] = [C172S, P_MENTOR, DA42];

export const getAircraft = (id: string) => AIRCRAFT.find((a) => a.id === id);

/** Maneuvering speed for the heaviest listed weight at or below the given weight. */
export function vaFor(ac: AircraftProfile, weightLb: number) {
  const sorted = [...ac.speeds.va].sort((a, b) => b.weightLb - a.weightLb);
  return (sorted.find((v) => v.weightLb <= weightLb) ?? sorted[sorted.length - 1]).kias;
}
