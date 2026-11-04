// @vitest-environment node
// KNOXNET-FIXES Source_Fix_Item 2 (Requirement 3): the PDF engine runs with
// dynamic evaluation disabled and exposes no URL-based ingestion path.
// Static checks scan src/; the integration check parses a representative
// valid local PDF with evaluation disabled (B4-equivalent).
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.join(path.dirname(testsDir), "src");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(p) : [p];
  });
}

const srcFiles = walk(srcRoot).filter((f) => /\.(ts|tsx)$/.test(f));

describe("URL-based PDF ingestion is removed (static check)", () => {
  it("no source file references loadPdfFromUrl or ingestPdfFromUrl", () => {
    const offenders = srcFiles.filter((f) =>
      /loadPdfFromUrl|ingestPdfFromUrl/.test(fs.readFileSync(f, "utf8")),
    );
    expect(
      offenders.map((f) => path.relative(srcRoot, f)),
      "URL PDF API references remain in src/",
    ).toEqual([]);
  });
});

describe("PDF engine disables dynamic evaluation (static check)", () => {
  it("the only getDocument call site passes isEvalSupported: false", () => {
    const callSites = srcFiles.filter((f) =>
      fs.readFileSync(f, "utf8").includes("getDocument("),
    );
    expect(callSites).toEqual([path.join(srcRoot, "lib", "pdfjs.ts")]);
    const source = fs.readFileSync(callSites[0]!, "utf8");
    expect(source).toMatch(/getDocument\(\{[^}]*isEvalSupported:\s*false/s);
  });

  it("no source file enables evaluation explicitly", () => {
    const offenders = srcFiles.filter((f) =>
      /isEvalSupported:\s*true/.test(fs.readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});

describe("B4-equivalent: local PDF parses with evaluation disabled", () => {
  it("completes expected parse behavior for a representative valid local PDF", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    page.drawText("Knoxnet hardening fixture", { x: 72, y: 720, size: 12 });
    const bytes = new Uint8Array(await doc.save());

    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const parsed = await pdfjs.getDocument({
      data: bytes,
      isEvalSupported: false,
    }).promise;

    expect(parsed.numPages).toBe(1);
    const first = await parsed.getPage(1);
    const viewport = first.getViewport({ scale: 1 });
    expect(viewport.width).toBeCloseTo(612);
    expect(viewport.height).toBeCloseTo(792);
    await parsed.destroy();
  });
});
