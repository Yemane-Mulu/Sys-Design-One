## Why

DesignOne's markup vocabulary can only mark "data is needed here" with free text or callouts — disconnected from numbering, cabling, and reporting. During client walkthroughs the designer marks where network drops must be installed; those marks are documentation for the client and for whoever runs the cable later. They are not work this shop performs or bills, so they must never alter the bid.

## What Changes

- New `drop` markup kind: one drop = one jack. Drops placed at the same location group onto a faceplate (shared `faceplateId`, 1–6 jacks per plate), and each jack carries its own fields — jack/outlet type, service, mount location, install height (AFF), and notes
- Automatic numbering `D-001`…: per-project, stable (gaps persist after deletion), scheme (prefix / separator / min digits) stored on the project like the cable label scheme and editable through a small Settings section (new — the cable scheme itself has no settings UI)
- Editor: place-drop tool (hotkey `J`) with a jack-count stepper (1–6, default 1); a multi-jack faceplate renders as one plate symbol with a count badge and selects, moves, and deletes as one unit; per-jack editing in the Properties panel; drops get their own layer; drops render in the markup PDF export with their numbers as labels
- Cable runs can terminate at a drop — endpoint semantics like devices; snapping to a multi-jack faceplate attaches to the first jack (by drop number) without a cable, and the run's endpoint label names that jack's drop number; no cables are created automatically
- New `drops` report scope plus a bundled "Drops Schedule" starter template: grouped by faceplate, notes column, totals for jacks and faceplates, across the existing six export formats
- `.knoxnet` compatibility: `drop` joins `ALLOWED_MARKUP_KINDS`; project files created before this change remain valid; no format version bump
- The bid is untouched: no drop pricing, labor, or settings exist anywhere, and a regression test proves bid totals are identical with and without drops

## Capabilities

### New Capabilities

- `drops`: First-class, documentation-only network drops — numbered per project, grouped onto faceplates of 1–6 jacks, cable-terminable, reportable through the report builder, with zero effect on the bid.

### Modified Capabilities

_None — `drops` is additive. Every existing capability keeps its behavior; the bid pipeline is additionally pinned by a regression test._

## Impact

- `src/store/projectStore.ts` — `DropMarkup` in the `Markup` union; faceplate grouping; store CRUD and undo/redo; `LayerId` + `ReportScope` extensions; `dropLabelScheme` project setting
- `src/lib/dropLabels.ts` (new) — drop numbering scheme and assignment, mirroring `src/lib/cableLabels.ts`
- `src/lib/projectFile.ts` — `ALLOWED_MARKUP_KINDS` + drop payload validation
- `src/lib/validation.ts` — duplicate drop-number warning
- `src/lib/cableRuns.ts` — drop endpoint attachment (first jack without a cable)
- `src/components/Toolbar.tsx`, `src/hooks/useToolGesture.tsx`, `src/hooks/useGlobalHotkeys.ts`, `src/components/CommandPalette.tsx` — drop tool, `J` hotkey, jack-count stepper, command-palette entry
- `src/components/MarkupLayer.tsx` + new drop node component — plate symbol, count badge, group select/move/delete, `drop` layer
- `src/components/SelectionActionBar.tsx`, `src/components/LeftRail.tsx` — per-kind selection label + bounding box, layer list entry and count
- `src/components/PropertiesPanel.tsx` — per-jack field editing
- `src/components/SettingsDrawer.tsx` — drop label scheme section
- `src/reports/engine.ts`, `src/reports/fieldCatalog.ts`, `src/reports/starterTemplates.ts` — `drops` scope, field catalog, Drops Schedule template, totals
- `src/export/exportMarkupPdf.ts` — drop symbol + label rendering
- `tests/` — new drop specs (numbering, validator back-compat, report scope + template, cable association, bid isolation); every existing test preserved unweakened
- `PATCHES.md` — register entry
