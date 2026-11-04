## Purpose

Ensures package manifest and lockfile changes for the spreadsheet writer and the build toolchain happen only after explicit user approval, with the decision evidence an informed approval requires.

## ADDED Requirements

### Requirement: Package changes SHALL wait for explicit approval
While explicit user approval is absent, the fork SHALL keep `xlsx`, the package manifest, and the lockfile unchanged, and no new dependency SHALL be added until its source, exact version, maintenance status, license, audit status, reason, and compatibility risk are approved.

#### Scenario: Manifest frozen before approval
- **WHEN** any verification or build runs before dependency approval
- **THEN** `package.json` and `package-lock.json` are unchanged from the pinned commit

#### Scenario: Approval requests carry decision information
- **WHEN** approval is requested for a dependency change
- **THEN** the request states the package source, exact version, maintenance status, license, current audit findings, and compatibility risk

### Requirement: The spreadsheet writer SHALL move to an approved maintained source
Upon approval, the spreadsheet writer SHALL be replaced either by a SheetJS release from `cdn.sheetjs.com` at version 0.20.3 or later, pinned with integrity metadata in the lockfile, or by the separately approved writer package, and the dependency audit SHALL then report no known `xlsx` advisory applicable to the installed dependency graph.

#### Scenario: Approved replacement clears advisories
- **WHEN** the approved spreadsheet dependency is installed
- **THEN** the dependency audit reports no known `xlsx` advisory applicable to the installed dependency graph

#### Scenario: Bid export behavior preserved
- **WHEN** the bid XLSX regression test runs after the replacement
- **THEN** existing bid workbook behavior and formula-trigger text-cell behavior (see export-hygiene) are preserved

### Requirement: The build toolchain SHALL update to approved floors
Upon approval, the toolchain SHALL install Vite 6.4.4 or later within the approved major line (7.3.7 or later if major version 7 is approved), Vitest 4.1.12 or later, and esbuild 0.25 or later; SHALL classify `vitest` and `jsdom` as development dependencies; SHALL regenerate the lockfile from approved sources; and SHALL still pass the existing test suite and production build.

#### Scenario: Toolchain update verified end to end
- **WHEN** the approved toolchain update completes
- **THEN** the dependency audit reports the remaining applicable findings
- **AND** the existing test suite and production build pass
