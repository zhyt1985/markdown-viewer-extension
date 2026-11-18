# Alpha 39 Windows x64 本机验收记录

验收日期为 2026-11-17 至 2026-11-18。本轮在 Windows 11 家庭版中文版 25H2、构建 `26200.9974` 上测试，程序窗口 DPI 为 192（200% 缩放）。基础提交为 `cf31ea5`，本机剪贴板修订版仍使用 `0.1.0-alpha.39` 版本号。

## 构建及自动回归

使用仓库打包脚本和官方 Electron `45.2.2` Windows x64 缓存。缓存 ZIP 的 SHA-256 与锁定依赖中的校验值一致。便携 ZIP 独立解压后，73 个文件的 SHA-256 与打包目录全部一致。

剪贴板修订包在真实 Windows 用户会话通过全量打包回归 **227/227**。随后加入预览取消状态校验的修订包通过 **228/228**，失败、取消、跳过均为 0，详见 [性能与取消修订包复验](WINDOWS_X64_PERFORMANCE_ROLLBACK.zh-CN.md#取消修订包复验)。共享项目源码类型检查为 0 错误，第三方源码包仍报告 297 个已分类类型错误。

系统剪贴板专项另行通过 **1/1**。专项从实际菜单操作读取和写入 Windows 剪贴板，覆盖表格 HTML/TSV、原尺寸 PNG 和 HTML 转 Markdown 草稿。可在空闲桌面显式执行，运行前自行保留需要的剪贴板内容。

```powershell
$env:MV_DESKTOP_EXECUTABLE = '完整路径\documd-desktop.exe'
node --test desktop/test/native-clipboard-e2e.js
Remove-Item Env:MV_DESKTOP_EXECUTABLE
```

该专项会使用系统剪贴板，默认全量测试命令不包含它。本轮执行时保存了原剪贴板对象，并在专项结束后调用 Windows 接口恢复。

## 真机操作结果

| 项目 | 本轮结果 |
| --- | --- |
| 原生打开与中文路径 | 系统文件选择器一次打开两份中文文件，含空格路径正常，中文、公式及 Mermaid 时序图可见。 |
| 资源管理器打开方式 | 2026-11-18 用户按手动步骤确认全部通过。选择便携 EXE 并「仅一次」打开测试 Markdown，文件标签和正文正确；再次打开激活已有窗口且标签不重复，普通双击仍使用原默认应用。 |
| 编辑和恢复 | 输入中文草稿，通过原生退出提示选择保留草稿，再从便携 ZIP 解压后的程序启动，编辑内容和文件标签恢复。原始 Markdown 未被草稿覆盖。 |
| 中文输入法 | 通过键盘按键输入拼音 `zhongwen`，观察到「中文」候选词，空格确认后源码和实时预览均出现「中文」。再次输入 `ceshi` 后按 Escape，未提交的拼音消失，已确认文字及后续段落完整。Ctrl+S 保存后逐行核对文件内容通过。 |
| 高 DPI | 200% 缩放下验证原生对话框、编辑、候选词、退出提示及重启恢复，未遍历所有窗口与显示器组合。 |
| PDF | A4 纵向、12 mm 边距生成 7 页预览，可翻页，通过系统对话框保存。读回页数与预览一致，末页含第 120 行及结束标记。A5 横向、22 mm 边距和预览/保存一致性另由打包回归覆盖。2026-11-18 在 WPS PDF 查看第 1、7 页，公式、时序图、末行和结束标记均可见，无明显裁切。 |
| Office 文件 | Microsoft Office `16.0.20527.20196` 读取导出文件，Word 识别 2 个公式、2 张表和 2 个内联对象，Excel 识别 6 处合并。2026-11-18 完成 Word 公式键盘编辑、另存及重开，WPS DOCX/XLSX 编辑保存重开通过，详见下节。 |
| Office 剪贴板 | Excel 实际粘贴生成 4 行，表头和数值 `42` 正常，公式样文本未执行。默认粘贴把 `007` 显示为 `7`，受保护的公式样文本显示为 `'=1+1`。Word 实际粘贴生成 1 个内联图片对象，尺寸为 36 × 36 pt。 |
| 配置备份与回退 | Alpha 39 同版本恢复及原候选包 → 修订包 → 原候选包完整数据演练 2/2 通过，含批注精确锚点。Alpha 13 跨版本补验覆盖共有的草稿、会话、设置及源文件。不同版本间批注仍未验证，详见 [性能与回退记录](WINDOWS_X64_PERFORMANCE_ROLLBACK.zh-CN.md)。 |

初版 Alpha 39 在实际系统剪贴板上暴露了三处故障。Electron 45 要求 `ClipboardItem[]` 和异步读写，旧的表格写入对象被拒绝，图片 `writeImage` 和 HTML `readHTML` 方法已不存在。修订后以同一 ClipboardItem 写入表格 HTML/纯文本，图片写入 PNG，HTML 导入读取 MIME 数据。复制入口等待写入完成后报告结果。

额外的 Alpha 13 完整回退用例在旧版等待新版批注控件时超时，尚未进入升级。共有数据的补验通过，完整跨版本批注验收继续保留。

## 2026-11-18 实际软件补验

剪贴板修复和前述验收记录已提交为 `60663bd`。本轮使用既有导出文件的独立副本，不重新生成应用包。

- Word 16.0.20527.20196 先通过本地文档接口将第一条原生公式由 `E=mc²` 改成 `E=mc³`，保存重开后仍识别为公式。随后在真实 Word 页面通过键盘把指数改成 `4`，另存为 `Word-ui-equation.docx`，关闭并使用 Word 只读重开，确认第一条原生公式为 `E=mc⁴`，2 个公式及 2 张表均保留。初次在同一文件上重复打开影响了保存核对，最后以独立另存副本完成验证。
- WPS Office 12.1.0.29690 通过其本地文档接口打开 DOCX 副本，追加测试文字、保存关闭并重开，文字修改保留，公式和表格各 2 个。随后在 WPS 页面查看正文、公式、表格、图片及流程图，新增文字可见。
- WPS 表格通过其本地接口把 XLSX 副本的 `C4` 改为 `84`，在 `E1` 加入测试文字，保存关闭并重开。合并范围 `A2:C2`、文本 `007` 和保持为文本的 `=1+1` 均正确，新增文字和 `84` 可见。通过实际 WPS 页面再次核对了上述内容。本轮 WPS 的编辑保存使用文档接口完成。
- WPS PDF 查看 7 页 A4 测试文档的第 1 页及第 7 页。首屏中文、行内/独立公式和时序图可见，末页表格包含第 119、120 行，文末 `Windows-END` 完整显示，代表页面未见明显裁切。本轮视觉抽查覆盖首尾页。

补验证据和测试副本位于 `test-results/desktop/windows-software-20261118/`，包括 `word-equation.json`、`word-ui-reopen.json`、`wps-writer.json`、`wps-spreadsheet.json`、`Word-ui-equation.docx`、`WPS-document-edit.docx`、`WPS-table-edit.xlsx` 和 `Windows-PDF-review.pdf`。应用源码在本轮补验中未修改。

## 剩余验收条件

- 当前机器装有开发依赖，系统保持联网。未发现 Windows Sandbox 或可用的干净 Windows 虚拟机，干净目标机断网验收仍需另行安排。
- Windows 不同版本间批注仍未验证。[性能与完整数据回退采样](WINDOWS_X64_PERFORMANCE_ROLLBACK.zh-CN.md)已完成。修复预览取消时序后十轮长文切换为 112–209 ms；目录翻页仍有秒级波动，主进程停顿原因待定位。

## 产物与证据

修订便携包位于 `dist/desktop/packages/win-alpha39-clipboard/documd-0.1.0-alpha.39-win32-x64-clipboard-fix-portable.zip`，大小 169,930,125 字节，SHA-256 为 `6eefe6a1064d518668bfbe2d661238dc53a91d0e948956f5fc10df2293903612`。该包基于 `cf31ea5` 加入本次提交的剪贴板修订，版本号仍为 Alpha 39。

主要本机日志在 `test-results/desktop/win-alpha39-clipboard/`，包括 `build.log`、`package.log`、`packaged-regression.log`、`native-clipboard.log`、`office-clipboard.log` 和 `alpha13-legacy-roundtrip.log`。输入法保存结果在其 `windows-shell-ime/中文输入法 验收.md`，SHA-256 为 `ef4c83b7e56ebdbe8c909bc2fe9a8b9f8ccd7797fbed47b6dec30d9e7c9f4b55`。

最新预览取消修订包为 `dist/desktop/packages/win-alpha39-preview-cancel/documd-0.1.0-alpha.39-win32-x64-preview-cancel-fix-portable.zip`。版本号仍为 Alpha 39，228 项回归、十轮长文复验及完整数据回退记录见 [取消修订包复验](WINDOWS_X64_PERFORMANCE_ROLLBACK.zh-CN.md#取消修订包复验)。
