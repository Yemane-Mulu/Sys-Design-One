# Design

## Context

The pinned upstream (`7bae0cd3746fa8904bc53f206e0a9961dad62738`) is a Vite 5 / React 18 / TypeScript browser application that ingests untrusted files (PDF, DXF, raster, `.knoxnet`) and exports CSV/XLSX/PDF built from drawing-supplied text. The hardening work runs on the `Sys-Design-One` branch of the fork `Yemane-Mulu/Sys-Design-One`, one auditable Patch_Commit per fix, ledgered in `PATCHES.md`. Verification is non-interactive: `tsc -b` locally; the complete existing test suite and production build run on GitHub Actions CI (`.github/workflows/verify.yml`) because local production builds are excluded by user direction.

## Goals / Non-Goals

**Goals:**
- KNOXNET-FIXES Source_Fix_Items 1–8 and the wholesale catalog replacement, each as one reviewable Patch_Commit with a register entry
- Every security outcome of the historical A1/B4/B7/B9 lab checks preserved via automated tests and static source scans
- Dependency changes only through Gates A/B with recorded decision evidence; pushes only through Gate D

**Non-Goals:**
- ERPNext integration, deployment topology, hosting, CSP/CORS (source doc Out of Scope)
- The optional DXF Web Worker; content sniffing/MIME enforcement; PDF page-count limits; raster metadata stripping (deferred risks)
- The Stage_2_Lab (excluded by the source doc)

## Decisions

1. **Working branch:** `Sys-Design-One` (user instruction, 2026-11-04) — resolves source-doc Open Design Decision 1.
2. **Catalog destination paths:** `src/data/devices.ts` and `src/data/rackDevices.ts`, confirmed present at the pin — resolves ODD 2.
3. **Project-file string limits:** identifier-class 500 chars, free-form 10,000 chars, as exported constants (`PROJECT_TEXT_LIMITS`); payload fields (base64, SVG source, logo data URLs) type-checked only, bounded by the 100 MB Project_File_Cap — resolves ODD 3.
4. **Allowed markup kinds:** the pinned commit's 11-kind `Markup` union, exported as `ALLOWED_MARKUP_KINDS` — resolves ODD 4.
5. **Imported_File_Cap configuration:** exported `setImportedFileCap()` + module constant, no new dependency — resolves ODD 5.
6. **Rejection-timing verification:** O(1) size/dimension guards measured with `Date.now()` around the call; B7/B9 equivalents settle trivially under the 2-second budget — resolves ODD 6.
7. **Spreadsheet writer:** SheetJS `0.20.3` from the official `cdn.sheetjs.com` tarball (Apache-2.0, actively maintained, clears both npm HIGH advisories). Gate A package presented 2026-11-04 with audit evidence; awaiting explicit approval — resolves ODD 7 pending approval.
8. **Vite major line:** 7 (proposed `7.3.7`, with `vitest@4.1.12` and `@vitejs/plugin-react@5.2.0`; Vite 8 exists but is outside the source doc's contemplated lines 6/7). Gate B package presented 2026-11-04; awaiting explicit approval — resolves ODD 8 pending approval. Recommended over line 6 for the longer support runway.
9. **Fonts:** variable Inter (`InterVariable.woff2`, weights 100–900) + static JetBrains Mono at exactly the app's used weights (400/500/600) from the official GitHub releases, licenses shipped in `public/fonts/` — resolves the font-packaging approach.
10. **Catalog compatibility:** 11 upstream records retained verbatim inside the supplied catalogs (reference-evidenced in PATCHES.md); the post-replacement reference sweep (204 upstream ids × 138 files) confirmed all other cross-references are inert by design with graceful fallbacks (`getCoveragePreset` category fallback, `rackDeviceIdForNestedDevice` null default, inert `ROUTE_INFRA_DEVICE_IDS` entries) — resolves ODD 11.

## Risks / Trade-offs

- CI-only build evidence until Gate D is approved → all seven local patches carry local type-check evidence only; CI proves tests + build on push.
- 16 npm audit findings remain until Gates A/B land (2 critical tinypool via vitest 2.1.9; xlsx HIGH with no npm fix) → recorded; gates presented.
- Supplied-catalog site-infrastructure devices are not in `ROUTE_INFRA_DEVICE_IDS` → deferred observation in the register; no acceptance criterion requires the `src/lib` change.
- Catalog source-data errors that compile successfully → per the source doc, corrected only when proven by validation, compatibility, or existing tests.
