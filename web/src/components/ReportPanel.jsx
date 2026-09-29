// Modified by Quantifin, 2026-09-28: localize user-facing editor labels; preserve data keys.
// ReportPanel — the takeoff deliverable. A STACK-style breakdown by condition
// (finish): measured quantity, waste %, and waste-adjusted order quantity, with
// a grand total. Exports to CSV / JSON, prints, and hosts the opt-in
// "Contribute to the open flooring model" flow.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../brand/icons.jsx";
import ToolMenu from "./ToolMenu.jsx";
import { conditionTotals, grandTotals, sheetTotals, sheetGroupedRows, labelGroupedRows, authorGroupedRows, sheetLabelGroupedRows, round2, totalsToCsv, downloadText, materialsSummary, reportJson, hasMultipliers } from "../lib/totals.js";
import { TABLE_PROFILE, CSV_PROFILE, colGetter, customColProfile, specColProfile, laborColProfile, rollColProfile, partitionRowsBy, forceIncludeGroupCol, loadColPrefs, saveColPrefs, loadGroupBy, saveGroupBy, visibleCols, floorPerimeterLf, applyUnits } from "../lib/reportColumns.js";
import { rollReportRows, seamLfByShape } from "../lib/rollTakeoff.js";
import { areaVal, areaUnit, lenVal, lenUnit } from "../lib/units";
import { columnLabel } from "../lib/conditionColumns.js";
import { shapeLabelValue } from "../lib/shapeLabels.js";
import { loadTemplates, saveTemplate, deleteTemplate, renameTemplate, mergeTemplates, overwriteTemplates } from "../lib/reportTemplates.js";
import { canSyncTemplates, pushTemplatesToDrive, loadTemplatesFromDrive } from "../lib/reportTemplatesSync.js";
import { useGoogleAuth } from "../lib/google/AuthContext.jsx";
import { projectHomeFolderId } from "../lib/projectHome.js";
import { getAccessToken } from "../lib/google/auth.js";
import { shapesDetail, shapesToCsv, shapesToJson } from "../lib/shapesExport.js";
import { buildSheetDxf, dxfFileName, DXF_MIME } from "../lib/dxf.js";
import { rfisToCsv, rfisToJson } from "../lib/rfi.js";
import { reportWorkbook, buildXlsx } from "../lib/xlsx.js";
import { buildContribution, sendContribution, isContributeConfigured } from "../lib/contribute.js";
import { activeTheme, saveActiveThemeFile, clearActiveTheme } from "../lib/reportTheme.js";
import { normalizeLogoToPng, loadProfiles, saveProfiles, activeProfile, updateActiveProfile, addProfile, setActiveProfile, removeProfile } from "../lib/identity.js";
import { loadBrandingSelection, saveBrandingSelection } from "../lib/branding.js";
import { resolveQuantifinBranding } from "../lib/quantifinBranding.js";
import { projectIdFromUrl } from "../lib/store.js";
import { describeConditionEdit, proposedConditionEditRows } from "../lib/proposals.js";

const num = (v, d = 1) => (Number(v) || 0).toLocaleString(undefined, { maximumFractionDigits: d });

// the report's one caveat line — page-strip on every printed page + masthead
const DISCLAIMER = "工程量依据图纸及所示比例尺计算，施工前请现场核实。";

// one-line hints for the opt-in columns in the picker (waste hint sits under
// the second waste checkbox so it reads once for the pair)
const COL_HINTS = {
  waste_lf: "损耗量 = 含损耗量 − 实测量",
  perimeter_ref: "周长仅供参考，包含洞口，不计入合计",
};

const sheetNum = (v, d = 1) => {
  const r = round2(v);
  // zero-gate at the DISPLAY precision, so a ±0.02 sliver shows "—", not "(0)"
  if (!Math.round(Math.abs(r) * 10 ** d)) return "—";
  if (r < 0) return <span style={{ color: "var(--c-danger)" }}>({num(-r, d)})</span>;
  return num(r, d);
};

const zhHeader = (text) => ({Finish:"饰面",Shapes:"测量项",Waste:"损耗率",EA:"数量",M:"长度 m","Floor m²":"地面 m²","Wall m²":"墙面 m²","Border m²":"边带 m²","m² w/Waste":"含损耗 m²", "Total m²":"合计 m²", "Perimeter m":"周长 m", "Roll Order m":"卷材订货 m", "Rolls":"卷数", "Seams m":"接缝 m"})[text] || text;

export default function ReportPanel({ projectName, onProjectName, conditions, shapes, sheetLabel, sheetDims, onMarkedSet, markedSetDark, onClose, markups = [], rfis = [], scaleInfo = [], provenanceCounters = null, clientInfo = {}, onClientInfo, conditionColumns = [], shapeLabels = [], units = "imperial", rollByCond = null, conditionEditProposals = [] }) {
  // proposals (#365): a pending condition-edit diff prints BESIDE the current
  // values — the row's numbers are always the current knobs; the chip says
  // what the agent proposed, and the JSON export carries the same rows.
  const editProposalByCond = useMemo(() => new Map((Array.isArray(conditionEditProposals) ? conditionEditProposals : []).filter((p) => p && p.condition_id).map((p) => [p.condition_id, p])), [conditionEditProposals]);
  const proposedEditRows = useMemo(() => proposedConditionEditRows(conditions, conditionEditProposals), [conditions, conditionEditProposals]);
  // memoized on the source arrays: project-name/client-info keystrokes re-render
  // the panel without touching conditions/shapes, so the totaling passes skip
  // imported report theme → { vars, name, warnings }. vars are spread onto this
  // panel's root so the theme scopes to the document subtree (screen + print +
  // masthead) without touching app chrome. Held in state so an import applies live.
  const [theme, setTheme] = useState(() => activeTheme());
  const [showTheme, setShowTheme] = useState(false);
  const themeRef = useRef(null);
  const themeFileRef = useRef(null);
  const importThemeFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = ""; // let the same file re-trigger onChange next time
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || "");
      try {
        JSON.parse(raw); // reject non-JSON before storing
        saveActiveThemeFile(raw);
        setTheme(activeTheme());
      } catch {
        setTheme((t) => ({ ...t, warnings: ["文件不是有效的 JSON；请选择设计令牌文件。"] }));
      }
    };
    reader.readAsText(f);
  };
  const resetTheme = () => { clearActiveTheme(); setTheme({ vars: {}, name: null, warnings: [] }); };

  // Figured seam LF per shape (#147) — what a materials row with basis
  // "seam_lf" (weld rod, seam tape) divides against. Per SHAPE, so the grouped
  // views below slice it for free instead of repeating the whole condition's
  // welding on every sheet. Empty map for a project with no roll goods, which
  // makes every seam_lf row read 0 — the honest answer before a layout exists.
  const seamCtx = useMemo(() => ({ seamByShape: seamLfByShape(rollByCond) }), [rollByCond]);
  const rows = useMemo(() => conditionTotals(conditions, shapes, seamCtx).filter((r) => r.shape_count > 0), [conditions, shapes, seamCtx]);
  const bySheet = useMemo(() => sheetTotals(conditions, shapes), [conditions, shapes]);
  const g = useMemo(() => grandTotals(rows), [rows]);
  const matSummary = useMemo(() => materialsSummary(rows), [rows]);
  const [showContribute, setShowContribute] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  // whether the Marked Set PDF carries the markups. Default on; ORTHOGONAL to the
  // canvas markup-layer hide — that never changes the export, only this does.
  const [includeMarkups, setIncludeMarkups] = useState(true);
  // bumped by the Project info modal on every company/branding save, so the
  // print masthead re-reads (a cheap localStorage parse + one meta-KV load)
  const [identityRev, setIdentityRev] = useState(0);
  // per-project branding selection (async meta KV); reloads when the modal saves
  // OR when the project id changes (a switch while the report stays mounted)
  const projectId = projectIdFromUrl();
  const [brandSel, setBrandSel] = useState({ mode: "default", profileId: null });
  useEffect(() => {
    let alive = true;
    loadBrandingSelection(projectId).then((s) => { if (alive) setBrandSel(s); });
    return () => { alive = false; };
  }, [identityRev, projectId]);
  // resolveBranding decides the masthead identity, the export title tag, and the
  // end credit. company is null in default mode → the firm block renders the
  // OpenTakeoff brand name instead of a trade-name identity (read only inside the
  // brand.clear branch below, so it is never dereferenced when null).
  const brand = resolveQuantifinBranding({ ...brandSel, profiles: loadProfiles().profiles });
  const company = brand.company;
  const hasClient = Boolean(clientInfo.client_name || clientInfo.client_address || clientInfo.reference || clientInfo.date);
  const [colPrefs, setColPrefs] = useState(loadColPrefs);
  const [showCols, setShowCols] = useState(false);
  const colsRef = useRef(null);
  // saved report templates (#114) — named column-visibility + grouping bundles
  const [templates, setTemplates] = useState(loadTemplates);
  const [showTemplates, setShowTemplates] = useState(false);
  const [tplName, setTplName] = useState("");
  const templatesRef = useRef(null);
  // optional Drive sync of templates (#115) — offered only when signed in AND a
  // Projects root is configured. googleUser/driveRoot are also the push/load args.
  const { user: googleUser } = useGoogleAuth();
  const driveRoot = projectHomeFolderId();
  const canSync = canSyncTemplates(googleUser, driveRoot);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  // custom columns append after each profile (frozen 13 → built-in opt-ins →
  // custom), so toggling one can never disturb the frozen CSV prefix
  const customCols = customColProfile(conditionColumns);
  // read-only product-spec columns (mfr/style/color/size) from "Import from
  // schedule" — appended AFTER the custom columns, present only when at least
  // one condition carries that spec field, so a no-spec project is byte-for-
  // byte unchanged (frozen 13 → built-in opt-ins → custom → spec)
  const specCols = specColProfile(conditions);
  // labor/subfloor-type columns, typed directly on the condition in the
  // Supporting Materials panel — appended after spec (frozen 13 → built-in
  // opt-ins → custom → spec → labor), present only when at least one
  // condition carries a laborType/subfloorType value.
  const laborCols = laborColProfile(conditions);
  // roll-goods columns (#136) — the figured order (Roll Order LF / Rolls)
  // beside the measured quantities, appended after labor (frozen 13 →
  // built-in opt-ins → custom → spec → labor → roll), present only when at
  // least one condition figures a roll layout.
  const rollCols = rollColProfile(rollByCond);
  // metric display converts AT THE DESCRIPTOR (applyUnits): headers swap to
  // m²/m, the SY column retires, and every dimensioned getter/foot wraps in
  // the converter — renderCell and the tfoot below need no unit awareness.
  // The CSV/XLSX exports get RAW descriptors + `units`; conversion happens
  // inside totalsToCsv/reportWorkbook so each output has ONE conversion site.
  const M = units === "metric";
  const AU = areaUnit(units), LU = lenUnit(units);
  const tableCols = applyUnits(visibleCols([...TABLE_PROFILE, ...customCols, ...specCols, ...laborCols, ...rollCols], colPrefs), units);
  // group-by choice: "" (none) | "sheet" | a custom column id; normalized
  // ONCE per render and used everywhere (select value AND partitioning) — a
  // stale colId must fall back to None, never reach the select or the
  // partitioner.
  const [groupByRaw, setGroupByRaw] = useState(loadGroupBy);
  // "label" is gated on the vocab existing — the group-by pref is one device-
  // global string, so a leftover "label" opened on a label-less project (or a
  // template carrying it) must fall back to ungrouped, exactly as a stale
  // custom-column id does.
  const hasAuthors = shapes.some((s) => typeof s.author === "string" && s.author.trim());
  const groupBy = groupByRaw === "sheet" || (groupByRaw === "label" && shapeLabels.length > 0) || (groupByRaw === "author" && hasAuthors) || conditionColumns.some((cc) => cc.id === groupByRaw) ? groupByRaw : "";
  // grouping force-includes its column in the CSV/XLSX even when hidden in
  // the picker (D7) — a grouped report's export always carries its grouping
  const csvCols = forceIncludeGroupCol(visibleCols([...CSV_PROFILE, ...customCols, ...specCols, ...laborCols, ...rollCols], colPrefs), customCols, groupBy);
  const perimByCond = useMemo(() => floorPerimeterLf(shapes), [shapes]);
  // custom-column values reach the getters through ctx, never as row fields
  // (conditionTotals rows are spread into the contribution payload)
  const attrsByCond = useMemo(() => new Map(conditions.map((c) => [c.id, c.attrs])), [conditions]);
  // spec columns read the imported product spec off the same ctx seam
  const specByCond = useMemo(() => new Map(conditions.map((c) => [c.id, c.spec])), [conditions]);
  // labor columns read the hand-typed labor/subfloor type off the same ctx seam
  const laborByCond = useMemo(() => new Map(conditions.map((c) => [c.id, { laborType: c.laborType, subfloorType: c.subfloorType }])), [conditions]);
  const ctx = { perimByCond, attrsByCond, specByCond, laborByCond, rollByCond };
  // grouped view. Custom-column mode partitions the already-computed rows
  // (no recompute); sheet mode re-runs conditionTotals per sheet's shapes —
  // ORDERED quantities per slice (waste + ×N applied), each group carrying
  // its own per-sheet perimByCond for that group's cells. sheetLabel is an
  // inline arrow recreated per parent render — apply it at render time,
  // never in the memo deps.
  //
  // Degenerate single-group partitions: a lone Unassigned group (nothing
  // assigned) and a lone sheet (single-sheet project) render exactly as
  // ungrouped — the chrome would say nothing. But a lone NAMED group (every
  // condition shares one real value) keeps the caption + header: the user
  // grouped precisely to put that value on the printed page, and the CSV
  // force-includes the column, so the two outputs must agree. Its subtotal is
  // still suppressed — it would duplicate the grand TOTAL directly below it.
  const groupCol = groupBy && groupBy !== "sheet" ? conditionColumns.find((cc) => cc.id === groupBy) : null;
  const colGroups = useMemo(() => (groupCol ? partitionRowsBy(rows, groupCol, attrsByCond) : null), [rows, groupCol, attrsByCond]);
  const sheetGroups = useMemo(() => (groupBy === "sheet" ? sheetGroupedRows(conditions, shapes, seamCtx) : null), [groupBy, conditions, shapes, seamCtx]);
  // label mode: ORDERED per-bucket rows (waste + ×N per slice), already shaped
  // { value, label, rows, perimByCond } like the sheet groups after mapping.
  const labelGroups = useMemo(() => (groupBy === "label" ? labelGroupedRows(conditions, shapes, shapeLabels, seamCtx) : null), [groupBy, conditions, shapes, shapeLabels, seamCtx]);
  // per-author rollups (#314) — same contract as the label groups
  const authorGroups = useMemo(() => (groupBy === "author" ? authorGroupedRows(conditions, shapes, seamCtx) : null), [groupBy, conditions, shapes, seamCtx]);
  const groups = sheetGroups
    ? sheetGroups.map((gp) => ({ value: gp.sheet_id, label: sheetLabel ? sheetLabel(gp.sheet_id) : gp.sheet_id, rows: gp.rows, perimByCond: gp.perimByCond }))
    : labelGroups || authorGroups || colGroups;
  const grouped = Boolean(groups && (groups.length > 1 || ((groupCol || groupBy === "label" || groupBy === "author") && groups.length === 1 && groups[0].value !== null)));
  // exports always carry the by-label breakdown when any shape is labeled,
  // independent of the current group-by view; empty (→ CSV/JSON byte-unchanged)
  // for label-less projects.
  const byLabelExport = useMemo(() => (shapes.some((s) => shapeLabelValue(s)) ? labelGroupedRows(conditions, shapes, shapeLabels, seamCtx) : []), [conditions, shapes, shapeLabels, seamCtx]);
  // The workbook's floor × room tab. Unlike byLabelExport this is NOT gated on
  // a label existing: an unlabeled project's tab is one Unlabeled roll-up per
  // floor, which still reconciles to By sheet — and the workbook's tab list
  // stays fixed whatever the project carries.
  const byFloorRoom = useMemo(() => sheetLabelGroupedRows(conditions, shapes, shapeLabels, seamCtx), [conditions, shapes, shapeLabels, seamCtx]);

  // while the report is up, the print stylesheet (app.css @media print) hides
  // the canvas chrome behind it and lets the report flow across pages
  useEffect(() => {
    document.body.classList.add("report-open");
    return () => document.body.classList.remove("report-open");
  }, []);

  // columns popover closes on any click outside it
  useEffect(() => {
    if (!showCols) return;
    const onDown = (e) => { if (colsRef.current && !colsRef.current.contains(e.target)) setShowCols(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showCols]);

  // templates popover — same outside-click close as columns
  useEffect(() => {
    if (!showTemplates) return;
    const onDown = (e) => { if (templatesRef.current && !templatesRef.current.contains(e.target)) setShowTemplates(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showTemplates]);

  useEffect(() => {
    if (!showTheme) return;
    const onDown = (e) => { if (themeRef.current && !themeRef.current.contains(e.target)) setShowTheme(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showTheme]);

  // Apply a template: set BOTH the column prefs and the grouping mode, and write
  // them through to the sticky defaults so the layout persists (and #14's "By
  // label" mode, captured as a string, self-heals via the group-by normalizer on
  // a label-less project). Save-as snapshots the CURRENT layout under a name;
  // groupByRaw (not the normalized groupBy) is captured so the user's real choice
  // round-trips even when momentarily invalid.
  const applyTemplate = (t) => {
    setColPrefs(t.cols); saveColPrefs(t.cols);
    setGroupByRaw(t.groupBy); saveGroupBy(t.groupBy);
    setShowTemplates(false);
  };
  const saveAsTemplate = () => {
    const nm = tplName.trim();
    if (!nm) return;
    setTemplates(saveTemplate(nm, colPrefs, groupByRaw));
    setTplName("");
  };
  const renameTpl = (t) => {
    const nm = (window.prompt("重命名报表模板：", t.name) || "").trim();
    if (!nm || nm === t.name) return;
    setTemplates(renameTemplate(t.id, nm));
  };

  // Push/Load — Drive sync (#115). drive.js is a DYNAMIC import so the Drive
  // client never lands in the anonymous bundle (mirrors ProjectHome.jsx);
  // getAccessToken is safe to import statically (auth.js already ships).
  const pushToDrive = async () => {
    if (!canSync || syncBusy) return;
    setSyncBusy(true); setSyncMsg("正在保存到 Drive…");
    try {
      const { createDrive } = await import("../lib/google/drive.js");
      const { count } = await pushTemplatesToDrive(createDrive({ getToken: getAccessToken }), driveRoot, googleUser.email, templates);
      setSyncMsg(`已保存 ${count} 个模板到 Drive。`);
    } catch (e) {
      setSyncMsg(`保存失败：${String(e?.message || e)}`);
    } finally { setSyncBusy(false); }
  };
  const loadFromDrive = async () => {
    if (!canSync || syncBusy) return;
    setSyncBusy(true); setSyncMsg("正在从 Drive 载入…");
    try {
      const { createDrive } = await import("../lib/google/drive.js");
      const remote = await loadTemplatesFromDrive(createDrive({ getToken: getAccessToken }), driveRoot, googleUser.email);
      // Merge against the IN-MEMORY set (the source of truth the popover shows),
      // not a fresh localStorage read — a blocked-storage read would look empty
      // and drop templates that are live in state.
      const before = templates.length;
      const merged = overwriteTemplates(mergeTemplates(templates, remote));
      setTemplates(merged);
      const added = merged.length - before;
      // Disambiguate a zero result: an empty Drive file reads differently to a
      // user than "you already have everything on Drive."
      setSyncMsg(added > 0 ? `已从 Drive 载入 ${added} 个模板。` : remote.length === 0 ? "Drive 中尚无模板。" : "已是最新，没有新增模板。");
    } catch (e) {
      setSyncMsg(`载入失败：${String(e?.message || e)}`);
    } finally { setSyncBusy(false); }
  };

  // no-waste actuals view for labor: hides the waste-baked columns, surfaces
  // the raw Total SF opt-in — same diff-from-default shape applyTemplate uses.
  // No rate/cost math — the user attaches labor $ externally.
  const applyLaborPreset = () => {
    const cols = { waste_pct: false, total_sf_net: false, sy_net: false, total_sf: true };
    setColPrefs(cols); saveColPrefs(cols);
  };

  // store only diffs from defaultVisible — a key toggled back to default is dropped
  const toggleCol = (col) => {
    const next = { ...colPrefs };
    const want = !(colPrefs[col.key] ?? col.defaultVisible);
    if (want === col.defaultVisible) delete next[col.key]; else next[col.key] = want;
    setColPrefs(next);
    saveColPrefs(next);
  };

  const baseName = (projectName || "takeoff").replace(/[^\w.-]+/g, "_");
  const exportCsv = () => downloadText(`${baseName}.csv`, totalsToCsv(rows, projectName, bySheet, sheetLabel, csvCols, ctx, byLabelExport.length ? byLabelExport : null, brand.brandName, units), "text/csv");
  const exportJson = () => downloadText(`${baseName}.json`,
    JSON.stringify(reportJson({ projectName, rows, bySheet, scaleInfo, markups, rfis, sheetLabel, conditionColumns, attrsByCond, shapeLabels, byLabel: byLabelExport, displayUnits: units, rollGoods: rollReportRows(rollByCond, rows), proposedConditionEdits: proposedEditRows }), null, 2),
    "application/json");
  const exportRfisCsv = () => downloadText(`${baseName}_rfis.csv`, rfisToCsv(rfis, markups, projectName, sheetLabel, brand.brandName), "text/csv");
  const exportRfisJson = () => downloadText(`${baseName}_rfis.json`,
    JSON.stringify(rfisToJson(rfis, projectName), null, 2), "application/json");
  // Excel workbook — same sources as the CSV/JSON (Conditions tab follows the
  // column picker like the CSV); buildXlsx lazy-loads fflate on first use
  const exportXlsx = async () => {
    const sheets = reportWorkbook({ rows, bySheet, shapeRows: shapesDetail(conditions, shapes, sheetLabel), cols: csvCols, ctx, sheetLabel, units, byFloorRoom });
    const bytes = await buildXlsx(sheets);
    downloadText(`${baseName}.xlsx`, bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  };
  const exportShapesCsv = () => downloadText(`${baseName}_shapes.csv`, shapesToCsv(shapesDetail(conditions, shapes, sheetLabel), projectName, brand.brandName), "text/csv");
  const exportShapesJson = () => downloadText(`${baseName}_shapes.json`,
    JSON.stringify(shapesToJson(shapesDetail(conditions, shapes, sheetLabel), projectName), null, 2),
    "application/json");
  // DXF (CAD): one drawing per sheet — a sheet IS a drawing — so a multi-sheet
  // takeoff downloads as a zip of per-sheet DXFs and a single sheet as the
  // .dxf itself. Only calibrated sheets that carry shapes qualify; the skip
  // list is spoken, never swallowed (a CAD file missing a ring is a lie).
  const dxfSheets = useMemo(() => {
    const upp = Object.fromEntries(scaleInfo.map((s) => [s.sheet_id, s.units_per_px]));
    const ids = [...new Set(shapes.map((s) => s.sheet_id))];
    return ids.filter((id) => upp[id] > 0 && (sheetDims?.(id)?.w > 0)).map((id) => ({ id, upp: upp[id] }));
  }, [shapes, scaleInfo, sheetDims]);
  const dxfSkipped = useMemo(() => {
    const ok = new Set(dxfSheets.map((s) => s.id));
    return [...new Set(shapes.map((s) => s.sheet_id))].filter((id) => !ok.has(id));
  }, [shapes, dxfSheets]);
  const exportDxf = async () => {
    const built = dxfSheets.map(({ id, upp }) => {
      const label = sheetLabel ? sheetLabel(id) : id;
      const b = buildSheetDxf({ sheet_id: id, label, dims: sheetDims(id), upp, shapes, conditions }, { units: units === "metric" ? "m" : "ft" });
      return { name: dxfFileName(projectName || "takeoff", label), dxf: b.dxf };
    });
    if (built.length === 1) { downloadText(built[0].name, built[0].dxf, DXF_MIME); return; }
    const { zipSync, strToU8 } = await import("fflate"); // lazy — same pattern as xlsx.js
    const files = {};
    for (const f of built) files[files[f.name] ? f.name.replace(/\.dxf$/, `_${Object.keys(files).length}.dxf`) : f.name] = strToU8(f.dxf);
    downloadText(`${baseName}_dxf.zip`, zipSync(files, { level: 6 }), "application/zip");
  };

  const th = { textAlign: "right", padding: "7px 6px", fontFamily: "var(--f-mono)", fontSize: 12.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-muted)", borderBottom: "1.25px solid var(--ink)", whiteSpace: "nowrap" };
  const td = { textAlign: "right", padding: "8px 6px", fontVariantNumeric: "tabular-nums", borderBottom: "1px solid var(--ink-faint)", whiteSpace: "nowrap" };

  // one condition-table cell, keyed off the column profile; values come
  // through the shared colGetter so the table and the CSV read the same
  // numbers. Sheet groups pass their own ctx (per-sheet perimByCond).
  const renderCell = (col, r, cellCtx) => {
    const get = colGetter(col);
    const v = get ? get(r, cellCtx) : r[col.key];
    // custom columns, read-only spec columns, and labor/subfloor-type columns:
    // plain left-aligned text (already coerced to string by their getter);
    // TOTAL cells stay blank (no foot). spec cells can hold sentence-length
    // values (esp. Description) — let them WRAP and cap the width so one long
    // value can't push report/print columns off the page edge (mirrors the
    // notes cell below). Custom and labor columns stay nowrap.
    if (col.custom || col.spec || col.labor) {
      const cell = col.spec ? { ...td, textAlign: "left", whiteSpace: "normal", maxWidth: 240 } : { ...td, textAlign: "left" };
      return <td key={col.key} style={cell}>{v || "—"}</td>;
    }
    switch (col.key) {
      case "finish":
        return (
          <td key={col.key} style={{ ...td, textAlign: "left" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 12, height: 12, background: r.color, display: "inline-block", border: "1px solid var(--ink-faint)" }} />
              <strong style={{ fontFamily: "var(--f-mono)", fontWeight: 600 }}>{r.finish_tag}</strong>
              {r.multiplier > 1 && <span style={{ color: "var(--ink-muted)", fontSize: 11 }}>×{r.multiplier}</span>}
            </span>
            {/* proposals (#365): the pending diff beside the current values —
                the numbers in this row are what the takeoff stands on today */}
            {editProposalByCond.get(r.id) && (
              <span data-proposed-edit={editProposalByCond.get(r.id).id} title={`Proposed by the agent, pending your acceptance in the Takeoffs panel${editProposalByCond.get(r.id).rationale ? ` — ${editProposalByCond.get(r.id).rationale}` : ""}. This row shows the current values.`}
                style={{ display: "block", marginTop: 3, fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--cobalt)", whiteSpace: "nowrap" }}>
                proposed: {describeConditionEdit(conditions.find((c) => c.id === r.id), editProposalByCond.get(r.id)).map((d) => `${d.field} ${d.from} → ${d.to}`).join(" · ")}
              </span>
            )}
          </td>
        );
      case "shapes":
        return <td key={col.key} style={td}>{v}</td>;
      case "waste_pct":
        return <td key={col.key} style={td}>{v ? `${num(v, 0)}%` : "—"}</td>;
      case "ea":
        return <td key={col.key} style={td}>{v ? num(v, 0) : "—"}</td>;
      case "total_sf_net":
        return <td key={col.key} style={{ ...td, fontWeight: 700, color: "var(--cobalt)" }}>{r.total_sf ? num(v) : "—"}</td>;
      case "sy_net":
        return <td key={col.key} style={{ ...td, color: "var(--cobalt)" }}>{r.total_sf ? num(v) : "—"}</td>;
      case "perimeter_ref":
        return <td key={col.key} style={{ ...td, color: "var(--ink-muted)" }}>{v ? num(v) : "—"}</td>;
      default: // floor_sf, wall_sf, border_sf, lf, waste_sf, waste_lf, …
        return <td key={col.key} style={td}>{v ? num(v) : "—"}</td>;
    }
  };

  // picker row — locked columns (finish) are filtered out of the lists below
  const colCheckbox = (c) => (
    <React.Fragment key={c.key}>
      <label style={{ display: "flex", gap: 8, alignItems: "center", padding: "3px 0", cursor: "pointer" }}>
        <input name="report-column-toggle" type="checkbox" checked={colPrefs[c.key] ?? c.defaultVisible} onChange={() => toggleCol(c)} />
        <span>{zhHeader(c.header)}</span>
      </label>
      {COL_HINTS[c.key] && (
        <div style={{ margin: "0 0 4px 24px", fontSize: 10.5, color: "var(--ink-muted)", lineHeight: 1.5 }}>{COL_HINTS[c.key]}</div>
      )}
    </React.Fragment>
  );

  return (
    <div className="report-panel" style={{ ...theme.vars, position: "absolute", inset: 0, zIndex: 50, display: "flex", flexDirection: "column", background: "var(--paper-cream)" }}>
      <div className="report-toolbar" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: "1px solid var(--ink)", background: "var(--paper-bright)" }}>
        <Icon name="takeoffs" size={18} />
        <strong style={{ fontFamily: "var(--f-display)", fontSize: 16, color: "var(--ink)" }}>工程量报表</strong>
         <input name="project-name" value={projectName} onChange={(e) => onProjectName(e.target.value)} placeholder="项目名称（选填）"
          className="field-input" style={{ width: 260, padding: "5px 9px", fontSize: 13 }} />
        <div style={{ flex: 1 }} />
        <button className="btn-ghost" onClick={() => setShowInfo(true)}
           title="设置公司信息及打印报表、标注图纸封面的项目资料">项目信息</button>
        {/* always rendered, even with zero custom columns — Sheet grouping
            is useful on its own */}
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--ink)", whiteSpace: "nowrap" }}
           title="按指定字段分组并显示小计">
          分组：
          <select name="report-group-by" value={groupBy} onChange={(e) => { setGroupByRaw(e.target.value); saveGroupBy(e.target.value); }}
            style={{ padding: "5px 6px", border: "1px solid var(--ink-faint)", background: "transparent", fontSize: 12, maxWidth: 160 }}>
            <option value="">不分组</option>
            <option value="sheet">图纸</option>
             {shapeLabels.length > 0 && <option value="label">标签</option>}
            {hasAuthors && <option value="author">作者</option>}
            {conditionColumns.map((cc) => (
              <option key={cc.id} value={cc.id}>{columnLabel(cc)}</option>
            ))}
          </select>
        </label>
        <div ref={colsRef} style={{ position: "relative" }}>
           <button className="btn-ghost" onClick={() => setShowCols((s) => !s)} title="选择报表和 CSV 显示的列">报表字段</button>
          {showCols && (
            <div className="report-modal" style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 70, width: 272, background: "var(--paper-bright)", border: "1px solid var(--ink)", boxShadow: "var(--shadow-2)", padding: "10px 12px", fontSize: 12.5, color: "var(--ink)" }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
                 <strong style={{ fontFamily: "var(--f-display)", fontSize: 13 }}>报表字段</strong>
                <div style={{ flex: 1 }} />
                 <button onClick={applyLaborPreset} title="按饰面显示不含损耗的实测量"
                   style={{ border: "none", background: "transparent", color: "var(--cobalt)", cursor: "pointer", fontSize: 11.5, padding: "0 10px 0 0" }}>人工清单</button>
                 <button onClick={() => { setColPrefs({}); saveColPrefs({}); }} title="恢复默认字段"
                  style={{ border: "none", background: "transparent", color: "var(--cobalt)", cursor: "pointer", fontSize: 11.5, padding: "0 10px 0 0" }}>重置</button>
                <button onClick={() => setShowCols(false)} title="关闭"
                  style={{ border: "none", background: "transparent", color: "var(--ink-muted)", cursor: "pointer", fontSize: 13, padding: 0, lineHeight: 1 }}>✕</button>
              </div>
              {TABLE_PROFILE.filter((c) => !c.locked && c.defaultVisible).map(colCheckbox)}
               <div style={{ borderTop: "1px solid var(--ink-faint)", margin: "8px 0 4px", paddingTop: 6, fontFamily: "var(--f-mono)", fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-muted)" }}>可选字段</div>
              {TABLE_PROFILE.filter((c) => !c.locked && !c.defaultVisible).map(colCheckbox)}
               <div style={{ borderTop: "1px solid var(--ink-faint)", margin: "8px 0 4px", paddingTop: 6, fontFamily: "var(--f-mono)", fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-muted)" }}>自定义字段</div>
              {customCols.length ? customCols.map(colCheckbox) : (
                 <div style={{ fontSize: 10.5, color: "var(--ink-muted)", lineHeight: 1.5 }}>尚无自定义字段；可在画布的饰面设置中添加。</div>
              )}
              {/* read-only product-spec columns — only shown when a schedule
                  import attached spec data to at least one condition */}
              {specCols.length > 0 && (
                <>
                   <div style={{ borderTop: "1px solid var(--ink-faint)", margin: "8px 0 4px", paddingTop: 6, fontFamily: "var(--f-mono)", fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-muted)" }}>导入的产品规格</div>
                  {specCols.map(colCheckbox)}
                </>
              )}
              {/* labor/subfloor-type columns — only shown once a condition has
                  a value typed in from the Supporting Materials panel */}
              {laborCols.length > 0 && (
                <>
                   <div style={{ borderTop: "1px solid var(--ink-faint)", margin: "8px 0 4px", paddingTop: 6, fontFamily: "var(--f-mono)", fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-muted)" }}>人工与基层</div>
                  {laborCols.map(colCheckbox)}
                </>
              )}
               <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--ink-muted)" }}>设置也应用于 CSV 导出；按自定义字段分组时，导出文件会包含该字段。</p>
            </div>
          )}
        </div>
        <div ref={templatesRef} style={{ position: "relative" }}>
           <button className="btn-ghost" onClick={() => setShowTemplates((s) => !s)} title="保存或调用报表字段和分组设置">报表模板{templates.length ? ` (${templates.length})` : ""}</button>
          {showTemplates && (
            <div className="report-modal" style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 70, width: 260, background: "var(--paper-bright)", border: "1px solid var(--ink)", boxShadow: "var(--shadow-2)", padding: "10px 12px", fontSize: 12.5, color: "var(--ink)" }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
                <strong style={{ fontFamily: "var(--f-display)", fontSize: 13 }}>报表模板</strong>
                <div style={{ flex: 1 }} />
                <button onClick={() => setShowTemplates(false)} title="关闭"
                  style={{ border: "none", background: "transparent", color: "var(--ink-muted)", cursor: "pointer", fontSize: 13, padding: 0, lineHeight: 1 }}>✕</button>
              </div>
               <div style={{ fontSize: 10.5, color: "var(--ink-muted)", lineHeight: 1.4, marginBottom: 6 }}>模板保存在当前设备；点击名称即可应用。</div>
               {templates.length === 0 && <div style={{ fontSize: 10.5, color: "var(--ink-muted)", marginBottom: 6 }}>尚无已保存的模板。</div>}
              {templates.map((t) => (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 0" }}>
                   <button onClick={() => applyTemplate(t)} title="应用此模板"
                    style={{ flex: 1, minWidth: 0, textAlign: "left", border: "none", background: "transparent", color: "var(--ink)", cursor: "pointer", fontSize: 12, padding: "3px 4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</button>
                   <button onClick={() => renameTpl(t)} title="重命名"
                    style={{ padding: "0 3px", border: "none", background: "transparent", color: "var(--ink-muted)", cursor: "pointer", fontSize: 11 }}>✎</button>
                   <button onClick={() => setTemplates(deleteTemplate(t.id))} title="删除此模板"
                    style={{ padding: "0 3px", border: "none", background: "transparent", color: "var(--c-danger)", cursor: "pointer", fontSize: 11 }}>✕</button>
                </div>
              ))}
              <div style={{ display: "flex", alignItems: "center", gap: 6, borderTop: "1px solid var(--ink-faint)", marginTop: 6, paddingTop: 8 }}>
                <input name="template-name" value={tplName} onChange={(e) => setTplName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && saveAsTemplate()}
                   placeholder="输入模板名称" style={{ flex: 1, minWidth: 0, padding: "3px 6px", borderRadius: 0, border: "1px solid var(--ink-faint)", fontSize: 12 }} />
                 <button onClick={saveAsTemplate} disabled={!tplName.trim()} title="保存当前字段和分组设置"
                  style={{ padding: "3px 8px", borderRadius: 0, border: "1px dashed var(--ink-faint)", background: "transparent", color: "var(--ink-muted)", cursor: "pointer", fontSize: 12 }}>保存</button>
              </div>
              {/* Optional Drive sync — only when signed in and a Projects root is
                  configured. Load MERGES (this device wins on a name clash); it
                  does not pull remote deletes/edits, so the copy stays "Load," not
                  "Sync," to avoid over-promising two-way behavior. */}
              {canSync && (
                <div style={{ borderTop: "1px solid var(--ink-faint)", marginTop: 8, paddingTop: 8 }}>
                   <div style={{ fontSize: 10.5, color: "var(--ink-muted)", lineHeight: 1.4, marginBottom: 6 }}>可通过 Drive 在自己的设备间传递模板。载入只添加本机没有的模板，不覆盖同名模板。</div>
                  <div style={{ display: "flex", gap: 6 }}>
                     <button onClick={pushToDrive} disabled={syncBusy} title="写入私人 Drive 文件"
                       style={{ flex: 1, padding: "4px 8px", borderRadius: 0, border: "1px solid var(--ink-faint)", background: "transparent", color: "var(--cobalt)", cursor: syncBusy ? "default" : "pointer", fontSize: 12 }}>保存到 Drive</button>
                     <button onClick={loadFromDrive} disabled={syncBusy} title="将 Drive 模板合并到本机"
                       style={{ flex: 1, padding: "4px 8px", borderRadius: 0, border: "1px solid var(--ink-faint)", background: "transparent", color: "var(--cobalt)", cursor: syncBusy ? "default" : "pointer", fontSize: 12 }}>从 Drive 载入</button>
                  </div>
                  {syncMsg && <div style={{ fontSize: 10.5, color: "var(--ink-muted)", marginTop: 6 }}>{syncMsg}</div>}
                </div>
              )}
            </div>
          )}
        </div>
        <div ref={themeRef} style={{ position: "relative" }}>
           <button className="btn-ghost" onClick={() => setShowTheme((s) => !s)} title="为报表导入配色和字体样式">报表样式{theme.name ? " ●" : ""}</button>
          {showTheme && (
            <div className="report-modal" style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 70, width: 292, background: "var(--paper-bright)", border: "1px solid var(--ink)", boxShadow: "var(--shadow-2)", padding: "10px 12px", fontSize: 12.5, color: "var(--ink)" }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
                 <strong style={{ fontFamily: "var(--f-display)", fontSize: 13 }}>报表样式</strong>
                <div style={{ flex: 1 }} />
                <button onClick={() => setShowTheme(false)} title="关闭"
                  style={{ border: "none", background: "transparent", color: "var(--ink-muted)", cursor: "pointer", fontSize: 13, padding: 0, lineHeight: 1 }}>✕</button>
              </div>
              <div style={{ fontSize: 11, color: "var(--ink-muted)", lineHeight: 1.5, marginBottom: 8 }}>
                 导入设计令牌文件（如 <code>tokens.json</code>）可更改报表配色和字体，不影响公司信息。
              </div>
              {theme.name ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span className="pip" />
                  <div style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }} title={theme.name}>{theme.name}</div>
                </div>
              ) : (
                 <div style={{ fontSize: 11.5, color: "var(--ink-muted)", marginBottom: 8 }}>当前使用默认样式。</div>
              )}
              <div style={{ display: "flex", gap: 6 }}>
                 <button onClick={() => themeFileRef.current?.click()} title="选择设计令牌文件"
                   style={{ flex: 1, padding: "5px 8px", border: "1px solid var(--ink)", background: "var(--ink)", color: "var(--paper-bright)", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>导入样式…</button>
                {theme.name && (
                   <button onClick={resetTheme} title="移除导入样式并恢复默认"
                    style={{ padding: "5px 10px", border: "1px solid var(--ink-faint)", background: "transparent", color: "var(--cobalt)", cursor: "pointer", fontSize: 12 }}>重置</button>
                )}
              </div>
              {theme.warnings.length > 0 && (
                <ul style={{ margin: "8px 0 0", paddingLeft: 16, fontSize: 10.5, color: "var(--c-warning)", lineHeight: 1.5 }}>
                  {theme.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
              <input ref={themeFileRef} type="file" accept="application/json,.json" onChange={importThemeFile} style={{ display: "none" }} />
            </div>
          )}
        </div>
        {/* Exports consolidated into Export ▾; browser print + marked set into
            Print ▾. JSON / Print / Marked set intentionally work markups-only
            ("Revisions noted" renders from markups alone); CSV stays rows-only.
            Every item keeps the exact disabled condition + tooltip its button
            carried. RFI exports stay their own controls, shown only when RFIs exist. */}
        <ToolMenu
           title="下载报表和测量数据"
          disabled={!rows.length && !shapes.length && !markups.length && !rfis.length}
          face={<><Icon name="document" size={13} />导出</>}
          items={[
            { section: "工程量报表" },
            { id: "csv", icon: "document", label: "CSV", disabled: !rows.length, onSelect: exportCsv },
             { id: "xlsx", icon: "document", label: "Excel", disabled: !rows.length, title: "含饰面、分图纸、材料和测量明细的工作簿", onSelect: exportXlsx },
             { id: "json", icon: "document", label: "JSON", disabled: !rows.length && !markups.length && !rfis.length, title: "结构化数据；仅有批注或 RFI 时也可导出", onSelect: exportJson },
             { section: "测量明细" },
             { id: "shapes-csv", icon: "document", label: "测量明细 CSV", disabled: !shapes.length, title: "逐项实测量，不含系数和损耗", onSelect: exportShapesCsv },
             { id: "shapes-json", icon: "document", label: "测量明细 JSON", disabled: !shapes.length, title: "逐项实测量，不含系数和损耗", onSelect: exportShapesJson },
             { id: "dxf", icon: "document", label: dxfSheets.length > 1 ? `DXF (CAD) · ${dxfSheets.length} 张图纸` : "DXF (CAD)", disabled: !dxfSheets.length,
               title: !shapes.length ? "尚无测量记录"
                 : !dxfSheets.length ? "请先为有测量记录的图纸设置比例尺，再导出 CAD 文件"
                 : `按饰面生成封闭多段线，单位为${units === "metric" ? "米" : "英尺"}，每张图纸一个文件${dxfSkipped.length ? `；已跳过 ${dxfSkipped.length} 张未校准图纸` : ""}`,
              onSelect: exportDxf },
          ]}
        />
        <ToolMenu
           title="打印报表或生成标注图纸 PDF"
          disabled={!rows.length && !markups.length && !rfis.length /* both items are disabled exactly here: with no rows/rfis, the marked-set condition also collapses to true */}
          face={<span>打印</span>}
          items={[
             { id: "print", label: "打印报表", disabled: !rows.length && !markups.length && !rfis.length, title: "使用浏览器打印或另存为 PDF", onSelect: () => window.print() },
            ...(onMarkedSet ? [
              "divider",
               { section: "标注图纸" },
               ...(markups.length > 0 ? [{ id: "inc-markups", label: "包含批注", checked: includeMarkups, stayOpen: true, title: "将云线、引线、备注和高亮纳入 PDF；与画布图层开关互不影响", onSelect: () => setIncludeMarkups((v) => !v) }] : []),
               { id: "marked-set", icon: "document", label: `下载标注图纸${markedSetDark ? " ☾" : ""}`, disabled: !rows.length && (!includeMarkups || !markups.length) && !rfis.length, title: `导出含测量标记和图例封面的 PDF${markedSetDark ? "（深色模式）" : ""}`, onSelect: () => onMarkedSet(includeMarkups) },
            ] : []),
          ]}
        />
        {rfis.length > 0 && (
          <>
            <button className="btn-ghost" onClick={exportRfisCsv}
               title="导出 RFI 问题记录及关联的批注、图纸"><Icon name="rfi" size={13} />RFI CSV</button>
            <button className="btn-ghost" onClick={exportRfisJson}
               title="将 RFI 问题记录导出为 JSON"><Icon name="rfi" size={13} />RFI JSON</button>
          </>
        )}
        <button className="btn-primary" onClick={() => setShowContribute(true)} disabled={!rows.length}
           title="自愿向开放地面材料模型贡献衍生算量数据">
          <Icon name="oneClick" size={13} />贡献数据
        </button>
         <button onClick={onClose} title="返回图纸画布（Esc）"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", border: "1px solid var(--ink-faint)", background: "transparent", color: "var(--ink)", cursor: "pointer", fontSize: 12.5 }}>
          <Icon name="close" size={12} />关闭
        </button>
      </div>

      <div className="report-scroll" style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
        {/* print pagination: the flow-table's thead repeats this one-line strip at
            the top of every printed page (screen hides it) — a fixed footer would
            overlap the last row of intermediate pages */}
        <table className="report-flow"><thead><tr><td>
           {projectName || "未命名项目"} — {DISCLAIMER}
        </td></tr></thead><tbody><tr><td>
        {/* print-only masthead — hidden on screen via app.css. Title-block header
            (logo/firm row · project title · bordered fact grid), the drafting-
            spec-book letterhead treatment. */}
        <div className="report-print-header">
          {/* firm row: logo + name/address on the left, report kind on the right,
              closed by a strong rule */}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, borderBottom: "1.25px solid var(--ink)", paddingBottom: 9 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
              {/* clear-label: the trade-name identity. default: the OpenTakeoff
                  brand name (no company data shown — "purely OpenTakeoff") */}
              {brand.clear ? (
                <>
                  {company.logo && <img src={company.logo} alt="" style={{ maxHeight: 46, maxWidth: 170, objectFit: "contain", display: "block" }} />}
                  {(company.name || company.address) && (
                    <div style={{ minWidth: 0 }}>
                      {company.name && <div style={{ fontFamily: "var(--f-display)", fontWeight: 700, fontSize: 12.5, lineHeight: 1.15 }}>{company.name}</div>}
                      {company.address && <div style={{ fontSize: 11, color: "var(--ink-muted)", whiteSpace: "pre-line", lineHeight: 1.35 }}>{company.address}</div>}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontFamily: "var(--f-display)", fontWeight: 700, fontSize: 12.5, lineHeight: 1.15 }}>{brand.brandName}</div>
              )}
            </div>
             <div style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--ink-muted)", whiteSpace: "nowrap" }}>工程量报表</div>
          </div>

          {/* project title */}
           <div style={{ fontFamily: "var(--f-display)", fontSize: 25, fontWeight: 700, letterSpacing: "0.005em", textTransform: "uppercase", lineHeight: 0.98, margin: "11px 0 9px" }}>{projectName || "未命名项目"}</div>

          {/* title-block fact grid */}
          {(() => {
            const cells = [
               ["客户", clientInfo.client_name],
               ["项目编号", clientInfo.reference],
               ["日期", clientInfo.date || new Date().toLocaleDateString("zh-CN")],
               ["编制单位", brand.brandName],
            ];
            return (
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${cells.length}, 1fr)`, border: "1px solid var(--ink)", marginBottom: hasClient && clientInfo.client_address ? 8 : 12 }}>
                {cells.map(([k, v], i) => (
                  <div key={k} style={{ padding: "7px 11px", borderRight: i < cells.length - 1 ? "1px solid var(--ink-faint)" : "none", minWidth: 0 }}>
                    <div style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-muted)", marginBottom: 2 }}>{k}</div>
                    <div style={{ fontFamily: "var(--f-body)", fontSize: 12.5, fontWeight: 500, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v || "—"}</div>
                  </div>
                ))}
              </div>
            );
          })()}
          {/* client address rides below the grid (multi-line; capped so a pasted
              40-line address can't eat the page) */}
          {hasClient && clientInfo.client_address && (
            <div style={{ fontSize: 11, color: "var(--ink-muted)", whiteSpace: "pre-line", lineHeight: 1.4, marginBottom: 12 }}>{clientInfo.client_address.split("\n").slice(0, 4).join("\n")}</div>
          )}

          {/* meta footer: scale provenance · attribution · disclaimer */}
          <div style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--ink-muted)", lineHeight: 1.6, borderTop: "1px solid var(--ink-faint)", paddingTop: 6, marginBottom: 12 }}>
            {scaleInfo.map((si) => (
               <div key={si.sheet_id}>{sheetLabel ? sheetLabel(si.sheet_id) : si.sheet_id} — {!si.scale_source || si.scale_source === "unknown" ? "已设置比例尺，来源未记录" : si.scale_source}{si.scale_confirmed === false ? <span style={{ color: "var(--c-warning)", fontWeight: 700 }}> · 自动设置，待人工确认</span> : null}</div>
            ))}
             <div>生成日期：{new Date().toLocaleDateString("zh-CN")}</div>
            <div>{DISCLAIMER}</div>
          </div>
        </div>
        {/* the empty-state hides once markups exist — "Revisions noted" below
            renders from markups alone, and "Nothing measured yet" reading as a
            headline above a populated table was a lie */}
        {!rows.length ? (
          markups.length ? null : (
            <div style={{ padding: 48, textAlign: "center", color: "var(--ink-muted)" }}>
               尚无测量记录。请先在图纸上绘制测量区域，再查看汇总。
            </div>
          )
        ) : (
          <>
          {/* print-visible grouping caption — the Group select lives in
              .report-toolbar (display:none in print), so the printed page
              must say what the sections are. Kept on screen too (cheap,
              consistent). Suppressed with the rest of the group chrome when
              the partition degenerates to one group. */}
          {grouped && (
            <p style={{ maxWidth: 980, margin: "0 auto 8px", fontSize: 11.5, color: "var(--ink-muted)" }}>
               分组依据：<strong>{groupCol ? columnLabel(groupCol) : groupBy === "label" ? "标签" : groupBy === "author" ? "作者" : "图纸"}</strong>
            </p>
          )}
          <table style={{ width: "100%", maxWidth: 980, margin: "0 auto", borderCollapse: "collapse", background: "var(--paper-bright)", border: "1px solid var(--ink-faint)" }}>
            <thead>
              <tr>
                {tableCols.map((c) => (
                  // custom, spec, and labor columns are text — header left-aligns with the cells
                  <th key={c.key} style={c.key === "finish" || c.custom || c.spec || c.labor ? { ...th, textAlign: "left" } : c.accent ? { ...th, color: "var(--cobalt)" } : th}>{zhHeader(c.header)}</th>
                ))}
              </tr>
            </thead>
            {/* ONE render path: the ungrouped view is a degenerate single group
                (no header/subtotal chrome). One tbody PER GROUP — in sheet mode
                the same condition repeats across groups, so r.id is only unique
                within a group's tbody. thead + grand-total tfoot stay exactly
                as ungrouped, so print pagination is untouched. */}
            {(grouped ? groups : [{ rows }]).map((gp) => {
              // key in a disjoint keyspace: a vocabulary value literally named
              // "∅" must not collide with the Unassigned group's sentinel
              const key = !grouped ? "rows" : gp.value === null ? "∅" : "v:" + gp.value;
              const sub = grouped && groups.length > 1 && gp.rows.length > 1 ? grandTotals(gp.rows) : null;
              // sheet groups carry a per-sheet perimByCond — the panel-wide
              // map would show whole-project perimeter next to per-slice
              // quantities
              const gctx = gp.perimByCond ? { perimByCond: gp.perimByCond, attrsByCond, specByCond, laborByCond } : ctx;
              return (
                <tbody key={key}>
                  {/* breakAfter is a print nicety only — unreliable on table
                      rows in Chromium, unimplemented in Gecko; occasional
                      header stranding at a page bottom is accepted in v1 */}
                  {grouped && (
                    <tr style={{ breakAfter: "avoid" }}>
                      <td colSpan={tableCols.length} style={{ ...td, textAlign: "left", fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 700, background: "var(--paper-cream)", borderTop: "1px solid var(--ink-soft)", borderBottom: "1px solid var(--ink-soft)", padding: "9px 10px", ...(gp.value === null ? { fontStyle: "italic" } : {}) }}>
                        {gp.label}
                      </td>
                    </tr>
                  )}
                  {gp.rows.map((r) => (
                    <tr key={r.id}>
                      {tableCols.map((c) => renderCell(c, r, gctx))}
                    </tr>
                  ))}
                  {/* single-row group: no subtotal — it would repeat the row verbatim */}
                  {sub && (
                    <tr>
                       <td style={{ ...td, textAlign: "left", borderTop: "1px solid var(--ink-soft)", color: "var(--ink-muted)", fontWeight: 600 }}>小计</td>
                      {/* lighter than the grand-total tfoot: thin border,
                          muted color; same foot mechanism on the group's
                          own grandTotals */}
                      {tableCols.slice(1).map((c) => (
                        <td key={c.key} style={{ ...td, borderTop: "1px solid var(--ink-soft)", color: "var(--ink-muted)" }}>
                          {c.foot && !c.ref ? num(c.foot(sub)) : ""}
                        </td>
                      ))}
                    </tr>
                  )}
                </tbody>
              );
            })}
            <tfoot>
              <tr>
                <td style={{ ...td, textAlign: "left", borderTop: "2px solid var(--ink)", borderBottom: "2px solid var(--ink)", background: "var(--paper-cream)", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "var(--f-mono)" }}>合计</td>
                {/* finish is always first & locked; every other visible column gets its
                    own td — footed columns render foot(g), ref columns never foot */}
                {tableCols.slice(1).map((c) => (
                  c.foot && !c.ref ? (
                    <td key={c.key} style={{ ...td, borderTop: "2px solid var(--ink)", borderBottom: "2px solid var(--ink)", background: "var(--paper-cream)", fontWeight: 700, ...(c.accent ? { color: "var(--cobalt)" } : {}) }}>{num(c.foot(g))}</td>
                  ) : (
                    <td key={c.key} style={{ ...td, borderTop: "2px solid var(--ink)", borderBottom: "2px solid var(--ink)", background: "var(--paper-cream)" }}></td>
                  )
                ))}
              </tr>
            </tfoot>
          </table>
          </>
        )}
        {rows.length > 0 && (
          <p style={{ maxWidth: 980, margin: "14px auto 0", fontSize: 11.5, color: "var(--ink-muted)", lineHeight: 1.6 }}>
            <strong>含损耗量（{AU}）</strong> = 测量量 ×（1 + 损耗率）。墙面面积按长度 × 高度计算；边带面积按长度 × 宽度计算。辅助材料覆盖率仍按原输入的 SF/LF 基准使用，请核对后采购。
            {tableCols.some((c) => c.key === "perimeter_ref") && (
               <> 周长（{LU}）汇总地面测量轮廓，包含门洞和共用墙；仅供参考，不计入合计或损耗。</>
            )}
            {/* bridge to the base-quantity By-sheet section below — the two
                slice the same shapes with different semantics */}
            {groupBy === "sheet" && grouped && (
               <> 上方分组已计入损耗和系数 ×N；下方按图纸显示基础实测量。</>
            )}
          </p>
        )}
        {rows.length > 0 && bySheet.length > 0 && (
          <div style={{ maxWidth: 980, margin: "26px auto 0" }}>
            <h3 style={{ fontFamily: "var(--f-display)", fontSize: 12, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ink)", margin: "0 0 10px", paddingBottom: 5, borderBottom: "1.25px solid var(--ink)" }}>按图纸</h3>
            {bySheet.map((gp) => (
              <div key={gp.sheet_id} style={{ margin: "0 0 14px" }}>
                <h3 style={{ fontFamily: "var(--f-mono)", fontSize: 11, letterSpacing: "0.06em", color: "var(--ink-muted)", margin: "0 0 6px" }}>{sheetLabel ? sheetLabel(gp.sheet_id) : gp.sheet_id}</h3>
                <table style={{ width: "100%", borderCollapse: "collapse", background: "var(--paper-bright)", border: "1px solid var(--ink-faint)" }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, textAlign: "left" }}>饰面</th>
                       <th style={th}>地面 {AU}</th>
                       <th style={th}>墙面 {AU}</th>
                       <th style={th}>边带 {AU}</th>
                      <th style={th}>{LU}</th>
                       <th style={th}>数量</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gp.rows.map((r) => (
                      <tr key={r.id}>
                        <td style={{ ...td, textAlign: "left" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                            <span style={{ width: 12, height: 12, background: r.color, display: "inline-block", border: "1px solid var(--ink-faint)" }} />
                            <strong style={{ fontFamily: "var(--f-mono)", fontWeight: 600 }}>{r.finish_tag}</strong>
                            {r.multiplier > 1 && <span style={{ color: "var(--ink-muted)", fontSize: 11 }}>×{r.multiplier}</span>}
                          </span>
                        </td>
                        <td style={td}>{sheetNum(areaVal(r.floor_sf, units))}</td>
                        <td style={td}>{sheetNum(areaVal(r.wall_sf, units))}</td>
                        <td style={td}>{sheetNum(areaVal(r.border_sf, units))}</td>
                        <td style={td}>{sheetNum(lenVal(r.lf, units))}</td>
                        <td style={td}>{sheetNum(r.ea, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            <p style={{ margin: "10px auto 0", fontSize: 11.5, color: "var(--ink-muted)", lineHeight: 1.6 }}>
              按图纸统计的基础测量量，不含损耗。
              {hasMultipliers(bySheet) && (
                // the shared note + a screen-only reconcile clause (CSV/PDF omit it)
                 <> 各图纸实测量乘以对应系数后，可与饰面汇总表核对。</>
              )}
            </p>
          </div>
        )}
        {markups.some((m) => m.type !== "svg" && m.type !== "image") && (
          <div style={{ maxWidth: 980, margin: "26px auto 0" }}>
            {/* svg symbols and image markups aren't revision notes — excluded */}
             <h3 style={{ fontFamily: "var(--f-display)", fontSize: 12, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ink)", margin: "0 0 10px", paddingBottom: 5, borderBottom: "1.25px solid var(--ink)" }}>修订与批注</h3>
            <table style={{ width: "100%", borderCollapse: "collapse", background: "var(--paper-bright)", border: "1px solid var(--ink-faint)" }}>
              <thead>
                <tr>
                   <th style={{ ...th, textAlign: "left" }}>类型</th>
                  <th style={{ ...th, textAlign: "left" }}>图纸</th>
                   <th style={{ ...th, textAlign: "left" }}>备注</th>
                </tr>
              </thead>
              <tbody>
                {markups.filter((m) => m.type !== "svg" && m.type !== "image").map((m) => (
                  <tr key={m.id}>
                    <td style={{ ...td, textAlign: "left" }}>
                      <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", border: "1px solid var(--ink-faint)", padding: "1px 6px", color: "var(--ink-soft)" }}>
                         {m.type === "cloud" ? "云线" : m.type === "callout" ? "引线" : "备注"}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: "left", fontFamily: "var(--f-mono)", fontSize: 11.5 }}>{sheetLabel ? sheetLabel(m.sheet_id) : m.sheet_id}</td>
                    <td style={{ ...td, textAlign: "left", whiteSpace: "normal", width: "60%" }}>{m.text || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ margin: "10px auto 0", fontSize: 11.5, color: "var(--ink-muted)", lineHeight: 1.6 }}>
               批注仅用于说明，不计入上述工程量。
            </p>
          </div>
        )}
        {matSummary.length > 0 && (
          <div style={{ maxWidth: 980, margin: "26px auto 0" }}>
            <h3 style={{ fontFamily: "var(--f-display)", fontSize: 12, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ink)", margin: "0 0 10px", paddingBottom: 5, borderBottom: "1.25px solid var(--ink)" }}>辅助材料 — 采购清单</h3>
            <table style={{ width: "100%", borderCollapse: "collapse", background: "var(--paper-bright)", border: "1px solid var(--ink-faint)" }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "left" }}>材料</th>
                  <th style={th}>数量</th>
                  <th style={{ ...th, textAlign: "left", paddingLeft: 16 }}>单位</th>
                </tr>
              </thead>
              <tbody>
                {matSummary.map((m, i) => (
                  <tr key={i}>
                    <td style={{ ...td, textAlign: "left" }}>{m.name}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{num(m.qty, 2)}</td>
                    <td style={{ ...td, textAlign: "left", paddingLeft: 16, color: "var(--ink-muted)" }}>{m.unit || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ maxWidth: 980, margin: "10px auto 0", fontSize: 11.5, color: "var(--ink-muted)", lineHeight: 1.7 }}>
               <strong>按饰面：</strong>{" "}
              {rows.filter((r) => r.materials?.length).map((r) => (
                // inline-block + a trailing space outside the span: each finish
                // moves to the next line as a unit when it fits, and wraps
                // internally instead of running off the page edge when it
                // doesn't (#27)
                <React.Fragment key={r.id}>
                  <span style={{ marginRight: 14, display: "inline-block" }}>
                    <strong style={{ fontFamily: "var(--f-mono)" }}>{r.finish_tag}</strong>{" "}
                    {r.materials.map((m) => `${m.name} ${num(m.qty, 2)}${m.unit ? " " + m.unit : ""}${m.note ? ` (${m.note})` : ""}`).join(" · ")}
                  </span>{" "}
                </React.Fragment>
              ))}
               <br />材料数量 = 实测量（面积、长度或件数）÷ 输入的覆盖率，并向上取整。
            </p>
          </div>
        )}
        {/* subtle parent credit — clear-label mode only (default mode is already
            OpenTakeoff-branded in the masthead, so a separate credit is redundant) */}
        {brand.credit && (
          <p style={{ maxWidth: 980, margin: "20px auto 0", textAlign: "center", fontFamily: "var(--f-mono)", fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-faint)" }}>{brand.credit}</p>
        )}
        </td></tr></tbody></table>
      </div>

      {showContribute && (
        <ContributeModal conditions={conditions} shapes={shapes} scaleInfo={scaleInfo} provenanceCounters={provenanceCounters} onClose={() => setShowContribute(false)} />
      )}
      {showInfo && (
        <ProjectInfoModal clientInfo={clientInfo} onClientInfo={onClientInfo}
          onSaved={() => setIdentityRev((r) => r + 1)} onClose={() => setShowInfo(false)} />
      )}
    </div>
  );
}

// Project info — two homes: company identity is per-device (identity.js /
// localStorage), client/job fields are per-project (onClientInfo → autosave).
// Company edits save on every change, so an overlay-click close loses nothing;
// onSaved bumps identityRev so the print masthead re-reads immediately.
function ProjectInfoModal({ clientInfo = {}, onClientInfo, onSaved, onClose }) {
  // trade-name profiles: the picker chooses which trade name is active for
  // EDITING; the active one still mirrors to the legacy company key (backward
  // compat). Which trade name BRANDS a project is the separate per-project
  // branding selection below (resolveBranding), not this active-id.
  const [profs, setProfs] = useState(loadProfiles);
  const active = activeProfile(profs) || {};
  const [logoErr, setLogoErr] = useState("");
  const [saveFailed, setSaveFailed] = useState(false);
  // pick sequence: normalizeLogoToPng is async, so a slow first pick must not
  // clobber a faster second pick — resurrect a logo removed meanwhile — or land
  // after the modal closes (a pick still normalizing would otherwise persist
  // from the dead fiber)
  const logoSeq = useRef(0);
  useEffect(() => () => { logoSeq.current++; }, []);   // unmount invalidates in-flight picks

  // one commit path: a producer runs against the CURRENT state (functional set,
  // so a slow logo normalize can't revert a name typed meanwhile), persists, and
  // bumps the masthead via onSaved. saveProfiles also mirrors the active profile
  // to the legacy company key (backward compat).
  const commit = (produce) => {
    setProfs((prev) => {
      const next = produce(prev);
      const ok = saveProfiles(next);
      setSaveFailed(!ok);
      if (ok && onSaved) onSaved();
      return next;
    });
  };
  // edit the active profile's fields — creates a first profile if none exists yet
  const editActive = (fields) => commit((prev) => (prev.profiles.length ? updateActiveProfile(prev, fields) : addProfile(prev, fields).state));
  const switchProfile = (id) => commit((prev) => setActiveProfile(prev, id));
  const addTradeName = () => commit((prev) => addProfile(prev, {}).state);
  const deleteActive = () => commit((prev) => removeProfile(prev, prev.activeId));

  // branding mode — per-project (meta KV, keyed on the project id). Toggling
  // clear-label on brands the deliverables as the trade name; off (default) is
  // OpenTakeoff. Persists immediately and bumps the masthead via onSaved.
  const projectId = projectIdFromUrl();
  const [brandSel, setBrandSel] = useState({ mode: "default", profileId: null });
  useEffect(() => {
    let alive = true;
    loadBrandingSelection(projectId).then((s) => { if (alive) setBrandSel(s); });
    return () => { alive = false; };
  }, [projectId]);
  // side effects stay OUT of the setState updater (React may double-invoke it):
  // update local state, then persist and only bump the masthead AFTER the write
  // commits — so the parent's meta-KV reload can't race ahead and read the old value
  const setBranding = (patch) => {
    const next = { ...brandSel, ...patch };
    // turning clear-label on with no explicit pick defaults to the first profile
    if (next.mode === "clearlabel" && !next.profileId) next.profileId = profs.profiles[0]?.id ?? null;
    setBrandSel(next);
    saveBrandingSelection(projectId, next).then((ok) => { if (ok && onSaved) onSaved(); });
  };
  // which chip highlights — the SAME fallback the resolver uses (activeProfile),
  // so a stale/deleted profileId highlights the profile the deliverable actually
  // brands as (profiles[0]) instead of highlighting nothing
  const brandProfileId = activeProfile({ profiles: profs.profiles, activeId: brandSel.profileId })?.id || null;

  const onLogoFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // re-picking the same file must still fire onChange
    if (!file) return;
    setLogoErr("");
    const seq = ++logoSeq.current;
    try {
      const logo = await normalizeLogoToPng(file);
      if (seq !== logoSeq.current) return;   // superseded by a later pick/remove/close
      editActive({ logo });
    } catch (err) {
      if (seq !== logoSeq.current) return;   // stale failure — don't flash its error
      setLogoErr(err.message || String(err));
    }
  };
  // bump the seq so an in-flight pick can't resurrect the removed logo; "" clears
  const removeLogo = () => { logoSeq.current++; editActive({ logo: "" }); };
  const client = (field) => (e) => onClientInfo && onClientInfo({ ...clientInfo, [field]: e.target.value });

  const section = { fontFamily: "var(--f-mono)", fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-muted)" };
  const row = { display: "block", margin: "8px 0" };
  const err = { margin: "6px 0 0", fontSize: 11.5, color: "var(--c-danger)" };

  return (
    <div onClick={onClose} className="report-modal" style={{ position: "absolute", inset: 0, zIndex: 60, background: "var(--scrim)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} className="panel" style={{ width: 520, maxWidth: "100%", maxHeight: "90%", overflow: "auto", background: "var(--paper-bright)", boxShadow: "var(--shadow-2)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--ink)" }}>
          <Icon name="document" size={16} />
          <strong style={{ fontFamily: "var(--f-display)", fontSize: 15 }}>项目信息</strong>
        </div>
        <div style={{ padding: 16, fontSize: 13, lineHeight: 1.6, color: "var(--ink)" }}>
          <div style={section}>公司名称（保存在本机）</div>
          {/* trade-name picker: choose which identity prints on the report + marked-set */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0" }}>
            <select name="trade-name" aria-label="当前公司名称" value={profs.activeId || ""} onChange={(e) => switchProfile(e.target.value)}
              className="field-input" style={{ flex: 1, minWidth: 0 }} disabled={!profs.profiles.length}>
              {profs.profiles.length === 0 && <option value="">尚无公司名称，请先添加</option>}
              {profs.profiles.map((p) => <option key={p.id} value={p.id}>{p.name || "未命名公司"}</option>)}
            </select>
            <button onClick={addTradeName} className="btn-ghost" title="添加另一个公司或品牌名称"
              style={{ padding: "5px 10px", whiteSpace: "nowrap" }}>+ 添加</button>
            {profs.profiles.length > 1 && (
              <button onClick={deleteActive} title="删除当前公司名称"
                style={{ padding: "5px 10px", border: "1px solid var(--ink-faint)", background: "transparent", color: "var(--c-danger)", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}>删除</button>
            )}
          </div>
          <label style={row}>
            <span className="field-label">名称</span>
            <input name="company-name" autoComplete="organization" value={active.name || ""} onChange={(e) => editActive({ name: e.target.value })}
              placeholder="公司或工作室名称" className="field-input" style={{ marginTop: 4 }} />
          </label>
          <label style={row}>
            <span className="field-label">地址</span>
            <textarea name="company-address" autoComplete="street-address" value={active.address || ""} onChange={(e) => editActive({ address: e.target.value })}
              rows={2} placeholder={"详细地址\n城市、省份"} className="field-input" style={{ marginTop: 4, resize: "vertical" }} />
          </label>
          <div style={row}>
            <span className="field-label">标识</span>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
              <input name="company-logo" type="file" accept="image/*" onChange={onLogoFile} style={{ fontSize: 12, minWidth: 0 }} />
              {active.logo && (
                <>
                  <img src={active.logo} alt="公司标识" style={{ width: 120, height: "auto", flex: "none", border: "1px solid var(--ink-faint)", background: "var(--well)" }} />
                  <button onClick={removeLogo}
                    style={{ border: "none", background: "transparent", color: "var(--cobalt)", cursor: "pointer", fontSize: 11.5, padding: 0, whiteSpace: "nowrap" }}>移除标识</button>
                </>
              )}
            </div>
            {logoErr && <p style={err}>{logoErr}</p>}
          </div>
          {saveFailed && <p style={err}>无法保存到当前设备</p>}

          {/* branding mode — per project. Off = OpenTakeoff (default); on brands
              the report + marked set as the selected trade name, keeping a subtle
              "Measured with OpenTakeoff" credit. Disabled until a trade name exists. */}
          <div style={{ ...section, borderTop: "1px solid var(--ink-faint)", marginTop: 14, paddingTop: 12 }}>报表署名</div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0", cursor: profs.profiles.length ? "pointer" : "not-allowed", opacity: profs.profiles.length ? 1 : 0.6 }}>
            <input type="checkbox" name="trade-name-brand" checked={brandSel.mode === "clearlabel"} disabled={!profs.profiles.length}
              onChange={(e) => setBranding({ mode: e.target.checked ? "clearlabel" : "default" })} />
            <span style={{ fontSize: 12.5 }}>
              以所选公司名称作为报表署名
              {!profs.profiles.length && <span style={{ color: "var(--ink-muted)" }}>（请先添加公司名称）</span>}
            </span>
          </label>
          {brandSel.mode === "clearlabel" && profs.profiles.length > 1 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "0 0 8px" }}>
              {profs.profiles.map((p) => {
                const on = brandProfileId === p.id;
                return (
                  <button key={p.id} onClick={() => setBranding({ profileId: p.id })} title="以此名称为项目报表署名"
                    style={{ padding: "4px 10px", fontSize: 12, cursor: "pointer",
                      border: `1px solid ${on ? "var(--cobalt)" : "var(--ink-faint)"}`,
                      background: on ? "var(--cobalt)" : "transparent", color: on ? "var(--paper-bright)" : "var(--ink)" }}>
                    {p.name || "未命名公司"}
                  </button>
                );
              })}
            </div>
          )}

          <div style={{ ...section, borderTop: "1px solid var(--ink-faint)", marginTop: 14, paddingTop: 12 }}>客户及项目资料（随项目保存）</div>
          <label style={row}>
            <span className="field-label">客户名称</span>
            <input name="client-name" autoComplete="off" value={clientInfo.client_name || ""} onChange={client("client_name")} className="field-input" style={{ marginTop: 4 }} />
          </label>
          <label style={row}>
            <span className="field-label">客户地址</span>
            <textarea name="client-address" autoComplete="off" value={clientInfo.client_address || ""} onChange={client("client_address")} rows={2}
              className="field-input" style={{ marginTop: 4, resize: "vertical" }} />
          </label>
          <div style={{ display: "flex", gap: 12 }}>
            <label style={{ ...row, flex: 1 }}>
              <span className="field-label">采购单／项目编号</span>
              <input name="client-reference" autoComplete="off" value={clientInfo.reference || ""} onChange={client("reference")} className="field-input" style={{ marginTop: 4 }} />
            </label>
            <label style={{ ...row, flex: 1 }}>
              <span className="field-label">日期</span>
              <input name="client-date" autoComplete="off" value={clientInfo.date || ""} onChange={client("date")} placeholder="例如：2026-09-28"
                className="field-input" style={{ marginTop: 4 }} />
            </label>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "12px 16px", borderTop: "1px solid var(--ink-faint)" }}>
          <button className="btn-primary" onClick={onClose}>完成</button>
        </div>
      </div>
    </div>
  );
}

function ContributeModal({ conditions, shapes, scaleInfo = [], provenanceCounters = null, onClose }) {
  const [attest, setAttest] = useState(false);
  const [contributor, setContributor] = useState("");
  const [state, setState] = useState("idle"); // idle | sending | done | error
  const [msg, setMsg] = useState("");
  const configured = isContributeConfigured();

  const send = async () => {
    if (!attest || !configured) return;
    setState("sending"); setMsg("");
    try {
      await sendContribution(buildContribution({ conditions, shapes, scaleInfo, counters: provenanceCounters }), contributor.trim());
      setState("done"); setMsg("提交成功。感谢你为开放地面材料模型提供数据。");
    } catch (e) {
      setState("error"); setMsg(e.message || String(e));
    }
  };

  return (
    <div onClick={onClose} className="report-modal" style={{ position: "absolute", inset: 0, zIndex: 60, background: "var(--scrim)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} className="panel" style={{ width: 520, maxWidth: "100%", maxHeight: "90%", overflow: "auto", background: "var(--paper-bright)", boxShadow: "var(--shadow-2)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--ink)" }}>
          <Icon name="oneClick" size={16} />
          <strong style={{ fontFamily: "var(--f-display)", fontSize: 15 }}>贡献衍生算量数据</strong>
        </div>
        <div style={{ padding: "16px", fontSize: 13, lineHeight: 1.6, color: "var(--ink)" }}>
          <p style={{ marginTop: 0 }}>此操作自愿向配置的开放地面材料模型服务发送<strong>衍生算量数据</strong>，包括：</p>
          <ul style={{ margin: "0 0 10px", paddingLeft: 18 }}>
            <li>饰面标签、图形类型与工程量（SF / LF / EA）</li>
            <li>归一化的空间轮廓（不含比例尺或地理位置）</li>
            <li>人工绘制或机器建议的来源，以及是否经过修正</li>
          </ul>
          <p style={{ margin: "0 0 10px", color: "var(--c-positive)", fontWeight: 600 }}>
            不发送 PDF 原件、文件名、项目及客户名称、批注或绝对坐标。请检查自行填写的饰面标签，避免其中包含敏感信息。
          </p>
          {!configured && (
            <p style={{ background: "var(--paper-shadow)", padding: "8px 10px", fontSize: 12.5, color: "var(--ink)" }}>
              当前版本未配置数据接收地址，无法发送。开发者可在构建时设置 <code>VITE_CONTRIBUTE_ENDPOINT</code>，或在浏览器中设置
              <code> localStorage.opentakeoff_contribute_endpoint</code>。
            </p>
          )}
          <label style={{ display: "block", margin: "6px 0" }}>
            <span className="field-label">署名（选填）</span>
            <input name="contributor" autoComplete="name" value={contributor} onChange={(e) => setContributor(e.target.value)} placeholder="姓名或公司名称"
              className="field-input" style={{ marginTop: 4 }} />
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: "12px 0", cursor: "pointer" }}>
            <input name="attest" type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} style={{ marginTop: 3 }} />
            <span>我有权分享这些算量数据，并同意将其提交给开放地面材料模型。</span>
          </label>
          {msg && <p style={{ fontSize: 12.5, color: state === "error" ? "var(--c-danger)" : "var(--c-positive)" }}>{msg}</p>}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", padding: "12px 16px", borderTop: "1px solid var(--ink-faint)" }}>
          <button className="btn-ghost" onClick={onClose}>{state === "done" ? "关闭" : "取消"}</button>
          <button className="btn-primary" onClick={send} disabled={!attest || !configured || state === "sending" || state === "done"}>
            {state === "sending" ? "正在发送…" : "确认贡献"}
          </button>
        </div>
      </div>
    </div>
  );
}
