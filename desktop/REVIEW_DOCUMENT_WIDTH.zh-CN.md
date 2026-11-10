# 指定评审文档的宽度复核

日期：2026-11-06。版本：`0.1.0-alpha.10`。分支：`feature/electron-desktop`。

## 实际原因

本次直接只读打开用户指定的原始 Markdown，检查“1. 3.3 问题记录表”下的原生六列表格，而非仅使用生成夹具。

发现常用便携目录 `dist/desktop/packages/documd-desktop-win32-x64` 仍为 Alpha 7，用户运行进程的路径也来自此目录。该实际 EXE 在隔离配置中打开同一原文档时，目标表格宽约 **1149.6 px**，正文宽约 **716.7 px**，最后一列越过正文边界约 **432.4 px**，真实复现了用户反馈。

Alpha 9 独立目录中的实际 EXE 对同一表格测得表格及正文均约 **716.7 px**。但在窄分栏下，文档其他位置的长代码标识符仍会把整个阅读区撑宽（阅读区约 349 px、横向内容约 509 px），故补充 Alpha 10：桌面正文继承 `overflow-wrap: anywhere`，让表格之外的长标识符也按可用宽度换行。没有隐藏或裁切正文。

不同版本使用同一数据目录及单实例锁；旧版运行时启动另一个版本，会回到已有窗口，不能据此认为已切换到新版本。必须先保存并正常退出旧版，再启动修复版。

## 验证

新增 `desktop/test/review-table-width-e2e.test.js`：默认使用生成的六列十三行内容，包含 `<br>`、内联代码和表格外长标识符；本地可通过 `MV_DESKTOP_WIDTH_DOCUMENT` 指定原文档只读复核。未将用户文档内容复制到仓库测试夹具。

原文档验证检查目标表格的 13 行、6 列、27 个换行与 116 个内联代码节点；正常阅读、窄窗口、窄分栏均检查 table、末列和阅读区的横向边界。读取前后比较源文件 SHA-256，不修改原文档。Alpha 10 开发入口与实际 EXE 的原文档场景均通过：三个布局下 table 与正文宽度分别约为 716.7、552.8、212.5 px，最后一列均位于正文范围内；窄分栏阅读区宽度及横向内容均为 349 px。已查看实际 EXE 的原文档阅读、分栏截图。

完整开发入口与实际 EXE 回归均 **113/113** 通过，无失败或跳过。包内版本与七项关键运行资产哈希均与最终构建一致，冻结设计样稿哈希未变，`git diff --check` 通过。

原文档日志、测量与截图位于忽略目录 `test-results/desktop/review-table/` 及 `test-results/desktop/{development,packaged}/review-table/`。完整回归日志：`test-results/desktop/review-width-{development,packaged}.log`。

## 交付

独立修复版：`dist/desktop/packages/0.1.0-alpha.10/documd-desktop-win32-x64/documd-desktop.exe`。常用原目录需在旧版正常退出后更新，避免继续进入 Alpha 7；不会强制终止有未保存文档的用户进程。本轮最终检查旧版进程仍存在，因此尚未覆盖原常用目录，已请求用户保存并正常退出。

冻结设计样稿未修改。未执行 Git 提交。
