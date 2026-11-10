# 首批开发记录：依赖基线与 desktop 独立入口

日期：2026-11-04。分支：`prototype/electron-desktop`。
实施范围依据 [修订后的本地个人版计划](DEVELOPMENT_PLAN.zh-CN.md)。

## 当前进度

已启动 P0/P1，完成独立桌面入口和基础检查链路；**P0/P1 尚未全部完成，25 项保留功能均未标记为完整交付**。

- 根目录与 desktop 的现有 package-lock 加入 Git 可追踪范围，保留已验证的依赖解析；后续安装改用 `npm ci`。本批次未整体升级依赖。全量干净安装尚未重跑。
- Windows 类型检查改为通过当前 Node 执行 TypeScript JS 入口；进程无法启动、非分类错误、项目错误均失败退出，vendor Windows 路径识别正确。
- 修复 DOCX 三处项目类型诊断：引用块单元格校验合法 Paragraph/Table；XML 导入的公式在验证 `m:oMath` 后通过窄类型边界交给段落，保留原 XML 树。MathJax 导入增加显式 `.js`，使现有公式测试可以直接在 Node ESM 下运行。
- 新增 `desktop` 平台身份；独立编译 `desktop/src/viewer.ts`，不再构建或加载 CLI adapter。未引入 OpenAPI/EPUB/整书/CLI 用户入口。
- 桌面适配采用共享 SettingsService、实际资源读取、图表渲染和 DOCX/PDF 转换；有类型检查覆盖，不再使用 CLI 的假 Chrome 平台。
- 新增受限 `desktop:state` 桥，仅允许 `markdownViewerSettings` 键、限制消息大小并校验来源；设置在 userData 下以版本化 JSON 保存，单写队列加临时文件替换。
- 注册 `desktop/test/feature-coverage.json`，保存 25 个保留功能的来源描述、阶段、状态、验收条件，以及 7 个完整排除功能 ID。功能只有部分证据时标为 in-progress。

## 已执行验证

| 检查 | 结果与边界 |
|---|---|
| `npm run typecheck` | 项目源码 0 错误；按仓库原有政策另报 297 条源码分发 vendor 诊断，未修改第三方代码、未声称整个依赖树零错误 |
| `node --import tsx/esm --test test/suites/core-markdown/docx-math-converter.test.js` | 88/88 通过，覆盖已有 LaTeX/MathML/OMML 公式场景 |
| `npm run test:desktop` | 开发入口 12/12 报告条目通过，包含 8 个 E2E 子测试、父测试和 3 个独立测试 |
| `npm run package:desktop` | Windows x64 打包成功；最终包包含 desktop-viewer.js，不再包含 browser-renderer.js |
| 最终打包 EXE 的 `npm run test:desktop` | 12/12 通过，无跳过；与开发入口使用相同测试 |
| JavaScript 语法 / `git diff --check` | 通过 |

E2E 验证本地中文路径、图片、表格、公式、Mermaid、引用块、Word/PDF 实际产物、Node 隔离、资源授权/撤销、缺图失败、源文件保护及设置重载恢复。DOCX 同时检查正文、引用块、OMML、表格和媒体；PDF 解析正文并渲染页面。新增独立测试覆盖状态并发写入/重新打开/损坏文件保护和类型检查脚本的失败退出策略。

测试仍使用系统对话框桩，未进行人工对话框和干净目标机器验收。未运行完整浏览器/移动/VS Code E2E 或完整 fibjs 单元层；共享公式测试和桌面真实导出通过不能代替这些回归。

## 可运行产物

```text
dist/desktop/packages/documd-desktop-prototype-win32-x64/documd-desktop-prototype.exe
```

保留原型名称以免混淆现有运行入口；使用时需携带整个目录。界面和打包命名将在正式桌面 UI 批次统一调整。

## 下一批的明确工作

1. 完成保留功能的输入/输出能力组合基线、干净锁文件安装验证和第三方诊断固定记录，继续关闭 P0 待办。
2. 将图表渲染和导出准备从前台页面拆分；加入 ElectronTransport、任务 ID/版本、超时取消和宿主崩溃恢复，完成 P1 的关键隔离链路。
3. 补齐通用消息、实际 i18n、持久化阅读状态、缓存及其统计；当前这些接口仍为基础实现，不能当成完整功能。
4. 落实被排除能力的共享引擎开关与资源裁剪。共享 Viewer 内已有的自动 wikilink 等逻辑尚未全面关闭；不能只凭没有菜单宣称所有排除能力均已禁用。
5. 在以上基础上开始 P2 多文件/工作区/编辑，以及 P3 设置界面和批注。当前设置已可持久化，但尚无完整设置 UI。

保留原型验证记录作为历史证据，以本记录和覆盖清单描述当前开发状态。尚未对完整版或各阶段整体作通过声明。
