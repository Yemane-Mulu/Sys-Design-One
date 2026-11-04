// @vitest-environment node
// Drops feature — .knoxnet compatibility (openspec/changes/add-drops):
// pre-drop files load unchanged, drop files round-trip losslessly, and
// malformed drop payloads are rejected before any project loads.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseProjectFileText,
  serializeProjectFile,
} from "../src/lib/projectFile";
import type { DropMarkup } from "../src/store/projectStore";

function stubObjectUrls() {
  return vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:knoxnet-test");
}

afterEach(() => {
  vi.restoreAllMocks();
});

function dropMarkup(partial: Partial<DropMarkup>): DropMarkup {
  return {
    id: "drop-1",
    kind: "drop",
    layer: "drop",
    number: "D-001",
    faceplateId: "fp-1",
    x: 100,
    y: 200,
    ...partial,
  };
}

function payloadJson(markups: unknown[]): string {
  return JSON.stringify({
    knoxnet: "2.0",
    exportedAt: "2026-11-04T00:00:00.000Z",
    project: {
      id: "p1",
      meta: {
        projectName: "Fixture",
        projectNumber: "D1-1",
        date: "2026-01-01T00:00:00.000Z",
      },
      sheets: [
        {
          id: "s1",
          name: "Plan",
          fileName: "plan.pdf",
          sourceSerialized: { kind: "pdf", bytesB64: "JVBERi0x" },
          pageWidth: 1000,
          pageHeight: 800,
          renderScale: 1,
          markups,
        },
      ],
      racks: [],
      createdAt: 1,
      updatedAt: 2,
    },
  });
}

describe("pre-drop files load unchanged", () => {
  it("parses a file with no drops exactly as before", async () => {
    stubObjectUrls();
    const project = await parseProjectFileText(
      payloadJson([
        {
          id: "m1",
          kind: "device",
          layer: "cameras",
          deviceId: "cam-dome",
          category: "cameras",
          x: 10,
          y: 20,
          tag: "CAM-01",
        },
      ]),
    );
    expect(project.sheets[0]?.markups).toHaveLength(1);
    expect(project.sheets[0]?.markups[0]?.kind).toBe("device");
  });
});

describe("drop files round-trip", () => {
  it("keeps every drop field intact through serialize → parse → serialize", async () => {
    stubObjectUrls();
    const drop = dropMarkup({
      jackType: "Cat6 keystone",
      service: "data",
      mount: "wall",
      heightInches: 48,
      notes: "existing conduit usable",
      labelOffsetX: 12,
      labelOffsetY: -6,
    });
    const first = await parseProjectFileText(payloadJson([drop]));
    const serialized = serializeProjectFile(first, "2026-11-04T00:00:00.000Z");
    const second = await parseProjectFileText(serialized);
    const imported = second.sheets[0]?.markups[0] as DropMarkup;
    expect(imported.kind).toBe("drop");
    expect(imported.number).toBe("D-001");
    expect(imported.faceplateId).toBe("fp-1");
    expect(imported.jackType).toBe("Cat6 keystone");
    expect(imported.service).toBe("data");
    expect(imported.mount).toBe("wall");
    expect(imported.heightInches).toBe(48);
    expect(imported.notes).toBe("existing conduit usable");
    expect(imported.labelOffsetX).toBe(12);
    expect(imported.labelOffsetY).toBe(-6);
  });
});

describe("malformed drop payloads are rejected", () => {
  const cases: Array<[string, string, Partial<DropMarkup> & Record<string, unknown>]> = [
    ["missing number", "number", { number: undefined }],
    ["blank number", "number", { number: "  " }],
    ["missing faceplateId", "faceplateId", { faceplateId: undefined }],
    ["bad service", "service", { service: "carrier-pigeon" }],
    ["bad mount", "mount", { mount: "underwater" }],
  ];

  for (const [label, field, patch] of cases) {
    it(`rejects a drop with ${label}`, async () => {
      stubObjectUrls();
      const bad = dropMarkup(patch as Partial<DropMarkup>);
      const raw = JSON.parse(payloadJson([bad]));
      const markup = raw.project.sheets[0].markups[0];
      if (patch[field] === undefined) delete markup[field];
      else markup[field] = patch[field];
      await expect(parseProjectFileText(JSON.stringify(raw))).rejects.toThrow(
        /Invalid project file/,
      );
    });
  }

  it("rejects a non-finite heightInches", async () => {
    stubObjectUrls();
    const bad = dropMarkup();
    const raw = JSON.parse(payloadJson([bad]));
    // JSON has no Infinity literal — 1e999 parses to Infinity at runtime.
    raw.project.sheets[0].markups[0].heightInches = 1e999;
    await expect(parseProjectFileText(JSON.stringify(raw))).rejects.toThrow(
      /Invalid project file/,
    );
  });
});