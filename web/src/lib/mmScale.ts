// Quantifin addition, 2026-09-29: conservative millimetre dimension scale inference.
export interface MmText {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  vertical?: boolean;
}

export interface MmScaleEvidence {
  upp: number;
  label: string;
  multi: boolean;
  evidenceCount: number;
}

interface Witness {
  ratio: number;
  upp: number;
  line: number;
}

const METRIC_RATIOS = [10, 20, 25, 30, 40, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 1000];
const MM_PER_FOOT = 304.8;

function nearestRatio(value: number): number {
  return METRIC_RATIOS.reduce((best, next) =>
    Math.abs(next - value) < Math.abs(best - value) ? next : best);
}

/**
 * Infer a drawing scale from independently marked dimension lines. Text values
 * are millimetres even when they omit the suffix. The flat segments use the
 * same image-pixel frame as the text boxes; pxPerPaperMm describes that frame.
 * This is deliberately conservative: conflicting details and a lone plausible
 * wall number never set a sheet-wide scale.
 */
export function inferMmScaleFromDimensions(
  texts: MmText[],
  segments: ArrayLike<number>,
  pxPerPaperMm: number,
  validatePaperRatio = true,
): MmScaleEvidence | null {
  if (!(pxPerPaperMm > 0) || segments.length < 8) return null;
  const lines: { x1: number; y1: number; x2: number; y2: number; len: number; vertical: boolean; index: number }[] = [];
  for (let i = 0; i + 3 < segments.length; i += 4) {
    const x1 = segments[i], y1 = segments[i + 1], x2 = segments[i + 2], y2 = segments[i + 3];
    if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    if (len < 4) continue;
    lines.push({ x1, y1, x2, y2, len, vertical: Math.abs(dy) > Math.abs(dx), index: i });
  }
  // The exact endpoints of dimension lines normally touch extension lines or
  // ticks. A spatial index keeps this check bounded on dense CAD drawings.
  const cell = 12;
  const endpointGrid = new Map<string, number[]>();
  const addEndpoint = (x: number, y: number, index: number) => {
    const key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
    const bucket = endpointGrid.get(key) || [];
    bucket.push(index);
    endpointGrid.set(key, bucket);
  };
  lines.forEach((line, index) => {
    addEndpoint(line.x1, line.y1, index);
    addEndpoint(line.x2, line.y2, index);
  });
  const hasEndMark = (x: number, y: number, base: number, vertical: boolean): boolean => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
      for (const index of endpointGrid.get(`${gx},${gy}`) || []) {
        if (index === base) continue;
        const mark = lines[index];
        if (mark.len < 4 || mark.len > 300) continue;
        const dx = Math.abs(mark.x2 - mark.x1), dy = Math.abs(mark.y2 - mark.y1);
        if (vertical ? dx < dy * 0.5 : dy < dx * 0.5) continue;
        const vx = mark.x2 - mark.x1, vy = mark.y2 - mark.y1;
        const t = Math.max(0, Math.min(1, ((x - mark.x1) * vx + (y - mark.y1) * vy) / (mark.len * mark.len)));
        if (Math.hypot(mark.x1 + t * vx - x, mark.y1 + t * vy - y) <= 8) return true;
      }
    }
    return false;
  };
  const witnesses: Witness[] = [];
  for (const text of texts) {
    const normalized = text.text.trim().replace(/[,，\s]/g, "");
    if (!/^\d{3,6}(?:mm)?$/i.test(normalized)) continue;
    const mm = Number(normalized.replace(/mm$/i, ""));
    if (!(mm >= 100 && mm <= 100000)) continue;
    const vertical = !!text.vertical;
    const center = vertical ? text.y + text.height / 2 : text.x + text.width / 2;
    const perpendicular = vertical ? text.x + text.width / 2 : text.y + text.height / 2;
    let best: (Witness & { distance: number }) | null = null;
    for (let j = 0; j < lines.length; j++) {
      const line = lines[j];
      if (line.vertical !== vertical || line.len < 25) continue;
      const run = vertical ? Math.abs(line.y2 - line.y1) : Math.abs(line.x2 - line.x1);
      const drift = vertical ? Math.abs(line.x2 - line.x1) : Math.abs(line.y2 - line.y1);
      if (drift > Math.max(2, run * 0.005)) continue;
      const start = vertical ? Math.min(line.y1, line.y2) : Math.min(line.x1, line.x2);
      const end = vertical ? Math.max(line.y1, line.y2) : Math.max(line.x1, line.x2);
      if (center < start + run * 0.1 || center > end - run * 0.1) continue;
      const cross = vertical ? (line.x1 + line.x2) / 2 : (line.y1 + line.y2) / 2;
      const distance = Math.abs(perpendicular - cross);
      if (distance > Math.max(25, (vertical ? text.width : text.height) * 3)) continue;
      if (!hasEndMark(line.x1, line.y1, j, vertical) || !hasEndMark(line.x2, line.y2, j, vertical)) continue;
      const ratio = mm * pxPerPaperMm / run;
      const named = nearestRatio(ratio);
      if (validatePaperRatio && Math.abs(ratio - named) / named > 0.06) continue;
      if (!best || distance < best.distance) best = { ratio, upp: mm / MM_PER_FOOT / run, line: line.index, distance };
    }
    if (best && !witnesses.some((w) => w.line === best.line)) witnesses.push(best);
  }
  if (witnesses.length < 2) return null;
  const sorted = witnesses.map((w) => w.ratio).sort((a, b) => a - b);
  const center = sorted[Math.floor(sorted.length / 2)];
  const agreeing = witnesses.filter((w) => Math.abs(w.ratio - center) / center <= 0.03);
  if (agreeing.length < 2) return null;
  const values = agreeing.map((w) => w.upp).sort((a, b) => a - b);
  return {
    upp: values[Math.floor(values.length / 2)],
    label: validatePaperRatio ? `毫米尺寸推算约 1:${nearestRatio(center)}（${agreeing.length}处一致）` : `按毫米尺寸自动校准（${agreeing.length}处一致）`,
    multi: agreeing.length !== witnesses.length,
    evidenceCount: agreeing.length,
  };
}
