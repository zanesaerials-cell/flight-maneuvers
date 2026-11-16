// Prepare the Sketchfab Cessna 172 for the app:
//  - bake every node transform into its vertices (flat scene, identity transforms)
//  - convert to the app's axes (nose −Z, right wing +X, up +Y), scale to the real 8.28 m length,
//    origin at the CG
//  - give the movable parts stable names and compute their hinge lines
//  - shrink textures to WebP and compress geometry with meshopt
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { flatten, clearNodeTransform, getBounds, prune, dedup, textureCompress, meshopt, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';

const [, , inPath, outGlb, outRig] = process.argv;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(inPath);
const root = doc.getRoot();
const scene = root.listScenes()[0];

await doc.transform(flatten());
for (const n of root.listNodes()) if (n.getMesh()) clearNodeTransform(n);
// Cockpit detail that cannot be seen from outside (panel lettering, switches, buttons,
// seatbelts, gauges) is most of the file; drop it. Seats, yokes and the cabin shell stay.
const HIDDEN = /^(Static_TXT|Static_Base|Static_Display|Dynamic_Switch|Cessna_Interior_(ButtonPlate|Buttons|SeatBelt|Paddle|SeatGear|Meter))/;
for (const n of root.listNodes()) if (HIDDEN.test(n.getName())) n.dispose();

// Measured in the source frame: nose +Z (spinner tip 2.83), tail −6.61, ground y ≈ 0.
const srcLen = 2.83 - -6.61;
const S = 8.28 / srcLen;
// CG: 25 % back from the wing root leading edge (source z 0.50, chord ≈ 1.51), at mid-fuselage height.
const cgSrc = [0, 1.2, 0.50 - 0.25 * 1.51];
// Final = scale · rotate 180° about Y · translate(−cg)
const M = (p) => [-(p[0] - cgSrc[0]) * S, (p[1] - cgSrc[1]) * S, -(p[2] - cgSrc[2]) * S];

const names = {
  'Cessna_Exterior_Body_MAT_0.001': 'prop',
  'Cessna_Exterior_Body_MAT_0.024': 'spinner',
  // Source +X is the airplane's left side (nose +Z, up +Y).
  'Cessna_Exterior_Body_MAT_0.014': 'aileronL', 'Cessna_Exterior_Body_MAT_0.015': 'aileronR',
  'Cessna_Exterior_Body_MAT_0.016': 'flapL', 'Cessna_Exterior_Body_MAT_0.017': 'flapR',
  'Cessna_Exterior_Body_MAT_0.013': 'elevatorL', 'Cessna_Exterior_Body_MAT_0.012': 'elevatorR',
  'Cessna_Exterior_Body_MAT_0.008': 'rudder',
  'Cessna_Exterior_Body_MAT_0.021': 'noseGear',
  'Cessna_Exterior_Body_MAT_0.022': 'mainGearL', 'Cessna_Exterior_Body_MAT_0.023': 'mainGearR',
};

const verts = {};
for (const n of root.listNodes()) {
  const mesh = n.getMesh();
  if (!mesh) continue;
  const key = Object.keys(names).find((k) => n.getName().startsWith(k + '_'));
  if (key) n.setName(names[key]);
  const pts = [];
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    const out = pos.getArray().slice();
    for (let i = 0; i < pos.getCount(); i++) {
      const p = M([out[i * 3], out[i * 3 + 1], out[i * 3 + 2]]);
      out.set(p, i * 3);
      pts.push(p);
    }
    pos.setArray(out);
    // Mirroring X flips triangle winding; swap two indices per triangle to keep faces outward.
    const idx = prim.getIndices();
    if (idx) {
      const a = idx.getArray().slice();
      for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
      idx.setArray(a);
    }
    const nrm = prim.getAttribute('NORMAL');
    if (nrm) {
      const a = nrm.getArray().slice();
      for (let i = 0; i < nrm.getCount(); i++) { a[i * 3] = -a[i * 3]; a[i * 3 + 2] = -a[i * 3 + 2]; }
      nrm.setArray(a);
    }
    const tan = prim.getAttribute('TANGENT');
    if (tan) {
      const a = tan.getArray().slice();
      for (let i = 0; i < tan.getCount(); i++) { a[i * 4] = -a[i * 4]; a[i * 4 + 2] = -a[i * 4 + 2]; }
      tan.setArray(a);
    }
  }
  verts[n.getName()] = pts;
}

// Hinge line: the forward edge (min z) of the surface at each spanwise end.
const hinge = (name, spanAxis) => {
  const pts = verts[name];
  const ax = spanAxis === 'x' ? 0 : 1;
  const lo = Math.min(...pts.map((p) => p[ax])), hi = Math.max(...pts.map((p) => p[ax]));
  const end = (target) => {
    const near = pts.filter((p) => Math.abs(p[ax] - target) < (hi - lo) * 0.06);
    const zMin = Math.min(...near.map((p) => p[2]));
    const front = near.filter((p) => p[2] < zMin + 0.03);
    const avg = (k) => front.reduce((s, p) => s + p[k], 0) / front.length;
    return [avg(0), avg(1), zMin + 0.01];
  };
  return [end(lo), end(hi)];   // A → B in +X (or +Y for the rudder)
};
const r3 = (v) => v.map((x) => +x.toFixed(4));
const rig = {
  scale: S,
  surfaces: {
    aileronL: hinge('aileronL', 'x').map(r3), aileronR: hinge('aileronR', 'x').map(r3),
    flapL: hinge('flapL', 'x').map(r3), flapR: hinge('flapR', 'x').map(r3),
    elevatorL: hinge('elevatorL', 'x').map(r3), elevatorR: hinge('elevatorR', 'x').map(r3),
    rudder: hinge('rudder', 'y').map(r3),
  },
};
// Prop axis: through the spinner's centre, along Z.
{
  const p = verts.spinner;
  const cx = (Math.min(...p.map((q) => q[0])) + Math.max(...p.map((q) => q[0]))) / 2;
  const cy = (Math.min(...p.map((q) => q[1])) + Math.max(...p.map((q) => q[1]))) / 2;
  rig.propHub = r3([cx, cy, Math.max(...verts.prop.map((q) => q[2]))]);
}
// Tire contact points: lowest vertices of each gear mesh.
rig.wheelContacts = ['mainGearL', 'mainGearR', 'noseGear'].map((nm) => {
  const p = verts[nm];
  const yMin = Math.min(...p.map((q) => q[1]));
  const low = p.filter((q) => q[1] < yMin + 0.01);
  const avg = (k) => low.reduce((s, q) => s + q[k], 0) / low.length;
  return r3([avg(0), yMin, avg(2)]);
});

await doc.transform(
  dedup(),
  weld(),
  prune(),
  // Exterior skin stays at 2048 px; the cabin interior and small parts drop to 1024 px.
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 85, pattern: /Body_MAT_baseColor/ }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 80, resize: [1024, 1024], pattern: /^(?!.*Body_MAT_baseColor).*$/ }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
await io.write(outGlb, doc);
fs.writeFileSync(outRig, JSON.stringify(rig, null, 2));
const b = getBounds(scene);
console.log('bounds', b.min.map((x) => x.toFixed(2)), b.max.map((x) => x.toFixed(2)));
console.log(JSON.stringify(rig, null, 1));
