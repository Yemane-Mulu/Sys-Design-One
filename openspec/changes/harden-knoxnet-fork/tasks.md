# Tasks

## 1. Security fixes (KNOXNET-FIXES Source_Fix_Items 1–8)

- [x] 1.1 Patch 1 — SFI 1: CSV/XLSX formula neutralization (`csvCell()` apostrophe prefix, text cells, 9 tests)
- [x] 1.2 Patch 2 — SFI 2: PDF.js `isEvalSupported: false`; `loadPdfFromUrl`/`ingestPdfFromUrl` removed with all re-exports; static + B4-equivalent tests
- [x] 1.3 Patch 3 — SFI 3: 50 MB import cap / 100 MB `.knoxnet` cap / 100-megapixel raster cap, friendly errors, B7/B9-equivalent timing tests
- [x] 1.4 Patch 4 — SFI 4: `.knoxnet` structural validation (arrays, markup kinds, finite numbers, 500/10k string classes), round-trip equivalence
- [x] 1.5 Patch 5 — SFI 5: self-hosted Inter + JetBrains Mono with OFL licenses; all external font links removed; A1-equivalent source checks
- [ ] 1.6 Patch 8 — SFI 6: replace `xlsx` with SheetJS 0.20.3 from `cdn.sheetjs.com` — **Gate A approval pending** (package presented 2026-11-04)
- [ ] 1.7 Patch 9 — SFI 7: Vite 7.3.7 + Vitest 4.1.12 + plugin-react 5.2.0; vitest/jsdom to devDependencies — **Gate B approval pending** (package presented 2026-11-04)
- [x] 1.8 Patch 6 — SFI 8: SettingsDrawer labels render as `{label}` text; raw-HTML sink removed; behavioral escaping proof

## 2. Catalog replacement (Requirement 10)

- [x] 2.1 Patch 7 — wholesale replacement with the supplied catalogs; 11 verbatim compatibility retentions (reference-evidenced); Catalog_Validator test; post-replacement reference sweep recorded

## 3. Verification (Requirement 11)

- [ ] 3.1 Gate D push approval; CI runs the complete existing test suite, `tsc -b`, and production build on GitHub-hosted runners
- [ ] 3.2 Record CI results per patch in PATCHES.md; run post-gate `npm audit` and record remaining findings
- [ ] 3.3 Confirm no existing test weakened, skipped, or deleted anywhere in the change set

## Workflow follow-up

- Archive the OpenSpec change (`harden-knoxnet-fork`) after the project's review requirements are satisfied and verification evidence is complete.
- Update the fork's `Destination_Fork` glossary line in the source requirements document to reflect the `Sys-Design-One` rename.
