# Alpha 39 macOS arm64 候选包

本次交接对象是 Apple 芯片 Mac 上的本地试用包，版本为 `0.1.0-alpha.39`（Electron `45.2.2`）。Windows 打包和实机验收按本轮安排跳过；原开发计划中的 Windows 正式交付条件继续单独记录。

在仓库的 `dist/desktop/handoff` 可找到以下文件：

| 文件 | 用途 |
| --- | --- |
| `documd-0.1.0-alpha.39-macos-arm64.zip` | 含完整的 `documd-desktop.app`，运行时不需要另装 Node.js 或 Chrome |
| `documd-0.1.0-alpha.39-macos-arm64.zip.sha256` | 二进制 ZIP 校验文件 |
| `documd-0.1.0-alpha.39-macos-arm64.json` | 文件大小、SHA-256、签名和测试记录 |
| `documd-0.1.0-alpha.39-source.tar.gz` | 同版本源码与文档，另有独立校验文件和版本清单 |

在 ZIP 所在目录运行：

```bash
shasum -a 256 -c documd-0.1.0-alpha.39-macos-arm64.zip.sha256
ditto -x -k documd-0.1.0-alpha.39-macos-arm64.zip alpha39-macos
codesign --verify --deep --strict alpha39-macos/documd-desktop.app
```

保留完整的 `.app`。需要与日常配置分开试用时，从解压目录启动：

```bash
trial_profile=$(mktemp -d "${TMPDIR:-/tmp}/documd-alpha39-profile.XXXXXX")
"$PWD/alpha39-macos/documd-desktop.app/Contents/MacOS/documd-desktop" "--user-data-dir=$trial_profile"
```

候选包采用本地临时签名（ad hoc），未经过 Apple Developer ID 签名及公证。在当前 Mac 上验证了签名完整性；从网络下载到另一台 Mac 的 Gatekeeper 首次启动流程未验。Intel Mac 未纳入。

在 macOS 26.7.1 arm64 使用 ZIP 解压后的应用进行全量回归，**227/227 通过**，无失败、取消或跳过。另用隔离配置复测同版本恢复及 Alpha 17 → Alpha 39 → Alpha 17 回退，**2/2 通过**。验证未断开系统网络，也未使用没有开发依赖的另一台机器。日志文件名见版本清单。

[使用和快捷键](README.md)、[备份与回退](P6_DELIVERY.zh-CN.md#独立配置的备份与回退)、[公开文档试用](P6_PUBLIC_DOCUMENT_TRIAL.zh-CN.md)和 [Office/PDF 补验](BUILD.zh-CN.md#2026-11-14-alpha-39-office-与-pdf-补验)仍可沿用。正式配置和源文件分别备份，旧版回退使用升级前的配置副本。
