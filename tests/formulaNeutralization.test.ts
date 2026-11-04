// @vitest-environment node
// Pins Formula_Neutralization for KNOXNET-FIXES Source_Fix_Item 1:
// CSV cells beginning with a formula trigger are apostrophe-prefixed
// before CSV quoting, and XLSX writers emit trigger values as text
// cells with no formula property.
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { csvCell, reportToCsv } from "../src/reports/formats/csv";
import { reportToXlsxBuffer } from "../src/reports/formats/xlsx";
import type { ReportResult } from "../src/reports/engine";

// Format-layer fixture: only the fields the serializers consume are
// populated, so the template is cast rather than fully manufactured.
function mkResult(
  rows: Record<string, string>[],
  opts: { groupBy?: string[]; groupKeys?: string[][] } = {},
): ReportResult {
  const groups = opts.groupKeys
    ? opts.groupKeys.map((key, i) => ({ key, rows: [rows[i]] }))
    : [{ key: [], rows }];
  return {
    scope: "devices",
    columns: [{ field: "label", header: "Label" }],
    groups,
    rowCount: rows.length,
    meta: {
      template: {
        id: "fixture",
        name: "Trigger Fixture",
        scope: "devices",
        filters: [],
        columns: [{ field: "label" }],
        sortBy: [],
        formats: ["csv"],
        groupBy: opts.groupBy,
      },
      projectName: "Fixture",
      generatedAt: new Date(0).toISOString(),
    },
  } as unknown as ReportResult;
}

describe("csvCell formula neutralization", () => {
  it("neutralizes a hyperlink formula before CSV quoting", () => {
    expect(csvCell(`=HYPERLINK("x")`)).toBe(`"'=HYPERLINK(""x"")"`);
  });

  it("neutralizes arithmetic and reference triggers", () => {
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@SUM(1)")).toBe("'@SUM(1)");
  });

  it("neutralizes whitespace-prefixed triggers", () => {
    expect(csvCell("\tTotal")).toBe("'\tTotal");
    // Carriage return also forces RFC quoting after the prefix.
    expect(csvCell("\rTotal")).toBe("\"'\rTotal\"");
  });

  it("leaves ordinary values unchanged", () => {
    expect(csvCell("")).toBe("");
    expect(csvCell("CAM-01")).toBe("CAM-01");
    expect(csvCell("plain 'apostrophe' text")).toBe("plain 'apostrophe' text");
    // Commas still get RFC quoting, with no neutralization prefix.
    expect(csvCell("hello, world")).toBe('"hello, world"');
  });
});

describe("reportToCsv applies neutralization to all exported text", () => {
  it("neutralizes trigger values in data cells", () => {
    const result = mkResult([
      { label: `=HYPERLINK("http://evil.example")` },
      { label: "@SUM(1)" },
      { label: "-1" },
      { label: "Safe Label" },
    ]);
    const lines = reportToCsv(result).split("\r\n");
    expect(lines[0]).toBe("Label");
    expect(lines[1]).toBe(`"'=HYPERLINK(""http://evil.example"")"`);
    expect(lines[2]).toBe("'@SUM(1)");
    expect(lines[3]).toBe("'-1");
    expect(lines[4]).toBe("Safe Label");
  });

  it("neutralizes group keys", () => {
    const result = mkResult([{ label: "Safe Label" }], {
      groupBy: ["Category"],
      groupKeys: [["@Evil"]],
    });
    const lines = reportToCsv(result).split("\r\n");
    expect(lines[0]).toBe("Group: Category,Label");
    expect(lines[1]).toBe("'@Evil,Safe Label");
  });
});

describe("reportToXlsxBuffer writes trigger values as text cells", () => {
  const fixtures = [
    `=HYPERLINK("x")`,
    "+1",
    "-1",
    "@SUM(1)",
    "\tIndented",
    "\rIndented",
  ];

  it("exposes every trigger fixture as text with no formula property", () => {
    const result = mkResult(fixtures.map((label) => ({ label })));
    const buf = reportToXlsxBuffer(result);
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    fixtures.forEach((label, i) => {
      const addr = XLSX.utils.encode_cell({ r: i + 1, c: 0 });
      const cell = ws[addr];
      if (!cell) throw new Error(`missing cell at ${addr}`);
      expect(cell.t, `cell type at ${addr}`).toBe("s");
      expect(cell.f, `formula property at ${addr}`).toBeUndefined();
      expect(cell.v, `value at ${addr}`).toBe(label);
    });
  });
});
