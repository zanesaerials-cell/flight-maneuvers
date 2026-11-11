import type { AircraftProfile } from '../data/aircraft';
import type { Frame, ManeuverRun } from '../engine/types';
import { angDiff, clamp, wrap360 } from '../engine/kinematics';

/**
 * G1000-style primary flight display, drawn in SVG.
 * Proportions and colours follow the G1000 PFD; it is a teaching rendering,
 * not a replica. Cyan = selected values / training targets, magenta = trend.
 */
const W = 800, H = 640;
const CX = 400, CY = 236;      // attitude centre
const PPD = 7;                 // pixels per degree of pitch
const C = {
  sky: '#2f6fd6', ground: '#8a5a2b', white: '#ffffff', cyan: '#2fd7f5', magenta: '#ff3df0',
  yellow: '#ffe600', green: '#22c55e', tape: 'rgba(40,44,52,0.62)', black: '#000', grey: '#9aa3ad',
};

export function G1000PFD({ f, run, ac }: { f: Frame; run: ManeuverRun; ac: AircraftProfile }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="pfd" role="img"
      aria-label={`PFD: ${Math.round(f.ias)} knots, ${Math.round(f.altFt)} feet, heading ${Math.round(f.heading)}, bank ${Math.round(f.bank)} degrees`}>
      <defs>
        <clipPath id="screen"><rect x="0" y="0" width={W} height={H} rx="6" /></clipPath>
        <clipPath id="ladder"><rect x={CX - 130} y={CY - 125} width="260" height="225" /></clipPath>
      </defs>
      <g clipPath="url(#screen)">
        <Attitude f={f} />
        <AirspeedTape f={f} ac={ac} target={run.bugs.ias} />
        <AltitudeTape f={f} target={run.bugs.altitudeFt} />
        <VSI f={f} />
        <HSI f={f} bug={run.bugs.heading} wind={run.scene.wind} />
        <TopBar ac={ac} run={run} />
        {f.warn && (
          <g>
            <rect x={CX - 52} y={44} width="104" height="30" rx="3" fill="#d1121b" />
            <text x={CX} y={66} fill="#fff" fontSize="20" fontWeight="700" textAnchor="middle" letterSpacing="2">{f.warn}</text>
          </g>
        )}
      </g>
    </svg>
  );
}

function TopBar({ ac, run }: { ac: AircraftProfile; run: ManeuverRun }) {
  return (
    <g>
      <rect x="0" y="0" width={W} height="30" fill="#14171b" />
      <text x="14" y="21" fill={C.grey} fontSize="15">{ac.shortName}</text>
      <text x={CX} y="21" fill={C.white} fontSize="15" textAnchor="middle">{run.title}</text>
      <text x={W - 14} y="21" fill={C.magenta} fontSize="15" textAnchor="end">{run.acsCode}</text>
    </g>
  );
}

function Attitude({ f }: { f: Frame }) {
  const ladder = [];
  for (let p = -30; p <= 30; p += 2.5) {
    if (p === 0) continue;
    const y = -p * PPD;
    const major = p % 10 === 0, mid = p % 5 === 0;
    const w = major ? 70 : mid ? 36 : 18;
    ladder.push(
      <g key={p}>
        <line x1={CX - w / 2} x2={CX + w / 2} y1={CY + y} y2={CY + y} stroke={C.white} strokeWidth="2" />
        {major && <>
          <text x={CX - w / 2 - 8} y={CY + y + 6} fill={C.white} fontSize="16" textAnchor="end">{Math.abs(p)}</text>
          <text x={CX + w / 2 + 8} y={CY + y + 6} fill={C.white} fontSize="16">{Math.abs(p)}</text>
        </>}
      </g>,
    );
  }
  const rollTicks = [10, 20, 30, 45, 60];
  const R = 150;
  const slipX = clamp(f.slip, -1, 1) * 14;

  return (
    <g>
      {/* Background and ladder rotate with bank and slide with pitch */}
      <g transform={`rotate(${-f.bank} ${CX} ${CY})`}>
        <g transform={`translate(0 ${f.pitch * PPD})`}>
          <rect x={-800} y={CY - 2000} width={2400} height={2000} fill={C.sky} />
          <rect x={-800} y={CY} width={2400} height={2000} fill={C.ground} />
          <line x1={-800} x2={1600} y1={CY} y2={CY} stroke={C.white} strokeWidth="2" />
        </g>
        <g clipPath="url(#ladder)">
          <g transform={`translate(0 ${f.pitch * PPD})`}>{ladder}</g>
        </g>
        {/* Roll scale moves with the horizon (sky pointer) */}
        <path d={describeArc(CX, CY, R, -60, 60)} fill="none" stroke={C.white} strokeWidth="2" />
        {rollTicks.flatMap((a) => [-a, a]).map((a) => {
          const long = a % 30 === 0;
          const r2 = R + (long ? 20 : 11);
          if (Math.abs(a) === 45) {
            const p = polar(CX, CY, R, a);
            return <polygon key={a} points={triangle(p, a, 9, true)} fill="none" stroke={C.white} strokeWidth="2" />;
          }
          const p1 = polar(CX, CY, R, a), p2 = polar(CX, CY, r2, a);
          return <line key={a} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={C.white} strokeWidth="2.5" />;
        })}
        <polygon points={triangle(polar(CX, CY, R, 0), 0, 11, true)} fill={C.white} />
      </g>
      {/* Fixed roll pointer and slip/skid trapezoid */}
      <polygon points={`${CX},${CY - R + 2} ${CX - 11},${CY - R + 19} ${CX + 11},${CY - R + 19}`} fill={C.white} />
      <polygon points={`${CX - 12 + slipX},${CY - R + 22} ${CX + 12 + slipX},${CY - R + 22} ${CX + 15 + slipX},${CY - R + 28} ${CX - 15 + slipX},${CY - R + 28}`} fill={C.white} />
      {/* Aircraft symbol */}
      <g fill={C.yellow} stroke="#000" strokeWidth="1.5">
        <polygon points={`${CX},${CY} ${CX - 62},${CY + 26} ${CX - 40},${CY + 26} ${CX},${CY + 10} ${CX + 40},${CY + 26} ${CX + 62},${CY + 26}`} />
        <rect x={CX - 150} y={CY - 4} width="52" height="8" />
        <rect x={CX + 98} y={CY - 4} width="52" height="8" />
      </g>
    </g>
  );
}

function AirspeedTape({ f, ac, target }: { f: Frame; ac: AircraftProfile; target?: number }) {
  const x = 70, w = 96, top = 50, bottom = 420, mid = (top + bottom) / 2;
  const ppk = 5;
  const y = (k: number) => mid - (k - f.ias) * ppk;
  const ticks = [];
  const lo = Math.floor((f.ias - 40) / 5) * 5, hi = f.ias + 40;
  for (let k = Math.max(20, lo); k <= hi; k += 5) {
    ticks.push(
      <g key={k}>
        <line x1={x + w - (k % 10 === 0 ? 18 : 10)} x2={x + w} y1={y(k)} y2={y(k)} stroke={C.white} strokeWidth="2" />
        {k % 10 === 0 && <text x={x + w - 24} y={y(k) + 6} fill={C.white} fontSize="18" textAnchor="end">{k}</text>}
      </g>,
    );
  }
  const band = (a: number, b: number, color: string, xo: number, wd: number) => (
    <rect x={x + w + xo} y={y(b)} width={wd} height={Math.max(0, y(a) - y(b))} fill={color} />
  );
  const { arcs } = ac;
  const trend = clamp(f.ias + 0, f.ias - 30, f.ias + 30);
  return (
    <g>
      <defs><clipPath id="spd"><rect x={x} y={top} width={w + 14} height={bottom - top} /></clipPath></defs>
      <rect x={x} y={top} width={w} height={bottom - top} fill={C.tape} />
      <g clipPath="url(#spd)">
        {ticks}
        {band(arcs.whiteLow, arcs.whiteHigh, C.white, 0, 4)}
        {band(arcs.greenLow, arcs.greenHigh, C.green, 4, 6)}
        {band(arcs.greenHigh, arcs.yellowHigh, C.yellow, 4, 6)}
        {band(arcs.yellowHigh, arcs.yellowHigh + 60, '#ff2a2a', 0, 10)}
        {target && <polygon points={`${x + w},${y(target)} ${x + w + 12},${y(target) - 8} ${x + w + 12},${y(target) + 8}`} fill={C.cyan} />}
        <line x1={x + w - 2} x2={x + w - 2} y1={mid} y2={y(trend)} stroke={C.magenta} strokeWidth="3" />
      </g>
      <Readout x={x + 8} y={mid} w={78} text={String(Math.round(f.ias))} />
      <rect x={x} y={bottom} width={w} height="28" fill="#000" />
      <text x={x + 6} y={bottom + 20} fill={C.white} fontSize="13">TAS</text>
      <text x={x + w - 6} y={bottom + 20} fill={C.white} fontSize="16" textAnchor="end">{Math.round(f.tas)}KT</text>
    </g>
  );
}

function AltitudeTape({ f, target }: { f: Frame; target: number }) {
  const x = 610, w = 100, top = 66, bottom = 420, mid = (top + bottom) / 2;
  const ppf = 0.55;
  const y = (a: number) => mid - (a - f.altFt) * ppf;
  const ticks = [];
  for (let a = Math.floor((f.altFt - 400) / 20) * 20; a <= f.altFt + 400; a += 20) {
    const major = a % 100 === 0;
    ticks.push(
      <g key={a}>
        <line x1={x} x2={x + (major ? 18 : 9)} y1={y(a)} y2={y(a)} stroke={C.white} strokeWidth="2" />
        {major && <text x={x + 24} y={y(a) + 6} fill={C.white} fontSize="18">{a}</text>}
      </g>,
    );
  }
  return (
    <g>
      <defs><clipPath id="alt"><rect x={x - 12} y={top} width={w + 12} height={bottom - top} /></clipPath></defs>
      <rect x={x} y={top} width={w} height={bottom - top} fill={C.tape} />
      <g clipPath="url(#alt)">
        {ticks}
        {/* ACS band and selected-altitude bug */}
        <rect x={x - 6} y={y(target + 100)} width="5" height={200 * ppf} fill={C.cyan} opacity="0.55" />
        <path d={`M${x},${y(target) - 12} h10 v8 l-6,4 l6,4 v8 h-10 z`} fill={C.cyan} />
      </g>
      <rect x={x} y={top - 30} width={w} height="28" fill="#000" />
      <text x={x + w / 2} y={top - 9} fill={C.cyan} fontSize="18" textAnchor="middle">{target}FT</text>
      <Readout x={x + 10} y={mid} w={88} text={String(Math.round(f.altFt / 10) * 10)} left />
      <rect x={x} y={bottom} width={w} height="28" fill="#000" />
      <text x={x + w / 2} y={bottom + 20} fill={C.cyan} fontSize="17" textAnchor="middle">29.92IN</text>
    </g>
  );
}

function VSI({ f }: { f: Frame }) {
  const x = 716, top = 90, bottom = 380, mid = (top + bottom) / 2;
  const s = (v: number) => mid - clamp(v, -2000, 2000) / 2000 * (mid - top);
  return (
    <g>
      <path d={`M${x},${top} h30 v${bottom - top} h-30 l-6,-20 v${-(bottom - top) + 40} z`} fill={C.tape} />
      {[-2000, -1000, 0, 1000, 2000].map((v) => (
        <g key={v}>
          <line x1={x} x2={x + 10} y1={s(v)} y2={s(v)} stroke={C.white} strokeWidth="2" />
          {v !== 0 && <text x={x + 13} y={s(v) + 5} fill={C.white} fontSize="13">{Math.abs(v) / 1000}</text>}
        </g>
      ))}
      <polygon points={`${x + 2},${s(f.vsi)} ${x + 20},${s(f.vsi) - 10} ${x + 52},${s(f.vsi) - 10} ${x + 52},${s(f.vsi) + 10} ${x + 20},${s(f.vsi) + 10}`} fill="#000" stroke={C.white} strokeWidth="1.5" />
      <text x={x + 36} y={s(f.vsi) + 5} fill={C.white} fontSize="12" textAnchor="middle">{Math.abs(Math.round(f.vsi / 50) * 50) || ''}</text>
    </g>
  );
}

function HSI({ f, bug, wind }: { f: Frame; bug: number; wind?: { fromDeg: number; kt: number } }) {
  const cx = CX, cy = 532, r = 112;
  const marks = [];
  for (let d = 0; d < 360; d += 5) {
    const long = d % 10 === 0;
    const a = d - f.heading;
    const p1 = polar(cx, cy, r, a), p2 = polar(cx, cy, r - (long ? 14 : 8), a);
    marks.push(<line key={d} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={C.white} strokeWidth="2" />);
    if (d % 30 === 0) {
      const p = polar(cx, cy, r - 30, a);
      const label = ({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' } as Record<number, string>)[d] ?? String(d / 10);
      marks.push(<text key={`t${d}`} x={p.x} y={p.y + 7} fill={C.white} fontSize="19" textAnchor="middle" transform={`rotate(${a} ${p.x} ${p.y})`}>{label}</text>);
    }
  }
  const bugA = angDiff(f.heading, bug);
  const trendDeg = clamp(f.turnRate * 6, -100, 100);
  const hdg = String(Math.round(wrap360(f.heading)) || 360).padStart(3, '0');
  // Arrow drawn pointing down = wind blowing toward the tail; rotate to the relative direction.
  const windRel = wind ? (wind.fromDeg + 180 - f.heading) - 180 : 0;
  return (
    <g>
      <circle cx={cx} cy={cy} r={r + 2} fill="rgba(25,28,33,0.78)" />
      {marks}
      {/* Turn-rate trend: magenta arc showing heading in 6 seconds */}
      <path d={describeArc(cx, cy, r + 9, Math.min(0, trendDeg), Math.max(0, trendDeg))} fill="none" stroke={C.magenta} strokeWidth="5" />
      {[-18, 18].map((a) => { const p1 = polar(cx, cy, r + 4, a), p2 = polar(cx, cy, r + 15, a); return <line key={a} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={C.white} strokeWidth="2" />; })}
      {/* Heading bug */}
      <g transform={`rotate(${bugA} ${cx} ${cy})`}>
        <path d={`M${cx - 10},${cy - r - 1} v-9 h6 l4,6 l4,-6 h6 v9 z`} fill={C.cyan} />
      </g>
      {/* Aircraft and lubber line */}
      <path d={`M${cx},${cy - 22} l5,10 v8 l18,8 v6 l-18,-4 v12 l7,5 v4 l-12,-3 l-12,3 v-4 l7,-5 v-12 l-18,4 v-6 l18,-8 v-8 z`} fill={C.white} />
      <rect x={cx - 36} y={cy - r - 44} width="72" height="30" fill="#000" stroke={C.white} strokeWidth="1.5" />
      <text x={cx} y={cy - r - 22} fill={C.white} fontSize="20" textAnchor="middle">{hdg}°</text>
      <polygon points={`${cx},${cy - r + 2} ${cx - 7},${cy - r - 12} ${cx + 7},${cy - r - 12}`} fill={C.white} />
      {/* Heading-bug readout */}
      <rect x={cx - 200} y={cy - r - 44} width="120" height="28" fill="#000" />
      <text x={cx - 192} y={cy - r - 24} fill={C.white} fontSize="15">HDG</text>
      <text x={cx - 88} y={cy - r - 24} fill={C.cyan} fontSize="17" textAnchor="end">{String(bug).padStart(3, '0')}°</text>
      {wind && (
        <g>
          <rect x={cx + 150} y={cy - 40} width="96" height="70" fill="#000" stroke="#444" />
          <g transform={`rotate(${windRel} ${cx + 175} ${cy - 5})`}>
            <path d={`M${cx + 175},${cy - 22} v30 m-7,-8 l7,8 l7,-8`} stroke={C.white} strokeWidth="3" fill="none" />
          </g>
          <text x={cx + 238} y={cy + 2} fill={C.white} fontSize="17" textAnchor="end">{wind.kt}KT</text>
        </g>
      )}
      <rect x={cx + 150} y={cy + 40} width="96" height="28" fill="#000" />
      <text x={cx + 158} y={cy + 60} fill={C.white} fontSize="15">GS</text>
      <text x={cx + 238} y={cy + 60} fill={C.white} fontSize="17" textAnchor="end">{Math.round(f.gs)}KT</text>
      <rect x={cx - 246} y={cy + 40} width="96" height="28" fill="#000" />
      <text x={cx - 238} y={cy + 60} fill={C.white} fontSize="15">TRK</text>
      <text x={cx - 158} y={cy + 60} fill={C.magenta} fontSize="17" textAnchor="end">{String(Math.round(f.track) || 360).padStart(3, '0')}°</text>
    </g>
  );
}

function Readout({ x, y, w, text, left }: { x: number; y: number; w: number; text: string; left?: boolean }) {
  const h = 40;
  const d = left
    ? `M${x - 12},${y} l12,-10 v-${h / 2 - 10} h${w} v${h} h-${w} v-${h / 2 - 10} z`
    : `M${x},${y - h / 2} h${w} v${h / 2 - 10} l12,10 l-12,10 v${h / 2 - 10} h-${w} z`;
  return (
    <g>
      <path d={d} fill="#000" stroke={C.white} strokeWidth="1.5" />
      <text x={x + w / 2} y={y + 9} fill={C.white} fontSize="26" textAnchor="middle" fontWeight="600">{text}</text>
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
function triangle(p: { x: number; y: number }, deg: number, s: number, pointIn: boolean) {
  const a = (deg - 90) * Math.PI / 180;
  const ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
  const tip = pointIn ? { x: p.x - ux * 2, y: p.y - uy * 2 } : p;
  const base = { x: tip.x - ux * s * 1.4 * (pointIn ? -1 : 1), y: tip.y - uy * s * 1.4 * (pointIn ? -1 : 1) };
  return `${tip.x},${tip.y} ${base.x + vx * s},${base.y + vy * s} ${base.x - vx * s},${base.y - vy * s}`;
}
