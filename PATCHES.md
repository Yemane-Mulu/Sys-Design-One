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
