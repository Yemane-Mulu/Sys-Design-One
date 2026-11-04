## Purpose

Loads every font the application renders from the application origin only, so page loads do not disclose usage to third-party font hosts and do not depend on remote font services.

## ADDED Requirements

### Requirement: Fonts SHALL be self-hosted with licenses preserved
The application SHALL serve Inter and JetBrains Mono from `public/fonts/` through `@font-face` rules in `src/styles.css`, SHALL store each font's license file alongside its self-hosted assets, and SHALL remove every external font link from `index.html`.

#### Scenario: No external font requests survive the build
- **WHEN** the static production-build check scans HTML, CSS, and JavaScript artifacts
- **THEN** zero references to remote font stylesheets or font files remain, including `rsms.me` and Google Fonts origins

#### Scenario: Font resources resolve to the application origin
- **WHEN** the automated integration check resolves application font resources
- **THEN** every required font resource resolves to the application origin

#### Scenario: Build output carries fonts and licenses
- **WHEN** the production build runs
- **THEN** the required font and license assets are included in the build output
