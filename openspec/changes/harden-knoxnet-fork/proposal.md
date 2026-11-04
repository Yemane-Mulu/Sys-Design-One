## Why

Knoxnet ingests untrusted files (PDF, DXF, images, `.knoxnet` projects) and exports spreadsheets built from drawing-supplied text, but the pinned upstream (`7bae0cd3746fa8904bc53f206e0a9961dad62738`) ships a PDF.js version exposed to CVE-2024-4367, formula-triggerable CSV/XLSX cells, no import size limits, an abandoned `xlsx` package, a vulnerable build toolchain, remote font loading, and a raw-HTML sink in the settings drawer. Before this app touches business workflows, we need a controlled hardened fork — pinned to one upstream commit, patch-audited, and carrying the researched device catalogs.

## What Changes

- Neutralize spreadsheet formula triggers in CSV and XLSX exports (apostrophe prefix in `csvCell()`; text cells in the XLSX writers)
- Harden the PDF engine (`isEvalSupported: false`, `pdfjs-dist` ≥ 4.2.67) and remove all URL-based PDF ingestion paths
- Enforce import limits: 50 MB per imported file, 100 MB per `.knoxnet` file, ~100-megapixel decoded raster cap — each rejected in under 2 seconds with a friendly error
- Validate `.knoxnet` project structure (top-level shape, markup kinds, finite numbers, bounded strings) with parse → serialize → parse equivalence
- Self-host Inter and JetBrains Mono under `public/fonts/` with license files; remove all external font links
- Replace the abandoned npm `xlsx@0.18.5` and update the Vite/Vitest/esbuild toolchain — both held behind explicit approval gates; manifests and lockfiles frozen until approved
- Render settings labels through React text expressions, removing the `dangerouslySetInnerHTML` sink
- Replace `src/data/devices.ts` and `src/data/rackDevices.ts` wholesale with the supplied researched catalogs (no spreadsheet conversion, no record merging)
- Govern all of it: one patch commit per fix, a `PATCHES.md` register, no pushes or package changes without explicit user approval, verification through non-interactive commands only

## Capabilities

### New Capabilities

- `export-hygiene`: Exported CSV and XLSX cells treat drawing-supplied text as inert text, never as executable formulas.
- `ingest-hardening`: Ingesting untrusted PDFs, images, DXF, and `.knoxnet` files is bounded, validated, and free of URL-fetch and dynamic-evaluation paths.
- `self-hosted-assets`: Application fonts load exclusively from the application origin, with licenses preserved.
- `dependency-governance`: Package and toolchain changes happen only through explicit approval gates with recorded decision evidence.
- `settings-ui`: Settings controls render labels as text, with no raw-HTML rendering path.
- `device-catalogs`: Device and rack-device catalogs come wholesale from the supplied researched files and satisfy compatibility, uniqueness, and reference-validity contracts.
- `fork-governance`: The hardened fork's lineage, patch record, verification, and approval gates (kept lean; the spec layer leads with application security behavior).

### Modified Capabilities

_None — upstream has no `openspec/` directory; this change creates the spec layer in the fork._

## Impact

- `src/reports/formats/csv.ts`, `src/export/exportBid.ts`, `src/reports/formats/xlsx.ts` — formula neutralization
- `src/lib/pdfjs.ts`, `src/lib/ingest/pdfIngest.ts`, `src/lib/ingest/index.ts`, `src/lib/ingest.ts` — PDF hardening, URL ingestion removal
- `src/lib/ingest/index.ts`, `src/lib/projectFile.ts`, `src/lib/ingest/rasterIngest.ts` — size/pixel caps, `.knoxnet` validation
- `index.html`, `src/styles.css`, `public/fonts/` — font self-hosting
- `package.json`, `package-lock.json` — gated changes only (SheetJS ≥ 0.20.3 from `cdn.sheetjs.com` or an approved alternative; Vite 6.4.4+/7.3.7+, Vitest 4.1.12+, esbuild 0.25+)
- `src/components/SettingsDrawer.tsx` — label rendering
- `src/data/devices.ts`, `src/data/rackDevices.ts` — wholesale catalog replacement
- `PATCHES.md` — new patch register
- `tests/` — new hardening and catalog tests; every existing test preserved unweakened
