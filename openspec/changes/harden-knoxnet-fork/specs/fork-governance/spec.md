## Purpose

Keeps the hardened fork's lineage auditable — one pinned upstream base, one patch commit per fix, a complete patch register, non-interactive verification, and pushes only on explicit approval. Kept lean: the spec layer leads with application security behavior.

## ADDED Requirements

### Requirement: The fork SHALL descend from one pinned upstream commit
The working branch SHALL base exactly on upstream commit `7bae0cd3746fa8904bc53f206e0a9961dad62738`, every authorized patch SHALL land as one auditable patch commit above it, and upstream license and attribution notices SHALL be preserved.

#### Scenario: Base and lineage
- **WHEN** the working branch is created
- **THEN** its base is exactly the pinned commit and every patch commit descends from it

### Requirement: Every patch SHALL be recorded in the patch register
The `PATCHES.md` register SHALL record, for each patch commit, the patch purpose, reason, every changed file, the source fix item it implements, and the verification commands and results.

#### Scenario: Register completeness
- **WHEN** a patch commit is created and verified
- **THEN** its register entry contains purpose, reason, changed files, fix item, and verification evidence

### Requirement: Pushes and package changes SHALL require separate explicit approval
While explicit user approval is absent, the destination fork's remote branch SHALL remain unchanged; approval of one dependency group never approves another, and dependency approval never approves a push.

#### Scenario: Remote unchanged before push approval
- **WHEN** implementation and verification complete without push approval
- **THEN** the destination fork's remote branch is unchanged

### Requirement: Verification SHALL be non-interactive and secret-free
The verification workflow SHALL run the complete existing test suite once in non-watch mode, the type check, the production build, and — after approved package changes — the applicable npm and OSV dependency audits, without starting `npm run dev`, `vite preview`, `vitest --ui`, or any watch process, and SHALL never write or print a secret into source, fixtures, output, logs, the register, or commits.

#### Scenario: Full verification sweep
- **WHEN** all approved patches are ready for review
- **THEN** the existing test suite, type check, production build, and applicable audits run non-interactively
- **AND** results are recorded in the applicable patch register entries

#### Scenario: No interactive servers, no secrets
- **WHEN** the verification workflow runs
- **THEN** no development, preview, UI, or watch server starts
- **AND** no secret appears in any source, fixture, output, log, register entry, or commit
