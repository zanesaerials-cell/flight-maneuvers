# CFI review sheet — C172S

**C172S section reviewed by the school's CFIs on 14 Nov 2026** (✅ = approved or changed as they asked).

Every number below lives in `src/data/aircraft.ts` (C172S profile) or `src/data/airports.ts`. Change it there and every maneuver that uses it updates. Step text is in `src/maneuvers/*.ts`.

Items marked **check** are technique choices that vary between schools.

## Takeoffs and landings (KCXW runway 22, calm wind)

| Maneuver | Numbers used | Check |
|---|---|---|
| Normal takeoff | Flaps 10°, rotate 55, liftoff ~58, Vy 74, ~700 fpm, flaps up at 300 ft AGL | ✅ CFI: flaps 10° |
| Normal landing | Flaps 30°, 65 KIAS, ~1,500 RPM, 3.5° path, aim at 1,000 ft markers, touchdown ~48 | ✅ CFI: 65 on the glidepath |
| Soft-field takeoff | Flaps 10°, rolling start, liftoff ~45, ground effect to Vx 62, Vy 74, flaps up at 300 ft AGL | ✅ CFI: flaps up at 300 ft AGL |
| Soft-field landing | Flaps 30°, 61 KIAS, ~1,300 RPM in flare, touchdown ~42, nose held off, no braking | ✅ |
| Short-field takeoff | Flaps 10°, full power on brakes, rotate ~51, 56 KIAS to 50 ft, flaps up after 60, Vy 74 | ✅ |
| Short-field landing | Flaps 30°, 61 KIAS, 4.5° path, idle at the obstacle, touchdown ~45 within 200 ft, flaps up, heavy braking simulated aloud | ✅ CFI: verbally simulate heavy braking |
| Forward slip | Flaps 0°, 65 KIAS, idle, ~450 ft high, left wing low with right rudder, ~1,150 fpm | ✅ |
| Go-around | Full power, flaps to 20° immediately, 60 KIAS, flaps 10° then up above 65, Vy 74 | ✅ |
| Pattern lap | Takeoff now with flaps 10°, up at 300 ft AGL; see `claude/project-decisions.md` | ✅ |

## Ground reference (800 ft AGL, 90 KIAS, 2,200 RPM, wind 360° at 10 kt)

| Maneuver | Shown | Check |
|---|---|---|
| Rectangular course | 1,200 × 800 m field, flown ¼ nm (0.29 statute mile) outside, left turns, 45° entry to downwind | ✅ CFI: ¼–½ mile |
| S-turns | 330 m (1,080 ft) radius, max bank ~41° | ✅ |
| Turns around a point | 520 m (0.32 statute mile) radius, one left turn, downwind entry, max bank ~29° | ✅ CFI: ¼–½ mile, one lap |

## Slow flight and stalls (3,000 ft MSL over 1,000 ft terrain)

| Maneuver | Numbers used | Check |
|---|---|---|
| Slow flight | Flaps 30°, 50 KIAS, ~1,950 RPM, 15° turns, 200 ft climb and descent | ✅ CFI: 50 kt, or +10/−0 kt above the stall horn (~45) |
| Power-off stall | Flaps 30°, 65 KIAS stabilized descent, idle, landing attitude, horn ~46, stall ~40, recover with flaps 20° then up | ✅ CFI: full stall |
| Power-on stall | Flaps 10° (takeoff configuration), slow to 62, ~2,300 RPM (≥65%), recover to Vx then flaps up and Vy | ✅ CFI: straight ahead, flaps 10° |

## Emergencies

| Maneuver | Numbers used | Check |
|---|---|---|
| Emergency descent | 4,000 → 2,000 ft MSL, idle, 40° bank, 120 KIAS clean, ~2,000 fpm | ✅ |
| Emergency approach | Best glide 68, engine-failure checklist from the POH, overhead approach to a field, flaps 20° on final, terminated at 500 ft AGL | ✅ |

---

# Additions: P-Mentor, DA42, Commercial, CFI and Multi add-on

Sources: Tecnam P-Mentor AFM (sections 2, 4, 5), DA42 AFM Doc. 7.01.05-E Rev. 8 (N327TS), and the school ASEL Maneuvers Guide. Items marked **check** are my assumptions, not from those documents.

## How sections map to airplanes

| Section | Airplanes | Standards used |
|---|---|---|
| Private | C172S, P-Mentor | Private ACS |
| Commercial | C172S, P-Mentor | Commercial ACS: steep turns 50°, speeds ±5 kt, landings within 200 ft (short-field 100 ft), slow flight ±50 ft |
| CFI | C172S, P-Mentor | Commercial standards, plus the three demonstration stalls |
| Multi add-on | DA42 | Commercial ACS (AMEL) |

**check:** task codes. Commercial codes reuse the Private area/task letters with a `CA` prefix; the CFI demonstration stalls are shown as `AI.X.F/G/H`. Verify against the current ACS documents.

## Tecnam P-Mentor

| Item | Value | Source |
|---|---|---|
| Vr / Vx / Vy / glide | 53 / 65 / 70 / 70 KIAS | AFM 4-4 |
| Vs0 / Vs1 | 45 / 50 KIAS | AFM 5-7 |
| Va / Vno / Vne | 102 / 107 / 135 KIAS | AFM 2-4 |
| Vfe T/O / LAND | 106 / 96 KIAS | AFM 2-4 |
| Cruise | 23" MP / 2,060 RPM | Guide |
| Ground reference | 20" MP / 2,060 RPM | Guide |
| Power back to slow | 14" MP / full prop | Guide |
| Power-on stall | 1 notch flaps, slow to 60, 17" MP / full prop, max 15° pitch | Guide |
| Pattern | crosswind at 400 ft AGL, downwind 80, base 70, final 60, touchdown ~55 | Guide |
| Short-field final | 55 KIAS | Guide |
| Accelerated stall entry | 80 KIAS | Guide |
| Power-off 180 glide | 70 KIAS | Guide |

**check:**
- Cruise speed at 23"/2,060 taken as 95 KIAS (used as the entry speed for steep turns, chandelles and lazy eights).
- Slow-flight holding power shown as 18" MP (the guide says it varies).
- Steep-turn power increase shown as +2" MP (the guide says 200–300 RPM, which is P2002 wording).
- Takeoff with flaps T/O, flaps up above 300 ft AGL; soft-field liftoff ~45, touchdown ~46; go-around climb 61 (Vy, flaps T/O).
- Emergency descent at 100 KIAS, 40° bank.
- Flap angles 15°/35° are assumed and only affect the animation.
- The P-Mentor shows a G3X Touch PFD laid out like the school's airplanes: full-width horizon, airspeed tape (TAS above, GS below), altitude tape with selected altitude, VSI scale and baro, slip indicator under the aircraft symbol, compass rose with HDG and CRS boxes, wind box and a flap/trim indicator. The top bar and the side panes are left out.
  - **check:** the OAT, local time and GPS fields on the bottom line are placeholders.
- The P-Mentor throttle and propeller, and the DA42 power levers, are drawn as quadrant levers (forward = more).

## Guide items where the app differs or needs a decision

- **Eights on pylons entry:** the guide says "enter upwind"; the app enters diagonally with the wind behind, as in the Airplane Flying Handbook.
- **Emergency descent altitude:** the guide's set-up line says "between 600 and 1,000 AGL", which looks copied from the ground-reference pages. The app starts 3,000 ft AGL.
- **C172S pattern:** still turns crosswind 300 ft below pattern altitude. Say if it should match the guide's 400 ft AGL.
- **Steep spiral:** the app's bank ranges about 30–47° for a constant radius in 10 kt of wind.

## Diamond DA42 (TAE 125 diesels)

| Item | Value | Source |
|---|---|---|
| Vr / Vy (= Vx) | 72 / 79 KIAS (above 1,700 kg) | AFM 4A.2 |
| Approach flaps UP / APP / LDG | 86 / 82 / 78 KIAS | AFM 4A.2 |
| Go-around minimum | 82 KIAS | AFM 4A.2 |
| Vmca / Vyse | 68 / 82 KIAS | AFM 2.2, 2.3 |
| Stall clean / LDG | 64 / 57 KIAS (1,785 kg) | AFM 5.3.4 |
| Va | 120–126 KIAS | AFM 2.2 |
| Vfe APP / LDG, Vle | 137 / 111, 194 KIAS | AFM 2.2 |
| Restart envelope | 80–120 KIAS | AFM 2.4 |

**check — power settings are mine, not from the AFM:** cruise 65% load, downwind 45%, approach 30%, slow flight 50%, power-on stall 65%, single-engine level flight 85%, single-engine approach 55%.

**check — technique:**
- Pattern 100 / 90 / 78 KIAS, gear down on downwind, flaps APP abeam, LDG on final, touchdown ~65.
- Steep turns and airwork at 120 KIAS and 4,500 ft MSL.
- Slow flight at 66 KIAS, gear down, flaps LDG.
- Accelerated stall entry 92 KIAS.
- Emergency descent clean at 120 KIAS, 40° bank.
- Vmc demo: left engine idle, right 100%, stops at 70 KIAS (stall warning margin), recovery to 82.
- Engine failure after liftoff at 400 ft AGL; single-engine climb shown at 200 fpm.
- Feathering wording "ENGINE MASTER OFF" — confirm against the AFM checklist; critical engine is listed as none.
- The left engine is the failed one in every scenario.

## Commercial and CFI maneuvers (both singles)

| Maneuver | Shown |
|---|---|
| Chandelle | Left, entry at cruise, 30° bank, pitch to 12.5°, ends ~6 kt above clean stall |
| Lazy eight | Right then left, 15° bank at 45°, 30° at 90°, ~250 ft gained, minimum speed ~1.3 Vs |
| Eights on pylons | Pylons 0.9 nm apart, 10 kt wind, altitude follows GS²/11.3 |
| Steep spiral | Three turns from 4,500 ft AGL at best glide |
| Power-off 180 | 850 m downwind offset, calm wind, flaps T/O (10°) on base, full on final |
| Accelerated stall | 3,500 ft AGL, 45° bank, recover at the warning |
| Secondary / cross-controlled / elevator trim stalls | Entered from an idle glide, recovered at first indication |

## 3D models

- **DA42** (helijah, CC BY 4.0) is rigged by `tools/prepare-da42-model.mjs`:
  - Moving parts: both 3-blade propellers, inboard and outboard flaps, ailerons, elevator, rudder and retractable gear. The gear slides straight up into the nacelles and nose; it does not swing.
  - The left propeller winds down and stops after the left engine fails.
  - Painted plain white: the source model's green stripes and logos are removed by the prep script.
  - The model came with the left nose baggage door open; it has been closed.
- The **P2002 stand-in** for the P-Mentor is still a single mesh, so its surfaces do not move. The controls panel still shows every input.
- The **P2002** model's Sketchfab Standard licence does not allow the file to be redistributed, so it is not in the repository. Without it the P-Mentor shows a built-in low-wing stand-in.
