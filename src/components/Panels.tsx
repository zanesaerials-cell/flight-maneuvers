import type { Frame, ManeuverRun } from '../engine/types';
import { clamp } from '../engine/kinematics';
import { playback } from '../store/playback';

const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export function activeStepIndex(run: ManeuverRun, t: number) {
  const i = run.steps.findIndex((s) => t >= s.start && t < s.end);
  return i < 0 ? run.steps.length - 1 : i;
}

export function StepsPanel({ run, t, source }: { run: ManeuverRun; t: number; source: string }) {
  const active = activeStepIndex(run, t);
  return (
    <section className="steps" aria-label="Procedure steps">
      <ol>
        {run.steps.map((s, i) => {
          const state = i < active ? 'done' : i === active ? 'now' : 'next';
          const progress = i === active ? clamp((t - s.start) / (s.end - s.start), 0, 1) : state === 'done' ? 1 : 0;
          return (
            <li key={s.id} className={`step ${state}`}>
              <button className="step-head" onClick={() => playback.seek(s.start + 0.01)} aria-current={state === 'now' ? 'step' : undefined}>
                <span className="step-num">{i + 1}</span>
                <span className="step-title">{s.title}</span>
                <span className="step-time">{fmtTime(s.start)}</span>
              </button>
              <span className="step-progress" style={{ transform: `scaleX(${progress})` }} />
              {state === 'now' && (
                <ul className="step-detail">
                  {s.detail.map((d, k) => <li key={k}>{d}</li>)}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      <ul className="acs-notes">{run.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
      <p className="fineprint">
        Procedure text is a draft awaiting CFI review. Numbers from the {source}. The POH and your instructor govern.
      </p>
    </section>
  );
}

export function AcsPanel({ run, f }: { run: ManeuverRun; f: Frame }) {
  return (
    <section className="acs" aria-label="ACS standards">
      <header className="acs-head">
        <span className="acs-code">{run.acsCode}</span>
        <span>{run.acsDoc ?? 'Private Pilot ACS'}, {run.acsTask}</span>
      </header>
      <p className="acs-objective">{run.objective}</p>
      <div className="tol-list">
        {run.tolerances.map((tol) => {
          const judged = tol.windows.some(([a, b]) => f.t >= a && f.t <= b);
          const v = tol.value(f);
          const lo = tol.target - tol.minus, hi = tol.target + tol.plus;
          const span = (tol.minus + tol.plus) * 2;
          const min = tol.target - tol.minus * 2;
          const pos = (x: number) => clamp((x - min) / span, 0, 1) * 100;
          const ok = v >= lo - 1e-6 && v <= hi + 1e-6;
          const shown = tol.id === 'hdg' ? String(Math.round(((v % 360) + 360) % 360) || 360).padStart(3, '0') : Math.round(v).toLocaleString();
          return (
            <div key={tol.id} className={`tol ${judged ? (ok ? 'ok' : 'out') : 'idle'}`}>
              <div className="tol-row">
                <span className="tol-label">{tol.label}</span>
                <span className="tol-std">{tol.standard}</span>
                <span className="tol-val">{judged ? <>{shown}{tol.unit === '°' ? '°' : ` ${tol.unit}`}</> : '—'}</span>
              </div>
              {judged && (
                <div className="tol-bar" aria-hidden>
                  <span className="tol-band" style={{ left: `${pos(lo)}%`, width: `${pos(hi) - pos(lo)}%` }} />
                  <span className="tol-target" style={{ left: `${pos(tol.target)}%` }} />
                  <span className="tol-needle" style={{ left: `${pos(v)}%` }} />
                </div>
              )}
              {!judged && <span className="tol-note">Judged {describeWindows(run, tol.windows)}</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function describeWindows(run: ManeuverRun, w: [number, number][]) {
  const names = w.map(([a]) => run.steps[activeStepIndex(run, a + 0.01)]?.title).filter(Boolean);
  return names.length ? `from “${names[0]}”${names.length > 1 ? ' and again later' : ''}` : 'during the maneuver';
}

export function Transport({ run, t, playing, speed, stopAtSteps }: { run: ManeuverRun; t: number; playing: boolean; speed: number; stopAtSteps: boolean }) {
  const active = activeStepIndex(run, t);
  const go = (i: number) => {
    const s = run.steps[clamp(i, 0, run.steps.length - 1)];
    playback.seek(s.start + 0.01);
  };
  return (
    <div className="transport">
      <div className="transport-buttons">
        <button className="tbtn" onClick={() => go(t - run.steps[active].start > 1.5 ? active : active - 1)} aria-label="Previous step">
          <svg viewBox="0 0 24 24"><path d="M6 5h2v14H6zM20 5v14L9 12z" /></svg>
        </button>
        <button className="tbtn play" onClick={() => playback.toggle()} aria-label={playing ? 'Pause' : 'Play'}>
          {playing
            ? <svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
            : <svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z" /></svg>}
        </button>
        <button className="tbtn" onClick={() => go(active + 1)} aria-label="Next step">
          <svg viewBox="0 0 24 24"><path d="M16 5h2v14h-2zM4 5v14l11-7z" /></svg>
        </button>
      </div>
      <div className="scrub">
        <div className="scrub-marks" aria-hidden>
          {run.steps.slice(1).map((s) => <span key={s.id} style={{ left: `${(s.start / run.duration) * 100}%` }} />)}
        </div>
        <input
          type="range" min={0} max={run.duration} step={0.05} value={t}
          aria-label="Maneuver timeline"
          onPointerDown={() => playback.stop()}
          onChange={(e) => playback.seek(Number(e.target.value))}
          style={{ ['--p' as string]: `${(t / run.duration) * 100}%` }}
        />
      </div>
      <span className="clock">{fmtTime(t)} / {fmtTime(run.duration)}</span>
      <div className="speeds" role="group" aria-label="Playback speed">
        {[0.25, 0.5, 1, 2, 4].map((s) => (
          <button key={s} className={speed === s ? 'on' : ''} onClick={() => playback.setSpeed(s)} aria-label={`${s} times speed`}>{s === 0.25 ? '¼' : s === 0.5 ? '½' : s}×</button>
        ))}
      </div>
      <button className={`stepstop${stopAtSteps ? ' on' : ''}`} aria-pressed={stopAtSteps} onClick={() => playback.setStopAtSteps(!stopAtSteps)}
        title="Pause at the start of every step, so there is time to read it">
        <svg viewBox="0 0 24 24" aria-hidden><path d="M5 4h2v16H5zM10 5h3v14h-3zM16 5h3v14h-3z" /></svg>
        <span className="ss-long">Stop at each step</span><span className="ss-short">Step stops</span>
      </button>
    </div>
  );
}
