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
  /** Turns around a point: radius and number of full circles, if different from the defaults (radiusM, 2). */
  pointRadiusM?: number;
  pointLaps?: number;
  windFromDeg: number;
  windKt: number;
}

export interface PatternSettings {
  takeoffFlaps: number;
  /** Flaps for the power-on stall if not the takeoff setting. */
  powerOnStallFlaps?: number;
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
  /** Height to start the crosswind turn; default is 300 ft below pattern altitude. */
  crosswindAglFt?: number;
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

export type Cert = 'private' | 'commercial' | 'cfi' | 'multi';

/** Named power settings in the airplane's own unit (RPM, manifold pressure or load %). */
export interface PowerSettings {
  taxi: number;          // lined up, brakes held
  reduce: number;        // "power back" to slow down or start a descent
  approach: number;      // stabilized final
  shortApproach: number;
  softFlare: number;     // the little power kept in a soft-field flare
  slowDescent: number;   // descending in slow flight
  slowClimb: number;     // climbing in slow flight
  descentIdle: number;   // emergency descent
  cruise: number;
}

export interface MultiSettings {
  vmc: number; vyse: number; vsse: number;
  oeiClimbFpm: number;
  oeiApproachKias: number;
  zeroThrust: number;    // power setting that simulates a feathered propeller
  feather: string;       // how the propeller is feathered in this airplane
  criticalEngine: 'left' | 'none';
}

export interface AircraftProfile {
  id: 'c172s' | 'p-mentor' | 'da42';
  /** Checkride sections offered in this airplane. */
  certs: Cert[];
  /** Level cruise speed the maneuver set-ups use. */
  cruiseKias: number;
  retractable: boolean;
  /** Names for each entry of flapDetents, and the limit speed for selecting it. */
  flapLabels: string[];
  flapVfe: number[];
  power: {
    /** What the pilot moves. */
    lever: string;
    /** Short reading for the controls panel. */
    fmt: (v: number) => string;
    /** Wording for procedure text, e.g. "2,300 RPM (about 62%)". */
    text: (v: number) => string;
  };
  pw: PowerSettings;
  /** levers: quadrant-style power levers instead of push-pull knobs. */
  controls: { mixture: boolean; prop: boolean; levers: boolean };
  text: {
    lineup: string;            // items after flaps on the runway
    beforeLanding: string;
    engineFailure: string;
    cruiseSetup: string;
    slipNote: string;
    /** Configure items before airwork (pre-maneuver checklist). */
    preManeuver: string[];
  };
  model: { url: string; credit: string; creditUrl: string } | null;
  /** Verbal callouts from the school's guide, by maneuver id and step id. */
  callouts?: Record<string, Record<string, string[]>>;
  multi?: MultiSettings;
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
  certs: ['private', 'commercial', 'cfi'],
  cruiseKias: 95,
  retractable: false,
  flapLabels: ['up', '10°', '20°', '30°'],
  flapVfe: [999, 110, 85, 85],
  power: {
    lever: 'Throttle',
    fmt: (v) => `${(Math.round(v / 10) * 10).toLocaleString()} RPM`,
    text: (v) => (v <= 700 ? 'idle' : v >= 2600 ? 'full power' : `${(Math.round(v / 50) * 50).toLocaleString()} RPM (about ${Math.round(((v / 2700) ** 3) * 20) * 5}%)`),
  },
  pw: { taxi: 1000, reduce: 1500, approach: 1500, shortApproach: 1400, softFlare: 1300, slowDescent: 1600, slowClimb: 2350, descentIdle: 1100, cruise: 2300 },
  controls: { mixture: true, prop: false, levers: false },
  text: {
    lineup: 'mixture rich',
    beforeLanding: 'Before-landing checklist: fuel selector BOTH, mixture rich, landing light on, seatbelts.',
    engineFailure: 'C: Checklist (C172S engine failure in flight): airspeed 68 KIAS; fuel shutoff valve ON; fuel selector BOTH; fuel pump ON; mixture RICH; ignition BOTH (START if the prop has stopped).',
    cruiseSetup: 'mixture as set for the altitude',
    slipNote: 'C172S POH: avoid slips with more than 20° of flaps.',
    preManeuver: ['Fuel selector BOTH', 'Mixture set for the altitude (rich below 3,000 ft)', 'Landing light ON', 'Seatbelts fastened, loose items stowed', 'Engine instruments in the green'],
  },
  // Callouts from the school's C172S Maneuver Guide (Rev 11/02/2024); runway called for KCXW 22.
  callouts: {
    'normal-takeoff': { lineup: ['Runway 22'], roll: ['Gauges green, airspeed alive'], rotate: ['Rotate'] },
    'short-takeoff': { lineup: ['Runway 22'], roll: ['Gauges green', 'Airspeed alive'], rotate: ['Rotate'], obstacle: ['50, Vx, flaps 10'], accelerate: ['200, Vy, flaps 0'] },
    'soft-takeoff': { taxi: ['Runway 22'], roll: ['Gauges green, airspeed alive'], climb: ['Vx, climb'], flaps: ['300, Vy, flaps 0'] },
  },
  model: {
    url: 'models/c172s.glb',
    credit: 'Cessna 172 model by KOG_THORNS, CC BY 4.0 (modified)',
    creditUrl: 'https://sketchfab.com/3d-models/cessna172-d1b15841c29c43d0862667300bad55a4',
  },
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
      pointRadiusM: 520,      // about 0.3 statute mile (school: 1/4–1/2 mile)
      pointLaps: 1,
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


/**
 * Tecnam P-Mentor (Rotax 912 iSc3 Sport, MT constant-speed propeller).
 * Speeds: P-Mentor AFM sections 2, 4 and 5 (MTOW 720 kg).
 * Power settings, pattern speeds and technique: the school's ASEL Maneuvers Guide.
 * Power is manifold pressure in inHg.
 */
export const P_MENTOR: AircraftProfile = {
  id: 'p-mentor',
  certs: ['private', 'commercial', 'cfi'],
  name: 'Tecnam P-Mentor',
  shortName: 'P-Mentor',
  available: true,
  blurb: 'G3X Touch · Rotax 912 iSc3 · constant-speed prop · stick',
  avionics: 'g3x-touch',
  primaryControl: 'stick',
  engines: 1,
  source: 'Tecnam P-Mentor AFM (speeds) and the school ASEL Maneuvers Guide (power settings and technique)',
  cruiseKias: 95,
  retractable: false,
  speeds: {
    vso: 45, vs1: 50, vr: 53, vx: 65, vy: 70, vg: 70, vno: 107, vne: 135,
    va: [{ weightLb: 1587, kias: 102 }],
    vfe: [{ flaps: 'T/O', kias: 106 }, { flaps: 'LAND', kias: 96 }],
  },
  arcs: { whiteLow: 45, whiteHigh: 96, greenLow: 50, greenHigh: 107, yellowHigh: 135 },
  rpm: { idle: 10, max: 28, greenLow: 14, greenHigh: 28 },
  flapDetents: [0, 15, 35],
  flapLabels: ['up', 'T/O', 'LAND'],
  flapVfe: [999, 106, 96],
  power: {
    lever: 'Throttle',
    fmt: (v) => `${v.toFixed(0)}" MP`,
    text: (v) => {
      if (v <= 10.5) return 'idle';
      if (v >= 27) return 'full power';
      const mp = Math.round(v);
      return mp === 23 || mp === 20 ? `${mp}" MP / 2,060 RPM` : `${mp}" MP / full prop`;
    },
  },
  pw: { taxi: 12, reduce: 14, approach: 14, shortApproach: 13, softFlare: 12, slowDescent: 15, slowClimb: 28, descentIdle: 10, cruise: 23 },
  controls: { mixture: false, prop: true, levers: true },
  text: {
    lineup: 'fuel pump ON, propeller full forward',
    beforeLanding: 'GUMPS: fuel pump ON, landing light ON, propeller full forward, seatbelts.',
    engineFailure: 'C: Checklist — follow the P-Mentor AFM engine-failure-in-flight procedure: best glide 70 KIAS, fuel pump ON, fuel selector and LANE A/B switches checked, attempt a restart.',
    cruiseSetup: 'fuel pump ON',
    slipNote: 'Check the AFM for any limits on slips with flaps extended.',
    preManeuver: ['Fuel pump ON', 'Fuel selector on the fuller tank', 'Landing light ON', 'Seatbelts fastened, loose items stowed', 'Engine instruments in the green'],
  },
  // Original model built in code for this app (components/PMentorModel.ts), to published dimensions.
  model: { url: 'procedural:p-mentor', credit: '', creditUrl: '' },
  procedures: {
    steepTurns: { altitudeFt: 3000, groundElevFt: 1000, entryIas: 95, entryRpm: 23, turnRpm: 25, bankDeg: 45, rollRateDps: 10 },
    sTurns: { aglFt: 800, groundElevFt: 1000, ias: 90, rpm: 20, radiusM: 330, windFromDeg: 360, windKt: 10 },
    pattern: {
      takeoffFlaps: 15, groundAccel: 1.5, rotateKias: 53, liftoffKias: 56, climbKias: 70, climbFpm: 750,
      takeoffRpm: 28, climbRpm: 28, downwindKias: 80, downwindRpm: 20, abeamRpm: 14,
      abeamFlaps: 15, abeamKias: 75, baseFlaps: 15, baseKias: 70, finalFlaps: 35, finalKias: 60,
      touchdownKias: 55, turnBankDeg: 20, downwindOffsetM: 1200, landingDecel: 2.2, crosswindAglFt: 400,
    },
    perf: {
      airworkAltFt: 3000, airworkGroundFt: 1000,
      shortTakeoffFlaps: 15, shortObstacleKias: 56, shortApproachKias: 55, shortTouchdownKias: 48,
      softTakeoffFlaps: 15, softLiftoffKias: 45, softApproachKias: 60, softTouchdownKias: 46,
      balkedFlaps: 15, balkedClimbKias: 61, balkedFlapsUpKias: 66,
      slipFlaps: 0, slipKias: 65,
      slowFlightKias: 50, slowFlightRpm: 18,
      stallFlaps30Kias: 45, stallCleanKias: 50, stallWarnMarginKt: 5, powerOnStallRpm: 17,
      emergencyDescentKias: 100, emergencyDescentBank: 40, glideFpm: 650,
    },
  },
};

/**
 * Diamond DA42 Twin Star, Thielert TAE 125 (Centurion) diesels — AFM Doc. 7.01.05-E Rev. 8, N327TS.
 * Speeds for take-off mass above 1700 kg. Power is LOAD % (FADEC, single power lever per engine).
 */
export const DA42: AircraftProfile = {
  id: 'da42',
  certs: ['multi'],
  name: 'Diamond DA42 Twin Star',
  shortName: 'DA42',
  available: true,
  blurb: 'G1000 · twin Thielert TAE 125 diesels · retractable gear · stick',
  avionics: 'g1000',
  primaryControl: 'stick',
  engines: 2,
  source: 'Diamond DA42 AFM, Doc. No. 7.01.05-E Rev. 8 (N327TS) — speeds; power settings are training values for review',
  cruiseKias: 120,
  retractable: true,
  speeds: {
    vso: 57, vs1: 64, vr: 72, vx: 79, vy: 79, vg: 82, vno: 155, vne: 194,
    va: [{ weightLb: 3400, kias: 126 }, { weightLb: 2756, kias: 120 }],
    vfe: [{ flaps: 'APP', kias: 137 }, { flaps: 'LDG', kias: 111 }],
  },
  arcs: { whiteLow: 56, whiteHigh: 111, greenLow: 62, greenHigh: 155, yellowHigh: 194 },
  rpm: { idle: 0, max: 100, greenLow: 0, greenHigh: 100 },
  flapDetents: [0, 20, 42],
  flapLabels: ['UP', 'APP', 'LDG'],
  flapVfe: [999, 137, 111],
  power: {
    lever: 'Power levers',
    fmt: (v) => `${Math.round(v)}% load`,
    text: (v) => (v <= 3 ? 'idle' : v >= 99 ? '100% load' : `${Math.round(v / 5) * 5}% load`),
  },
  pw: { taxi: 10, reduce: 25, approach: 30, shortApproach: 28, softFlare: 15, slowDescent: 35, slowClimb: 100, descentIdle: 0, cruise: 65 },
  controls: { mixture: false, prop: false, levers: true },
  text: {
    lineup: 'engine masters ON, ECU swap AUTO, fuel pumps as required',
    beforeLanding: 'Before-landing checklist: gear DOWN — three green, fuel selectors ON, landing light ON, seatbelts.',
    engineFailure: 'Follow the AFM engine-failure checklist.',
    cruiseSetup: 'gear UP, flaps UP',
    slipNote: '',
    preManeuver: ['Fuel selectors ON (crossfeed off)', 'Electric fuel pumps ON', 'Landing and strobe lights ON', 'Gear and flaps as the maneuver requires', 'Seatbelts fastened, loose items stowed', 'Engine instruments in the green on both engines'],
  },
  model: {
    url: 'models/da42.glb',
    credit: 'Diamond DA42 "Twin Star" model by helijah, CC BY 4.0 (modified)',
    creditUrl: 'https://sketchfab.com/3d-models/diamond-da42-twin-star-d83b6e776955401f87f7bc2ad5d5a252',
  },
  multi: {
    vmc: 68, vyse: 82, vsse: 82, oeiClimbFpm: 200, oeiApproachKias: 82, zeroThrust: 12,
    feather: 'ENGINE MASTER of the failed engine OFF (this feathers the propeller)',
    criticalEngine: 'none',
  },
  procedures: {
    steepTurns: { altitudeFt: 4500, groundElevFt: 1000, entryIas: 120, entryRpm: 65, turnRpm: 75, bankDeg: 50, rollRateDps: 10 },
    pattern: {
      takeoffFlaps: 0, groundAccel: 1.6, rotateKias: 72, liftoffKias: 75, climbKias: 79, climbFpm: 900,
      takeoffRpm: 100, climbRpm: 100, downwindKias: 100, downwindRpm: 45, abeamRpm: 30,
      abeamFlaps: 20, abeamKias: 95, baseFlaps: 20, baseKias: 90, finalFlaps: 42, finalKias: 78,
      touchdownKias: 65, turnBankDeg: 20, downwindOffsetM: 1500, landingDecel: 2.4,
    },
    perf: {
      airworkAltFt: 4500, airworkGroundFt: 1000,
      shortTakeoffFlaps: 0, shortObstacleKias: 79, shortApproachKias: 78, shortTouchdownKias: 62,
      softTakeoffFlaps: 0, softLiftoffKias: 68, softApproachKias: 78, softTouchdownKias: 62,
      balkedFlaps: 20, balkedClimbKias: 82, balkedFlapsUpKias: 83,
      slipFlaps: 0, slipKias: 86,
      slowFlightKias: 66, slowFlightRpm: 50,
      stallFlaps30Kias: 57, stallCleanKias: 64, stallWarnMarginKt: 6, powerOnStallRpm: 65,
      emergencyDescentKias: 120, emergencyDescentBank: 40, glideFpm: 900,
    },
  },
};

export const AIRCRAFT: AircraftProfile[] = [C172S, P_MENTOR, DA42];

export const getAircraft = (id: string) => AIRCRAFT.find((a) => a.id === id);

/** Maneuvering speed for the heaviest listed weight at or below the given weight. */
export function vaFor(ac: AircraftProfile, weightLb: number) {
  const sorted = [...ac.speeds.va].sort((a, b) => b.weightLb - a.weightLb);
  return (sorted.find((v) => v.weightLb <= weightLb) ?? sorted[sorted.length - 1]).kias;
}

/** Flap setting as the airplane names it: "10°", "T/O", "APP". */
export function fl(ac: AircraftProfile, deg: number) {
  let best = 0;
  ac.flapDetents.forEach((d, i) => { if (Math.abs(d - deg) < Math.abs(ac.flapDetents[best] - deg)) best = i; });
  return ac.flapLabels[best];
}
/** "Flaps 10°" / "Flaps T/O" / "Flaps up". */
export const flapsText = (ac: AircraftProfile, deg: number) => `flaps ${fl(ac, deg)}`;
/** Power wording for procedure text. */
export const pwT = (ac: AircraftProfile, v: number) => ac.power.text(v);
/** Next flap detent toward up from the current deflection. */
export function flapUpOne(ac: AircraftProfile, cur: number) {
  const below = ac.flapDetents.filter((d) => d < cur - 0.5);
  return below.length ? below[below.length - 1] : 0;
}
/** Largest flap detent allowed at this airspeed, not beyond `want`. */
export function flapsAllowed(ac: AircraftProfile, ias: number, want: number) {
  let out = 0;
  ac.flapDetents.forEach((d, i) => { if (d <= want + 0.5 && ias < ac.flapVfe[i]) out = d; });
  return out;
}
export const fullFlaps = (ac: AircraftProfile) => ac.flapDetents[ac.flapDetents.length - 1];
/** Fraction of the power range, 0 idle … 1 full. */
export const pwFrac = (ac: AircraftProfile, v: number) => (v - ac.rpm.idle) / (ac.rpm.max - ac.rpm.idle);

/** Full power as it reads in the climb (a fixed-pitch propeller does not reach redline RPM). */
export const fullPower = (ac: AircraftProfile) => ac.procedures.pattern?.climbRpm ?? ac.rpm.max;
