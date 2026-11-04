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

## Patch 7 — Replace the device and rack catalogs wholesale with the supplied catalogs

- **Source_Fix_Item:** user catalog instructions → Requirement 10 (fork spec: `device-catalogs`)
- **Authorization:** user instruction, 2026-11-04 — "I want all of the Security fixes (Source_Fix_Items 1–8) done… and then the catalogs adressed"
- **Purpose:** the supplied researched device and rack-device TypeScript files are the complete catalog source of truth, replaced wholesale — no spreadsheet conversion, no record-by-record merge.
- **Reason:** a wholesale replacement preserves the supplied 2026-research-pass declarations (real vendor product lines) and avoids merge ambiguity; compatibility checks and narrowly necessary corrections protect the existing UI, src references, and test suite.
- **Changed files:**
  - `src/data/devices.ts` — replaced in full by the supplied catalog (318 KB, real-hardware research pass; same export surface as upstream: `DeviceCategory`, `DeviceType`, `devices`, `devicesById`, `effectiveDevicePorts`; same relative import of `PortSpec` from `../store/projectStore`)
  - `src/data/rackDevices.ts` — replaced in full by the supplied catalog (453 KB; identical 12-export surface including `rackCategoryLabel`)
  - `tests/catalogValidation.test.ts` — new Catalog_Validator (Req 10 AC 8–11): unique identifiers within each catalog, lookup maps resolve every record, categories allowed by the unions (compile-enforced) with runtime verification, finite numeric values, every id referenced by existing tests and `src/` resolves through the exported lookup maps, and the exact labels/ports existing tests assert
- **Compatibility corrections (AC 7/13 — every retention recorded; original value = corrected value, records retained verbatim from the pinned upstream catalog):**

  | Retained id | Catalog | Reason required (reference evidence) | Verification |
  |---|---|---|---|
  | `cam-dome` | devices | 20+ test files + `src/data/coveragePresets.ts` | `devicesById["cam-dome"]` resolves; label/category asserted in Catalog_Validator |
  | `cam-bullet` | devices | reports.engine.test + `coveragePresets.ts` | resolves; category asserted |
  | `net-ap-i` | devices | cableRuns/connections/networkConfig/reports/scheduleBlocks/undoRedo tests + `coveragePresets.ts` | resolves |
  | `net-switch-poe` | devices | 40+ references incl. `devicesById["net-switch-poe"].ports` assertion, `effectiveDevicePorts("cam-dome")`, `src/lib/nesting.ts` case | resolves; ports asserted non-empty |
  | `net-nid` | devices | undoRedo.test | resolves |
  | `net-headend` | devices | cableRuns/nesting/projectFile/reports/undoRedo tests | resolves |
  | `net-rack` | devices | `src/lib/nesting.ts` `RACK_DEVICE_ID` constant + nesting.test | resolves |
  | `site-pullbox` | devices | cableRuns.test label assertion ("Pull Box") + `src/lib/cableRuns.ts` route list | resolves; label asserted |
  | `site-junction-box` | devices | cableRuns.test label assertion ("Junction Box") + `src/lib/cableRuns.ts` route list | resolves; label asserted |
  | `net-wifi-bridge` | devices | cableRuns/connections/reports/undoRedo tests + `coveragePresets.ts` | resolves |
  | `sw-cat-24` | rackDevices | bid.test labor assertions + `src/lib/nesting.ts` return value | resolves; category "switch" asserted |

  No supplied value was altered; no spreadsheet was consulted; `knoxnet_schema_headers.xlsx` was not used. Ids `sw-1`, `switch-1`, `m5`, `ac-controller`, `acs-controller` were verified as markup-level ids or runtime-tolerated unknowns requiring no catalog record.
- **Verification (2026-11-04):**
  - `tsc -b` (Type_Check): **passed** — local run, including the typed catalogs and every consumer
  - `npm test` (incl. `duplicateDevices.test.ts`, bid, cableRuns, connections, nesting, networkConfig, reports.engine, undoRedo): **via CI** (Gate D push pending)
  - `npm run build`: **via CI**
  - No existing test weakened, skipped, or deleted; no dev/preview/watch server; no secrets written

### Post-replacement reference sweep (2026-11-04, follows Patch 7)

A full sweep compared every `id:` literal in the pinned upstream catalogs (204 ids) against 138 src/test files. Findings, per the Req 10 correction rule (corrections only when proven by compatibility, compilation, or validation failures):

- **~58 `DEVICE_PRESETS` keys in `src/data/coveragePresets.ts`** reference upstream ids absent from the supplied catalog. Inert by design: `getCoveragePreset()` (coveragePresets.ts:174–178) resolves `DEVICE_PRESETS[deviceId] ?? CATEGORY_PRESETS[category] ?? null`, so every supplied-catalog device renders with its category-level preset. No test or runtime path asserts these keys. No correction required.
- **`rackDeviceIdForNestedDevice()` in `src/lib/nesting.ts` (lines 272–287)** maps four legacy device ids (`net-switch-core`, `net-router`, `net-nvr`, `net-ups`) to rack ids (`sw-core-2u`, `rtr-edge`, `nvr-16`, `ups-1500`) absent from the supplied catalog. Inert by design: the default branch returns `null` and the UI uses the generic nested-bubble rendering — the same path every other unrecognized device takes. The retained pair `net-switch-poe` → `sw-cat-24` keeps the tested path working. No correction required.
- **`ROUTE_INFRA_DEVICE_IDS` in `src/lib/cableRuns.ts` (lines 14–22)** lists seven site-infrastructure ids; two are retained (`site-pullbox`, `site-junction-box` — asserted by cableRuns.test.ts), five are now inert (`site-handhole`, `site-jbox-out`, `site-weatherproof-enclosure`, `site-fiber-splice`, `site-conduit`). Deferred observation: site-infrastructure devices from the supplied catalog are not treated as route infrastructure by that id list; extending the list is a `src/lib` change outside the two-file replacement scope and no acceptance criterion requires it. Recorded for future work, not corrected.

Conclusion: the 11 retained records remain the complete proven-necessary correction set; no supplied value was altered. *(Superseded by Patch 8 below after CI proof — see entry.)*

## Patch 8 — Catalog compatibility corrections proven by CI (Req 10 AC 7/13)

- **Source:** Requirement 10 corrections (fork spec: `device-catalogs`)
- **Authorization:** Gate D flow approved 2026-11-04 ("push… GitHub Actions runs the full suite… I record the results in PATCHES.md") — the corrections below are proven by the CI validation failures that approval's run produced.
- **Trigger:** CI run 41867484706 (`verify` #1, pushed at `63b138b`) failed the existing test suite with 7 findings across 4 files. Checkout, Node setup, and `npm ci` (lockfile install) all passed on the GitHub-hosted runner.
- **Corrections (each recorded per AC 7/13):**

  | # | CI finding | Root cause | Correction |
  |---|---|---|---|
  | 1 | `cableRuns.test.ts:184` — `devicesById["site-weatherproof-enclosure"]` undefined (label "Weatherproof Enclosure" expected) | A 12th upstream record referenced by an existing test, missed by the retention sweep (the sweep listed its cableRuns.test.ts reference but it was misclassified as inert) | Upstream record retained verbatim inside the supplied catalog: `site-weatherproof-enclosure`, label "Weatherproof Enclosure", shortCode WPE, category site, defaultCost 325, laborHours 1.75, upstream icon |
  | 2–4 | `cableRuns.test.ts:790`, `scheduleBlocks.test.ts:183`, `reports.engine.test.ts:307` — `'ETH 0 (LAN)'` resolved where `'ETH 0 (PoE in)'` expected | The supplied catalog's rewrite of `inferDefaultPorts` omitted upstream's AP seeding rule (`code === "AP" \|\| code === "AP-O" \|\| code.startsWith("AP-")` → `[ETH0_POE_IN, eth1 LAN]`) | Upstream's complete `inferDefaultPorts` transplanted verbatim (AC 7: the supplied helper was incompatible with the pinned commit's tested contract); upstream's `POWER_DC` port const added alongside the existing templates |
  | 5 | `reports.engine.test.ts:358` — expected 4 flattened ports, received 3 | Same AP seeding omission (2 seeded ports vs 1) | Same transplant |
  | 6 | `catalogValidation.test.ts:33` — `devicesById[id]` not reference-equal to the array record | This fork's own new test asserted reference identity against a map that intentionally enriches values with inferred ports (`{ ...d, ports }` copies — by design in the supplied catalog) | Fork's own test corrected to assert semantic resolution (id + label); the rack map is reference-equal (`rackDevices.map((d) => [d.id, d])`) and its assertion is unchanged. No existing upstream test was weakened, skipped, or deleted |
  | 7 | Runner annotation: Node 20 deprecation notice for `actions/checkout@v4` / `setup-node@v4` | GitHub Actions platform notice | No action required; recorded for awareness |

- **Changed files:**
  - `src/data/devices.ts` — upstream `POWER_DC` const added; supplied `inferDefaultPorts` replaced with the pinned upstream implementation (provenance comment included); `site-weatherproof-enclosure` retained verbatim
  - `tests/catalogValidation.test.ts` — devicesById resolution assertion corrected to semantic resolution
  - `PATCHES.md` — this entry
- **Verification (2026-11-04):**
  - `tsc -b` (Type_Check): **passed** — local run after corrections
  - CI re-verification: pushed immediately after this commit; results below

## CI verification evidence (Req 11) — 2026-11-04

- **Run 41867484706** (`verify` #1, head `63b138b`, 16:28 UTC): existing suite FAILED with 7 findings → drove the Patch 8 corrections recorded above. Checkout, setup-node, and `npm ci` passed, proving the lockfile installs cleanly on a GitHub-hosted runner.
- **Run 41869398490** (`verify` #2, head `0041e37`, 16:38–16:39 UTC): **success — every step green** on GitHub-hosted `ubuntu-latest` runners:
  - `npm ci` (lockfile install): ✓
  - Existing test suite (`vitest run`, non-watch): ✓ **32/32 test files passed** — the complete upstream suite plus this fork's 7 new hardening/catalog test files, in 2.24s
  - `tsc -b` (Type_Check): ✓
  - `npm run build` (Production_Build, vite build): ✓ **built in 7.11s**
  - No dev/preview/watch server started; no secrets written; evidence captured via the GitHub Actions API
- This evidence completes the Req 11 verification workflow for Patches 1–8 and supersedes the "via CI (Gate D push pending)" lines above. The earlier local production-build failure (esbuild service error, cause undiagnosed) is confirmed environmental: the identical tree builds cleanly on the CI runner.

## Patch 9 — Replace the abandoned spreadsheet package with SheetJS 0.20.3 (Gate A approved)

- **Source_Fix_Item:** A6 (KNOXNET-FIXES section A) → Requirement 7 (fork spec: `dependency-governance`)
- **Authorization:** user instruction, 2026-11-04 — "approved to fix Gate A and B as per the spec" (Gate A package presented 2026-11-04 with audit evidence; dry-run validated)
- **Decision record (Gate A evidence requirements):**
  - **Package source:** official SheetJS CDN tarball `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` — docs.sheetjs.com: "The SheetJS CDN is the authoritative source for SheetJS modules"
  - **Exact version:** 0.20.3 — current CE release; meets the doc floor (≥ 0.20.3)
  - **Maintenance:** actively maintained (SheetJS LLC; source and releases at git.sheetjs.com)
  - **License:** Apache-2.0 (unchanged)
  - **Audit before:** `xlsx@0.18.5` flagged HIGH — prototype pollution (GHSA-4r6h-8v6p-xvw6) + ReDoS (GHSA-5pgg-2g8v-p4x9), "No fix available" on the abandoned npm registry line
  - **Audit after (2026-11-04, lockfile):** **xlsx advisories clear** — no known xlsx advisory applicable to the installed dependency graph; 15 findings remain overall (1 low, 5 moderate, 7 high, 2 critical) — the 2 criticals are tinypool, addressed by Patch 10 (Gate B)
  - **Integrity approach:** tarball pinned in `package-lock.json` with sha512 integrity metadata
  - **Compatibility risk:** LOW — Knoxnet writes spreadsheets only (`aoa_to_sheet` / `book_new` / `write`); the known issues primarily affect reading paths; the Patch 1 formula-neutralization tests (including the XLSX text-cell regression) are the behavior net, and CI re-verifies the full suite and build
- **Changed files:**
  - `package.json` — xlsx dependency source switched to the CDN tarball URL
  - `package-lock.json` — xlsx 0.20.3 pinned with integrity; regenerated via `npm install --package-lock-only` (no local install, no local build)
- **Verification (2026-11-04):**
  - Lockfile audit: xlsx clear (recorded above); CI verifies the complete existing suite, type check, and production build on the runner after push

## Patch 10 — Update the build toolchain to Vite 7.3.7 / Vitest 4.1.12 (Gate B approved)

- **Source_Fix_Item:** A7 (KNOXNET-FIXES section A) → Requirement 8 (fork spec: `dependency-governance`)
- **Authorization:** user instruction, 2026-11-04 — "approved to fix Gate A and B as per the spec" (Gate B package presented 2026-11-04; dry-run validated the same day)
- **Decision record (Gate B evidence requirements):**
  - **Direct packages + exact versions:** `vite` **7.3.7** (major line 7 — resolves source-doc Open Design Decision 8; also clears the third-party floor surfaced when Cloudflare wrangler 4.157.0 refused to auto-configure a deploy on Vite 5.4.21), `vitest` **4.1.12**, `@vitejs/plugin-react` **5.2.0** (required companion — 4.3.4 does not peer-support Vite 7; covered by Gate B's "every proposed package source and exact direct-dependency version" clause), `jsdom` ^25.0.1 (reclassified to devDependencies, not version-bumped)
  - **esbuild:** resolves to 0.28.2 within the regenerated tree (doc floor ≥ 0.25)
  - **Maintenance / licenses:** all four MIT, all actively maintained
  - **Audit before:** 29 findings (3 low, 11 moderate, 13 high, 2 critical — tinypool ≤ 2.1.1 prototype-pollution→RCE gadgets via vitest 2.1.9)
  - **Audit after (2026-11-04, lockfile, post-sweep):** **0 vulnerabilities** — tinypool absent from the tree; ws 8.22.1, postcss 8.5.32, and the remaining transitive findings (source-map-js, browserslist, nanoid, form-data, @babel/core, baseline-browser-mapping, postcss-selector-parser) all swept to fixed versions within existing ranges
  - **Breaking-change analysis:** Vite 5→7 is ESM-config-only (the project's `vite.config.ts` is already ESM); Vitest 2→4 preserves the exact config surface in use (`globals: false`, threads/singleThread pool, jsdom environment, include patterns); plugin-react 4→5 keeps the same `react()` plugin API; CI proves the full suite and production build on the new toolchain
  - **Lockfile plan:** full regeneration from the approved sources (`npm install --package-lock-only`) plus the transitive sweep (`npm audit fix --package-lock-only`) — both confinement-safe: no local install, no local build
- **Changed files:**
  - `package.json` — vite ^7.3.7, @vitejs/plugin-react ^5.2.0; vitest ^4.1.12 and jsdom ^25.0.1 moved from dependencies to devDependencies (Req 8 AC 10–11)
  - `package-lock.json` — fully regenerated from the approved sources and swept
- **Verification (2026-11-04):**
  - Lockfile audit: **0 vulnerabilities** (recorded above — Req 8 AC 13)
  - CI proves the complete existing suite, `tsc -b`, and production build on the new toolchain after push (Req 8 AC 14)

## CI verification evidence (Req 11) — Gates A/B — 2026-11-04

- **Run 41872166151** (`verify` at `2b9406a`, the Gate A+B head): **success — every step green** on GitHub-hosted runners:
  - `npm ci` (regenerated lockfile): ✓ — 239 packages installed and audited in 6s
  - Existing test suite (`vitest run`, non-watch, **Vitest 4.1.12**): ✓ **32/32 test files** — including the Patch 1 formula-neutralization regression tests now exercising **SheetJS 0.20.3**
  - `tsc -b` (Type_Check): ✓ on the new toolchain
  - `npm run build` (**Vite 7.3.7**): ✓ built in 9.13s
- Post-gate lockfile audit: **0 vulnerabilities** — from 29 findings (2 critical) at gate-approval time.
- Requirement checks closed: Req 7 AC 9 (no known xlsx advisory applicable) ✓ · Req 8 AC 13 (remaining findings recorded: 0) ✓ · Req 8 AC 14 (existing suite + production build pass on the approved toolchain) ✓.
- Third-party floor cleared: Cloudflare wrangler 4.157.0 requires Vite ≥ 6.0.0 for deploy auto-configuration; the fork now builds on 7.3.7.

**Definition of Done (source document): satisfied.** Every patch is a Patch_Commit above the pin with a complete register entry; Requirements 2–11 all satisfy their stated automated checks; the existing test suite passes (32/32 files) with no test weakened, skipped, or deleted; type check and production build pass on GitHub-hosted runners; the dependency audit records 0 findings; no verification step started a dev/preview/watch server; no secret appears in any source, fixture, log, register entry, commit, or build artifact; and every push occurred under explicit user approval (Gate D, then the Gate A/B approval of 2026-11-04).

## Main-line advancement (Req 1) — 2026-11-04

By explicit user instruction ("I want what we created as the main"), the fork's `main` branch was fast-forwarded from the pinned upstream base `7bae0cd` to the hardened fork head — a clean fast-forward, no merge commit, no history rewritten. The pristine base remains permanently visible in the history as the common ancestor of every patch. `main` and `Sys-Design-One` now both carry the complete hardened fork: the 10 Patch_Commits, the CI verification workflow, the OpenSpec artifact set, and this register. Default-branch consumers — including the Cloudflare deploy — now build the hardened, zero-vulnerability tree by default. CI verified `main` at the advanced head (run recorded below).

## Patch 11 — Remove non-rackable cameras and wireless APs from the rack catalog (user-directed)

- **Source:** user instruction, 2026-11-04 ("lets remove the following… They dont go inside the rack at all") — post-completion catalog correction under the Req 10 correction provisions
- **Reason:** 85 records (51 cameras, 34 wireless access points — every one `uHeight: 0`) are wall/ceiling devices duplicated from the device catalog into the rack catalog; they cannot occupy a rack slot. Every one of the 85 ids remains fully available in `src/data/devices.ts` (verified: all 85 present there); no test or src code references them through the rack catalog.
- **Kept:** `mikrotik-rbwapr-2nd` (wireless, `uHeight: 1` — rack-mountable, outside the removal list) and the `sw-cat-24` compatibility record.
- **Correction record (AC 13):** original value = the 85 records (preserved verbatim in git history at the parent commit); corrected value = removed; affected file = `src/data/rackDevices.ts`; the commit diff enumerates every removed record.
- **Verification (2026-11-04):** rack entries 545 → **460**; all module exports intact and `tsc -b` passed locally; `rackCategoryLabel` coverage and Catalog_Validator assertions unaffected; CI verifies the complete existing suite and production build after push.

## Patch 12 — Repair UTF-8 encoding corruption in the catalog files

- **Source:** self-identified defect, 2026-11-04 — found while rebranding, when the README replacement pass exhibited the same corruption pattern
- **What happened:** the PowerShell 5.1 file IO used in Patches 7, 8, and 11 (`Get-Content` + `WriteAllLines`) decoded the BOM-less UTF-8 catalog sources as ANSI and re-encoded them, double-encoding every non-ASCII character (em-dashes, box-drawing section dividers, and any special characters in the supplied data) into mojibake. `tsc`, the full test suite, and CI all passed on the corrupted files because mojibake remains syntactically valid TypeScript — every automated check was blind to it, and it surfaced only as display-level text damage.
- **Fix:** both catalog files rebuilt from pristine sources with explicit UTF-8 IO — the supplied originals (verified clean at source) plus the ASCII-only upstream records and helper transplant re-applied verbatim. Every prior patch's content asserted present: the 11 retained device records plus `site-weatherproof-enclosure` (192 device entries), the upstream `inferDefaultPorts` + `POWER_DC` seeding, the `sw-cat-24` compatibility record, and the 85-entry removal (460 rack entries). Byte-level assertions confirmed real UTF-8 (zero mojibake sequences) before writing.
- **Affected files:** `src/data/devices.ts`, `src/data/rackDevices.ts` — content restored; structure identical to Patches 7/8/11's verified intent
- **Verification (2026-11-04):** entry counts 192/460, retained records, transplant markers, and the kept 1U wireless entry all asserted; `tsc -b` clean; CI verifies the suite and build after push.

## Patch 13 — Rebrand to DesignOne with the D1 logo (user-directed)

- **Source:** user instruction, 2026-11-04 — "lets also change the brand to DesignOne… please also make a simple logo for it"
- **Brand identity:** default branding rebranded — wordmark lockup "DESIGN·ONE" (bold + light dual-tone, as before), fullName "DesignOne System Designer", document-code prefix `D1` (codes like `D1-12345-R0`); brand tokens (`src/brand/tokens.ts`) → name DesignOne. User-facing strings rebranded: document title, start-screen hero/footer and the default-brand check, HTML report chrome, ingest/validation messages, and code comments that referenced the product by name.
- **The D1 logo (new, simple):** a rounded midnight tile with an amber edge carrying a squared white **D** and an amber **1** — the D in the light ink of the DESIGN half, the 1 in the amber of the ONE half, echoing the dual-tone wordmark. Implemented in three places:
  - `public/brand/monogram.svg` — favicon, replacing the K-shield hex
  - `public/brand/wordmark.svg` — DESIGN/ONE lockup with the SYSTEM/DESIGNER mono tagline
  - `src/brand/Wordmark.tsx` — new bundled `DefaultD1Mark`: the in-app Monogram now renders the D1 tile by default instead of nothing; an uploaded logo still overrides everywhere
- **PDF exports:** `drawMonogram` (exported renderer API) rewritten from the K-shield to the D1 tile using the same path-op convention (square body — flip-invariant — plus squared D and 1 strokes); `drawHeaderMark` now falls back to the bundled D1 monogram when no logo is uploaded (the header box was already reserved in the layout).
- **Metadata:** package name `design-one`; homepage/repository/issues URLs → the fork.
- **Deliberately unchanged (format and data compatibility):** the `.knoxnet` file extension and `knoxnet` version-header field (existing project files and IndexedDB saves keep opening), localStorage keys and the Dexie database name (existing user data keeps loading), CSS `kn-*` tokens, the package `author` field (upstream attribution), KNOXNET-FIXES provenance citations, and the README's upstream clone instructions. README rebranded surgically — display name only (4 lines).
- **Verification (2026-11-04):** `tsc -b` clean across the rebranded tree; CI verifies the complete suite and production build after push.

## Patch 14 — Rack catalog data corrections and enclosure removal (user-directed)

- **Source:** user instruction, 2026-11-04 — "go" (all five items of the fix plan from the >3U audit)
- **Value corrections (AC 13 format: original → corrected, reason; affected file `src/data/rackDevices.ts`):**
  1. QNAP TS-h665U-RP: uHeight **665 → 5** (665 was parsed from the model name; the real device is a 5U rackmount NAS)
  2. CommScope SYSTIMAX 1100GS3 (760151308): uHeight **6 → 1** (the panel's own label reads 1U)
  3. CommScope PATCHMAX GS3 (760102244): uHeight **6 → 1** (same)
  4. Eaton ePDU EMA107-10: uHeight **0 → 1** (label reads "Managed 1U"; surfaced in the 0U audit)
  5. Panduit WMPV45E, APC AR7580A, and the FS 45U single-sided vertical cable manager: uHeight **45/42/45 → 0** (side-rail accessories occupy no rack units; retained in the catalog at 0U alongside the PDUs)
- **Removal:** 29 rack enclosures, open frames, and wall cabinets — every remaining `passive` record with uHeight > 3 after the corrections (floor racks 41–48U, the 25U half-height, wall cabinets 9–18U). They are racks, not devices placed inside racks (same correction class as Patch 11). Every removed record is enumerated in the commit diff and preserved in git history; a reference check confirmed no test or src usage of any removed id.
- **Deliberately kept:** passive items ≤ 3U (horizontal cable managers, blanking panels, shelves), the 0U PDUs, and the legitimate 4–8U servers, chassis switches, and NVR.
- **Verification (2026-11-04):** rack entries 460 → **431** asserted; `sw-cat-24` and the 1U MikroTik AP asserted present; corrections re-scanned (zero passive > 3U; QNAP 5U); encoding-safe UTF-8 IO throughout; `tsc -b` clean; CI verifies the suite and build after push.
- **Process note:** an intermediate working-tree slip (PowerShell function output-capture prepending seven diagnostic strings to the file head) was caught by `tsc -b` before any commit or push and repaired with structure assertions; nothing corrupt left this machine and the history contains only clean states.
- **Verification (2026-11-04):**
  - `tsc -b` (Type_Check): **passed** — local run
  - `npm test` / `npm run build`: **via CI** (Gate D push pending; no local builds per user direction)
  - No dev/preview/watch server started; no secrets written
  - No dev/preview/watch server started; no secrets written
- **Verification (2026-11-04):**
  - `tsc -b` (Type_Check): **passed** — local run
  - `npm test` / `npm run build`: **via CI** (Gate D push pending; no local builds per user direction)
  - No dev/preview/watch server started; no secrets written
