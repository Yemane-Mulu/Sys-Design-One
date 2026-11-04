// @vitest-environment node
// KNOXNET-FIXES Source_Fix_Item 8 (Req 9): settings labels render as text.
// The legacy raw-HTML sink is gone; HTML metacharacters in a label are
// displayed, never interpreted. Behavioral proof uses react-dom/server
// escaping (an existing dependency); static checks scan the component.
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { TextField } from "../src/components/SettingsDrawer";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(testsDir);
const source = fs.readFileSync(
  path.join(repoRoot, "src", "components", "SettingsDrawer.tsx"),
  "utf8",
);

describe("static checks (Req 9 AC 5)", () => {
  it("contains no raw-HTML rendering property", () => {
    expect(source).not.toMatch(/dangerouslySetInnerHTML/);
  });

  it("renders TextField labels through the React text expression", () => {
    expect(source).toMatch(/<div className="text-xs text-ink-300 mb-1">\{label\}<\/div>/);
  });

  it("represents the footer label with normal quote characters", () => {
    expect(source).not.toMatch(/&quot;/);
    expect(source).toMatch(/Full company name \(used in "BY ____" footer\)/);
  });
});

describe("behavioral check (Req 9 AC 4)", () => {
  it("displays HTML metacharacters in labels as text, not markup", () => {
    const hostile = '<script>alert(1)</script> & "quotes" <img src=x onerror=alert(1)>';
    const html = renderToString(
      createElement(TextField, {
        label: hostile,
        value: "",
        onChange: () => {},
      }),
    );
    // The metacharacters are escaped to entities — displayed as text.
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
    // No raw markup from the label survives into the output.
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
  });

  it("renders ordinary labels unchanged", () => {
    const html = renderToString(
      createElement(TextField, {
        label: 'Full company name (used in "BY ____" footer)',
        value: "",
        onChange: () => {},
      }),
    );
    expect(html).toContain("Full company name");
  });
});
