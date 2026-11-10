import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { Line2 } from 'three-stdlib';
import type { Frame, ManeuverRun } from '../engine/types';
import { D2R, FT, angDiff, sampleAt } from '../engine/kinematics';
import { playback } from '../store/playback';
import { Skyhawk } from './Skyhawk';

export type ViewMode = 'chase' | 'side' | 'top';

const SKY = '#a9c7e3';
const MAGENTA = '#e23ad8';

const toWorld = (f: Pick<Frame, 'east' | 'north' | 'altFt'>, elevFt: number, out = new THREE.Vector3()) =>
  out.set(f.east, (f.altFt - elevFt) * FT, -f.north);

export function Scene3D({ run, mode }: { run: ManeuverRun; mode: ViewMode }) {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ fov: 50, near: 0.5, far: 40000, position: [0, 300, 60] }}
      gl={{ antialias: true }}
      style={{ touchAction: 'none' }}
    >
      <color attach="background" args={[SKY]} />
      <fog attach="fog" args={[SKY, 2500, 14000]} />
      <hemisphereLight args={['#dfeeff', '#4c5a3a', 0.9]} />
      <directionalLight position={[-3000, 5000, 2000]} intensity={1.6} />
      <World run={run} mode={mode} />
    </Canvas>
  );
}

function World({ run, mode }: { run: ManeuverRun; mode: ViewMode }) {
  const elev = run.scene.groundElevFt;
  const frameRef = useRef<Frame>(run.frames[0]);
  const getFrame = () => frameRef.current;
  const plane = useRef<THREE.Group>(null);
  const shadow = useRef<THREE.Mesh>(null);
  const flown = useRef<Line2>(null);

  const pathPts = useMemo(() => run.frames.filter((_, i) => i % 4 === 0).map((f) => toWorld(f, elev)), [run, elev]);
  const groundPts = useMemo(() => pathPts.map((p) => new THREE.Vector3(p.x, 0.6, p.z)), [pathPts]);

  useFrame(() => {
    const f = sampleAt(run.frames, run.dt, playback.time);
    frameRef.current = f;
    const g = plane.current;
    if (g) {
      toWorld(f, elev, g.position);
      g.rotation.set(f.pitch * D2R, -f.heading * D2R, -f.bank * D2R, 'YXZ');
      g.scale.setScalar(mode === 'top' ? 9 : 1);
    }
    if (shadow.current) {
      shadow.current.position.set(f.east, 0.4, -f.north);
      shadow.current.rotation.set(-Math.PI / 2, 0, -f.heading * D2R);
      shadow.current.scale.setScalar(mode === 'top' ? 9 : 1);
    }
    const line = flown.current;
    if (line) {
      const idx = Math.max(1, Math.floor(playback.time / run.dt / 4));
      (line.geometry as THREE.InstancedBufferGeometry).instanceCount = Math.min(idx, pathPts.length - 1);
    }
  });

  return (
    <>
      <Ground />
      {run.scene.roads.map((r, i) => <RoadStrip key={i} {...r} />)}
      {run.scene.wind && <WindArrow fromDeg={run.scene.wind.fromDeg} kt={run.scene.wind.kt} at={[run.scene.frameCenter[0] - 700, -run.scene.frameCenter[1] - 500]} />}

      {/* Planned path (faint) and flown path (magenta, like a G1000 active leg). */}
      <Line points={pathPts} color={MAGENTA} lineWidth={1.5} transparent opacity={0.25} />
      <Line ref={flown} points={pathPts} color={MAGENTA} lineWidth={3.5} />
      <Line points={groundPts} color="#3b2f45" lineWidth={1.5} transparent opacity={0.45} />

      <mesh ref={shadow}>
        <planeGeometry args={[11, 8]} />
        <meshBasicMaterial color="#000" transparent opacity={0.22} depthWrite={false} />
      </mesh>
      <group ref={plane}><Skyhawk getFrame={getFrame} /></group>

      <CameraRig run={run} mode={mode} getFrame={getFrame} />
    </>
  );
}

function CameraRig({ run, mode, getFrame }: { run: ManeuverRun; mode: ViewMode; getFrame: () => Frame }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, size } = useThree();
  const state = useRef({ mode: '' as ViewMode | '', heading: 0 });
  const elev = run.scene.groundElevFt;
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => { state.current.mode = ''; }, [run, mode]);

  useFrame(() => {
    const ctl = controls.current;
    if (!ctl) return;
    const f = getFrame();
    const p = toWorld(f, elev, tmp);
    const cam = camera as THREE.PerspectiveCamera;

    if (state.current.mode !== mode) {
      if (mode === 'top') {
        const [ce, cn] = run.scene.frameCenter;
        const fitV = run.scene.frameRadius / Math.tan((cam.fov / 2) * D2R);
        const fit = size.width < size.height ? fitV * (size.height / size.width) : fitV;
        ctl.target.set(ce, 0, -cn);
        cam.position.set(ce, fit * 1.05, -cn + fit * 0.02);
      } else {
        const off = mode === 'chase'
          ? new THREE.Vector3(0, 6, 26).applyAxisAngle(new THREE.Vector3(0, 1, 0), -f.heading * D2R)
          : new THREE.Vector3(70, 6, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), -run.bugs.heading * D2R);
        ctl.target.copy(p);
        cam.position.copy(p).add(off);
      }
      state.current = { mode, heading: f.heading };
      ctl.update();
      return;
    }

    if (mode !== 'top') {
      const offset = cam.position.clone().sub(ctl.target);
      if (mode === 'chase') {
        offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), -angDiff(state.current.heading, f.heading) * D2R);
      }
      ctl.target.copy(p);
      cam.position.copy(p).add(offset);
    }
    state.current.heading = f.heading;
    ctl.update();
  });

  return (
    <OrbitControls
      ref={controls}
      enableDamping={false}
      enablePan={mode === 'top'}
      minDistance={mode === 'top' ? 200 : 12}
      maxDistance={mode === 'top' ? 9000 : 900}
      maxPolarAngle={Math.PI * 0.495}
    />
  );
}

function Ground() {
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 1024;
    const g = c.getContext('2d')!;
    const fields = ['#7c9a54', '#8aa65d', '#6f8f4a', '#a8a065', '#98a85f', '#b5a974', '#7a9350', '#8d9d58'];
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const cell = 128;
    for (let y = 0; y < 1024; y += cell) {
      for (let x = 0; x < 1024; x += cell) {
        const split = rnd() > 0.5;
        const k = 0.35 + rnd() * 0.3;
        g.fillStyle = fields[Math.floor(rnd() * fields.length)];
        g.fillRect(x, y, cell, cell);
        g.fillStyle = fields[Math.floor(rnd() * fields.length)];
        if (split) g.fillRect(x, y, cell * k, cell); else g.fillRect(x, y, cell, cell * k);
        // crop rows
        g.strokeStyle = 'rgba(40,55,25,0.08)';
        g.lineWidth = 1;
        for (let r = 4; r < cell; r += 6) {
          g.beginPath();
          if (split) { g.moveTo(x + r, y); g.lineTo(x + r, y + cell); } else { g.moveTo(x, y + r); g.lineTo(x + cell, y + r); }
          g.stroke();
        }
      }
    }
    g.strokeStyle = 'rgba(70,60,40,0.35)';
    g.lineWidth = 2;
    for (let i = 0; i <= 1024; i += cell) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 1024); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(1024, i); g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(24, 24);
    t.anisotropy = 8;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
      <planeGeometry args={[40000, 40000]} />
      <meshStandardMaterial map={tex} roughness={1} />
    </mesh>
  );
}

function RoadStrip({ from, to, width }: { from: [number, number]; to: [number, number]; width: number }) {
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const ang = Math.atan2(to[1] - from[1], to[0] - from[0]);
  return (
    <mesh position={[(from[0] + to[0]) / 2, 0.2, -(from[1] + to[1]) / 2]} rotation={[-Math.PI / 2, 0, ang]}>
      <planeGeometry args={[len, width]} />
      <meshStandardMaterial color="#5d5a55" roughness={1} />
    </mesh>
  );
}

function WindArrow({ fromDeg, kt, at }: { fromDeg: number; kt: number; at: [number, number] }) {
  const shape = useMemo(() => {
    const s = new THREE.Shape();
    // Arrow pointing +Y in shape space (downwind direction after rotation).
    s.moveTo(-25, -120); s.lineTo(25, -120); s.lineTo(25, 40); s.lineTo(70, 40);
    s.lineTo(0, 140); s.lineTo(-70, 40); s.lineTo(-25, 40); s.closePath();
    return s;
  }, []);
  const toward = (fromDeg + 180) * D2R;
  return (
    <group position={[at[0], 1, at[1]]}>
      <mesh rotation={[-Math.PI / 2, 0, -toward]}>
        <shapeGeometry args={[shape]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.85} />
      </mesh>
      <Html position={[0, 40, 0]} center distanceFactor={2400} zIndexRange={[5, 0]}>
        <div className="wind-tag">Wind {String(fromDeg).padStart(3, '0')}° at {kt} kt</div>
      </Html>
    </group>
  );
}
