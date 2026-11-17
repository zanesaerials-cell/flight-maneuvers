import { useEffect, useRef, useState } from 'react';
import { playback } from '../store/playback';

/**
 * "Report an issue or suggest an update". The report carries everything needed to
 * find the spot (airplane, section, maneuver, step, time, view, app version, device),
 * so the tester only writes what they noticed. It goes out by email or as a GitHub
 * issue; copying the text works everywhere as a fallback.
 */

// Where reports go. VITE_FEEDBACK_EMAIL in Vercel (Project → Settings → Environment Variables) overrides it.
const EMAIL: string = import.meta.env.VITE_FEEDBACK_EMAIL || 'zane.harris@central.aero';
const REPO = 'zanesaerials-cell/flight-maneuvers';
declare const __APP_VERSION__: string;

export interface FeedbackContext {
  /** Lines describing where the tester was, e.g. ["Airplane: C172S", "Step 3: Rotate at 55 KIAS"]. */
  where: string[];
  /** Short label for the subject line, e.g. "C172S · Private · Steep Turns". */
  label: string;
}

type Kind = 'issue' | 'update';

export function FeedbackButton({ context, compact }: { context: () => FeedbackContext; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={`fb-btn${compact ? ' compact' : ''}`} onClick={() => { playback.stop(); setOpen(true); }} aria-haspopup="dialog">
        <svg viewBox="0 0 24 24" aria-hidden><path d="M5 3h2v18H5zM8 4h10l-2 4 2 4H8z" /></svg>
        <span>Report or suggest</span>
      </button>
      {open && <FeedbackDialog context={context()} onClose={() => setOpen(false)} />}
    </>
  );
}

function FeedbackDialog({ context, onClose }: { context: FeedbackContext; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>('issue');
  const [text, setText] = useState('');
  const [name, setName] = useState(() => { try { return localStorage.getItem('fm.name') ?? ''; } catch { return ''; } });
  const [copied, setCopied] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const report = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    area.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => { try { localStorage.setItem('fm.name', name); } catch { /* not available */ } }, [name]);

  const device = `${navigator.userAgent.replace(/\s*\(KHTML, like Gecko\)/, '')} · screen ${window.innerWidth}×${window.innerHeight}`;
  const subject = `${kind === 'issue' ? 'Issue' : 'Suggestion'}: ${context.label}`;
  const body = [
    kind === 'issue' ? 'What looks wrong:' : 'Suggested update:',
    text.trim() || '(not filled in)',
    '',
    ...(name.trim() ? [`From: ${name.trim()}`, ''] : []),
    '— Details (filled in automatically) —',
    ...context.where,
    `App version: ${__APP_VERSION__}`,
    `Device: ${device}`,
  ].join('\n');

  const mailto = `mailto:${EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const issue = `https://github.com/${REPO}/issues/new?title=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}&labels=${kind === 'issue' ? 'beta-issue' : 'suggestion'}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(`${subject}\n\n${body}`); setCopied(true); }
    catch { report.current?.select(); }
  };

  return (
    <div className="fb-backdrop" onClick={onClose}>
      <div className="fb-dialog" role="dialog" aria-modal="true" aria-labelledby="fb-title" onClick={(e) => e.stopPropagation()}>
        <div className="fb-head">
          <h2 id="fb-title">Report or suggest</h2>
          <button className="fb-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="fb-kind" role="radiogroup" aria-label="Type">
          <button role="radio" aria-checked={kind === 'issue'} className={kind === 'issue' ? 'on' : ''} onClick={() => setKind('issue')}>Something looks wrong</button>
          <button role="radio" aria-checked={kind === 'update'} className={kind === 'update' ? 'on' : ''} onClick={() => setKind('update')}>Suggest an update</button>
        </div>
        <label className="fb-field">
          <span>{kind === 'issue' ? 'What did you notice? What should it be?' : 'What should change or be added?'}</span>
          <textarea ref={area} rows={5} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={kind === 'issue' ? 'e.g. Our school rotates at 55, not 53. Step text says “right rudder” but the pedals show left.' : 'e.g. Add a crosswind landing. Show the checklist for the DA42 before-landing check.'} />
        </label>
        <label className="fb-field">
          <span>Your name (optional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jordan, CFI" />
        </label>
        <details className="fb-details">
          <summary>Details sent with it</summary>
          <ul>{context.where.map((w) => <li key={w}>{w}</li>)}<li>App version: {__APP_VERSION__}</li></ul>
        </details>
        <div className="fb-actions">
          {EMAIL && <a className="fb-send" href={mailto}>Send by email</a>}
          <a className={EMAIL ? 'fb-alt' : 'fb-send'} href={issue} target="_blank" rel="noreferrer">Open as GitHub issue</a>
          <button className="fb-alt" onClick={copy}>{copied ? 'Copied' : 'Copy report'}</button>
        </div>
        {EMAIL
          ? <p className="fb-note">Email not opening? Copy the report and send it to <span className="fb-addr">{EMAIL}</span>.</p>
          : <p className="fb-note">No GitHub account? Copy the report and text or email it to the person running the beta.</p>}
        <textarea ref={report} className="fb-hidden" readOnly value={`${subject}\n\n${body}`} aria-hidden tabIndex={-1} />
      </div>
    </div>
  );
}
