# 正式开发第二批：CodeMirror 编辑器与本地草稿恢复

日期：2026-11-05。分支：`feature/electron-desktop`。版本：`0.1.0-alpha.2`。

沿用用户批准的[设计 V1.0](design/PRODUCT_DESIGN.zh-CN.md)；本批修改正式应用源码，没有修改冻结的评审样稿。仍为正式产品的 Alpha 开发阶段，完整功能矩阵尚未完成。

## 已实现

- 以 CodeMirror 6 替换 textarea，提供 Markdown 高亮、行号、折叠、缩进、查找替换及撤销/重做。Ctrl+F、Ctrl+H 打开查找替换；Ctrl+Z、Ctrl+Shift+Z 撤销/重做。
- 各标签独立保存内存中的编辑状态和滚动位置；切换标签、更新预览及保存后保留撤销历史。明确放弃修改并重新载入时清空历史，避免撤销后重新带回已放弃内容。
- 编辑器配色跟随应用外观，与正文主题分开；补齐深色查找按钮和输入框，验证 960×640 最小窗口下查找面板不横向溢出。
- 修改后显示“源码已修改，点击更新预览后可导出”；旧预览不能导出新草稿，避免状态栏误报可导出。
- 草稿独立存储于 `%APPDATA%\documd-desktop\drafts\<DocumentId>.json`。每条保留文本、原路径/资源范围、原磁盘哈希、UTF-8 BOM/换行格式及暂存时间，不保存资源授权 token。
- 150 ms 防抖后，主进程验证文档 ID/修订号/大小，串行执行同目录临时写入、flush 与原子替换。成功后才显示“草稿已暂存”；草稿暂存不写源文件。
- 暂存失败时保留可编辑文本，显示“暂存失败”和具体错误，提示保存/另存；不会用“已暂存”掩盖失败。
- 重启自动恢复多标签草稿。原文件删除、目录不可用或已变化仍可取回文本；恢复草稿首次进入分栏，并提示尚未保存到源文件。外部冲突继续阻止普通保存，可另存或明确重新载入。
- 关闭窗口提供取消、保留草稿并关闭、放弃修改并关闭。保留时为全部脏文档重试暂存；关闭标签/工作区及重新载入沿用明确放弃确认，并清理对应草稿。
- 保存或另存成功后清理旧草稿；清理失败单独报告，不把成功写入的源文件显示为保存失败。若保存后恰好崩溃、旧草稿未清理，恢复时比较内容哈希，避免重复恢复已经落盘的内容。
- 上限为 32 条草稿、128 MiB JSON 总量、每份编码后 Markdown 10 MiB；达到配额拒绝新暂存并提示，不淘汰旧草稿。损坏 JSON 保留并在启动时报告。恢复优先保留草稿，必要时跳过已保存标签并提示，活动标签总量仍不超过 32。

## 实现边界

`src/editor.ts` 负责编辑器及每文档的内存历史；`src/draft-store.cjs` 负责校验、配额、队列与原子暂存；`main.cjs` 负责文档所有权、保存、恢复和关闭决策。渲染进程不能指定任意草稿文件路径，原有资源范围、离线请求策略及导出快照隔离保留。

直接依赖精确锁定为 `@codemirror/commands 6.11.1`、`lang-markdown 6.5.2`、`language 6.13.1`、`search 6.7.2`、`state 6.7.6`、`view 6.43.15`。浏览器代码打包进资产，运行应用不需要 npm 或联网。模块选择参考 [CodeMirror 官方基础示例](https://codemirror.net/examples/basic/) 与[参考文档](https://codemirror.net/docs/ref/)。

## 验证记录

最终开发入口和实际 `documd-desktop.exe` 完整回归均为 **66/66** 通过，无跳过。Windows x64 便携目录使用匹配版本且通过 SHA-256 校验的本地 Electron ZIP 完成打包。

`npm run typecheck`：项目源码 0 错误，既有 297 条源码分发 vendor 诊断仍单独报告。构建、脚本语法及 `git diff --check` 通过。最终 app.asar 的独立版本为 `0.1.0-alpha.2`，主进程/草稿存储/编辑器资产哈希与候选构建一致；打包工具未进入应用，冻结样稿哈希保持一致。

新增 `draft-store.test.js` 两个单元测试，以及 `editor-recovery-e2e.test.js` 七个子场景和父测试，共增加 10 个报告条目。真实进程退出由 Electron `app.exit(0)` 触发，绕过正常关闭处理后再次启动；文件、磁盘冲突和 JSON 均使用隔离测试目录，不涉及个人文档。

新增覆盖：原子暂存确认、串行最后编辑、重开/清理、损坏保留、身份/配额拒绝、查找替换、跨标签撤销及保存后撤销、明确重载清空历史、进程终止后的多标签恢复、外部冲突、删除源文件后另存、明确放弃、暂存目录故障、关闭重试、窗口放弃，以及过期干净会话与草稿恢复的标签上限。

截图：`test-results/desktop/{development,packaged}/recovery/editor.png`、`editor-search-dark-minimum.png`，已查看开发和最终包实际截图。完整测试输出留在 `test-results/desktop/alpha-02-{development,packaged}.log`。保留原有离线渲染、实际 DOCX/PDF 解析、沙箱、资源边界、导出取消/快照、会话、搜索、缓存和语言回归。

系统选择/确认对话框仍由测试桩返回，实际进程、界面、IPC、文件写入与导出运行真实代码。未进行干净 Windows、实际 Office、全输入法/高 DPI/读屏、长文性能验收；未重跑 Chrome/VS Code/移动端/fibjs 全套回归。

## 已知限制及后续

1. 预览仍手动更新，双向源行定位与滚动同步继续实现；未命名文档和完整编辑命令也未完成。
2. 崩溃恢复只恢复文本，不恢复撤销历史；150 ms 防抖期间及尚未确认的修改仍可能丢失。flush 和原子替换用于进程异常恢复，不承诺掉电/磁盘损坏后的完整备份。
3. 配额满或损坏草稿目前通过提示、保存/另存及明确放弃处理，尚无独立备份管理界面。异常遗留的临时文件不会自动作为已确认草稿恢复。
4. 普通保存继续采用磁盘哈希的乐观冲突检查；不是文件系统级 compare-and-swap。单实例、跨进程写入协调和完整数据备份仍待开发。
5. 本次联网安装后的 `npm --prefix desktop audit` 报告 5 项 moderate：`@electron/packager` 构建依赖链中的 asar/universal/glob/minimatch，涉及 [glob](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) 和 [minimatch](https://github.com/advisories/GHSA-g3hv-75wg-m249)。该打包工具链不进入最终 app.asar；未按 audit 建议强行降级到 packager 18。需跟进兼容修复，不能把此前离线审计结果视为当前零漏洞。
6. 批注、完整主题/设置、其他保留导出、Slidev、文件关联/拖放等继续按[开发计划](DEVELOPMENT_PLAN.zh-CN.md)推进；未将本批通过的报告数当作产品功能完成数。

运行入口：`dist/desktop/packages/documd-desktop-win32-x64/documd-desktop.exe`，需保留整个便携目录。未执行 Git 提交。
