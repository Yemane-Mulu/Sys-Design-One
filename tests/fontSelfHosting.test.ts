// @vitest-environment node
// KNOXNET-FIXES Source_Fix_Item 5 (Req 6): fonts load exclusively from the
// application origin. A1-equivalent source checks: zero remote font
// references, self-hosted @font-face rules resolving to /fonts/, and
// license files shipped with the assets. (Build-artifact scanning runs in CI.)
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(testsDir);

function read(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(p) : [p];
  });
}

const REMOTE_FONT_HOSTS = /rsms\.me|fonts\.googleapis\.com|fonts\.gstatic\.com/;

describe("no external font requests (A1-equivalent)", () => {
  it("index.html references no remote font hosts", () => {
    expect(read("index.html")).not.toMatch(REMOTE_FONT_HOSTS);
  });

  it("no source file references remote font hosts", () => {
    const srcFiles = walk(path.join(repoRoot, "src")).filter((f) =>
      /\.(ts|tsx|css)$/.test(f),
    );
    const offenders = srcFiles.filter((f) =>
      REMOTE_FONT_HOSTS.test(fs.readFileSync(f, "utf8")),
    );
    expect(
      offenders.map((f) => path.relative(repoRoot, f)),
      "remote font references remain in src/",
    ).toEqual([]);
  });
});

describe("self-hosted @font-face rules resolve to the application origin", () => {
  const css = read("src/styles.css");

  it("defines Inter and JetBrains Mono", () => {
    expect(css).toMatch(/@font-face\s*\{[^}]*font-family:\s*"Inter"/);
    expect(css).toMatch(/@font-face\s*\{[^}]*font-family:\s*"JetBrains Mono"/);
  });

  it("references only same-origin /fonts/ URLs", () => {
    const fontUrls = [...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1]!.trim());
    expect(fontUrls.length).toBeGreaterThanOrEqual(4);
    for (const url of fontUrls) {
      expect(url).toMatch(/^["']?\/fonts\//);
    }
  });
});

describe("font assets and licenses ship with the app", () => {
  const fontsDir = path.join(repoRoot, "public", "fonts");

  it("contains the woff2 assets the CSS references", () => {
    const names = fs.readdirSync(fontsDir);
    expect(names).toContain("InterVariable.woff2");
    expect(names).toContain("JetBrainsMono-Regular.woff2");
    expect(names).toContain("JetBrainsMono-Medium.woff2");
    expect(names).toContain("JetBrainsMono-SemiBold.woff2");
  });

  it("stores each font's open-font license alongside its assets", () => {
    const interLicense = read("public/fonts/Inter-OFL.txt");
    expect(interLicense).toMatch(/SIL OPEN FONT LICENSE/i);
    const jbmLicense = read("public/fonts/JetBrainsMono-OFL.txt");
    expect(jbmLicense).toMatch(/SIL OPEN FONT LICENSE/i);
  });

  it("every woff2 file carries the woff2 magic bytes", () => {
    for (const file of fs.readdirSync(fontsDir).filter((f) => f.endsWith(".woff2"))) {
      const magic = fs
        .readFileSync(path.join(fontsDir, file))
        .subarray(0, 4)
        .toString("latin1");
      expect(magic, file).toBe("wOF2");
    }
  });
});
