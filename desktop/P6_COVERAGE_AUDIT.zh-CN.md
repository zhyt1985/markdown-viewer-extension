# 功能覆盖核对 · Alpha 39

从 Alpha 33 开始核对，Alpha 34 修复了排除范围偏差，Alpha 35 补上文件树定位和代码复制，Alpha 36 补上最近工作区和按文档恢复阅读模式，Alpha 37 补上 PDF 排版选项和分页预览。对照[开发计划的保留矩阵](DEVELOPMENT_PLAN.zh-CN.md#32-保留功能矩阵)、[机器可读矩阵](test/feature-coverage.json)、桌面入口、测试断言及现有人工记录。**25 项都有桌面主流程和证据，仍有人工及目标机验收缺口。** 旧版本的 Windows 及 Office 证据单独标注，本次未复测 Windows。

| ID | 桌面入口与本地证据 | 尚待完成或证据边界 |
| --- | --- | --- |
| F01 | 文件菜单、拖放、启动参数、另存为；[打开入口](test/open-entry-e2e.test.js)、[编辑与保存](test/editing-e2e.test.js) | Windows 原生对话框和系统文件关联待当前候选包验证。 |
| F02 | 文件侧栏、打开文件夹、展开/刷新和分页；更多 → 在工作区定位当前文件；[工作区回归](test/workspace-e2e.test.js)、[跨页定位](test/workspace-reveal-e2e.test.js)、[万文件采样](P6_DELIVERY.zh-CN.md#10000-文件工作区) | Alpha 35 补齐定位入口；目标机文件树和原生路径仍待验。 |
| F03 | 检索侧栏、取消、结果行号和历史前后退；[检索](test/navigation-search-e2e.test.js)、[阅读导航](test/reading-navigation-e2e.test.js) | 已有 10,000 文件扫描、进度和取消的 macOS 实测；Windows 待验。 |
| F04 | 最近文件与工作区、会话恢复、按文档保存阅读/分栏/源码模式、自动刷新；[会话及工作区历史](test/navigation-search-e2e.test.js)、[阅读状态](test/reading-layout-e2e.test.js)、[外部修改](test/editing-e2e.test.js) | Alpha 36 验证了重启后重新打开已关闭工作区、拒绝替换链接、清理最近记录和恢复各文档模式；Windows 待验。 |
| F05 | Markdown 阅读/分栏；[阅读结构](test/markdown-reading-e2e.test.js)覆盖 GFM、数学、脚注、警告块、Emoji、内联 HTML 与 HTML 表格 | 代表性夹具通过；用户真实文档样本待试用。 |
| F06 | 设置中的主题与版式、正文与代码字体；[主题设置](test/settings-e2e.test.js)、[字体](test/reading-font-diagram-e2e.test.js) | 所有登记主题已在包内切换；未穷举字体、代码主题和各项排版设置的组合。 |
| F07 | 大纲、缩放、阅读宽度、源码/分栏、全屏；[阅读布局](test/reading-layout-e2e.test.js)、[长文切换](test/progressive-reading-e2e.test.js) | 源码模式导出及阅读状态已验证；Windows 高 DPI 和系统全屏待验。 |
| F08 | 分栏编辑、查找替换、撤销/重做、自动预览及保存；[编辑](test/editing-e2e.test.js)、[草稿](test/editor-recovery-e2e.test.js)、[实时预览](test/live-preview-e2e.test.js) | 已覆盖磁盘冲突和回收；Windows IME 与真实编辑工作流待验。 |
| F09 | 独立图表文件、Markdown 围栏、图表源码；[图表矩阵](test/diagram-formats-e2e.test.js) | Alpha 38 验证超过 100 张图和 Mermaid 角色链接时序图；Alpha 39 [复测内置 Font Awesome 图标](P6_PUBLIC_DOCUMENT_TRIAL.zh-CN.md#alpha-39-复测)。远程图片及外部自定义图标包仍不可用。 |
| F10 | `.slides.md` 阅读、列表、全屏和静态 PDF；[Slidev 打包回归](test/slidev-e2e.test.js) | 9 个随包主题已验证；静态 PDF 不保留动画、过渡和交互。 |
| F12 | 本地 HTML 隔离视图、代码/YAML、独立图片；[HTML](test/html-file-e2e.test.js)、[源码](test/local-source-e2e.test.js)、[图片](test/image-file-e2e.test.js) | 打包自动验证类型切换和资源阻断；真实文件与目标机待验。 |
| F14 | 图片/图表放大、拖拽、按键和关闭；阅读区代码复制；[图表预览](test/reading-font-diagram-e2e.test.js)、[代码复制](test/code-copy-e2e.test.js) | Alpha 35 补齐复制入口并验证 HTML 不包含按钮；Windows 剪贴板和高 DPI 待验。 |
| F15 | 批注工具条与侧栏；[批注](test/annotations-e2e.test.js)覆盖样式、定位、合并、剪贴板和恢复 | 桌面主流程已验证；Windows 系统剪贴板和输入法待当前版本验收。 |
| F16 | 导出 → Word；[OOXML 与导出](test/e2e.test.js)、[导出快照](test/settings-e2e.test.js)、[Alpha 39 Office 补验](BUILD.zh-CN.md#2026-11-14-alpha-39-office-与-pdf-补验) | macOS Word 可见公式和表格，公式交互编辑未实测；Markdown 脚注输出为文末列表。 |
| F17 | 导出 → HTML；[离线 HTML](test/html-export-e2e.test.js)核对内嵌字体、图片、图表和移动后重开 | 代表性单文件通过，外链文件不会一并打包；Windows 待验。 |
| F19 | 导出 → PDF；A4/A5/Letter、横纵向、0–35 mm 页边距和实际成品分页预览；[纸张与分页](test/pdf-layout-e2e.test.js)、[阅读与导出独立](test/reading-layout-e2e.test.js) | Alpha 37 验证了纸张尺寸、边距引起的分页变化、长表内容和预览与保存的字节一致性；真实复杂文档和目标 PDF 阅读器仍需人工验收。 |
| F20 | 更多 → 打开 SUMMARY 目录、章节侧栏；[章节与锚点](test/reading-navigation-e2e.test.js) | 嵌套章节、刷新和跨文档跳转有证据；导出仅当前文档。 |
| F21 | 图片/图表右键及 Shift+F10；[原图和原生格式](test/image-context-menu-e2e.test.js) | 自动测试确认传给 Electron 的剪贴板位图，系统实际粘贴待目标环境验收。 |
| F22 | 表格右键 → 复制/XLSX；[表格回归](test/table-context-menu-e2e.test.js)、[Excel/WPS 补验](BUILD.zh-CN.md#2026-11-12-alpha-31-office-补验) | Alpha 31 macOS Excel/WPS 已验证代表性 XLSX 和 HTML 粘贴；Windows 实际系统剪贴板待验。 |
| F23 | 导出 → 整页 PNG；更多 → 文档资产；[整页 PNG](test/png-export-e2e.test.js)、[资产导出](test/asset-export-e2e.test.js) | 保留批量错误报告、超限和取消行为；Windows 待验。 |
| F25 | 本地 HTML → 转为 Markdown、文件菜单 → 粘贴 HTML；[转换与草稿](test/html-import-e2e.test.js) | 代表性本地相对资源通过；隔离 HTML 脚本执行和 HTML 转换是不同入口。 |
| F27 | 设置、缓存清理、最近记录；[设置](test/settings-e2e.test.js)、[语言](test/locale-e2e.test.js)、[缓存](test/platform-services.test.js) | 28 种语言均可激活，桌面专用词条目前简中和英文，其他语言缺失词条回退英文。 |
| F28 | 按编码打开、另存 UTF-8、本机资源目录授权；[文档文件](test/document-files.test.js)、[额外资源](test/resource-folders-e2e.test.js)、[资源策略](test/resource-policy.test.js) | Windows 盘符/长路径、UNC 和映射盘，以及目标机字体须在当前候选包验收。 |
| F31 | 功能矩阵、共享契约、构建与本报告 | 范围证据已核对；最终候选版本按实际共享改动范围复跑受影响宿主。 |
| F32 | 标签、会话、原生入口、主题、取消和备份；[隔离配置回退](test/profile-backup-e2e.test.js)、[资源回收](P6_DELIVERY.zh-CN.md#长文渐进渲染与循环资源回收) | Alpha 17→31→17 是 macOS 隔离配置实测；当前 Windows 候选包的离线运行、备份回退和高 DPI 待验。 |

本次核对列出的明确实现缺口已补齐。桌面入口和现有证据不表示第 10 节的人工验收和目标机条件已满足。现有 JSON 中的 `in-progress` 状态继续保留。

## 排除范围

| ID | 核对结果 |
| --- | --- |
| F11 | OpenAPI YAML 走普通源码阅读；无 API 预览或引用解析入口。 |
| F13 | Alpha 33 的共享改写会把 Wiki 语法变成链接。Alpha 34 在桌面阅读、HTML/PDF/PNG 的渲染入口和 Word 导出中禁用该改写；普通 Markdown 本地链接仍支持。 |
| F18 | 导出界面和主进程支持列表中没有 EPUB。 |
| F24 | 没有 URL 打开入口；本地链接和隔离 HTML 测试覆盖远程资源阻断。 |
| F26 | 没有在线网页浏览器或网页原位渲染入口；本地 HTML 仍走隔离预览。 |
| F29 | 启动参数仅用于本地文件交给桌面窗口；没有转换 CLI 和 CLI 运行时入口。 |
| F30 | 未找到向旧宿主发送、接收或同步未保存文档的桌面入口。 |
| F19（部分） | 通过独立窗口保存 PDF 文件；没有系统打印按钮或格式。 |
| F20（部分） | SUMMARY 导航保留；导出请求绑定一个文档版本，没有整书合并入口。 |

新增 [打包范围负例](test/delivery-scope-e2e.test.js)覆盖实际包的源码型 OpenAPI、Wiki 语法在阅读/HTML/DOCX 中保持原文、导出菜单及主进程格式拒绝。其余结合[本地 HTML](test/html-file-e2e.test.js)、[打开入口](test/open-entry-e2e.test.js)、[章节](test/reading-navigation-e2e.test.js)和桌面 IPC/菜单审查核对；未把没有命中的源码搜索当作完整行为证明。

## 导出组合

| 输入 | 实际入口 | 验收依据 |
| --- | --- | --- |
| Markdown | DOCX、PDF、单文件 HTML、整页 PNG；文档资产、图片/图表与表格菜单 | F16、F17、F19、F21–F23 的代表性用例和 Office 记录 |
| 独立图表 | DOCX、PDF、HTML、PNG；图表菜单及资产清单随引擎提供 PNG/SVG/DrawIO | F09、F21、F23；原生 SVG/DrawIO 受引擎支持限制 |
| Slidev | 静态 PDF | F10；动画、过渡和交互不随静态成品导出 |
| 独立图片 | 原格式另存、复制 PNG | F12、F21；没有整文档导出 |
| 独立 HTML | 隔离预览；转成 Markdown 后按 Markdown 导出 | F12、F25；原 HTML 不直接走 Markdown 导出 |
| 其他文本和代码 | 只读源码 | F12；没有整文档导出 |

这是入口和代表性证据核对，不等同于每种引擎、每个输入组合均已在 Windows 离线跑过。
