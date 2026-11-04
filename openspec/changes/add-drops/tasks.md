# Tasks

## 1. Data model & store

- [x] 1.1 `DropMarkup` interface + `Markup` union + `MarkupKind` (`src/store/projectStore.ts`): kind, number, faceplateId, x/y, labelOffsetX/Y, jackType, service, mount, heightInches, notes
- [x] 1.2 Store actions: place N drops at a point (shared faceplateId, consecutive numbers), update drop fields, faceplate group move/delete; undo/redo coverage
- [x] 1.3 `LayerId` "drop" + `DEFAULT_LAYERS` entry; `ReportScope` "drops"; `dropLabelScheme` project setting (default D / - / 3 digits)

## 2. Numbering

- [x] 2.1 New `src/lib/dropLabels.ts`: `DropLabelScheme`, defaults, resolve, next-number assignment (per-project, collision-tolerant, stable)
- [x] 2.2 SettingsDrawer section: prefix / separator / min digits

## 3. Project file & validation

- [x] 3.1 `ALLOWED_MARKUP_KINDS` + `drop`; validator: require number + faceplateId (identifier caps), service/mount union checks when present, finite heightInches, notes long-text cap
- [x] 3.2 `src/lib/validation.ts`: duplicate drop-number warning
- [x] 3.3 Tests: pre-drop file back-compat; drop round-trip; malformed drop rejected (`tests/dropProjectFile.test.ts`; the pinned `ALLOWED_MARKUP_KINDS` assertion in `projectFileValidation.test.ts` extended with `"drop"` per the spec's file-compatibility requirement — still pins the exact list)

## 4. Editor

- [x] 4.1 Toolbar drop tool + `J` hotkey + jack-count stepper (1–6, default 1)
- [x] 4.2 `useToolGesture` click-to-place creating the faceplate group
- [x] 4.3 Canvas drop node: plate symbol, ×N badge, number label (range form for multi-jack), group select/move/delete, drop layer
- [x] 4.4 PropertiesPanel: per-jack editing (number, jackType, service, mount, heightInches, notes) + faceplate-group editor for drops-only selections
- [x] 4.5 Markup PDF export: plate symbol + labels, badge, label offsets honored
- [x] 4.6 Kind-enumeration chrome: SelectionActionBar `labelFor` + `computeBBox` cases, LeftRail `KIND_META` "Drops" entry, CommandPalette "Network Drop" command

## 5. Cabling

- [x] 5.1 `src/lib/cableRuns.ts` + cable tool snapping: drop endpoints, first-jack-without-a-cable rule (ordered by drop number), endpoint label = drop number; no auto-cabling; cables follow a moved plate (`moveDropMarkup` rewrites attached runs like devices)

## 6. Reports

- [x] 6.1 `selectDrops` flattener in `engine.ts` + `ReportScope` "drops" + SCOPE_LABEL
- [x] 6.2 `fieldCatalog.ts` drops entries: number, faceplateId, faceplateJackCount, jackType, service, mount, heightInches, notes, sheet
- [x] 6.3 "Drops Schedule" starter template: groupBy faceplate, columns incl. Notes, totals (jacks + faceplates) in document-layout formats (PDF, XLSX, HTML, Markdown); CSV/JSON stay pure data; XLSX group sheets named by drop-number range
- [x] 6.4 Tests: scope selection, template run, totals, all six formats (`tests/drops.test.ts`)

## 7. Bid isolation

- [x] 7.1 Regression test: identical bid totals with and without drops; no drop pricing surface (`tests/drops.test.ts`)

## 8. Ship

- [x] 8.1 `tsc -b` local pass
- [x] 8.2 PATCHES.md register entry (source: user decisions 2026-11-04; changed files; verification)
- [ ] 8.3 Commit + push both branches (user approval) + CI green recorded
