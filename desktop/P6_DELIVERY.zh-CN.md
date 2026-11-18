# P6 交付检查 · Alpha 39

记录版本：`0.1.0-alpha.39`，Electron `45.2.2`。本页对照[开发计划第 10 节](DEVELOPMENT_PLAN.zh-CN.md#10-完整版验收与交付清单)，区分当前证据和仍待完成的交付条件。旧版实测单独标注。

| 检查项 | 已有证据 | 仍需完成 |
| --- | --- | --- |
| 功能覆盖与回归 | [已逐项核对](P6_COVERAGE_AUDIT.zh-CN.md) 25 项保留功能、7 项完整排除及 2 项部分排除；Alpha 39 macOS 全量 227/227；Windows 剪贴板修订包全量 227/227、系统剪贴板专项 1/1；Alpha 38 Chrome 受影响用例 12/12 | 后续代码变更按受影响范围复验 |
| Office 和 PDF | [Alpha 39 macOS 补验](BUILD.zh-CN.md#2026-11-14-alpha-39-office-与-pdf-补验)已检查代表产物；[Windows 补验](WINDOWS_X64_ACCEPTANCE.zh-CN.md#2026-11-18-实际软件补验)通过 Word 公式键盘编辑保存重开、WPS DOCX/XLSX 编辑保存重开、真实粘贴及 7 页 PDF 首尾页视觉核对 | Markdown 脚注目前输出为文末列表；Excel 默认粘贴对前导零和保护单引号的显示差异见验收记录 |
| 包体与离线 | Alpha 39 [macOS arm64 候选 ZIP](MACOS_ARM64_CANDIDATE.zh-CN.md)和源码包已归档；macOS ZIP 解压后严格验签通过；Windows 修订便携 ZIP 及逐文件校验完成 | 干净 Windows 目标机断网验收；macOS 跨机首次启动 |
| 恢复、备份与回退 | macOS 同版本恢复及 Alpha 17 回退通过；Windows Alpha 39 同版本恢复通过，Alpha 13 → Alpha 39 → Alpha 13 的共有草稿/会话/设置/源文件补验通过 | Windows 跨版本批注未验证 |
| 性能与资源回收 | macOS 已有[启动与取消基线](#alpha-31-性能基线)、[长文及循环资源回收](#长文渐进渲染与循环资源回收)和 [10,000 文件工作区采样](#10000-文件工作区) | Windows 候选包另测 |
| 本地试用与系统集成 | Alpha 37 macOS [仓库样本试跑](P6_CANDIDATE_TRIAL.zh-CN.md)打开 10/10、导出 8/8；Alpha 39 [复测公开文档](P6_PUBLIC_DOCUMENT_TRIAL.zh-CN.md#alpha-39-复测)通过；Windows 原生对话框、拼音候选确认/取消及 200% 缩放下代表操作通过；用户手动确认「打开方式 → 仅一次」、重复打开和原默认应用保留通过 | 其他显示器/DPI 组合 |

2026-11-17 至 18 按用户要求恢复 Windows x64 打包和本机验收，当前证据和修订包见 [Windows 本机验收记录](WINDOWS_X64_ACCEPTANCE.zh-CN.md)。完整目标机交付条件继续按上表记录。

## 包体记录

使用 `du -sk` 测量 Alpha 39 未压缩的 macOS arm64 `.app` 实际占盘空间，单位换算为 MiB；不等同于 ZIP 大小。总计 **280.2 MiB**，其中 `Contents/Frameworks` 约 **251.6 MiB**。应用归档 `app.asar` 为 **29,625,095 字节**，较 Alpha 38 增加约 1.2 MiB，主要来自内置 SVG 图标数据。

## 独立配置的备份与回退

1. 使用 `--user-data-dir=<测试目录>` 启动当前打包版本。打开测试 Markdown，新增批注和未命名草稿，修改一项设置，退出应用。
2. 复制完整测试配置到独立的备份目录，并另外备份 Markdown 源文件。配置保留草稿和应用数据，但不会替你备份源文件目录。正式配置默认在 Windows 的 `%APPDATA%\documd-desktop` 或 macOS 的 `~/Library/Application Support/documd-desktop`；演练只使用测试配置。
3. 将备份复制到新的恢复目录，使用同一版本和新目录启动，核对会话、设置、批注、草稿及磁盘源文件。保持源文件原位置，避免把文件迁移和配置恢复混为一个场景。
4. 保留旧程序包和备份，使用测试配置的副本演练升级；再用升级前的备份副本配合旧包启动并核对数据。记录新旧版本、各次核对结果和异常信息。

回退前先另存需要保留的新版编辑内容，再退出新版。旧版使用升级前的配置备份；恢复到该时间点不会带上之后的设置、批注或草稿。Markdown 源文件备份是独立副本，恢复应用配置不会自动覆盖磁盘源文件。

### Alpha 37 实测结果

2026-11-13，macOS arm64 打包应用通过 **2/2**：Alpha 37 同版本恢复，以及 Alpha 17 → Alpha 37 → Alpha 17。回退从升级前的独立备份复制配置，未验证旧版直接读取新版写过的配置。测试使用合成文档与隔离配置。

两种场景均核对活动标签、已命名与未命名草稿、外观、批注和源文件。恢复后修改测试副本，原配置、升级前备份及原始文档的校验值保持一致。Alpha 17 复用此前从历史源码包重建的 arm64 应用。日志：`test-results/desktop/alpha37-profile-backup.log`。

### Alpha 31 历史实测结果

macOS arm64 上用两个打包应用通过 **2/2**：Alpha 31 → Alpha 31；以及 Alpha 17 → Alpha 31 → Alpha 17。Alpha 17 由已有的 `documd-alpha17-source.tar.gz` 在临时目录重新构建，复用本机依赖和校验过的 Electron 45.2.2 缓存。两个场景均使用合成文档和独立配置。

恢复后核对了活动标签、三个标签的身份、已命名草稿、未命名草稿、深色外观、批注文本及锚点。修改恢复副本后，原配置和备份的应用状态文件、草稿记录及批注记录 SHA-256 未变；含 BOM 和 CRLF 的 Markdown 源文件与单独的源文件备份逐字节一致。跨版本回退从升级前备份重新复制配置；未验证旧版直接读取已升级的配置。

可复跑 [备份回归](test/profile-backup-e2e.test.js)。指定 `MV_DESKTOP_EXECUTABLE` 使用当前包；同时指定 `MV_DESKTOP_PREVIOUS_EXECUTABLE` 才运行跨版本场景：

```bash
MV_DESKTOP_EXECUTABLE="/path/to/current/documd-desktop" \
MV_DESKTOP_PREVIOUS_EXECUTABLE="/path/to/previous/documd-desktop" \
node --test desktop/test/profile-backup-e2e.test.js
```

本轮日志：`test-results/desktop/alpha31-profile-backup.log`。

## Alpha 31 性能基线

macOS arm64 打包应用，Apple M3 Pro（12 核）、36 GiB 内存，主屏逻辑尺寸 1800 × 1169、2× 缩放。固定 Markdown 样本为 **658,879 字节（约 643 KiB）、3,604 行**，包含标题和正文，无图表与外部资源。每轮用新应用配置启动并打开样本，关闭文档、退出后用同一配置再启动、打开同一文件。共 5 轮。新配置指应用数据冷启动；未清空系统文件缓存。

| 指标 | 样本数 | 中位数 | 最慢值 |
| --- | ---: | ---: | ---: |
| 新配置启动至可操作 | 5 | 635 ms | 1,149 ms |
| 复用配置启动至可操作 | 5 | 608 ms | 646 ms |
| Markdown 首屏，新配置 | 5 | 77.7 ms | 83.4 ms |
| Markdown 首屏，复用配置 | 5 | 72.3 ms | 81.3 ms |
| Markdown 预览完成，新配置 | 5 | 350.1 ms | 368.4 ms |
| Markdown 预览完成，复用配置 | 5 | 343.3 ms | 356.6 ms |
| 点击取消至界面显示任务已取消 | 5 | 9.4 ms | 13.2 ms |
| 点击取消至导出窗口销毁 | 5 | 2.4 ms | 3.1 ms |
| 点击取消至确认导出渲染进程退出 | 5 | 23.3 ms | 26.4 ms |

启动计入测试驱动启动和连接耗时。文件选择器直接返回固定路径；首屏从「打开文件」点击起算，在首段进入视口并经过一个绘制帧后取样，不计人工选文件耗时。取消用例在真实 DOCX 导出窗口开始工作后暂停导出，以固定可取消时点；实际取消路径未替换。五轮均销毁导出窗口、确认渲染进程退出且无成品。进程退出为轮询观察值，含轮询及跨进程观察开销。

本机样本最慢值均低于开发计划的参考目标（启动 5 秒、普通 Markdown 首屏 2 秒、界面取消 500 ms）。这组结果只覆盖此 macOS 环境和样本；Windows x64 本轮不测，也未覆盖反复开关和导出时的长期资源趋势。

可复跑 [性能采样脚本](test/performance-baseline.js)，输出逐轮 JSON：

```bash
MV_DESKTOP_EXECUTABLE="/path/to/packaged/documd-desktop" \
node desktop/test/performance-baseline.js
```

本机原始数据：`test-results/desktop/alpha31-performance-baseline.json`。

## 长文渐进渲染与循环资源回收

长文夹具固定为 **10,000 行、272,158 字节、50 个图表**（25 个 Mermaid、25 个 DOT），不依赖外部资源。每轮在独立应用配置中打开参考文档，再打开长文。首屏从文件菜单点击起算，记录首段进入视口时的图表数；使用滚轮验证正文能滚动，并用实际坐标点击标签，避免测试工具自动等待按钮解锁。

Alpha 31 的 5 轮都在图表完成前显示并滚动了首屏，但渲染结束后滚动位置归零。图表渲染期间参考标签被禁用，从尝试切换到按钮解锁等了 **500.4–604.4 ms**，原点击不会触发切换。Alpha 32 修复了这两处：正在打开普通 Markdown 时，可以切换到已打开标签并中止前一个预览；用户已主动滚动时，预览完成不再用保存的阅读位置覆盖当前视口。

Alpha 32 的分段复测每个场景各 5 次：

| 指标 | 中位数 | 最慢值 |
| --- | ---: | ---: |
| 打开长文至首屏 | 32.0 ms | 33.8 ms |
| 打开长文至 50 个图表全部完成 | 765.7 ms | 778.6 ms |
| 实际点击标签至目标首屏 | 71.8 ms | 81.0 ms |
| 实际点击标签至目标预览完全就绪 | 79.8 ms | 88.4 ms |

首屏出现时均没有图表完成，滚轮在首批图表生成前后都可用，5 次完整渲染均保住了滚动位置。另一组初测从自动化发起点击（早于实际点击事件）到目标完全就绪曾记录到 **706.2 ms**，上述分段复测未重现；现有数据不足以确定该慢样本的阶段或原因。专项另用挂起的图表确认键盘切换和取消后重新打开均正常。

资源循环在单独配置下保持一个含表格和 Mermaid 的参考文档。先依次打开并关闭 50 个不同 Markdown，再导出 DOCX、PDF、HTML、PNG 各 5 次，核验文件签名。每 10 次开关和每 5 次导出后，在空闲期记录窗口、WebContents、应用进程、工作集、堆和文件轮询；最后通过设置页清理缓存，再取样。工作集按 Electron 各进程相加，共享内存可能重复计入。

Alpha 32 的 11 个空闲检查点均为 5 个进程、2 个窗口、2 个 WebContents（前台和复用的图表渲染窗口），没有遗留导出窗口。文件轮询只观察到仍打开的参考文档。合计工作集从 **937.0 MiB** 升到峰值 **1,080.3 MiB**，20 次导出结束时为 **972.6 MiB**，清缓存后为 **980.8 MiB**；阅读窗口 JS 堆从 **16.4 MiB** 到清理后的 **16.7 MiB**。本轮出现了回落，无法用一次循环排除长期内存增长。

可复跑 [长文与资源采样脚本](test/resource-endurance.js)，输出逐轮 JSON：

```bash
MV_DESKTOP_EXECUTABLE="/path/to/packaged/documd-desktop" \
node desktop/test/resource-endurance.js
```

只跑长文采样可加 `MV_DESKTOP_ENDURANCE_LONG_ONLY=1`。原始数据：`test-results/desktop/alpha31-resource-endurance.json`、`test-results/desktop/alpha32-resource-endurance.json` 和 `test-results/desktop/alpha32-long-followup.json`。

## 10,000 文件工作区

固定样本为 100 个目录、每个目录 100 个 Markdown，共 10,000 个文件。每个目录一个文件名命中、一个正文命中，两种查询各预期 100 条；另测把相同文件放在单一目录。Alpha 32 每次扫到 2,000 个文件即停止，只返回 20 条；检索过程中没有数量进度，单目录样本也无法在树中列出。

Alpha 33 提高单次搜索上限到 10,000 个 Markdown、20,000 个目录条目，同时保留正文读取总量 64 MiB、单文件 10 MiB、最多 200 条结果和 32 层深度。搜索显示已扫描文件数和结果数，取消后旧任务的进度和结果不会覆盖新查询。目录树每次只渲染一页 500 个条目，通过前后翻页访问更多；单目录支持至 20,000 项。

采样由真实界面触发，文件选择器返回固定路径，不计人工选择耗时。取消时确认后台已进入目录读取，分别记录界面状态和最后一个扫描目录句柄的释放。目录句柄释放是本样本的后台停止观测点；遇到系统仍未返回的文件读取，取消会阻止后续处理，并在系统返回后关闭句柄。另有挂起文件读取的端到端测试，覆盖取消、立即新搜索和旧句柄释放。

macOS arm64（Apple M3 Pro、36 GiB）打包应用的 5 轮采样中，文件名和正文查询每轮均扫描全部 10,000 个文件，并各返回预期的 100 条命中。正文每轮收到约 20 次进度更新。时长均从实际界面点击起算。

| 指标 | 中位数 | 最慢值 |
| --- | ---: | ---: |
| 注册工作区并显示 100 个子目录 | 16.1 ms | 17.5 ms |
| 展开一个含 100 个文件的子目录 | 7.5 ms | 11.6 ms |
| 完成文件名搜索 | 104.8 ms | 143.4 ms |
| 完成正文搜索 | 2,008.8 ms | 2,018.9 ms |
| 点击取消至界面显示已取消 | 9.2 ms | 10.5 ms |
| 点击取消至后台目录句柄释放 | 0.39 ms | 0.41 ms |

单目录的首批 500 项在 22.7 ms 后可用。19 次向后翻页的中位数为 14.7 ms，最慢 19.1 ms，每页最多 500 项；共验证了 10,000 个不同条目、往返翻页和最后一个文件可打开。测试目录为本机小文件，未代表慢磁盘或含大文件的工作区。

可复跑 [工作区采样脚本](test/workspace-search-baseline.js)：

```bash
MV_DESKTOP_EXECUTABLE="/path/to/packaged/documd-desktop" \
node desktop/test/workspace-search-baseline.js
```

本机原始数据：`test-results/desktop/alpha32-workspace-search.json` 和 `test-results/desktop/alpha33-workspace-search.json`。

## Alpha 39 交接材料

- [macOS arm64 候选包说明](MACOS_ARM64_CANDIDATE.zh-CN.md)包含 ZIP、校验、临时配置启动与签名范围。
- [覆盖核对](P6_COVERAGE_AUDIT.zh-CN.md)逐项列出桌面入口、证据和剩余缺口，区分 7 项完整排除及 2 项部分排除。
- [候选包试跑报告](P6_CANDIDATE_TRIAL.zh-CN.md)和[真实文档试用表](P6_DOCUMENT_TRIAL.zh-CN.md)均随源码包交接。
- [公开文档试用报告](P6_PUBLIC_DOCUMENT_TRIAL.zh-CN.md)包含来源、实测结果及兼容问题。
- 在仓库运行 `node desktop/scripts/package-source.js`，在 `dist/desktop/handoff` 生成 `documd-0.1.0-alpha.39-source.tar.gz`、`.sha256` 和 `documd-0.1.0-alpha.39-source.json`。
- [Windows x64 手册](WINDOWS_X64_REGRESSION.zh-CN.md)包含源包校验、EXE 打包、便携 ZIP、离线回归、临时配置、文件关联和回退步骤。当前 Windows 修订便携包、校验值和本机结果见 [Windows 本机验收记录](WINDOWS_X64_ACCEPTANCE.zh-CN.md)。

仓库与公开文档已试跑。Alpha 38 复测了队列、SVG 转换、本地幻灯片背景和 XLSX 菜单；Alpha 39 验证了免费图标包。远程图片与未随包提供的图标仍不可用。个人文档无需提供；目标机和实际使用环境的人工验证另记。
