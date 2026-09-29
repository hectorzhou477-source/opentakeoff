// Quantifin addition, 2026-09-29: full-page, human-controlled batch scale review.
import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { store } from '../lib/store.js';
import { awaitAnnotationWrites, saveAnnotationsQueued } from '../lib/annotationWrites.js';
import { applyScaleBatch, calibrationUpp, documentSignature, ratioToUpp, scaleLabel, scanScaleBatch } from '../lib/batchScale.js';
import { inspectScalePage, scanScalePage } from '../lib/scaleScanner.js';
import { RENDER_SCALE } from '../lib/takeoffConstants.ts';
import { Z, SVG } from '../lib/ui.js';
import '../styles/scaleReview.css';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const number = n => Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const positive = n => Number.isFinite(Number(n)) && Number(n) > 0;
async function digest(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}

function PagePreview({ row, getDoc, onCalibrate, disabled, evidence = [] }) {
  const canvas = useRef(null);
  const [dims, setDims] = useState(null);
  const [points, setPoints] = useState([]);
  const [mm, setMm] = useState('');
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true, render;
    (async () => {
      const pdf = await getDoc(row.file);
      const page = await pdf.getPage(row.page);
      const base = page.getViewport({ scale: RENDER_SCALE });
      const viewport = page.getViewport({ scale: RENDER_SCALE * Math.min(1, 1800 / Math.max(base.width, base.height)) });
      if (!live) return;
      setDims({ w: Math.ceil(base.width), h: Math.ceil(base.height) });
      const element = canvas.current;
      element.width = Math.ceil(viewport.width); element.height = Math.ceil(viewport.height);
      render = page.render({ canvasContext: element.getContext('2d'), viewport });
      await render.promise;
      if (live) setReady(true);
    })().catch(e => { if (live) setError(String(e.message || e)); });
    return () => { live = false; render?.cancel(); };
  }, [row.file, row.page, getDoc]);
  function calibrate() {
    try { onCalibrate(calibrationUpp(points, mm, dims), dims); setError(''); }
    catch (e) { setError(e.message); }
  }
  return <section className="sr-preview" aria-label="图纸核对预览">
    <div className="sr-preview-head"><strong>原图核对 · 第 {row.page} 页</strong><div><button onClick={() => setZoom(z => Math.max(1, z - 0.5))} aria-label="缩小预览">−</button><span>{zoom * 100}%</span><button onClick={() => setZoom(z => Math.min(4, z + 0.5))} aria-label="放大预览">＋</button></div></div>
    <p>点击已知尺寸的两个端点，输入标注值（mm）。滚动查看放大后的图纸。</p>
    {error && <p role="alert" className="sr-error">{error}</p>}
    <div className="sr-preview-scroll"><div className="sr-paper" style={{ width: `${zoom * 100}%` }}>
      <canvas ref={canvas} aria-label="图纸原图" />
      {ready && <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="选择校准端点" onClick={e => {
        if (disabled) return;
        const box = e.currentTarget.getBoundingClientRect();
        const point = [(e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height];
        setPoints(p => p.length === 2 ? [point] : [...p, point]);
      }}>
        {dims && evidence.map((witness, i) => <g key={`evidence-${i}`} pointerEvents="none">
          {witness.line && <line x1={witness.line[0] / dims.w * 1000} y1={witness.line[1] / dims.h * 1000} x2={witness.line[2] / dims.w * 1000} y2={witness.line[3] / dims.h * 1000} stroke={SVG.positive} strokeWidth="3" opacity=".65" />}
          <rect x={witness.text.x / dims.w * 1000} y={witness.text.y / dims.h * 1000} width={witness.text.width / dims.w * 1000} height={witness.text.height / dims.h * 1000} fill={SVG.positive} fillOpacity=".15" stroke={SVG.positive} strokeWidth="1" />
        </g>)}
        {points.length === 2 && <line x1={points[0][0] * 1000} y1={points[0][1] * 1000} x2={points[1][0] * 1000} y2={points[1][1] * 1000} stroke={SVG.cobalt} strokeWidth="2" />}
        {points.map((p, i) => <g key={i}><circle cx={p[0] * 1000} cy={p[1] * 1000} r="5" fill={SVG.cobalt} stroke="white" strokeWidth="2"/><text x={p[0] * 1000 + 8} y={p[1] * 1000 - 8} fill={SVG.cobalt} fontSize="18">{i + 1}</text></g>)}
      </svg>}
    </div></div>
    <div className="sr-calibrate"><label>标注尺寸 <input type="number" min="0" value={mm} onChange={e => setMm(e.target.value)} placeholder="例如 6000" aria-label="已知尺寸毫米"/> mm</label><button disabled={disabled || !ready || points.length !== 2 || !positive(mm)} onClick={calibrate}>记录两点校准</button><button disabled={disabled || !points.length} onClick={() => setPoints([])}>重选端点</button></div>
    <small>绿色标注为参与推算的尺寸证据。两点校准按实际标注计算；扫描图无需知道原始纸张大小。</small>
  </section>;
}

export default function ScaleReview() {
  const location = useLocation(), navigate = useNavigate();
  const sessionRef = useRef(null);
  const abortRef = useRef(false);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [document, setDocument] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [results, setResults] = useState({});
  const [drafts, setDrafts] = useState({});
  const [active, setActive] = useState(null);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [ratio, setRatio] = useState('100');
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const [conflict, setConflict] = useState(false);
  const dirty = Object.keys(drafts).length > 0;
  useEffect(() => {
    const session = { store, docs: new Map(), hashes: new Map(), live: true };
    session.getDoc = async file => {
      if (!session.docs.has(file)) session.docs.set(file, (async () => {
        const bytes = await session.store.loadPdfData(file);
        session.hashes.set(file, await digest(bytes));
        const pdf = await pdfjs.getDocument({ data: bytes }).promise;
        if (!session.live) { await pdf.destroy(); throw new Error('页面已关闭'); }
        return pdf;
      })());
      return session.docs.get(file);
    };
    sessionRef.current = session;
    setLoading(true); setError(''); setConflict(false);
    setRows([]); setResults({}); setDrafts({}); setActive(null); setSelected(new Set()); setPreview(null);
    const bridge = session.store.syncBridge;
    if (bridge) { bridge.isBusy = () => true; bridge.onRemoteUpdate = () => { if (session.live) setConflict(true); }; }
    (async () => {
      await awaitAnnotationWrites(session.store);
      const [data, files] = await Promise.all([session.store.loadAnnotations(), session.store.listSheets()]);
      if (!session.live) return;
      session.signature = documentSignature(data);
      setDocument(data);
      const list = [];
      for (const file of files) {
        if (!session.live) return;
        try {
          const pdf = await session.getDoc(file.name);
          for (let page = 1; page <= pdf.numPages; page++) list.push({ key: page === 1 ? file.name : `${file.name}#${page}`, file: file.name, page });
        } catch (e) { list.push({ key: file.name, file: file.name, page: 1, error: String(e.message || e) }); }
        if (session.live) setRows([...list]);
      }
      if (session.live) setActive(list.find(r => !r.error)?.key || null);
    })().catch(e => { if (session.live) setError(String(e.message || e)); }).finally(() => { if (session.live) setLoading(false); });
    return () => {
      session.live = false; abortRef.current = true;
      if (bridge) { bridge.isBusy = null; bridge.onRemoteUpdate = null; }
      for (const pending of session.docs.values()) pending.then(pdf => pdf.destroy()).catch(() => {});
    };
  }, [reload]);
  useEffect(() => {
    const warn = e => { if (dirty || busy) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy]);
  const saved = new Map((document?.sheets || []).map(s => [s.sheet_id, s]));
  const counts = new Map();
  for (const shape of document?.shapes || []) counts.set(shape.sheet_id, (counts.get(shape.sheet_id) || 0) + 1);
  const status = row => row.error || results[row.key]?.state === 'error' ? 'error' : drafts[row.key] ? 'draft' : saved.get(row.key)?.units_per_px > 0 && saved.get(row.key)?.scale_confirmed !== false ? 'confirmed' : 'pending';
  const visible = rows.filter(row => row.file.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || status(row) === filter));
  const chosen = rows.filter(row => selected.has(row.key) && !row.error);
  const activeRow = rows.find(r => r.key === active);
  const blocked = loading || !!busy || !document || conflict;
  const patchResult = (key, value) => setResults(old => ({ ...old, [key]: { ...old[key], ...value } }));
  function leave(path) {
    if (busy) { setMessage('请先取消当前处理，待正在处理的图纸结束后返回。'); return; }
    if (dirty && !window.confirm('尚有未保存的比例尺修改，确定放弃并离开？')) return;
    navigate(path + location.search);
  }
  async function recognize() {
    if (blocked || !chosen.length) return;
    const session = sessionRef.current;
    abortRef.current = false; setBusy('scan'); setError(''); setMessage(''); setProgress({ done: 0, total: chosen.length });
    try {
      await scanScaleBatch(chosen, async (row, cancelled) => {
        const pdf = await session.getDoc(row.file);
        return scanScalePage(await pdf.getPage(row.page), cancelled);
      }, (key, result, done) => {
        if (!session.live) return;
        patchResult(key, result); setProgress({ done, total: chosen.length });
      }, () => abortRef.current || !session.live);
      if (session.live) {
        setResults(old => Object.fromEntries(Object.entries(old).map(([key, r]) => [key, r.state === 'running' ? { ...r, state: 'cancelled' } : r])));
        setMessage(abortRef.current ? '已取消后续识别，已完成结果保留。' : '识别完成。核对后点击“采用选中建议”，再统一保存。');
      }
    } finally { if (session.live) setBusy(''); }
  }
  function adopt() {
    const next = { ...drafts }; let count = 0;
    for (const row of chosen) {
      const r = results[row.key], p = r?.proposal;
      if (r?.state !== 'found' || !p || p.auto === false || p.multi || !positive(p.upp)) continue;
      next[row.key] = { sheet_id: row.key, units_per_px: p.upp, scale_source: p.method === 'note' ? 'detected' : p.method || 'detected', dims: r.dims };
      count++;
    }
    setDrafts(next); setMessage(`已记录 ${count} 张建议；${chosen.length - count} 张无可靠结果或存在冲突，请人工校准。尚未保存。`);
  }
  function confirmExisting() {
    const next = { ...drafts }; let count = 0;
    for (const row of chosen) {
      const current = saved.get(row.key);
      if (!current?.units_per_px || next[row.key]) continue;
      next[row.key] = { ...current }; count++;
    }
    setDrafts(next); setMessage(`已记录 ${count} 张当前比例尺的人工确认，点击保存生效。`);
  }
  async function stageRatio(targets) {
    if (!positive(ratio) || !targets.length || blocked) return;
    setBusy('ratio'); setError(''); const session = sessionRef.current;
    const additions = {}; let skipped = 0;
    try {
      for (const row of targets) {
        const pdf = await session.getDoc(row.file);
        const info = await inspectScalePage(await pdf.getPage(row.page));
        if (!session.live) return;
        patchResult(row.key, { raster: info.raster, dims: info.dims });
        if (info.raster) { skipped++; continue; }
        additions[row.key] = { sheet_id: row.key, units_per_px: ratioToUpp(ratio), scale_source: 'standard', dims: info.dims };
      }
      setDrafts(old => ({ ...old, ...additions }));
      setMessage(`已记录 ${Object.keys(additions).length} 张为 1:${ratio}。${skipped ? `${skipped} 张扫描图不能仅凭纸面比例修改，请在右侧两点校准。` : '点击保存后生效。'}`);
    } catch (e) { if (session.live) setError(String(e.message || e)); }
    finally { if (session.live) setBusy(''); }
  }
  async function prepareSave() {
    setBusy('prepare'); setError(''); const session = sessionRef.current;
    try {
      const dimensions = {};
      for (const row of rows.filter(r => drafts[r.key])) {
        const pdf = await session.getDoc(row.file), page = await pdf.getPage(row.page);
        const viewport = page.getViewport({ scale: RENDER_SCALE });
        dimensions[row.key] = { w: Math.ceil(viewport.width), h: Math.ceil(viewport.height) };
      }
      const changes = Object.values(drafts).map(({ dims: _dims, ...value }) => value);
      const batch = applyScaleBatch(document, changes, dimensions);
      if (session.live) setPreview(batch);
    } catch (e) { if (session.live) setError(String(e.message || e)); }
    finally { if (session.live) setBusy(''); }
  }
  async function commit() {
    if (!preview || busy || conflict) return;
    setBusy('save'); setError(''); const session = sessionRef.current;
    try {
      await awaitAnnotationWrites(session.store);
      if (documentSignature(await session.store.loadAnnotations()) !== session.signature) {
        setConflict(true); throw new Error('项目已在其他页面或同步端发生变化，请重新载入后核对；本次未覆盖数据。');
      }
      for (const file of new Set(rows.filter(r => drafts[r.key]).map(r => r.file))) {
        if (await digest(await session.store.loadPdfData(file)) !== session.hashes.get(file)) {
          setConflict(true); throw new Error('图纸文件已更新，请重新载入后识别；本次未保存。');
        }
      }
      if (typeof session.store.saveSnapshot !== 'function') throw new Error('当前存储不支持修改前备份，请返回画布导出备份后重试。');
      await session.store.saveSnapshot(`批量比例尺修改前 · ${preview.impact.length} 张`, document);
      // Recheck after the asynchronous snapshot so a sync adoption cannot be overwritten.
      if (documentSignature(await session.store.loadAnnotations()) !== session.signature) { setConflict(true); throw new Error('保存期间项目发生变化，请重新载入。'); }
      await saveAnnotationsQueued(session.store, preview.payload);
      session.signature = documentSignature(preview.payload);
      if (session.live) { setDocument(preview.payload); setMessage(`已保存并确认 ${preview.impact.length} 张图纸的比例尺，相关工程量已重算。修改前快照可在画布的版本记录中恢复。`); setDrafts({}); setPreview(null); }
    } catch (e) { if (session.live) setError(String(e.message || e)); }
    finally { if (session.live) setBusy(''); }
  }
  return <main className="sr-page">
    <header className="sr-header"><div><span className="sr-brand">QUANTIFIN / 图纸准备</span><h1>比例尺核对</h1><p>批量识别 · 集中核对 · 一次保存 <span>尺寸标注统一按 mm 解释</span></p></div><button onClick={() => leave('/takeoff')} disabled={!!busy}>返回算量工作区 →</button></header>
    <section className="sr-stats" aria-label="核对概览">{[['图纸页数', rows.length], ['已确认', rows.filter(r => status(r) === 'confirmed').length], ['待核对', rows.filter(r => status(r) === 'pending').length], ['待保存', Object.keys(drafts).length]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</section>
    {error && <div className="sr-alert sr-error" role="alert">{error}</div>}{message && <div className="sr-alert" role="status">{message}</div>}
    {conflict && <div className="sr-alert sr-error" role="alert">项目已更新，保存已暂停。<button disabled={!!busy} onClick={() => { if (!dirty || window.confirm('重新载入会清除本页未保存的修改，是否继续？')) setReload(v => v + 1); }}>重新载入项目</button></div>}
    <div className="sr-toolbar"><label>图纸筛选 <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索文件名称" /></label><select aria-label="筛选核对状态" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">全部状态</option><option value="pending">待核对</option><option value="confirmed">已确认</option><option value="draft">待保存</option><option value="error">读取失败</option></select><span>已选 {selected.size} 张</span><button disabled={blocked || !chosen.length} className="sr-primary" onClick={recognize}>一键识别选中图纸</button>{busy === 'scan' && <button onClick={() => { abortRef.current = true; setMessage('正在取消，当前图纸处理结束后停止。'); }}>取消识别</button>}</div>
    {busy && <div className="sr-progress" role="status">{busy === 'scan' ? `识别中 ${progress.done} / ${progress.total}，扫描图 OCR 可能需要较长时间` : busy === 'save' ? '正在备份与保存…' : '正在处理图纸…'}{busy === 'scan' && <progress value={progress.done} max={progress.total || 1}/>}</div>}
    <div className="sr-actions"><button disabled={blocked || !chosen.length} onClick={adopt}>采用选中建议</button><button disabled={blocked || !chosen.length} onClick={confirmExisting}>确认选中当前比例尺</button><label>统一设置 1 : <input type="number" min="1" value={ratio} onChange={e => setRatio(e.target.value)} aria-label="比例尺分母" /></label><button disabled={blocked || !chosen.length || !positive(ratio)} onClick={() => stageRatio(chosen)}>应用到选中图纸</button><button disabled={blocked || !dirty} className="sr-primary" onClick={prepareSave}>保存 {Object.keys(drafts).length} 张修改</button><button disabled={blocked || !dirty} onClick={() => { if (window.confirm('清除所有尚未保存的修改？')) setDrafts({}); }}>放弃修改</button></div>
    <div className="sr-workspace"><section className="sr-list" aria-label="图纸列表"><div className="sr-list-top"><label><input type="checkbox" aria-label="全选筛选结果" disabled={blocked} checked={visible.filter(r => !r.error).length > 0 && visible.filter(r => !r.error).every(r => selected.has(r.key))} onChange={e => setSelected(old => { const next = new Set(old); for (const row of visible.filter(r => !r.error)) { if (e.target.checked) next.add(row.key); else next.delete(row.key); } return next; })}/>全选筛选结果</label><button disabled={!!busy || !selected.size} onClick={() => setSelected(new Set())}>清空选择</button></div>
      {loading && <p role="status">正在读取图纸页数…</p>}
      {!loading && !rows.length && <div className="sr-empty"><h2>还没有导入图纸</h2><p>请先在工作台导入 PDF、图片或 ZIP 图纸包，再批量识别比例尺。</p><button onClick={() => leave('/')}>去导入图纸</button></div>}
      <table><thead><tr><th>选择</th><th>图纸 / 页码</th><th>当前比例尺</th><th>识别建议 / 依据</th><th>核对状态</th></tr></thead><tbody>{visible.map(row => {
        const result = results[row.key], current = saved.get(row.key), draft = drafts[row.key], state = status(row);
        return <tr key={row.key} className={active === row.key ? 'sr-active-row' : ''}>
          <td><input type="checkbox" aria-label={`选择 ${row.file} 第${row.page}页`} checked={selected.has(row.key)} disabled={blocked || !!row.error} onChange={e => setSelected(old => { const next = new Set(old); if (e.target.checked) next.add(row.key); else next.delete(row.key); return next; })}/></td>
          <td><button className="sr-row-link" disabled={!!row.error || !!busy} onClick={() => setActive(row.key)}>{row.file}<small>第 {row.page} 页 · {counts.get(row.key) || 0} 项测量</small></button></td>
          <td>{current?.scale_source === 'ocr' || current?.scale_source === 'calibrated' ? `${number(current.units_per_px * 304.8)} mm/px` : scaleLabel(current?.units_per_px)}{draft && <small className="sr-draft">→ {draft.scale_source === 'calibrated' || draft.scale_source === 'ocr' ? `${number(draft.units_per_px * 304.8)} mm/px` : scaleLabel(draft.units_per_px)}</small>}</td>
          <td>{result?.state === 'running' ? '正在识别…' : result?.state === 'error' ? '识别失败，可重试' : result?.proposal?.label || (result?.state === 'none' ? '未找到可靠结果' : result?.state === 'cancelled' ? '已取消，可重试' : '尚未识别')}<small>{row.error || result?.error || result?.evidence || ''}</small>{result?.proposal && <span className={`sr-tag ${result.proposal.multi || result.proposal.auto === false ? 'sr-warn' : ''}`}>{result.proposal.multi ? '证据冲突' : result.proposal.auto === false ? '需两点校准' : result.proposal.evidenceCount ? '多处尺寸证据' : '比例文字证据'}</span>}</td>
          <td><span className={`sr-tag ${state === 'pending' || state === 'error' ? 'sr-warn' : ''}`}>{({ confirmed: '已确认', pending: '待核对', draft: '待保存', error: '读取失败' })[state]}</span>{draft && <button className="sr-row-link" disabled={!!busy} onClick={() => setDrafts(old => { const next = { ...old }; delete next[row.key]; return next; })}>撤销修改</button>}</td>
        </tr>;
      })}</tbody></table>{!loading && rows.length > 0 && !visible.length && <p>没有符合筛选条件的图纸。</p>}
    </section><aside className="sr-detail">{activeRow && !activeRow.error && sessionRef.current ? <><h2>{activeRow.file}</h2><p>{results[active]?.evidence || '对照原图比例标注或已知尺寸，核对后再统一保存。'}</p><PagePreview key={`${reload}:${active}`} row={activeRow} getDoc={sessionRef.current.getDoc} evidence={results[active]?.proposal?.evidence} disabled={blocked} onCalibrate={(upp, dims) => { setDrafts(old => ({ ...old, [active]: { sheet_id: active, units_per_px: upp, scale_source: 'calibrated', dims } })); setMessage('已记录当前图纸的两点校准，点击保存后生效。'); }}/><button disabled={blocked || !positive(ratio)} onClick={() => stageRatio([activeRow])}>将当前图纸设为 1:{ratio}</button><p className="sr-footnote">纸面比例仅适用于按原尺寸导出的矢量 PDF。扫描图或图片请用两点校准。拼接图的独立比例尺请在算量画布中核对。</p></> : <p>选择图纸行，查看原图与校准工具。</p>}</aside></div>
    {preview && <div className="sr-modal-backdrop" style={{ zIndex: Z.modal }}><section role="dialog" aria-modal="true" aria-labelledby="sr-save-title" className="sr-modal"><h2 id="sr-save-title">确认保存 {preview.impact.length} 张图纸</h2><p>保存即表示你已核对这些比例尺。工程量会重新计算，计数保持不变；保存前自动创建快照。</p><p>下表为图元几何量合计，包含扣减图元，不是报表的净工程量。</p><div className="sr-impact"><table><thead><tr><th>图纸</th><th>比例尺</th><th>测量项</th><th>面积合计 m²</th><th>长度合计 m</th></tr></thead><tbody>{preview.impact.map(row => <tr key={row.key}><td>{row.key}</td><td>{row.before ? `${number(row.before * 304.8)} mm/px` : "未设置"} → {number(row.after * 304.8)} mm/px</td><td>{row.count}</td><td>{number(row.areaBefore)} → {number(row.areaAfter)}</td><td>{number(row.lengthBefore)} → {number(row.lengthAfter)}</td></tr>)}</tbody></table></div>{error && <p className="sr-error" role="alert">{error}</p>}<div className="sr-modal-actions"><button disabled={!!busy} onClick={() => setPreview(null)}>返回核对</button><button disabled={!!busy || conflict} className="sr-primary" onClick={commit}>{busy === 'save' ? '正在保存…' : '确认并保存'}</button></div></section></div>}
  </main>;
}
