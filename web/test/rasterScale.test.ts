// Quantifin addition, 2026-09-29: scanned dimension evidence from OCR and pixels.
import assert from "node:assert/strict";
import test from "node:test";
import { inferMmScaleFromDimensions } from "../src/lib/mmScale";
import { parseOcrTsv, rasterLineSegments } from "../src/lib/rasterScale";

test("OCR words and raster end marks recover millimetres per pixel", () => {
  const width = 420, height = 300;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba.set([255, 255, 255, 255], i);
  const dot = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    rgba.set([0, 0, 0, 255], i);
  };
  for (const [y, len] of [[100, 200], [240, 100]]) {
    for (let x = 100; x <= 100 + len; x++) dot(x, y);
    for (const x of [100, 100 + len]) for (let v = y - 10; v <= y + 10; v++) dot(x, v);
  }
  const tsv = [
    "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
    "5\t1\t1\t1\t1\t1\t180\t75\t40\t16\t94\t6000",
    "5\t1\t1\t1\t2\t1\t130\t215\t40\t16\t92\t3000",
    "5\t1\t1\t1\t2\t2\t0\t0\t20\t20\t10\t9999",
  ].join("\n");
  const words = parseOcrTsv(tsv);
  assert.equal(words.length, 2);
  const lines = rasterLineSegments(rgba, width, height);
  const result = inferMmScaleFromDimensions(words, lines, 1, false);
  assert.ok(result);
  assert.equal(result.label, "按毫米尺寸自动校准（2处一致）");
  assert.equal(result.multi, false);
  assert.ok(Math.abs(result.upp - 6000 / 304.8 / 200) < 0.001);
});
