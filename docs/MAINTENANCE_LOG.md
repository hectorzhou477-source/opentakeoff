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

## 2026-09-29：独立批量比例尺核对页面

- 目的：将当前已支持格式的比例尺核对集中到完整页面，减少逐张打开和确认操作；本次不增加 DWG 解析。
- 页面：新增 `/scale-review`，工作台、图纸目录和算量工具栏均提供入口。多页 PDF 按页列出，已导入图片与 ZIP 内图纸沿用原有导入结果；支持搜索、状态筛选、多选、一键识别、取消、批量采用建议、统一比例修改及当前值确认。
- 人工核对：原图缩放和两点毫米校准；尺寸推算证据用绿色标注。批量识别只产生建议，冲突或单个 OCR 比例文字不能批量采用；扫描图不能仅凭纸面比例修改。人工确认在最终“确认并保存”时写入。
- 工程量保护：复用 `recalibrateShapes`；保留小数计数、机器原始几何、扣减恢复快照和其他文档字段。全部校验与重算完成后一次写入；保存前创建版本快照，并核对项目内容和源 PDF 摘要，拒绝覆盖已变化的数据。项目同步的保护仍由现有存储适配器负责，不宣称跨客户端的分布式事务。
- 路由：沿用现有 Google、文件夹和 Microsoft 365 的工作空间初始化；跨页面等待画布保存队列，避免未完成自动保存覆盖新修改。云端账号与真实多人同步未在本次本地验收中实测。
- 主要文件：`web/src/pages/ScaleReview.jsx`、`web/src/styles/scaleReview.css`、`web/src/lib/batchScale.js`、`scaleScanner.js`、`annotationWrites.js`、`mmScale.ts`、`sheets.ts`，以及页面入口与使用文档。
- 授权与依赖：无新增运行依赖，沿用已有 Apache-2.0 工程与 OCR 依赖；保留 LICENSE、NOTICE 和第三方声明。识别依据仅为会话内数据，没有修改持久化协议。
- 自动化验收：`web/test/batchScale.test.ts` 覆盖批量重算、无效批次、确认语义、毫米校准、取消和失败隔离、保存顺序；`scripts/verify-batch-scale.mjs` 使用独立浏览器和合成图纸，不接触用户项目。覆盖多页 PDF、批量保存、工程量重算、小数计数、快照、并发修改拒绝、PNG OCR 保护与两点校准；浏览器未出现页面运行异常。
- 复现：启动 `npm run dev --prefix web`；执行 `node scripts/verify-batch-scale.mjs`。需可用的 Playwright；可通过 `PLAYWRIGHT_MODULE` 指定其入口，通过 `BROWSER_CHANNEL` 选择已安装浏览器（默认 msedge）。截图输出到忽略目录 `.playwright-mcp/batch-scale/`。
- 当前边界：识别建议和未保存修改仅在当前页面会话保留；混合比例的详图需要人工处理；拼接图独立比例尺仍在原画布核对。现有体积较大的前端打包警告保持可见。
- 最终检查：`npm run check --prefix web` 通过（Web 测试 1882 项：1879 通过、3 跳过、0 失败；TypeScript、ESLint、性能基准和生产构建通过）。MCP 工具清单、Wiki、协议 61 项和文档链接检查通过。完整浏览器验收重跑通过，包括画布返回核对页面的数据交接；证据截图为 `.playwright-mcp/batch-scale/scale-review.png` 与 `scan-calibration.png`。首次扫描验收超时后独立重跑通过，未将该次超时记为成功。

### 2026-09-29 补充：按识别建议与依据筛选

- 比例尺核对页新增“识别结果”筛选，包含证据冲突、未找到可靠比例尺、需两点校准、多处尺寸证据、比例文字证据、尚未识别、失败、正在识别和已取消，并显示各类别总数。
- 可与文件名及核对状态组合筛选；“全选筛选结果”只作用于当前显示图纸。已有选择在筛选后保留，同时明确提示筛选外的选中数量，避免批量操作范围不清。
- 识别状态优先于历史建议，重新识别或取消时不会误用上一次结果分类；本次不改变识别算法、保存格式和工程量计算。
- 验证：ESLint、TypeScript、生产构建通过；隔离 Edge 验收覆盖冲突、无可靠比例尺、比例文字三个结果类别，与文件名／核对状态组合筛选、筛选后全选和筛选外选中提示，无页面运行异常。MCP 清单、Wiki、协议 61 项和文档链接检查通过。截图：`.playwright-mcp/scale-evidence-filter.png`。

## 2026-09-30：批量比例尺功能发布

- 发布基线：GitHub `main` 的 `2f28bf0de24b8ed40a997c231a886b73d4b31461`；将本地 `5cabd05`、`dac87eb` 两项改动迁入发布分支，代码树与此前验收版本一致。
- 包含：独立比例尺核对页、批量识别与保存、原图校准及证据标注、识别依据组合筛选、工程量重算和修改前快照。
- 发布前全量 Web 检查通过，1879 项测试通过、3 项跳过、0 失败；类型、代码质量、性能基准、生产构建通过。浏览器及协议／文档验收见上文记录。
- 可审阅的合成图纸截图：[批量核对页面](evidence/batch-scale-review.png)、[证据冲突筛选](evidence/scale-evidence-filter.png)。不包含用户真实项目数据。最终 PR 和合并提交以 GitHub 历史为准。

- 发布复核修复：文档链接检查器兼容 Windows CRLF 换行，避免标题锚点误报；保持原有链接校验规则。
