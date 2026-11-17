/** Cockpit control positions, normalised. */
export interface ControlState {
  /** Yoke rotation. −1 full left … +1 full right. */
  aileron: number;
  /** Yoke fore/aft. −1 full forward (push) … +1 full aft (pull). */
  elevator: number;
  /** Rudder pedals. −1 full left … +1 full right. */
  rudder: number;
  /** 0 idle … 1 full. */
  throttle: number;
  /** 0 idle cut-off … 1 full rich. */
  mixture: number;
  /** Flap setting, degrees. */
  flaps: number;
  /** Trim. −1 full nose down … +1 full nose up. */
  trim: number;
  /** Landing gear. 1 down, 0 up (always 1 for fixed gear). */
  gear: number;
  /** Right engine power lever on a twin (same scale as throttle, which is the left). */
  throttleR: number;
}

/** One instant of the maneuver. Positions are metres from the scene origin. */
export interface Frame {
  t: number;
  east: number;
  north: number;
  altFt: number;
  heading: number;   // true, deg 0–360
  track: number;     // ground track, deg
  pitch: number;     // deg, + nose up
  bank: number;      // deg, + right wing down
  slip: number;      // ball deflection, 0 = coordinated
  ias: number;
  tas: number;
  gs: number;
  vsi: number;       // ft/min
  rpm: number;
  turnRate: number;  // deg/s, + right
  loadFactor: number;
  c: ControlState;
  /** Cockpit warning in effect, e.g. the stall horn. */
  warn?: string;
  /** Left engine failed or shut down (twin). */
  oei?: boolean;
}

export interface Step {
  id: string;
  title: string;
  detail: string[];
  /** Words said aloud during this step, from the school's guide. */
  callouts?: string[];
  start: number;
  end: number;
}

export interface Tolerance {
  id: string;
  label: string;
  unit: string;
  /** What the examiner is looking for, in words. */
  standard: string;
  /** Value plotted on the bar. */
  value: (f: Frame) => number;
  target: number;
  minus: number;
  plus: number;
  /** Only judged inside these windows (seconds). */
  windows: [number, number][];
}

export interface Road { from: [number, number]; to: [number, number]; width: number }

export interface RunwaySpec {
  /** Centre of the runway, metres east/north of the scene origin. */
  center: [number, number];
  /** Heading of the low-numbered end, degrees (scene north). */
  heading: number;
  lengthM: number;
  widthM: number;
  ends: [string, string];
}

export interface SceneLabel { east: number; north: number; altFt: number; text: string }

export interface SceneMarker { east: number; north: number; kind: 'silo' | 'field'; width?: number; length?: number; heading?: number; label?: string }

export interface SceneSpec {
  groundElevFt: number;
  roads: Road[];
  runways?: RunwaySpec[];
  labels?: SceneLabel[];
  markers?: SceneMarker[];
  /** Radius (m) the top-down camera should frame. */
  frameRadius: number;
  /** Centre (east, north) the top-down camera should frame. */
  frameCenter: [number, number];
  wind?: { fromDeg: number; kt: number };
}

export interface ManeuverRun {
  id: string;
  title: string;
  acsCode: string;
  acsTask: string;
  /** Which ACS the code refers to, e.g. "Commercial Pilot ACS". */
  acsDoc?: string;
  objective: string;
  frames: Frame[];
  dt: number;
  duration: number;
  steps: Step[];
  tolerances: Tolerance[];
  scene: SceneSpec;
  bugs: { altitudeFt: number; heading: number; ias?: number };
  notes: string[];
}
