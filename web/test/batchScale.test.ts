// Quantifin: batch calibration invariants, cancellation and navigation saves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyScaleBatch, calibrationUpp, documentSignature, ratioToUpp, scanScaleBatch } from '../src/lib/batchScale.js';
import { saveAnnotationsQueued, awaitAnnotationWrites } from '../src/lib/annotationWrites.js';

const square = [[0, 0], [1, 0], [1, 1], [0, 1]];
const source = () => ({
  schema: 'opentakeoff.takeoff_canvas.v1', extension: { preserved: true },
  conditions: [], sheets: [{ sheet_id: 'a.pdf', units_per_px: 1, scale_confirmed: false, extra: 'keep' }],
  shapes: [
    { id: 'area', sheet_id: 'a.pdf', measure_role: 'floor_area', verts_norm: square, computed: { area_sf: 100, perimeter_lf: 40 }, origin: { proposed_verts_norm: square } },
    { id: 'count', sheet_id: 'a.pdf', measure_role: 'count', computed: { count: 2.5 } },
    { id: 'line', sheet_id: 'a.pdf#2', measure_role: 'linear', verts_norm: [[0, 0], [1, 0]], computed: { perimeter_lf: 10 } },
  ],
});
test('batch rescale reprices areas/lengths, preserves fractional counts and machine originals', () => {
  const original = source(), snapshot = structuredClone(original);
  const { payload, impact } = applyScaleBatch(original, [
    { sheet_id: 'a.pdf', units_per_px: 2, scale_source: 'standard' },
    { sheet_id: 'a.pdf#2', units_per_px: 3, scale_source: 'dimension' },
  ], { 'a.pdf': { w: 10, h: 10 }, 'a.pdf#2': { w: 10, h: 10 } });
  assert.deepEqual(original, snapshot);
  assert.equal(payload.shapes[0].computed.area_sf, 400);
  assert.equal(payload.shapes[0].computed.perimeter_lf, 80);
  assert.equal(payload.shapes[2].computed.perimeter_lf, 30);
  assert.equal(payload.shapes[1], original.shapes[1]);
  assert.equal(payload.shapes[0].origin, original.shapes[0].origin);
  assert.deepEqual(payload.extension, original.extension);
  assert.equal(payload.sheets[0].extra, 'keep');
  assert.ok(payload.sheets.every((s: any) => s.scale_confirmed));
  assert.equal(impact.length, 2);
});
test('invalid page in a batch leaves the entire input unchanged', () => {
  const original = source(), snapshot = structuredClone(original);
  assert.throws(() => applyScaleBatch(original, [{ sheet_id: 'a.pdf', units_per_px: 2 }, { sheet_id: 'a.pdf#2', units_per_px: 3 }], { 'a.pdf': { w: 10, h: 10 } }), /缺少图纸尺寸/);
  assert.deepEqual(original, snapshot);
  for (const upp of [0, -1, NaN, Infinity]) assert.throws(() => applyScaleBatch(original, [{ sheet_id: 'a.pdf', units_per_px: upp }], {}), /无效/);
});
test('confirming an unchanged scale preserves existing quantities without page geometry', () => {
  const original = source();
  const { payload } = applyScaleBatch(original, [{ sheet_id: 'a.pdf', units_per_px: 1 }], {});
  assert.equal(payload.shapes[0], original.shapes[0]);
  assert.equal(payload.sheets[0].scale_confirmed, true);
});
test('millimetre two-point calibration uses baseline dimensions, not preview zoom', () => {
  assert.equal(calibrationUpp([[0, 0], [0.5, 0]], 3048, { w: 100, h: 200 }), .2);
  assert.throws(() => calibrationUpp([[0, 0], [0, 0]], 3048, { w: 100, h: 200 }));
  assert.ok(Math.abs(ratioToUpp(100) - 100 / 1728) < 1e-10);
});
test('failed scans do not abort later pages, and cancellation prevents new work', async () => {
  const events: any[] = [];
  let stop = false;
  await scanScaleBatch([{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }], async (row: any) => {
    if (row.key === 'a') throw new Error('broken PDF');
    return { proposal: { upp: 1 } };
  }, (key: string, result: any) => { events.push([key, result.state]); if (key === 'c' && result.state === 'found') stop = true; }, () => stop);
  assert.deepEqual(events, [['a', 'running'], ['a', 'error'], ['b', 'running'], ['b', 'found'], ['c', 'running'], ['c', 'found']]);
});
test('document signature ignores property order but detects quantity changes', () => {
  assert.equal(documentSignature({ b: 2, a: 1 }), documentSignature({ a: 1, b: 2 }));
  assert.notEqual(documentSignature({ computed: { area_sf: 1 } }), documentSignature({ computed: { area_sf: 2 } }));
});
test('navigation barrier waits for ordered canvas saves before reading the project', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const written: number[] = [];
  const store = { saveAnnotations: async (n: number) => { if (n === 1) await gate; written.push(n); } };
  const first = saveAnnotationsQueued(store, 1), second = saveAnnotationsQueued(store, 2);
  let ready = false;
  const read = awaitAnnotationWrites(store).then(() => { ready = true; });
  await Promise.resolve(); assert.equal(ready, false); release();
  await Promise.all([first, second, read]); assert.deepEqual(written, [1, 2]); assert.ok(ready);
});
test('navigation does not silently ignore a failed final save', async () => {
  const store = { saveAnnotations: async () => { throw new Error('disk full'); } };
  await assert.rejects(saveAnnotationsQueued(store, {}), /disk full/);
  await assert.rejects(awaitAnnotationWrites(store), /disk full/);
});
