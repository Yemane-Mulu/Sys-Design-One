// @vitest-environment node
// KNOXNET-FIXES Source_Fix_Item 4 (Req 5): .knoxnet structural validation.
// Malformed payloads must be rejected with Friendly_Errors before any
// project loads; valid files (including the legacy v1.x shape) keep
// parsing; parse → serialize → parse stays semantically equivalent.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseProjectFileText,
  serializeProjectFile,
  ALLOWED_MARKUP_KINDS,
  PROJECT_TEXT_LIMITS,
} from "../src/lib/projectFile";
import type { DeviceMarkup } from "../src/store/projectStore";

function stubObjectUrls() {
  return vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:knoxnet-test");
}

afterEach(() => {
  vi.restoreAllMocks();
});

function basePayloadJson(): string {
  return JSON.stringify({
    knoxnet: "2.0",
    exportedAt: "2026-11-04T00:00:00.000Z",
    project: {
      id: "p1",
      meta: {
        projectName: "Fixture",
        projectNumber: "KX-1",
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
          markups: [
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
          ],
        },
      ],
      racks: [],
      createdAt: 1,
      updatedAt: 2,
    },
  });
}

/** Parse the base payload, mutate it, and re-stringify. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function editedPayload(edit: (p: any) => void): string {
  const parsed = JSON.parse(basePayloadJson());
  edit(parsed);
  return JSON.stringify(parsed);
}

describe("validation constants", () => {
  it("pins documented limits and the allowed markup-kind set", () => {
    expect(PROJECT_TEXT_LIMITS.shortText).toBe(500);
    expect(PROJECT_TEXT_LIMITS.longText).toBe(10_000);
    expect(ALLOWED_MARKUP_KINDS).toEqual([
      "device",
      "cable",
      "text",
      "callout",
      "cloud",
      "dimension",
      "rect",
      "arrow",
      "polygon",
      "freehand",
      "drop",
      "schedule",
    ]);
  });
});

describe("valid files keep loading", () => {
  it("parses a representative valid payload", async () => {
    stubObjectUrls();
    const project = await parseProjectFileText(basePayloadJson());
    expect(project.sheets[0]?.markups[0]?.kind).toBe("device");
  });

  it("still parses the legacy v1.x minimal shape", async () => {
    stubObjectUrls();
    const legacy = JSON.stringify({
      knoxnet: "1.0",
      exportedAt: "2026-05-16T00:00:00.000Z",
      project: {
        id: "old-project",
        meta: { projectName: "Old Project" },
        sheets: [
          {
            id: "old-sheet",
            name: "Legacy",
            fileName: "legacy.pdf",
            pdfBytesB64: "JVBERi0x",
            pageWidth: 0,
            pageHeight: 0,
            renderScale: 0,
          },
        ],
        reports: [],
      },
    });
    const project = await parseProjectFileText(legacy);
    expect(project.sheets[0]?.pageWidth).toBe(1000);
  });
});

describe("malformed files are rejected without partial load", () => {
  it("rejects non-array sheets", async () => {
    await expect(
      parseProjectFileText(
        editedPayload((p) => {
          p.project.sheets = "not-an-array";
        }),
      ),
    ).rejects.toThrow(/sheets must be an array/);
  });

  it("rejects non-array markups", async () => {
    await expect(
      parseProjectFileText(
        editedPayload((p) => {
          p.project.sheets[0].markups = "nope";
        }),
      ),
    ).rejects.toThrow(/markups must be an array/);
  });

  it("rejects unsupported markup kinds", async () => {
    await expect(
      parseProjectFileText(
        editedPayload((p) => {
          p.project.sheets[0].markups[0].kind = "exploit";
        }),
      ),
    ).rejects.toThrow(/unsupported markup kind "exploit"/);
  });

  it("rejects non-object markups", async () => {
    await expect(
      parseProjectFileText(
        editedPayload((p) => {
          p.project.sheets[0].markups = ["nope"];
        }),
      ),
    ).rejects.toThrow(/markup must be an object/);
  });

  it("rejects device markup without a deviceId", async () => {
    await expect(
      parseProjectFileText(
        editedPayload((p) => {
          delete p.project.sheets[0].markups[0].deviceId;
        }),
      ),
    ).rejects.toThrow(/device markup requires a deviceId/);
  });

  it("rejects non-finite numbers (JSON 1e999 parses to Infinity)", async () => {
    // JSON.stringify drops Infinity to null, so inject the literal text.
    const hostile = basePayloadJson().replace('"x":10', '"x":1e999');
    await expect(parseProjectFileText(hostile)).rejects.toThrow(/numbers must be finite/);
  });

  it("rejects non-array racks", async () => {
    await expect(
      parseProjectFileText(
        editedPayload((p) => {
          p.project.racks = {};
        }),
      ),
    ).rejects.toThrow(/racks must be an array/);
  });

  it("rejects unsupported sheet source kinds", async () => {
    await expect(
      parseProjectFileText(
        editedPayload((p) => {
          p.project.sheets[0].sourceSerialized.kind = "evil";
        }),
      ),
    ).rejects.toThrow(/unsupported sheet source kind "evil"/);
  });

  // Patch 19 — per-sheet legend placement union. Absent = overlay (old
  // files stay valid); a present-but-unknown value must be rejected.
  it("rejects unsupported legend placements", async () => {
    await expect(
      parseProjectFileText(
        editedPayload((p) => {
          p.project.sheets[0].legendPlacement = "diagonal";
        }),
      ),
    ).rejects.toThrow(/unsupported legend placement "diagonal"/);
  });

  it("accepts overlay and side legend placements (and absent = overlay)", async () => {
    stubObjectUrls();
    const overlay = await parseProjectFileText(
      editedPayload((p) => {
        p.project.sheets[0].legendPlacement = "overlay";
      }),
    );
    expect(overlay.sheets[0]?.legendPlacement).toBe("overlay");
    const side = await parseProjectFileText(
      editedPayload((p) => {
        p.project.sheets[0].legendPlacement = "side";
      }),
    );
    expect(side.sheets[0]?.legendPlacement).toBe("side");
    const absent = await parseProjectFileText(basePayloadJson());
    expect(absent.sheets[0]?.legendPlacement).toBeUndefined();
  });

  it("rejects a non-string version header", async () => {
    await expect(
      parseProjectFileText(
        editedPayload((p) => {
          p.knoxnet = 123;
        }),
      ),
    ).rejects.toThrow(/version header must be a string/);
  });

  it("rejects identifier strings over the 500-character class limit", async () => {
    await expect(
      parseProjectFileText(
        editedPayload((p) => {
          p.project.sheets[0].markups[0].tag = "A".repeat(501);
        }),
      ),
    ).rejects.toThrow(/500-character limit/);
  });

  it("rejects free-form strings over the 10,000-character class limit", async () => {
    await expect(
      parseProjectFileText(
        editedPayload((p) => {
          p.project.sheets[0].markups[0].labelOverride = "A".repeat(10_001);
        }),
      ),
    ).rejects.toThrow(/10,000-character limit/);
  });
});

describe("boundary and payload-exemption cases pass", () => {
  it("accepts identifier strings at the 500-character limit", async () => {
    stubObjectUrls();
    const project = await parseProjectFileText(
      editedPayload((p) => {
        p.project.sheets[0].markups[0].tag = "A".repeat(500);
      }),
    );
    const markup = project.sheets[0]?.markups[0] as DeviceMarkup | undefined;
    expect(markup?.tag).toHaveLength(500);
  });

  it("accepts free-form strings at the 10,000-character limit", async () => {
    stubObjectUrls();
    const project = await parseProjectFileText(
      editedPayload((p) => {
        p.project.sheets[0].markups[0].labelOverride = "A".repeat(10_000);
      }),
    );
    const markup = project.sheets[0]?.markups[0] as DeviceMarkup | undefined;
    expect(markup?.labelOverride).toHaveLength(10_000);
  });

  it("never length-caps serialized SVG source or embedded logo payloads", async () => {
    stubObjectUrls();
    const project = await parseProjectFileText(
      editedPayload((p) => {
        p.project.sheets[0].sourceSerialized = {
          kind: "svg",
          text: `<svg>${"A".repeat(50_000)}</svg>`,
          viewBoxX: 0,
          viewBoxY: 0,
          viewBoxW: 100,
          viewBoxH: 100,
        };
        p.project.branding = {
          logoDataUrl: `data:image/png;base64,${"A".repeat(50_000)}`,
        };
      }),
    );
    expect(project.sheets[0]?.source?.kind).toBe("svg");
  });
});

describe("parse → serialize → parse equivalence (Req 5 AC 10)", () => {
  it("produces semantically equivalent projects across a full round trip", async () => {
    stubObjectUrls();
    const t0 = "2026-11-04T00:00:00.000Z";
    const first = await parseProjectFileText(basePayloadJson());
    const serializedOnce = serializeProjectFile(first, t0);
    const second = await parseProjectFileText(serializedOnce);
    const serializedTwice = serializeProjectFile(second, t0);
    const third = await parseProjectFileText(serializedTwice);
    expect(third).toEqual(second);
    expect(serializedTwice).toBe(serializedOnce);
  });
});
