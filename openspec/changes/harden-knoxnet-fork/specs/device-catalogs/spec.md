## Purpose

Makes the supplied researched device and rack-device catalogs the complete source of truth for Knoxnet's catalogs, replaced wholesale, without spreadsheet conversion or record-by-record merging.

## ADDED Requirements

### Requirement: Catalog files SHALL be replaced wholesale with the supplied catalogs
The fork SHALL replace the complete upstream `src/data/devices.ts` with the supplied device catalog and the complete upstream `src/data/rackDevices.ts` with the supplied rack catalog, using the supplied TypeScript files directly and preserving every supplied import, export, interface, lookup map, and helper function compatible with the pinned commit.

#### Scenario: Wholesale replacement, no merge
- **WHEN** catalog replacement completes
- **THEN** each upstream catalog file is replaced in full by its supplied counterpart with no spreadsheet conversion and no record merging

#### Scenario: Minimum corrections are logged
- **WHEN** a supplied import, export, interface, or helper is incompatible with the pinned commit
- **THEN** the minimum correction required for compatibility is made
- **AND** the patch register records the original value, corrected value, reason, affected file, and verification result

### Requirement: Catalogs SHALL satisfy the validation contract
Each catalog record SHALL carry a category allowed by the corresponding supplied category union and SHALL match the corresponding supplied interface shape; identifiers SHALL be unique within each catalog; and every reference ID used elsewhere in Knoxnet SHALL resolve through the corresponding exported lookup map.

#### Scenario: Validator passes on the supplied catalogs
- **WHEN** the catalog validator checks each supplied catalog
- **THEN** categories, shapes, unique identifiers, and reference resolution all pass

#### Scenario: Duplicate identifiers rejected
- **WHEN** the existing `duplicateDevices.test.ts` runs against the replaced catalogs
- **THEN** it passes, and no existing test or assertion is weakened, skipped, or deleted

### Requirement: UI behavior SHALL be preserved over the replacement catalogs
The application UI SHALL preserve existing catalog selection, rendering, and lookup behavior when reading the replacement catalogs.

#### Scenario: Type check and full suite pass
- **WHEN** catalog replacement is complete
- **THEN** the type check completes successfully and the entire existing test suite passes
