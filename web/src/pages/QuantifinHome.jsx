// Copyright 2026 Quantifin. New Chinese workbench using OpenTakeoff's existing storage and totals.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { localStore } from "../lib/store.js";
import { ingestFiles } from "../lib/ingest.js";
import { conditionTotals } from "../lib/totals.js";
import { buildQuantifinTasks } from "../lib/quantifinTasks.js";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "../styles/quantifin.css";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const nav = [ ["home", "工作概览", "grid"], ["tasks", "算量任务台", "check"], ["drawings", "图纸管理", "layers"], ["scale", "比例尺核对", "ruler"], ["takeoff", "算量工作区", "ruler"], ["review", "复核中心", "check"], ["materials", "工程量清单", "list"] ];
const titles = { home: "工作概览", tasks: "算量任务台", drawings: "图纸管理", review: "复核中心", materials: "工程量清单", guide: "使用指南", team: "组织与协作" };
const fmt = (n) => Number(n || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
function Icon({ name = "grid", size = 20 }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    layers: <><path d="m12 3 10 5-10 5L2 8Z"/><path d="m2 12 10 5 10-5M2 16l10 5 10-5"/></>,
    ruler: <><path d="m3 16 13-13 5 5L8 21Z"/><path d="m12 7 3 3M8 11l3 3M5 14l3 3"/></>,
    check: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/></>,
    list: <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
    upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
    search: <><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></>,
    team: <><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v2"/></>,
    book: <><path d="M12 5v16M3 3c4-1 6 0 9 2 3-2 5-3 9-2v16c-4-1-6 0-9 2-3-2-5-3-9-2Z"/></>,
    file: <><path d="M14 2H5v20h14V7Z M14 2v5h5M8 12h8M8 16h5"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.grid}</svg>;
}
function PlanArt() {
  return <div className="q-plan" aria-hidden="true"><div className="q-plan-caption">FINISH PLAN <span>01 / 示意图</span></div><svg viewBox="0 0 380 205"><defs><pattern id="qgrid" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M12 0H0V12" fill="none" stroke="#d6dfee" strokeWidth=".5"/></pattern></defs><rect width="380" height="205" fill="url(#qgrid)"/><g stroke="#657898" strokeWidth="2" fill="#edf2fb"><path d="M35 26h310v153H35z"/><path d="M35 26h116v91H35z" fill="#dce7fb"/><path d="M161 26h95v91h-95z" fill="#e4ecfa"/><path d="M266 26h79v91h-79z" fill="#e0eee9"/><path d="M35 127h206v52H35z" fill="#e4ecfa"/><path d="M251 127h94v52h-94z" fill="#f1eadb"/></g><g stroke="#657898" fill="none"><path d="M120 117v-25a25 25 0 0 0-25 25M227 117V92a25 25 0 0 0-25 25M317 127v25a25 25 0 0 1-25-25"/></g><g fill="#4a5e7c" fontSize="10" textAnchor="middle"><text x="93" y="65">地面饰面 A</text><text x="209" y="65">地面饰面 B</text><text x="304" y="65">湿区</text><text x="138" y="156">公共区域</text><text x="299" y="164">待核对</text></g><g stroke="#7c8ba4" strokeWidth=".7"><path d="M35 12h310M35 8v9M345 8v9M20 26v153M16 26h8M16 179h8"/></g></svg><div className="q-plan-stamp"><span/> 图量关联 · 有据可查</div></div>;
}

export default function QuantifinHome() {
  const [section, setSection] = useState("home");
  const [sheets, setSheets] = useState([]);
  const [annotations, setAnnotations] = useState({ shapes: [], conditions: [] });
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [drawingPages, setDrawingPages] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const input = useRef(null);
  const flowRefs = useRef([]);
  const [flowAdvance, setFlowAdvance] = useState(0);
  const [taskFilter, setTaskFilter] = useState("all");
  const [exportReview, setExportReview] = useState(false);
  async function refresh() {
    const [files, data] = await Promise.all([localStore.listSheets(), localStore.loadAnnotations()]);
    setSheets(files); setAnnotations(data);
    const pageGroups = await Promise.all(files.map(async file => {
      let pdf;
      try {
        pdf = await pdfjs.getDocument({ data: await localStore.loadPdfData(file.name) }).promise;
        return Array.from({ length: pdf.numPages }, (_, i) => i ? `${file.name}#${i + 1}` : file.name);
      } catch { return null; }
      finally { await pdf?.destroy(); }
    }));
    setDrawingPages(pageGroups.some(group => group === null) ? null : pageGroups.flat());
  }
  useEffect(() => { document.title = "Quantifin · 装饰工程算量工作台"; refresh().catch(() => setError("本地数据读取失败，请刷新页面重试。")).finally(() => setLoading(false)); }, []);
  const shapes = annotations.shapes || [];
  const pending = shapes.filter(s => s.origin?.reviewed === false);
  const rows = conditionTotals(annotations.conditions || [], shapes).filter(r => r.shape_count > 0);
  const scaleSheets = annotations.sheets || [];
  const confirmedPages = drawingPages?.filter(key => scaleSheets.some(s => s.sheet_id === key && s.units_per_px > 0 && s.scale_confirmed !== false)).length || 0;
  const scaleReady = drawingPages?.length > 0 && confirmedPages === drawingPages.length;
  const measured = shapes.length > 0 && rows.length > 0;
  const unassignedShapes = shapes.filter(s => !annotations.conditions?.some(c => c.id === s.condition_id));
  const invalidMaterials = rows.flatMap(r => r.materials.filter(m => !Number.isFinite(m.per) || m.per <= 0));
  const unconfiguredFinishes = rows.filter(r => r.materials.length === 0);
  const tasks = useMemo(() => buildQuantifinTasks({ files: sheets, pages: drawingPages, annotations }), [sheets, drawingPages, annotations]);
  const visibleTasks = taskFilter === "all" ? tasks : tasks.filter(task => task.type === taskFilter);
  const flowDone = [sheets.length > 0, scaleReady, false, false];
  const activeStep = !sheets.length ? 0 : !scaleReady ? 1 : !measured ? 2 : 3;
  const flowStarted = [false, confirmedPages > 0, measured, measured];
  const flowKey = flowDone.map(Number).join("");
  const filtered = sheets.filter(s => s.name.toLowerCase().includes(query.toLowerCase()));
  function go(id) { setSection(id); setQuery(""); }
  async function importFiles(files) {
    if (!files?.length) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await ingestFiles(files);
      for (const file of result.pdfs) await localStore.addPdf(file);
      await refresh();
      if (result.pdfs.length) { setSection("home"); setFlowAdvance(v => v + 1); }
      setMessage(`${result.pdfs.length ? `已导入 ${result.pdfs.length} 个图纸文件。` : "没有可导入的图纸。"}${result.skipped.length ? ` 跳过 ${result.skipped.length} 个文件：${result.skipped.map(s => `${s.name}（${s.reason}）`).join("、")}。` : "请核对图纸比例尺。"}`);
    } catch (e) { setError(`导入未完成：${e.message || "请检查文件并重试"}`); await refresh().catch(() => {}); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  async function sample() {
    setBusy(true); setError("");
    try { const response = await fetch("/demo/sample-finish-plan.pdf"); if (!response.ok) throw new Error("示例图纸加载失败"); await importFiles([new File([await response.blob()], "Quantifin-示例饰面图.pdf", { type: "application/pdf" })]); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  function exportCsv() { setExportReview(true); }
  function downloadCsv() {
    const cell = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["饰面名称", "测量项数", "地面面积(m²)", "墙面面积(m²)", "长度(m)", "数量(个)", "损耗率(%)"], ...rows.map(r => [r.finish_tag || r.name || r.id, r.shape_count, (r.floor_sf * .09290304).toFixed(2), (r.wall_sf * .09290304).toFixed(2), (r.lf * .3048).toFixed(2), r.ea, r.waste_pct])];
    const url = URL.createObjectURL(new Blob(["\uFEFF" + lines.map(l => l.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "Quantifin-基础工程量草稿-非采购清单.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExportReview(false);
  }
  const taskAction = task => task.type === "import" ? <button className="q-btn q-primary" onClick={() => input.current?.click()}>{task.action}</button>
    : task.href === "#review" ? <button className="q-btn" onClick={() => go("review")}>{task.action}</button>
    : <Link className="q-btn" to={task.href}>{task.action} →</Link>;
  const uploadButton = <button className="q-btn q-primary" disabled={busy || loading} onClick={() => input.current?.click()}><Icon name="upload" size={17}/>{busy ? "正在导入…" : "导入图纸"}</button>;
  const empty = (title, text) => <div className="q-empty"><span className="q-empty-icon"><Icon name="layers" size={30}/></span><h3>{title}</h3><p>{text}</p><div>{uploadButton}<button className="q-btn" disabled={busy} onClick={sample}>体验示例图纸 <Icon name="arrow" size={16}/></button></div></div>;
  const drawingList = <>{sheets.length === 0 ? empty("从第一份图纸，开始有依据的算量", "导入装饰平面图、立面图或节点详图，建立你的本地工作资料。") : <><div className="q-table-scroll"><table><thead><tr><th>图纸文件</th><th>资料类型</th><th>存储位置</th><th>操作</th></tr></thead><tbody>{filtered.map(s => <tr key={s.name}><td><span className="q-file-icon"><Icon name="file"/></span><strong>{s.name}</strong></td><td>PDF 图纸</td><td><span className="q-tag">本地浏览器</span></td><td><Link to="/takeoff" className="q-text-link">进入工作区 →</Link></td></tr>)}</tbody></table></div>{!filtered.length && <p className="q-hint">没有找到匹配的图纸，请更换关键词。</p>}</>}</>;
  const flowSteps = useMemo(() => [
    { n: "01", title: "导入并整理图纸", note: sheets.length ? `已导入 ${sheets.length} 份图纸，可以继续核对比例尺。` : "导入 PDF、图片或 ZIP 图纸包，建立本次算量的资料集。", icon: "layers" },
    { n: "02", title: "核对图纸比例尺", note: drawingPages ? `已确认 ${confirmedPages}/${drawingPages.length} 页；其余页面需核对比例尺。` : "正在读取页数或有图纸无法读取；请到比例尺核对页逐页检查。", icon: "ruler" },
    { n: "03", title: "测量并配置材料", note: measured ? `已有 ${shapes.length} 项测量、${rows.length} 个饰面汇总；请逐页检查漏算和做法。` : "按饰面测量面积、长度和数量，再设置主材损耗与辅材覆盖率。", icon: "grid" },
    { n: "04", title: "复核并导出草稿", note: measured ? `待复核 AI 提议 ${pending.length} 项；还须人工检查全部图纸范围、测量和材料做法。` : "完成测量后，在原图逐页复核依据。", icon: "check" },
  ], [sheets.length, drawingPages, confirmedPages, measured, shapes.length, rows.length, pending.length]);
  useEffect(() => {
    if (loading || section !== "home") return;
    const id = window.setTimeout(() => flowRefs.current[activeStep]?.scrollIntoView({ behavior: "smooth", block: "center" }), flowAdvance ? 180 : 360);
    return () => window.clearTimeout(id);
  }, [loading, section, activeStep, flowKey, flowAdvance]);
  return <div className={`q-app q-stage-${activeStep + 1}`}>
    <input ref={input} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.zip,.dwg" hidden onChange={e => importFiles(Array.from(e.target.files || []))}/>
    <aside className="q-sidebar"><Link to="/" className="q-brand" onClick={() => go("home")}><span className="q-logo">Q<span/></span><div>Quantifin<small>装饰工程 · 精准计量</small></div></Link>
      <button className="q-space" onClick={() => go("team")}><span className="q-avatar">个</span><span><b>我的工作空间</b><small>个人 / 工作室 · 本地版</small></span><span className="q-chevron">⌄</span></button>
      <div className="q-nav-label">工作空间</div><nav aria-label="主导航">{nav.map(([id, label, icon]) => (id === "takeoff" || id === "scale") ? <Link key={id} to={id === "scale" ? "/scale-review" : "/takeoff"}><Icon name={icon}/>{label}<span className="q-nav-external">↗</span></Link> : <button key={id} className={section === id ? "active" : ""} aria-current={section === id ? "page" : undefined} onClick={() => go(id)}><Icon name={icon}/>{label}{id === "review" && pending.length > 0 && <span className="q-count">{pending.length}</span>}</button>)}</nav>
      <div className="q-nav-label q-nav-second">管理与支持</div><nav><button className={section === "team" ? "active" : ""} onClick={() => go("team")}><Icon name="team"/>组织与协作<span className="q-soon">规划中</span></button><button className={section === "guide" ? "active" : ""} onClick={() => go("guide")}><Icon name="book"/>使用指南</button></nav>
      <div className="q-sidebar-bottom"><div className="q-local"><span/>本地工作模式</div><p>图纸保存在当前浏览器<br/>请定期导出项目备份</p><div className="q-profile"><span className="q-avatar">Q</span><div><b>本地用户</b><small>造价工程师 / 工作室</small></div></div></div>
    </aside>
    <div className="q-main"><header className="q-topbar"><span>工作空间 <i>/</i> <strong>{titles[section]}</strong></span><div><span className="q-local"><span/>数据保存在本机</span><button className="q-icon-btn" aria-label="打开使用指南" onClick={() => go("guide")}><Icon name="book"/></button><span className="q-avatar q-small">Q</span></div></header>
    <main className="q-content"><div className="q-page-heading"><div><div className="q-eyebrow">QUANTIFIN WORKSPACE</div><h1>{titles[section]}</h1><p>{section === "home" ? "让每一份工程量，都有清晰的计算依据。" : "从图纸到清单，保留每一步测量与复核依据。"}</p></div><div className="q-heading-actions">{section === "materials" ? <button className="q-btn q-primary" disabled={!rows.length} onClick={exportCsv}>导出基础工程量草稿</button> : uploadButton}</div></div>
    {error && <div className="q-alert q-alert-error" role="alert">{error}</div>}{message && <div className="q-alert" role="status">{message}<button aria-label="关闭提示" onClick={() => setMessage("")}>×</button></div>}
    {loading ? <div className="q-card q-loading" role="status">正在读取本地工作资料…</div> : <>
    {section === "home" && <div className="q-flow-shell">
      <section className="q-flow-intro"><div><span className="q-hero-kicker"><span/> 当前项目流程</span><h2>从图纸开始，顺着页面完成算量。</h2><p>系统已生成 {tasks.length} 项待办；点击任务可查看依据并进入对应图纸。测量和复核仍需专业人员检查完整性。</p><button className="q-btn" onClick={() => go("tasks")}>查看算量任务台 →</button></div><div className="q-flow-progress" aria-label={`当前第 ${activeStep + 1} 步，共 4 步`}><strong>{activeStep + 1}<small>/ 4</small></strong><span>当前步骤</span></div><PlanArt/></section>
      <nav className="q-flow-rail" aria-label="算量步骤">{flowSteps.map((step, i) => <button key={step.n} className={i === activeStep ? "active" : flowDone[i] ? "done" : ""} onClick={() => flowRefs.current[i]?.scrollIntoView({ behavior: "smooth", block: "center" })}><span>{flowDone[i] ? "✓" : step.n}</span>{step.title}</button>)}</nav>
      <div className="q-flow-list">{flowSteps.map((step, i) => <section key={step.n} ref={el => { flowRefs.current[i] = el; }} className={`q-flow-step ${i === activeStep ? "active" : ""} ${flowDone[i] ? "done" : ""}`} aria-current={i === activeStep ? "step" : undefined}>
        <div className="q-flow-number"><span>{flowDone[i] ? "✓" : step.n}</span><i>{i === activeStep ? "正在进行" : flowDone[i] ? "已完成" : flowStarted[i] ? "已开展 · 待核对" : "待开始"}</i></div>
        <div className="q-flow-body"><div className="q-flow-title"><span><Icon name={step.icon}/></span><div><h3>{step.title}</h3><p>{step.note}</p></div></div>
          {i === 0 && <div className="q-flow-actions">{uploadButton}<button className="q-btn" onClick={sample} disabled={busy}>体验示例图纸</button>{sheets.length > 0 && <button className="q-text-link" onClick={() => go("drawings")}>查看已导入图纸</button>}</div>}
          {i === 1 && <div className="q-flow-actions"><Link className="q-btn q-primary" to="/scale-review">{scaleReady ? "复查比例尺" : "开始批量核对"}<Icon name="arrow" size={16}/></Link><span className="q-flow-fact">{confirmedPages}/{drawingPages?.length ?? "?"} 页已确认</span></div>}
          {i === 2 && <><div className="q-flow-actions"><Link className="q-btn q-primary" to="/takeoff">{measured ? "继续测量与配置" : "进入算量工作区"}<Icon name="arrow" size={16}/></Link><span className="q-flow-fact">{shapes.length} 项测量 · {rows.length} 个饰面</span></div>{rows.length > 0 && <div className="q-flow-summary">{rows.slice(0,3).map(r => <span key={r.id}><b>{r.finish_tag}</b>{fmt(r.total_sf * .09290304)} m²</span>)}{rows.length > 3 && <span>另有 {rows.length - 3} 项</span>}</div>}</>}
          {i === 3 && <div className="q-flow-actions"><button className="q-btn" onClick={() => go("tasks")}>查看待办（{tasks.length}）</button><button className="q-btn q-primary" onClick={exportCsv} disabled={!rows.length}>导出基础工程量草稿</button></div>}
        </div>
        {i < 3 && <div className="q-flow-next" aria-hidden="true"><span/></div>}
      </section>)}</div>
      <div className="q-alert q-workflow-notice"><span>核对提醒：{unassignedShapes.length} 项测量未关联饰面；{invalidMaterials.length} 项辅材覆盖率无效；{unconfiguredFinishes.length} 个已测饰面未配置辅材（也可能确实无需辅材）。导出的 CSV 只有基础工程量，不包含主材或辅材采购量，也不代表工程量完整。</span><button onClick={() => go("materials")}>查看汇总 →</button></div>
      <div className="q-assurance"><Icon name="check"/><div><b>把复核留给专业，把依据留在图上</b><p>AI 提议与人工复核分开记录；系统根据真实项目数据判断进度。</p></div><button className="q-text-link" onClick={() => go("guide")}>查看操作指南 →</button></div>
    </div>}
    {section === "tasks" && <section className="q-card q-task-board" aria-label="算量待办任务"><div className="q-card-head"><div><h2>待处理任务 <span className="q-tag">{tasks.length} 项</span></h2><p>系统按已保存资料自动生成；任务消失表示对应数据条件已解决，不代表全项目已算完。</p></div><label className="q-task-filter">筛选任务 <select aria-label="筛选算量任务" value={taskFilter} onChange={e => setTaskFilter(e.target.value)}><option value="all">全部（{tasks.length}）</option>{[["scale","比例尺"],["scope","图纸范围"],["review","机器提议"],["unassigned","饰面关联"],["materials","辅材做法"],["coverage","覆盖率"],["final","人工总核对"]].map(([id,label]) => <option key={id} value={id}>{label}（{tasks.filter(task => task.type === id).length}）</option>)}</select></label></div><div className="q-task-list">{visibleTasks.map(task => <article className="q-task-row" key={task.id}><div><span className={`q-task-priority q-task-priority-${task.priority}`}>{task.priority === 0 ? "优先处理" : task.priority === 1 ? "范围检查" : "人工核对"}</span><h3>{task.title}</h3><p>{task.detail}</p><small>依据：{task.evidence}</small></div>{taskAction(task)}</article>)}{!visibleTasks.length && <p className="q-hint">当前筛选项没有待办。请继续检查其他类别及原图范围。</p>}</div></section>}
    {section === "drawings" && <div className="q-alert q-workflow-notice">DWG 暂不能直接算量：请在 CAD 软件中按原尺寸导出 PDF，再导入并逐页校准。当前数据只保存在 {window.location.origin} 对应的浏览器中；请保持访问地址一致，并在算量工作区的文件菜单导出 .otk 项目备份。<Link to="/takeoff">进入工作区备份 →</Link></div>}
    {section === "drawings" && <section className="q-card"><div className="q-card-head"><div><h2>图纸资料 <span className="q-tag">{sheets.length} 份</span></h2><p>当前本地工作空间 · 导入后在算量工作区选择具体图纸</p></div><label className="q-search"><Icon name="search" size={17}/><input aria-label="搜索图纸" placeholder="搜索图纸名称" value={query} onChange={e => setQuery(e.target.value)}/></label></div>{drawingList}</section>}
    {section === "review" && <section className="q-card"><div className="q-card-head"><div><h2>待复核测量 <span className="q-tag">{pending.length} 项</span></h2><p>此处展示明确标为未复核的提议，确认操作请在原图画布中完成。</p></div><Link className="q-btn" to="/takeoff">在图纸中复核 →</Link></div>{pending.length ? <div className="q-table-scroll"><table><thead><tr><th>测量记录</th><th>来源图纸</th><th>状态</th></tr></thead><tbody>{pending.map((s,i) => <tr key={s.id || i}><td>{s.label || `测量 ${i+1}`}</td><td>{s.sheet_id || "未记录图纸来源"}</td><td><span className="q-tag q-amber">待人工复核</span></td></tr>)}</tbody></table></div> : <div className="q-empty"><span className="q-empty-icon"><Icon name="check" size={30}/></span><h3>暂无待复核的 AI 提议</h3><p>这不代表所有工程量已核验；请继续检查人工测量及未标记记录。</p><Link className="q-btn" to="/takeoff">进入画布检查</Link></div>}</section>}
    {section === "materials" && <div className="q-alert q-workflow-notice">已测饰面中，{unconfiguredFinishes.length} 个没有配置辅材，{invalidMaterials.length} 项辅材覆盖率为 0 或无效（计算结果可能显示 0，不能当作无需采购）。另有 {unassignedShapes.length} 项测量未关联饰面。请在工作区核对材料做法及产品覆盖率。<Link to="/takeoff">核对材料 →</Link></div>}
    {section === "materials" && <section className="q-card"><div className="q-card-head"><div><h2>按饰面汇总</h2><p>这里只是基础工程量草稿，不是主材或辅材采购清单；不含损耗、卷材排布及漏算核验。</p></div></div>{rows.length ? <div className="q-table-scroll"><table><thead><tr><th>饰面名称</th><th>测量项</th><th>地面 m²</th><th>墙面 m²</th><th>长度 m</th><th>数量</th></tr></thead><tbody>{rows.map(r => <tr key={r.id}><td><strong>{r.finish_tag || r.name || r.id}</strong></td><td>{r.shape_count}</td><td>{fmt(r.floor_sf * .09290304)}</td><td>{fmt(r.wall_sf * .09290304)}</td><td>{fmt(r.lf * .3048)}</td><td>{fmt(r.ea)}</td></tr>)}</tbody></table></div> : <div className="q-empty"><span className="q-empty-icon"><Icon name="list" size={30}/></span><h3>还没有可汇总的工程量</h3><p>先在算量工作区创建饰面并完成测量，清单会自动同步到这里。</p><Link className="q-btn q-primary" to="/takeoff">开始测量 →</Link></div>}</section>}
    {section === "team" && <section className="q-card q-team"><Icon name="team" size={36}/><h2>个人高效作业，团队有序协同</h2><p>当前运行的是本地个人工作空间，可用于造价工程师和小型工作室的单机作业。<br/>组织账号、成员权限、项目分配与多人审核尚未接入，此处为规划说明。</p><div className="q-team-grid"><div><b>个人 / 工作室</b><span className="q-tag">当前可用</span><p>本地图纸管理、画布测量、复核查看、清单导出。</p><button className="q-btn" onClick={() => go("home")}>返回我的工作空间</button></div><div><b>公司 / 组织 / 机构</b><span className="q-tag">后续规划</span><p>共享项目、岗位权限、审核流程、版本管理与交付归档。</p></div></div></section>}
    {section === "guide" && <section className="q-card q-guide-full"><h2>从图纸到工程量清单</h2>{[["导入与归集", "点击“导入图纸”，选择 PDF、图片或 ZIP；DWG 不会被导入；请在 CAD 软件按原尺寸导出 PDF 后逐页校准。当前所有文件加入同一个本地工作空间，建议不同项目分别导出备份。"], ["核对比例尺", "进入算量工作区，系统会尝试从比例标注或两处毫米尺寸自动识别比例尺；扫描件还会在本地 OCR。自动结果为待确认，请用已知尺寸核对。无法识别时手动校准。"], ["按饰面测量", "在画布创建饰面分类；使用 Area（面积）、Line（长度）、Count（计数）等工具完成测量。复杂墙面和吊顶应结合立面、剖面及做法说明核算。"], ["逐项复核", "在复核中心查看待复核提议，再到原图检查并确认。高置信度不等于人工已确认；没有明确复核标记的数据不会归入已复核。"], ["导出与备份", "基础工程量草稿可导出 CSV 并用 Excel 打开；它不能直接作为主材或辅材采购清单。完整项目与带标注图纸请使用画布的导出功能；清理浏览器数据可能删除本地资料。"]].map(([t,d],i) => <div className="q-step" key={t}><span>0{i+1}</span><div><h3>{t}</h3><p>{d}</p></div></div>)}<div className="q-alert">当前招标文件语义分析与组织协作尚未接入。一键房间识别沿用上游默认关闭状态。</div><Link className="q-btn q-primary" to="/takeoff">进入算量工作区 <Icon name="arrow" size={16}/></Link></section>}
    </>}
    {exportReview && <div className="q-export-backdrop"><section className="q-export-dialog" role="dialog" aria-modal="true" aria-labelledby="q-export-title"><h2 id="q-export-title">导出前检查</h2><p>这份 CSV 仅包含基础工程量草稿，不包含主材、辅材采购量或漏算结论。</p><strong>当前还有 {tasks.length} 项待办</strong><ul>{tasks.slice(0, 6).map(task => <li key={task.id}>{task.title}</li>)}{tasks.length > 6 && <li>另有 {tasks.length - 6} 项，请到算量任务台查看。</li>}</ul><div className="q-export-actions"><button className="q-btn" onClick={() => { setExportReview(false); go("tasks"); }}>先处理待办</button><button className="q-btn q-primary" onClick={downloadCsv}>仍导出基础工程量草稿</button><button className="q-btn" onClick={() => setExportReview(false)}>取消</button></div></section></div>}
    <footer className="q-footer"><span>Quantifin · 专注装饰工程计量</span><span>基于 OpenTakeoff · Apache-2.0</span></footer>
    </main></div>
  </div>;
}
