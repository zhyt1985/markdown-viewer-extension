# Desktop prototype validation

Date: 2026-11-04. Branch: `prototype/electron-desktop`.

## Result

The proposed Electron route is feasible for the tested scope. A real Windows
x64 application renders local Markdown and exports DOCX/PDF using the existing
shared pipeline. Both development and packaged application runs passed all
9 reported Node test entries (7 E2E subtests, their parent, and the independent
resource-policy test), with no skips.

This establishes local prototype feasibility, not production acceptance or
compatibility with every format advertised by the browser extensions.

## Environment and commands

- Windows x64; Node.js 24.21.0; npm 11.19.0.
- Electron 45.2.2; `@electron/packager` 20.3.0.
- PDF verification: `pdfjs-dist` 6.5.438, `@napi-rs/canvas` 1.1.0.
- `npm run build:desktop`: passed (shared CLI/browser build plus desktop assets).
- `npm --prefix desktop run package`: passed; ASAR application packaged with
  the Electron runtime.
- `npm run test:desktop`: 9/9 passed, development run approximately 3.7 seconds.
- The same command with `MV_DESKTOP_EXECUTABLE` pointing at the packaged EXE:
  9/9 passed, approximately 4.8 seconds.
- Portable directory: 73 files, approximately 378.4 MiB uncompressed on this
  machine. This is a prototype size measurement, before packaging optimization.

## Coverage and evidence

| Area | What actually ran / was asserted |
|---|---|
| Standalone runtime | Playwright launched the packaged Windows EXE with a fresh profile; it loaded bundled assets and completed the full workflow |
| Local paths | The fixture directory and Markdown filename contain Chinese characters and spaces; its relative SVG filename includes a URL-encoded space |
| Preview | Chinese heading, table, KaTeX formula and Mermaid flowchart; image decode succeeds; renderer diagnostics are empty |
| Offline operation | The app blocks remote requests; an explicit external fetch is rejected; the fixture needs no server or CDN |
| DOCX | Actual saved ZIP payload; document XML contains the heading, table and OMML formula; package includes media |
| PDF | Actual Chromium print output; parsed as one A4 page; extracted Chinese heading matches after Unicode compatibility normalization; toolbar/status text is absent |
| Visual inspection | Preview screenshot and rasterized PDF page inspected: heading, formula, table, local image and flowchart are legible and unclipped |
| Untrusted content | An intentional script fixture does not execute; the existing sanitizer displays a warning, which is also visible in exported output |
| File boundaries | Renderer has no Node globals; app host sources and invalid grants are inaccessible; a valid document token reads its image but cannot read a sibling file |
| Canonical paths | Independent test rejects sibling-prefix paths, `..` traversal and a junction/symlink escape |
| Lifecycle / failure | Canceling dialogs preserves the preview; source overwrite is rejected; a newly selected file revokes old resource URLs; missing images prevent export |

Evidence is generated separately for development and packaged runs:

```text
test-results/desktop/development/
test-results/desktop/packaged/
  preview.png
  pdf-page-1.png
  验证结果.docx
  验证结果.pdf
  console.log
```

Console errors from deliberately denied requests and the missing-image test are
expected. Test fixtures are synthetic local data. Native open/save dialogs are
stubbed by Playwright in the main process; actual manual dialog interaction and
an independently provisioned target machine were not tested.

## Other checks and known limits

`git diff --check` and JavaScript syntax checks passed. The repository-wide
TypeScript check was also attempted. It is **not clean** with the freshly
resolved dependencies: in addition to source-distributed vendor errors, three
errors occur in unchanged existing sources:

- `src/exporters/docx-blockquote-converter.ts:200` — `FileChild[]` versus
  `readonly (Paragraph | Table)[]`.
- `src/exporters/docx-exporter.ts:1112` — `XmlComponent` versus `ParagraphChild`.
- `src/exporters/docx-inline-converter.ts:677` — the same `ParagraphChild` issue.

The root manifest's existing `docx: ^9.5.1` resolved to 9.15.2. Neither these
source files nor root dependencies were changed for the prototype. Desktop
runtime export tests passed despite these type errors. Dependency pinning and
the exporter type compatibility issue remain separate follow-up work.

The root `fibjs` unit suite was not run (`fibjs` is unavailable), and the full
browser-extension E2E matrix was not run. The desktop changes are isolated to
`desktop/`, root npm commands and a README link; no shared engine source changed.

Not implemented or accepted in this prototype:

- Complete desktop `PlatformAPI`, settings persistence, recent files, directory
  navigation, file watching, editing, drag/drop, file association or multi-window UI.
- Every diagram engine, Slidev, whole-book exports, OpenAPI references, large
  documents, memory/performance budgets, network drives or UNC paths.
- Installation/upgrade/uninstall lifecycle, signing, automatic updates or
  fresh-machine deployment acceptance.
- macOS/Linux desktop packages or cross-platform rendering parity.

## Recommended next step

Retain Electron for the Windows desktop implementation. Before broadening the
feature surface, implement a dedicated desktop adapter and isolate heavy
rendering; then validate representative real documents, directory/resource
workflows, file watching and deployment on a clean Windows machine. The current
portable build is suitable for reviewing the narrow reader/exporter workflow.
