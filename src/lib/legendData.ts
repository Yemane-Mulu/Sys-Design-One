// Shared legend model — the single source of truth for what the markup-PDF
// legend and the editor's live ghost (BrandPreview) render. Both consumers
// build their line lists here so the export and the preview can never drift
// apart; they differ only in how they paint the same lines (pdf-lib y-up
// vs. Konva y-down).
//
// Sections (user-directed, 2026-11-04):
//   DEVICES — one row per device CATEGORY present on the sheet (per-category
//             chosen over per-model), colored disc in the category color,
//             qty right-aligned.
//   DROPS   — one row per drop group keyed jack type → service → bare
//             "DROPS" fallback, faceplate-square icon echoing the canvas
//             drop. Drops are documentation-only (Patch 15): they never
//             reach the BOM or any total.

import type { DropMarkup, DropService, Markup } from "../store/projectStore";
import { devicesById } from "../data/devices";
import { categoryColor, categoryLabel, colors } from "../brand/tokens";

/** Legend geometry budget, in PDF points. The default legend box is the
 *  fixed 180×200 rect from defaultLegendBounds() and the export always
 *  passes explicit bounds, so these constants are what both renderers
 *  size rows against. */
export const LEGEND_HEADER_HEIGHT = 18;
export const LEGEND_PADDING = 10;
export const LEGEND_LINE_HEIGHT = 14;

/** How many 14pt line units fit inside a legend box of this height. */
export function legendCapacityUnits(height: number): number {
  return Math.max(
    0,
    Math.floor((height - LEGEND_HEADER_HEIGHT - LEGEND_PADDING * 2) / LEGEND_LINE_HEIGHT),
  );
}

/** Display label for a drop's carried service (voice jacks read "Phone"
 *  on walkthrough sheets). */
export const DROP_SERVICE_LABELS: Record<DropService, string> = {
  data: "Data",
  poe: "PoE",
  voice: "Phone",
  coax: "Coax",
  fiber: "Fiber",
};

/** Legend group label for one drop: jack type wins, then service, else the
 *  bare fallback. Jack types are uppercased so "cat 6" and "Cat 6" merge
 *  into one group. */
export function dropGroupLabel(m: DropMarkup): string {
  const jack = (m.jackType ?? "").trim();
  if (jack) return `${jack.toUpperCase()} DROPS`;
  const service = m.service ? DROP_SERVICE_LABELS[m.service] : undefined;
  return service ? `${service} DROPS` : "DROPS";
}

export interface LegendDeviceRow {
  kind: "device";
  /** Category id — the grouping key. */
  key: string;
  label: string;
  /** Category hex — the disc color. */
  color: string;
  qty: number;
}

export interface LegendDropRow {
  kind: "drop";
  /** Normalized group label — the grouping key. */
  key: string;
  label: string;
  qty: number;
}

export type LegendRow = LegendDeviceRow | LegendDropRow;

export interface LegendSection {
  title: "DEVICES" | "DROPS";
  rows: LegendRow[];
}

/** Faceplate-square icon colors — echo the canvas drop exactly
 *  (MarkupLayer: midnight plate, blue stroke, amber jack dots). */
export const DROP_PLATE_COLORS = {
  plate: colors.midnight,
  stroke: colors.signalBlue,
  jack: colors.amber,
} as const;

export interface LegendData {
  /** DEVICES first, then DROPS; empty sections are omitted entirely. */
  sections: LegendSection[];
  /** Total device + drop markups covered — the "N ITEMS" header figure. */
  totalItems: number;
}

/** Aggregate a sheet's markups into the shared legend model. */
export function buildLegendData(markups: Markup[]): LegendData {
  const deviceQty = new Map<string, number>();
  const dropQty = new Map<string, number>();
  for (const m of markups) {
    if (m.kind === "device") {
      const dev = devicesById[m.deviceId];
      if (!dev) continue;
      deviceQty.set(dev.category, (deviceQty.get(dev.category) ?? 0) + 1);
    } else if (m.kind === "drop") {
      const key = dropGroupLabel(m);
      dropQty.set(key, (dropQty.get(key) ?? 0) + 1);
    }
  }
  const sections: LegendSection[] = [];
  if (deviceQty.size > 0) {
    sections.push({
      title: "DEVICES",
      rows: Array.from(deviceQty.entries()).map(([category, qty]) => ({
        kind: "device" as const,
        key: category,
        label: categoryLabel[category] ?? category,
        color: categoryColor[category] ?? "#94A0B8",
        qty,
      })),
    });
  }
  if (dropQty.size > 0) {
    sections.push({
      title: "DROPS",
      rows: Array.from(dropQty.entries()).map(([key, qty]) => ({
        kind: "drop" as const,
        key,
        label: key,
        qty,
      })),
    });
  }
  const totalItems = sections.reduce(
    (sum, sec) => sum + sec.rows.reduce((q, row) => q + row.qty, 0),
    0,
  );
  return { sections, totalItems };
}

/** One painted line of the legend box. */
export type LegendLine =
  | { type: "header"; title: string }
  | ({ type: "row" } & LegendRow)
  | { type: "more"; count: number };

export interface LegendLayout {
  lines: LegendLine[];
  /** Rows clipped out of the box — drawn as "+ N more" when > 0. */
  overflow: number;
  /** Total markups covered (all groups, clipped or not). */
  totalItems: number;
  /** Header count chip, e.g. "16 ITEMS". */
  itemCountLabel: string;
}

function itemCountLabelOf(total: number): string {
  return `${total} ${total === 1 ? "ITEM" : "ITEMS"}`;
}

/** Count the line units a full (unclipped) model needs: each section
 *  header plus one unit per row. */
function legendUnitCount(data: LegendData): number {
  return data.sections.reduce(
    (sum, sec) => sum + (sec.rows.length > 0 ? sec.rows.length + 1 : 0),
    0,
  );
}

/** Fit the legend model into the box's line capacity: DEVICES first, then
 *  DROPS, both clipped to the box with a "+ N more" footer. A section
 *  header that would strand with zero rows below it is dropped rather
 *  than drawn empty. */
export function layoutLegend(data: LegendData, capacity: number): LegendLayout {
  const label = itemCountLabelOf(data.totalItems);
  const lines: LegendLine[] = [];
  const pushSection = (sec: LegendSection, rowCount: number) => {
    lines.push({ type: "header", title: sec.title });
    for (const row of sec.rows.slice(0, rowCount)) {
      lines.push({ type: "row", ...row });
    }
  };

  if (legendUnitCount(data) <= capacity) {
    for (const sec of data.sections) {
      if (sec.rows.length > 0) pushSection(sec, sec.rows.length);
    }
    return { lines, overflow: 0, totalItems: data.totalItems, itemCountLabel: label };
  }

  // Overflow: reserve one unit for the "+ N more" footer.
  const budget = capacity - 1;
  let used = 0;
  let overflow = 0;
  for (const sec of data.sections) {
    if (sec.rows.length === 0) continue;
    if (budget - used < 2) {
      // No room for this header plus even one row — the whole section
      // clips, and a stranded header is dropped, not drawn.
      overflow += sec.rows.length;
      continue;
    }
    used += 1; // header
    const visible = Math.min(sec.rows.length, budget - used);
    pushSection(sec, visible);
    used += visible;
    overflow += sec.rows.length - visible;
  }
  if (overflow > 0) lines.push({ type: "more", count: overflow });
  return { lines, overflow, totalItems: data.totalItems, itemCountLabel: label };
}