import type { AircraftProfile } from '../data/aircraft';
import type { Frame } from '../engine/types';
import { clamp } from '../engine/kinematics';

/**
 * Derived engine readings for displays that show more than the power setting.
 * These are plausible teaching values, not performance data.
 */

/** P-Mentor propeller: the school sets 2,060 RPM in cruise and leaves it full forward otherwise. */
export function propLever(ac: AircraftProfile, f: Frame) {
  if (!ac.controls.prop) return null;
  const cruise = f.rpm >= 19.5 && f.rpm <= 25.5 && Math.abs(f.vsi) < 250 && f.c.flaps < 1;
  return cruise ? { setting: 'cruise' as const, rpm: 2060 } : { setting: 'full' as const, rpm: 2388 };
}

/** Rotax 912 iSc readings from manifold pressure and the propeller setting. */
export function rotax(ac: AircraftProfile, f: Frame) {
  const lever = propLever(ac, f);
  const mp = f.rpm;
  // Below about 18" the governor runs out of power and the prop sits on its fine-pitch stop.
  const unGoverned = 700 + ((mp - 10) / 8) * (2388 - 700);
  const propRpm = Math.round(clamp(Math.min(lever?.rpm ?? 2388, unGoverned), 700, 2388) / 10) * 10;
  const engineRpm = Math.round((propRpm * 2.43) / 10) * 10;  // 2.43:1 reduction gearbox
  const power = clamp((mp - 10) / 18, 0, 1);
  return {
    mp,
    propRpm,
    engineRpm,
    fuelFlow: +(1.1 + 6.0 * power ** 1.3).toFixed(1),
    oilPressPsi: Math.round(32 + 26 * power),
    oilTempC: Math.round(82 + 14 * power),
    coolantC: Math.round(76 + 14 * power),
    volts: 13.9,
  };
}

/** Normalized angle of attack: 1.0 at the stall for the current flap setting and load factor. */
export function aoaFraction(ac: AircraftProfile, f: Frame) {
  const full = ac.flapDetents[ac.flapDetents.length - 1] || 1;
  const vs = ac.speeds.vs1 + (ac.speeds.vso - ac.speeds.vs1) * clamp(f.c.flaps / full, 0, 1);
  if (f.ias < 20) return 0;
  return clamp((vs / f.ias) ** 2 * f.loadFactor, 0, 1.25);
}
