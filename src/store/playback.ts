import { useSyncExternalStore } from 'react';

/**
 * Tiny playback clock shared by every panel. The 3D scene reads `getTime()`
 * inside its render loop; React panels subscribe with `usePlaybackTime()`.
 */
type Listener = () => void;

class Playback {
  time = 0;
  duration = 1;
  playing = false;
  speed = 1;
  loop = true;
  private listeners = new Set<Listener>();
  private raf = 0;
  private last = 0;

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

  setSpeed(s: number) { this.speed = s; this.emit(); }

  play() {
    if (this.playing) return;
    if (this.time >= this.duration - 0.01) this.time = 0;
    this.playing = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.playing) return;
      const dt = Math.min(0.25, (now - this.last) / 1000);
      this.last = now;
      this.time += dt * this.speed;
      if (this.time >= this.duration) {
        if (this.loop) this.time = 0;
        else { this.time = this.duration; this.playing = false; }
      }
      this.emit();
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

let snapshot = { time: 0, playing: false, speed: 1 };
const getSnapshot = () => {
  if (snapshot.time !== playback.time || snapshot.playing !== playback.playing || snapshot.speed !== playback.speed) {
    snapshot = { time: playback.time, playing: playback.playing, speed: playback.speed };
  }
  return snapshot;
};

export const usePlayback = () => useSyncExternalStore(playback.subscribe, getSnapshot);
