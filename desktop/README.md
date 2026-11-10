# docu.md Desktop · Alpha development

Electron development build for an independently runnable local Markdown viewer.
The Windows x64 development app and packaged EXE have both been exercised locally.
The current development version is **0.1.0-alpha.7**, on `feature/electron-desktop`.
It is the formal product implementation in progress, not a stable release.

The user approved [product design V1.0](design/PRODUCT_DESIGN.zh-CN.md).
See its [approval record](design/APPROVAL.zh-CN.md), the retained
[interaction mockup](design/index.html), and [first Alpha implementation report](ALPHA_01.zh-CN.md) and
[Alpha 2 editor/recovery report](ALPHA_02.zh-CN.md) and
[Alpha 3 live preview/source mapping report](ALPHA_03.zh-CN.md) and
[Alpha 4 desktop-open report](ALPHA_04.zh-CN.md) and
[Alpha 5 untitled-document report](ALPHA_05.zh-CN.md) and
[Alpha 6 reading-navigation report](ALPHA_06.zh-CN.md) and
[Alpha 7 book-panel report](ALPHA_07.zh-CN.md).
The mockup uses synthetic data. The running app uses actual selected local files.

For earlier implementation history, see the
[sixth implementation batch](BATCH_06.zh-CN.md) for source editing, checked saves,
external file monitoring and conflict handling. The [fifth batch](BATCH_05.zh-CN.md), [fourth batch](BATCH_04.zh-CN.md),
[third batch](BATCH_03.zh-CN.md), [second batch](BATCH_02.zh-CN.md), [first batch](BATCH_01.zh-CN.md) and
[prototype report](VALIDATION.md) describe earlier states.

## Run the Windows application

After building or receiving the portable directory, double-click:

```text
dist/desktop/packages/documd-desktop-win32-x64/documd-desktop.exe
```

Keep the entire portable directory together. The EXE is not a single-file bundle.
The packaged app includes Electron/Chromium and its assets; users do not need
Node.js, Chrome, a browser extension, or a rendering server installed.

Choose **新建文档** on the welcome page, use **文件 → 新建文档**, or press
Ctrl+N to start an untitled Markdown document. Blank and edited untitled tabs
are locally recoverable, including after a process crash. **保存** on an untitled
document opens the native save dialog; canceling keeps its identity and text.
First save preserves editor undo/redo and migrates reading position to the real
file. Untitled documents have no implicit resource directory: save before using
relative local images. Only saved files enter recent-file history.

Choose **打开文件** (multiple selection supported), or **打开文件夹** and select a
Markdown file in the lazy directory tree. You can also drop local Markdown files
and folders anywhere in the main window, including the source editor. Files open
as tabs; folders become workspaces. Dropped files are not inserted into the draft.
Reopening a file reuses its tab and keeps unsaved edits.
Windows **Open with** can pass a local file to the EXE. A second launch using the
same profile forwards its files to the existing window and exits. Requests arriving
during editing, loading or a native dialog wait for the editor to flush; canceling
a close confirmation resumes pending requests. This build does not register or
change the system default file association. Exit older versions before upgrading;
older Alpha builds do not participate in the new instance lock.

Use the toolbar arrows or Alt+Left/Right to revisit open documents and restore
each visit position. Navigation keeps current draft text. Relative Markdown links
and heading fragments open inside the current canonical resource scope.
**文档菜单 → 打开 SUMMARY 目录** opens SUMMARY.md from that scope root; nested
chapter lists use the same local-link handling. Choose the activity rail **章节目录** for a persistent nested chapter list, current
chapter marker and previous/next controls. Chapter paths resolve from SUMMARY.md
at the current resource-scope root. **刷新目录** reads the latest disk content or
the open SUMMARY draft without saving it. Missing/invalid directories show an
explicit empty state. The directory is limited to 256 KiB, 500 entries and 24
structural levels; links still pass host scope checks.
History is limited to 100 in-memory
visits and drops closed tabs. URLs, absolute paths and out-of-scope targets are rejected.

File/open commands are in the **文件** menu. The activity rail switches files,
workspace search and recent records. Language and cache controls are in **设置**.
Tabs can be switched and closed. Each workspace has refresh/close controls;
closing it also closes its associated tabs. Choose **导出**, select Word or PDF,
then choose the system save location. **导出任务 → 取消导出** stops
the active export. Another file can be opened while exporting; output remains
bound to the source document and settings captured when export started. The build is
deliberately offline: remote images, remote fonts and external navigation are
blocked. A directly selected file can read images in its directory; workspace
documents may use parent-relative images within the selected workspace root. Markdown input is
UTF-8, with a current limit of 10 MiB.
The language selector loads bundled translations. Cache controls show usage and
clear disposable cached data. Restarting restores workspaces, document tabs, the
active document and its saved scroll position. Missing or invalid paths are skipped
with a visible warning. The sidebar provides up to 20 recent files and a clear-history
action; clearing history keeps open tabs and reading settings.
Choose a workspace and search filenames or body text. Matching is literal and case
insensitive; results include relative paths, source line numbers and snippets. Clicking
a result opens its tab and highlights the corresponding rendered block. Cancellation
or changing the query discards stale results.
This batch previews Markdown only. Other file types appear disabled in the tree,
and symbolic-link entries are not expanded. At most 32 documents can be open;
directory listing is limited to 2000 entries per folder. Search is bounded to 10000
entries, 2000 Markdown files, 64 MiB of content, 32 nested directory levels and 200
results; limit hits and skipped entries are reported.

Choose **分栏** for the basic source editor alongside the preview, or **源码** for
source only. Live preview updates about 450 ms after the last edit, while
you can keep typing or switch tabs. Composition events pause preview until text
entry finishes. **更新预览** remains available for manual refresh; export is disabled
while the displayed preview is stale or rendering.
**保存** writes the current file; **另存为** writes a copy and switches the tab to
that copy. Ctrl+S saves, Ctrl+Shift+S opens Save As, and Ctrl+R reloads from disk.
Saving preserves UTF-8 BOM and CRLF/LF style. Files with invalid UTF-8 are rejected
without replacing the active document. CodeMirror 6 provides line numbers, Markdown highlighting, folding,
Ctrl+F/Ctrl+H find/replace, and per-tab undo/redo (also retained after Save).
Confirmed draft updates are atomically persisted separately under userData/drafts.
After a process crash, drafts reopen automatically, including text whose source
was deleted. The first display of a recovered draft opens split mode. Window close
offers cancel, keep drafts, or discard; closing a tab/workspace or reloading asks
before discarding. Undo history is in memory; recovery restores text, not history.

Loaded source files are polled for external changes. Clean active documents refresh
automatically; uncheck **自动刷新** to pause. Dirty drafts are retained and show a
disk-change warning. Save rejects a changed/deleted source; use Save As, or explicitly
reload and discard the draft. Monitoring currently covers source files, not referenced
images or other local dependencies. Split mode synchronizes scrolling by source
line and rendered block, with approximate positions inside tables, formulas and
diagrams. Double-click plain preview text to reveal its source; double-click source
or use **定位预览** to reveal the matching preview block. The document menu also
provides **定位当前段落源码**. Stale previews cannot be used for line mapping.
**设置 → 编辑与预览** lets you independently disable live preview and synchronized
scrolling; these preferences persist independently of appearance. Draft backup is debounced
by 150 ms; edits not yet acknowledged may be lost during an abrupt exit. Backup
failure is shown explicitly while the text remains editable. Source Save and Save As
remain separate actions. Draft limits are 32 records, 128 MiB total JSON, and 10 MiB
per encoded Markdown document; reaching a limit does not evict older drafts.
Corrupt draft files are preserved and reported at startup. This is local recovery,
not a backup against disk loss.

## Build and test

Use Node.js 24+ on the build machine. From the repository root:

```powershell
npm ci
npm --prefix desktop ci
npm run desktop
```

The first launch may download the pinned Electron runtime. To build and package:

```powershell
npm run package:desktop
```

When network downloads are unavailable, an existing matching Electron ZIP can
be supplied explicitly (use its containing directory):

```powershell
$env:DOCUMD_ELECTRON_ZIP_DIR = 'C:\cache\electron'
npm run package:desktop
Remove-Item Env:DOCUMD_ELECTRON_ZIP_DIR
```

The script verifies the ZIP's SHA-256 against the checksums bundled with the
pinned Electron package before using it. It does not accept a mismatched ZIP.

This packages for the build machine's operating system and architecture. Only
Windows x64 was validated. No signing credentials or installer are required for
the prototype's portable directory.

Development E2E (opens an actual Electron window):

```powershell
npm run build:desktop
npm run test:desktop
```

Packaged E2E:

```powershell
$env:MV_DESKTOP_EXECUTABLE = (Resolve-Path 'dist/desktop/packages/documd-desktop-win32-x64/documd-desktop.exe').Path
npm run test:desktop
Remove-Item Env:MV_DESKTOP_EXECUTABLE
```

Tests use Node's test runner and Playwright directly. Native file dialogs are
stubbed in the test process, while the real renderer, IPC, filesystem writes,
DOCX exporter and Chromium PDF printing run normally. There is no test-only
backdoor in the packaged app.

## Implementation boundary

- `desktop/src/viewer.ts` is the desktop browser entry, compiled directly from
  shared Markdown, theme, diagram and DOCX engines. The desktop build no longer
  loads or builds the CLI browser adapter. It removes the obsolete CLI bundle
  from its output directory.
- `src/main.cjs` supplies windows, native dialogs, resource grants, diagram RPC,
  export tasks and native PDF/file saves. The foreground preload exposes narrow
  open/export/cancel/state/render/service methods and a filtered service event
  subscription. The export preload exposes only render.
- The adapter uses the `desktop` platform identity and is checked against
  `PlatformAPI`. Settings use the shared SettingsService and a restricted host
  storage bridge, serialized and atomically persisted under userData. ElectronTransport
  connects the shared ServiceChannel, StorageService, CacheService and FileStateService
  to validated host operations. Reading positions persist by stable document ID.
  Disk cache has version isolation, LRU/size limits and corruption recovery.
  All 28 registered locale files are bundled; toolbar translation is available,
  while full UI translation and reading layouts remain in development.
- Workspace entries are opaque IDs with canonical root checks on listing and
  opening. Removing a workspace revokes its foreground grants; an existing
  export retains its own temporary grant until it completes or is canceled.
- Versioned session and recent-file records share the atomic userData state store.
  Restoring or reopening a historical item revalidates its original canonical root;
  roots replaced with junctions cannot expand the previous grant. No resource token
  is persisted. Search skips links and revalidates every directory and file.
- Draft updates and saves check document identity/revision. Writes stage a bounded
  file beside the destination, flush it and recheck the disk content hash before
  replacement. Save As destinations come from the system dialog and cannot overwrite
  an opened source; ordinary Save is limited to the current source. Failed staging
  removes its temporary file and retains the draft. See the batch report for the
  remaining concurrency and recovery limitations.
- Node integration is disabled, context isolation and sandboxing are enabled,
  and CSP disallows inline scripts and dynamic evaluation. No remote requests
  are allowed. Each opened file grants a new resource token scoped to its
  canonical directory; old tokens are revoked. Symlinks and traversal cannot
  expand the grant. Export destinations come only from the system save dialog.
- Diagrams run in a separate sandboxed hidden BrowserWindow with a bounded,
  serial queue. Export uses a fresh sandboxed window and an independent resource
  grant; foreground content is not rebuilt. Cancel, timeout and crash destroy
  the affected host. Later requests create a fresh host. Output is staged beside
  its destination and atomically renamed after completion, with source protection.

## Verification and remaining work

For the scoped, local-only personal desktop application roadmap, see the
[detailed development plan (Chinese)](DEVELOPMENT_PLAN.zh-CN.md).
The plan excludes online/remote resources, Obsidian/note embeds, OpenAPI,
whole-book and EPUB exports, system printing, CLI automation, and host integration.
Saving a single document as PDF remains in scope.

See [the validation report](VALIDATION.md) for evidence, limitations and the next
implementation decision. Generated screenshots, document exports and console
logs are under `test-results/desktop/` and are ignored by Git. Application builds
are under `dist/desktop/` and are also ignored.
