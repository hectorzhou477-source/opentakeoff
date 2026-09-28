// Modified by Quantifin, 2026-09-28: Chinese editor navigation and grouped controls.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import "../styles/quantifin-editor.css";
import { Icon } from "../brand/icons.jsx";
import { keyText } from "../lib/keys.ts";
import "./workspaceChrome.css";

// Workspace chrome. All actions are supplied by the existing canvas;
// this component owns only navigation, search and disclosure state.
export function WorkspaceChrome({ title, onOpen, onNavigate, navigationOpen, onTakeoffs, takeoffsOpen,
  onPremium: _onPremium, onWork, workOpen, workButtonRef, pending, running, onReport, onFocus, onClassic: _onClassic,
  onControls, controlsOpen, onSearch, pinControl, panelTools, layoutMenu, fileMenu, scaleMenu, conditionControl, aids, history, action }) {
  return <>
    <header className="calm-header">
      <Link to="/" className="calm-brand" title="返回工作台"><b className="qe-logo">Q</b>Quantifin</Link>
      <div className="calm-project" title={title}><span>{title || "我的算量工作空间"}</span><small>装饰工程 / 算量编辑器</small></div>
      <div className="calm-header-actions">
        <button type="button" onClick={onOpen} title="导入图纸"><Icon name="plus" size={16} /><span>导入图纸</span></button>
        {fileMenu}
        <button type="button" aria-pressed={navigationOpen} onClick={onNavigate}><Icon name="sheets" size={16} />图纸目录</button>
        <button type="button" onClick={onSearch} className="calm-search-trigger" title="查找工具或操作"><Icon name="search" size={16} /><span>查找工具</span><kbd>{keyText("⌘K")}</kbd></button>
        <button type="button" aria-pressed={takeoffsOpen} onClick={onTakeoffs} title="查看测量量、饰面分类和辅助材料"><Icon name="product" size={16} />饰面与材料</button>
        <button type="button" ref={workButtonRef} aria-expanded={workOpen} onClick={onWork} className="calm-work">测量与复核{running ? <span className="calm-badge">运行中</span> : pending > 0 ? <span className="calm-badge">{pending}</span> : null}</button>
        <details className="qe-more-tools"><summary>辅助工具</summary><div>{pinControl}{panelTools}</div></details>
        <button type="button" onClick={onReport} className="calm-report"><Icon name="document" size={16} />工程量报表</button>
        {layoutMenu}<Link to="/" className="qe-home">返回工作台</Link>
      </div>
    </header>
    <div className="qe-workflow"><span className="qe-workflow-title">算量流程</span><span><b>01</b> 导入与校准</span><i>›</i><span><b>02</b> 按饰面测量</span><i>›</i><span><b>03</b> 核对与复核</span><i>›</i><span><b>04</b> 汇总与导出</span><small>自动保存 · 保留测量依据</small></div>
    <div className="calm-context" aria-label="当前图纸设置">
      <div className="calm-context-scroll">{conditionControl}<span className="calm-separator" />{history}<span className="calm-separator" />{aids}</div>
      <div className="calm-context-pinned">{action}{scaleMenu}
        <button type="button" onClick={onFocus} title="专注模式：隐藏外围面板，保留测量工具（F）"><Icon name="focus" size={16} /><span className="calm-focus-label">专注模式</span></button>
        <button type="button" onClick={onControls} aria-expanded={controlsOpen} title="显示全部工具和设置">{controlsOpen ? "收起工具" : "全部工具"}</button>
      </div>
    </div>
  </>;
}

export function WorkspaceNavigator({ open, items, current, onSelect, onClose, onGallery, dockSide, width, dockHandle }) {
  const [query, setQuery] = useState("");
  const matches = useMemo(() => items.filter((s) => `${s.label} ${s.file}`.toLowerCase().includes(query.trim().toLowerCase())), [items, query]);
  return <aside className="calm-navigator" data-dock-side={dockSide} style={{ width, order: dockSide === "right" ? 20 : -20 }} hidden={!open} aria-label="图纸导航" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
    <header>{dockHandle}<strong>图纸目录 <small>{items.length}</small></strong><button type="button" aria-label="关闭图纸导航" onClick={onClose}>×</button></header>
    <label><Icon name="search" size={15} /><input name="workspace-sheet-search" aria-label="搜索图纸" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索图纸名称…" /></label>
    <div className="calm-sheet-list">{matches.map((s) => <button type="button" key={s.key} aria-current={s.key === current ? "page" : undefined} onClick={() => onSelect(s.key)} title={`${s.label} · ${s.file}`}>
      <Icon name="document" size={19} /><span><strong>{s.label}</strong><small>{s.file}</small></span>{s.count > 0 && <em>{s.count}</em>}
    </button>)}{!matches.length && <p>{items.length ? "没有匹配的图纸。" : "导入图纸后在此选择页面。"}</p>}</div>
    <footer><button type="button" onClick={onGallery}><Icon name="sheets" size={16} />图纸缩略图</button></footer>
  </aside>;
}

export function WorkspaceCommandMenu({ open, onClose, actions, onOpenChange }) {
  const dialogRef = useRef(null);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const rows = actions.filter((a) => `${a.label} ${a.group || ""} ${a.shortcut || ""}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 50);
  useEffect(() => {
    if (!open) return;
    setQuery(""); setIndex(0);
    const dialog = dialogRef.current;
    dialog?.showModal();
    onOpenChange(true);
    return () => { dialog?.close(); onOpenChange(false); };
  }, [open, onOpenChange]);
  useEffect(() => { dialogRef.current?.querySelector(".is-highlighted")?.scrollIntoView({ block: "nearest" }); }, [index]);
  const run = (row) => { if (row && !row.disabled) { onClose(); row.run(); } };
  return <dialog ref={dialogRef} className="calm-command-menu" onKeyDown={(e) => e.stopPropagation()} aria-label="查找工具" onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); } }}>
    <header><Icon name="search" size={18} /><input name="workspace-action-search" role="combobox" aria-autocomplete="list" aria-expanded={true} aria-controls="workspace-action-results" aria-activedescendant={rows[index] ? `workspace-action-${rows[index].id}` : undefined} aria-label="搜索操作" autoFocus value={query} placeholder="搜索测量工具、图纸或操作…" onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
      onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))); } else if (e.key === "Enter") { e.preventDefault(); run(rows[index]); } }} /><button type="button" aria-label="关闭搜索" onClick={onClose}>Esc</button></header>
    <div className="calm-command-results" id="workspace-action-results" role="listbox" aria-label="操作">{rows.map((row, i) => <button type="button" role="option" tabIndex={-1} aria-selected={i === index} id={`workspace-action-${row.id}`} key={row.id} className={i === index ? "is-highlighted" : ""} disabled={row.disabled} onMouseEnter={() => setIndex(i)} onClick={() => run(row)}><span>{row.label}<small>{row.group}</small></span>{row.shortcut && <kbd>{keyText(row.shortcut)}</kbd>}</button>)}{!rows.length && <p>没有匹配的操作。可尝试“比例尺”“导入”或工具名称。</p>}</div>
    <footer>↑ ↓ 选择 · Enter 执行 · Esc 关闭</footer>
  </dialog>;
}
