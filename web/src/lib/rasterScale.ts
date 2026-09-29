// Quantifin addition, 2026-09-29: extract OCR words and raster dimension lines.
import type { MmText } from "./mmScale";

export interface OcrWord extends MmText {
  confidence: number;
}

export function parseOcrTsv(tsv: string, scaleX = 1, scaleY = scaleX): OcrWord[] {
  const rows = (tsv || "").split(/\r?\n/);
  const header = rows.shift()?.split("\t") || [];
  const column = Object.fromEntries(header.map((name, index) => [name, index]));
  if (column.text == null || column.conf == null) return [];
  const words: OcrWord[] = [];
  for (const row of rows) {
    if (!row.trim()) continue;
    const fields = row.split("\t");
    if (Number(fields[column.level]) !== 5) continue;
    const confidence = Number(fields[column.conf]);
    const text = fields.slice(column.text).join("\t").trim();
    if (!(confidence >= 80) || !text) continue;
    const x = Number(fields[column.left]), y = Number(fields[column.top]);
    const width = Number(fields[column.width]), height = Number(fields[column.height]);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) continue;
    words.push({ text, x: x * scaleX, y: y * scaleY, width: width * scaleX, height: height * scaleY, confidence });
  }
  return words;
}

export function rasterLineSegments(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  scaleX = 1,
  scaleY = scaleX,
): number[] {
  if (rgba.length < width * height * 4 || width < 2 || height < 2) return [];
  const dark = (x: number, y: number): boolean => {
    const i = (y * width + x) * 4;
    return rgba[i + 3] >= 128 && rgba[i] + rgba[i + 1] + rgba[i + 2] < 420;
  };
  const segments: number[] = [];
  const maxSegments = 30000;
  // Long horizontal runs are candidate dimension lines. Short perpendicular
  // runs supply their end marks; both directions are needed for the inference
  // gate. Sampling every row/column keeps single-pixel scan lines visible.
  for (let y = 0; y < height && segments.length < maxSegments * 4; y++) {
    let start = -1;
    for (let x = 0; x <= width; x++) {
      if (x < width && dark(x, y)) {
        if (start < 0) start = x;
      } else if (start >= 0) {
        if (x - start >= 25) segments.push(start * scaleX, y * scaleY, (x - 1) * scaleX, y * scaleY);
        start = -1;
      }
    }
  }
  for (let x = 0; x < width && segments.length < maxSegments * 4; x++) {
    let start = -1;
    for (let y = 0; y <= height; y++) {
      if (y < height && dark(x, y)) {
        if (start < 0) start = y;
      } else if (start >= 0) {
        if (y - start >= 6) segments.push(x * scaleX, start * scaleY, x * scaleX, (y - 1) * scaleY);
        start = -1;
      }
    }
  }
  return segments;
}
