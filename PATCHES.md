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

## Patch 15 — Drops feature: first-class, documentation-only network drops (user-directed)

- **Source:** user instruction, 2026-11-04 — "build" (approving the `add-drops` OpenSpec change after plan review; decisions 1A/2A/3A/4A, all fields, report-scope-with-no-bid, faceplate semantics)
- **Purpose:** mark where network drops must be installed during client walkthroughs — numbered per project (D-001), grouped onto faceplates of 1–6 jacks, cable-terminable, reportable through the Drops Schedule — with **zero effect on the bid** (user decision 2026-11-04: "I dont need this adding to the cost or the bid").
- **Reason:** free-text/callout markup was the only way to note "data needed here" — disconnected from numbering, cabling, and reporting. Drops are documentation for the client and whoever runs the cable, not billable work performed by this shop.
- **Changed files:**
  - `src/store/projectStore.ts` — `DropMarkup` in the `Markup` union (one drop = one jack; fields: number, faceplateId, jackType, service, mount, heightInches, notes, labelOffsetX/Y); `ToolId` "drop"; `LayerId` "drop" + DEFAULT_LAYERS entry; `ReportScope` "drops"; `dropLabelScheme` project setting + `setDropLabelScheme`; `placeDropFaceplate` (1–6 jacks, one history entry); `moveDropMarkup` (whole-faceplate move, attached cable runs follow like devices); `deleteMarkup`/`deleteSelected` expand to faceplate siblings; `addMarkup` enrichment fills number + faceplateId
  - `src/lib/dropLabels.ts` (new) — `DropLabelScheme` (D / - / 3 defaults) + collision-tolerant next-number assignment mirroring `cableLabels.ts`; per-project sequence via `allDropMarkups`
  - `src/lib/projectFile.ts` — `"drop"` in `ALLOWED_MARKUP_KINDS`; validator requires number + faceplateId, checks service/mount unions when present, finite heightInches; identifier-class keys extended (number, faceplateId, jackType, service, mount)
  - `src/lib/validation.ts` — duplicate drop-number warning (`duplicate-drop-number`, scope "drop")
  - `src/lib/cableRuns.ts` — `dropCableEndpoint` (first jack by number without a cable; endpoint label = drop number), `compareDropNumbers` natural sort; `endpointFromMarkup` routes drops
  - `src/components/Toolbar.tsx`, `src/hooks/useGlobalHotkeys.ts`, `src/hooks/useToolGesture.tsx`, `src/components/CommandPalette.tsx` — drop tool, `J` hotkey, jack-count stepper (1–6), click-to-place, command-palette entry; `nudgeMarkup` drop case
  - `src/components/MarkupLayer.tsx` — faceplate renders once (first member by number): midnight plate with blue stroke + amber jack dots (1–6 layouts), number-range label pill (device-tag pattern: draggable offset, ×N badge); group selection on click; `moveDropMarkup` on drag
  - `src/components/PropertiesPanel.tsx` — per-jack editor (Drop #, jack type, service, mount, height, notes shown on the Drops Schedule) + faceplate-group editor for drops-only selections; `describeMarkup` drop entry
  - `src/components/SelectionActionBar.tsx`, `src/components/LeftRail.tsx` — selection label + bounding box cases; "Drops" layer list entry
  - `src/components/SettingsDrawer.tsx` — Drop Numbering section (prefix / separator / digits; blank falls back to D-001; affects new drops only)
  - `src/reports/engine.ts` — `selectDrops` flattener (number, faceplateId, faceplateJackCount, jackType, service, mount, heightInches, notes, sheet); `reportTotalsLine`; `dropFaceplateGroupLabel`; `ReportTemplate.showTotals`
  - `src/reports/fieldCatalog.ts`, `src/reports/starterTemplates.ts` — `drops` scope fields + "Drops Schedule" starter template (grouped by faceplate, notes column, showTotals)
  - `src/reports/formats/pdf.ts`, `markdown.ts`, `html.ts` — totals line when `showTotals`; `src/reports/formats/xlsx.ts` — totals row on the Summary sheet + drops group sheets named by drop-number range instead of the faceplateId uid
  - `src/export/exportMarkupPdf.ts` — drop rendering in the markup PDF (plate, jack dots, label pill honoring label offsets), mirroring the canvas node
  - `README.md` — hotkeys table gains `J` (Network Drop); markup-tools feature row lists network drop
  - `openspec/changes/add-drops/` — proposal, delta spec, design, tasks (the approved change record)
  - `tests/dropLabels.test.ts`, `tests/dropProjectFile.test.ts`, `tests/drops.test.ts` (new) — numbering (defaults, next-number, gaps/stability, per-project, scheme change applies to new drops only, collision tolerance), validator (pre-drop back-compat, round-trip, malformed drop rejection), cable association (first-jack-without-a-cable, labels, fallback), reports (scope rows, template grouping, totals, all six formats, CSV/JSON purity), bid isolation (identical totals with and without drops)
  - `tests/projectFileValidation.test.ts` — the pinned `ALLOWED_MARKUP_KINDS` exact-list assertion extended with `"drop"`, required by this change's file-compatibility requirement; the assertion still pins the complete exact list (no test weakened, skipped, or deleted)
- **Bid isolation (explicit):** `src/lib/bid.ts` is untouched — it reads only `device` and `cable` markups; drops fall through adding nothing. No drop pricing, labor, or rate field exists anywhere. `tests/drops.test.ts` asserts identical bid totals (all seven totals fields + line arrays) with and without drops.
- **Verification (2026-11-04):**
  - `tsc -b` (Type_Check): **passed** — local run, repeatedly during the build and clean at the end
  - `npm test` / `npm run build`: **via CI** (no local runs per user direction)
  - No dev/preview/watch server started; no secrets written; local test files are not type-checked by `tsc -b` (tsconfig includes `src` only) — CI's vitest run exercises them

### Patch 15 CI correction (2026-11-04)

- **Trigger:** user-approved push of `ec9d2a2` (both branches). CI run **41906228010** (`verify`, `Sys-Design-One` branch) failed the existing-suite step with exactly **one** test failure: `tests/dropLabels.test.ts:71` — `resolveDropLabelScheme({ prefix: " ", minDigits: 0 })` was asserted to equal the bundled defaults (`minDigits: 3`).
- **Root cause:** the test expected `minDigits: 0` to fall back to the default. The implementation clamps `0 → 1`, which is the exact documented behavior of the cable-scheme precedent (`resolveCableLabelScheme` in `src/lib/cableLabels.ts` uses the identical clamp). The implementation is correct; the test expectation was wrong — a test-only defect that local verification could not catch (tests are not type-checked or run locally per the fork's constraints).
- **Correction:** `tests/dropLabels.test.ts` — the blank/missing-fields test now asserts the blank-prefix fallback only, and the clamp test explicitly pins `minDigits: 0 → 1` and `99 → 8` (the cable scheme's semantics). No production code changed; no test weakened, skipped, or deleted.
- **Verification:** the corrected commit is pushed to both branches; the CI evidence below records the green runs.

### Patch 15 CI evidence (2026-11-04)

- **Run 41906228010** (`verify`, `Sys-Design-One`, head `ec9d2a2`): existing suite **FAILED** with the single finding that drove the test correction above (`dropLabels.test.ts:71`). Checkout, setup-node, and `npm ci` all passed.
- **Run 41906511885** (`verify`, `Sys-Design-One`, head `2675e4c`): **success — every step green**: `npm ci` ✓, existing suite (`vitest run`, non-watch) ✓ — the full upstream suite plus the three new drop test files (35 test files total), `tsc -b` ✓, `vite build` ✓.
- **Run 41906517137** (`verify`, `main`, head `2675e4c`): **success — every step green**: `npm ci` ✓, existing suite ✓, `tsc -b` ✓, `vite build` ✓.
- Both branches verified at `2675e4c874295cfc68babc81f48e0fb98e36a951` via `git ls-remote` after push. Default-branch consumers (including the Cloudflare deploy) now build the drops tree.
- No dev/preview/watch server started; no secrets written; evidence captured via the GitHub Actions API.

## Patch 18 — Legend DEVICES/DROPS sections, cover-page DROPS fact, standardized subcategory icons (user-directed)

- **Source:** user instruction, 2026-11-04 evening — plan preserved in `../HANDOFF-PATCH18.md` (written before this entry); approved 2026-11-05 with push ("Approved — implement + push"; ledger backfill declined — this entry is the only register addition).
- **Purpose:** the markup-PDF legend becomes two sections — **DEVICES** (one row per device CATEGORY present on the sheet, per-category chosen over per-model: colored disc in the category color, qty right-aligned) then **DROPS** (one row per drop group keyed jack type → service → bare `DROPS` fallback; jack types uppercased so "cat 6" / "Cat 6" merge; e.g. `CAT 6 DROPS … 10`, `CAT 5E DROPS … 4`, `Phone DROPS … 2`; faceplate-square icon echoing the canvas drop — midnight plate, blue stroke, amber jack). Both sections clip to the box with a `+ N more` footer; the header count chip becomes `N ITEMS` (was `N TYPES`). The cover page gains a DROPS fact in PROJECT FACTS, only when > 0, before the trailing RACKS/EST. TOTAL entry; `colW = innerW / facts.length` auto-adjusts. One standardized 24×24 line icon per subcategory (19 total) replaces the look-alike placeholder shapes.
- **Reason:** the legend previously counted only `kind: "device"` markups — drops were invisible on every exported sheet — and listed one row per device model, which overflows the fixed 180×200 default legend box (11 line-unit budget: `(200 − 18 header − 20 padding) / 14`; with the 2 section headers that's 9 rows before the footer). Switches/rectangles, firewalls/circles, and APs/half-circles all looked alike, so categories could not be told apart on the canvas, palette tile, properties panel, or export.
- **Shared model (drift prevention):** `src/lib/legendData.ts` (new) is the single source of truth consumed by BOTH renderers — export `drawLegend` (pdf-lib, y-up) and editor ghost `LegendGhost` (Konva, y-down) — so the printed sheet and the preview can never diverge. Exports: `buildLegendData`, `layoutLegend`, `legendCapacityUnits`, `dropGroupLabel`, `DROP_SERVICE_LABELS` (voice→"Phone", data→"Data", poe→"PoE", coax→"Coax", fiber→"Fiber"), `DROP_PLATE_COLORS` (`#0B1220` / `#4FB7FF` / `#F4B740`, echoing the canvas faceplate), geometry constants (`LEGEND_HEADER_HEIGHT` 18, `LEGEND_PADDING` 10, `LEGEND_LINE_HEIGHT` 14). Clipping is DEVICES-first; a section header that would strand with zero rows below it is dropped, never drawn; the `N ITEMS` chip counts every covered markup, clipped or not.
- **Icons (in-house):** NetBox ships no icon SVGs (it's a DCIM data tool; the catalog already cross-references its port specs) — all 19 drawings are drawn in-house, one per subcategory (Switches = 1U chassis/two port rows/uplink arrows; Firewalls = brick wall + flame; Routers = circular chassis + cross-route arrows; Gateways = arch + packet arrows; Infrastructure = rack shelves + vents; Wireless = mast + radiating arcs; Access Points = ceiling puck + 3 coverage arcs; cameras: Bullet = tube + lens + mount, Dome = plate + half dome + lens dot, Turret = cylinder + lens ring + bracket, Compact = small square + pinhole, PTZ = head + stem + base + aim arrow, Fisheye = concentric rings, Box = box + lens + top bracket, Panoramic = wide bar + twin lens slots, Mini = tiny cube + pinhole, Multisensor = main lens + two companions, Thermal = lens + heat waves; site: Distribution = enclosure + ports + pigtails). Stamped by a loop right after the `devices` array literal and BEFORE `devicesById` is derived, so the lookup map (and every consumer) inherits them; a subcategory without a drawing keeps its inline placeholder. Path format matches `DeviceType.icon.paths` with theme tokens `currentFill`/`currentStroke` — never hard hex — so one definition themes on canvas (`DeviceIconNode`), palette tile (`DeviceTile`), properties panel, and PDF export; stroke weight ~1.4 for readability at small sizes.
- **Changed files:**
  - `src/lib/legendData.ts` — new: the shared legend model (above)
  - `src/export/titleBlockRenderer.ts` — `drawLegend()` rewritten on the shared model; `devicesById` import removed (legend grouping now keyed by category via the model); header count chip `N TYPES` → `N ITEMS`
  - `src/components/BrandPreview.tsx` — `LegendGhost()` rewritten on the same model (mirrored y-down layout); `devicesById`/`categoryColor` imports removed
  - `src/export/exportMarkupPdf.ts` — `drawCoverPage()` PROJECT FACTS: DROPS inserted before RACKS/EST. TOTAL when `dropCount > 0`; drop count = sum over sheets of `m.kind === "drop"`
  - `src/data/devices.ts` — the 19 `STANDARD_SUBCATEGORY_ICONS` + stamp loop after the array literal (193-entry edit avoided; inline placeholders retained as fallback)
  - `tests/legendData.test.ts` — new (`@vitest-environment node`): drop group labels (jack-type precedence + uppercase merge, service map incl. voice→"Phone", bare fallback, plate colors), aggregation (per-category grouping, unknown-device skip, drops-only, empty), capacity math (180×200 → 11 units), clipping (fits, full DEVICES + stranded-header drop, budget split across sections, zero-capacity degradation, singular chip), icon stamp (exact 19-subcategory list, shared-identity + `devicesById` inheritance, pairwise-distinct paths, token-only fill/stroke)
- **Bid isolation (explicit):** `src/lib/bid.ts` untouched — drops remain non-billable, never in the BOM or any total (Patch 15 design intent). The DROPS fact on the cover is a documentation count only.
- **Verification (2026-11-05):**
  - `tsc -b` (Type_Check): **passed** — local run, on the full changed tree
  - Functional smoke (tsc-emitted CJS copies, deleted after): capacity math, drop group labels, real-catalog aggregation (192 devices; Switches 58, Firewalls 21, Access Points 35, Routers/Gateways 8 ea, Bullet 14, Dome 10), all clipping cases, the 19-icon stamp (identity, `devicesById` inheritance, distinctness, token purity) — **all assertions passed**
  - `npm test` / `npm run build`: **via CI** (user-approved push below) — local runs impossible (child-process spawn EPERM)
  - No dev/preview/watch server started; no secrets written; no existing test weakened, skipped, or deleted

### Patch 18 CI correction (2026-11-05)

- **Trigger:** user-approved push of `3617378` (both branches). CI run **41979228518** (`verify`, `Sys-Design-One`) failed the existing-suite step with exactly **one** finding attributable to this patch: `tests/legendData.test.ts:159` — "skips device markups whose id does not resolve in the catalog" threw `Error: no such device: not-a-real-device-id` from the test's own `deviceMarkup()` fixture helper, which resolves through `devicesById` and throws on unknown ids **before** `buildLegendData` gets a chance to skip them. A test-fixture defect, not a production defect — `buildLegendData` correctly skips unresolvable ids (the suite's other 21 legend tests passed).
- **Correction:** the test builds its unknown-id fixture as a raw `DeviceMarkup` object instead of calling the catalog-resolving helper; the assertion (empty sections, `totalItems` 0) is unchanged. No production code changed; no test weakened, skipped, or deleted. Committed as `aa05b8d` ("Patch 18 CI correction: fix unknown-device fixture in legend test").
- **Pre-existing failure (NOT introduced by this patch, correction pending user direction):** `tests/exportMarkupPdf.rotation.test.ts` crashes at import time — `TypeError: default is not a constructor` at `src/lib/pdfjs.ts:14` (`new PdfWorker()` at module load) via `src/export/exportMarkupPdf.ts:3`. Patch 16 (`6e69198`) added the `pdfjsLib` import to `exportMarkupPdf.ts`; in vitest's node environment the Vite `?worker` import is not a constructor, so the whole suite dies at import. CI has been red on this since Patch 16: runs **41951012970** (`6e69198`) and **41954930323**/**41954926772** (`3233a04`, Patch 17) failed identically BEFORE any Patch 18 change. Patch 18's own suite contribution (22 tests) passes behind that import crash.

### Patch 18 CI evidence (2026-11-05)

- **Run 41979228518** (`verify`, `Sys-Design-One`, head `3617378`): existing suite **FAILED** — 34/36 test files passed; the 2 failed suites were `tests/exportMarkupPdf.rotation.test.ts` (pre-existing import crash, above) and `tests/legendData.test.ts` (the fixture defect that drove the correction above). Checkout, setup-node, and `npm ci` passed.
- **Runs 41979657340** (`verify`, `Sys-Design-One`, head `aa05b8d`) and **41979660616** (`verify`, `main`, head `aa05b8d`): existing suite **FAILED** with exactly **one** finding — the pre-existing `pdfjs.ts:14` import crash (annotations identical to the `3233a04` baseline). Every Patch 18 test passes behind it: `tests/legendData.test.ts` **22/22 green** (no failure annotation for it, vs. the explicit one on `3617378`); 35/36 test files pass; `tsc -b`/`vite build` steps never run (the suite step aborts the job). The **Cloudflare `Workers Builds: sys-design-one` check on `aa05b8d` is SUCCESS** — the deploy pipeline is unaffected.
- Both branches verified at `aa05b8d472677a199d091c3c609a1859ef540b26` via `git ls-remote` after push. The suite cannot go green until the Patch 16-era `pdfjs.ts` module-load constructor is made lazy (or the rotation test's import is decoupled) — recorded above, awaiting user direction, deliberately not bundled into Patch 18's approved scope.
- No dev/preview/watch server started; no secrets written; evidence captured via the GitHub Actions API (`gh api` check-runs/annotations + `gh run view`).

## Patch 19 — Per-subcategory legend rows + side-panel legend placement (user-directed)

- **Source:** user instruction, 2026-11-05 — "make a plan to implement the subcategory and … the legend when exported to be added to the side, or an option to put it to the side (some floor plans don't have empty space)"; plan preserved in `../HANDOFF-PATCH19.md`; decisions answered 2026-11-05 (icon in disc / overlay default / **Other** row / strip spec) and approved with push ("Approved — implement + push").
- **Purpose:** the legend's DEVICES section now groups **per subcategory** (APs, Switches, Routers, Firewalls, Dome, Bullet, … — the same 19 values the standardized icons use) instead of per category, with the standardized subcategory icon drawn inside the category-colored disc; and each sheet can export its legend onto a **side panel** beside the plan instead of overlaying it — for floor plans with no empty space.
- **Reason:** per-category rows hid what actually sits on the sheet (a network row of switches+APs+routers reads as one line), and the overlay box covers plan linework on dense sheets. Per-subcategory rows + icons teach the same icon language the canvas uses; the side strip guarantees the legend never covers the drawing.
- **Decisions (2026-11-05):** row marker = subcategory icon inside the category-colored disc; placement default = `overlay` (field absent = overlay — every existing sheet/project unchanged); subcategory-less devices roll into one neutral **OTHER** row (label `OTHER`, qty = all such devices, neutral `#94A0B8` disc, no icon, last row of DEVICES); side strip = 200pt total, 180pt box, 12pt top margin, top-anchored, auto-height, capped at page height (clip with `+ N more` only on tiny sheets).
- **Changed files:**
  - `src/lib/legendData.ts` — `buildLegendData` regroups per subcategory (bucket: qty + category color + standardized icon read from the catalog record); `OTHER_ROW_LABEL`/`OTHER_ROW_COLOR` + fallback bucket; `LegendDeviceRow.icon?`; new side-strip geometry (`LEGEND_STRIP_WIDTH` 200, `LEGEND_STRIP_BOX_X` 10, `LEGEND_STRIP_TOP` 12, `sideLegendBounds(pageW, pageH, data)` — pdf page coords, y-up)
  - `src/store/projectStore.ts` — `Sheet.legendPlacement?: "overlay" | "side"` (absent = overlay)
  - `src/lib/projectFile.ts` — `LEGEND_PLACEMENTS` set + sheet-level union check when present (absent passes; malformed rejected)
  - `src/export/titleBlockRenderer.ts` — `drawLegend` accepts optional prebuilt `data` (side mode sizes the strip from the same model without rebuilding) and draws the row icon inside the disc: scale 8/24, `mixRgb(color, midnight, 0.78)` soft fill mirroring the placed device, stroke scaled `max(0.55, w*0.6)` for legend legibility; `mixRgb` helper mirrors `mix()` in exportMarkupPdf
  - `src/export/exportMarkupPdf.ts` — side mode: page widened to `pageWidth + LEGEND_STRIP_WIDTH` on all five page-creation paths (copied page → embedPage onto a fresh widened page with rotation baked, rotation≠0 → widened, raster fallback → widened page + sheet-sized image, raster/SVG underlays → widened page + sheet-sized image, blank → widened); legend bounds = `sideLegendBounds(pageW, pageH, legendData)` (native page coords — no app→page flip), prebuilt data passed to `drawLegend`; no legend content ⇒ original page size
  - `src/components/BrandPreview.tsx` — `LegendGhost` mirrors the icon-in-disc (token resolution identical to `DeviceIconNode`, 1/3 scale group); side mode renders a compact `LEGEND → SIDE PANEL` chip pinned inside the sheet edge instead of a fake box (the stage clips beyond sheet bounds — a full ghost would lie), still click-to-select
  - `src/components/LeftRail.tsx` — Sheet Branding section gains "Legend placement" toggle (On plan / Side panel, amber active state, per-sheet `updateSheet({ legendPlacement })`, explanatory caption)
  - `tests/legendData.test.ts` — extended (not weakened): per-subcategory grouping (Switches 2 models → 1 row; Dome/Bullet separate; disc = category color; row icon = the catalog-stamped object), OTHER row (all 7 subcategory-less devices → 1 neutral row, sorts last), unknown-id skip, `sideLegendBounds` (strip placement, auto-height math, page-height cap, minimum height), all prior clipping/label/19-icon assertions retained
  - `tests/projectFileValidation.test.ts` — extended: rejects `legendPlacement: "diagonal"`, accepts `"overlay"`/`"side"`, absent = undefined (old files fine)
- **Bid isolation (explicit):** `src/lib/bid.ts` untouched — legend regrouping is presentation-only; the cover-page DROPS fact (Patch 18) unchanged.
- **Verification (2026-11-05):**
  - `tsc -b` (Type_Check): **passed** — local run, on the full changed tree
  - `tsc --noEmit --strict` on both modified test files: **passed** (tests aren't covered by the project's `tsc -b`, which includes `src` only)
  - Functional smoke (tsc-emitted CJS copies, deleted after): real-catalog per-subcategory grouping (Switches 3 → 1 row qty 3; Dome/Bullet separate; category colors; icon = catalog-stamped object), OTHER row (7 devices → 1 neutral row, sorts last), unknown-id skip, sideLegendBounds (strip x/right/top-anchor/auto-height math, 100pt-page cap, minimum height), overlay layout regression — **all assertions passed**
  - `npm test` / `npm run build`: **via CI** (user-approved push below) — local runs impossible (child-process spawn EPERM); the pre-existing Patch 16 `pdfjs.ts:14` import crash (`CI-ERROR-NOTE.md`) still red-lines the suite step and is out of scope here
  - No dev/preview/watch server started; no secrets written; no existing test weakened, skipped, or deleted

### Patch 19 CI evidence (2026-11-05)

- **Runs 41986552114** (`verify`, `Sys-Design-One`, head `f5bdd60`) and **41986555458** (`verify`, `main`, head `f5bdd60`): existing suite **FAILED** with exactly **one** finding — the **pre-existing** `src/lib/pdfjs.ts:14` module-load crash (`TypeError: default is not a constructor` via `exportMarkupPdf.ts` → `tests/exportMarkupPdf.rotation.test.ts`), annotations byte-identical to the `aad0bc9`/`3233a04` baseline. **No Patch 19 failure annotations** — `tests/legendData.test.ts` (subcategory grouping, OTHER row, side bounds) and `tests/projectFileValidation.test.ts` (placement union) passed behind that import crash; `tsc -b`/`vite build` steps never run (the suite step aborts the job), same as every run since Patch 16.
- **Cloudflare `Workers Builds: sys-design-one` check on `f5bdd60`: SUCCESS** (completed after a short build queue) — the deploy pipeline builds the Patch 19 tree cleanly.
- Both branches verified at `f5bdd60ccf8a3b3a46dcc0831269014e8d1ec6af` via `git ls-remote` after push; working tree clean.
- The suite cannot go green until the Patch 16-era `pdfjs.ts` constructor is made lazy — recorded in `../CI-ERROR-NOTE.md`, awaiting user direction, deliberately out of Patch 19's approved scope.
- No dev/preview/watch server started; no secrets written; evidence captured via the GitHub Actions API (`gh api` check-runs/annotations + `gh run list`).
