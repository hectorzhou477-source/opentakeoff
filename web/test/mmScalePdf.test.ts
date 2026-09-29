// Quantifin addition, 2026-09-29: end-to-end PDF coordinate evidence.
import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractVectorGeometry } from '../src/lib/oneclick';
import { detectDimensionScale } from '../src/lib/sheets';
import { RENDER_SCALE } from '../src/lib/takeoffConstants';
test('CAD-style PDF dimensions infer 1:100 from two mm annotations', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([595, 420]);
  const font = await source.embedFont(StandardFonts.Helvetica);
  for (const [y, mm] of [[320, 6000], [190, 3000]]) {
    const x1 = 90, x2 = x1 + mm / 100 * 72 / 25.4;
    page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: 0.5 });
    for (const x of [x1, x2]) page.drawLine({ start: { x, y: y - 7 }, end: { x, y: y + 7 }, thickness: 0.5 });
    const label = String(mm);
    page.drawText(label, { x: (x1 + x2 - font.widthOfTextAtSize(label, 12)) / 2, y: y + 9, size: 12, font });
  }
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await source.save()) }).promise;
  try {
    const sheet = await pdf.getPage(1);
    const viewport = sheet.getViewport({ scale: RENDER_SCALE });
    const geometry = extractVectorGeometry(await sheet.getOperatorList(), viewport.transform, pdfjs.OPS);
    const found = detectDimensionScale(await sheet.getTextContent(), viewport, geometry.segs);
    assert.ok(found);
    assert.equal(found.evidenceCount, 2);
    assert.equal(found.multi, false);
    assert.ok(Math.abs(found.upp - 100 / (72 * RENDER_SCALE * 12)) < 0.000001);
  } finally { await pdf.destroy(); }
});
