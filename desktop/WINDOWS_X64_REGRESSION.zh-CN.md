# Windows x64 源码同步、便携包与回归手册

当前候选为 **`0.1.0-alpha.39`**，锁定 Electron **45.2.2**。2026-11-17 至 18 已在本机完成 Windows 打包、227/227 回归、真实剪贴板修复复验及拼音组字检查，用户手动确认「打开方式 → 仅一次」及重复打开全部通过，详见 [Windows 本机验收记录](WINDOWS_X64_ACCEPTANCE.zh-CN.md)。干净目标机断网仍待验证。此前 [Alpha 17 Windows x64 的 150/150](BUILD.zh-CN.md#2026-11-11-alpha-17-界面语言) 为历史证据。完整交付条件见 [P6 交付检查](P6_DELIVERY.zh-CN.md)。

## 1. 从 Mac 同步源码

在 Mac 仓库根目录运行。脚本归档**当前工作区**的源码，包含本次修改及允许的未跟踪源码、测试和文档，排除依赖、构建产物、日志及可选子模块 `docs`、`skills`。

```zsh
node desktop/scripts/package-source.js
cd dist/desktop/handoff
shasum -a 256 -c documd-0.1.0-alpha.39-source.tar.gz.sha256
tar -tzf documd-0.1.0-alpha.39-source.tar.gz | grep -Fx 'desktop/WINDOWS_X64_REGRESSION.zh-CN.md'
```

将 `.tar.gz`、`.tar.gz.sha256` 和同版本 `-source.json` 一起复制到 Windows 的「下载」。在 PowerShell 验证校验值并解压到新目录：

```powershell
$version = '0.1.0-alpha.39'
$archive = Join-Path $env:USERPROFILE "Downloads\documd-$version-source.tar.gz"
$expected = ((Get-Content -LiteralPath "$archive.sha256" -TotalCount 1) -split '\s+')[0]
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash -ne $expected) {
    throw '源码包 SHA-256 不一致'
}
$repo = "C:\work\documd-$version"
if (Test-Path -LiteralPath $repo) { throw "请使用新的源码目录：$repo" }
New-Item -ItemType Directory -Path $repo | Out-Null
tar.exe -xzf $archive -C $repo
if ($LASTEXITCODE -ne 0) { throw '源码解压失败' }
Set-Location $repo
$actual = (Get-Content .\desktop\app-manifest.json -Raw | ConvertFrom-Json).version
if ($actual -ne $version) { throw "源码版本不符：$actual" }
```

## 2. 在 Windows x64 构建便携包

退出正在运行的旧版 docu.md Desktop。构建机使用 Node.js 24，架构应输出 `win32 x64`。最终目标机只需整个便携目录，无需 Node.js、Chrome 或开发依赖。

```powershell
$version = (Get-Content .\desktop\app-manifest.json -Raw | ConvertFrom-Json).version
node --version
node -p "process.platform + ' ' + process.arch"
npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw '根目录依赖安装失败' }
npm.cmd --prefix desktop ci
if ($LASTEXITCODE -ne 0) { throw '桌面依赖安装失败' }

New-Item -ItemType Directory -Force .\test-results | Out-Null
cmd.exe /d /c 'npm.cmd run package:desktop > test-results\desktop-win-x64-package.log 2>&1'
$packageExit = $LASTEXITCODE
Get-Content .\test-results\desktop-win-x64-package.log -Encoding UTF8 -Tail 25
if ($packageExit -ne 0) { throw "打包失败，退出码 $packageExit" }
```

日志应包含 `Packaging docu.md Desktop 0.1.0-alpha.39 for win32-x64 (Electron 45.2.2)`。下载 Electron 失败时，可将官方 `electron-v45.2.2-win32-x64.zip` 原样放入 `C:\cache\electron`，设置 `$env:DOCUMD_ELECTRON_ZIP_DIR = 'C:\cache\electron'` 后重跑打包。脚本校验 ZIP 的 SHA-256。完成后可用 `Remove-Item Env:DOCUMD_ELECTRON_ZIP_DIR` 清除临时设置。

生成便携 ZIP 和校验文件。不要单独复制 EXE，ZIP 内应包含 EXE、DLL、`resources` 和 `locales`。

```powershell
$packages = (Resolve-Path .\dist\desktop\packages).Path
$portable = 'documd-desktop-win32-x64'
$exe = Join-Path $packages "$portable\documd-desktop.exe"
$asar = Join-Path $packages "$portable\resources\app.asar"
if (!(Test-Path $exe -PathType Leaf) -or !(Test-Path $asar -PathType Leaf)) { throw '便携目录不完整' }
$zip = Join-Path $packages "documd-$version-win32-x64-portable.zip"
if (Test-Path -LiteralPath $zip) { throw "请先移走旧 ZIP：$zip" }
tar.exe -a -c -f $zip -C $packages $portable
if ($LASTEXITCODE -ne 0) { throw '便携 ZIP 创建失败' }
"{0}  {1}" -f (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLowerInvariant(), (Split-Path -Leaf $zip) |
    Set-Content -Encoding ascii -LiteralPath "$zip.sha256"
tar.exe -tf $zip | Select-String 'documd-desktop.exe|resources/app.asar|locales/'
```

## 3. 在构建机用打包 EXE 跑自动回归

在可见且解锁的 Windows 桌面执行。测试使用隔离配置；无需对测试弹出的应用窗口进行操作。步骤只在安排目标机回归时执行。

```powershell
$env:MV_DESKTOP_EXECUTABLE = $exe
try {
    cmd.exe /d /c 'npm.cmd run test:desktop > test-results\desktop-win-x64-test.log 2>&1'
    $testExit = $LASTEXITCODE
} finally {
    Remove-Item Env:MV_DESKTOP_EXECUTABLE
}
Get-Content .\test-results\desktop-win-x64-test.log -Encoding UTF8 -Tail 25
"Test exit code = $testExit"
```

通过条件：退出码为 0，报告中 `pass = tests`，`fail`、`cancelled`、`skipped` 均为 0。使用当前源码和包的实际计数；不要用旧 Alpha 的通过数作为验收依据。日志失败时保留首个失败及完整堆栈。

## 4. 在干净 Windows x64 目标机做实际操作

先校验便携 ZIP，完整解压，断网。把 `$exe` 设为解压后 EXE 的完整路径。可先用新配置与合成文档，避免改变日常配置：

```powershell
$version = '0.1.0-alpha.39'
$smoke = Join-Path $env:TEMP ("documd-$version-smoke-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $smoke | Out-Null
$md = Join-Path $smoke '中文 回归.md'
@'
# 中文回归

这段文字用于检查预览、批注和草稿恢复。

| 项目 | 结果 |
| --- | --- |
| Windows x64 | 待验证 |
'@ | Set-Content -LiteralPath $md -Encoding UTF8
$profileArg = '--user-data-dir="{0}"' -f (Join-Path $smoke 'profile')
$md
Start-Process -FilePath $exe -ArgumentList $profileArg
```

| 操作 | 观察 |
| --- | --- |
| 设置确认版本；切换中英文和一种回退语言 | 标题/菜单切换、中文路径可打开、重启后语言保留。 |
| 用原生选择框、多选、拖放、打开文件夹 | 目标文件正确打开；取消与失败不破坏当前会话；目录可分页、搜索可取消。 |
| 关闭工作区并重启；从「最近打开 → 最近工作区」重新打开；给两个 Markdown 选不同文档模式后切换并重启 | 工作区重新出现在文件树，未自动重开其标签；两个文档分别恢复所选模式，清空最近记录不关闭当前工作区或标签。 |
| 使用输入法编辑；添加批注；调整缩放和全屏 | 不破坏未保存文字；阅读与编辑状态可恢复；高 DPI 下控制可用。 |
| 退出时选择保留草稿，再用同一参数启动 | 草稿、设置、会话和批注恢复，磁盘源文件未被草稿覆盖。 |
| 代表性导出与粘贴 | 用本机 Word/WPS、Excel/WPS 和 PDF 阅读器打开产物，核对公式、合并表格、图表和分页；同时验证 HTML/PNG 与图片/表格粘贴。 |
| 导出 → PDF，选择 A5 横向和 22 毫米页边距，生成分页预览后保存；再换回 A4 纵向和 12 毫米 | 预览可翻页，保存文件与预览页数一致；纸张、边距和分页随选项改变，长表末行和图表仍可见。 |
| 按 [P6 备份回退步骤](P6_DELIVERY.zh-CN.md#独立配置的备份与回退)演练 | 备份配置及源文件；用独立副本升级，再用升级前备份配合旧包恢复。 |

应用不会修改默认文件关联。只验证启动入口时，从资源管理器右键 Markdown 文件，通过「打开方式」选择便携目录里的 EXE，使用仅此次打开的选项。如主动设为默认，可在 Windows 默认应用设置中重新选择 `.md`、`.markdown` 的原应用来撤销。只有手动改过关联时才需要恢复。

日常配置位于 `%APPDATA%\documd-desktop`。备份前退出所有实例，另行备份源文件。准备正式试用时，在本机选择真实文档并只记录现象，不上传正文。

## 5. 回传或归档结果

保留打包日志、全量测试日志、版本/架构和便携 ZIP 的 SHA-256，记录 Windows 版本、是否断网、是否安装开发依赖、Office/PDF 软件版本和手动结果。未运行的项目标为「未验证」，不沿用旧版本结论。失败截图请只截测试内容。
