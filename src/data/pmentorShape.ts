/** P-Mentor proportions shared by the 3D model (components/PMentorModel.ts) and its rig. No three.js here. */

export const PM = {
  // Wing: rectangular planform, 5° dihedral, NACA 4415-like section.
  wing: { le: -0.6, chord: 1.32, rootX: 0.5, tipX: 4.5, rootY: -0.42, dihedral: 5, hingeAt: 0.73 },
  flapSpan: [0.62, 2.55] as [number, number],
  aileronSpan: [2.62, 4.3] as [number, number],
  // All-moving stabilator pivoting at 25 % chord.
  stab: { le: 3.8, chord: 0.72, span: 1.45, y: 0.12, pivotAt: 0.25 },
  // Swept fin; rudder aft of the hinge line.
  fin: { rootLe: 3.12, rootChord: 1.22, rootY: 0.22, tipLe: 3.92, tipChord: 0.55, tipY: 1.31, hingeAt: 0.68 },
  spinner: { tipZ: -2.23, baseZ: -1.96, r: 0.165, y: -0.06 },
  propRadius: 0.875,
  wheels: { mainX: 0.944, mainZ: 0.178, mainR: 0.185, noseZ: -1.462, noseR: 0.175, groundY: -1.18 },
};

export const ySpan = (x: number) => PM.wing.rootY + (Math.abs(x) - PM.wing.rootX) * Math.tan((PM.wing.dihedral * Math.PI) / 180);

/** Hinge lines (A → B along +X, or up the fin for the rudder) and the propeller hub, for the rig. */
export function pmentorRig() {
  const w = PM.wing, hz = w.le + w.chord * w.hingeAt;
  const hy = (x: number) => ySpan(x) + 0.01;
  const line = (x0: number, x1: number): [[number, number, number], [number, number, number]] => [[x0, hy(x0), hz], [x1, hy(x1), hz]];
  const s = PM.stab, f = PM.fin;
  const finHinge = (y: number) => { const u = (y - f.rootY) / (f.tipY - f.rootY); const le = f.rootLe + (f.tipLe - f.rootLe) * u; const c = f.rootChord + (f.tipChord - f.rootChord) * u; return le + c * f.hingeAt; };
  return {
    hinges: {
      flapL: line(-PM.flapSpan[1], -PM.flapSpan[0]),
      flapR: line(PM.flapSpan[0], PM.flapSpan[1]),
      aileronL: line(-PM.aileronSpan[1], -PM.aileronSpan[0]),
      aileronR: line(PM.aileronSpan[0], PM.aileronSpan[1]),
      elevator: [[-s.span, s.y, s.le + s.chord * s.pivotAt], [s.span, s.y, s.le + s.chord * s.pivotAt]] as [[number, number, number], [number, number, number]],
      rudder: [[0, f.rootY - 0.2, finHinge(f.rootY - 0.2)], [0, f.tipY, finHinge(f.tipY)]] as [[number, number, number], [number, number, number]],
    },
    propHub: [0, PM.spinner.y, PM.spinner.baseZ - 0.02] as [number, number, number],
  };
}

