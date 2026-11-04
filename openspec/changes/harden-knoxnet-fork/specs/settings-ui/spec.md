## Purpose

Renders settings labels through React's text pipeline so no future label change can turn the settings drawer into an HTML injection path.

## ADDED Requirements

### Requirement: Settings labels SHALL render as text
The settings drawer SHALL render every `TextField` label through the React text expression `{label}`, SHALL represent the label currently containing `&quot;` with normal quote characters, and SHALL contain no raw-HTML rendering property for labels.

#### Scenario: HTML metacharacters display as text
- **WHEN** a settings-label test supplies HTML metacharacters
- **THEN** the drawer displays the metacharacters as text rather than interpreting them as markup

#### Scenario: No raw-HTML sink survives the build
- **WHEN** the static production-build check scans `src/components/SettingsDrawer.tsx`
- **THEN** zero `dangerouslySetInnerHTML` uses are reported
