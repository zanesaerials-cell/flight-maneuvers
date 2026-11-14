import type { AircraftProfile } from '../data/aircraft';
import type { Frame, ManeuverRun } from '../engine/types';
import { angDiff, clamp, wrap360 } from '../engine/kinematics';
import { aoaFraction, rotax } from './engine';

/**
 * G3X Touch-style primary flight display, drawn in SVG, as in the P-Mentor:
 * engine indication strip on the left, attitude with airspeed and altitude
 * tapes, angle-of-attack indicator, arc HSI along the bottom and a touch bar.
 * A teaching rendering, not a replica.
 */
const W = 800, H = 640;
const EIS = 158;                         // width of the engine strip
const CX = 478, CY = 250;               // attitude centre
const PPD = 7;
const C = {
  sky: '#1f6fd8', skyTop: '#0b3e98', ground: '#83582a', groundLow: '#5b3a19',
  white: '#ffffff', cyan: '#33e0ff', magenta: '#ff40ff', yellow: '#ffe14d', green: '#25d366',
  amber: '#ffb000', red: '#ff3030', grey: '#a9b1ba', dim: '#6c7680', panel: '#1b1e22', tape: 'rgba(0,0,0,0.42)',
};
const FONT = "'Barlow Semi Condensed', 'Arial Narrow', sans-serif";

export function G3XPFD({ f, run, ac }: { f: Frame; run: ManeuverRun; ac: AircraftProfile }) {
  const e = rotax(ac, f);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="pfd" role="img" fontFamily={FONT}
      aria-label={`G3X Touch PFD: ${Math.round(f.ias)} knots, ${Math.round(f.altFt)} feet, heading ${Math.round(f.heading)}, ${e.mp.toFixed(1)} inches manifold pressure, ${e.engineRpm} RPM`}>
      <defs>
        <clipPath id="g3-screen"><rect x="0" y="0" width={W} height={H} rx="6" /></clipPath>
        <clipPath id="g3-adi"><rect x={EIS} y="34" width={W - EIS} height={H - 34 - 40} /></clipPath>
        <clipPath id="g3-ladder"><rect x={CX - 120} y={CY - 120} width="240" height="215" /></clipPath>
        <linearGradient id="g3-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={C.skyTop} /><stop offset="1" stopColor={C.sky} />
        </linearGradient>
        <linearGradient id="g3-gnd" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={C.ground} /><stop offset="1" stopColor={C.groundLow} />
        </linearGradient>
      </defs>
      <g clipPath="url(#g3-screen)">
        <rect x="0" y="0" width={W} height={H} fill="#000" />
        <g clipPath="url(#g3-adi)">
          <Attitude f={f} />
          <Aoa ac={ac} f={f} />
          <AirspeedTape f={f} ac={ac} target={run.bugs.ias} />
          <AltitudeTape f={f} target={run.bugs.altitudeFt} />
          <ArcHsi f={f} bug={run.bugs.heading} />
          {f.warn && (
            <g>
              <rect x={CX - 50} y={44} width="100" height="28" rx="3" fill={C.red} />
              <text x={CX} y={65} fill="#fff" fontSize="20" fontWeight="700" textAnchor="middle" letterSpacing="2">{f.warn}</text>
            </g>
          )}
        </g>
        <TopBar f={f} run={run} wind={run.scene.wind} />
        <Eis e={e} />
        <TouchBar ac={ac} />
      </g>
    </svg>
  );
}

// ── Top data bar ─────────────────────────────────────────────────────────────
function TopBar({ f, run, wind }: { f: Frame; run: ManeuverRun; wind?: { fromDeg: number; kt: number } }) {
  const field = (x: number, label: string, value: string, color = C.magenta) => (
    <g>
      <text x={x} y="22" fill={C.grey} fontSize="13">{label}</text>
      <text x={x + label.length * 7 + 6} y="23" fill={color} fontSize="17" fontWeight="600">{value}</text>
    </g>
  );
  return (
    <g>
      <rect x="0" y="0" width={W} height="34" fill={C.panel} />
      <line x1="0" x2={W} y1="34" y2="34" stroke="#3a4048" />
      {field(EIS + 10, 'GS', `${Math.round(f.gs)}kt`, C.white)}
      {field(EIS + 100, 'TRK', `${String(Math.round(f.track) || 360).padStart(3, '0')}°`)}
      <text x={W / 2 + EIS / 2} y="22" fill={C.white} fontSize="14" textAnchor="middle">{run.title}</text>
      {wind
        ? field(W - 160, 'WIND', `${String(wind.fromDeg).padStart(3, '0')}°/${wind.kt}`, C.white)
        : field(W - 160, 'TAS', `${Math.round(f.tas)}kt`, C.white)}
      <text x={W - 10} y="23" fill={C.magenta} fontSize="14" textAnchor="end">{run.acsCode}</text>
    </g>
  );
}

// ── Engine indication strip (Rotax 912 iSc) ──────────────────────────────────
function Eis({ e }: { e: ReturnType<typeof rotax> }) {
  const x0 = 0, w = EIS;
  return (
    <g>
      <rect x={x0} y="34" width={w} height={H - 34} fill={C.panel} />
      <line x1={w} x2={w} y1="34" y2={H} stroke="#3a4048" />
      <ArcGauge cx={w / 2} cy={104} label="RPM" value={e.engineRpm} text={e.engineRpm.toLocaleString()} min={0} max={6000}
        bands={[[1400, 5500, C.green], [5500, 5800, C.amber], [5800, 6000, C.red]]} />
      <ArcGauge cx={w / 2} cy={232} label="MAN IN" value={e.mp} text={e.mp.toFixed(1)} min={10} max={30}
        bands={[[10, 27.5, C.green], [27.5, 30, C.amber]]} />
      <BarGauge y={304} label="FF GPH" value={e.fuelFlow} text={e.fuelFlow.toFixed(1)} min={0} max={8} bands={[[0, 7.5, C.green]]} />
      <BarGauge y={342} label="OIL PSI" value={e.oilPressPsi} text={String(e.oilPressPsi)} min={0} max={102} bands={[[0, 12, C.red], [12, 29, C.amber], [29, 73, C.green], [73, 102, C.amber]]} />
      <BarGauge y={380} label="OIL °C" value={e.oilTempC} text={String(e.oilTempC)} min={40} max={140} bands={[[40, 50, C.amber], [50, 110, C.green], [110, 130, C.amber], [130, 140, C.red]]} />
      <BarGauge y={418} label="CLT °C" value={e.coolantC} text={String(e.coolantC)} min={40} max={130} bands={[[40, 50, C.amber], [50, 110, C.green], [110, 120, C.amber], [120, 130, C.red]]} />
      <BarGauge y={456} label="VOLTS" value={e.volts} text={e.volts.toFixed(1)} min={10} max={16} bands={[[10, 12, C.amber], [12, 14.8, C.green], [14.8, 16, C.amber]]} />
      <text x={10} y={500} fill={C.grey} fontSize="13">FUEL GAL</text>
      {[0, 1].map((i) => (
        <g key={i}>
          <rect x={20 + i * 70} y={508} width="46" height="56" fill="#000" stroke="#444" />
          <rect x={22 + i * 70} y={516} width="42" height="46" fill={C.green} opacity="0.85" />
          <text x={43 + i * 70} y={584} fill={C.white} fontSize="15" textAnchor="middle">{i ? 'R 11' : 'L 11'}</text>
        </g>
      ))}
    </g>
  );
}

function ArcGauge({ cx, cy, label, value, text, min, max, bands }: {
  cx: number; cy: number; label: string; value: number; text: string; min: number; max: number; bands: [number, number, string][];
}) {
  const r = 46, a0 = -120, a1 = 120;
  const ang = (v: number) => a0 + ((clamp(v, min, max) - min) / (max - min)) * (a1 - a0);
  const needle = polar(cx, cy, r - 4, ang(value));
  return (
    <g>
      {bands.map(([lo, hi, col], i) => (
        <path key={i} d={describeArc(cx, cy, r, ang(lo), ang(hi))} fill="none" stroke={col} strokeWidth="7" />
      ))}
      <line x1={cx} y1={cy} x2={needle.x} y2={needle.y} stroke={C.white} strokeWidth="3" />
      <circle cx={cx} cy={cy} r="4" fill={C.white} />
      <text x={cx} y={cy - r - 10} fill={C.grey} fontSize="13" textAnchor="middle">{label}</text>
      <rect x={cx - 34} y={cy + 14} width="68" height="24" fill="#000" stroke="#555" />
      <text x={cx} y={cy + 32} fill={C.white} fontSize="18" fontWeight="600" textAnchor="middle">{text}</text>
    </g>
  );
}

function BarGauge({ y, label, value, text, min, max, bands }: {
  y: number; label: string; value: number; text: string; min: number; max: number; bands: [number, number, string][];
}) {
  const x = 10, w = 100;
  const px = (v: number) => x + ((clamp(v, min, max) - min) / (max - min)) * w;
  return (
    <g>
      <text x={x} y={y} fill={C.grey} fontSize="12">{label}</text>
      <text x={EIS - 8} y={y + 1} fill={C.white} fontSize="16" fontWeight="600" textAnchor="end">{text}</text>
      {bands.map(([lo, hi, col], i) => <rect key={i} x={px(lo)} y={y + 8} width={Math.max(0, px(hi) - px(lo))} height="6" fill={col} />)}
      <polygon points={`${px(value)},${y + 7} ${px(value) - 6},${y - 3} ${px(value) + 6},${y - 3}`} fill={C.white} />
    </g>
  );
}

// ── Attitude ─────────────────────────────────────────────────────────────────
function Attitude({ f }: { f: Frame }) {
  const ladder = [];
  for (let p = -30; p <= 30; p += 2.5) {
    if (p === 0) continue;
    const y = -p * PPD;
    const major = p % 10 === 0, mid = p % 5 === 0;
    const w = major ? 80 : mid ? 40 : 20;
    ladder.push(
      <g key={p}>
        <line x1={CX - w / 2} x2={CX + w / 2} y1={CY + y} y2={CY + y} stroke={C.white} strokeWidth="2" />
        {major && <>
          <text x={CX - w / 2 - 8} y={CY + y + 6} fill={C.white} fontSize="17" textAnchor="end">{Math.abs(p)}</text>
          <text x={CX + w / 2 + 8} y={CY + y + 6} fill={C.white} fontSize="17">{Math.abs(p)}</text>
        </>}
      </g>,
    );
  }
  const R = 140;
  const slipX = clamp(f.slip, -1, 1) * 16;
  return (
    <g>
      <g transform={`rotate(${-f.bank} ${CX} ${CY})`}>
        <g transform={`translate(0 ${f.pitch * PPD})`}>
          <rect x={-900} y={CY - 2000} width={2600} height={2000} fill="url(#g3-sky)" />
          <rect x={-900} y={CY} width={2600} height={2000} fill="url(#g3-gnd)" />
          <line x1={-900} x2={1700} y1={CY} y2={CY} stroke={C.white} strokeWidth="2.5" />
        </g>
        <g clipPath="url(#g3-ladder)"><g transform={`translate(0 ${f.pitch * PPD})`}>{ladder}</g></g>
        <path d={describeArc(CX, CY, R, -60, 60)} fill="none" stroke={C.white} strokeWidth="2" />
        {[10, 20, 30, 45, 60].flatMap((a) => [-a, a]).map((a) => {
          const p1 = polar(CX, CY, R, a), p2 = polar(CX, CY, R + (a % 30 === 0 ? 18 : 10), a);
          return <line key={a} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={C.white} strokeWidth="2.5" />;
        })}
        <polygon points={`${CX},${CY - R} ${CX - 10},${CY - R - 15} ${CX + 10},${CY - R - 15}`} fill={C.white} />
      </g>
      <polygon points={`${CX},${CY - R + 2} ${CX - 10},${CY - R + 17} ${CX + 10},${CY - R + 17}`} fill={C.white} />
      <rect x={CX - 12 + slipX} y={CY - R + 20} width="24" height="6" fill={C.white} />
      {/* Single-cue aircraft symbol */}
      <g fill={C.yellow} stroke="#000" strokeWidth="1.5">
        <polygon points={`${CX},${CY} ${CX - 74},${CY + 30} ${CX - 44},${CY + 30} ${CX},${CY + 12} ${CX + 44},${CY + 30} ${CX + 74},${CY + 30}`} />
      </g>
    </g>
  );
}

// ── Angle of attack ──────────────────────────────────────────────────────────
function Aoa({ ac, f }: { ac: AircraftProfile; f: Frame }) {
  const x = 300, top = 150, h = 120;
  const a = aoaFraction(ac, f);
  const y = top + h - clamp(a, 0, 1.1) / 1.1 * h;
  const zone = (from: number, to: number, col: string) => (
    <rect x={x} y={top + h - (to / 1.1) * h} width="10" height={((to - from) / 1.1) * h} fill={col} opacity="0.9" />
  );
  return (
    <g>
      <text x={x + 5} y={top - 6} fill={C.white} fontSize="12" textAnchor="middle">AOA</text>
      {zone(0, 0.6, C.green)}
      {zone(0.6, 0.85, C.yellow)}
      {zone(0.85, 1.1, C.red)}
      <polygon points={`${x + 12},${y} ${x + 24},${y - 7} ${x + 24},${y + 7}`} fill={C.white} stroke="#000" strokeWidth="1" />
    </g>
  );
}

// ── Tapes ────────────────────────────────────────────────────────────────────
function AirspeedTape({ f, ac, target }: { f: Frame; ac: AircraftProfile; target?: number }) {
  const x = EIS + 14, w = 84, top = 60, bottom = 440, mid = (top + bottom) / 2;
  const ppk = 5;
  const y = (k: number) => mid - (k - f.ias) * ppk;
  const ticks = [];
  for (let k = Math.max(20, Math.floor((f.ias - 40) / 5) * 5); k <= f.ias + 40; k += 5) {
    ticks.push(
      <g key={k}>
        <line x1={x + w - (k % 10 === 0 ? 16 : 9)} x2={x + w} y1={y(k)} y2={y(k)} stroke={C.white} strokeWidth="2" />
        {k % 10 === 0 && <text x={x + w - 22} y={y(k) + 6} fill={C.white} fontSize="19" textAnchor="end">{k}</text>}
      </g>,
    );
  }
  const band = (a: number, b: number, col: string, xo: number, wd: number) => (
    <rect x={x + w + xo} y={y(b)} width={wd} height={Math.max(0, y(a) - y(b))} fill={col} />
  );
  const { arcs } = ac;
  return (
    <g>
      <defs><clipPath id="g3-spd"><rect x={x} y={top} width={w + 14} height={bottom - top} /></clipPath></defs>
      <rect x={x} y={top} width={w} height={bottom - top} fill={C.tape} />
      <g clipPath="url(#g3-spd)">
        {ticks}
        {band(arcs.whiteLow, arcs.whiteHigh, C.white, 0, 5)}
        {band(arcs.greenLow, arcs.greenHigh, C.green, 5, 6)}
        {band(arcs.greenHigh, arcs.yellowHigh, C.yellow, 5, 6)}
        {band(arcs.yellowHigh, arcs.yellowHigh + 60, C.red, 0, 11)}
        {target && <polygon points={`${x + w},${y(target)} ${x + w + 12},${y(target) - 8} ${x + w + 12},${y(target) + 8}`} fill={C.cyan} />}
      </g>
      <Readout x={x + 4} y={mid} w={72} text={String(Math.round(f.ias))} />
      <rect x={x} y={bottom} width={w} height="26" fill="#000" />
      <text x={x + 6} y={bottom + 19} fill={C.grey} fontSize="13">TAS</text>
      <text x={x + w - 6} y={bottom + 19} fill={C.white} fontSize="16" textAnchor="end">{Math.round(f.tas)}kt</text>
    </g>
  );
}

function AltitudeTape({ f, target }: { f: Frame; target: number }) {
  const x = 668, w = 88, top = 72, bottom = 440, mid = (top + bottom) / 2;
  const ppf = 0.55;
  const y = (a: number) => mid - (a - f.altFt) * ppf;
  const ticks = [];
  for (let a = Math.floor((f.altFt - 400) / 20) * 20; a <= f.altFt + 400; a += 20) {
    const major = a % 100 === 0;
    ticks.push(
      <g key={a}>
        <line x1={x} x2={x + (major ? 16 : 8)} y1={y(a)} y2={y(a)} stroke={C.white} strokeWidth="2" />
        {major && <text x={x + 21} y={y(a) + 6} fill={C.white} fontSize="18">{a}</text>}
      </g>,
    );
  }
  // VSI built into the right edge of the tape, as on the G3X.
  const vx = x + w + 2, vs = (v: number) => mid - clamp(v, -2000, 2000) / 2000 * 150;
  return (
    <g>
      <defs><clipPath id="g3-alt"><rect x={x - 12} y={top} width={w + 12} height={bottom - top} /></clipPath></defs>
      <rect x={x} y={top} width={w} height={bottom - top} fill={C.tape} />
      <g clipPath="url(#g3-alt)">
        {ticks}
        <path d={`M${x},${y(target) - 12} h10 v8 l-6,4 l6,4 v8 h-10 z`} fill={C.cyan} />
      </g>
      <rect x={x} y={top - 30} width={w} height="27" fill="#000" stroke={C.cyan} strokeWidth="1" />
      <text x={x + w / 2} y={top - 10} fill={C.cyan} fontSize="18" textAnchor="middle">{target}</text>
      <Readout x={x + 10} y={mid} w={80} text={String(Math.round(f.altFt / 10) * 10)} left />
      <rect x={vx} y={mid - 150} width="34" height="300" fill={C.tape} />
      {[-2000, -1000, 0, 1000, 2000].map((v) => (
        <line key={v} x1={vx} x2={vx + 8} y1={vs(v)} y2={vs(v)} stroke={C.white} strokeWidth="2" />
      ))}
      <line x1={vx + 2} x2={vx + 2} y1={mid} y2={vs(f.vsi)} stroke={C.magenta} strokeWidth="5" />
      <text x={vx + 17} y={vs(f.vsi) + (f.vsi >= 0 ? -6 : 16)} fill={C.white} fontSize="12" textAnchor="middle">{Math.abs(Math.round(f.vsi / 50) * 50) || ''}</text>
      <rect x={x} y={bottom} width={w} height="26" fill="#000" />
      <text x={x + w / 2} y={bottom + 19} fill={C.cyan} fontSize="16" textAnchor="middle">29.92in</text>
    </g>
  );
}

// ── Arc HSI ──────────────────────────────────────────────────────────────────
function ArcHsi({ f, bug }: { f: Frame; bug: number }) {
  const cx = CX, cy = 700, r = 196;
  const marks = [];
  for (let d = 0; d < 360; d += 5) {
    const a = angDiff(f.heading, d);
    if (Math.abs(a) > 62) continue;
    const long = d % 10 === 0;
    const p1 = polar(cx, cy, r, a), p2 = polar(cx, cy, r - (long ? 14 : 8), a);
    marks.push(<line key={d} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={C.white} strokeWidth="2" />);
    if (d % 30 === 0) {
      const p = polar(cx, cy, r - 30, a);
      const label = ({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' } as Record<number, string>)[d] ?? String(d / 10);
      marks.push(<text key={`t${d}`} x={p.x} y={p.y + 7} fill={C.white} fontSize="18" textAnchor="middle" transform={`rotate(${a} ${p.x} ${p.y})`}>{label}</text>);
    }
  }
  const bugA = clamp(angDiff(f.heading, bug), -64, 64);
  const trackA = clamp(angDiff(f.heading, f.track), -64, 64);
  const hdg = String(Math.round(wrap360(f.heading)) || 360).padStart(3, '0');
  return (
    <g>
      <path d={`${describeArc(cx, cy, r + 4, -64, 64)} L${cx},${cy} Z`} fill="rgba(0,0,0,0.55)" />
      {marks}
      <g transform={`rotate(${bugA} ${cx} ${cy})`}>
        <path d={`M${cx - 10},${cy - r - 1} v-9 h6 l4,6 l4,-6 h6 v9 z`} fill={C.cyan} />
      </g>
      <g transform={`rotate(${trackA} ${cx} ${cy})`}>
        <path d={`M${cx},${cy - r + 16} l-6,10 h12 z`} fill={C.magenta} />
      </g>
      <rect x={cx - 34} y={cy - r - 38} width="68" height="28" fill="#000" stroke={C.white} strokeWidth="1.5" />
      <text x={cx} y={cy - r - 17} fill={C.white} fontSize="19" textAnchor="middle">{hdg}°</text>
      <text x={cx - 150} y={cy - r + 30} fill={C.grey} fontSize="13">HDG</text>
      <text x={cx - 116} y={cy - r + 31} fill={C.cyan} fontSize="16">{String(bug).padStart(3, '0')}°</text>
    </g>
  );
}

// ── Touch bar ────────────────────────────────────────────────────────────────
function TouchBar({ ac }: { ac: AircraftProfile }) {
  const tabs = ['PFD', 'Map', 'Engine', 'Info', 'Menu'];
  const x0 = EIS + 6, w = (W - EIS - 12) / tabs.length;
  return (
    <g>
      <rect x={EIS} y={H - 40} width={W - EIS} height="40" fill={C.panel} />
      {tabs.map((t, i) => (
        <g key={t}>
          <rect x={x0 + i * w + 3} y={H - 34} width={w - 6} height="28" rx="4" fill={i === 0 ? '#2c3a4a' : '#24282d'} stroke={i === 0 ? C.cyan : '#3a4048'} />
          <text x={x0 + i * w + w / 2} y={H - 15} fill={i === 0 ? C.white : C.grey} fontSize="14" textAnchor="middle">{t}</text>
        </g>
      ))}
      <text x={EIS / 2} y={H - 14} fill={C.dim} fontSize="12" textAnchor="middle">{ac.shortName} · G3X</text>
    </g>
  );
}

function Readout({ x, y, w, text, left }: { x: number; y: number; w: number; text: string; left?: boolean }) {
  const h = 42;
  const d = left
    ? `M${x - 12},${y} l12,-10 v-${h / 2 - 10} h${w} v${h} h-${w} v-${h / 2 - 10} z`
    : `M${x},${y - h / 2} h${w} v${h / 2 - 10} l12,10 l-12,10 v${h / 2 - 10} h-${w} z`;
  return (
    <g>
      <path d={d} fill="#000" stroke={C.white} strokeWidth="1.5" />
      <text x={x + w / 2} y={y + 9} fill={C.white} fontSize="27" textAnchor="middle" fontWeight="600">{text}</text>
    </g>
  );
}

function polar(cx: number, cy: number, r: number, deg: number) {
  const a = (deg - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}
function describeArc(cx: number, cy: number, r: number, a0: number, a1: number) {
  if (Math.abs(a1 - a0) < 0.01) return '';
  const p0 = polar(cx, cy, r, a0), p1 = polar(cx, cy, r, a1);
  return `M${p0.x},${p0.y} A${r},${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${p1.x},${p1.y}`;
}
