// Run against a Vite dev server with Playwright installed (or PLAYWRIGHT_MODULE).
// Uses a fresh browser context and synthetic drawings; never reads user projects.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { PDFDocument, StandardFonts } = require('../web/node_modules/pdf-lib');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.playwright-mcp', 'batch-scale');
await fs.mkdir(output, { recursive: true });
const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
for (const scale of [100, 50]) {
  const p = pdf.addPage([595, 420]);
  p.drawText(`SCALE 1:${scale}`, { x: 380, y: 30, font, size: 16 });
  for (const [y, mm] of [[280, 6000], [160, 3000]]) {
    const x1 = 60, x2 = x1 + mm / scale * 72 / 25.4;
    p.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: 1 });
    for (const x of [x1, x2]) p.drawLine({ start: { x, y: y - 8 }, end: { x, y: y + 8 }, thickness: 1 });
    const text = String(mm);
    p.drawText(text, { x: (x1 + x2 - font.widthOfTextAtSize(text, 12)) / 2, y: y + 10, size: 12, font });
  }
}
const bytes = Array.from(await pdf.save());
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1540, height: 1050 } });
const page = await context.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
const base = process.env.TEST_URL || 'http://127.0.0.1:5173';
try {
  await page.goto(base + '/scale-review');
  await page.getByRole('heading', { name: '还没有导入图纸' }).waitFor();
  await page.evaluate(async bytes => {
    const { store } = await import('/src/lib/store.js');
    await store.addPdf(new File([new Uint8Array(bytes)], '批量验收.pdf', { type: 'application/pdf' }));
  }, bytes);
  await page.reload();
  const all = page.getByRole('checkbox', { name: '全选筛选结果' });
  await all.waitFor(); await all.check();
  await page.getByRole('button', { name: '一键识别选中图纸', exact: true }).click();
  await page.getByText('识别完成。核对后点击', { exact: false }).waitFor({ timeout: 60000 });
  assert.equal(await page.getByText('多处尺寸证据', { exact: true }).count(), 2);
  await page.getByRole('button', { name: '采用选中建议', exact: true }).click();
  await page.getByRole('button', { name: '保存 2 张修改', exact: true }).click();
  await page.getByRole('button', { name: '确认并保存', exact: true }).click();
  await page.getByText('已保存并确认 2 张', { exact: false }).waitFor();
  const data = await page.evaluate(async () => (await import('/src/lib/store.js')).store.loadAnnotations());
  assert.equal(data.sheets.length, 2); assert.ok(data.sheets.every(s => s.scale_confirmed));
  assert.ok(Math.abs(data.sheets[0].units_per_px - 100 / 1728) < 1e-5);
  await page.screenshot({ path: path.join(output, 'scale-review.png'), fullPage: true });
  // Navigate through the real canvas and gallery; the save barrier must finish
  // before the scale-review page loads the project again.
  await page.getByRole('button', { name: '返回算量工作区 →', exact: true }).click();
  await page.getByRole('link', { name: '批量比例尺核对', exact: true }).click();
  await page.getByRole('heading', { name: '比例尺核对', exact: true }).waitFor();
  await all.waitFor();
  // Seed a known measured square, then prove changing scale reprices stored quantities.
  await page.evaluate(async () => {
    const { store } = await import('/src/lib/store.js'), d = await store.loadAnnotations();
    d.shapes = [{ id: 'fixture-area', sheet_id: '批量验收.pdf', measure_role: 'floor_area', verts_norm: [[0,0],[.1,0],[.1,.1],[0,.1]], computed: { area_sf: 1, perimeter_lf: 1 } }, { id: 'fixture-count', sheet_id: '批量验收.pdf', measure_role: 'count', computed: { count: 2.5 } }];
    await store.saveAnnotations(d);
  });
  await page.reload(); await all.check();
  await page.getByRole('spinbutton', { name: '比例尺分母' }).fill('200');
  await page.getByRole('button', { name: '应用到选中图纸', exact: true }).click();
  await page.getByRole('button', { name: '保存 2 张修改', exact: true }).click();
  await page.getByRole('button', { name: '确认并保存', exact: true }).click();
  await page.getByText('已保存并确认 2 张', { exact: false }).waitFor();
  const after = await page.evaluate(async () => (await import('/src/lib/store.js')).store.loadAnnotations());
  assert.ok(after.shapes[0].computed.area_sf > 100); assert.equal(after.shapes[1].computed.count, 2.5);
  const snapshots = await page.evaluate(async () => (await import('/src/lib/store.js')).store.listSnapshots());
  assert.equal(snapshots.length, 2);
  // Detect an external edit; do not overwrite it.
  await page.getByRole('button', { name: '确认选中当前比例尺', exact: true }).click();
  await page.evaluate(async () => { const { store } = await import('/src/lib/store.js'); const d = await store.loadAnnotations(); await store.saveAnnotations({ ...d, project_name: 'concurrent edit' }); });
  await page.getByRole('button', { name: '保存 2 张修改', exact: true }).click();
  await page.getByRole('button', { name: '确认并保存', exact: true }).click();
  await page.getByRole('button', { name: '重新载入项目' }).waitFor();
  assert.equal((await page.evaluate(async () => (await import('/src/lib/store.js')).store.loadAnnotations())).project_name, 'concurrent edit');
  // Isolated scan-only context: a PNG ratio alone must remain unapplicable.
  const scanContext = await browser.newContext({ viewport: { width: 1540, height: 1050 } });
  console.log('Vector PDF, rescale, snapshot, conflict: passed');
  const scanPage = await scanContext.newPage();
  scanPage.on('console', m => console.log('scan:', m.type(), m.text()));
  scanPage.on('requestfailed', r => console.log('scan request:', r.url(), r.failure())); scanPage.on('pageerror', e => errors.push(e.message));
  await scanPage.goto(base + '/');
  await scanPage.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1200, 800); ctx.fillStyle = '#000'; ctx.font = '48px Arial'; ctx.fillText('SCALE 1:100', 500, 650);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const { ingestFiles } = await import('/src/lib/ingest.js'); const { store } = await import('/src/lib/store.js');
    for (const file of (await ingestFiles([new File([blob], '扫描验收.png', { type: 'image/png' })])).pdfs) await store.addPdf(file);
  });
  await scanPage.goto(base + '/scale-review');
  await scanPage.getByRole('checkbox', { name: '全选筛选结果' }).check();
  await scanPage.getByRole('button', { name: '一键识别选中图纸', exact: true }).click();
  await scanPage.getByText('识别完成。核对后点击', { exact: false }).waitFor({ timeout: 60000 }).catch(async e => { console.log(await scanPage.locator('body').innerText()); await scanPage.screenshot({ path: path.join(output, 'scan-failed.png') }); throw e; });
  await scanPage.getByRole('button', { name: '采用选中建议', exact: true }).click();
  assert.ok(await scanPage.getByRole('button', { name: '保存 0 张修改', exact: true }).isDisabled());
  await scanPage.getByRole('button', { name: '应用到选中图纸', exact: true }).click();
  await scanPage.getByText('扫描图不能仅凭纸面比例修改', { exact: false }).waitFor();
  const overlay = scanPage.locator('.sr-paper svg'); await overlay.waitFor();
  const box = await overlay.boundingBox();
  await overlay.click({ position: { x: box.width * .2, y: box.height * .5 } });
  await overlay.click({ position: { x: box.width * .7, y: box.height * .5 } });
  await scanPage.getByRole('spinbutton', { name: '已知尺寸毫米' }).fill('6000');
  await scanPage.getByRole('button', { name: '记录两点校准', exact: true }).click();
  await scanPage.getByRole('button', { name: '保存 1 张修改', exact: true }).click();
  await scanPage.getByRole('button', { name: '确认并保存', exact: true }).click();
  await scanPage.getByText('已保存并确认 1 张', { exact: false }).waitFor();
  await scanPage.screenshot({ path: path.join(output, 'scan-calibration.png'), fullPage: true });
  await scanContext.close();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: ['empty state','multi-page batch detection','batch acceptance','batch quantity recalculation','fractional counts','snapshots','concurrent edit refusal','PNG OCR guard','manual calibration'], snapshots: snapshots.length, errors, screenshots: output }, null, 2));
} finally { await browser.close(); }
