// Prepare a single-mesh (unrigged) airplane model for the app:
// bake transforms, rotate to the app's axes (nose −Z, right wing +X, up +Y),
// move the origin to the CG, scale, shrink textures, compress geometry.
// usage: node prep2.mjs in.gltf out.glb rig.json cgX cgY scale
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { flatten, clearNodeTransform, prune, dedup, textureCompress, meshopt, weld, getBounds } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';

const [, , inPath, outGlb, outRig, cgX = '0', cgY = '0', scale = '1'] = process.argv;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(inPath);
const root = doc.getRoot();
await doc.transform(flatten());
for (const n of root.listNodes()) if (n.getMesh()) clearNodeTransform(n);
const S = +scale, cx = +cgX, cy = +cgY;
// Source: nose −X, up +Y, right wing −Z.  App: x' = −z, y' = y, z' = x.
const M = (p) => [-p[2] * S, (p[1] - cy) * S, (p[0] - cx) * S];
const pts = [];
const seen = new Set();
for (const n of root.listNodes()) {
  const mesh = n.getMesh(); if (!mesh) continue;
  for (const prim of mesh.listPrimitives()) {
    for (const [name, w] of [['POSITION', 1], ['NORMAL', 0], ['TANGENT', 0]]) {
      const a = prim.getAttribute(name); if (!a || seen.has(a)) continue; seen.add(a);
      const arr = a.getArray().slice(); const k = a.getElementSize();
      for (let i = 0; i < a.getCount(); i++) {
        const p = [arr[i * k], arr[i * k + 1], arr[i * k + 2]];
        const q = w ? M(p) : [-p[2], p[1], p[0]];
        arr[i * k] = q[0]; arr[i * k + 1] = q[1]; arr[i * k + 2] = q[2];
        if (w) pts.push(q);
      }
      a.setArray(arr);
    }
  }
}
const yMin = Math.min(...pts.map((p) => p[1]));
const low = pts.filter((p) => p[1] < yMin + 0.12);
const avg = (a, k) => a.reduce((s, p) => s + p[k], 0) / a.length;
const grp = (f) => { const a = low.filter(f); return a.length ? [+avg(a, 0).toFixed(3), +Math.min(...a.map((p) => p[1])).toFixed(3), +avg(a, 2).toFixed(3)] : null; };
const rig = { wheelContacts: [grp((p) => p[0] < -0.5), grp((p) => p[0] > 0.5), grp((p) => Math.abs(p[0]) <= 0.5)].filter(Boolean) };
await doc.transform(dedup(), weld(), prune(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 82, resize: [1024, 1024] }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(outGlb, doc);
fs.writeFileSync(outRig, JSON.stringify(rig));
const b = getBounds(root.listScenes()[0]);
console.log('bounds', b.min.map((x) => x.toFixed(2)), b.max.map((x) => x.toFixed(2)), JSON.stringify(rig));
fs.writeFileSync(outRig + '.pts', JSON.stringify(pts.filter((_, i) => i % 3 === 0).map((p) => p.map((x) => +x.toFixed(2)))));
