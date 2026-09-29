// Quantifin addition: pure batch calibration, preserving the existing document format.
import { recalibrateShapes } from './shapeMetrics.js';
import { RENDER_SCALE } from './takeoffConstants.ts';

export const ratioToUpp = (ratio) => Number(ratio) / (12 * 72 * RENDER_SCALE);
export const scaleLabel = (upp) => upp > 0 ? `1:${Number((upp * 12 * 72 * RENDER_SCALE).toFixed(2))}` : '未设置';
export function calibrationUpp(points, mm, dims) {
  if (points.length !== 2 || !(Number(mm) > 0)) throw new Error('请选择两个端点并输入正数毫米尺寸。');
  const distance = Math.hypot((points[1][0] - points[0][0]) * dims.w, (points[1][1] - points[0][1]) * dims.h);
  if (!(distance > 1)) throw new Error('两个端点距离太近，请重新选择。');
  return Number(mm) / 304.8 / distance;
}

// Deterministic comparison: a different property order is not a concurrent edit.
export function documentSignature(value) {
  if (Array.isArray(value)) return '[' + value.map(documentSignature).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + documentSignature(value[k])).join(',') + '}';
  return JSON.stringify(value);
}

export function applyScaleBatch(document, changes, dimensions) {
  if (!changes.length) throw new Error('没有可保存的修改。');
  const sheets = new Map((document.sheets || []).map(row => [row.sheet_id, row]));
  const shapesBySheet = new Map();
  for (const shape of document.shapes || []) {
    const list = shapesBySheet.get(shape.sheet_id) || [];
    list.push(shape); shapesBySheet.set(shape.sheet_id, list);
  }
  const replacements = new Map();
  const seen = new Set();
  const impact = [];
  for (const change of changes) {
    const { sheet_id: key, units_per_px: upp } = change;
    if (!key || seen.has(key) || !Number.isFinite(upp) || upp <= 0) throw new Error('比例尺无效或图纸重复，请检查修改。');
    seen.add(key);
    const before = sheets.get(key);
    const originals = shapesBySheet.get(key) || [];
    const changed = before?.units_per_px !== upp;
    const dims = dimensions[key];
    if (changed && originals.some(s => s.measure_role !== 'count') && (!(dims?.w > 0) || !(dims?.h > 0))) throw new Error(`${key} 缺少图纸尺寸，未保存任何修改。`);
    const updated = changed && originals.some(s => s.measure_role !== 'count')
      ? recalibrateShapes(originals, dims, upp, document.conditions || []) : originals;
    updated.forEach(s => replacements.set(s.id, s));
    sheets.set(key, { ...before, sheet_id: key, units_per_px: upp, scale_source: change.scale_source || before?.scale_source || 'standard', scale_confirmed: true });
    const sum = (list, field) => list.reduce((n, s) => n + (Number(s.computed?.[field]) || 0), 0);
    impact.push({ key, before: before?.units_per_px, after: upp, count: originals.length,
      areaBefore: sum(originals, 'area_sf') * 0.09290304, areaAfter: sum(updated, 'area_sf') * 0.09290304,
      lengthBefore: sum(originals, 'perimeter_lf') * 0.3048, lengthAfter: sum(updated, 'perimeter_lf') * 0.3048 });
  }
  return { payload: { ...document, sheets: [...sheets.values()], shapes: (document.shapes || []).map(s => replacements.get(s.id) || s) }, impact };
}

// Serial queue; a failed page does not discard successful pages. Cancellation
// stops scheduling, and also tells the scanner to discard its in-flight result.
export async function scanScaleBatch(rows, scan, onResult, cancelled = () => false) {
  for (let index = 0; index < rows.length; index++) {
    if (cancelled()) break;
    const row = rows[index];
    onResult(row.key, { state: 'running' }, index);
    try {
      const result = await scan(row, cancelled);
      if (cancelled()) break;
      onResult(row.key, { ...result, state: result.proposal ? 'found' : 'none' }, index + 1);
    } catch (error) {
      if (cancelled()) break;
      onResult(row.key, { state: 'error', error: String(error.message || error) }, index + 1);
    }
  }
}
