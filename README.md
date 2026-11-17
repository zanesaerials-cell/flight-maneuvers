# Chair Flight

Shows each Private Pilot ACS maneuver flown to the standard, for a specific airplane. Each maneuver has four synced views:

- **3D outside view** with chase, side and top-down cameras. You can drag to orbit and pinch or scroll to zoom.
- **G1000-style PFD.**
- **Cockpit controls:** yoke, rudder pedals, throttle, mixture, flaps and trim.
- **Procedure steps and live ACS tolerance bars.**

A maneuver plays on its own by default. You can also scrub it with the slider or jump between steps.

Airplanes: Cessna 172S, Tecnam P-Mentor and Diamond DA42 (TAE 125). After choosing an airplane, the student picks a checkride — Private, Commercial, CFI or the Commercial Multi-Engine add-on — and sees only that checkride's maneuvers, flown to its standards and with that airplane's power settings and configuration.

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
    Cessna172.tsx         Procedural 172S to published dimensions; hinged surfaces, prop, gear contact points
    G1000PFD.tsx          SVG PFD
    ControlsPanel.tsx     Yoke/stick, pedals, throttle, mixture, flaps, trim
    Panels.tsx            Steps, ACS tolerances, transport bar
  store/playback.ts       Shared play/pause/seek clock
```

**Maneuvers are scripted, not simulated.** Each builder runs a deterministic kinematic script at 20 Hz. The script uses the bank schedule, the coordinated-turn rate (`g·tanφ / V`) and the wind triangle. A shared finalize pass then derives the pitch attitude, load factor and control inputs that produce that motion. The output is a perfect, repeatable timeline, so the slider can scrub in either direction.

**Adding an airplane** means adding a profile to `data/aircraft.ts` with its POH numbers and a `procedures` block for each maneuver. The maneuver code does not change. `primaryControl: 'stick'` already switches the controls panel for the P-Mentor and DA42.

**Adding a maneuver** means writing a builder that returns a `ManeuverRun` and setting `build` and `needs` on its entry in `maneuvers/index.ts`.

**The airplane model** is [“Cessna172”](https://sketchfab.com/3d-models/cessna172-d1b15841c29c43d0862667300bad55a4) by [KOG_THORNS](https://sketchfab.com/ioai25312), licensed [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/). Credit appears on the home page and in the 3D view; keep it there. It lives at `public/models/c172s.glb` (4.2 MB), with its license in `public/models/LICENSE-c172s.txt`.

`tools/prepare-c172s-model.mjs` converted the original Sketchfab download:
- Re-oriented and scaled it to 172S dimensions, with the origin at the CG.
- Named the ailerons, flaps, elevators, rudder, prop and gear.
- Computed each hinge line and the tire contact points into `src/data/c172sRig.ts`.
- Reduced textures to WebP and compressed the geometry with meshopt (44 MB → 4.2 MB).

To re-run it:

```bash
npm i -D @gltf-transform/core @gltf-transform/functions @gltf-transform/extensions sharp meshoptimizer
node tools/prepare-c172s-model.mjs path/to/scene.gltf public/models/c172s.glb rig.json
```

Then regenerate `src/data/c172sRig.ts` from `rig.json`.

`C172Model.tsx` loads it and re-parents each control surface onto a pivot on its hinge line. While the file loads, or if it fails, the procedural fallback below is shown.

**The procedural fallback** (`Cessna172.tsx`) is generated in code from 172S dimensions:
- 8.28 m long, 11.0 m span, 1.63 → 1.13 m chord, 1.73° dihedral, 3° washout.
- NACA 2412 wing and NACA 0009 tail sections.
- A 1.93 m prop and a 2.54 m main gear track.

The ailerons, flaps, elevator and rudder rotate about their real hinge lines. `WHEEL_CONTACTS` gives the tire contact points. The scene uses them to keep the tires exactly on the runway at any pitch, including rotation, flare and nosewheel-down rollout.

**Using a purchased or licensed glTF instead:**
1. Export with separate nodes for each aileron, flap, elevator half, the rudder and the prop, each with its pivot on the hinge line.
2. Orient it nose −Z, right wing +X, up +Y, with the origin at the CG.
3. Load it with drei `useGLTF` and drive those nodes as `Cessna172.tsx` does.
4. Update `WHEEL_CONTACTS` to match the model's tires.

## P-Mentor model

The P-Mentor model is original and built in code (`src/components/PMentorModel.ts`, proportions in `src/data/pmentorShape.ts`) to the published dimensions; the P2002 Sierra served only as a visual reference and is not in the repository. Hinge lines and the propeller hub are computed from the same numbers, so changing a dimension keeps the rig in step.

`src/data/modelRigs.ts` holds each model's tire contact points, hinge lines, propeller hubs and gear parts.

## DA42 model

`tools/prepare-da42-model.mjs` turns the Sketchfab download into `public/models/da42.glb`:
- Cuts the propellers, flaps, ailerons, elevator, rudder and gear out of the model's large meshes as named parts.
- Repaints the livery plain white (removes the green stripes and logos).
- Closes the nose baggage door that the original has open.
- Re-orients the model and computes the rig.

```bash
node tools/prepare-da42-model.mjs path/to/scene.gltf public/models/da42.glb rig.json
```

Paste the rig into `MODEL_RIGS.da42`.

## Displays

The C172S and DA42 use the G1000-style PFD (`G1000PFD.tsx`). The P-Mentor uses a G3X Touch-style PFD (`G3XPFD.tsx`) laid out like the school's P-Mentors (no engine strip).

## Content review

All procedure text is a **draft awaiting CFI review**; every number comes from the aircraft profile. See `REVIEW.md` for a per-maneuver checklist. The ACS task codes in `maneuvers/index.ts` need to be checked against the current FAA-S-ACS-6 revision.

For study and briefing only. The POH/AFM and your CFI govern.

## Beta features

- **Report or suggest:** a button on every page. Reports carry the airplane, section, maneuver, step, time, camera, link, app version and device. Reports go by email to zane.harris@central.aero (set `VITE_FEEDBACK_EMAIL` in Vercel to change it); testers can also open a GitHub issue or copy the report.
- **Offline:** the app installs a service worker. After the first visit it works offline; each airplane's model is kept once it has been viewed. New versions are picked up the next time the app is opened online.
- **Performance:** the 3D code loads only when a maneuver opens; phones render at up to 1.5× and every device drops to 1× if the frame rate sags. The C172S model no longer includes cockpit detail that cannot be seen from outside (4.2 MB → 1.4 MB).
