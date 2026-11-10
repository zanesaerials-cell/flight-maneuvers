# Flight Maneuver Visualizer

Shows each Private Pilot ACS maneuver flown to the standard, for a specific airplane. Each maneuver has four synced views:

- **3D outside view** with chase, side and top-down cameras. You can drag to orbit and pinch or scroll to zoom.
- **G1000-style PFD.**
- **Cockpit controls:** yoke, rudder pedals, throttle, mixture, flaps and trim.
- **Procedure steps and live ACS tolerance bars.**

A maneuver plays on its own by default. You can also scrub it with the slider or jump between steps.

The current version covers the Cessna 172S (G1000) with Steep Turns and S-Turns. The S-Turns are flown with a 10 kt wind.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
```

## Deploy (GitHub + Vercel)

1. Create an empty GitHub repo, then:
   ```bash
   git remote add origin git@github.com:<you>/<repo>.git
   git push -u origin main
   ```
2. In Vercel, choose **Add New → Project** and import the repo. Vercel detects Vite; the defaults are correct:
   - Build command: `npm run build`
   - Output directory: `dist`
3. Each push to `main` deploys. Each pull request gets a preview URL, which is useful for CFI review.

The app uses hash routes (`#c172s--steep-turns`), so it needs no rewrites.

## How it is built

```
src/
  data/aircraft.ts        Airframe profiles: POH speeds, arcs, RPM, flap detents, per-maneuver settings
  engine/
    types.ts              Frame / Step / Tolerance / ManeuverRun
    kinematics.ts         Physics helpers, control-input derivation, interpolation
  maneuvers/
    index.ts              Maneuver registry (all Private ACS tasks; unbuilt ones show "In production")
    steepTurns.ts         PA.V.A
    sTurns.ts             PA.V.B, wind-solved ground track
  components/
    Scene3D.tsx           three.js scene, cameras, flight path, ground, roads, wind arrow
    Skyhawk.tsx           Low-poly 172 with moving ailerons, flaps, elevator, rudder, prop
    G1000PFD.tsx          SVG PFD
    ControlsPanel.tsx     Yoke/stick, pedals, throttle, mixture, flaps, trim
    Panels.tsx            Steps, ACS tolerances, transport bar
  store/playback.ts       Shared play/pause/seek clock
```

**Maneuvers are scripted, not simulated.** Each builder runs a deterministic kinematic script at 20 Hz. The script uses the bank schedule, the coordinated-turn rate (`g·tanφ / V`) and the wind triangle. A shared finalize pass then derives the pitch attitude, load factor and control inputs that produce that motion. The output is a perfect, repeatable timeline, so the slider can scrub in either direction.

**Adding an airplane** means adding a profile to `data/aircraft.ts` with its POH numbers and a `procedures` block for each maneuver. The maneuver code does not change. `primaryControl: 'stick'` already switches the controls panel for the P-Mentor and DA42.

**Adding a maneuver** means writing a builder that returns a `ManeuverRun` and setting `build` and `needs` on its entry in `maneuvers/index.ts`.

**Swapping in a real 172 model:** export a glTF/GLB with separate nodes for the ailerons, flaps, elevator, rudder and prop, each pivoting at its hinge line. Load it with drei `useGLTF`, then drive those nodes the same way `Skyhawk.tsx` does. The orientation convention is nose −Z, right wing +X, up +Y.

## Content review

The procedure text in `steepTurns.ts` / `sTurns.ts` is a **draft awaiting CFI review**, and every number in it comes from the aircraft profile. The ACS task codes in `maneuvers/index.ts` need to be checked against the current FAA-S-ACS-6 revision.

For study and briefing only. The POH/AFM and your CFI govern.
