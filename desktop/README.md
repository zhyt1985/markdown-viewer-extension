# docu.md Desktop · Alpha development

Electron development build for an independently runnable local Markdown viewer.
The Windows x64 development app and packaged EXE have both been exercised locally.
The current development version is **0.1.0-alpha.39** (see `app-manifest.json`).
It is the formal product implementation in progress, not a stable release.
For the packaged Apple silicon Mac build, see the
[Alpha 39 macOS arm64 candidate guide](MACOS_ARM64_CANDIDATE.zh-CN.md).

In the reader, right-click a picture or diagram to save it or copy it as PNG.
Ordinary pictures save in their original format. Diagrams also offer SVG or
DrawIO when the renderer provides that format. With the picture or diagram zoom
button focused, press Shift+F10 to open the menu.

Right-click a Markdown table to copy it as an HTML table and tab-separated text,
or save it as an XLSX workbook. Clipboard copies keep each value in its column;
the workbook preserves merged cells and basic header styling.

Choose **更多 → 在工作区定位当前文件** to reveal the open file in the
innermost open workspace, including in collapsed or paged folders. In Markdown
reading, hover over a code block or focus its copy button with Tab to copy
the code to the clipboard.

For macOS/Windows build commands and troubleshooting in Chinese, see the
[desktop build guide](BUILD.zh-CN.md) and the
[Windows x64 source handoff and regression guide](WINDOWS_X64_REGRESSION.zh-CN.md).

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
supported file in the lazy directory tree. You can also drop local files and
folders anywhere in the main window, including the source editor. Files open
as tabs, and folders become workspaces.
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
then choose the system save location. For Markdown PDF, choose A4, A5 or Letter,
portrait or landscape, and a uniform margin from 0 to 35 mm. Generate a page preview
to flip through the actual PDF before saving; the same PDF is saved if its options
and source revision are unchanged. Slidev keeps its own slide dimensions.
**导出任务 → 取消导出** stops
the active export. Another file can be opened while exporting; output remains
bound to the source document and settings captured when export started. The build is
deliberately offline: remote images, remote fonts and external navigation are
blocked. A directly selected file can read images in its directory; workspace
documents may use parent-relative images within the selected workspace root. The
The file size limit is 10 MiB. Ordinary text opens as UTF-8 or uses the encoding
from a UTF-16 BOM.
Use **文件 → 按编码打开…** to choose an encoding for one file, for example GB18030,
GBK, Big5, Shift JIS, or Windows-1252. The status bar shows the active encoding.
The language selector loads bundled translations. Cache controls show usage and
clear disposable cached data. Restarting restores workspaces, document tabs, the
active document and its saved scroll position. Each Markdown document also remembers
its last reading, split or source mode. Missing or invalid paths are skipped
with a visible warning. **最近打开** lists recent files and recently closed workspaces
separately, up to 20 entries per history. Reopening a workspace shows its file tree.
Clearing history keeps open workspaces, tabs and reading settings.
Choose a workspace and search filenames or body text. Matching is literal and case
insensitive; results include relative paths, source line numbers and snippets. Clicking
a result opens its tab and highlights the corresponding rendered block. Cancellation
or changing the query discards stale results.
Plain text, YAML, and supported code files open read-only with line numbers
and syntax highlighting where a grammar is available. Larger files use plain
text to keep the reader responsive. PNG, JPEG, GIF, WebP, AVIF, BMP, ICO, and
SVG images open in read-only tabs. Select **放大查看** to zoom or pan the image.
Local HTML opens in an isolated read-only view. The page can use local styles,
images, fonts, scripts and JSON within its authorized directory. Opening through
a workspace authorizes its root. External requests, pop-ups, and downloads are
blocked. To import the source of the current page, choose **文件 → 将当前 HTML 转为 Markdown**.
To import rich content or HTML markup from the clipboard, choose **文件 → 粘贴 HTML 转 Markdown**.
The result opens as a recoverable Markdown draft that you can edit, save, or export to Word or PDF.
Supported images are embedded when their bytes are in the clipboard HTML or when their relative paths
resolve within the HTML file’s authorized directory. Remote and unavailable images are marked in the
draft. Relative links keep their original destinations; adjust them if you save the draft elsewhere.

Standalone Mermaid, PlantUML, Vega, Vega-Lite, Graphviz, Infographic, JSON Canvas,
DrawIO and ECharts files open as read-only diagram tabs. Choose **更多 → 图表源码**
to switch between the diagram and its original text. Successfully rendered diagrams
export to Word or PDF even while the source is visible. The same formats work in
Markdown code fences. Vega and Vega-Lite can use UTF-8 data files within the authorized
directory; reload the document to pick up changes to a referenced data file.

The desktop Mermaid renderer includes Font Awesome 5 Free Solid, Regular and
Brands. Flowcharts can use these icons offline with the `fa`, `fas`, `far` and
`fab` prefixes in icon nodes and labels. Remote images and custom online icon
packs remain unavailable. See the [icon attribution and license](FONT_AWESOME_NOTICE.md).

Files ending in `.slides.md` open in a read-only Slidev view. The toolbar switches
between **演示** and **列表**, moves between slides, and enters full screen. Nine
Slidev themes, the shell and math fonts are included in the package. Relative
images can load from the authorized directory. Choose **导出** to save a static
PDF with one page per slide and all click steps visible. Transitions and interactive
content are omitted, and unavailable images or diagrams block PDF export.

Use **更多 → 本机资源目录… → 添加本机目录…** if a saved document refers to an image,
font or chart data file outside its usual directory. Paths still resolve from
the original document location. Each tab has its own list of up to eight extra
folders. **撤销授权** removes a folder immediately. Closing the tab or restarting
the app clears the list. Extra folders do not join workspace search, open new
document links, or authorize writes. Revoking access cancels an unfinished export
that holds the grant.

Choose **导出 → HTML** for a standalone copy of a Markdown document or diagram.
The `.html` file embeds document styles, images, diagrams and math fonts. It
opens directly in a browser without the application or a network connection.
The export uses the current rendered document and settings snapshot. If an image
cannot be read during export, the app reports it and leaves no incomplete file.

Choose **导出 → PNG** to save the whole rendered Markdown document or standalone
diagram as one image. The image is 1440 pixels wide, keeps the document theme,
and includes content below the reading viewport. Code and table cells wrap to fit.
Use PDF for a document that exceeds the PNG height limit of 16,000 pixels.

Choose **更多 → 文档资产…** to list the current document's images and diagrams.
Filter by type, index, or source line and select the items to save. Ordinary
images retain their original bytes. Diagram rows offer PNG and list SVG or
DrawIO only when the renderer provides those formats. Each export creates a new
folder with the selected files and `manifest.json`. Failed items stay visible
with their source lines while available items can still be exported.

Markdown keeps its editing, annotation,
and export controls. The workspace tree disables unsupported file types and
symbolic links. Up to 32 documents can be open. The tree lists 500 items per
page for directories with up to 20,000 entries. Search shows progress and can
be canceled. It scans up to 20,000 entries, 10,000 Markdown files, 64 MiB of
content, 32 nested directory levels and 200 results; limit hits and skipped
entries are reported.

**设置** now exposes all 12 shared settings, including the locale selector.
Choose from all 34 registered document themes, set Frontmatter display,
table/image/diagram alignment, empty-cell merging, first-line indentation,
Word separator and emoji options, and file sidebar position and width.
Choose **应用并保存** to persist document, Word and sidebar changes and refresh
the current preview. Sidebar width adapts to the available window space.
**恢复文档与侧栏默认值** fills in defaults for these controls, then **应用并保存**
commits them. App appearance, reading fonts, locale and editing preferences
keep their own controls. Export tasks retain their starting settings.

In **Settings → Language**, choose **System default**, **简体中文**, or **English**.
The desktop interface updates immediately, including menus, settings, editing
controls, and app-provided dialog messages. Other registered languages use
available shared translations and fall back to English for desktop messages.

Use the percentage button in the status bar to choose a standard, wide, or
narrow reading layout and zoom the document body. The reading view keeps
the current paragraph in place when the width or zoom changes. Width, zoom,
and reading position are saved per document, including when leaving a tab
from source mode. Use **视图 → 进入全屏** or F11 for native window fullscreen.
Use the focus button to hide the navigation panels and Esc to show them again.

Select rendered text, choose a color, and select **添加批注**. Use **批注** in
the document toolbar to find, edit, delete, or copy notes. The panel shares
the outline's position and offers four highlight styles. Delete can be
undone within ten seconds. Annotations are stored locally per document
and move to the file identity when an untitled draft is first saved.
If the document text changes, select the intended passage and choose
**关联当前选区** to confirm a new location. **导出** in the annotation panel
saves a `.remarks.json` file. **导入** shows a preview before merging.

Choose **分栏** for the basic source editor alongside the preview, or **源码** for
source only. Live preview updates about 450 ms after the last edit, while
you can keep typing or switch tabs. Composition events pause preview until text
entry finishes. **更新预览** remains available for manual refresh; export is disabled
while the displayed preview is stale or rendering.
**保存** writes the current file; **另存为** writes a copy and switches the tab to
that copy. Ctrl+S saves, Ctrl+Shift+S opens Save As, and Ctrl+R reloads from disk.
Saving preserves the selected encoding, BOM and CRLF/LF style. A decoding failure
leaves the active document in place. If the original encoding cannot represent a
new character, the app keeps the draft and refuses a lossy save. Choose
**文件 → 另存为 UTF-8…** to save a UTF-8 copy while keeping the original file.
CodeMirror 6 provides line numbers, Markdown highlighting, folding,
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

The root and `desktop` directories have separate lockfiles and both installs
are required. A root-only install leaves the desktop editor's CodeMirror
dependencies unavailable. The build checks these dependencies before writing
application assets and prints the appropriate install command when they are missing.

The first launch may download the pinned Electron runtime. To download it
explicitly before launching:

```sh
npm exec --prefix desktop -- install-electron --no
```

To build and package:

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

This packages for the build machine's operating system and architecture. On an
Apple Silicon Mac, the application is written to
`dist/desktop/packages/documd-desktop-darwin-arm64/documd-desktop.app`.
On Windows x64, it is written to the portable directory shown above.
No signing credentials or installer are required for local development packaging.
The Alpha 17 packaged app passed all 150 automated test entries on both
macOS arm64 and Windows x64. The tester confirmed that all Windows manual
checks in the regression guide passed. [Alpha 17 build and regression record](BUILD.zh-CN.md#2026-11-11-alpha-17-界面语言)

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
  All 28 registered locale files are bundled. The desktop interface ships with
  Simplified Chinese and English messages.
- Workspace entries are opaque IDs with canonical root checks on listing and
  opening. Removing a workspace revokes its foreground grants; an existing
  export retains its own temporary grant until it completes or is canceled.
- Versioned session, recent files and recent workspaces share the atomic userData state store.
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
  and CSP disallows inline scripts and JavaScript string evaluation. The separate
  diagram host can compile bundled WebAssembly for Graphviz. No remote requests
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
