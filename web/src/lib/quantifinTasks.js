// Read-only project checklist. A task describes evidence and where to resolve it;
// it never writes a measurement or claims that an unmeasured sheet is complete.
/** @param {{files?: {name: string}[], pages?: string[] | null, annotations?: {shapes?: any[], conditions?: any[], sheets?: any[]}}} project */
export function buildQuantifinTasks({ files = [], pages = null, annotations = {} } = {}) {
  const shapes = annotations.shapes || [];
  const conditions = annotations.conditions || [];
  const scales = new Map((annotations.sheets || []).map(s => [s.sheet_id, s]));
  const conditionIds = new Set(conditions.map(c => c.id));
  const tasks = [];
  const add = (type, title, detail, evidence, action, href, priority = 2) =>
    tasks.push({ id: `${type}:${evidence}:${tasks.length}`, type, title, detail, evidence, action, href, priority });
  const canvas = sheet => `/takeoff?sheet=${encodeURIComponent(sheet)}`;
  const scalePage = sheet => `/scale-review?sheet=${encodeURIComponent(sheet)}`;

  if (!files.length) {
    add('import', '导入项目图纸', '先归集平面、立面、节点和做法表；招标文件目前仍需人工核对。', '当前无图纸', '导入图纸', '/', 0);
    return tasks;
  }
  if (!pages) {
    add('read', '核对无法读取的图纸', '有 PDF 页数读取失败，暂不能判断比例尺和测量范围是否完整。', '图纸页数未知', '查看图纸', '/scale-review', 0);
  } else {
    for (const sheet of pages) {
      const scale = scales.get(sheet);
      if (!(scale?.units_per_px > 0 && scale.scale_confirmed !== false))
        add('scale', `确认比例尺 · ${sheet}`, scale?.units_per_px > 0 ? '已有自动结果，仍需按图纸毫米尺寸核对。' : '尚无可靠的已确认比例尺。', sheet, '核对比例尺', scalePage(sheet), 0);
      if (!shapes.some(shape => shape.sheet_id === sheet))
        add('scope', `检查测量范围 · ${sheet}`, '此页没有测量记录；它可能是封面、索引或非计量页，请确认是否需要算量。', sheet, '查看原图', canvas(sheet), 1);
    }
  }
  for (const shape of shapes) {
    if (!conditionIds.has(shape.condition_id))
      add('unassigned', `关联饰面 · ${shape.label || shape.id || '测量记录'}`, '测量记录未关联有效饰面，可能未进入按饰面汇总。', shape.sheet_id || '图纸未知', '查看测量', canvas(shape.sheet_id || ''), 0);
    if (shape.origin?.reviewed === false)
      add('review', `复核提议 · ${shape.label || shape.id || '测量记录'}`, '机器提议明确标为待人工复核，请在原图确认边界与数量。', shape.sheet_id || '图纸未知', '在图上复核', canvas(shape.sheet_id || ''), 0);
  }
  const measuredIds = new Set(shapes.map(shape => shape.condition_id));
  for (const condition of conditions.filter(c => measuredIds.has(c.id))) {
    const finish = condition.finish_tag || condition.id;
    if (!(condition.materials || []).some(m => m?.name))
      add('materials', `核对辅材做法 · ${finish}`, '该已测饰面未配置辅材；可能确实无需辅材，请对照做法表确认。', finish, '配置材料', '/takeoff', 2);
    for (const material of (condition.materials || []).filter(m => m?.name && !(Number(m.per) > 0 && Number.isFinite(Number(m.per)))))
      add('coverage', `补全覆盖率 · ${material.name}`, '覆盖率无效时计算结果可能显示 0，不能当作无需采购。', finish, '修正参数', '/takeoff', 0);
  }
  if (shapes.length) add('final', '人工确认图纸范围', '系统无法证明所有房间、立面和节点都已量全；交付前请逐页对照招标范围。', '全项目', '查看复核项', '#review', 3);
  return tasks.sort((a, b) => a.priority - b.priority);
}
