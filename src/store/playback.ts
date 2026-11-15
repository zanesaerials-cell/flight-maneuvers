import { useSyncExternalStore } from 'react';

/**
 * Tiny playback clock shared by every panel. The 3D scene reads `getTime()`
 * inside its render loop; React panels subscribe with `usePlaybackTime()`.
 */
type Listener = () => void;

// Viewer preferences remembered in this browser only; storage can be unavailable, so every access is guarded.
function readFlag(key: string): boolean { try { return localStorage.getItem(`fm.${key}`) === '1'; } catch { return false; } }
function readNum(key: string, fallback: number): number { try { const v = Number(localStorage.getItem(`fm.${key}`)); return v > 0 ? v : fallback; } catch { return fallback; } }
function writeFlag(key: string, value: string) { try { localStorage.setItem(`fm.${key}`, value); } catch { /* not available */ } }

class Playback {
  time = 0;
  duration = 1;
  playing = false;
  speed = readNum('speed', 1);
  loop = true;
  /** Pause automatically each time playback reaches the start of a new step. */
  stopAtSteps = readFlag('stopAtSteps');
  private marks: number[] = [];
  private listeners = new Set<Listener>();
  private raf = 0;
  private last = 0;
  private lastEmit = 0;

  subscribe = (l: Listener) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  private emit() { this.listeners.forEach((l) => l()); }

  reset(duration: number) {
    this.stop();
    this.duration = duration;
    this.time = 0;
    this.emit();
  }

  seek(t: number) {
    this.time = Math.min(this.duration, Math.max(0, t));
    this.emit();
  }

  setSpeed(s: number) { this.speed = s; writeFlag('speed', String(s)); this.emit(); }

  setStopAtSteps(on: boolean) { this.stopAtSteps = on; writeFlag('stopAtSteps', on ? '1' : ''); this.emit(); }

  /** Start times of the steps, where "stop at each step" pauses. */
  setMarks(starts: number[]) { this.marks = starts.filter((t) => t > 0.05); }

  play() {
    if (this.playing) return;
    if (this.time >= this.duration - 0.01) this.time = 0;
    this.playing = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.playing) return;
      // A frame timestamp can be slightly earlier than the click that started playback; never step backwards.
      const dt = Math.max(0, Math.min(0.25, (now - this.last) / 1000));
      this.last = now;
      const prev = this.time;
      this.time += dt * this.speed;
      if (this.stopAtSteps) {
        const hit = this.marks.find((m) => prev < m && m <= this.time);
        if (hit !== undefined) { this.time = hit; this.playing = false; this.emit(); return; }
      }
      if (this.time >= this.duration) {
        if (this.loop) this.time = 0;
        else { this.time = this.duration; this.playing = false; }
      }
      // The 3D scene reads `time` directly every frame. The React panels (PFD,
      // controls, steps) only need ~30 updates a second, which keeps the main
      // thread free so the 3D view never waits on a long render.
      if (now - this.lastEmit >= 32 || !this.playing) { this.lastEmit = now; this.emit(); }
      if (this.playing) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    this.emit();
  }

  stop() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.emit();
  }

  toggle() { if (this.playing) this.stop(); else this.play(); }
}

export const playback = new Playback();

let snapshot = { time: 0, playing: false, speed: 1, stopAtSteps: false };
const getSnapshot = () => {
  if (snapshot.time !== playback.time || snapshot.playing !== playback.playing || snapshot.speed !== playback.speed || snapshot.stopAtSteps !== playback.stopAtSteps) {
    snapshot = { time: playback.time, playing: playback.playing, speed: playback.speed, stopAtSteps: playback.stopAtSteps };
  }
  return snapshot;
};

export const usePlayback = () => useSyncExternalStore(playback.subscribe, getSnapshot);
