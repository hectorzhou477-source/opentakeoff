# Quantifin 维护日志

本项目基于 [OpenTakeoff](https://github.com/Kentucky-ai/opentakeoff) 开发。上游引入提交为 `d0f552e49b3747126c67a9ee4841831cef8ca591`，引入日期为 2026-09-28。原始 `LICENSE`、`NOTICE`、`THIRD-PARTY-NOTICES.md` 保留在仓库根目录；代码修改遵守 Apache-2.0 及各第三方依赖的适用声明。本日志记录自有改动，不代表对后续上游版本或所有传递依赖完成授权审计。

## 2026-09-28：中文工作台与算量编辑器

- 基线：上游 `d0f552e49b3747126c67a9ee4841831cef8ca591`；本地基线提交 `f015b58`（源码压缩包导入，无上游 Git 历史）。
- 修改目的：让国内造价人员在 Quantifin 页面完成图纸导入、测量、复核、报表和导出；保留原有几何、算量和存储逻辑。
- 主要文件：`web/src/main.jsx`、`web/src/pages/QuantifinHome.jsx`、`web/src/pages/TakeoffCanvas.jsx`、`web/src/components/WorkspaceChrome.jsx`、`web/src/components/PlanNavigator.jsx`、`web/src/components/TakeoffsPanel.jsx`、`web/src/components/WorkspacePanel.jsx`、`web/src/components/ReportPanel.jsx`、`web/src/lib/canvasConstants.js`、`web/src/lib/quantifinBranding.js`，以及 `web/src/styles/quantifin*.css`。
- 行为：新增中文工作台和统一算量工作区；主导航、图纸空状态与管理确认、比例尺和绘图菜单、报表字段及模板、打印导出和项目信息采用中文说明。新用户默认公制，已保存的单位偏好继续生效；测量和审核状态的存储字段保持原格式。Quantifin 报表署名通过适配层生成，原 OpenTakeoff 品牌解析器保持不变，并在报表中保留来源署名。
- 平台兼容：`scripts/check-doc-links.mjs` 使用 `fileURLToPath` 解析 Windows 路径；`web/bench/run.mts` 将动态导入的 Windows 路径转为文件 URL。两处均未改变检测规则或基准指标。
- 授权与依赖：未新增运行依赖；原许可证、NOTICE 和第三方声明仍随源码保留；修改过的上游源码文件带有 Quantifin 修改说明。没有新增外部模型或图纸素材。
- 验证：TypeScript、ESLint、生产构建通过；完整 Web 测试 1869 项中 1866 通过、3 跳过、0 失败；One-Click 性能基准通过；文档链接检查通过。独立浏览器配置下验证中文空工作区、示例入口和报表打开，无页面运行异常。
- 已知范围：个别高级工具及原有导出文件的机器可读字段仍使用英文；PDF 标注图纸封面仍使用 ASCII 标题，因为当前 PDF 字体仅支持 WinAnsi。组织协作、招标文件解析和自动置信度评估尚未实现，不能按已交付功能宣传。

提交和远端发布记录以仓库 Git 历史及项目维护台账为准。后续升级上游时，应记录新旧 SHA，重新核对 `LICENSE`、`NOTICE`、第三方依赖及自有改动。

## 2026-09-29：毫米标注自动比例尺

- 目的：减少图纸导入后的手工比例尺设置；自动推断仍保留人工复核关口。
- 代码：`web/src/lib/mmScale.ts`、`rasterScale.ts`、`ocrScale.js`、`sheets.ts`、`ingest.js`、`web/src/pages/TakeoffCanvas.jsx`、`QuantifinHome.jsx`、`web/src/components/PlanNavigator.jsx`、`web/scripts/prepare-ocr-assets.mjs` 和 `web/vite.config.js`。
- 行为：两处一致的毫米尺寸标注才由尺寸线自动计算；冲突或仅 OCR 比例字样不自动应用。自动值标为未确认，人工以 mm 核对／校准。DWG 当前明确提示先转 PDF。存储沿用原 feet/px 与 scale_confirmed 语义，新增 scale_source 的 dimension/ocr 值以追溯来源。
- 依赖：新增 tesseract.js 7.0.0（Apache-2.0）及 @tesseract.js-data/eng 1.0.0（MIT 包、Apache-2.0 数据）；传递依赖 tesseract.js-core 7.0.0（Apache-2.0）。OCR 运行文件在构建时复制到 web/dist/ocr，随附 Tesseract 许可文件与 NOTICE；完整归属见仓库 THIRD-PARTY-NOTICES.md。
- 验证：Web 全量测试 1871 通过、3 跳过；类型、ESLint、性能基准、生产构建通过。相关 16 项测试及真实 PDF 端到端用例通过；MCP 工具数、Wiki、协议 61 项和文档链接检查通过。隔离无头浏览器验证中文首页与算量工作区渲染。
