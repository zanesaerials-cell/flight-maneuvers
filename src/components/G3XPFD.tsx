import type { AircraftProfile } from '../data/aircraft';
import type { Frame, ManeuverRun } from '../engine/types';
import { angDiff, clamp, wrap360 } from '../engine/kinematics';

/**
 * G3X Touch PFD as set up in the school's P-Mentors: the horizon fills the
 * whole screen, airspeed tape on the left, altitude tape with the vertical
 * speed scale on the right, the slip indicator under the aircraft symbol, a
 * full compass rose at the bottom with the HDG and CRS boxes above it, and
 * the wind and flap/trim boxes to its left. The top bar and the side panes
 * (flight plan, nearest airports) are left out. A teaching rendering, not a replica.
 */
const W = 800, H = 630;
const CX = 400, CY = 203;               // aircraft symbol
const PPD = 6.5;                        // pixels per degree of pitch
const ROSE = { cx: 400, cy: 482, r: 117 };
const C = {
  sky: '#2f6bf0', ground: '#7a4a1e',
  white: '#ffffff', cyan: '#2ee6ff', magenta: '#ff4dff', yellow: '#f2d23c', green: '#22d36a',
  red: '#ff3030', grey: '#b9c0c8', box: 'rgba(8,10,14,0.88)', tape: 'rgba(14,22,48,0.55)', line: '#8b939c',
};
const FONT = "'Barlow Semi Condensed', 'Arial Narrow', sans-serif";
const pad3 = (d: number) => String(Math.round(wrap360(d)) || 360).padStart(3, '0');

export function G3XPFD({ f, run, ac }: { f: Frame; run: ManeuverRun; ac: AircraftProfile }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="pfd" role="img" fontFamily={FONT}
      aria-label={`G3X Touch PFD: ${Math.round(f.ias)} knots, ${Math.round(f.altFt)} feet, heading ${Math.round(f.heading)}`}>
      <defs>
        <clipPath id="g3-screen"><rect x="0" y="0" width={W} height={H} rx="6" /></clipPath>
        <clipPath id="g3-ladder"><rect x={CX - 110} y={CY - 112} width="220" height="166" /></clipPath>
      </defs>
      <g clipPath="url(#g3-screen)">
        <Attitude f={f} />
        <AirspeedTape f={f} ac={ac} target={run.bugs.ias} />
        <AltitudeTape f={f} target={run.bugs.altitudeFt} />
        <Rose f={f} bug={run.bugs.heading} />
        <WindBox f={f} wind={run.scene.wind} />
        <FlapTrim f={f} ac={ac} />
        <StatusLine f={f} />
        {f.warn && (
          <g>
            <rect x={CX - 52} y={14} width="104" height="30" rx="3" fill={C.red} />
            <text x={CX} y={36} fill="#fff" fontSize="21" fontWeight="700" textAnchor="middle" letterSpacing="2">{f.warn}</text>
          </g>
        )}
      </g>
    </svg>
  );
}

// ── Attitude (full screen) ───────────────────────────────────────────────────
function Attitude({ f }: { f: Frame }) {
  const ladder = [];
  for (let p = -30; p <= 30; p += 2.5) {
    if (p === 0) continue;
    const y = -p * PPD;
    const major = p % 10 === 0, mid = p % 5 === 0;
    const w = major ? 70 : mid ? 36 : 16;
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
  const R = 132;
  return (
    <g>
      <g transform={`rotate(${-f.bank} ${CX} ${CY})`}>
        <g transform={`translate(0 ${f.pitch * PPD})`}>
          <rect x={-1200} y={CY - 2400} width={3200} height={2400} fill={C.sky} />
          <rect x={-1200} y={CY} width={3200} height={2400} fill={C.ground} />
          <line x1={-1200} x2={2000} y1={CY} y2={CY} stroke={C.white} strokeWidth="2" />
        </g>
        <g clipPath="url(#g3-ladder)"><g transform={`translate(0 ${f.pitch * PPD})`}>{ladder}</g></g>
        <path d={describeArc(CX, CY, R, -60, 60)} fill="none" stroke={C.white} strokeWidth="2" />
        {[10, 20, 30, 45, 60].flatMap((a) => [-a, a]).map((a) => {
          const p1 = polar(CX, CY, R, a), p2 = polar(CX, CY, R + (a % 30 === 0 ? 16 : 9), a);
          return <line key={a} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={C.white} strokeWidth="2.5" />;
        })}
        <polygon points={`${CX},${CY - R} ${CX - 9},${CY - R - 14} ${CX + 9},${CY - R - 14}`} fill={C.white} />
      </g>
      {/* Roll pointer, fixed to the airplane */}
      <polygon points={`${CX},${CY - R + 2} ${CX - 9},${CY - R + 16} ${CX + 9},${CY - R + 16}`} fill={C.white} />
      {/* Aircraft symbol: single-cue chevron and the two level bars */}
      <g fill={C.yellow} stroke="#2a2208" strokeWidth="1.5">
        <polygon points={`${CX},${CY} ${CX - 76},${CY + 22} ${CX - 52},${CY + 22} ${CX},${CY + 9} ${CX + 52},${CY + 22} ${CX + 76},${CY + 22}`} />
        <rect x={CX - 154} y={CY - 4} width="38" height="8" rx="1" />
        <rect x={CX + 116} y={CY - 4} width="38" height="8" rx="1" />
      </g>
      <SlipIndicator slip={f.slip} />
    </g>
  );
}

function SlipIndicator({ slip }: { slip: number }) {
  const x = CX - 66, y = 272, w = 132, h = 24;
  const ball = clamp(slip, -1.2, 1.2) * 34;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="3" fill={C.box} />
      <line x1={CX - 14} x2={CX - 14} y1={y + 2} y2={y + h - 2} stroke={C.white} strokeWidth="2" />
      <line x1={CX + 14} x2={CX + 14} y1={y + 2} y2={y + h - 2} stroke={C.white} strokeWidth="2" />
      <circle cx={CX + ball} cy={y + h / 2} r="9" fill={C.white} />
    </g>
  );
}

// ── Tapes ────────────────────────────────────────────────────────────────────
function AirspeedTape({ f, ac, target }: { f: Frame; ac: AircraftProfile; target?: number }) {
  const x = 134, w = 86, top = 56, bottom = 312, mid = CY;
  const ppk = 3.6;
  const y = (k: number) => mid - (k - f.ias) * ppk;
  const ticks = [];
  for (let k = Math.max(20, Math.floor((f.ias - 45) / 5) * 5); k <= f.ias + 45; k += 5) {
    ticks.push(
      <g key={k}>
        <line x1={x + w - (k % 10 === 0 ? 14 : 8)} x2={x + w} y1={y(k)} y2={y(k)} stroke={C.white} strokeWidth="2" />
        {k % 10 === 0 && <text x={x + w - 20} y={y(k) + 7} fill={C.white} fontSize="21" textAnchor="end">{k}</text>}
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
        {band(arcs.whiteLow, arcs.whiteHigh, C.white, 0, 4)}
        {band(arcs.greenLow, arcs.greenHigh, C.green, 4, 6)}
        {band(arcs.greenHigh, arcs.yellowHigh, C.yellow, 4, 6)}
        {band(arcs.yellowHigh, arcs.yellowHigh + 60, C.red, 0, 10)}
        {target && <path d={`M${x + w},${y(target) - 10} h8 v20 h-8 v-6 l5,-4 l-5,-4 z`} fill={C.cyan} />}
      </g>
      <Readout x={x + 2} y={mid} w={70} text={String(Math.round(f.ias))} />
      <rect x={x} y={top - 26} width={w} height="26" fill={C.box} stroke={C.line} strokeWidth="1" />
      <text x={x + 5} y={top - 8} fill={C.grey} fontSize="12">TAS</text>
      <text x={x + w - 6} y={top - 7} fill={C.white} fontSize="18" textAnchor="end">{Math.round(f.tas)}<tspan fontSize="12">KT</tspan></text>
      <rect x={x} y={bottom} width={w} height="24" fill={C.box} stroke={C.line} strokeWidth="1" />
      <text x={x + 6} y={bottom + 17} fill={C.grey} fontSize="14">GS</text>
      <text x={x + w - 6} y={bottom + 18} fill={C.magenta} fontSize="17" textAnchor="end">{Math.round(f.gs)}<tspan fontSize="12">KT</tspan></text>
    </g>
  );
}

function AltitudeTape({ f, target }: { f: Frame; target: number }) {
  const x = 580, w = 88, top = 72, bottom = 320, mid = CY;
  const ppf = 0.6;
  const y = (a: number) => mid - (a - f.altFt) * ppf;
  const ticks = [];
  for (let a = Math.floor((f.altFt - 260) / 20) * 20; a <= f.altFt + 260; a += 20) {
    const major = a % 100 === 0;
    ticks.push(
      <g key={a}>
        <line x1={x} x2={x + (major ? 14 : 7)} y1={y(a)} y2={y(a)} stroke={C.white} strokeWidth="2" />
        {major && <text x={x + 19} y={y(a) + 7} fill={C.white} fontSize="20">{a}</text>}
      </g>,
    );
  }
  // Vertical speed scale beside the tape, marked in thousands of feet per minute.
  const vx = x + w + 3, vh = 108;
  const vs = (v: number) => mid - clamp(v, -2000, 2000) / 2000 * vh;
  const vy = vs(f.vsi);
  const vsText = Math.round(f.vsi / 50) * 50;
  return (
    <g>
      <defs><clipPath id="g3-alt"><rect x={x - 12} y={top} width={w + 12} height={bottom - top} /></clipPath></defs>
      <rect x={x} y={top} width={w} height={bottom - top} fill={C.tape} />
      <g clipPath="url(#g3-alt)">
        {ticks}
        <path d={`M${x},${y(target) - 11} h9 v7 l-5,4 l5,4 v7 h-9 z`} fill={C.cyan} />
      </g>
      <rect x={x} y={top - 28} width={w} height="26" fill={C.box} stroke={C.line} strokeWidth="1" />
      <path d={`M${x + 6},${top - 22} h7 v4 l-3,3 l3,3 v4 h-7 z`} fill={C.cyan} />
      <text x={x + w - 6} y={top - 8} fill={C.cyan} fontSize="19" textAnchor="end">{target}<tspan fontSize="12">FT</tspan></text>
      <Readout x={x + 12} y={mid} w={78} text={String(Math.round(f.altFt / 10) * 10)} left />
      <rect x={vx} y={mid - vh - 10} width="30" height={vh * 2 + 20} fill={C.tape} />
      {[-2000, -1000, -500, 0, 500, 1000, 2000].map((v) => {
        const big = v % 1000 === 0;
        return (
          <g key={v}>
            <line x1={vx} x2={vx + (big ? 9 : 5)} y1={vs(v)} y2={vs(v)} stroke={C.white} strokeWidth="2" />
            {big && v !== 0 && <text x={vx + 20} y={vs(v) + 5} fill={C.white} fontSize="13" textAnchor="middle">{Math.abs(v / 1000)}</text>}
          </g>
        );
      })}
      <path d={`M${vx + 4},${vy} l10,-9 h${vsText ? 34 : 18} v18 h-${vsText ? 34 : 18} z`} fill={C.box} stroke={C.white} strokeWidth="1.5" />
      {vsText !== 0 && <text x={vx + 31} y={vy + 5} fill={C.white} fontSize="13" textAnchor="middle">{Math.abs(vsText)}</text>}
      <rect x={x} y={bottom} width={w} height="24" fill={C.box} stroke={C.line} strokeWidth="1" />
      <text x={x + w / 2} y={bottom + 18} fill={C.cyan} fontSize="17" textAnchor="middle">29.92<tspan fontSize="12">IN</tspan></text>
    </g>
  );
}

// ── Compass rose with HDG and CRS boxes ──────────────────────────────────────
function Rose({ f, bug }: { f: Frame; bug: number }) {
  const { cx, cy, r } = ROSE;
  const card = [];
  for (let d = 0; d < 360; d += 5) {
    const long = d % 10 === 0;
    const p1 = polar(cx, cy, r, d), p2 = polar(cx, cy, r - (long ? 14 : 8), d);
    card.push(<line key={d} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={C.white} strokeWidth="2" />);
    if (d % 30 === 0) {
      const p = polar(cx, cy, r - 30, d);
      const label = ({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' } as Record<number, string>)[d] ?? String(d / 10);
      card.push(<text key={`t${d}`} x={p.x} y={p.y + 8} fill={C.white} fontSize="22" textAnchor="middle" transform={`rotate(${d} ${p.x} ${p.y})`}>{label}</text>);
    }
  }
  const trackA = angDiff(f.heading, f.track);
  return (
    <g>
      <circle cx={cx} cy={cy} r={r + 4} fill="rgba(0,0,0,0.42)" />
      <g transform={`rotate(${-f.heading} ${cx} ${cy})`}>
        {card}
        {/* Heading bug */}
        <g transform={`rotate(${bug} ${cx} ${cy})`}>
          <path d={`M${cx - 10},${cy - r - 1} v-9 h6 l4,6 l4,-6 h6 v9 z`} fill={C.cyan} />
        </g>
      </g>
      {/* Eight fixed index marks outside the card */}
      {[45, 90, 135, 180, 225, 270, 315].map((a) => {
        const p1 = polar(cx, cy, r + 6, a), p2 = polar(cx, cy, r + 16, a);
        return <line key={a} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={C.white} strokeWidth="2" />;
      })}
      <circle cx={cx} cy={cy} r={r * 0.55} fill="none" stroke={C.line} strokeWidth="1.5" />
      {/* Ground track */}
      <g transform={`rotate(${trackA} ${cx} ${cy})`}>
        <path d={`M${cx},${cy - r + 18} l-6,7 l6,7 l6,-7 z`} fill={C.magenta} />
      </g>
      {/* Airplane */}
      <path d={`M${cx},${cy - 20} l3,8 v6 l15,7 v5 l-15,-3 v9 l6,5 v4 l-9,-2 l-9,2 v-4 l6,-5 v-9 l-15,3 v-5 l15,-7 v-6 z`} fill={C.white} />
      {/* Lubber line and heading box */}
      <polygon points={`${cx},${cy - r + 1} ${cx - 7},${cy - r - 9} ${cx + 7},${cy - r - 9}`} fill={C.white} />
      <rect x={cx - 32} y={cy - r - 38} width="64" height="28" rx="2" fill={C.box} stroke={C.white} strokeWidth="1.5" />
      <text x={cx} y={cy - r - 17} fill={C.white} fontSize="21" textAnchor="middle">{pad3(f.heading)}°</text>
      <BoxField x={cx - 142} y={cy - r - 34} label="HDG" value={`${pad3(bug)}°`} />
      <BoxField x={cx + 54} y={cy - r - 34} label="CRS" value="– – –" />
    </g>
  );
}

function BoxField({ x, y, label, value }: { x: number; y: number; label: string; value: string }) {
  return (
    <g>
      <rect x={x} y={y} width="88" height="24" rx="2" fill={C.box} stroke={C.line} strokeWidth="1" />
      <text x={x + 6} y={y + 17} fill={C.grey} fontSize="13">{label}</text>
      <text x={x + 82} y={y + 18} fill={C.cyan} fontSize="17" textAnchor="end">{value}</text>
    </g>
  );
}

// ── Wind and flap/trim boxes ─────────────────────────────────────────────────
function WindBox({ f, wind }: { f: Frame; wind?: { fromDeg: number; kt: number } }) {
  const x = 186, y = 360, w = 76, h = 42;
  // The arrow shows where the wind is blowing relative to the nose.
  const rel = wind ? angDiff(f.heading, wind.fromDeg + 180) : 0;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="2" fill={C.box} stroke={C.line} strokeWidth="1" />
      {wind ? (
        <>
          <g transform={`rotate(${rel} ${x + 18} ${y + h / 2})`}>
            <path d={`M${x + 18},${y + 7} l-6,9 h4 v18 h4 v-18 h4 z`} fill={C.white} />
          </g>
          <text x={x + w - 6} y={y + 18} fill={C.white} fontSize="16" textAnchor="end">{wind.kt}<tspan fontSize="11">KT</tspan></text>
          <text x={x + w - 6} y={y + 36} fill={C.white} fontSize="15" textAnchor="end">{pad3(wind.fromDeg)}°</text>
        </>
      ) : (
        <text x={x + w / 2} y={y + 27} fill={C.grey} fontSize="15" textAnchor="middle">CALM</text>
      )}
    </g>
  );
}

function FlapTrim({ f, ac }: { f: Frame; ac: AircraftProfile }) {
  const x = 186, y = 414, w = 76, h = 120;
  const top = y + 26, len = h - 36;
  const max = ac.flapDetents[ac.flapDetents.length - 1] || 30;
  const fy = (d: number) => top + (clamp(d, 0, max) / max) * len;
  // Trim: nose down at the top, nose up at the bottom, takeoff band in the middle.
  const ty = (t: number) => top + len / 2 + clamp(t, -1, 1) * (len / 2);
  const lx = x + 22, rx = x + 54;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="2" fill={C.box} stroke={C.line} strokeWidth="1" />
      <text x={lx} y={y + 17} fill={C.grey} fontSize="12" textAnchor="middle">FLAP</text>
      <text x={rx} y={y + 17} fill={C.grey} fontSize="12" textAnchor="middle">TRIM</text>
      <line x1={lx} x2={lx} y1={top} y2={top + len} stroke={C.white} strokeWidth="2" />
      {ac.flapDetents.map((d) => <line key={d} x1={lx - 6} x2={lx} y1={fy(d)} y2={fy(d)} stroke={C.white} strokeWidth="2" />)}
      <polygon points={`${lx + 2},${fy(f.c.flaps)} ${lx + 12},${fy(f.c.flaps) - 6} ${lx + 12},${fy(f.c.flaps) + 6}`} fill={C.white} />
      <line x1={rx} x2={rx} y1={top} y2={top + len} stroke={C.white} strokeWidth="2" />
      <rect x={rx - 1} y={ty(-0.1)} width="5" height={ty(0.1) - ty(-0.1)} fill={C.green} />
      <text x={rx + 13} y={top + 6} fill={C.grey} fontSize="10">DN</text>
      <text x={rx + 13} y={top + len + 2} fill={C.grey} fontSize="10">UP</text>
      <polygon points={`${rx - 2},${ty(f.c.trim)} ${rx - 12},${ty(f.c.trim) - 6} ${rx - 12},${ty(f.c.trim) + 6}`} fill={C.white} />
    </g>
  );
}

// ── Status line along the bottom ─────────────────────────────────────────────
function StatusLine({ f }: { f: Frame }) {
  const sec = Math.round(10 * 3600 + f.t);
  const hh = String(Math.floor(sec / 3600) % 24).padStart(2, '0');
  const mm = String(Math.floor(sec / 60) % 60).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return (
    <g fontSize="14">
      <rect x={0} y={H - 26} width={W} height="26" fill="rgba(0,0,0,0.55)" />
      <text x={150} y={H - 8} fill={C.grey}>OAT <tspan fill={C.white}>15°C</tspan></text>
      <text x={CX} y={H - 8} fill={C.grey} textAnchor="middle">LCL <tspan fill={C.white}>{hh}:{mm}:{ss}</tspan></text>
      <text x={650} y={H - 8} fill={C.grey} textAnchor="end"><tspan fill={C.green}>GPS</tspan></text>
    </g>
  );
}

function Readout({ x, y, w, text, left }: { x: number; y: number; w: number; text: string; left?: boolean }) {
  const h = 44;
  const d = left
    ? `M${x - 12},${y} l12,-10 v-${h / 2 - 10} h${w} v${h} h-${w} v-${h / 2 - 10} z`
    : `M${x},${y - h / 2} h${w} v${h / 2 - 10} l12,10 l-12,10 v${h / 2 - 10} h-${w} z`;
  return (
    <g>
      <path d={d} fill="#000" stroke={C.white} strokeWidth="1.5" />
      <text x={x + w / 2} y={y + 10} fill={C.white} fontSize="29" textAnchor="middle" fontWeight="600">{text}</text>
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
