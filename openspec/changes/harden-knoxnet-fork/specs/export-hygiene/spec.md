## Purpose

Keeps every value Knoxnet writes into CSV and XLSX exports inert, so text originating from drawings or project files can never execute as a spreadsheet formula.

## ADDED Requirements

### Requirement: CSV export SHALL neutralize formula triggers
The CSV exporter SHALL prepend a single apostrophe to any cell value beginning with a formula trigger (`=`, `+`, `-`, `@`, tab, carriage return) before applying CSV quoting.

#### Scenario: Hyperlink formula neutralized
- **WHEN** `csvCell()` receives `=HYPERLINK("x")`
- **THEN** the exported value is apostrophe-prefixed before CSV quoting is applied

#### Scenario: Arithmetic and reference triggers neutralized
- **WHEN** `csvCell()` receives `+1`, `-1`, or `@SUM(1)`
- **THEN** the exported value is apostrophe-prefixed before CSV quoting is applied

#### Scenario: Whitespace-prefixed triggers neutralized
- **WHEN** `csvCell()` receives a value beginning with a tab or carriage return
- **THEN** the exported value is apostrophe-prefixed before CSV quoting is applied

#### Scenario: Ordinary values unchanged
- **WHEN** `csvCell()` receives a value that does not begin with a formula trigger
- **THEN** the existing value and quoting behavior is preserved

### Requirement: CSV neutralization SHALL cover all exported text
All device names, notes, labels, and other drawing-supplied text exported as CSV SHALL pass through the neutralizing cell writer consistently.

#### Scenario: Device-supplied text in any CSV field
- **WHEN** the CSV report exporter writes device names, notes, or labels that begin with a formula trigger
- **THEN** every such cell is neutralized consistently

### Requirement: XLSX export SHALL write trigger values as text cells
The XLSX export paths (`src/export/exportBid.ts` and `src/reports/formats/xlsx.ts`) SHALL write any value beginning with a formula trigger as a text cell, never as a formula cell.

#### Scenario: Trigger values export as text
- **WHEN** the XLSX exporter writes a value beginning with a formula trigger
- **THEN** the generated workbook exposes the value as text with no formula property

#### Scenario: Regression coverage after the gated package replacement
- **GIVEN** the gated `xlsx` package replacement (see dependency-governance) has been applied
- **WHEN** the bid XLSX regression test runs with formula-trigger fixtures
- **THEN** text-cell behavior is preserved and existing bid workbook behavior is unchanged
