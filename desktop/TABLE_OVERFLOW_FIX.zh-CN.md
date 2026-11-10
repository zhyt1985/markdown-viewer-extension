# 宽表格溢出修复

后续修正：本版本只限制了局部滚动区域，表格自身仍可能比正文宽。用户反馈后已在 [Alpha 9 表格适配记录](TABLE_WIDTH_FIT.zh-CN.md) 补充表格宽度约束与相应验收，本记录保留为历史验证边界。

日期：2026-11-06。版本：`0.1.0-alpha.8`。分支：`feature/electron-desktop`。

## 原因与行为

真实 Electron 窗口中，16 列含连续标识符的 Markdown 表格在约 724 px 的正文宽度下产生约 5040 px 内容宽度。原生 `display: table` 的最小列宽可以突破 `max-width: 100%`，原有 `overflow: auto` 放在 table 本身未能限制溢出，导致整块阅读区横向扩张。

修复在桌面阅读主机完成渲染后，为表格增加受正文宽度限制的局部滚动容器。表格保留原生行列语义、自然宽度、左对齐/居中/通栏布局；宽表可拖动底部滚动条，也可聚焦后用左右方向键查看。窗口缩放、分栏及实时预览均重新适应可用宽度。不缩小表格字体或裁去列。

包装只应用于 `documd://viewer` 的阅读 DOM；独立导出主机和共享主题规则保持原逻辑，源文件内容不因修复发生修改。冻结设计样稿未修改。

## 验证

新增 `desktop/test/table-overflow-e2e.test.js`，覆盖页面/阅读区几何边界、键盘滚动、末列可达、窄表三种对齐、窗口缩放、分栏、实时预览与源文件字节保留。修复前真实窗口可稳定复现宽度溢出；修复后针对性测试 5/5 通过。

最终 Alpha 8 开发入口与实际打包 EXE 完整回归均 **111/111** 通过，无失败或跳过，包含已有 DOCX/PDF、编辑、草稿恢复和章节导航场景。项目源码类型检查 0 错误；既有源码分发 vendor 包中的 297 条诊断单独报告。`git diff --check` 通过，包内版本及七项关键运行资产哈希与最终构建一致，冻结样稿哈希未变。

日志：`test-results/desktop/table-fix-{development,packaged}.log`；类型检查：`test-results/desktop/table-fix-typecheck.log`；截图：`test-results/desktop/{development,packaged}/table-overflow/{reading,split}.png`。已查看开发入口及打包 EXE 的阅读/分栏截图，确认滚动条位于表格内部，正文纸张和小表显示正常。

旧便携目录被运行中的应用锁定，本轮使用独立版本目录交付，未终止用户正在使用的应用：`dist/desktop/packages/0.1.0-alpha.8/documd-desktop-win32-x64/documd-desktop.exe`。运行需保留整个目录；重新启动此版本后生效。不同版本共用原有个人数据目录，使用前先保存文档并正常退出旧版。

本轮自动化使用生成的本地宽表夹具，未取得用户报告所涉原文档。实际系统文件对话框由测试桩返回；人工目标环境验收及此前登记的其他 Alpha 功能缺口仍按开发计划推进。未执行 Git 提交。
