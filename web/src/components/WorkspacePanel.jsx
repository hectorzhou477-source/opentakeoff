// Modified by Quantifin, 2026-09-28: localize user-facing editor labels; preserve data keys.
import { useEffect, useMemo, useState } from "react";
import { filterWork, workActor, workMethod, workQuantity, workReviewState } from "../lib/workReview.js";
import { Z } from "../lib/ui.js";
import "./workspacePanel.css";

const reviewLabel = (s) => ({ "Needs review": "待人工复核", Reviewed: "已人工复核", Recorded: "已记录（未标复核）" })[workReviewState(s)];
const actorLabel = (s) => ({ Agent:"AI 提议", Rule:"规则生成", Canvas:"画布测量", "Named author":"具名作者", "Not recorded":"未记录" })[workActor(s)];
export default function WorkspacePanel({ open, shapes, conditions, selectedId, sheetLabel, fmtArea, fmtLength,
  scales, scaleUnconfirmed, running, proposalCount, onLocate, onReview, onClose, onReport, children, dockSide, width, dockHandle }) {
  const [tab, setTab] = useState("work");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(50);
  const pending = shapes.filter((s) => workReviewState(s) === "Needs review").length;
  const rows = useMemo(() => filterWork(shapes, { filter, query,
    conditionLabel: (id) => conditions[id]?.finish_tag || "", sheetLabel }), [shapes, filter, query, conditions, sheetLabel]);
  const selected = shapes.find((s) => s.id === selectedId);
  useEffect(() => { setLimit(50); }, [filter, query]);
  const quantity = (shape) => {
    const q = workQuantity(shape);
    if (q.value === null) return "尚未测量";
    const text = q.kind === "count" ? `${q.value} EA` : q.kind === "length" ? fmtLength(q.value) : fmtArea(q.value);
    return `${q.deduct ? "−" : ""}${text}`;
  };
  const evidence = selected?.origin?.evidence || {};
  return (
    <aside className="workspace-panel" hidden={!open} aria-label="测量与复核" data-dock-side={dockSide} style={{ zIndex: Z.drawer, ...(dockSide ? { order: dockSide === "left" ? -10 : 10, width } : {}) }} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
      <header className="workspace-heading">
        {dockHandle}
        <div><span className="workspace-eyebrow">图量关联 · 复核留痕</span><h2>测量与复核</h2></div>
        <button type="button" onClick={onClose} aria-label="关闭复核面板">×</button>
      </header>
      <div className="workspace-summary">
        <div><strong>{shapes.length}</strong><span>测量记录</span></div>
        <div><strong>{pending}</strong><span>待复核</span></div>
        <div><strong>{new Set(shapes.map((s) => s.sheet_id)).size}</strong><span>已测图纸</span></div>
      </div>
      <div className="workspace-tabs" role="tablist" aria-label="复核视图" onKeyDown={(e) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
        e.preventDefault();
        const next = e.key === "Home" ? "work" : e.key === "End" ? "agent" : tab === "work" ? "agent" : "work";
        setTab(next); document.getElementById(`workspace-${next}-tab`)?.focus();
      }}>
        <button type="button" role="tab" tabIndex={tab === "work" ? 0 : -1} id="workspace-work-tab" aria-controls="workspace-work-view" aria-selected={tab === "work"} onClick={() => setTab("work")}>测量记录</button>
        <button type="button" role="tab" tabIndex={tab === "agent" ? 0 : -1} id="workspace-agent-tab" aria-controls="workspace-agent-view" aria-selected={tab === "agent"} onClick={() => setTab("agent")}>AI 提议 {running ? "· Working" : proposalCount ? `· ${proposalCount} proposals` : ""}</button>
      </div>
      <div id="workspace-agent-view" role="tabpanel" aria-labelledby="workspace-agent-tab" hidden={tab !== "agent"} className="workspace-agent-view">{children}</div>
      <div id="workspace-work-view" role="tabpanel" aria-labelledby="workspace-work-tab" hidden={tab !== "work"} className="workspace-work-view">
        <div className="workspace-filters">
          <label className="workspace-search"><span>查找测量</span><input name="work-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="饰面、图纸、标签或作者" /></label>
          <div className="workspace-filter-buttons" aria-label="筛选测量">
            {[["all", "全部记录"], ["pending", `待复核 · ${pending}`], ["agent", "AI 提议"]].map(([id, label]) =>
              <button type="button" key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
          </div>
        </div>
        <div className="workspace-list" aria-label="测量记录">
          {!rows.length && <div className="workspace-empty"><h3>{shapes.length ? "暂无匹配记录" : "测量记录将在这里显示"}</h3><p>{shapes.length ? "请调整筛选条件或关键词。" : "完成测量或导入 AI 提议后，在这里检查并定位原图。"}</p></div>}
          {rows.slice(0, limit).map((shape) => <button type="button" className="workspace-row" key={shape.id} aria-pressed={selectedId === shape.id} onClick={() => onLocate(shape)}>
            <span className="workspace-row-top"><strong>{conditions[shape.condition_id]?.finish_tag || "Unassigned"}{shape.label ? ` · ${shape.label}` : ""}</strong><span className="workspace-quantity">{quantity(shape)}</span></span>
            <span className="workspace-sheet">{sheetLabel(shape.sheet_id)}</span>
            <span className="workspace-row-bottom"><span>{shape.author || actorLabel(shape)}</span><span className={workReviewState(shape) === "Needs review" ? "workspace-pending" : ""}>{reviewLabel(shape)}</span></span>
          </button>)}
          {rows.length > limit && <button type="button" className="workspace-more" onClick={() => setLimit((n) => n + 50)}>Show more · {rows.length - limit} remaining</button>}
        </div>
        {selected && <section className="workspace-inspector" aria-label="Selected measurement">
          <div className="workspace-inspector-title"><h3>Measurement receipt</h3><strong className="workspace-quantity">{quantity(selected)}</strong></div>
          <dl>
            <div><dt>来源</dt><dd>{actorLabel(selected)}{selected.author ? ` · ${selected.author}` : ""}</dd></div>
            <div><dt>测量方式</dt><dd>{workMethod(selected)}</dd></div>
            <div><dt>复核状态</dt><dd>{reviewLabel(selected)}</dd></div>
            <div><dt>比例尺</dt><dd>{scales[selected.sheet_id] ? scaleUnconfirmed[selected.sheet_id] === false ? "Set · needs confirmation" : "Set" : "Not set"}</dd></div>
            <div><dt>Geometry</dt><dd>{selected.verts_norm?.length || 0} vertices · {selected.verts_norm_holes?.length || 0} holes</dd></div>
            {evidence.matched_text && <div><dt>Drawing text</dt><dd>{String(evidence.matched_text)}</dd></div>}
            {evidence.schedule_row_tag && <div><dt>Schedule tag</dt><dd>{String(evidence.schedule_row_tag)}</dd></div>}
          </dl>
          <p className="workspace-receipt-note">保留来源记录。已复核标记不等于工程量准确性保证。</p>
          <div className="workspace-inspector-actions"><button type="button" onClick={() => onLocate(selected)}>定位到图纸</button>{selected.origin?.reviewed === false && <button type="button" className="workspace-primary" onClick={() => onReview(selected.id)}>标为已复核</button>}</div>
        </section>}
        <footer className="workspace-footer"><span>{rows.length} of {shapes.length} 测量记录</span><button type="button" onClick={onReport}>打开报表 →</button></footer>
      </div>
    </aside>
  );
}
