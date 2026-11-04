# Design

## Context

DesignOne at `24a14fc` — the hardened fork with all KNOXNET-FIXES v2 work complete and CI green. The markup architecture is uniform: 11 kinds in the `Markup` union (`src/store/projectStore.ts`), uniform store CRUD with undo/redo, a pinned 11-kind allow-list in the `.knoxnet` validator (`src/lib/projectFile.ts`), and per-kind rendering in the editor plus vector rendering in the markup PDF export. Cable runs attach endpoints to placed devices through `CableRunEndpoint` metadata. Reports run scope → filter → group → sort over flattened rows (`src/reports/engine.ts`; `selectRackPlacements` at ~240 is the precedent for adding a scope). The bid aggregates devices, cables, and rack devices (`src/lib/bid.ts`). Every precedent this feature needs exists in-repo; the implementation map is in HANDOFF.md.

Verification follows the fork's discipline: `tsc -b` locally; the complete suite and production build on GitHub Actions CI after push.

## Goals / Non-Goals

**Goals:**
- Documentation-only drops: mark where data jacks are needed, number them per project, group them onto faceplates (1–6 jacks), terminate cable runs at them, report them
- Zero bid impact, pinned by regression test
- Existing project files remain valid; additive format change only

**Non-Goals:**
- Any drop pricing, labor, or bid line — excluded by user decision (2026-11-04): drops are not work this shop bills
- Faceplate as a separately managed entity or with its own numbering — it is only a grouping identifier
- Adding or removing jacks on a faceplate after placement — the placement-time stepper is the only count control in phase 1
- Automatic cable creation to drops
- Drop devices in the device catalog — rejected alternative: drops carry no ports or systemConfig
- Forward compatibility — older DesignOne builds reject files containing drops (unknown markup kind); accepted
- Drops in the signal-flow diagram view

## Decisions

1. **Drop-as-markup, not drop-as-device** (user decision 1A): drops carry no ports or commissioning data; they ride the uniform markup CRUD, validator, and rendering paths.
2. **One drop = one jack; faceplate = group** (user decision, 2026-11-04): a shared `faceplateId` groups 1–6 drops placed at one location. The faceplate has no independent identity, number, or CRUD; report grouping and canvas grouping derive from the identifier. The placement-time stepper (1–6, default 1) is the only count control.
3. **Field shape**: `number` (string, e.g. "D-001"), `faceplateId`, `jackType` (free-form string, default "Cat6 keystone" — vendor variety is too wide for an enum), `service` (union: data / PoE / voice / coax / fiber), `mount` (union: wall / floor / ceiling / pole / box), `heightInches` (optional finite number, AFF), `notes` (free text, long-text cap). Label positioning mirrors the device-tag pattern (`labelOffsetX` / `labelOffsetY`).
4. **Numbering** (user decisions 3A/4A): per-project, stable with gaps, `D-001` default; scheme (prefix / separator / min digits) stored on the project with the same data shape as `CableLabelScheme` (`src/lib/cableLabels.ts`); assignment reuses the cable-label algorithm shape — next unused number, collision-tolerant of manual numbers. Stability is a documentation requirement: numbers must never shift under reports or handouts. Note: the cable label scheme is data-model-only (no UI edits it); the drop scheme adds a small Settings section (three inputs) because the approved plan promises Settings configurability — a deliberately new, bounded surface.
5. **Group UX** (user decision 2A): one plate symbol with a ×N count badge for multi-jack plates; group-level select, move, delete; per-jack field editing in the Properties panel. Single-jack plates render without a badge. Number labels render in range form (e.g. "D-001–D-004 ×4").
6. **Cable attachment**: endpoint semantics like devices; deterministic first-jack-without-a-cable rule (ordered by drop number) — no picker UI. No automatic cable creation.
7. **Bid isolation**: no touch to `bid.ts`; a new regression test computes bid totals for a project with and without drops and asserts equality. No drop pricing surface exists in Settings beyond the label scheme.
8. **File format**: additive only — `drop` joins `ALLOWED_MARKUP_KINDS`; required discriminator fields for `drop` markups are `number` and `faceplateId` (identifier-class caps); `service` / `mount` validated against their unions when present; `heightInches` must be finite; `notes` long-text cap; no `.knoxnet` version bump; pre-drop files unchanged.
9. **Report totals**: the engine exposes row and group counts; the Drops Schedule template renders a totals line (total jacks, total faceplates) in the document-layout formats (PDF, XLSX, HTML, Markdown), gated on a template flag. CSV and JSON remain pure row data — totals are derivable and data purity is more useful. XLSX keeps its existing Summary sheet.
10. **Layer**: a new `drop` layer id in `DEFAULT_LAYERS`, labeled "Drops", following the existing auto-layer pattern.

## Risks / Trade-offs

- Stable numbering leaves gaps after deletion — accepted and specified; identifiers must never shift.
- Group selection touches hit-testing and drag state — mitigated by resolving faceplate groups to their member markup ids and reusing the existing multi-select machinery.
- Stale cable endpoint metadata if an attached drop is deleted — the cable's drawn geometry (its stored points) is unaffected; endpoint labels degrade the same way they do for deleted devices today. Attachments are advisory metadata; no new dangling-reference crash path.
- The totals line touches the format writers — bounded to the document-layout formats and gated on the template flag; CSV/JSON untouched.
- Older builds reject drop-containing files (unknown markup kind) — inherent to additive format changes; recorded in the register when shipped.
