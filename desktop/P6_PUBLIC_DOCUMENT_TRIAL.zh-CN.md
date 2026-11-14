# P6 公开文档试用 · Alpha 37

2026-11-13，使用 macOS arm64 的 Alpha 37 打包应用和隔离配置，下载并打开 10 份项目外的公开文档。文件选择及保存位置由自动化代填。原始文件前后 SHA-256 一致；试用期间未主动断开操作系统网络，未运行 Windows x64。

| 编号 | 公开来源 | 原版试用结果 |
| --- | --- | --- |
| N01 | [tldr 中文 Git 速查](https://github.com/tldr-pages/tldr/blob/main/pages.zh/common/git.md) | 中文、列表和内联代码可读。 |
| N02 | [Microsoft 工程决策记录指南](https://github.com/microsoft/code-with-engineering-playbook/blob/main/docs/design/design-reviews/decision-log/README.md) | 阅读及单文件 HTML 导出成功；检查了文件结构。 |
| N03 | [TypeScript Handbook：Everyday Types](https://github.com/microsoft/TypeScript-Website/blob/v2/packages/documentation/copy/en/handbook-v2/Everyday%20Types.md) | 38 个代码块、1 张图；PDF 19 页，DOCX 包结构通过校验。 |
| N04 | [Rust RFC 2005](https://github.com/rust-lang/rfcs/blob/main/text/2005-match-ergonomics.md) | 长篇设计提案和代码块可读；PDF 13 页，末页可读。 |
| N05 | [GitHub Flavored Markdown 规范源文件](https://github.com/github/cmark-gfm/blob/master/test/spec.txt) | 下载内容原样使用，扩展名换为 `.md`；PDF 195 页，抽查末页。 |
| N06 | [Emoji Cheat Sheet](https://github.com/ikatyang/emoji-cheat-sheet/blob/master/README.md) | 100 张表、945 行表体已经渲染；远程 SVG 徽章被阻止，原版未通过导出前检查。 |
| N07 | [Mermaid 流程图官方文档](https://github.com/mermaid-js/mermaid/blob/develop/docs/syntax/flowchart.md) | 98 张图成功加载，18 条渲染诊断；日志确认触发图表队列上限，原版无法完成导出。 |
| N08 | [Mermaid 时序图官方文档](https://github.com/mermaid-js/mermaid/blob/develop/docs/syntax/sequenceDiagram.md) | 35 张图成功加载，3 条渲染诊断；至少两条来自带角色链接菜单的图，报告 SVG 转图失败。 |
| N09 | [Slidev 官方 Starter](https://github.com/slidevjs/slidev/blob/main/demo/starter/slides.md) | 演示可打开；报告 8 处资源不可用，按离线策略禁止导出原版。 |
| N10 | [RFC Editor：RFC 8259](https://www.rfc-editor.org/rfc/rfc8259.html) | 下载为本地 HTML 后，独立视图可见且正文标题正确；未逐条验证链接。 |

**原样试用：6/10 完整通过所选场景。** N06 和 N09 需本地化外部资源；N07 和 N08 是需进一步处理的图表兼容问题。

- **N06 本地副本**：只去掉一行远程徽章，表格内容不变。PDF 共 72 页；抽查第 35、72 页，表头和末行可见。同一表格经打包应用的导出处理程序生成有效 XLSX；自动化右键菜单操作超时，该入口在此样本上未确认。
- **N09 本地副本**：复制官方图像和引用页，图像 URL 改为相对路径。资源诊断归零，生成 16 页静态 PDF，尺寸约 16:9。抽查首尾页，发现封面标题正常，但背景图未进入 PDF；资源诊断归零不足以证明视觉完整。

共生成 8 份可读取产物：5 份 PDF、1 份 DOCX、1 份 HTML、1 份 XLSX。PDF 用 Poppler 检查页数、纸张及部分页面；Office 产物只核对包结构。本轮采用公开文档，无需准备或传输私人文档。

本机证据：`test-results/desktop/alpha37-public-documents/`，包括原版结果 `run.log`、本地副本结果 `local-assets.log`、`slidev-final.log`、`xlsx-action.log` 和十份原始输入的 `samples.json`。只随源码包交接报告，不分发下载文件、导出产物或应用配置。

## Alpha 38 复测

| 样本 | 结果 |
| --- | --- |
| N07 Mermaid 流程图 | 原版从 98 张图增至 **115 张**，没有队列满错误。仅剩第 1131 行依赖远程图片的图不可渲染。把该节点改为文字的离线副本 **116 张图全部加载**，零诊断，导出 63 页 PDF。应用继续阻止远程资源。抽查页中，依赖外部 Font Awesome 的图标未显示。 |
| N08 Mermaid 时序图 | 原版 **38 张图全部加载**，零诊断，导出 42 页 PDF。抽查了带角色链接菜单的时序图所在页；PDF 保留静态图形。 |
| N09 Slidev | 复用本地资源副本，导出 16 页 PDF。封面背景出现在渲染结果中，PDF 第一页含原尺寸 1920 × 1080 图像。未逐一比对与官网的排版及动态效果。 |
| N06 Emoji Cheat Sheet | 本地副本通过两条路径保存了同一张表的 XLSX：聚焦表格后按 `Shift+F10`，以及表格滚动停止后右键点击表头。两份 XLSX 包结构均有效。 |

日志：`test-results/desktop/alpha38-public-retest.log`、`alpha38-public-local.log`、`alpha38-public-xlsx.log`、`alpha38-public-mouse.log`。复测继续使用 macOS arm64 打包应用、隔离配置；未复测 Windows x64。

## Alpha 39 复测

N07 离线副本仍为 116 张图、零诊断、63 页 A4 PDF。对照 Alpha 38 检查第 60 页：原先空白的 Twitter、禁用、加载和相机图标已显示。打包测试同时从 SVG 核对了 `fa`、`fas`、`far`、`fab` 标签和 `icon: "fa:user"` 图标节点的矢量路径。桌面打包内置 Font Awesome 5 Free 图标，付费图标和自定义在线图标包不在此次支持范围内。

原版仍只在第 1131 行引用远程图片的图表失败，115 张图可显示；应用不向外获取该图片。日志：`test-results/desktop/alpha39-public-local.log`、`alpha39-public-original.log`。
