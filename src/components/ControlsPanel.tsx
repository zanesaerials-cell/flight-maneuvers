import { fl, type AircraftProfile } from '../data/aircraft';
import { propLever } from './engine';
import type { Frame } from '../engine/types';
import { clamp } from '../engine/kinematics';

const amount = (v: number) => {
  const a = Math.abs(v);
  if (a < 0.04) return 'Neutral';
  if (a < 0.15) return 'Slight';
  if (a < 0.35) return 'Moderate';
  return 'Firm';
};

export function describeAileron(v: number) {
  const a = amount(v);
  return a === 'Neutral' ? 'Neutral' : `${a} ${v < 0 ? 'left' : 'right'}`;
}
export function describeElevator(v: number) {
  const a = amount(v);
  return a === 'Neutral' ? 'Neutral' : `${a} ${v > 0 ? 'back pressure' : 'forward pressure'}`;
}
export function describeRudder(v: number) {
  const a = amount(v);
  return a === 'Neutral' ? 'Neutral' : `${a} ${v < 0 ? 'left' : 'right'}`;
}

export function ControlsPanel({ f, ac }: { f: Frame; ac: AircraftProfile }) {
  const c = f.c;
  return (
    <div className="controls">
      <Instrument title={ac.primaryControl === 'yoke' ? 'Yoke' : 'Stick'} value={`${describeAileron(c.aileron)} · ${describeElevator(c.elevator)}`}>
        {ac.primaryControl === 'yoke' ? <Yoke ail={c.aileron} elev={c.elevator} /> : <Stick ail={c.aileron} elev={c.elevator} />}
      </Instrument>
      <Instrument title="Rudder pedals" value={describeRudder(c.rudder)}>
        <Pedals rud={c.rudder} />
      </Instrument>
      <Instrument
        title={ac.power.lever}
        value={ac.engines === 2 && Math.abs(c.throttle - c.throttleR) > 0.08
          ? `Left ${f.oei ? 'failed' : c.throttle < 0.05 ? 'idle' : `${Math.round(c.throttle * 100)}%`} · Right ${ac.power.fmt(f.rpm)}`
          : ac.power.fmt(f.rpm)}
      >
        {ac.engines === 2
          ? <TwinLevers l={c.throttle} r={c.throttleR} />
          : ac.controls.levers
            ? <Quadrant v={c.throttle} handle="#1b1d20" lo="IDLE" hi="MAX" note={`${Math.round(c.throttle * 100)}%`} />
            : <PushPull v={c.throttle} color="#1b1d20" ring="#e9ecef" label="THROTTLE" />}
      </Instrument>
      {ac.controls.mixture && (
        <Instrument title="Mixture" value={c.mixture > 0.97 ? 'Full rich' : c.mixture < 0.05 ? 'Idle cut-off' : 'Leaned'}>
          <PushPull v={c.mixture} color="#d7262e" ring="#e9ecef" label="MIXTURE" ribbed />
        </Instrument>
      )}
      {(() => {
        const prop = propLever(ac, f);
        return prop && (
          <Instrument title="Propeller" value={prop.setting === 'cruise' ? '2,060 RPM' : 'Full forward'}>
            {ac.controls.levers
              ? <Quadrant v={prop.setting === 'cruise' ? 0.62 : 1} handle="#2c6fc9" lo="LOW" hi="HIGH" note="RPM" />
              : <PushPull v={prop.setting === 'cruise' ? 0.72 : 1} color="#2c6fc9" ring="#e9ecef" label="PROP" />}
          </Instrument>
        );
      })()}
      {ac.retractable && (
        <Instrument title="Landing gear" value={c.gear > 0.95 ? 'Down — three green' : c.gear < 0.05 ? 'Up' : 'In transit'}>
          <Gear v={c.gear} />
        </Instrument>
      )}
      <Instrument title="Flaps" value={fl(ac, c.flaps) === 'up' ? 'Up' : fl(ac, c.flaps)}>
        <Flaps deg={c.flaps} detents={ac.flapDetents} labels={ac.flapLabels} />
      </Instrument>
      <Instrument title="Elevator trim" value={c.trim > 0.05 ? 'Nose up' : c.trim < -0.05 ? 'Nose down' : 'Takeoff / neutral'}>
        <Trim v={c.trim} />
      </Instrument>
    </div>
  );
}

function Instrument({ title, value, children }: { title: string; value: string; children: React.ReactNode }) {
  return (
    <figure className="instr">
      <div className="instr-art">{children}</div>
      <figcaption>
        <span className="instr-title">{title}</span>
        <span className="instr-value">{value}</span>
      </figcaption>
    </figure>
  );
}

function Yoke({ ail, elev }: { ail: number; elev: number }) {
  const rot = clamp(ail, -1, 1) * 45;
  // Fore/aft shown as the shaft sliding out of (pull) or into (push) the panel.
  const shaft = 26 + clamp(elev, -1, 1) * 22;
  return (
    <svg viewBox="0 0 160 120">
      <rect x="0" y="92" width="160" height="28" fill="#2a2f35" />
      <rect x="74" y={92 - shaft + 26} width="12" height={shaft} fill="#7d858e" />
      <g transform={`rotate(${rot} 80 52)`}>
        <path d="M28,40 q-6,0 -6,10 v18 q0,8 8,8 h10 q6,0 6,-6 v-16 h68 v16 q0,6 6,6 h10 q8,0 8,-8 v-18 q0,-10 -6,-10 z"
          fill="#1b1d20" stroke="#5a626b" strokeWidth="2" />
        <circle cx="80" cy="52" r="9" fill="#3b4148" />
        <rect x="56" y="38" width="48" height="6" rx="2" fill="#3b4148" />
      </g>
      <text x="152" y="112" textAnchor="end" className="art-note">{elev > 0.04 ? 'pull' : elev < -0.04 ? 'push' : ''}</text>
    </svg>
  );
}

function Stick({ ail, elev }: { ail: number; elev: number }) {
  return (
    <svg viewBox="0 0 160 120">
      <rect x="40" y="10" width="80" height="80" rx="6" fill="#2a2f35" />
      <line x1="80" y1="10" x2="80" y2="90" stroke="#4a525b" />
      <line x1="40" y1="50" x2="120" y2="50" stroke="#4a525b" />
      <circle cx={80 + clamp(ail, -1, 1) * 34} cy={50 + clamp(elev, -1, 1) * 34} r="9" fill="#1b1d20" stroke="#cfd5db" strokeWidth="2" />
      <text x="80" y="108" textAnchor="middle" className="art-note">aft is down</text>
    </svg>
  );
}

function Pedals({ rud }: { rud: number }) {
  const d = clamp(rud, -1, 1) * 18;
  const pedal = (x: number, push: number) => (
    <g transform={`translate(${x} ${44 + push})`}>
      <rect x="-20" y="-24" width="40" height="48" rx="6" fill="#1b1d20" stroke="#5a626b" strokeWidth="2" />
      {[-12, -4, 4, 12].map((y) => <line key={y} x1="-13" x2="13" y1={y} y2={y} stroke="#4a525b" strokeWidth="2" />)}
    </g>
  );
  return (
    <svg viewBox="0 0 160 120">
      <rect x="0" y="96" width="160" height="24" fill="#2a2f35" />
      {/* A pushed pedal moves forward, which reads as up from the seat. */}
      {pedal(48, -Math.max(0, -d))}
      {pedal(112, -Math.max(0, d))}
      <text x="48" y="112" textAnchor="middle" className="art-note">L</text>
      <text x="112" y="112" textAnchor="middle" className="art-note">R</text>
    </svg>
  );
}

function PushPull({ v, color, ring, label, ribbed }: { v: number; color: string; ring: string; label: string; ribbed?: boolean }) {
  // Knob in (toward panel) = more. Drawn from the side: panel on the left.
  const out = (1 - clamp(v, 0, 1)) * 70;
  return (
    <svg viewBox="0 0 160 120">
      <rect x="6" y="20" width="16" height="80" fill="#2a2f35" />
      <rect x="22" y="56" width={20 + out} height="8" fill="#9aa3ad" />
      <g transform={`translate(${42 + out} 60)`}>
        <rect x="0" y="-22" width="34" height="44" rx="8" fill={color} stroke={ring} strokeWidth="2" />
        {ribbed && [-14, -6, 2, 10].map((y) => <line key={y} x1="6" x2="28" y1={y} y2={y} stroke="#7a1015" strokeWidth="3" />)}
      </g>
      <text x="152" y="112" textAnchor="end" className="art-note">{label === 'THROTTLE' ? `${Math.round(v * 100)}%` : ''}</text>
    </svg>
  );
}

function Flaps({ deg, detents, labels }: { deg: number; detents: number[]; labels: string[] }) {
  const max = detents[detents.length - 1] || 30;
  const y = (d: number) => 18 + (d / max) * 80;
  return (
    <svg viewBox="0 0 160 120">
      <rect x="70" y="14" width="10" height="88" rx="3" fill="#2a2f35" />
      {detents.map((d, i) => (
        <g key={d}>
          <line x1="84" x2="98" y1={y(d)} y2={y(d)} stroke="#9aa3ad" strokeWidth="2" />
          <text x="104" y={y(d) + 5} className="art-note">{labels[i] === 'up' ? 'UP' : labels[i]}</text>
        </g>
      ))}
      <g transform={`translate(75 ${y(deg)})`}>
        <rect x="-22" y="-7" width="34" height="14" rx="3" fill="#e9ecef" />
        <path d="M-22,-7 h10 v14 h-10 z" fill="#c9ced3" />
      </g>
    </svg>
  );
}

function Trim({ v }: { v: number }) {
  const off = clamp(v, -1, 1) * 36;
  return (
    <svg viewBox="0 0 160 120">
      <rect x="54" y="14" width="34" height="92" rx="8" fill="#1b1d20" stroke="#5a626b" strokeWidth="2" />
      {Array.from({ length: 9 }, (_, i) => {
        const y = 22 + ((i * 10 + off * 0.9) % 80 + 80) % 80;
        return <line key={i} x1="58" x2="84" y1={y} y2={y} stroke="#4a525b" strokeWidth="3" />;
      })}
      <line x1="100" x2="100" y1="24" y2="96" stroke="#5a626b" strokeWidth="2" />
      <text x="106" y="30" className="art-note">nose dn</text>
      <text x="106" y="98" className="art-note">nose up</text>
      <text x="106" y="64" className="art-note">TO</text>
      <polygon points={`100,${60 + off} 92,${55 + off} 92,${65 + off}`} fill="#2fd7f5" />
    </svg>
  );
}

/**
 * Power quadrant seen from behind and slightly above the seat: each lever slides
 * forward (up the picture) in its slot, and gets a little smaller as it moves away.
 */
const Q_TOP = 22, Q_BOT = 100;                  // slot ends: forward (max) and aft (idle)
function SlotLever({ v, x, handle, tag }: { v: number; x: number; handle: string; tag?: string }) {
  const u = clamp(v, 0, 1);
  const y = Q_BOT - 8 - u * (Q_BOT - Q_TOP - 16);
  const k = 1 - 0.28 * u;                       // perspective: farther is smaller
  const halfTop = 3, halfBot = 5;               // slot narrows toward the panel
  return (
    <g>
      <path d={`M${x - halfTop},${Q_TOP} L${x + halfTop},${Q_TOP} L${x + halfBot},${Q_BOT} L${x - halfBot},${Q_BOT} Z`} fill="#0f1113" />
      {/* Shaft rising out of the slot toward the viewer */}
      <rect x={x - 2.5 * k} y={y} width={5 * k} height={10 * k} fill="#8f98a2" />
      {/* T-handle */}
      <rect x={x - 18 * k} y={y - 11 * k} width={36 * k} height={16 * k} rx={6 * k} fill={handle} stroke="#e9ecef" strokeWidth="1.5" />
      <rect x={x - 13 * k} y={y - 8 * k} width={26 * k} height={3.5 * k} rx={1.5 * k} fill="#ffffff" opacity="0.22" />
      {tag && <text x={x} y={Q_BOT + 15} textAnchor="middle" className="art-note">{tag}</text>}
    </g>
  );
}

function Console({ x0, x1, hi, lo, children }: { x0: number; x1: number; hi: string; lo: string; children: React.ReactNode }) {
  // Console top as a trapezoid: narrower at the far (forward) end.
  const inset = 8;
  return (
    <g>
      <path d={`M${x0 + inset},${Q_TOP - 10} L${x1 - inset},${Q_TOP - 10} L${x1},${Q_BOT + 4} L${x0},${Q_BOT + 4} Z`} fill="#2a2f35" stroke="#3a4148" />
      <text x={x1 + 4} y={Q_TOP + 4} className="art-note">{hi}</text>
      <text x={x1 + 4} y={Q_BOT} className="art-note">{lo}</text>
      {children}
    </g>
  );
}

function Quadrant({ v, handle, lo, hi, note }: { v: number; handle: string; lo: string; hi: string; note?: string }) {
  return (
    <svg viewBox="0 0 160 120">
      <Console x0={46} x1={106} hi={hi} lo={lo}>
        <SlotLever v={v} x={76} handle={handle} />
      </Console>
      {note && <text x={22} y={64} textAnchor="middle" className="art-note">{note}</text>}
    </svg>
  );
}

function TwinLevers({ l, r }: { l: number; r: number }) {
  return (
    <svg viewBox="0 0 160 120">
      <Console x0={30} x1={118} hi="MAX" lo="IDLE">
        <SlotLever v={l} x={57} handle="#1b1d20" tag="L" />
        <SlotLever v={r} x={91} handle="#1b1d20" tag="R" />
      </Console>
    </svg>
  );
}

function Gear({ v }: { v: number }) {
  const down = v > 0.95, up = v < 0.05;
  const lamp = (cx: number, cy: number) => <circle cx={cx} cy={cy} r="7" fill={down ? '#3ddc84' : up ? '#2a2f35' : '#ffb020'} stroke="#5a626b" strokeWidth="1.5" />;
  return (
    <svg viewBox="0 0 160 120">
      <rect x="24" y="16" width="52" height="88" rx="8" fill="#2a2f35" />
      <rect x="46" y="28" width="8" height="64" rx="4" fill="#15171a" />
      <g transform={`translate(50 ${34 + clamp(v, 0, 1) * 52})`}>
        <circle r="11" fill="#e9ecef" stroke="#5a626b" strokeWidth="2" />
        <circle r="4" fill="#5a626b" />
      </g>
      {lamp(116, 40)}{lamp(100, 68)}{lamp(132, 68)}
      <text x="116" y="96" textAnchor="middle" className="art-note">{down ? 'DOWN' : up ? 'UP' : 'TRANSIT'}</text>
    </svg>
  );
}
