## Purpose

Bounds and validates every path that ingests untrusted files into Knoxnet — PDFs, raster images, DXF, and `.knoxnet` projects — so hostile input cannot execute code, fetch URLs, or exhaust browser memory.

## ADDED Requirements

### Requirement: The PDF engine SHALL disable dynamic evaluation
The PDF engine SHALL pass `isEvalSupported: false` in the same document options object as `getDocument({ data })`, and SHALL use `pdfjs-dist` version 4.2.67 or later.

#### Scenario: Local PDF renders with evaluation disabled
- **WHEN** the integration test imports and renders a representative valid local PDF fixture
- **THEN** the existing expected PDF behavior completes with dynamic evaluation disabled

#### Scenario: No eval-enabled paths survive the build
- **WHEN** the static production-build check scans source and build artifacts
- **THEN** zero PDF.js application paths explicitly enable dynamic evaluation or rely on the enabled default

### Requirement: URL-based PDF ingestion SHALL be removed
The hardened fork SHALL expose PDF ingestion from local file data only, with `loadPdfFromUrl()` and `ingestPdfFromUrl()` — including every re-export — removed from the public surface.

#### Scenario: No URL PDF API in the public surface
- **WHEN** the hardened fork's modules are inspected
- **THEN** neither `loadPdfFromUrl()` nor `ingestPdfFromUrl()` is exported from `src/lib/pdfjs.ts`, `src/lib/ingest/pdfIngest.ts`, `src/lib/ingest/index.ts`, or `src/lib/ingest.ts`

### Requirement: Imported files SHALL be rejected above the size cap
The import coordinator SHALL reject any file larger than the imported-file cap (initialized to 50 MB) before reading file contents.

#### Scenario: Oversized DXF rejected quickly
- **WHEN** `ingestFile()` receives a 150 MB DXF fixture
- **THEN** the rejection settles in under 2 seconds without reading the file contents
- **AND** a friendly error names the file-size limit

#### Scenario: At-cap files still ingest
- **WHEN** an imported file is at or below the applicable cap
- **THEN** existing supported-file ingestion behavior is preserved

### Requirement: .knoxnet imports SHALL be capped and structurally validated
The `.knoxnet` importer SHALL reject files larger than the project-file cap (100 MB) before parsing, and the parser SHALL validate top-level structure, markup shapes and allowed markup kinds, finite numeric fields, and bounded string lengths before any project loads.

#### Scenario: Oversized project file rejected
- **WHEN** `importProjectFile()` receives a `.knoxnet` file larger than 100 MB
- **THEN** the file is rejected before parsing with a friendly error naming the limit

#### Scenario: Malformed structure rejected without partial load
- **WHEN** parsed project data fails a required structure, type, markup-kind, finite-number, or string-length check
- **THEN** the parser returns a friendly error
- **AND** the currently loaded project is left unchanged

#### Scenario: Round-trip equivalence
- **WHEN** a valid project file is parsed, serialized, and parsed again
- **THEN** the result is semantically equivalent to the original, ignoring formatting and property-order differences

#### Scenario: No new validation dependency without approval
- **WHEN** project validation is implemented
- **THEN** it uses project-local code and dependencies present at the pinned commit until a new dependency is explicitly approved

### Requirement: Decoded raster images SHALL be capped by pixel count
The raster ingestor SHALL reject any decoded image whose `naturalWidth × naturalHeight` exceeds the raster pixel cap (initialized to 100,000,000 pixels) before project insertion.

#### Scenario: Decompression-bomb image rejected quickly
- **WHEN** the raster ingestor decodes an image representing a 900-megapixel PNG
- **THEN** the rejection settles in under 2 seconds
- **AND** a friendly error names the pixel limit
