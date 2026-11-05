/**
 * Portable project file (.knoxnet) — packages the full Project record
 * (all sheets, markups, racks, bid, branding) into a single JSON file
 * that can be shared via email, Drive, Slack, etc. and re-opened on any
 * machine without a server or install.
 *
 * Format v2.0
 * -----------
 * {
 *   knoxnet: "2.0",
 *   exportedAt: "<ISO timestamp>",
 *   project: {
 *     ...Project,
 *     sheets: [{
 *       ...Sheet,
 *       sourceSerialized: SerializedSheetSource,
 *     }],
 *   }
 * }
 *
 * - `sourceSerialized` is a discriminated-union encoding of the sheet's
 *   drawing source: PDF/DXF/raster/IFC carry base64 bytes, SVG carries
 *   raw text. DXF parsed entities are re-parsed on import so the on-disk
 *   format stays compact and DXF parser upgrades don't invalidate
 *   existing saves.
 *
 * Format v1.x (legacy)
 * --------------------
 * v1 sheets carried `pdfBytesB64` directly. The importer migrates v1
 * sheets to v2 transparently by wrapping the bytes as a PDF source.
 *
 * Binary fields are base64-encoded in 8 kB chunks to avoid call-stack
 * limits on `String.fromCharCode(...bytes)`.
 */

import type { Project, Sheet } from "../store/projectStore";
import type {
  SerializedSheetSource,
  SheetSource,
} from "./sheetSource";
import { fromBase64, toBase64 } from "./sheetSource";
import { migrateProject } from "./migrate";

const FILE_VERSION = "2.0";
const MIME = "application/json";
const EXT = ".knoxnet";

// KNOXNET-FIXES Source_Fix_Item 3 (Req 4): .knoxnet project files are
// capped at 100 MB (100,000,000 bytes), checked before any text is read
// or parsed, so a hostile oversized project file cannot exhaust browser
// memory. Serialized projects stay far below this in normal use.
export const PROJECT_FILE_CAP_BYTES = 100_000_000;

function formatCapBytes(n: number): string {
  if (n >= 1_000_000) {
    const mb = n / 1_000_000;
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
  }
  if (n >= 1_000) return `${Math.round(n / 1_000)} KB`;
  return `${n} bytes`;
}

// ───────── import validation (KNOXNET-FIXES SFI 4 / Req 5) ─────────
//
// The importer previously accepted arbitrary structure. These checks
// validate the entire parsed payload before any project loads: required
// arrays are arrays, markup kinds belong to the pinned commit's Markup
// union, every number is finite (JSON.parse turns 1e999 into Infinity),
// and strings respect documented per-class length limits. Payload strings
// (base64 sources, embedded logos, SVG text) are type-checked but never
// length-capped — they are bounded by the Project_File_Cap instead.
// All checks are project-local; no new dependency is introduced.

/** Allowed markup kinds, derived from the pinned commit's Markup union. */
export const ALLOWED_MARKUP_KINDS: readonly string[] = [
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
];
const allowedMarkupKindSet = new Set<string>(ALLOWED_MARKUP_KINDS);

/** Drop jack services and mounts — mirrors the DropService / DropMount
 *  unions in src/store/projectStore.ts. Validated on import so a
 *  malformed file cannot smuggle an unknown enum value into the UI. */
const DROP_SERVICES = new Set(["data", "poe", "voice", "coax", "fiber"]);
const DROP_MOUNTS = new Set(["wall", "floor", "ceiling", "pole", "box"]);

/** Legend placement per sheet (Patch 19) — mirrors the "overlay" | "side"
 *  union on Sheet in src/store/projectStore.ts. Absent = overlay, so old
 *  files stay valid; a present-but-unknown value is rejected. */
const LEGEND_PLACEMENTS = new Set(["overlay", "side"]);

/** Allowed serialized sheet-source kinds (from sheetSource.ts). */
const allowedSourceKindSet = new Set(["pdf", "dxf", "svg", "raster", "ifc"]);

/** Documented maximum string lengths by field class, in characters. */
export const PROJECT_TEXT_LIMITS = {
  /** Identifier-class fields: ids, tags, catalog refs, addresses, kinds. */
  shortText: 500,
  /** Free-form text: labels, names, titles, notes, summaries, bodies. */
  longText: 10_000,
} as const;

/** Keys whose strings are identifier-class (short-text limit). */
const SHORT_TEXT_KEYS = new Set([
  "id",
  "kind",
  "layer",
  "tag",
  "deviceId",
  "cableId",
  "category",
  "projectNumber",
  "revision",
  "ipAddress",
  "subnetMask",
  "gateway",
  "hostname",
  "macAddress",
  "connector",
  "model",
  "manufacturer",
  "sheetNumber",
  "targetId",
  "targetKind",
  "medium",
  "op",
  "dir",
  "scope",
  "format",
  "number",
  "faceplateId",
  "jackType",
  "service",
  "mount",
]);

/** Binary-payload keys — type-checked as strings, never length-capped
 * (bounded by the Project_File_Cap instead). */
const UNBOUNDED_TEXT_KEYS = new Set(["bytesB64", "pdfBytesB64", "logoDataUrl"]);

function invalid(path: string, why: string): never {
  throw new Error(
    `Invalid project file: ${why} (at ${path}). ` +
      "Re-export the project from DesignOne and try again.",
  );
}

function validateMarkup(markup: unknown, path: string): void {
  if (markup === null || typeof markup !== "object" || Array.isArray(markup)) {
    invalid(path, "markup must be an object");
  }
  const m = markup as Record<string, unknown>;
  if (typeof m.kind !== "string" || !allowedMarkupKindSet.has(m.kind)) {
    invalid(`${path}.kind`, `unsupported markup kind ${JSON.stringify(m.kind)}`);
  }
  if (m.id !== undefined && typeof m.id !== "string") {
    invalid(`${path}.id`, "markup id must be a string");
  }
  // Discriminator fields the runtime dereferences directly.
  if (m.kind === "device" && typeof m.deviceId !== "string") {
    invalid(`${path}.deviceId`, "device markup requires a deviceId");
  }
  if (m.kind === "cable") {
    if (typeof m.cableId !== "string") {
      invalid(`${path}.cableId`, "cable markup requires a cableId");
    }
    if (m.points !== undefined && !Array.isArray(m.points)) {
      invalid(`${path}.points`, "cable points must be an array");
    }
  }
  if (m.kind === "schedule" && typeof m.targetId !== "string") {
    invalid(`${path}.targetId`, "schedule markup requires a targetId");
  }
  if (m.kind === "drop") {
    if (typeof m.number !== "string" || !m.number.trim()) {
      invalid(`${path}.number`, "drop markup requires a number");
    }
    if (typeof m.faceplateId !== "string" || !m.faceplateId.trim()) {
      invalid(`${path}.faceplateId`, "drop markup requires a faceplateId");
    }
    if (
      m.service !== undefined &&
      (typeof m.service !== "string" || !DROP_SERVICES.has(m.service))
    ) {
      invalid(`${path}.service`, `unsupported drop service ${JSON.stringify(m.service)}`);
    }
    if (
      m.mount !== undefined &&
      (typeof m.mount !== "string" || !DROP_MOUNTS.has(m.mount))
    ) {
      invalid(`${path}.mount`, `unsupported drop mount ${JSON.stringify(m.mount)}`);
    }
    if (
      m.heightInches !== undefined &&
      (typeof m.heightInches !== "number" || !Number.isFinite(m.heightInches))
    ) {
      invalid(`${path}.heightInches`, "drop heightInches must be a finite number");
    }
  }
}

function validateSourceSerialized(source: unknown, path: string): void {
  if (source === null || typeof source !== "object" || Array.isArray(source)) {
    invalid(path, "sourceSerialized must be an object");
  }
  const s = source as Record<string, unknown>;
  if (typeof s.kind !== "string" || !allowedSourceKindSet.has(s.kind)) {
    invalid(`${path}.kind`, `unsupported sheet source kind ${JSON.stringify(s.kind)}`);
  }
  // Payload strings (bytesB64, SVG text) are file-cap bounded; only the
  // numeric/other fields recurse through the generic scan.
  for (const [key, child] of Object.entries(s)) {
    if (typeof child === "string") continue;
    scanValue(child, `${path}.${key}`);
  }
}

/** Generic deep scan: every number finite, every string within its class cap. */
function scanValue(value: unknown, path: string): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      invalid(path, "numbers must be finite");
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((child, i) => scanValue(child, `${path}[${i}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (key === "sourceSerialized") {
      validateSourceSerialized(child, childPath);
      continue;
    }
    if (typeof child === "string") {
      if (UNBOUNDED_TEXT_KEYS.has(key)) continue;
      const cap = SHORT_TEXT_KEYS.has(key)
        ? PROJECT_TEXT_LIMITS.shortText
        : PROJECT_TEXT_LIMITS.longText;
      if (child.length > cap) {
        invalid(
          childPath,
          `string exceeds the ${cap.toLocaleString("en-US")}-character limit ` +
            `(${child.length.toLocaleString("en-US")} characters)`,
        );
      }
      continue;
    }
    scanValue(child, childPath);
  }
}

/**
 * Validate the parsed .knoxnet payload before any project loads. Throws
 * a Friendly_Error naming the condition and location; the caller's
 * currently loaded project is never touched because a throw never
 * returns a partially-parsed Project.
 */
export function validateProjectFilePayload(payload: unknown): void {
  const p = payload as Partial<ProjectFilePayload> & Record<string, unknown>;
  if (typeof p.knoxnet !== "string") {
    invalid("knoxnet", "version header must be a string");
  }
  const project = p.project;
  if (project === null || typeof project !== "object" || Array.isArray(project)) {
    invalid("project", "project must be an object");
  }
  const proj = project as Record<string, unknown>;
  for (const arrayKey of [
    "sheets",
    "racks",
    "connections",
    "diagrams",
    "reports",
    "layers",
  ]) {
    if (proj[arrayKey] !== undefined && !Array.isArray(proj[arrayKey])) {
      invalid(`project.${arrayKey}`, `${arrayKey} must be an array`);
    }
  }
  if (proj.meta !== undefined) {
    if (proj.meta === null || typeof proj.meta !== "object" || Array.isArray(proj.meta)) {
      invalid("project.meta", "meta must be an object");
    }
  }
  if (Array.isArray(proj.sheets)) {
    (proj.sheets as unknown[]).forEach((sheet, i) => {
      const sheetPath = `project.sheets[${i}]`;
      if (sheet === null || typeof sheet !== "object" || Array.isArray(sheet)) {
        invalid(sheetPath, "sheet must be an object");
      }
      const sh = sheet as Record<string, unknown>;
      if (sh.markups !== undefined && !Array.isArray(sh.markups)) {
        invalid(`${sheetPath}.markups`, "markups must be an array");
      }
      if (
        sh.legendPlacement !== undefined &&
        (typeof sh.legendPlacement !== "string" ||
          !LEGEND_PLACEMENTS.has(sh.legendPlacement))
      ) {
        invalid(
          `${sheetPath}.legendPlacement`,
          `unsupported legend placement ${JSON.stringify(sh.legendPlacement)}`,
        );
      }
      if (Array.isArray(sh.markups)) {
        (sh.markups as unknown[]).forEach((markup, m) => {
          validateMarkup(markup, `${sheetPath}.markups[${m}]`);
        });
      }
    });
  }
  scanValue(p, "file");
}

function safeName(s: string) {
  return s.replace(/[^a-zA-Z0-9_\- ]/g, "_").trim() || "project";
}

// ───────── source ↔ serialised ─────────

function sourceToSerialized(source: SheetSource): SerializedSheetSource {
  switch (source.kind) {
    case "pdf":
      return { kind: "pdf", bytesB64: toBase64(source.bytes) };
    case "dxf":
      return {
        kind: "dxf",
        bytesB64: toBase64(source.bytes),
        units: source.units,
      };
    case "svg":
      return {
        kind: "svg",
        text: source.text,
        viewBoxX: source.viewBoxX,
        viewBoxY: source.viewBoxY,
        viewBoxW: source.viewBoxW,
        viewBoxH: source.viewBoxH,
      };
    case "raster":
      return {
        kind: "raster",
        bytesB64: toBase64(source.bytes),
        mime: source.mime,
        naturalW: source.naturalW,
        naturalH: source.naturalH,
      };
    case "ifc":
      return {
        kind: "ifc",
        bytesB64: toBase64(source.bytes),
        storey: source.storey,
      };
  }
}

async function serializedToSource(s: SerializedSheetSource): Promise<SheetSource> {
  switch (s.kind) {
    case "pdf":
      return { kind: "pdf", bytes: fromBase64(s.bytesB64) };
    case "dxf": {
      const bytes = fromBase64(s.bytesB64);
      // Re-parse on import — bytes stay the canonical thing on disk.
      const { parseDxfText } = await import("./ingest/dxfIngest");
      const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      const { doc, units } = await parseDxfText(text);
      return {
        kind: "dxf",
        bytes,
        units: s.units ?? units,
        parsed: doc,
      };
    }
    case "svg":
      return {
        kind: "svg",
        text: s.text,
        viewBoxX: s.viewBoxX,
        viewBoxY: s.viewBoxY,
        viewBoxW: s.viewBoxW,
        viewBoxH: s.viewBoxH,
      };
    case "raster":
      return {
        kind: "raster",
        bytes: fromBase64(s.bytesB64),
        mime: s.mime,
        naturalW: s.naturalW,
        naturalH: s.naturalH,
      };
    case "ifc":
      return {
        kind: "ifc",
        bytes: fromBase64(s.bytesB64),
        storey: s.storey,
      };
  }
}

function rehydrateObjectUrl(source: SheetSource): string | undefined {
  switch (source.kind) {
    case "pdf":
      return URL.createObjectURL(
        new Blob([new Uint8Array(source.bytes)], { type: "application/pdf" }),
      );
    case "svg":
      return URL.createObjectURL(
        new Blob([source.text], { type: "image/svg+xml" }),
      );
    case "raster":
      return URL.createObjectURL(
        new Blob([new Uint8Array(source.bytes)], { type: source.mime }),
      );
    case "dxf":
    case "ifc":
      return undefined;
  }
}

// ───────── serialised sheet type ─────────

type SerializedSheet = Omit<Sheet, "pdfBytes" | "objectUrl" | "source"> & {
  /** v2.0 — full discriminated-union source. */
  sourceSerialized?: SerializedSheetSource;
  /** v1.x legacy — base64-encoded PDF bytes on sheets that pre-date
   *  the multi-format refactor. Importer auto-wraps to a PDF source. */
  pdfBytesB64?: string;
};

type ProjectFilePayload = {
  knoxnet: string;
  exportedAt: string;
  project: Omit<Project, "sheets"> & { sheets: SerializedSheet[] };
};

// ───────── export ─────────

/**
 * Serialise the current project to a .knoxnet file and trigger a download.
 * Every source kind is encoded into the JSON; the file is fully self-
 * contained and can be opened on any machine without a server.
 */
export function serializeProjectFilePayload(
  project: Project,
  exportedAt = new Date().toISOString(),
): ProjectFilePayload {
  const sheets: SerializedSheet[] = project.sheets.map((sh) => {
    const { pdfBytes, objectUrl: _url, source, ...rest } = sh;
    // Prefer canonical .source; fall back to legacy pdfBytes if present.
    let serial: SerializedSheetSource | undefined;
    if (source) serial = sourceToSerialized(source);
    else if (pdfBytes) serial = { kind: "pdf", bytesB64: toBase64(pdfBytes) };
    return {
      ...rest,
      ...(serial ? { sourceSerialized: serial } : {}),
    };
  });

  return {
    knoxnet: FILE_VERSION,
    exportedAt,
    project: { ...project, sheets },
  };
}

export function serializeProjectFile(
  project: Project,
  exportedAt = new Date().toISOString(),
): string {
  return JSON.stringify(serializeProjectFilePayload(project, exportedAt));
}

export function exportProjectFile(project: Project): void {
  const payload = serializeProjectFile(project);

  const blob = new Blob([payload], { type: MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeName(project.meta.projectName)}${EXT}`;
  a.click();
  URL.revokeObjectURL(url);
}

// ───────── import ─────────

/**
 * Parse a .knoxnet file back into a live Project. Handles both v1.x
 * (pdfBytesB64 on each sheet) and v2.0 (sourceSerialized on each sheet)
 * by routing through the migrator after rehydrating bytes.
 */
export async function parseProjectFileText(text: string): Promise<Project> {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("File is not valid JSON — is this a .knoxnet project file?");
  }

  const p = payload as Partial<ProjectFilePayload>;
  if (!p.knoxnet || !p.project) {
    throw new Error(
      "Not a DesignOne project file (missing version header). " +
        "Use Export → Project File (.knoxnet) to create a shareable file.",
    );
  }

  // Structural validation before anything loads (SFI 4 / Req 5): a
  // malformed file throws a Friendly_Error instead of producing a
  // partially loaded or structurally invalid project.
  validateProjectFilePayload(p);

  const rawSheets = (p.project.sheets ?? []) as SerializedSheet[];
  const sheets: Sheet[] = await Promise.all(
    rawSheets.map(async (sh) => {
      const { pdfBytesB64, sourceSerialized, ...rest } = sh;
      let source: SheetSource | undefined;
      if (sourceSerialized) {
        try {
          source = await serializedToSource(sourceSerialized);
        } catch (e) {
          console.error("[import] could not rehydrate source:", e);
        }
      } else if (pdfBytesB64) {
        // Legacy v1.x — wrap as a PDF source.
        source = { kind: "pdf", bytes: fromBase64(pdfBytesB64) };
      }
      const objectUrl = source ? rehydrateObjectUrl(source) : undefined;
      const pdfBytes = source?.kind === "pdf" ? source.bytes : undefined;
      return { ...rest, source, pdfBytes, objectUrl } as Sheet;
    }),
  );

  const project: Project = {
    ...(p.project as Project),
    sheets,
    racks: p.project.racks ?? [],
    connections: p.project.connections ?? [],
  };

  // Run the migrator so legacy records gain a v2-shaped `source`
  // (idempotent on freshly-exported v2 files).
  return migrateProject(project, p.knoxnet);
}

export async function importProjectFile(file: File): Promise<Project> {
  // Reject oversized project files before reading or parsing any text.
  if (file.size > PROJECT_FILE_CAP_BYTES) {
    throw new Error(
      `"${file.name}" is ${formatCapBytes(file.size)} which exceeds the ` +
        `${formatCapBytes(PROJECT_FILE_CAP_BYTES)} project file limit. ` +
        "Export a smaller project (fewer or smaller sheets) and try again.",
    );
  }
  return parseProjectFileText(await file.text());
}
