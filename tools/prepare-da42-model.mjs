// Prepare helijah's "Diamond Da42 Twin Star" (Sketchfab, CC BY 4.0) for the app.
//
// The model arrives as a handful of large meshes. This script cuts the movable
// parts out into their own named nodes so the app can hinge and spin them:
//   propL / propR             three blades each, spun about the hub
//   flapInL / flapOutL / …    flap panels inboard and outboard of each nacelle
//   aileronL / aileronR       outer trailing edge, aft of the hinge seam
//   elevator                  full-span elevator on the T-tail
//   rudder                    rudder skin and its hinge strip
//   gearL / gearR / gearN     wheels and legs, which slide up when retracted
// It then re-orients to the app frame (nose −Z, right wing +X, up +Y, origin
// at the CG), computes hinge lines, prop hubs and tire contacts, shrinks the
// textures and compresses the geometry.
//
// usage: node tools/prepare-da42-model.mjs scene.gltf public/models/da42.glb rig.json
// needs: @gltf-transform/core @gltf-transform/functions @gltf-transform/extensions sharp meshoptimizer

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { flatten, clearNodeTransform, prune, dedup, textureCompress, meshopt, compactPrimitive } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';

const [, , inPath, outGlb, outRig] = process.argv;
const CG_X_SRC = -1.35;                       // source x of the CG (source nose is −X)
// Source → app frame. Source: nose −X, up +Y, right wing −Z.
const toApp = (p) => [-p[2], p[1], p[0] - CG_X_SRC];

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(inPath);
const root = doc.getRoot();
const scene = root.listScenes()[0];
await doc.transform(flatten());
for (const n of root.listNodes()) if (n.getMesh()) clearNodeTransform(n);

// ── Connected components of every primitive, in app coordinates ─────────────
function analyse(prim) {
  const pos = prim.getAttribute('POSITION');
  const N = pos.getCount();
  const P = Array.from({ length: N }, (_, i) => toApp(pos.getElement(i, [])));
  const ia = prim.getIndices().getArray();
  const par = [...Array(N).keys()];
  const find = (a) => { while (par[a] !== a) a = par[a] = par[par[a]]; return a; };
  const byPos = new Map();
  for (let i = 0; i < N; i++) {
    const k = P[i].map((x) => x.toFixed(4)).join(',');
    if (byPos.has(k)) par[find(i)] = find(byPos.get(k)); else byPos.set(k, i);
  }
  for (let t = 0; t < ia.length; t += 3) { par[find(ia[t])] = find(ia[t + 1]); par[find(ia[t + 1])] = find(ia[t + 2]); }
  const comps = new Map();
  for (let t = 0; t < ia.length; t += 3) {
    const r = find(ia[t]);
    const c = comps.get(r) ?? { tris: [], bb: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity] };
    c.tris.push(t);
    for (let k = 0; k < 3; k++) {
      const p = P[ia[t + k]];
      for (let j = 0; j < 3; j++) { c.bb[j] = Math.min(c.bb[j], p[j]); c.bb[j + 3] = Math.max(c.bb[j + 3], p[j]); }
    }
    comps.set(r, c);
  }
  return { P, ia, comps: [...comps.values()] };
}

const prims = [];
for (const node of root.listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue;
  for (const prim of mesh.listPrimitives()) prims.push({ node: node.getName(), prim, ...analyse(prim) });
}

// ── Part definitions: which triangles belong to which part ──────────────────
// Each rule picks components by node and bounding box [x0,y0,z0,x1,y1,z1], then
// optionally keeps only triangles that pass `tri` (all three vertices given).
const inside = (bb, box) => bb[0] >= box[0] && bb[1] >= box[1] && bb[2] >= box[2] && bb[3] <= box[3] && bb[4] <= box[4] && bb[5] <= box[5];
const cx = (v) => (v[0][0] + v[1][0] + v[2][0]) / 3;
// Aileron hinge seam in the wing skin: z 0.73 at x 4.87 to z 0.67 at x 6.48 (both wings, mirrored).
const seamZ = (ax) => 0.73 + (ax - 4.87) * ((0.67 - 0.73) / (6.48 - 4.87));
const aftOfSeam = (v) => v.every((p) => Math.abs(p[0]) >= 4.86 && Math.abs(p[0]) <= 6.49 && p[2] >= seamZ(Math.abs(p[0])) - 0.012);
const BIG = 99;

const rules = [];
for (const [s, L] of [[-1, 'L'], [1, 'R']]) {
  const side = (a, b) => (s < 0 ? [-b, a] : [a, b]);      // mirror an x range for the left wing
  const [px0, px1] = side(0.85, 2.3);
  rules.push({ part: `prop${L}`, node: 'Object_50', box: [px0, -0.8, -1.33, px1, 0.8, -1.22] });
  const [wx0, wx1] = side(0.6, 6.6);
  rules.push({ part: `flapIn${L}`, node: 'Object_48', box: [wx0, -0.5, 0.6, wx1, 0.3, 1.25], tri: (v) => Math.abs(cx(v)) < 2.15 });
  rules.push({ part: `flapOut${L}`, node: 'Object_48', box: [wx0, -0.5, 0.6, wx1, 0.3, 1.25], tri: (v) => Math.abs(cx(v)) >= 2.15 && Math.abs(cx(v)) < 4.88 });
  rules.push({ part: `aileron${L}`, node: 'Object_48', box: [wx0, -0.5, 0.6, wx1, 0.3, 1.25], tri: (v) => Math.abs(cx(v)) >= 4.88 });
  const [sx0, sx1] = side(0.25, 6.7);
  rules.push({ part: `aileron${L}`, node: 'Object_50', box: [sx0, -0.6, -0.6, sx1, 1.0, 1.3], tri: aftOfSeam });
  const [gx0, gx1] = side(1.15, 1.7);
  rules.push({ part: `gear${L}`, node: '*', box: [gx0, -1.3, -0.15, gx1, -0.25, 0.5] });
}
rules.push({ part: 'elevator', node: 'Object_48', box: [-1.5, 1.1, 5.2, 1.5, 1.25, 5.65] });
rules.push({ part: 'rudder', node: 'Object_50', box: [-0.07, -0.4, 4.7, 0.07, 1.15, 5.65] });
rules.push({ part: 'rudder', node: 'Object_48', box: [-0.07, -0.4, 4.7, 0.07, 1.15, 5.65] });
rules.push({ part: 'gearN', node: '*', box: [-0.11, -1.3, -1.45, 0.11, -0.25, -0.9] });
void BIG;

// The model has the left nose baggage door modelled open. Remove it and close the gap
// with a mirrored copy of the closed right door.
const noseDoorOpenL = [-0.5, 0.0, -2.5, -0.04, 0.7, -1.45];
const noseDoorR = [0.04, -0.25, -2.4, 0.5, 0.3, -1.45];
rules.push({ part: '_delete', node: 'Object_32', box: noseDoorOpenL });
rules.push({ part: '_delete', node: 'Object_50', box: noseDoorOpenL });
const mirrorRules = [{ part: 'noseDoorL', node: 'Object_50', box: noseDoorR }];

// ── Cut the triangles out into new primitives under named nodes ─────────────
const parts = new Map();           // part → { mesh, verts: [] }
const removed = new Map();         // prim → Set(triangle start index)
for (const r of rules) {
  for (const p of prims) {
    if (r.node !== '*' && p.node !== r.node) continue;
    const take = [];
    for (const c of p.comps) {
      if (!inside(c.bb, r.box)) continue;
      for (const t of c.tris) {
        const v = [p.P[p.ia[t]], p.P[p.ia[t + 1]], p.P[p.ia[t + 2]]];
        if (!r.tri || r.tri(v)) take.push(t);
      }
    }
    const done = removed.get(p.prim) ?? new Set();
    const fresh = take.filter((t) => !done.has(t));
    if (!fresh.length) continue;
    fresh.forEach((t) => done.add(t));
    removed.set(p.prim, done);
    if (r.part === '_delete') continue;
    let entry = parts.get(r.part);
    if (!entry) {
      const mesh = doc.createMesh(r.part);
      const node = doc.createNode(r.part).setMesh(mesh);
      scene.addChild(node);
      entry = { mesh, verts: [] };
      parts.set(r.part, entry);
    }
    const idx = new Uint32Array(fresh.length * 3);
    fresh.forEach((t, i) => { idx[i * 3] = p.ia[t]; idx[i * 3 + 1] = p.ia[t + 1]; idx[i * 3 + 2] = p.ia[t + 2]; });
    const np = doc.createPrimitive().setMaterial(p.prim.getMaterial())
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(idx));
    for (const sem of p.prim.listSemantics()) np.setAttribute(sem, p.prim.getAttribute(sem));
    entry.mesh.addPrimitive(np);
    for (const t of fresh) for (let k = 0; k < 3; k++) entry.verts.push(p.P[p.ia[t + k]]);
  }
}
// Mirrored copies get their own vertex data: source z (app x) negated, winding flipped.
for (const r of mirrorRules) {
  for (const p of prims) {
    if (p.node !== r.node) continue;
    const tris = p.comps.filter((c) => inside(c.bb, r.box)).flatMap((c) => c.tris);
    if (!tris.length) continue;
    const sems = p.prim.listSemantics();
    const data = Object.fromEntries(sems.map((sem) => [sem, []]));
    for (const t of tris) {
      for (const k of [0, 2, 1]) {
        const vi = p.ia[t + k];
        for (const sem of sems) {
          const el = p.prim.getAttribute(sem).getElement(vi, []);
          if (sem === 'POSITION' || sem === 'NORMAL') el[2] = -el[2];
          if (sem === 'TANGENT') { el[2] = -el[2]; el[3] = -el[3]; }
          data[sem].push(...el);
        }
      }
    }
    const np = doc.createPrimitive().setMaterial(p.prim.getMaterial());
    for (const sem of sems) {
      const src = p.prim.getAttribute(sem);
      np.setAttribute(sem, doc.createAccessor().setType(src.getType()).setArray(new Float32Array(data[sem])));
    }
    const node = doc.createNode(r.part).setMesh(doc.createMesh(r.part).addPrimitive(np));
    scene.addChild(node);
    console.log(r.part.padEnd(9), 'triangles', tris.length, '(mirrored copy)');
  }
}
for (const [prim, set] of removed) {
  const ia = prim.getIndices().getArray();
  const keep = [];
  for (let t = 0; t < ia.length; t += 3) if (!set.has(t)) keep.push(ia[t], ia[t + 1], ia[t + 2]);
  // A primitive whose every triangle moved to a part is removed entirely.
  if (!keep.length) { prim.dispose(); continue; }
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(keep)));
}
for (const [name, e] of parts) console.log(name.padEnd(9), 'triangles', e.verts.length / 3);

// ── Re-orient every vertex (each accessor once) ─────────────────────────────
const seen = new Set();
const all = [];
for (const node of root.listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue;
  for (const prim of mesh.listPrimitives()) {
    for (const [sem, isPos] of [['POSITION', true], ['NORMAL', false], ['TANGENT', false]]) {
      const a = prim.getAttribute(sem); if (!a || seen.has(a)) continue; seen.add(a);
      const arr = a.getArray().slice(); const k = a.getElementSize();
      for (let i = 0; i < a.getCount(); i++) {
        const p = [arr[i * k], arr[i * k + 1], arr[i * k + 2]];
        const q = isPos ? toApp(p) : [-p[2], p[1], p[0]];
        arr[i * k] = q[0]; arr[i * k + 1] = q[1]; arr[i * k + 2] = q[2];
        if (isPos) all.push(q);
      }
      a.setArray(arr);
    }
  }
}

// ── Rig: hinge lines (forward edge at each spanwise end), prop hubs, tires ──
const r3 = (v) => v.map((x) => +x.toFixed(4));
function hinge(name, axis) {
  const pts = parts.get(name).verts;
  const ax = axis === 'x' ? 0 : 1;
  const lo = Math.min(...pts.map((p) => p[ax])), hi = Math.max(...pts.map((p) => p[ax]));
  const end = (target) => {
    const near = pts.filter((p) => Math.abs(p[ax] - target) < (hi - lo) * 0.08);
    const zMin = Math.min(...near.map((p) => p[2]));
    const front = near.filter((p) => p[2] < zMin + 0.02);
    const avg = (k) => front.reduce((s, p) => s + p[k], 0) / front.length;
    return r3([avg(0), avg(1), zMin + 0.005]);
  };
  return [end(lo), end(hi)];                 // A → B toward +X (+Y for the rudder)
}
const hinges = {};
for (const name of parts.keys()) {
  if (/^(flap|aileron|elevator)/.test(name)) hinges[name] = hinge(name, 'x');
  if (name === 'rudder') hinges[name] = hinge(name, 'y');
}
const props = ['propL', 'propR'].filter((n) => parts.has(n)).map((name) => {
  const v = parts.get(name).verts;
  const bb = (k, f) => f(...v.map((p) => p[k]));
  // Three blades 120° apart, one pointing horizontally toward the fuselage: the other two
  // tips span √3·r vertically, and the horizontal blade's tip lies r from the hub.
  const xs = v.map((p) => p[0]).sort((a, b) => a - b);
  const radius = (bb(1, Math.max) - bb(1, Math.min)) / Math.sqrt(3);
  const cy = (bb(1, Math.max) + bb(1, Math.min)) / 2;
  const hubX = name === 'propL' ? xs[xs.length - 1] - radius : xs[0] + radius;
  return { name, at: r3([hubX, cy, (bb(2, Math.max) + bb(2, Math.min)) / 2]), radius: +radius.toFixed(3) };
});
const yMin = Math.min(...all.map((p) => p[1]));
const low = all.filter((p) => p[1] < yMin + 0.12);
const avg = (a, k) => a.reduce((s, p) => s + p[k], 0) / a.length;
const grp = (f) => { const a = low.filter(f); return r3([avg(a, 0), Math.min(...a.map((p) => p[1])), avg(a, 2)]); };
const rig = {
  wheelContacts: [grp((p) => p[0] < -0.5), grp((p) => p[0] > 0.5), grp((p) => Math.abs(p[0]) <= 0.5)],
  hinges,
  props,
  gear: ['gearL', 'gearR', 'gearN'].filter((n) => parts.has(n)),
};

// Plain white livery: the source paint has green cheat lines, green logos and a
// cream base. Turn green paint white and lift the cream to a neutral white.
for (const tex of root.listTextures()) {
  if (!/DefaultWhite_texture/.test(tex.getURI() || tex.getName() || '')) continue;
  const { data, info } = await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (g > r + 30 && g > b + 15) {
      // Bright green paint becomes white; the dark green fringe of black decals becomes their black.
      const v = g > 110 ? 250 : Math.max(r, b);
      data[i] = data[i + 1] = data[i + 2] = v;
    } else if (r > 200 && g > 200 && b > 180) {
      const v = Math.max(r, g, b);
      data[i] = data[i + 1] = data[i + 2] = Math.min(250, v);
    }
  }
  tex.setImage(new Uint8Array(await sharp(data, { raw: info }).png().toBuffer())).setMimeType('image/png');
  console.error('recoloured', tex.getURI());
}

// Give every primitive its own compact vertex buffers (the cut-out parts shared the originals).
for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) compactPrimitive(prim);
await doc.transform(
  dedup(), prune(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 82, resize: [1024, 1024] }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
await io.write(outGlb, doc);
fs.writeFileSync(outRig, JSON.stringify(rig, null, 1));
console.log(JSON.stringify(rig, null, 1));
