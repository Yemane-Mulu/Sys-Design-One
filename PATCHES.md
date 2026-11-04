# PATCHES.md — Patch Register (Hardened Fork)

- **Upstream:** PhillipAlexanderYoung/knoxnet-system-designer
- **Pinned base:** commit `7bae0cd3746fa8904bc53f206e0a9961dad62738`
- **Destination fork:** Yemane-Mulu/Sys-Design-One (renamed from knoxnet-system-designer, 2026-11-04)
- **Working branch:** `Sys-Design-One`

**Rules:** one Patch_Commit per reviewable fix. Every patch is recorded here with its purpose, reason, changed files, source fix item, verification evidence, and authorization basis. No push without explicit user approval (Gate D). Package manifests and lockfiles change only after Gate A/B approval. No existing test is weakened, skipped, or deleted.

## Patch 1 — Neutralize spreadsheet formula triggers in CSV and XLSX exports

- **Source_Fix_Item:** A1 (KNOXNET-FIXES section A) → Requirement 2 (fork spec: `export-hygiene`)
- **Authorization:** user instruction, 2026-11-04 — "proceed with Source_Fix_Item 1 → Requirement 2 (CSV formula neutralization in `csvCell()`)"
- **Purpose:** every value Knoxnet exports to CSV or XLSX that begins with a formula trigger (`=`, `+`, `-`, `@`, tab, carriage return) must remain inert in spreadsheet software.
- **Reason:** drawings and project files can originate outside the organization; a cell beginning with a formula trigger can become a live spreadsheet formula — including a hyperlink formula that discloses data — when the export is opened.
- **Changed files:**
  - `src/reports/formats/csv.ts` — `csvCell()` now applies Formula_Neutralization (single apostrophe prefix) to trigger-leading values before RFC 4180 quoting; `csvCell` and `neutralizeFormulaTrigger` exported for tests
  - `src/reports/formats/xlsx.ts` — documented the security contract: `aoa_to_sheet` writes every value, including trigger-leading ones, as a text cell; SheetJS never infers formulas from strings
  - `tests/formulaNeutralization.test.ts` — new: 9 tests pinning trigger fixtures (`=HYPERLINK("x")`, `+1`, `-1`, `@SUM(1)`, tab, CR), group-key neutralization, ordinary-value passthrough, and XLSX text-cell / no-formula-property inspection
- **Verification (2026-11-04):**
  - `npm test` (vitest run, non-watch): **26/26 files, 270/270 tests passed**, including the 9 new tests — local run
  - `tsc -b` (Type_Check): **passed** — local run
  - `npm run build` (Production_Build): **deferred to CI** per user direction (no local production builds); the CI verification workflow is added in this change set
  - No dev/preview/watch server started; no secrets written

## Patch 2 — Harden PDF processing and remove URL-based PDF ingestion

- **Source_Fix_Item:** A2 (KNOXNET-FIXES section A) → Requirement 3 (fork spec: `ingest-hardening`)
- **Authorization:** user instruction, 2026-11-04 — "I want all of the Security fixes (Source_Fix_Items 1–8) done… without building locally"
- **Purpose:** the PDF engine must never run dynamic code evaluation while parsing documents, and PDF ingestion must accept local file data only.
- **Reason:** PDF files are hostile input; PDF.js versions before 4.2.67 are exposed to CVE-2024-4367, and the enabled `isEvalSupported` default creates an avoidable execution path. The URL_PDF_APIs were the only PDF URL-fetch paths and had no callers at the pinned commit.
- **Changed files:**
  - `src/lib/pdfjs.ts` — `getDocument` options now pass `isEvalSupported: false`; `loadPdfFromUrl()` removed; security contract documented in the module header
  - `src/lib/ingest/pdfIngest.ts` — `ingestPdfFromUrl()` removed
  - `src/lib/ingest/index.ts` — `ingestPdfFromUrl` removed from import and re-export
  - `src/lib/ingest.ts` — `ingestPdfFromUrl` removed from the legacy re-export
  - `tests/pdfHardening.test.ts` — new: static checks (zero URL-API references across `src/`, the sole `getDocument` call site passes `isEvalSupported: false`, no explicit enable anywhere) + B4-equivalent integration test parsing a generated representative valid local PDF with evaluation disabled
- **Dependency note:** `pdfjs-dist` 4.10.38 installed from the pinned lockfile — already above the 4.2.67 floor; no dependency change required or made.
- **Verification (2026-11-04):**
  - `tsc -b` (Type_Check): **passed** — local run
  - `npm test` / `npm run build`: **via CI** (Gate D push pending; no local builds per user direction)
  - No dev/preview/watch server started; no secrets written

## Patch 3 — Enforce imported file and decoded image limits

- **Source_Fix_Item:** A3 (KNOXNET-FIXES section A) → Requirement 4 (fork spec: `ingest-hardening`)
- **Authorization:** user instruction, 2026-11-04 — "I want all of the Security fixes (Source_Fix_Items 1–8) done… without building locally"
- **Purpose:** oversized files and decompression-bomb images must be rejected before expensive work, with friendly errors naming the applicable limit.
- **Reason:** source testing observed a 150 MB DXF freezing the page for 14.7 seconds and a 900-megapixel PNG being accepted; the optional DXF Web Worker remains deferred by scope.
- **Changed files:**
  - `src/lib/ingest/index.ts` — `ingestFile()` rejects files above the configurable Imported_File_Cap (initialized to 50 MB / 50,000,000 bytes) before reading contents; `setImportedFileCap` and `IMPORTED_FILE_CAP_BYTES` exported
  - `src/lib/projectFile.ts` — `importProjectFile()` rejects `.knoxnet` files above the Project_File_Cap (100 MB / 100,000,000 bytes) before reading or parsing any text; `PROJECT_FILE_CAP_BYTES` exported
  - `src/lib/ingest/rasterIngest.ts` — `ingestRasterBytes()` enforces the Raster_Pixel_Cap (100,000,000 px, `naturalWidth × naturalHeight`) after decode and before project insertion, revoking the object URL on rejection; `RASTER_PIXEL_CAP` and `assertWithinRasterPixelCap` exported
  - `tests/ingestCaps.test.ts` — new: caps pinned to documented values; 150 MB DXF and >100 MB `.knoxnet` rejected in under 2 seconds with content-accessor fakes proving no read happens before rejection; below-cap file proceeds past the gate; cap configurability; 900-megapixel dimension guard rejects in under 2 seconds; at-cap raster accepted, one-pixel-over rejected
- **Verification (2026-11-04):**
  - `tsc -b` (Type_Check): **passed** — local run
  - `npm test` / `npm run build`: **via CI** (Gate D push pending; no local builds per user direction)
  - No dev/preview/watch server started; no secrets written

## Patch 4 — Validate imported .knoxnet project structure

- **Source_Fix_Item:** A4 (KNOXNET-FIXES section A) → Requirement 5 (fork spec: `ingest-hardening`)
- **Authorization:** user instruction, 2026-11-04 — "I want all of the Security fixes (Source_Fix_Items 1–8) done… without building locally"
- **Purpose:** the entire required project structure must be validated before anything loads, so malformed external data cannot produce a partially loaded or structurally invalid project.
- **Reason:** `parseProjectFileText()` previously accepted arbitrary structure after the version-header check; guaranteed shape becomes essential when project files enter later business workflows. Validation is project-local hand-written code using existing dependencies — no schema package introduced (Gate C respected).
- **Changed files:**
  - `src/lib/projectFile.ts` — new `validateProjectFilePayload()` runs before any project loads: required arrays (sheets/racks/connections/diagrams/reports/layers) must be arrays; sheets and markups must be objects; markup `kind` must belong to the pinned commit's 11-kind Markup union; device/cable/schedule markups must carry the discriminator fields the runtime dereferences; serialized sheet-source `kind` must be one of pdf/dxf/svg/raster/ifc; every number in the payload must be finite (JSON `1e999` parses to Infinity); strings enforce documented per-class caps — 500 characters for identifier-class keys, 10,000 for free-form text — while payload strings (base64 sources, SVG source text, embedded logo data URLs) are type-checked only and bounded by the Project_File_Cap. Constants exported: `ALLOWED_MARKUP_KINDS`, `PROJECT_TEXT_LIMITS`
  - `tests/projectFileValidation.test.ts` — new: 11 malformed fixtures rejected with Friendly_Errors (non-array sheets/markups/racks, unsupported markup and source kinds, non-object markup, missing deviceId, non-finite number, non-string version header, over-length strings of both classes); boundary tests at exactly 500/10,000 characters; payload exemptions (50k-character SVG source and embedded logo parse fine); legacy v1.x minimal file still parses; parse → serialize → parse equivalence with byte-identical re-serialization

## Patch 5 — Self-host application fonts

- **Source_Fix_Item:** A5 (KNOXNET-FIXES section A) → Requirement 6 (fork spec: `self-hosted-assets`)
- **Authorization:** user instruction, 2026-11-04 — "I want all of the Security fixes (Source_Fix_Items 1–8) done… without building locally"
- **Purpose:** fonts load exclusively from the application origin, so page loads do not disclose usage to third-party font hosts and do not depend on remote font services.
- **Reason:** `index.html` loaded Inter from `https://rsms.me/inter/inter.css` and JetBrains Mono (weights 400/500/600) from Google Fonts through five external link tags (the source doc counts four; every external font tag was removed). Both fonts are SIL Open Font License.
- **Changed files:**
  - `index.html` — all external font link tags removed (rsms.me preconnect + stylesheet; Google Fonts preconnects + stylesheet)
  - `src/styles.css` — `@font-face` rules added: Inter variable (weights 100–900) and JetBrains Mono at exactly the weights the app uses (400/500/600), all resolving to same-origin `/fonts/` with `font-display: swap`
  - `public/fonts/` — new self-hosted assets: `InterVariable.woff2` (344 KB, rsms/inter v4.1 release), `JetBrainsMono-Regular.woff2` / `JetBrainsMono-Medium.woff2` / `JetBrainsMono-SemiBold.woff2` (90–92 KB each, JetBrains/JetBrainsMono v2.304 release), `Inter-OFL.txt`, `JetBrainsMono-OFL.txt` (each font's SIL OFL license stored alongside its assets)
  - `tests/fontSelfHosting.test.ts` — new (A1-equivalent source checks): zero remote-font-host references in index.html and `src/`; `@font-face` definitions for both families; every CSS font URL same-origin under `/fonts/`; woff2 assets and licenses present; woff2 magic-byte verification on every font file
- **Dependency note:** no package changes — fonts downloaded from the official rsms/inter and JetBrains/JetBrainsMono GitHub releases; woff2 magic bytes and license headers verified at install time.
- **Verification (2026-11-04):**
  - `tsc -b` (Type_Check): **passed** — local run
  - `npm test` / `npm run build`: **via CI** (Gate D push pending; no local builds per user direction) — CI additionally proves the production build's artifacts carry the font and license assets (Vite copies `public/` verbatim)

## Patch 6 — Render settings labels as text

- **Source_Fix_Item:** A8 (KNOXNET-FIXES section A) → Requirement 9 (fork spec: `settings-ui`)
- **Authorization:** user instruction, 2026-11-04 — "I want all of the Security fixes (Source_Fix_Items 1–8) done… without building locally"
- **Purpose:** settings labels render through React's text pipeline, so no future label change can turn the settings drawer into an HTML injection path.
- **Reason:** the TextField label rendered through `dangerouslySetInnerHTML` — not exploitable while every label was hardcoded, but an avoidable sink. The sink existed to render `&quot;` entities in the company-name label; both are replaced.
- **Changed files:**
  - `src/components/SettingsDrawer.tsx` — `TextField` renders labels via the React text expression `{label}`; the `dangerouslySetInnerHTML` sink is removed; the "BY ____" footer label uses normal quote characters instead of `&quot;` entities; `TextField` exported for tests
  - `tests/settingsLabels.test.ts` — new: static checks (zero `dangerouslySetInnerHTML` in the component, `{label}` text expression present, no `&quot;` entities, normal-quote label) + behavioral proof via `react-dom/server` (existing dependency, no new package): a label containing `<script>` / `<img onerror>` metacharacters renders escaped — displayed as text, never interpreted
- **Verification (2026-11-04):**
  - `tsc -b` (Type_Check): **passed** — local run
  - `npm test` / `npm run build`: **via CI** (Gate D push pending; no local builds per user direction)
  - No dev/preview/watch server started; no secrets written
  - No dev/preview/watch server started; no secrets written
- **Verification (2026-11-04):**
  - `tsc -b` (Type_Check): **passed** — local run
  - `npm test` / `npm run build`: **via CI** (Gate D push pending; no local builds per user direction)
  - No dev/preview/watch server started; no secrets written
