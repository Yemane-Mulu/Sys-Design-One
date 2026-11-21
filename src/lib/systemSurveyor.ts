// No-AI import for client plans drawn in System Surveyor.
//
// Their PDFs are generated files: the Bill of Materials / Element Report
// tables carry real text (device, quantity, location). We read those
// tables with the pdf.js text layer — no AI call, no extra cost — and
// turn them into drops plus a rack sized from the counts.
//
// What it can and cannot do, honestly:
// - Counts and the device list come straight from the tables. That part
//   is reliable.
// - Exact pin positions do NOT come from the tables — the schedule says
//   which room a camera is in, not its x/y on the drawing. Drops are
//   created in a staging row on the first sheet; the user drags each one
//   to its spot on the plan.
// - The table layout varies by report template, so the parser is
//   heuristic (trailing-quantity rows + device keywords) and the review
//   modal shows everything it found — and how many rows it could not
//   read — before anything is created.

import type * as pdfjsLib from "pdfjs-dist";
import type { RackPlacement } from "../store/projectStore";

const uid = () => Math.random().toString(36).slice(2, 10);

/** One reconstructed text line from a PDF page (PDF coords, y up). */
export interface SurveyorTextLine {
  text: string;
  x: number;
  y: number;
}

export type SurveyorKind = "camera" | "drop" | "switch" | "nvr" | "ap" | "other";

export interface SurveyorItem {
  kind: SurveyorKind;
  /** Raw table line, quantity stripped — kept verbatim so the review
   *  screen shows what the PDF actually said. */
  name: string;
  quantity: number;
}

export interface SurveyorProposal {
  isSurveyor: boolean;
  items: SurveyorItem[];
  cameras: number;
  drops: number;
  aps: number;
  /** Ports the rack must serve: one switch + one panel port per camera,
   *  data drop, and access point. */
  networkPorts: number;
  /** Table-looking rows the parser saw but could not classify — shown
   *  in the review modal so a missed row is visible, not silent. */
  unmatchedRows: number;
}

const KIND_ORDER: SurveyorKind[] = ["camera", "drop", "switch", "nvr", "ap", "other"];

const CAMERA_RE = /\b(camera|dome|bullet|ptz|turret|fisheye|panoramic)\b/i;
const DROP_RE = /\b(cat6a?|data\s+(drop|outlet|jack|port)|network\s+(drop|outlet|jack|port))\b/i;
const SWITCH_RE = /\bswitch\b/i;
const NVR_RE = /\b(nvr|dvr|video\s+recorder|recorder)\b/i;
const AP_RE = /\b(access\s+point|wireless\s+ap|\bwap\b|wi-?fi\s+6?)\b/i;
const OTHER_RE =
  /\b(reader|intercom|speaker|controller|power\s+supply|\bups\b|rack|enclosure|patch\s+panel|keypad|sensor|horn|strobe|door\s+contact|motion)\b/i;

// Headers, footers, and template chrome — never a device row.
const SKIP_RE =
  /^(bill of materials|element report|elements|description|item|qty|quantity|location|system surveyor|page\s+\d|confidential|all rights reserved)/i;

function classify(name: string): SurveyorKind | null {
  if (/\blight\s+switch\b/i.test(name)) return "other";
  if (NVR_RE.test(name)) return "nvr";
  if (SWITCH_RE.test(name)) return "switch";
  if (AP_RE.test(name)) return "ap";
  if (CAMERA_RE.test(name)) return "camera";
  if (DROP_RE.test(name)) return "drop";
  if (OTHER_RE.test(name)) return "other";
  return null;
}

/**
 * Read a PDF's text layer into per-page lines. Grouped by baseline (3pt
 * tolerance) and ordered top-down. The pdf.js import is dynamic so this
 * module stays importable in non-browser runtimes (tests) — only this
 * function needs the worker.
 */
export async function extractSurveyorText(
  bytes: Uint8Array,
  maxPages = 0,
): Promise<SurveyorTextLine[][]> {
  const { getCachedDoc } = await import("./pdfjs");
  const doc: pdfjsLib.PDFDocumentProxy = await getCachedDoc(bytes);
  const pages: SurveyorTextLine[][] = [];
  const n = maxPages > 0 ? Math.min(maxPages, doc.numPages) : doc.numPages;
  for (let p = 1; p <= n; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const byY = new Map<number, { x: number; str: string }[]>();
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const str = (item as { str: string }).str;
      if (!str.trim()) continue;
      const t = (item as unknown as { transform: number[] }).transform;
      const key = Math.round(t[5] / 3) * 3;
      const bucket = byY.get(key) ?? [];
      bucket.push({ x: t[4], str });
      byY.set(key, bucket);
    }
    const lines = [...byY.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([y, parts]) => {
        parts.sort((a, b) => a.x - b.x);
        return {
          text: parts
            .map((part) => part.str)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim(),
          x: Math.min(...parts.map((part) => part.x)),
          y,
        };
      })
      .filter((l) => l.text.length > 0);
    pages.push(lines);
  }
  return pages;
}

export function isSystemSurveyorText(pages: SurveyorTextLine[][]): boolean {
  return pages.some((lines) =>
    lines.some((l) => l.text.toLowerCase().includes("system surveyor")),
  );
}

/** Pure parser: table lines in, proposal out. No I/O, no pdf.js. */
export function parseSurveyorPages(pages: SurveyorTextLine[][]): SurveyorProposal {
  const empty: SurveyorProposal = {
    isSurveyor: false,
    items: [],
    cameras: 0,
    drops: 0,
    aps: 0,
    networkPorts: 0,
    unmatchedRows: 0,
  };
  if (!isSystemSurveyorText(pages)) return empty;

  const merged = new Map<string, SurveyorItem>();
  let unmatched = 0;
  for (const lines of pages) {
    for (const line of lines) {
      const text = line.text.trim();
      // A BOM row ends with its quantity as its own column ("... 12",
      // "... Qty: 12"). The number must be a standalone token — a model
      // number like "Cat6" ends in a digit but is not a quantity.
      const qtyMatch = text.match(/(?:^|\s)(?:qty[:\s]*)?(\d{1,4})\s*$/i);
      if (!qtyMatch) {
        // A device-looking line with no quantity is a row we cannot use.
        if (classify(text)) unmatched++;
        continue;
      }
      const qty = parseInt(qtyMatch[1], 10);
      if (qty <= 0) continue;
      const name = text
        .slice(0, qtyMatch.index)
        .replace(/^\d+[.)]\s*/, "")
        .replace(/\s+/g, " ")
        .trim();
      if (name.length < 4 || SKIP_RE.test(name)) continue;
      const kind = classify(name);
      if (!kind) {
        unmatched++;
        continue;
      }
      const key = `${kind}:${name.toLowerCase().replace(/[^a-z0-9]+/g, " ")}`;
      const existing = merged.get(key);
      if (existing) existing.quantity += qty;
      else merged.set(key, { kind, name, quantity: qty });
    }
  }

  const items = [...merged.values()].sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      a.name.localeCompare(b.name),
  );
  const sum = (kind: SurveyorKind) =>
    items.filter((i) => i.kind === kind).reduce((acc, i) => acc + i.quantity, 0);
  const cameras = sum("camera");
  const drops = sum("drop");
  const aps = sum("ap");
  return {
    isSurveyor: true,
    items,
    cameras,
    drops,
    aps,
    networkPorts: cameras + drops + aps,
    unmatchedRows: unmatched,
  };
}

// ───────── Rack plan ─────────

export interface RackPlan {
  networkPorts: number;
  panels: { size: 24 | 48 }[];
  switches: { size: 24 | 48 }[];
  /** NVR channels, 0 when the import found no cameras. */
  nvrChannels: number;
  /** NVR height in U, 0 when no cameras. */
  nvrHeight: 0 | 3 | 4 | 5;
  /** U the placements occupy, shelf included. */
  totalU: number;
  rackU: 12 | 24 | 42;
}

/** Size panels/switches from the port count: 48s while over 24, then a 24. */
function sizeByPorts(ports: number): { size: 24 | 48 }[] {
  const out: { size: 24 | 48 }[] = [];
  let remaining = ports;
  while (remaining > 0) {
    if (remaining > 24) {
      out.push({ size: 48 });
      remaining -= 48;
    } else {
      out.push({ size: 24 });
      remaining -= 24;
    }
  }
  return out;
}

export function planRackForSurveyor(proposal: SurveyorProposal): RackPlan {
  const ports = proposal.networkPorts;
  const panels = sizeByPorts(ports);
  const switches = sizeByPorts(ports);
  const cams = proposal.cameras;
  const nvrChannels = cams === 0 ? 0 : cams <= 8 ? 8 : cams <= 16 ? 16 : cams <= 32 ? 32 : 64;
  const nvrHeight: 0 | 3 | 4 | 5 =
    cams === 0 ? 0 : cams <= 8 ? 3 : cams <= 16 ? 4 : 5;
  const panelU = panels.reduce((acc, p) => acc + (p.size === 48 ? 2 : 1), 0);
  const switchU = switches.reduce((acc, s) => acc + (s.size === 48 ? 2 : 1), 0);
  const totalU = 1 + nvrHeight + panelU + switchU; // 1U shelf + NVR + panels + switches
  const rackU: 12 | 24 | 42 = totalU + 6 <= 12 ? 12 : totalU + 6 <= 24 ? 24 : 42;
  return { networkPorts: ports, panels, switches, nvrChannels, nvrHeight, totalU, rackU };
}

/**
 * Rack placements for the plan, bottom-up on generic defaults: shelf at
 * U1, NVR above it, then switches, then panels. Panels get short names
 * PP / PP 2… and switches SW 1 / SW 2… so the patch table works without
 * extra typing. Everything full-width; the user splits halves later if
 * a job needs it.
 */
export function buildSurveyorRackPlacements(plan: RackPlan): RackPlacement[] {
  const placements: RackPlacement[] = [];
  let slot = 1;
  placements.push({ id: uid(), deviceId: "generic-network-shelf-1u", uSlot: slot });
  slot += 1;
  if (plan.nvrHeight > 0) {
    placements.push({
      id: uid(),
      deviceId: "generic-nvr",
      uSlot: slot,
      // Catalog NVR is 4U; only store an override when the plan sizes it
      // differently.
      ...(plan.nvrHeight !== 4 ? { uHeightOverride: plan.nvrHeight } : {}),
    });
    slot += plan.nvrHeight;
  }
  plan.switches.forEach((s, i) => {
    const h = s.size === 48 ? 2 : 1;
    placements.push({
      id: uid(),
      deviceId: s.size === 48 ? "generic-switch-48" : "generic-switch-24",
      uSlot: slot,
      shortName: `SW ${i + 1}`,
    });
    slot += h;
  });
  plan.panels.forEach((p, i) => {
    const h = p.size === 48 ? 2 : 1;
    placements.push({
      id: uid(),
      deviceId: p.size === 48 ? "generic-patch-panel-48" : "generic-patch-panel-24",
      uSlot: slot,
      shortName: i === 0 ? "PP" : `PP ${i + 1}`,
    });
    slot += h;
  });
  return placements;
}

// ───────── Explicit upload (its own button, no auto-detection) ─────────

export interface SurveyorImportSource {
  bytes: Uint8Array;
  filename: string;
  /** Sheets the upload just created — drops stage on the first one. */
  sheetIds: string[];
}

/**
 * Upload a client's System Surveyor PDF from the dedicated import
 * button: ingest it as sheets, then open the review modal. The user
 * chose this path, so no detection runs — if the file turns out to have
 * no device table, the modal says so. Dynamic imports keep this module
 * importable in non-browser runtimes (tests).
 */
export async function uploadSurveyorPdf(file: File): Promise<void> {
  const { useProjectStore } = await import("../store/projectStore");
  const { ingestFile } = await import("./ingest");
  const st = useProjectStore.getState();
  if (!/\.pdf$/i.test(file.name)) {
    st.pushToast("error", "Pick a PDF report.");
    return;
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    st.pushToast("error", `Could not read ${file.name}.`);
    return;
  }
  let sheets: Awaited<ReturnType<typeof ingestFile>>;
  try {
    sheets = await ingestFile(file);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[surveyor-import]", file.name, e);
    st.pushToast("error", `${file.name}: ${msg}`);
    return;
  }
  for (const sheet of sheets) st.addSheet(sheet);
  st.setSurveyorImport({
    bytes,
    filename: file.name,
    sheetIds: sheets.map((s) => s.id),
  });
}
