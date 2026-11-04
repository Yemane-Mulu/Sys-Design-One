// @vitest-environment node
// Drops feature — integration contract (openspec/changes/add-drops):
// cable runs attach to the first jack without a cable and label by
// drop number; the drops report scope + Drops Schedule template expose
// every field with notes and totals in all six formats; and drops have
// ZERO effect on the bid (documentation-only, user decision 2026-11-04).
import { describe, expect, it } from "vitest";
import { dropCableEndpoint, compareDropNumbers } from "../src/lib/cableRuns";
import { computeBid } from "../src/lib/bid";
import { defaultBidDefaults } from "../src/data/defaults";
import { runReport, reportTotalsLine, selectEntities } from "../src/reports/engine";
import { validateProject } from "../src/lib/validation";
import { FIELD_CATALOG, SCOPE_LABEL } from "../src/reports/fieldCatalog";
import { buildStarterTemplates } from "../src/reports/starterTemplates";
import { reportToCsv } from "../src/reports/formats/csv";
import { reportToJson } from "../src/reports/formats/json";
import { reportToMarkdown } from "../src/reports/formats/markdown";
import { reportToHtml } from "../src/reports/formats/html";
import { reportToXlsxBuffer } from "../src/reports/formats/xlsx";
import { reportToPdfBytes } from "../src/reports/formats/pdf";
import type {
  CableMarkup,
  DeviceMarkup,
  DropMarkup,
  Project,
} from "../src/store/projectStore";

const drop = (id: string, number: string, faceplateId: string): DropMarkup => ({
  id,
  kind: "drop",
  layer: "drop",
  number,
  faceplateId,
  x: 100,
  y: 100,
});

const device = (id: string): DeviceMarkup => ({
  id,
  kind: "device",
  layer: "cameras",
  category: "cameras",
  deviceId: "cam-dome",
  x: 10,
  y: 20,
  tag: id.toUpperCase(),
});

const cable = (id: string, terminated: string[]): CableMarkup => ({
  id,
  kind: "cable",
  layer: "cable",
  cableId: "cat6",
  points: [0, 0, 100, 0],
  pointAttachments: [
    { deviceMarkupId: terminated[0], deviceTag: terminated[0] },
    { deviceMarkupId: terminated[1], deviceTag: terminated[1] },
  ],
});

function projectWithDrops(drops: DropMarkup[]): Project {
  return {
    id: "p1",
    meta: {
      projectName: "Fixture",
      projectNumber: "D1-001",
      date: new Date(0).toISOString(),
    },
    sheets: [
      {
        id: "s1",
        name: "L1 - Plan",
        fileName: "plan.pdf",
        pageWidth: 800,
        pageHeight: 600,
        renderScale: 1,
        calibration: {
          p1: { x: 0, y: 0 },
          p2: { x: 100, y: 0 },
          realFeet: 100,
          pixelsPerFoot: 1,
        },
        markups: drops,
      },
    ],
    racks: [],
    bidDefaults: { ...defaultBidDefaults, slackPercent: 10 },
  } as unknown as Project;
}

describe("cable association", () => {
  it("orders drop numbers numerically (D-2 before D-10)", () => {
    expect(
      ["D-10", "D-2", "D-1"].sort(compareDropNumbers),
    ).toEqual(["D-1", "D-2", "D-10"]);
  });

  it("attaches to the first jack (by number) without a cable", () => {
    // D-001 and D-003 terminate cables; D-002 is free.
    const markups = [
      drop("d1", "D-001", "fp-1"),
      drop("d2", "D-002", "fp-1"),
      drop("d3", "D-003", "fp-1"),
      cable("run-1", ["d1", "switch"]),
      cable("run-2", ["d3", "switch"]),
    ];
    const endpoint = dropCableEndpoint(drop("d2", "D-002", "fp-1"), markups);
    expect(endpoint).not.toBeNull();
    expect(endpoint!.deviceMarkupId).toBe("d2");
    expect(endpoint!.label).toBe("D-002");
    expect(endpoint!.deviceTag).toBe("D-002");
  });

  it("takes the first jack on an empty faceplate", () => {
    const markups = [drop("d1", "D-001", "fp-1"), drop("d2", "D-002", "fp-1")];
    const endpoint = dropCableEndpoint(drop("d2", "D-002", "fp-1"), markups);
    expect(endpoint!.deviceMarkupId).toBe("d1");
    expect(endpoint!.label).toBe("D-001");
  });

  it("falls back to the last jack when every jack has a cable", () => {
    const markups = [
      drop("d1", "D-001", "fp-1"),
      drop("d2", "D-002", "fp-1"),
      cable("run-1", ["d1", "d2"]),
    ];
    const endpoint = dropCableEndpoint(drop("d1", "D-001", "fp-1"), markups);
    expect(endpoint!.deviceMarkupId).toBe("d2");
  });
});

describe("drops report scope", () => {
  const drops: DropMarkup[] = [
    drop("d1", "D-001", "fp-1"),
    drop("d2", "D-002", "fp-1"),
    drop("d3", "D-003", "fp-2"),
  ].map((d, i) => ({
    ...d,
    jackType: "Cat6 keystone",
    service: i === 2 ? "coax" : "data",
    mount: "wall",
    heightInches: 48,
    notes: `note ${i + 1}`,
  }));
  const project = projectWithDrops(drops);

  it("is registered in the field catalog and scope labels", () => {
    expect(FIELD_CATALOG.drops.map((f) => f.path)).toContain("number");
    expect(FIELD_CATALOG.drops.map((f) => f.path)).toContain("notes");
    expect(SCOPE_LABEL.drops).toBe("Drops");
  });

  it("flattens one row per jack with faceplate counts and notes", () => {
    const rows = selectEntities(project, "drops");
    expect(rows).toHaveLength(3);
    const row = rows.find((r) => r.number === "D-002")!;
    expect(row.faceplateId).toBe("fp-1");
    expect(row.faceplateJackCount).toBe(2);
    expect(row.jackType).toBe("Cat6 keystone");
    expect(row.notes).toBe("note 2");
    expect(row.sheetName).toBe("L1 - Plan");
    expect(row.heightInches).toBe(48);
  });

  it("runs the bundled Drops Schedule template grouped by faceplate", () => {
    const template = buildStarterTemplates().find((t) => t.name === "Drops Schedule");
    expect(template).toBeDefined();
    const result = runReport(project, template!);
    // One group per faceplate.
    expect(result.groups).toHaveLength(2);
    // fp-1 holds two jacks; fp-2 holds one.
    const groupSizes = result.groups.map((g) => g.rows.length).sort();
    expect(groupSizes).toEqual([1, 2]);
    // Notes column is present in the template.
    expect(result.columns.some((c) => c.field === "notes")).toBe(true);
    // Totals: 3 jacks on 2 faceplates.
    expect(reportTotalsLine(result)).toBe("Total: 3 jacks on 2 faceplates");
  });

  it("generates all six formats", async () => {
    const template = buildStarterTemplates().find((t) => t.name === "Drops Schedule")!;
    const result = runReport(project, template);
    expect(() => reportToCsv(result)).not.toThrow();
    expect(() => reportToJson(result)).not.toThrow();
    expect(() => reportToMarkdown(result)).not.toThrow();
    expect(() => reportToHtml(result)).not.toThrow();
    expect(() => reportToXlsxBuffer(result)).not.toThrow();
    await expect(reportToPdfBytes(result)).resolves.toBeInstanceOf(Uint8Array);
    // CSV/JSON stay pure row data — no totals line mixed in.
    const csv = reportToCsv(result);
    expect(csv).not.toContain("Total:");
  });
});

describe("duplicate drop numbers warn", () => {
  it("reports a non-blocking warning when two drops share a number", () => {
    const project = projectWithDrops([
      drop("d1", "D-001", "fp-1"),
      drop("d2", "D-002", "fp-1"),
      drop("d3", "D-001", "fp-2"), // manual edit collided with d1
    ]);
    const issues = validateProject(project);
    const duplicate = issues.find((issue) =>
      issue.id.startsWith("duplicate-drop-number:"),
    );
    expect(duplicate).toBeDefined();
    expect(duplicate!.severity).toBe("warning");
    expect(duplicate!.scope).toBe("drop");
    expect(duplicate!.message).toContain("D-001");
    expect(duplicate!.entityIds).toContain("d1");
    expect(duplicate!.entityIds).toContain("d3");
  });

  it("stays silent when every drop number is unique", () => {
    const project = projectWithDrops([
      drop("d1", "D-001", "fp-1"),
      drop("d2", "D-002", "fp-1"),
      drop("d3", "D-003", "fp-2"),
    ]);
    const issues = validateProject(project);
    expect(
      issues.some((issue) => issue.id.startsWith("duplicate-drop-number:")),
    ).toBe(false);
  });
});

describe("drops never affect the bid", () => {
  it("computes identical bid totals with and without drops", () => {
    const base: DropMarkup[] & (DeviceMarkup | CableMarkup)[] = [
      device("cam-01") as never,
      cable("run-1", ["cam-01", "switch"]) as never,
    ];
    const withoutDrops = {
      ...projectWithDrops([]),
      sheets: [
        {
          ...projectWithDrops([]).sheets[0]!,
          markups: base,
        },
      ],
    } as unknown as Project;
    const withDrops = {
      ...withoutDrops,
      sheets: [
        {
          ...withoutDrops.sheets[0]!,
          markups: [
            ...base,
            drop("d1", "D-001", "fp-1"),
            drop("d2", "D-002", "fp-1"),
            drop("d3", "D-003", "fp-2"),
            drop("d4", "D-004", "fp-3"),
          ],
        },
      ],
    } as unknown as Project;

    const bare = computeBid(withoutDrops);
    const loaded = computeBid(withDrops);
    expect(loaded.totals).toEqual(bare.totals);
    expect(loaded.totals.grandTotal).toBe(bare.totals.grandTotal);
    expect(loaded.devices).toEqual(bare.devices);
    expect(loaded.cables).toEqual(bare.cables);
    expect(loaded.rackDevices).toEqual(bare.rackDevices);
  });
});