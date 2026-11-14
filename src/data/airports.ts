/**
 * Airports used for takeoff, landing and pattern scenes.
 * Verify against the current FAA Chart Supplement before relying on any value.
 */
export interface RunwayDef {
  /** e.g. ['04', '22'] — low end first. */
  ends: [string, string];
  /** Magnetic heading of the low-numbered end (e.g. 044 for runway 4). */
  magHeading: number;
  lengthFt: number;
  widthFt: number;
  surface: string;
}

export interface AirportDef {
  id: string;
  name: string;
  city: string;
  elevFt: number;
  tpaAglFt: number;
  runways: RunwayDef[];
  /** Traffic pattern direction per runway end. */
  traffic: Record<string, 'left' | 'right'>;
  notes: string[];
}

export const KCXW: AirportDef = {
  id: 'KCXW',
  name: 'Conway Municipal Airport (Cantrell Field)',
  city: 'Conway, Arkansas',
  elevFt: 276,
  tpaAglFt: 1000,
  runways: [{ ends: ['04', '22'], magHeading: 44, lengthFt: 5500, widthFt: 100, surface: 'Concrete' }],
  traffic: { '04': 'left', '22': 'left' },
  notes: [
    'Field elevation 276 ft. Standard left traffic both runways; pattern altitude 1,276 ft MSL (1,000 ft AGL).',
    'Full-length parallel taxiway on the northwest side.',
  ],
};
