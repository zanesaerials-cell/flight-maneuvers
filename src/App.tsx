import { FeedbackButton } from './components/Feedback';
import { Suspense, lazy, memo, useEffect, useMemo, useState } from 'react';
import { AIRCRAFT, getAircraft, type AircraftProfile, type Cert } from './data/aircraft';
import { MANEUVERS, buildManeuver, isReady, maneuversFor, type ManeuverDef } from './maneuvers';
import { certInfo } from './maneuvers/standards';
import { sampleAt } from './engine/kinematics';
import { playback, usePlayback } from './store/playback';
import type { ViewMode } from './components/Scene3D';
import { useModelLoading } from './store/loading';
import { G1000PFD } from './components/G1000PFD';
import { G3XPFD } from './components/G3XPFD';
import { ControlsPanel } from './components/ControlsPanel';
import { AcsPanel, StepsPanel, Transport, activeStepIndex } from './components/Panels';

/* Hash routes: #c172s, #c172s--commercial and #c172s--commercial--chandelle. Plain names keep links shareable anywhere. */
export const routeHref = (acId?: string, cert?: string, mId?: string) =>
  (acId ? `#${[acId, cert, mId].filter(Boolean).join('--')}` : '#');
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
  const [acId, certId, mId] = useRoute();
  const ac = acId ? getAircraft(acId) : undefined;
  // An airplane with a single section (the twin) goes straight to it.
  const cert = ac && (ac.certs.find((c) => c === certId) ?? (ac.certs.length === 1 ? ac.certs[0] : undefined));
  const m = ac && cert && mId ? MANEUVERS.find((x) => x.id === mId) : undefined;
  if (ac && cert && m && isReady(m, ac, cert)) return <Viewer ac={ac} cert={cert} def={m} />;
  return <Home ac={ac?.available ? ac : undefined} cert={cert} />;
}

function Home({ ac, cert }: { ac?: AircraftProfile; cert?: Cert }) {
  const groups = useMemo(() => {
    if (!ac || !cert) return [];
    const g = new Map<string, ManeuverDef[]>();
    maneuversFor(ac, cert).forEach((m) => g.set(m.group, [...(g.get(m.group) ?? []), m]));
    return [...g.entries()];
  }, [ac, cert]);
  const credits = AIRCRAFT.filter((a) => a.model?.credit);

  return (
    <main className="home">
      <header className="home-head">
        <h1 className="brand"><img src="/logo-v6.svg" alt="" width="64" height="64" />Chair Flight</h1>
        <p>Watch each checkride maneuver flown to the standard — outside view, PFD and your hands and feet, step by step, for the airplane you fly.</p>
      </header>

      <section className="pick">
        <h2><span className="pick-n">1</span>Choose your airplane</h2>
        <div className="ac-list">
          {AIRCRAFT.map((a) => {
            const selected = ac?.id === a.id;
            return (
              <a key={a.id} href={routeHref(a.id)} className={`ac-card ${selected ? 'selected' : ''}`} aria-current={selected ? 'true' : undefined}>
                <span className="ac-name">{a.name}</span>
                <span className="ac-blurb">{a.blurb}</span>
                <span className="ac-status ready">{selected ? 'Selected' : a.certs.map((c) => certInfo(c).name.replace(' Pilot', '').replace('Flight Instructor (CFI)', 'CFI').replace('Commercial Multi-Engine Add-On', 'Multi add-on')).join(' · ')}</span>
              </a>
            );
          })}
        </div>
      </section>

      <section className={`pick ${ac ? '' : 'muted'}`}>
        <h2><span className="pick-n">2</span>Choose your checkride</h2>
        {!ac && <p className="hint">Pick an airplane first — each one is used for different checkrides.</p>}
        {ac && (
          <div className="cert-list">
            {ac.certs.map((c) => {
              const info = certInfo(c), selected = cert === c;
              return (
                <a key={c} href={routeHref(ac.id, c)} className={`ac-card ${selected ? 'selected' : ''}`} aria-current={selected ? 'true' : undefined}>
                  <span className="ac-name">{info.name}</span>
                  <span className="ac-blurb">{info.blurb}</span>
                  <span className="ac-status ready">{selected ? 'Selected' : `${maneuversFor(ac, c).length} maneuvers`}</span>
                </a>
              );
            })}
          </div>
        )}
      </section>

      <section className={`pick ${ac && cert ? '' : 'muted'}`}>
        <h2><span className="pick-n">3</span>Choose a maneuver</h2>
        {!(ac && cert) && <p className="hint">You will see only the maneuvers on that checkride, flown to its standards.</p>}
        {ac && cert && groups.map(([group, list]) => (
          <div key={group} className="m-group">
            <h3>{group}</h3>
            <ul className="m-list">
              {list.map((m) => (
                <li key={m.id}>
                  <a className="m-row" href={routeHref(ac.id, cert, m.id)}>
                    <span className="m-title">{m.title}</span>
                    <span className="m-sum">{m.summary}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
      <footer className="home-foot">
        <FeedbackButton context={() => ({ label: 'General', where: ['Page: home', `Link: ${location.href}`] })} />
        <br />
        For study and briefing. Not a substitute for instruction — the POH/AFM and your CFI govern.
        <br />
        3D models (scaled, re-oriented and compressed for this app):{' '}
        {credits.map((a, i) => (
          <span key={a.id}>{i > 0 && '; '}<a href={a.model!.creditUrl} target="_blank" rel="noreferrer">{a.model!.credit}</a></span>
        ))}.
      </footer>
    </main>
  );
}

// The 3D code (three.js) loads only when a maneuver is opened, so the home page opens fast.
const Scene = memo(lazy(() => import('./components/Scene3D').then((m) => ({ default: m.Scene3D }))));

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

function Viewer({ ac, cert, def }: { ac: AircraftProfile; cert: Cert; def: ManeuverDef }) {
  const run = useMemo(() => buildManeuver(def, ac, cert), [ac, cert, def]);
  const { time, playing, speed, stopAtSteps } = usePlayback();
  const [view, setView] = useState<ViewMode>('chase');
  const [tab, setTab] = useState<'steps' | 'controls' | 'acs'>('steps');
  const wide = useWide();

  useEffect(() => {
    playback.reset(run.duration);
    playback.setMarks(run.steps.map((s) => s.start));
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
        <a href={routeHref(ac.id, cert)} className="back" aria-label="Back to maneuvers">
          <svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" /></svg>
        </a>
        <div className="vbar-title">
          <h1>{run.title}</h1>
          <span>{ac.name} · {certInfo(cert).name}</span>
        </div>
        <FeedbackButton compact={!wide} context={() => {
          const t = playback.time, i = activeStepIndex(run, t);
          const mm = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
          return {
            label: `${ac.shortName} · ${certInfo(cert).name} · ${run.title}`,
            where: [
              `Airplane: ${ac.name}`, `Checkride: ${certInfo(cert).name}`, `Maneuver: ${run.title} (${run.acsCode})`,
              `Step ${i + 1}: ${run.steps[i]?.title ?? '—'}`, `Time: ${mm} of ${Math.floor(run.duration / 60)}:${String(Math.floor(run.duration % 60)).padStart(2, '0')}`,
              `Camera: ${view}, speed ${speed}×`, `Link: ${location.href}`,
            ],
          };
        }} />
      </header>

      <div className="stage">
        <div className="view3d">
          <Suspense fallback={<div className="view-loading">Loading 3D view…</div>}>
            <Scene run={run} mode={view} ac={ac} />
          </Suspense>
          <ModelLoading />
          <div className="view-switch" role="group" aria-label="Camera">
            {(['chase', 'side', 'top'] as ViewMode[]).map((v) => (
              <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
                {v === 'chase' ? 'Chase' : v === 'side' ? 'Side' : 'Top down'}
              </button>
            ))}
          </div>
          <span className="view-hint">Drag to look around · pinch or scroll to zoom</span>
          {ac.model?.credit && <a className="model-credit" href={ac.model.creditUrl} target="_blank" rel="noreferrer">{ac.model.credit}</a>}
        </div>

        <div className="pfd-wrap">{ac.avionics === 'g3x-touch' ? <G3XPFD f={f} run={run} ac={ac} /> : <G1000PFD f={f} run={run} ac={ac} />}</div>

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

      <Transport run={run} t={time} playing={playing} speed={speed} stopAtSteps={stopAtSteps} />
    </div>
  );
}

function ModelLoading() {
  const loading = useModelLoading();
  return loading ? <div className="model-loading" role="status"><span className="spinner" aria-hidden />Loading airplane model…</div> : null;
}
