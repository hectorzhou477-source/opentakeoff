// Quantifin addition: shared local PDF / image scale scanner. Imported images
// already use the same PDF page storage adapter as vector drawings.
import * as pdfjs from 'pdfjs-dist';
import { detectScale, detectDimensionScale, RENDER_SCALE } from './sheets';
import { extractVectorGeometry } from './oneclick';

export async function inspectScalePage(page) {
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const [text, operators] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
  const geometry = extractVectorGeometry(operators, viewport.transform, pdfjs.OPS);
  const raster = geometry.imageArea / (viewport.width * viewport.height) >= 0.35;
  return { viewport, text, geometry, raster, dims: { w: Math.ceil(viewport.width), h: Math.ceil(viewport.height) } };
}

export async function scanScalePage(page, cancelled = () => false) {
  const { viewport, text, geometry, raster, dims } = await inspectScalePage(page);
  if (cancelled()) return {};
  const note = detectScale(text, viewport);
  const dimensions = !raster ? detectDimensionScale(text, viewport, geometry.segs) : null;
  let proposal = dimensions || note;
  if (raster) {
    const { detectRasterScale } = await import('./ocrScale.js');
    proposal = await detectRasterScale(page, viewport, cancelled);
  } else if (note && dimensions) {
    const conflict = Math.abs(note.upp - dimensions.upp) / dimensions.upp > 0.05;
    proposal = { ...dimensions, multi: note.multi || dimensions.multi || conflict,
      reason: conflict ? '比例标注与毫米尺寸推算不一致，请在原图校准。' : `比例标注 ${note.label} 与 ${dimensions.evidenceCount} 处毫米尺寸相符。` };
  }
  if (proposal?.multi) proposal = { ...proposal, auto: false, reason: proposal.reason || '图纸包含多个比例或不一致尺寸，请人工核对并校准。' };
  const evidence = proposal?.reason || (proposal?.evidenceCount ? `${proposal.evidenceCount} 处毫米尺寸一致；仍需人工核对。` : proposal ? '读取图纸比例标注；请用已知尺寸核对。' : '未找到可靠比例尺，请两点校准。');
  return { proposal, dims, raster, evidence };
}
