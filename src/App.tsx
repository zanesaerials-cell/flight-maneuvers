import { memo, useEffect, useMemo, useState } from 'react';
import { AIRCRAFT, getAircraft, type AircraftProfile } from './data/aircraft';
import { MANEUVERS, isReady, type ManeuverDef } from './maneuvers';
import { sampleAt } from './engine/kinematics';
import { playback, usePlayback } from './store/playback';
import { Scene3D, type ViewMode } from './components/Scene3D';
import { G1000PFD } from './components/G1000PFD';
import { ControlsPanel } from './components/ControlsPanel';
import { AcsPanel, StepsPanel, Transport } from './components/Panels';

/* Hash routes: #c172s and #c172s--steep-turns. Plain names keep links shareable anywhere, no server config needed. */
export const routeHref = (acId?: string, mId?: string) => (acId ? `#${acId}${mId ? `--${mId}` : ''}` : '#');
function useRoute() {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('--').filter(Boolean);
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const on = () => { setParts(read()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return parts;
}

export default function App() {
  const [acId, mId] = useRoute();
  const ac = acId ? getAircraft(acId) : undefined;
  const m = ac && mId ? MANEUVERS.find((x) => x.id === mId) : undefined;
  if (ac && m && isReady(m, ac)) return <Viewer ac={ac} def={m} />;
  return <Home ac={ac?.available ? ac : undefined} />;
}

function Home({ ac }: { ac?: AircraftProfile }) {
  const groups = useMemo(() => {
    const g = new Map<string, ManeuverDef[]>();
    MANEUVERS.forEach((m) => g.set(m.group, [...(g.get(m.group) ?? []), m]));
    // Groups with finished maneuvers first, so the ready ones are on screen.
    return [...g.entries()].sort((a, b) => Number(b[1].some((m) => m.build)) - Number(a[1].some((m) => m.build)));
  }, []);

  return (
    <main className="home">
      <header className="home-head">
        <h1>Maneuver Visualizer</h1>
        <p>Watch each Private Pilot maneuver flown to the standard — outside view, PFD and your hands and feet, step by step, for the airplane you fly.</p>
      </header>

      <section className="pick">
        <h2><span className="pick-n">1</span>Choose your airplane</h2>
        <div className="ac-list">
          {AIRCRAFT.map((a) => {
            const selected = ac?.id === a.id;
            const inner = (
              <>
                <span className="ac-name">{a.name}</span>
                <span className="ac-blurb">{a.blurb}</span>
                <span className={`ac-status ${a.available ? 'ready' : ''}`}>{a.available ? (selected ? 'Selected' : 'Ready') : 'Profile in progress'}</span>
              </>
            );
            return a.available
              ? <a key={a.id} href={routeHref(a.id)} className={`ac-card ${selected ? 'selected' : ''}`} aria-current={selected ? 'true' : undefined}>{inner}</a>
              : <div key={a.id} className="ac-card disabled" aria-disabled="true">{inner}</div>;
          })}
        </div>
      </section>

      <section className={`pick ${ac ? '' : 'muted'}`}>
        <h2><span className="pick-n">2</span>Choose a maneuver</h2>
        {!ac && <p className="hint">Pick an airplane first — power settings and speeds come from its POH.</p>}
        {groups.map(([group, list]) => (
          <div key={group} className="m-group">
            <h3>{group}</h3>
            <ul className="m-list">
              {list.map((m) => {
                const ready = !!ac && isReady(m, ac);
                const body = (
                  <>
                    <span className="m-code">{m.acsCode}</span>
                    <span className="m-title">{m.title}</span>
                    <span className="m-sum">{m.summary}</span>
                    {!m.build && <span className="m-soon">In production</span>}
                  </>
                );
                return (
                  <li key={m.id}>
                    {ready
                      ? <a className="m-row" href={routeHref(ac!.id, m.id)}>{body}</a>
                      : <div className="m-row disabled" aria-disabled="true">{body}</div>}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>
      <footer className="home-foot">
        For study and briefing. Not a substitute for instruction — the POH/AFM and your CFI govern.
      </footer>
    </main>
  );
}

const Scene = memo(Scene3D);

function useWide() {
  const q = '(min-width: 1000px)';
  const [wide, setWide] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

function Viewer({ ac, def }: { ac: AircraftProfile; def: ManeuverDef }) {
  const run = useMemo(() => def.build!(ac), [ac, def]);
  const { time, playing, speed } = usePlayback();
  const [view, setView] = useState<ViewMode>('chase');
  const [tab, setTab] = useState<'steps' | 'controls' | 'acs'>('steps');
  const wide = useWide();

  useEffect(() => {
    playback.reset(run.duration);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce) playback.play();
    return () => playback.stop();
  }, [run]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault(); playback.toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const f = sampleAt(run.frames, run.dt, time);

  const steps = <StepsPanel run={run} t={time} source={ac.source} />;
  const controls = <ControlsPanel f={f} ac={ac} />;
  const acs = <AcsPanel run={run} f={f} />;

  return (
    <div className="viewer">
      <header className="vbar">
        <a href={routeHref(ac.id)} className="back" aria-label="Back to maneuvers">
          <svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" /></svg>
        </a>
        <div className="vbar-title">
          <h1>{run.title}</h1>
          <span>{ac.name}</span>
        </div>
      </header>

      <div className="stage">
        <div className="view3d">
          <Scene run={run} mode={view} />
          <div className="view-switch" role="group" aria-label="Camera">
            {(['chase', 'side', 'top'] as ViewMode[]).map((v) => (
              <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
                {v === 'chase' ? 'Chase' : v === 'side' ? 'Side' : 'Top down'}
              </button>
            ))}
          </div>
          <span className="view-hint">Drag to look around · pinch or scroll to zoom</span>
        </div>

        <div className="pfd-wrap"><G1000PFD f={f} run={run} ac={ac} /></div>

        {wide ? (
          <>
            <div className="controls-wrap">{controls}</div>
            <aside className="side">{steps}{acs}</aside>
          </>
        ) : (
          <div className="tabs-wrap">
            <div className="tabs" role="tablist">
              {([['steps', 'Steps'], ['controls', 'Controls'], ['acs', 'ACS standards']] as const).map(([k, label]) => (
                <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
              ))}
            </div>
            <div className="tab-body">{tab === 'steps' ? steps : tab === 'controls' ? controls : acs}</div>
          </div>
        )}
      </div>

      <Transport run={run} t={time} playing={playing} speed={speed} />
    </div>
  );
}
