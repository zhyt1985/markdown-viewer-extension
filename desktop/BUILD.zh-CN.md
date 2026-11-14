# 桌面应用构建与排错

本指南对应仓库的 Electron 桌面应用（`desktop/`）。`npm run build:macos`
构建的是 `mobile/` 中的 Flutter 应用；Electron 桌面应用使用
`build:desktop`、`desktop` 和 `package:desktop`。

## 环境与依赖

使用 Node.js 24 或更新版本，在仓库根目录执行：

```sh
node --version
npm ci
npm --prefix desktop ci
```

两个目录各自维护 `package.json` 和锁文件，必须分别安装。根目录依赖提供共享渲染引擎与
esbuild，`desktop` 依赖提供 CodeMirror、Electron、打包工具和 PDF 测试工具。
构建机器需要这些开发依赖，因此不要使用 `--omit=dev`。

## 开发运行与打包

```sh
# 只构建应用资源，输出到 dist/desktop/app
npm run build:desktop

# 构建资源并启动 Electron 开发版
npm run desktop

# 构建资源并打包当前机器对应的平台和架构
npm run package:desktop
```

Electron 运行时可能在首次启动时才下载。可以提前执行：

```sh
npm exec --prefix desktop -- install-electron --no
```

打包输出：

| 构建机器 | 应用路径（相对于仓库根目录） |
| --- | --- |
| macOS Apple Silicon / arm64 Node.js | `dist/desktop/packages/documd-desktop-darwin-arm64/documd-desktop.app` |
| macOS Intel / x64 Node.js | `dist/desktop/packages/documd-desktop-darwin-x64/documd-desktop.app` |
| Windows x64 | `dist/desktop/packages/documd-desktop-win32-x64/documd-desktop.exe` |
| Linux x64 | `dist/desktop/packages/documd-desktop-linux-x64/documd-desktop` |

以 `node -p "process.platform + ' ' + process.arch"` 的结果为准。当前脚本使用宿主平台和
Node.js 架构，没有跨平台目标参数。`package:desktop` 生成包含 Electron 的应用目录，
不会生成 DMG、PKG、安装向导或单文件 EXE。Windows/Linux 分发时需保留整个输出目录。
正式对外发布时的签名、公证和安装器需要另外配置。

macOS 构建成功后，可从 Finder 打开 `.app`，或执行：

```sh
open dist/desktop/packages/documd-desktop-darwin-arm64/documd-desktop.app
```

## 常见问题

### `Could not resolve "@codemirror/…"`

原因是只安装了根目录依赖，或 `desktop/node_modules` 不完整。

```sh
npm --prefix desktop ci
npm run build:desktop
```

构建脚本会在生成资源之前检查所需依赖，并给出安装命令。不要把 CodeMirror 标记为
`external` 来跳过报错，编辑器需要把这些包打入应用。

### npm 下载报 `ENOTFOUND`、超时或连接失败

先检查 npm registry 的网络连接：

```sh
npm config get registry
npm ping
```

恢复网络或按本机网络策略配置代理后，重新执行失败目录的 `npm ci`。
若在受限的自动化环境中构建，还需要允许该构建命令访问网络。
更换 npm registry 只影响 npm 包下载，Electron 二进制仍有独立下载地址。

### `Electron failed to install correctly` / `Downloading Electron binary...` 停滞

npm 依赖安装成功，不代表 Electron 二进制已经下载。先执行显式安装命令：

```sh
npm exec --prefix desktop -- install-electron --no
```

若官方二进制下载仍不可达，可使用下面的本地 ZIP 打包流程。无需修改锁定的 Electron
版本，也无需关闭 TLS 或校验。打包版可以直接运行，开发启动命令仍需要本地 Electron
运行时安装完成。

### 使用本地 Electron ZIP 打包

先确认当前锁定版本、平台和架构：

```sh
node -p "require('./desktop/node_modules/electron/package.json').version"
node -p "process.platform + ' ' + process.arch"
```

准备对应的官方 ZIP，例如 Electron `45.2.2`、macOS arm64：

```text
electron-v45.2.2-darwin-arm64.zip
```

文件名必须与当前依赖版本和机器架构完全一致。将完整 ZIP 放入一个目录，
再把**目录路径**传给打包脚本。macOS / Linux：

```sh
DOCUMD_ELECTRON_ZIP_DIR=/absolute/path/to/electron-zips npm run package:desktop
```

Windows PowerShell：

```powershell
$env:DOCUMD_ELECTRON_ZIP_DIR = 'C:\cache\electron'
npm run package:desktop
Remove-Item Env:DOCUMD_ELECTRON_ZIP_DIR
```

脚本按已安装 Electron 包内的校验清单验证 SHA-256，之后才使用 ZIP。
`Cached Electron ZIP checksum mismatch` 表示 ZIP 下载不完整、内容错误或与校验清单不符；
重新下载匹配文件，不要跳过校验。ZIP 本身无需预先解压。

## 验证

Windows x64 的源码同步、EXE 打包、自动回归及人工冒烟步骤见 [Windows x64 源码同步与回归手册](WINDOWS_X64_REGRESSION.zh-CN.md)。

```sh
npm run typecheck
npm run build:desktop
npm run test:desktop
```

类型检查脚本会分别报告项目源码错误和源码分发的第三方包诊断；以项目源码错误数量和
退出码判断结果。桌面测试包含真实 Electron 窗口，需要可用的图形桌面环境。

也可以直接测试打包后的应用，从而验证应用目录中的资源是否完整。macOS arm64：

```sh
MV_DESKTOP_EXECUTABLE="$PWD/dist/desktop/packages/documd-desktop-darwin-arm64/documd-desktop.app/Contents/MacOS/documd-desktop" npm run test:desktop
```

Windows PowerShell：

```powershell
$env:MV_DESKTOP_EXECUTABLE = (Resolve-Path 'dist/desktop/packages/documd-desktop-win32-x64/documd-desktop.exe').Path
npm run test:desktop
Remove-Item Env:MV_DESKTOP_EXECUTABLE
```

测试会使用独立的临时用户目录，截图、日志及导出文件在 `test-results/desktop/`。

### 2026-11-10 本机构建记录

- 环境：macOS arm64、Node.js 24.13.0、Electron 45.2.2。
- 版本：`0.1.0-alpha.13`。
- 资源构建与 macOS `.app` 打包通过；打包使用 SHA-256 校验通过的本地官方 ZIP。
- `npm run typecheck` 通过，项目源码错误为 0；脚本另外报告 297 项第三方源码诊断。
- macOS arm64 打包应用全量回归 131 个报告条目通过，无失败、取消或跳过，含 24 项单元测试。
- 编码回归覆盖 UTF-16 BOM 自动识别、显式打开 GBK、从最近记录重开、按原编码保存、拒绝有损写入及 UTF-8 副本转换。

回归修正了临时目录的规范路径、无效 UTF-8 夹具、编辑器的跨平台按键、字体断言及图表关闭后的异步清理等待。

本机已将匹配 ZIP 保留在 Git 忽略的 `.cache/electron/`，可在仓库根目录重复离线打包：

```sh
DOCUMD_ELECTRON_ZIP_DIR="$PWD/.cache/electron" npm run package:desktop
```

该缓存对应上述 Electron 版本和 macOS arm64；升级依赖或更换平台后需准备新的匹配 ZIP。

### 2026-11-11 Windows x64 回归记录

用户提交的 `desktop-win-x64-test.log` 记录了 Alpha 13 的 Windows x64 打包应用全量自动回归。131 个报告条目全部通过，失败、取消和跳过均为 0，耗时约 155 秒。通过的用例包括编码恢复、单实例和拖放、草稿恢复及 DOCX/PDF 导出。当前版本的人工冒烟结果见 [Alpha 17 界面语言记录](#2026-11-11-alpha-17-界面语言)。

### 2026-11-11 Alpha 14 共享设置

版本推进至 `0.1.0-alpha.14`。设置界面覆盖共享 schema 的 12 项桌面设置，其中语言沿用即时保存控件，其他 11 项通过“应用并保存”批量提交。

- 文档设置提供 34 个登记主题、Frontmatter、表格/图片/图表对齐、合并空单元格和首行缩进。
- Word 设置提供分隔线处理和 Emoji 字体选择。
- 文件侧栏支持左右位置和宽度，宽度按可用窗口空间调整。
- “恢复文档与侧栏默认值”先填入共享 schema 的默认值，点击“应用并保存”后写入。应用外观、阅读字体、语言与编辑偏好使用各自控件。
- 设置通过桌面设置服务排队并原子写入。应用后刷新当前预览，正在导出的文件继续使用任务开始时的设置。

macOS arm64 构建、打包及项目源码类型检查通过，第三方源码诊断仍为 297 项。打包应用全量回归 137 个报告条目全部通过，无失败、取消或跳过。`settings-e2e.test.js` 覆盖全部主题的实际渲染、设置重启恢复、无效批量写入、并发语言保存和 DOCX 导出分页快照。已查看阅读和 960×640 设置页面截图。

Alpha 14 的 Windows x64 打包回归待执行。完整 UI 翻译等 P3 项继续按功能矩阵推进。

### 2026-11-11 Alpha 15 文档批注

版本推进至 `0.1.0-alpha.15`。正文选区支持四色标记、背景/下划线/波浪线/边框、备注和跨段选择。批注与目录共用侧栏，可定位原文、编辑备注、删除和限时撤销。结构化复制可选择随后关闭文档，按原有流程处理未保存正文。

每份文档的批注记录单独原子写入 `userData/annotations/`。未命名文档首次保存时迁移记录。定位同时核对正文版本、选区偏移、引用及上下文。仅换行格式改变时可继续匹配，正文改动或旧格式缺少定位信息时由用户确认新选区。

导入兼容已有 `.remarks.json` 和旧版批注数组。预览显示新增、重复与待重新定位数量，确认后合并。导出沿用批注文件第 1 版，并携带桌面定位信息。每文档最多 400 条，批注文件上限 2 MiB。

macOS arm64 最终打包应用的全量回归 144 个报告条目全部通过，失败、取消和跳过均为 0。批注测试覆盖重复文字、跨段、四种样式、备注编辑、撤销、导入预览和去重、LF/CRLF 同文匹配、重新定位、重启恢复及未命名稿迁移。源码类型检查通过，第三方源码诊断仍为 297 项。Windows x64 打包回归待执行。

### 2026-11-11 Alpha 16 阅读布局

版本推进至 `0.1.0-alpha.16`。状态栏的缩放百分比打开阅读布局菜单。普通布局最大宽度为 820 px，宽栏占满可用空间，窄栏最大宽度为 680 px。正文可分档缩放，调整宽度或缩放时保留当前段落附近的位置。

布局、缩放与滚动位置使用已有的每文档状态保存。打开旧状态时，缺失的布局和缩放分别采用普通布局及 100%。进入源码模式时保留上次可见阅读位置，切换标签或重启后恢复各自的阅读状态。

“视图 → 进入全屏”和 F11 切换原生窗口全屏。专注阅读单独控制侧栏显示。定向回归已核对在普通阅读和 200% 窄栏源码模式下，PDF 的分页、页面尺寸及文字坐标一致。

macOS arm64 最终打包应用的全量回归 149 个报告条目全部通过，失败、取消和跳过均为 0。已检查 200% 窄栏截图并确认宽表格处于阅读区范围内。源码类型检查通过，第三方源码诊断仍为 297 项。Windows x64 打包回归待执行。

### 2026-11-11 Alpha 17 界面语言

版本推进至 `0.1.0-alpha.17`。“设置 → 语言”可即时切换，默认跟随系统。桌面简体中文和英文覆盖菜单、设置、编辑器查找、阅读控件、批注、导出状态及应用提供的原生对话框文案。其他 26 种登记语言继续加载共享词条，桌面专用文案回退至英文。系统或底层库返回的诊断细节沿用原文。

`locale-e2e.test.js` 使用独立配置验证系统英文、简中即时切换、德语共享词条与英文回退、原生关闭确认、重启恢复语言和编辑稿。测试核对中文文件名、Markdown 正文及编辑器撤销历史。已检查英文设置页截图。

macOS arm64 打包应用的全量回归 150 个报告条目全部通过，失败、取消和跳过均为 0。日志位于 `test-results/desktop/alpha17-packaged.log`。项目源码类型检查通过，第三方源码诊断仍为 297 项。

Windows x64 打包应用全量自动回归 **150/150 通过**，失败、取消、跳过和待办均为 0，耗时约 152 秒。语言专项、共享设置、批注和阅读布局测试均通过。用户提供的原始日志已归档至本地 `test-results/desktop-win-x64-alpha17-test.log`。

用户确认回归手册中的人工检查均通过，覆盖语言切换、Windows 原生打开和保存对话框、批注与阅读布局、草稿恢复及 DOCX/PDF 导出与打开。 [Windows x64 回归手册](WINDOWS_X64_REGRESSION.zh-CN.md#4-手动验证-windows-目标环境)

### 2026-11-11 Alpha 18 Markdown 阅读回归

版本推进至 `0.1.0-alpha.18`。新增 `desktop/test/markdown-reading-e2e.test.js`，通过实际桌面文件打开入口复用现有布局与演示夹具。新增五项场景覆盖以下行为。

- 带 UTF-8 BOM 和 CRLF 的中文路径文档可跳转到脚注并返回。切换到任务列表标签后，脚注不会残留，嵌套任务的选中状态正确。
- UTF-16LE BOM 文档中的行内和块级公式可读，JavaScript 和 Markdown 围栏保留高亮与代码结构。
- GitHub 的五种警告块保留类型和正文格式，普通引用保持原样。
- Emoji 短代码只在正文转换。内联 HTML 按共享处理器规则保留受支持的语义，`<mark>` 保留文本，未知标签显示为文字。
- 原始 HTML 表格以 PNG 预览，GFM 表格保留原生结构。已查看截图中的跨行跨列、表格后正文和混排文本。截图位于 `test-results/desktop/packaged/markdown-reading/html-emoji.png`。

macOS arm64 打包应用全量回归 **156/156 通过**，失败、取消和跳过均为 0，耗时约 102 秒。日志位于 `test-results/desktop/alpha18-packaged.log`。项目源码类型检查通过，第三方源码诊断仍为 297 项。本批沿用现有共享 Markdown 处理器。

按用户安排跳过 Alpha 18 的 Windows x64 复测。Windows x64 最近一次已验收版本为 Alpha 17。

### 2026-11-11 Alpha 19 缓存与设置回归

版本推进至 `0.1.0-alpha.19`。在图表渲染期间清理缓存时，清理前启动的任务仍会正常显示预览，只有清理后发起的渲染可以写回缓存。缓存操作进行时禁用清理和刷新按钮，操作结果显示在设置的缓存区。

新增用例在 Alpha 18 打包应用中复现了清理后旧图表结果写回的问题。扩展了以下设置与会话检查。

- 从「设置 → 语言」逐个启用全部 28 种登记语言，核对实际加载的语言和当前选项。
- 清理缓存后核对语言设置、阅读位置和最近记录。新渲染可正常重新生成缓存。
- 清空最近记录后重启，已打开的标签和正文仍恢复，最近记录保持为空。

macOS arm64 打包应用全量回归 **158/158 通过**，失败、取消和跳过均为 0，耗时约 113 秒。日志位于 `test-results/desktop/alpha19-packaged.log`。项目源码类型检查通过，第三方源码诊断仍为 297 项。本批按用户安排跳过 Windows x64 打包复测。

### 2026-11-11 Alpha 20 本地源码预览

版本推进至 `0.1.0-alpha.20`。普通文本、YAML 和代码文件可从打开文件对话框、拖放、工作区及系统文件打开入口进入独立只读标签。已打开的文件纳入最近记录和会话恢复，并沿用编码选择和磁盘重新载入。支持的后缀复用项目的源码语言清单。

源码视图显示行号，有语法定义时提供高亮。较大的文件使用纯文本，以免为长日志生成大量节点。切回 Markdown 时恢复原来的阅读或编辑模式，草稿和撤销历史仍可用。

专项验证涵盖 UTF-16 文本、YAML 高亮、JavaScript 源码、拖放、大文件回退和重启恢复。已检查 YAML 预览截图，位于 `test-results/desktop/packaged/local-source/yaml.png`。F12 的独立 HTML 和图片文件预览仍待实现。

macOS arm64 打包应用全量回归 **164/164 通过**，失败、取消和跳过均为 0，耗时约 113 秒。日志位于 `test-results/desktop/alpha20-packaged.log`。项目源码类型检查通过，第三方源码诊断仍为 297 项。本批按用户安排跳过 Windows x64 复测。

### 2026-11-11 Alpha 21 独立图片预览

版本推进至 `0.1.0-alpha.21`。PNG、JPEG、GIF、WebP、AVIF、BMP、ICO 和 SVG 可从文件选择、拖放、工作区及系统打开入口进入只读标签。预览显示图片尺寸，可打开原图缩放和平移。磁盘变更可自动重新载入，图片标签随会话恢复。

SVG 按图片加载。应用只提供当前图片的字节，切换或关闭标签时撤销旧地址，图片标签不会获得所在目录的资源读取权限。损坏图片显示加载失败提示，其他标签仍可正常打开。

专项用例覆盖 PNG、带脚本的 SVG、宽图适配、放大后焦点恢复、过期图片地址、损坏图片、磁盘替换和重启恢复。已查看图片预览截图，位于 `test-results/desktop/packaged/image-file/image.png`。F12 的独立 HTML 隔离预览仍待实现。

macOS arm64 打包应用全量回归 **169/169 通过**，失败、取消和跳过均为 0，耗时约 121 秒。日志位于 `test-results/desktop/alpha21-packaged.log`。项目源码类型检查通过，第三方源码诊断仍为 297 项。本批按用户安排跳过 Windows x64 复测。

### 2026-11-11 Alpha 22 本地 HTML 预览

版本推进至 `0.1.0-alpha.22`。`.html` 和 `.htm` 文件可从文件选择、拖放、工作区及系统打开入口进入只读标签，沿用编码选择、磁盘重载和会话恢复。

HTML 在独立的 Electron 视图与内存会话中加载。直接打开时以文件所在目录为授权范围，从工作区打开时使用已授权的工作区根目录。可用资源类型包括本地 CSS、图片、字体、JavaScript 和 JSON。会话不加载应用 preload，资源服务拒绝越界路径和其他 HTML/Markdown 文档。远程请求、弹窗、下载及 WebRTC 连接被阻断。 [Electron 原生视图](https://www.electronjs.org/docs/latest/api/web-contents-view) · [Electron 会话协议](https://www.electronjs.org/docs/latest/api/protocol#using-protocol-with-a-custom-partition-or-session) · [Chromium 连接白名单](https://developer.chrome.com/blog/connection-allowlist-announcement)

打开菜单或设置时暂时隐藏 HTML 视图，切换标签时销毁旧视图。专项覆盖本地资源加载、远程和越界请求、菜单与设置、Markdown 标签切换、重载、重启及预览进程崩溃后的恢复。

macOS arm64 打包应用全量回归 **174/174 通过**，失败、取消和跳过均为 0，耗时约 124 秒。日志位于 `test-results/desktop/alpha22-packaged.log`。项目源码类型检查通过，第三方源码诊断仍为 297 项。本批按用户安排跳过 Windows x64 复测。HTML 转 Markdown 仍按 F25 单独验收。

### 2026-11-11 Alpha 23 HTML 转 Markdown

版本推进至 `0.1.0-alpha.23`。打开本地 `.html` 或 `.htm` 后，选择 **文件 → 将当前 HTML 转为 Markdown**；复制富文本或 HTML 源码后，选择 **文件 → 粘贴 HTML 转 Markdown**。两种入口都生成可编辑、可恢复的未命名草稿。打开本地文件时转换以源文件正文为准，脚本在隔离预览中产生的页面变化不会进入草稿。

桌面和 Chrome 共用 Readability 与 Turndown。提取失败时回退至主内容区域或正文。相对图片从 HTML 文件所在目录解析，文件必须在已授权目录内；剪贴板可保留 HTML 中自带的图片。图片嵌入后可随草稿另存和导出。远程图片、越界路径及无法读取的图片留下注记，状态栏显示遗漏数量。普通相对链接保留原写法，跨目录保存时可在编辑器调整链接。

打包应用专项覆盖带中文、空格和 `#` 的相对图片路径、符号链接越界、剪贴板正文和内嵌图片、原文件内容保持、草稿重启恢复、另存，以及 Word 图片和 PDF 文件导出。

macOS arm64 打包应用全量回归 **178/178 通过**，失败、取消和跳过均为 0，耗时约 119 秒，日志位于 `test-results/desktop/alpha23-packaged.log`。Chrome 扩展构建和 HTML 转换后保存为 `.md` 的 Chromium 专项通过，日志位于 `test-results/desktop/alpha23-chrome-html-conversion.log`。项目源码类型检查通过，第三方源码诊断仍为 297 项。本批按用户安排跳过 Windows x64 复测。

### 2026-11-12 Alpha 24 独立图表与离线回归

版本推进至 `0.1.0-alpha.24`。八类图表引擎的九种登记格式（Vega 和 Vega-Lite 分开计）可打开独立文件，也可在 Markdown 围栏中渲染。独立文件默认为图形预览；通过 **更多 → 图表源码** 切换只读源文。渲染成功后可导出 Word 或 PDF，源码视图不会进入导出。失败块显示引擎与源行，正文及其他图表仍可阅读；有渲染失败时导出不可用。

Graphviz 在隔离渲染宿主编译包内 WebAssembly；JavaScript 字符串求值仍禁用。DrawIO 专项验证实际读取包内模板。Vega/Vega-Lite 的静态相对数据路径以当前文档所在目录为基准，并受已授权目录限制；验证了带中文、空格、`#` 和 `%` 的 CSV、重载后图形更新，以及远程或符号链接越界时的诊断。数据文件使用 UTF-8，更新后可重新载入图表或 Markdown 文档。

专项覆盖九种登记格式的独立文件、代码块及错误输入，也覆盖只读源码切换、导出中的图形和工作区数据引用。Slidev 仍需接入桌面演示和列表、打包 shell 与主题、验证静态导出。

macOS arm64 打包应用全量回归 **183/183 通过**，失败、取消和跳过均为 0，耗时约 121 秒。日志位于 `test-results/desktop/alpha24-packaged.log`。项目源码类型检查通过，第三方源码诊断仍为 297 项。本批按用户安排跳过 Windows x64 复测。

### 2026-11-12 Alpha 25 Slidev 离线演示

版本推进至 `0.1.0-alpha.25`。`.slides.md` 文件从文件选择、工作区、拖放或系统打开入口进入只读演示标签。演示工具条提供前后页、页数、演示／列表切换和原生全屏；从列表回到演示会回到先前的页。包内包含九套主题、Slidev 壳、脚本和 KaTeX 字体，缺少指定主题时使用默认主题并提示。

演示视图使用独立资源域，不加载桌面桥接代码。相对图片从当前文稿位置解析，限于已授权目录；图表使用现有离线图表宿主。无法读取图片或渲染图表时在页内提示，并禁用不完整的导出。

Slidev 支持静态 PDF：单独的打印窗口按幻灯片比例生成一页一张，显示逐步展开的内容，不保留交互、动画或过渡。专项验证九套主题真实挂载、包内数学字体、授权路径图片、图表、翻页、列表、全屏进出和越界诊断。用 PDF 解析器逐页核对三页的顺序、比例、图片和图表，以及展开后的文字。

macOS arm64 打包应用全量回归 **188/188 通过**，失败、取消和跳过均为 0，耗时约 137 秒，日志位于 `test-results/desktop/alpha25-packaged.log`。Chrome 扩展构建及本地 Slidev 打开、主题加载、翻页专项通过，日志位于 `test-results/desktop/alpha25-chrome-slidev.log`。项目源码类型检查通过，第三方源码诊断仍为 297 项。本批按用户安排跳过 Windows x64 复测。

### 2026-11-12 Alpha 26 额外本机资源目录

版本推进至 `0.1.0-alpha.26`。已保存文档可在 **更多 → 本机资源目录… → 添加本机目录…** 选择最多 8 个额外目录。引用仍以源文件位置为基准；目录只对当前打开的标签有效。切换回来或重载时保留，关闭标签或重启后需要重新选择。

授权覆盖 Markdown/Slidev 图片、隔离 HTML 图片与字体、HTML 转 Markdown 的相对图片及 Vega/Vega-Lite 数据。额外目录不会扩大文档链接、工作区搜索和写入范围，也不会为隔离 HTML 增加脚本来源。撤销会更新当前预览并使旧资源地址失效，仍在进行且持有该授权的导出会取消。目录路径及身份在读取时检查，拒绝越界符号链接、被替换的目录及整个卷根。

专项验证了目录选择和取消、带中文和 `#`/`%` 的路径、直接文件 URI、字体、预览和 Word/PDF 导出、跨标签隔离、撤销期间取消导出、目录替换、关闭重开与重启清除授权。macOS 使用系统卷信息检查所选目录；Windows 的 UNC 和映射盘拒绝逻辑随代码交付，目标机验证按本批安排暂缓。

macOS arm64 打包应用全量回归 **194/194 通过**，失败、取消和跳过均为 0，耗时约 145 秒。日志位于 `test-results/desktop/alpha26-packaged.log`。项目源码类型检查通过，第三方源码诊断仍为 297 项。本批按用户安排跳过 Windows x64 复测。

### 2026-11-12 Alpha 27 单文件 HTML 导出

版本推进至 `0.1.0-alpha.27`。Markdown 和独立图表可以通过 **导出 → HTML** 保存为单文件。主题样式、KaTeX 数学字体、图片和图表嵌入成品，不需要桌面应用或 CDN。导出保留文档的链接和脚注导航，链接指向的其他文件不会一起打包。Slidev 继续使用专门的静态 PDF 导出。

HTML 在独立导出窗口按任务开始时的文档和设置生成，前台可切换标签。缺图和渲染失败会阻止写出不完整文件；取消也不留下成品。专项将成品移入只有该 HTML 的目录，在禁止读取其他文件和网络资源的新浏览器会话中打开，验证样式、PNG/JPEG 原始格式、图表、数学字体、表格、代码和脚注。

macOS arm64 打包应用全量回归 **198/198 通过**，失败、取消和跳过均为 0，耗时约 139 秒。共享 HTML 排版契约 **15/15 通过**。日志位于 `test-results/desktop/alpha27-packaged.log` 和 `test-results/desktop/alpha27-html-layout.log`。项目源码类型检查通过，第三方源码诊断仍为 297 项。本批按用户安排跳过 Windows x64 复测。

### 2026-11-12 Alpha 28 整页 PNG 导出

版本推进至 `0.1.0-alpha.28`。Markdown 和独立图表可通过 **导出 → PNG** 生成一张 1440 像素宽的长图。独立的离屏渲染窗口使用文档和设置快照，保留主题、图片和图表。宽表格和长代码按导出宽度换行；超过 16,000 像素高时提示改用 PDF 或拆分文档。内容无法放下、缺图、任务取消或捕获尺寸不符时，不留下不完整的 PNG。Slidev 继续使用专门的静态 PDF 导出。

专项解码成品后检查首尾颜色标记、宽表格最右列和文末 Mermaid 图表，同时验证前台滚动位置不变、保存期间切换标签仍导出原文、缺图和超限无成品。

300 段测试文档导出尺寸为 **1440 × 10,694** 像素。macOS arm64 打包应用全量回归 **202/202 通过**，失败、取消和跳过均为 0，耗时约 143 秒。日志位于 `test-results/desktop/alpha28-packaged.log`。项目源码类型检查通过，第三方源码诊断仍为 297 项。本批按用户安排跳过 Windows x64 复测。

### 2026-11-12 Alpha 29 文档资产导出

版本推进至 `0.1.0-alpha.29`。在 **更多 → 文档资产…** 查看当前 Markdown 或独立图表的资产。可按类型、序号和源行筛选，勾选单项或全选当前筛选；文件名沿用文档中的序号。普通图片保留原始字节，图表支持 PNG，并只在引擎提供对应内容时列出 SVG 或 DrawIO。

在所选目录下生成新批次文件夹，包含所选资产和 `manifest.json`。清单及报告保留缺图、渲染失败等不可用项及源行；仍可保存可用项。导出时切换标签不会改变原任务，取消或没有资产可写出时不会提交目录。专项验证筛选、PNG/JPEG 原始字节、真实 SVG 和 DrawIO、报告和取消；共享资产提取契约继续验证原有行为。

macOS arm64 打包应用全量回归 **207/207 通过**，失败、取消和跳过均为 0，耗时约 150 秒。共享资产提取与诊断契约 **10/10 通过**。日志位于 `test-results/desktop/alpha29-packaged.log` 和 `test-results/desktop/alpha29-asset-contract.log`。项目源码类型检查通过，第三方源码诊断仍为 297 项。本批按用户安排跳过 Windows x64 复测。

### 2026-11-12 Alpha 30 图片和图表右键菜单

版本推进至 `0.1.0-alpha.30`。在阅读区右键点击普通图片，可用原格式另存或复制为 PNG。右键点击图表，可保存或复制原始分辨率的 PNG；只有引擎提供原生 SVG 或 DrawIO XML 时，菜单才显示相应选项。独立图片预览沿用普通图片菜单。键盘可聚焦图片、图片链接或「放大查看」按钮，按 **Shift+F10** 打开，按方向键选择，按 **Esc** 关闭。

专项 **4/4 通过**。比较了 JPEG 原始字节、宽图在显示缩小后的原始 PNG 字节和剪贴板尺寸，并检查了原生 SVG 和 DrawIO 内容。还验证了取消保存、独立 SVG 原件覆盖保护、键盘焦点恢复及切换标签关闭旧菜单。测试验证了写入 Electron 剪贴板接口的原生图片，不修改测试机实际剪贴板。

macOS arm64 打包应用全量回归 **211/211 通过**，失败、取消和跳过均为 0，耗时约 152 秒。日志位于 `test-results/desktop/alpha30-packaged.log`。项目源码类型检查通过，第三方源码诊断仍为 297 项。本批按用户安排跳过 Windows x64 复测。

### 2026-11-12 Alpha 31 表格复制与 XLSX

版本推进至 `0.1.0-alpha.31`。在 Markdown 阅读区右键点击表格单元格，或聚焦表格后按 **Shift+F10**。选择 **复制表格** 会同时写入带基本样式的 HTML 和 TSV；合并覆盖的位置留空，保持列对齐。选择 **表格另存为 XLSX…** 可保留真实合并区域、表头粗体与底色、数字和文本类型。默认文件名取自表格前的标题。按 Esc 关闭菜单，表格里的图片仍使用图片菜单。

专项验证了两种剪贴板格式、生成文件的工作簿结构、横向与纵向合并、文本 `007`、数值 `42`、公式样式文本及取消保存。使用 macOS Excel 打开导出的样表，无需修复，合并区域与表头正常显示；将相同的 HTML 内容粘贴到空白工作簿，验证为 A1:C8，C4 为 `42`，C5 中的 `=1+1` 保持为文本。WPS 结果见下方 [Office 补验](#2026-11-12-alpha-31-office-补验)。

macOS arm64 打包应用全量回归 **215/215 通过**，共享表格契约 **19/19 通过**。日志位于 `test-results/desktop/alpha31-packaged.log` 和 `test-results/desktop/alpha31-table-contract.log`。项目源码类型检查通过，第三方源码诊断仍为 297 项。本批按用户安排跳过 Windows x64 复测。

### 2026-11-12 Alpha 31 Office 补验

- **macOS Word**：直接打开打包回归生成的 `验证结果.docx`，状态栏显示 1 页，无修复提示。单独解包确认 ZIP CRC 正常，正文含可编辑公式的 OMML、表格和绘图元素，归档含 2 个嵌入媒体文件。打开实测没有覆盖公式交互编辑、脚注和分页的逐项检查。
- **macOS WPS 表格**：打开打包回归生成的 `合并表.xlsx`，确认横向与纵向合并、表头粗体与底色、文本 `007` 及数值 `42` 正常显示。将回归生成的相同 HTML 内容粘贴到空白工作簿，核对 C4 为 `42`、C5 的 `=1+1` 保持为文本。该步骤验证 Office 对 HTML 的粘贴处理；HTML 和 TSV 同时写入桌面剪贴板接口由自动回归覆盖。
- **范围**：不变更 Alpha 31 程序，不重跑已通过的 215 项打包测试。Windows x64 复测按用户安排暂缓。包体基线及剩余工作见 [P6 交付检查](P6_DELIVERY.zh-CN.md)。

### 2026-11-12 Alpha 31 备份与回退

macOS arm64 打包应用专项 **2/2 通过**：Alpha 31 同版本恢复，以及 Alpha 17 配置副本升级至 Alpha 31 后，用升级前备份回退至 Alpha 17。两次均恢复会话、草稿、设置和批注，并验证源文件、原配置及备份未被恢复副本的修改覆盖。无程序改动。演练步骤和复跑命令见 [P6 交付检查](P6_DELIVERY.zh-CN.md#独立配置的备份与回退)。

### 2026-11-12 Alpha 31 性能基线

macOS arm64 打包应用完成 5 轮固定样本采样：新配置启动中位数 635 ms、Markdown 首屏 77.7 ms、取消界面响应 9.4 ms，导出渲染进程在五轮中均退出。统计口径、最慢值和复跑命令见 [P6 性能基线](P6_DELIVERY.zh-CN.md#alpha-31-性能基线)。本轮未修改应用代码，也未复测 Windows x64。

### 2026-11-12 Alpha 32 长文阅读与资源回收

版本推进至 `0.1.0-alpha.32`。打开普通 Markdown 时，即使图表仍在渲染，也可切换到已打开的标签；应用中止被切走文档的预览，之后仍可重新打开该标签。渲染完成时保留用户已经滚动到的位置。

macOS arm64 打包全量回归 **219/219 通过**，失败、取消和跳过均为 0，约 172 秒。项目源码类型检查通过，第三方源码诊断仍为 297 项。10,000 行/50 图表复测和 50 次开关、20 次导出的资源数据见 [P6 交付检查](P6_DELIVERY.zh-CN.md#长文渐进渲染与循环资源回收)。全量日志：`test-results/desktop/alpha32-packaged.log`。本批按用户安排跳过 Windows x64 复测。

### 2026-11-12 Alpha 33 万文件工作区

版本推进至 `0.1.0-alpha.33`。工作区树每页显示最多 500 项，单目录最多可浏览 20,000 项。文件名和正文检索可扫描 10,000 个 Markdown，显示进度并支持取消。5 轮实测均找齐两种查询各自的 100 条结果，取消后释放扫描目录句柄，单目录分页可打开最后一个文件。测量口径和原始数据见 [P6 工作区采样](P6_DELIVERY.zh-CN.md#10000-文件工作区)。

macOS arm64 打包全量回归 **220/220 通过**，失败、取消和跳过均为 0，约 159 秒。项目源码类型检查通过，第三方源码诊断仍为 297 项。全量日志：`test-results/desktop/alpha33-packaged.log`。本批按用户安排跳过 Windows x64 复测。

### 2026-11-12 Alpha 34 覆盖核对与源码交接

核对了 25 项保留功能及其入口、证据和缺口，逐项记录了 7 项完整排除和 2 项部分排除。实际包的范围负例发现桌面会继承 Wiki 语法改写，已关闭桌面阅读和导出中的改写。Word 和 HTML 产物的原文及 CLI 既有改写行为均有回归。

macOS arm64 打包全量回归 **221/221 通过**，失败、取消和跳过均为 0，约 169 秒；共享范围与 DOCX 契约 **13/13 通过**。项目源码类型检查通过，第三方源码诊断仍为 297 项。日志：`test-results/desktop/alpha34-packaged.log`、`test-results/desktop/alpha34-shared-scope.log`。

已生成 Alpha 34 源码包、校验文件和版本清单，并在 macOS 验证独立解压后的桌面资源构建。Windows EXE 和便携 ZIP 尚未生成；按用户安排不复测 Windows x64。详见 [功能覆盖核对](P6_COVERAGE_AUDIT.zh-CN.md)与 [Windows x64 手册](WINDOWS_X64_REGRESSION.zh-CN.md)。

### 2026-11-12 Alpha 35 文件树定位与代码复制

**更多 → 在工作区定位当前文件** 会打开文件侧栏，选择包含该文件的最内层工作区，展开路径并定位到正确的分页。该动作不重新打开文档；通过文件选择器打开的工作区内文件也可定位，工作区外文件显示明确提示。专项覆盖祖先目录和文件分别位于第二页、中文路径、重叠工作区、草稿保护，以及目录被替换后拒绝越界。

Markdown 阅读区代码块提供复制按钮，支持鼠标和键盘，复制保留缩进、空行和非 ASCII 文本。按钮随界面语言更新，仅在前台阅读区装配；HTML 导出实测保留代码、不含复制控件，其他格式仍走独立导出窗口。

macOS arm64 打包全量回归 **223/223 通过**，失败、取消和跳过均为 0，约 172 秒；项目源码类型检查通过，第三方源码诊断仍为 297 项。日志：`test-results/desktop/alpha35-packaged.log`。Windows x64 按用户安排未复测。

Chrome 扩展构建成功；用本机 Chromium 1228 跑已打包扩展的代码复制和表格、图片、图表右键菜单套件，**9/9 通过**。套件显式设置英文界面，使菜单文案断言与宿主系统语言无关。日志：`test-results/desktop/alpha35-chrome-context.log`。

Alpha 35 源码交接包、SHA-256 校验文件及版本清单位于 `dist/desktop/handoff`，包内含 [Windows x64 手册](WINDOWS_X64_REGRESSION.zh-CN.md)和新增回归用例。

### 2026-11-12 Alpha 36 最近工作区与文档模式恢复

「最近打开」分开列出文件和已关闭的工作区，两种历史各保留最多 20 条。点击最近工作区会重新打开其文件树。应用按已记录的规范路径重新检查目录，拒绝用链接或 junction 将记录指向其他路径。「清空最近记录」同时清理两种历史，保留已打开的工作区和文档。

每篇 Markdown 独立保存阅读、分栏或源码模式，以及原有的阅读宽度、缩放和滚动位置；标签切换和重启后会恢复。窗口过窄时分栏暂用源码布局，拉宽后恢复分栏。旧配置中没有该字段时，普通文档默认阅读，新建或首次恢复草稿默认分栏。

macOS arm64 打包全量回归 **224/224 通过**，失败、取消和跳过均为 0，约 166 秒；最近工作区和阅读状态专项 **10/10 通过**。项目源码类型检查通过，第三方源码诊断仍为 297 项。日志：`test-results/desktop/alpha36-packaged.log`、`test-results/desktop/alpha36-focused.log`。Windows x64 按用户安排未复测。

Alpha 36 源码交接包、SHA-256 校验文件和版本清单位于 `dist/desktop/handoff`。已从独立解压目录复用本机依赖构建桌面资源，本轮修改涉及的运行文件与主工作目录的构建产物逐字节一致。日志：`test-results/desktop/alpha36-source-build.log`。

### 2026-11-12 Alpha 37 PDF 排版与成品分页预览

「导出 → PDF」为 Markdown 和独立图表提供 A4、A5、Letter，横向/纵向与 0–35 mm 等宽页边距，默认 A4 纵向、12 mm。点击「生成分页预览」可逐页查看离线渲染的实际 PDF；未改变选项或文档版本时，保存使用同一份 PDF。改变排版选项会取消或清除旧预览。Slidev 保留原幻灯片尺寸，也可查看静态 PDF 预览。

打包专项确认 A5 横向约 595 × 420 pt，Letter 纵向 612 × 792 pt；A5 样张由 22 mm 改为 8 mm 后从 17 页减至 13 页。自动检查保留长表首尾行、正文尾标、前台滚动位置和源文件字节，预览与保存的 SHA-256 相同。用 Poppler 渲染了 Letter 首页和 A5 末页，检查正文、长表末行和 Mermaid 图表。日志：`test-results/desktop/alpha37-pdf-focused.log`。

macOS arm64 打包全量回归 **225/225 通过**，失败、取消、跳过均为 0，约 168 秒，含 Slidev 静态 PDF 的尺寸、页序及预览验证。项目源码类型检查通过，第三方源码诊断仍为 297 项。日志：`test-results/desktop/alpha37-packaged.log`。Windows x64 按用户安排未复测。

已生成并校验 Alpha 37 源码包、SHA-256 校验文件和版本清单，位于 `dist/desktop/handoff`。已从独立解压目录用本机依赖构建桌面资源，确认与本次 PDF 改动相关的运行文件逐字节一致。日志：`test-results/desktop/alpha37-source-build.log`。

### 2026-11-13 Alpha 37 候选包恢复与交接

macOS arm64 打包应用的同版本备份恢复及 Alpha 17 → Alpha 37 → Alpha 17 均通过（**2/2**）。操作使用测试配置与合成文档，确认草稿、批注、设置、标签和源文件完整，且恢复副本的写入不修改基线。日志：`test-results/desktop/alpha37-profile-backup.log`。

同版本源码包纳入[仓库样本试跑报告](P6_CANDIDATE_TRIAL.zh-CN.md)和[真实文档试用记录](P6_DOCUMENT_TRIAL.zh-CN.md)。运行代码未变化，Windows x64 未复测。

### 2026-11-13 Alpha 38 公开文档兼容修复

桌面预览与导出最多同时处理 4 个异步图表任务，仍保留宿主队列上限和取消操作。Mermaid 将 SVG 序列化为独立 XML，确保时序图角色链接的命名空间有效。Slidev 桌面壳将已校验的本地背景与图片交给对应布局，封面和图片栏均可进入静态 PDF。

[公开文档复测](P6_PUBLIC_DOCUMENT_TRIAL.zh-CN.md#alpha-38-复测)：原版时序图 38 张全部成功；流程图原版不再触发队列满，移除唯一不可渲染的远程图片依赖后，116 张图全部成功。Slidev 本地封面图已从 PDF 第一页确认。键盘和鼠标菜单均成功保存公开样本表格为 XLSX。

macOS arm64 打包全量回归 **226/226**，无失败、取消或跳过；Chrome 扩展相关用例 **12/12**，项目源码类型检查通过。日志：`test-results/desktop/alpha38-packaged.log`、`alpha38-chrome.log`。Windows x64 按安排未复测。

### 2026-11-14 Alpha 39 Mermaid 离线图标

桌面 Mermaid 从打包内加载 Font Awesome 5 Free 的实心、常规和品牌图标，支持 `fa`、`fas`、`far`、`fab`。图标数据和授权说明已核对在实际应用包内；图标数据变化会使旧图表缓存失效。此改动仅在桌面宿主启用。

[公开样本复测](P6_PUBLIC_DOCUMENT_TRIAL.zh-CN.md#alpha-39-复测)通过 116 张图的离线副本和 63 页 PDF，对照新旧第 60 页确认原先缺失的图标已显示。原版远程图片仍被拦截。源码包独立解压后复用本机依赖构建成功，图标数据、渲染宿主和授权说明与当前构建产物逐字节一致。

macOS arm64 打包全量回归 **227/227 通过**，无失败、取消或跳过；项目源码类型检查通过。日志：`test-results/desktop/alpha39-packaged.log`、`alpha39-source-build.log`。Windows x64 按安排未复测。

### 2026-11-14 Alpha 39 Office 与 PDF 补验

在 macOS 26.7.1 arm64 用 Alpha 39 打包应用和隔离配置重新导出，四份产物均成功生成；四份输入校验值未改变。导出位置由测试工具代填。

- **Word 16.115**：正常打开 DOCX，未见修复提示。1 页，中文正文、行内公式、独立分式和表格均可见。包内有 2 个 OMML 公式；本轮未修改并保存公式。脚注内容保留为文末 Footnotes 列表，没有 Word 原生脚注引用。
- **Excel 16.115、WPS 12.1.28496**：均打开 XLSX 并显示横向、纵向合并，WPS 使用只读模式。核对了 6 处合并、数值 `42`、带前导零的文本 `007`，以及保持为文本的 `=1+1`。本轮未重复验证 HTML 剪贴板粘贴，历史结果见 Alpha 31。
- **macOS 预览 11.0**：打开 72 页长表 PDF 并跳到末页，最后一行可读；打开 42 页时序图 PDF 并跳到第 37 页。另用 Poppler 逐页抽查上述两页，表格和图形无明显裁切。

本机日志：`test-results/desktop/alpha39-office.log`。本轮仅生成、打开及核对测试样本，应用代码未改。Windows x64 打包和实机验收继续暂缓。

### 2026-11-14 Alpha 39 macOS 候选包归档

交接包为 `documd-0.1.0-alpha.39-macos-arm64.zip`，大小 **131,080,778 字节**。仅对交接副本补做临时签名，应用归档 `app.asar` 与原构建逐字节一致。ZIP 校验、独立解压、框架链接与严格签名检查均通过。

直接测试 ZIP 解压后的应用：全量 **227/227**、隔离配置恢复与跨版本回退 **2/2**。日志：`test-results/desktop/alpha39-macos-candidate.log` 和 `alpha39-macos-candidate-rollback.log`。使用步骤与签名边界见 [macOS arm64 候选包说明](MACOS_ARM64_CANDIDATE.zh-CN.md)。此包供本地试用，未公证；Windows 打包及实机验收按用户安排跳过。
