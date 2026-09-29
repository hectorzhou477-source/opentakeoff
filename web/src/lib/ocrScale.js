// Quantifin addition, 2026-09-29: browser-local OCR scale evidence for scanned pages.
import { createWorker } from "tesseract.js";
import { detectScale, RENDER_SCALE } from "./sheets";
import { inferMmScaleFromDimensions } from "./mmScale";
import { parseOcrTsv, rasterLineSegments } from "./rasterScale";

let workerPromise;
let queue = Promise.resolve();
const ocrRoot = new URL(`${import.meta.env.BASE_URL}ocr/`, window.location.origin).href.replace(/\/$/, "");

function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker("eng", 1, {
      workerPath: `${ocrRoot}/worker.min.js`,
      corePath: `${ocrRoot}/core`,
      langPath: `${ocrRoot}/lang`,
      workerBlobURL: false,
    }).catch((error) => { workerPromise = null; throw error; });
  }
  return workerPromise;
}

async function scan(page, baselineViewport, stale) {
  if (stale()) return null;
  const maxEdge = 3000;
  const ratio = Math.min(1, maxEdge / Math.max(baselineViewport.width, baselineViewport.height));
  const viewport = page.getViewport({ scale: RENDER_SCALE * ratio });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;
  if (stale()) return null;
  const worker = await getWorker();
  if (stale()) return null;
  const { data } = await worker.recognize(canvas, {}, { tsv: true });
  if (stale()) return null;
  const sx = baselineViewport.width / viewport.width;
  const sy = baselineViewport.height / viewport.height;
  const words = parseOcrTsv(data.tsv, sx, sy);
  if (!words.length) return null;
  const textContent = { items: words.map((word) => ({
    str: word.text,
    transform: [1, 0, 0, 1, word.x, word.y + word.height],
    width: word.width,
    height: word.height,
  })) };
  const note = detectScale(textContent, {
    width: baselineViewport.width,
    height: baselineViewport.height,
    transform: [1, 0, 0, 1, 0, 0],
  });
  const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const segments = rasterLineSegments(rgba, canvas.width, canvas.height, sx, sy);
  const dimensions = inferMmScaleFromDimensions(words, segments, 1, false);
  if (dimensions) {
    const conflicts = note && Math.abs(note.upp - dimensions.upp) / dimensions.upp > 0.05;
    return {
      ...dimensions,
      method: "ocr",
      multi: dimensions.multi || !!conflicts,
      label: conflicts ? `${dimensions.label}（与 OCR 比例标注冲突）` : dimensions.label,
      reason: conflicts ? "比例标注与毫米尺寸推算不一致，请手动校准。" : undefined,
    };
  }
  // An OCR ratio alone cannot prove a scan's pixel density. In particular,
  // images wrapped as PDF have pixels-as-points, not the original paper size.
  // Keep the note visible as a suggestion, but do not auto-apply it.
  return note ? {
    ...note,
    method: "ocr",
    auto: false,
    label: `OCR 读到 ${note.label}`,
    reason: "扫描图纸尚无两处一致的毫米尺寸证据，请人工核对比例尺。",
  } : null;
}

export function detectRasterScale(page, baselineViewport, stale = () => false) {
  const next = queue.catch(() => {}).then(() => scan(page, baselineViewport, stale));
  queue = next.then(() => {}, () => {});
  return next;
}
