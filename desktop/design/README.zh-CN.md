# 正式产品界面设计 V1.0

当前状态：**R0.1 已通过用户评审，冻结为 V1.0**。见 [批准记录](APPROVAL.zh-CN.md)。保留原样稿供实现对照，现开始正式工程界面开发。

## 查看

直接打开 [index.html](index.html)，无需安装、联网或构建。也可以通过项目已安装的 Electron 预览：

```powershell
.\desktop\node_modules\.bin\electron.cmd .\desktop\design\preview.cjs
```

顶部“审阅场景”是设计评审工具，正式产品不包含这一行。可切换阅读、分栏编辑、检索、批注、冲突和首次打开。界面内的文件/菜单/导出/设置也可点击；右上角可以切换深浅外观。

所有内容都是演示数据。样稿不访问实际工作区，不保存文件或剪贴板，不接入生产 Electron IPC，也不调用远程资源。模拟保存、批注和导出只改变本页状态，刷新页面恢复初始数据。

## 设计与截图

- [完整产品设计规范](PRODUCT_DESIGN.zh-CN.md)：信息架构、视觉 token、窗口适配、流程/状态、25 项保留功能入口和设计冻结条件。
- [日常阅读](previews/01-reading-light.png)
- [分栏编辑](previews/02-split-editing.png)
- [检索](previews/03-search.png)
- [批注](previews/04-annotations.png)
- [导出](previews/05-export-dialog.png)
- [外部修改对比](previews/07-conflict-comparison.png)
- [深色设置](previews/08-settings-dark.png)
- [深色阅读](previews/09-reading-dark.png)
- [首次打开](previews/10-welcome.png)
- [960px 窗口](previews/11-reading-960.png)

## 样稿检查

```powershell
node --test desktop/design/review.test.js
```

该命令使用 Node/Playwright 直接启动真实 Electron 页面，生成截图和 [检查记录](previews/review-results.json)。9 个子检查与父测试合计 10/10 报告条目通过，无跳过；属于设计样稿检查，不是产品功能、原生系统对话框或目标机器验收。

请重点评审整体视觉与密度、阅读/编辑布局、功能入口是否易找，以及保存/冲突/导出的交互。当前按“简洁阅读优先”形成首稿，偏好仍可调整。
