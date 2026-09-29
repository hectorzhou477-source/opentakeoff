// Quantifin addition, 2026-09-29: dimension evidence must not guess a sheet-wide scale.
import assert from "node:assert/strict";
import test from "node:test";
import { inferMmScaleFromDimensions } from "../src/lib/mmScale";
import { RENDER_SCALE } from "../src/lib/takeoffConstants";

const pxPerPaperMm = 72 * RENDER_SCALE / 25.4;
const dimension = (millimetres: number, ratio: number, y: number) => {
  const length = millimetres * pxPerPaperMm / ratio;
  const x1 = 100, x2 = x1 + length;
  return {
    text: { text: String(millimetres), x: (x1 + x2) / 2 - 25, y: y - 24, width: 50, height: 15 },
    segments: [
      x1, y, x2, y,
      x1, y - 10, x1, y + 10,
      x2, y - 10, x2, y + 10,
    ],
    length,
  };
};

test("two independent millimetre dimensions infer the printed scale", () => {
  const a = dimension(6000, 100, 100);
  const b = dimension(3000, 100, 250);
  const found = inferMmScaleFromDimensions([a.text, b.text], [...a.segments, ...b.segments], pxPerPaperMm);
  assert.ok(found);
  assert.equal(found.label, "毫米尺寸推算约 1:100（2处一致）");
  assert.equal(found.multi, false);
  assert.equal(found.evidenceCount, 2);
  assert.ok(Math.abs(found.upp - 6000 / 304.8 / a.length) < 1e-10);
});

test("a lone number or a line without end witnesses cannot set the scale", () => {
  const a = dimension(6000, 100, 100);
  assert.equal(inferMmScaleFromDimensions([a.text], a.segments, pxPerPaperMm), null);
  const b = dimension(3000, 100, 250);
  assert.equal(inferMmScaleFromDimensions([a.text, b.text], [...a.segments, ...b.segments.slice(0, 4)], pxPerPaperMm), null);
});

test("conflicting dimension scales are flagged for manual review", () => {
  const a = dimension(6000, 100, 100);
  const b = dimension(3000, 100, 250);
  const c = dimension(4000, 50, 400);
  const found = inferMmScaleFromDimensions([a.text, b.text, c.text], [...a.segments, ...b.segments, ...c.segments], pxPerPaperMm);
  assert.ok(found);
  assert.equal(found.multi, true);
  assert.equal(found.evidenceCount, 2);
});
