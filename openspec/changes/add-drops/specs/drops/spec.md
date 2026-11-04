## Purpose

Makes network drops first-class, documentation-only markup: the designer marks where data jacks are needed, the application numbers them per project, groups them onto faceplates of one to six jacks, lets cable runs terminate at them, and reports them through the report builder. Drops never affect the bid.

## ADDED Requirements

### Requirement: A drop SHALL be a markup kind representing exactly one jack
The application SHALL support a `drop` markup kind in the `Markup` union. Each drop SHALL represent exactly one jack and carry a drop number, a faceplate grouping identifier, and per-jack fields: jack/outlet type, service type, mount location, install height, and free-text notes.

#### Scenario: Single-jack placement
- **WHEN** the drop tool places one jack at a location
- **THEN** exactly one `drop` markup is created with its own drop number and a faceplate grouping identifier

#### Scenario: Multi-jack faceplate placement
- **WHEN** the drop tool places two to six jacks at one location
- **THEN** one `drop` markup is created per jack, all sharing one faceplate grouping identifier, each with its own consecutive drop number

#### Scenario: Per-jack fields stay independent
- **WHEN** multiple drops share a faceplate grouping identifier
- **THEN** each drop keeps its own jack/outlet type, service, mount location, install height, and notes, so one faceplate may carry differing jack types and services

### Requirement: Drop numbers SHALL be assigned per project and remain stable
Drop numbers SHALL be assigned automatically at placement using the configured scheme (default prefix `D`, separator `-`, three digits) across the whole project, and SHALL NOT re-sequence when drops are deleted. The scheme SHALL be configurable in Settings and SHALL affect only newly placed drops.

#### Scenario: Next number at placement
- **WHEN** a drop is placed in a project whose existing drops are numbered D-001 through D-003
- **THEN** it receives D-004

#### Scenario: Deletion leaves a gap
- **WHEN** a drop is deleted
- **THEN** the numbers of all remaining drops are unchanged

#### Scenario: One sequence across sheets
- **WHEN** drops are placed on different sheets of one project
- **THEN** they draw from a single project-wide number sequence

#### Scenario: Scheme change applies to new drops only
- **WHEN** the drop label scheme is changed in Settings
- **THEN** subsequently placed drops use the new scheme and existing drop numbers are unchanged

#### Scenario: Duplicate numbers warn
- **WHEN** a manual edit produces two drops with the same number
- **THEN** a non-blocking validation warning reports the duplicate

### Requirement: Drops SHALL be placed and edited in the sheet editor
The sheet editor SHALL provide a drop tool with hotkey `J`, a jack-count stepper accepting 1–6 (default 1), and placement by click. A faceplate holding more than one jack SHALL render as a single plate symbol with a count badge and SHALL select, move, and delete as one unit. The Properties panel SHALL list each jack of a selected faceplate for per-jack field editing. Drops SHALL occupy their own layer and SHALL render in the markup PDF export with their drop numbers as labels.

#### Scenario: Stepper then click
- **WHEN** the drop tool is active with the stepper set to 3 and the sheet is clicked
- **THEN** three drops are placed at that location sharing one faceplate grouping identifier

#### Scenario: Group selection and move
- **WHEN** a multi-jack faceplate symbol is selected and dragged
- **THEN** all of its jacks move together and the selection covers exactly the faceplate's drops

#### Scenario: Group deletion
- **WHEN** a multi-jack faceplate symbol is deleted
- **THEN** all of its jacks are deleted together and undo restores all of them

#### Scenario: Per-jack editing
- **WHEN** a faceplate is selected
- **THEN** the Properties panel lists each jack with its number and editable jack/outlet type, service, mount location, install height, and notes

#### Scenario: Layer control
- **WHEN** the drop layer is hidden or locked
- **THEN** drops hide or resist editing accordingly

#### Scenario: Markup PDF export
- **WHEN** the branded markup PDF is exported
- **THEN** each faceplate renders with its plate symbol and a label naming its drop numbers (range form for multi-jack plates)

### Requirement: Cable runs SHALL be able to terminate at a drop
A cable run endpoint SHALL attach to a drop with the same endpoint semantics as a placed device, and the run's endpoint label SHALL name the attached drop's number. When the endpoint lands on a multi-jack faceplate, the run SHALL attach to the first jack (by drop number) that does not already have a cable attached. Placing drops SHALL NOT create cable runs.

#### Scenario: Termination and label
- **WHEN** a cable run's endpoint is placed on a drop
- **THEN** the run terminates at that drop and its endpoint label names the drop's number

#### Scenario: First jack without a cable
- **WHEN** a cable run's endpoint lands on a faceplate whose jacks D-001 and D-003 already terminate cables
- **THEN** the run attaches to D-002 and its endpoint label names D-002

#### Scenario: No automatic cabling
- **WHEN** drops are placed
- **THEN** no cable run is created automatically

### Requirement: Drops SHALL be reportable through the report builder
The report builder SHALL offer a `drops` scope with fields covering drop number, faceplate grouping identifier, faceplate jack count, jack/outlet type, service, mount location, install height, notes, and sheet. A bundled "Drops Schedule" starter template SHALL group by faceplate, include a notes column, and report total jacks and total faceplates in the document-layout formats (PDF, XLSX, HTML, Markdown); CSV and JSON SHALL remain pure row data.

#### Scenario: Scope is available
- **WHEN** a report is built
- **THEN** the `drops` scope is selectable with its fields filterable, groupable, sortable, and exportable like every other scope

#### Scenario: Starter template runs
- **WHEN** the Drops Schedule template runs on a project with faceplates
- **THEN** rows group by faceplate, each jack appears with its number and fields, and the notes column is present

#### Scenario: Totals
- **WHEN** the Drops Schedule renders as PDF or XLSX
- **THEN** the output states the total number of jacks and the total number of faceplates

#### Scenario: All six formats
- **WHEN** the Drops Schedule generates
- **THEN** PDF, XLSX, CSV, JSON, Markdown, and HTML outputs all succeed

### Requirement: Drops SHALL NOT affect the bid
Drops SHALL NOT introduce any material, labor, cost, pricing, or settings into the bid pipeline. Bid totals SHALL be identical for a project with drops and the same project without them.

#### Scenario: Bid totals unchanged
- **WHEN** the bid is computed for a project, then for the same project with drops added
- **THEN** every bid total (material, labor, overhead, tax, margin, grand total) is identical

#### Scenario: No drop pricing surface
- **WHEN** Settings and the bid panel are inspected
- **THEN** no drop pricing, labor, or rate field exists

### Requirement: Project files SHALL remain compatible
The `drop` markup kind SHALL be added to the allowed markup kinds of the `.knoxnet` importer. Project files created before this change SHALL load unchanged, and projects containing drops SHALL export and re-import losslessly, without a format version change.

#### Scenario: Pre-drop files load unchanged
- **WHEN** a project file created before this change is opened
- **THEN** it loads and validates exactly as before

#### Scenario: Drop files round-trip
- **WHEN** a project containing drops is exported and re-imported
- **THEN** every drop survives with its number, faceplate grouping identifier, and fields intact

#### Scenario: Malformed drop data is rejected
- **WHEN** an imported project file contains a `drop` markup missing its drop number or faceplate grouping identifier
- **THEN** the import is rejected with a friendly error before any project loads
