// Quantifin addition, 2026-09-29: stage lazy browser OCR files from pinned packages.
import { copyFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = join(root, "public", "ocr");
const coreSource = join(root, "node_modules", "tesseract.js-core");
const coreDestination = join(destination, "core");
const coreNames = [
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-lstm.wasm",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm",
  "tesseract-core-relaxedsimd-lstm.wasm.js",
  "tesseract-core-relaxedsimd-lstm.wasm",
];

function copyIfChanged(from, to) {
  try {
    if (statSync(from).size === statSync(to).size) return;
  } catch { /* destination not staged yet */ }
  copyFileSync(from, to);
}

export function prepareOcrAssets() {
  mkdirSync(coreDestination, { recursive: true });
  mkdirSync(join(destination, "lang"), { recursive: true });
  copyIfChanged(join(root, "node_modules", "tesseract.js", "LICENSE.md"), join(destination, "TESSERACT-JS-LICENSE.md"));
  copyIfChanged(join(coreSource, "LICENSE"), join(destination, "TESSERACT-CORE-LICENSE"));
  writeFileSync(join(destination, "NOTICE.txt"), "Quantifin OCR assets: Tesseract.js 7.0.0 (Apache-2.0); tesseract.js-core 7.0.0 (Apache-2.0); @tesseract.js-data/eng 1.0.0 (MIT package, Apache-2.0 trained data). See adjacent license files and the source repository THIRD-PARTY-NOTICES.md.\\n");
  copyIfChanged(join(root, "node_modules", "tesseract.js", "dist", "worker.min.js"),
    join(destination, "worker.min.js"));
  for (const name of coreNames) copyIfChanged(join(coreSource, name), join(coreDestination, name));
  copyIfChanged(join(root, "node_modules", "@tesseract.js-data", "eng", "4.0.0_best_int", "eng.traineddata.gz"),
    join(destination, "lang", "eng.traineddata.gz"));
}
