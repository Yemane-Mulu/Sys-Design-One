// @vitest-environment node
// KNOXNET-FIXES Source_Fix_Item 3 (Req 4): imported files are rejected
// above their caps before any content is read, and decoded raster images
// are capped by pixel count. B7/B9 equivalents: oversized inputs settle
// in under 2 seconds with Friendly_Errors naming the applicable limit.
import { describe, it, expect, afterEach, vi } from "vitest";

// The dispatcher transitively loads the PDF engine; stub the module so
// its worker setup never runs in tests. These tests never reach the PDF
// branch (size gate and unsupported-format paths only).
vi.mock("../src/lib/pdfjs", () => ({
  getCachedDoc: vi.fn(),
  loadPdfFromBytes: vi.fn(),
  clearDocCache: vi.fn(),
  setDocCacheLimit: vi.fn(),
  renderPageToCanvas: vi.fn(),
  getFirstPage: vi.fn(),
}));

import {
  ingestFile,
  IMPORTED_FILE_CAP_BYTES,
  setImportedFileCap,
} from "../src/lib/ingest/index";
import {
  importProjectFile,
  PROJECT_FILE_CAP_BYTES,
} from "../src/lib/projectFile";
import {
  assertWithinRasterPixelCap,
  RASTER_PIXEL_CAP,
} from "../src/lib/ingest/rasterIngest";

/** File stand-in whose content accessors prove no read ever happens. */
function fakeFile(name: string, size: number): File {
  return {
    name,
    size,
    type: "",
    text: () => {
      throw new Error("SHOULD NOT READ CONTENTS");
    },
    arrayBuffer: () => {
      throw new Error("SHOULD NOT READ CONTENTS");
    },
  } as unknown as File;
}

afterEach(() => {
  setImportedFileCap(IMPORTED_FILE_CAP_BYTES);
});

describe("Import caps initialize to documented values", () => {
  it("pins the three caps from the requirements", () => {
    expect(IMPORTED_FILE_CAP_BYTES).toBe(50_000_000);
    expect(PROJECT_FILE_CAP_BYTES).toBe(100_000_000);
    expect(RASTER_PIXEL_CAP).toBe(100_000_000);
  });
});

describe("Imported file size cap (B7-equivalent)", () => {
  it("rejects a 150 MB DXF in under 2 seconds without reading contents", async () => {
    const file = fakeFile("site-plan.dxf", 150_000_000);
    const started = Date.now();
    await expect(ingestFile(file)).rejects.toThrow(/50 MB import limit/);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("friendly error names the file and the limit", async () => {
    await expect(ingestFile(fakeFile("big.png", 60_000_000))).rejects.toThrow(
      /"big\.png" is 60 MB which exceeds the 50 MB import limit/,
    );
  });

  it("below-cap files proceed past the size gate", async () => {
    // A 1 MB .dwg passes the cap and reaches the existing unsupported-
    // format error — proving the gate rejects nothing under the cap.
    await expect(ingestFile(fakeFile("legacy.dwg", 1_000_000))).rejects.toThrow(
      /DWG isn't supported directly/,
    );
  });

  it("the cap is configurable", async () => {
    setImportedFileCap(1_000);
    await expect(ingestFile(fakeFile("mid.bin", 2_000))).rejects.toThrow(
      /2 KB which exceeds the 1 KB import limit/,
    );
  });
});

describe("Project file cap", () => {
  it("rejects a >100 MB .knoxnet file before parsing", async () => {
    const file = fakeFile("giant.knoxnet", 150_000_000);
    const started = Date.now();
    await expect(importProjectFile(file)).rejects.toThrow(
      /"giant\.knoxnet" is 150 MB which exceeds the 100 MB project file limit/,
    );
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("does not read text before the cap check", async () => {
    // One byte over the cap. If the implementation read contents first,
    // fakeFile.text() throws "SHOULD NOT READ CONTENTS" and this fails.
    await expect(
      importProjectFile(fakeFile("huge.knoxnet", 100_000_001)),
    ).rejects.toThrow(/100 MB project file limit/);
  });
});

describe("Raster pixel cap (B9-equivalent)", () => {
  it("rejects dimensions representing a 900-megapixel PNG in under 2 seconds", () => {
    const started = Date.now();
    expect(() =>
      assertWithinRasterPixelCap(30_000, 30_000, "bomb.png"),
    ).toThrow(
      /30,000×30,000 pixels which exceeds the 100,000,000-pixel image limit/,
    );
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("rejects one pixel over the cap and accepts exactly at the cap", () => {
    expect(() =>
      assertWithinRasterPixelCap(10_000, 10_001, "over.png"),
    ).toThrow(/100,000,000-pixel image limit/);
    expect(() =>
      assertWithinRasterPixelCap(10_000, 10_000, "at-cap.png"),
    ).not.toThrow();
  });
});
