# CFI review sheet — C172S

Every number below lives in `src/data/aircraft.ts` (C172S profile) or `src/data/airports.ts`. Change it there and every maneuver that uses it updates. Step text is in `src/maneuvers/*.ts`.

Items marked **check** are technique choices that vary between schools.

## Takeoffs and landings (KCXW runway 22, calm wind)

| Maneuver | Numbers used | Check |
|---|---|---|
| Normal takeoff | Flaps 0°, rotate 55, liftoff ~58, Vy 74, ~700 fpm | Flaps 0 vs 10° |
| Normal landing | Flaps 30°, 65 KIAS, ~1,500 RPM, 3.5° path, aim at 1,000 ft markers, touchdown ~48 | Approach speed 60–70 per POH |
| Soft-field takeoff | Flaps 10°, rolling start, liftoff ~45, ground effect to Vx 62, Vy 74, flaps up ~250 ft AGL | Liftoff speed; when flaps come up |
| Soft-field landing | Flaps 30°, 61 KIAS, ~1,300 RPM in flare, touchdown ~42, nose held off, no braking | **check** approach speed |
| Short-field takeoff | Flaps 10°, full power on brakes, rotate ~51, 56 KIAS to 50 ft, flaps up after 60, Vy 74 | |
| Short-field landing | Flaps 30°, 61 KIAS, 4.5° path, idle at the obstacle, touchdown ~45 within 200 ft, flaps up and heavy braking | |
| Forward slip | Flaps 0°, 65 KIAS, idle, ~450 ft high, left wing low with right rudder, ~1,150 fpm | POH caution for slips with more than 20° flaps |
| Go-around | Full power, flaps to 20° immediately, 60 KIAS, flaps 10° then up above 65, Vy 74 | Decision height shown at ~160 ft AGL |
| Pattern lap | See `claude/project-decisions.md` in the project | |

## Ground reference (800 ft AGL, 90 KIAS, 2,200 RPM, wind 360° at 10 kt)

| Maneuver | Shown | Check |
|---|---|---|
| Rectangular course | 1,200 × 800 m field, flown ¼ nm outside, left turns, 45° entry to downwind | Distance from field |
| S-turns | 330 m (1,080 ft) radius, max bank ~41° | |
| Turns around a point | 330 m radius, two left turns, downwind entry | Number of turns |

## Slow flight and stalls (3,000 ft MSL over 1,000 ft terrain)

| Maneuver | Numbers used | Check |
|---|---|---|
| Slow flight | Flaps 30°, 50 KIAS, ~1,950 RPM, 15° turns, 200 ft climb and descent | Target speed vs your stall-warning margin |
| Power-off stall | Flaps 30°, 65 KIAS stabilized descent, idle, landing attitude, horn ~46, stall ~40, recover with flaps 20° then up | Full stall vs first indication (ACS-6C: full stall) |
| Power-on stall | Clean, slow to 55, ~2,300 RPM (≥65%), ~16° pitch, horn ~50, stall ~44, recover to Vx then Vy | Straight ahead shown; turning stalls are possible |

## Emergencies

| Maneuver | Numbers used | Check |
|---|---|---|
| Emergency descent | 4,000 → 2,000 ft MSL, idle, 40° bank, 120 KIAS clean, ~2,000 fpm | **check** clean/120 vs flaps-down technique |
| Emergency approach | Best glide 68, engine-failure checklist from the POH, overhead approach to a field, flaps 20° on final, terminated at 500 ft AGL | Checklist wording; field selection |
