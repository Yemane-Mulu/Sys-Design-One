/**
 * Multi-format ingest dispatcher. Picks the right per-kind ingester
 * based on filename / MIME, falls back to a friendly error when nothing
 * matches so the user knows what's actually supported.
 *
 * Security: imported files are size-capped before their contents are
 * read, so an oversized hostile file cannot freeze the page or exhaust
 * browser memory (KNOXNET-FIXES Source_Fix_Item 3).
 */

import type { Sheet } from "../../store/projectStore";
import { detectSourceKind, SOURCE_KIND_LABEL } from "../sheetSource";
import { ingestPdfFile, ingestPdfBytesAsSheets } from "./pdfIngest";
import { ingestDxfFile } from "./dxfIngest";
import { ingestSvgFile } from "./svgIngest";
import { ingestRasterFile } from "./rasterIngest";

/** Imported_File_Cap, initialized to 50 MB (50,000,000 bytes). */
export const IMPORTED_FILE_CAP_BYTES = 50_000_000;

let importedFileCap = IMPORTED_FILE_CAP_BYTES;

/** Configure the per-file import size cap, in bytes. */
export function setImportedFileCap(bytes: number) {
  importedFileCap = Math.max(1, bytes);
}

function formatCapBytes(n: number): string {
  if (n >= 1_000_000) {
    const mb = n / 1_000_000;
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
  }
  if (n >= 1_000) return `${Math.round(n / 1_000)} KB`;
  return `${n} bytes`;
}

export { ingestPdfBytes, ingestPdfBytesAsSheets, ingestPdfFile } from "./pdfIngest";
export { ingestDxfBytes, ingestDxfFile, parseDxfText } from "./dxfIngest";
export { ingestSvgText, ingestSvgFile } from "./svgIngest";
export { ingestRasterBytes, ingestRasterFile } from "./rasterIngest";

/**
 * Top-level dispatcher used by every UI surface that ingests files. Any
 * supported format → an array of Sheets ready to be added to the
 * project. Unsupported formats throw with the supported-list in the
 * message so the toast surfaces the correct guidance.
 *
 * Note: DWG is intentionally unsupported — there is no OSS browser
 * parser. The error message points the user at the free ODA File
 * Converter so they can produce a DXF instead.
 */
export async function ingestFile(file: File): Promise<Sheet[]> {
  // Reject oversized files before reading their contents (Req 4: the
  // 150 MB DXF freeze observed in source testing settles instantly).
  if (file.size > importedFileCap) {
    throw new Error(
      `"${file.name}" is ${formatCapBytes(file.size)} which exceeds the ` +
        `${formatCapBytes(importedFileCap)} import limit. Use a smaller or ` +
        `compressed file.`,
    );
  }
  const kind = detectSourceKind(file.name, file.type);
  if (kind === "pdf") return ingestPdfFile(file);
  if (kind === "dxf") return ingestDxfFile(file);
  if (kind === "svg") return ingestSvgFile(file);
  if (kind === "raster") return ingestRasterFile(file);
  if (kind === "ifc") {
    throw new Error(
      "IFC import isn't wired up yet. Try DXF or SVG export from your BIM tool.",
    );
  }
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".dwg")) {
    throw new Error(
      "DWG isn't supported directly (no open-source browser parser exists). " +
        "Convert it to DXF first with the free ODA File Converter, then drop the DXF here.",
    );
  }
  if (lower.endsWith(".rvt")) {
    throw new Error(
      "Revit (.rvt) isn't supported. Export the storey to IFC, DXF, or PDF from Revit first.",
    );
  }
  throw new Error(
    `Unsupported file type. DesignOne imports: ${Object.values(SOURCE_KIND_LABEL).join(", ")}.`,
  );
}
