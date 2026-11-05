// Shared legend model — the single source of truth for what the markup-PDF
// legend and the editor's live ghost (BrandPreview) render. Both consumers
// build their line lists here so the export and the preview can never drift
// apart; they differ only in how they paint the same lines (pdf-lib y-up
// vs. Konva y-down).
//
// Sections (user-directed, 2026-11-04 / Patch 19, 2026-11-05):
//   DEVICES — one row per device SUBCATEGORY present on the sheet (APs,
//             Switches, Routers, Dome, …), disc in the category color, the
//             standardized subcategory icon drawn inside it, qty
//             right-aligned. Catalog devices with no subcategory roll into
//             one neutral "OTHER" row (user decision 2026-11-05) regardless
//             of category.
//   DROPS   — one row per drop group keyed jack type → service → bare
//             "DROPS" fallback, faceplate-square icon echoing the canvas
//             drop. Drops are documentation-only (Patch 15): they never
//             reach the BOM or any total.

import type { DropMarkup, DropService, Markup } from "../store/projectStore";
import { devicesById } from "../data/devices";
import type { DeviceType } from "../data/devices";
import { categoryColor, colors } from "../brand/tokens";

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
  /** Subcategory name — the grouping key ("Switches", "Dome", …);
   *  "OTHER" for the subcategory-less fallback row. */
  key: string;
  label: string;
  /** Category hex — the disc color. */
  color: string;
  qty: number;
  /** Standardized subcategory icon (24×24 paths, theme tokens) —
   *  absent on the OTHER fallback row and on drop rows. */
  icon?: DeviceType["icon"];
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

/** Label of the fallback row for catalog devices with no subcategory
 *  (user decision 2026-11-05: one neutral row regardless of category). */
export const OTHER_ROW_LABEL = "OTHER";

/** Neutral disc color for the fallback row — subcategory-less devices have
 *  no category color of their own on the legend. */
export const OTHER_ROW_COLOR = colors.ink300;

/** Aggregate a sheet's markups into the shared legend model. */
export function buildLegendData(markups: Markup[]): LegendData {
  // Per-subcategory buckets: qty + the standardized icon (read from the
  // catalog record — the stamp loop in devices.ts has already replaced
  // every mapped subcategory's placeholder, so this is the exact icon the
  // canvas/palette/export draws).
  const subQty = new Map<string, { qty: number; color: string; icon?: DeviceType["icon"] }>();
  let otherQty = 0;
  const dropQty = new Map<string, number>();
  for (const m of markups) {
    if (m.kind === "device") {
      const dev = devicesById[m.deviceId];
      if (!dev) continue;
      if (dev.subcategory) {
        const cur = subQty.get(dev.subcategory);
        if (cur) cur.qty += 1;
        else
          subQty.set(dev.subcategory, {
            qty: 1,
            color: categoryColor[dev.category] ?? "#94A0B8",
            icon: dev.icon,
          });
      } else {
        otherQty += 1;
      }
    } else if (m.kind === "drop") {
      const key = dropGroupLabel(m);
      dropQty.set(key, (dropQty.get(key) ?? 0) + 1);
    }
  }
  const sections: LegendSection[] = [];
  if (subQty.size > 0 || otherQty > 0) {
    const rows: LegendDeviceRow[] = Array.from(subQty.entries()).map(
      ([sub, bucket]) => ({
        kind: "device" as const,
        key: sub,
        label: sub,
        color: bucket.color,
        qty: bucket.qty,
        icon: bucket.icon,
      }),
    );
    if (otherQty > 0) {
      rows.push({
        kind: "device",
        key: OTHER_ROW_LABEL,
        label: OTHER_ROW_LABEL,
        color: OTHER_ROW_COLOR,
        qty: otherQty,
      });
    }
    sections.push({ title: "DEVICES", rows });
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

// ───────── side-strip placement (Patch 19) ─────────
//
// `overlay` (default) keeps the legend box on top of the plan inside the
// sheet. `side` widens that sheet's exported PDF page by a strip to the
// right of the plan and draws the legend inside it — the floor plan area
// is never covered. Geometry below is in **pdf page coords** (y-up,
// bottom-left origin), matching what drawLegend consumes.

/** Total width the exported page grows by in side mode. */
export const LEGEND_STRIP_WIDTH = 200;
/** Legend box's left margin inside the strip (box is 180 wide). */
export const LEGEND_STRIP_BOX_X = 10;
/** Top margin between the strip's page edge and the legend box. */
export const LEGEND_STRIP_TOP = 12;

/** Bounds of the legend box in side mode, in pdf page coords. Auto-height
 *  from the model's content (header + section headers + rows), capped at
 *  the page height so a tiny sheet clips with the `+ N more` footer
 *  instead of running off the page. */
export function sideLegendBounds(
  pageWidth: number,
  pageHeight: number,
  data: LegendData,
): { x: number; y: number; width: number; height: number } {
  const units = legendUnitCount(data);
  const contentH =
    units * LEGEND_LINE_HEIGHT + LEGEND_PADDING * 2 + LEGEND_HEADER_HEIGHT + 2;
  const h = Math.max(
    LEGEND_HEADER_HEIGHT + LEGEND_PADDING * 2 + 2,
    Math.min(contentH, pageHeight - LEGEND_STRIP_TOP * 2),
  );
  return {
    x: pageWidth - LEGEND_STRIP_WIDTH + LEGEND_STRIP_BOX_X,
    y: pageHeight - LEGEND_STRIP_TOP - h,
    width: 180,
    height: h,
  };
}

// ───────── side-strip title block (Patch 20) ─────────
//
// The title block can join the legend on the side strip: bottom-anchored
// in the strip so a side legend (top-anchored, above) and the title block
// stack like a classic drawing sheet. Width is the strip box width (180) —
// the overlay default 280–380 does not fit — with a compact 2×2 metadata
// grid at that width (handled by the renderers).

/** Title block height on the side strip — mirrors the 138pt overlay
 *  default from sheetAnalysis.defaultTitleBlockBounds. */
export const LEGEND_STRIP_TITLE_HEIGHT = 138;
/** Bottom margin between the strip's page edge and the title block. */
export const LEGEND_STRIP_TITLE_BOTTOM = 16;

/** Bounds of the title block in side mode, in pdf page coords (y-up).
 *  Bottom-anchored; height capped on very short pages (16pt bottom
 *  margin + at least 16pt of headroom) so it never runs off the page. */
export function sideTitleBlockBounds(
  pageWidth: number,
  pageHeight: number,
): { x: number; y: number; width: number; height: number } {
  const h = Math.max(
    50,
    Math.min(LEGEND_STRIP_TITLE_HEIGHT, pageHeight - LEGEND_STRIP_TITLE_BOTTOM * 2),
  );
  return {
    x: pageWidth - LEGEND_STRIP_WIDTH + LEGEND_STRIP_BOX_X,
    y: LEGEND_STRIP_TITLE_BOTTOM,
    width: 180,
    height: h,
  };
}