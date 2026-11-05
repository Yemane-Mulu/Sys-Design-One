// @vitest-environment node
// Patch 18 — shared legend model (src/lib/legendData.ts), consumed by BOTH
// the markup-PDF export (titleBlockRenderer drawLegend) and the editor ghost
// (BrandPreview LegendGhost) so they can never drift. Patch 19 — DEVICES rows
// group per SUBCATEGORY (user decision 2026-11-05) with a neutral OTHER row
// for subcategory-less devices, rows carry the standardized icon, and the
// side-strip bounds helper is covered:
//   - DEVICES groups per subcategory (APs, Switches, Routers, Dome, …) —
//     one row per subcategory present on the sheet, disc in the CATEGORY
//     color, the standardized subcategory icon inside it, qty right-aligned
//   - subcategory-less catalog devices roll into one neutral OTHER row
//     (user decision 2026-11-05), regardless of category
//   - DROPS groups jack type → service → bare "DROPS" fallback, jack types
//     uppercased so "cat 6" / "Cat 6" merge into one row
//   - section order DEVICES → DROPS; a stranded section header (zero rows
//     below it after clipping) is dropped, never drawn
//   - clipping to the fixed 180×200 default legend box budget (11 line
//     units) with a "+ N more" footer; sideLegendBounds sizes the strip box
//   - the standardized subcategory icon stamp on the device catalog
import { describe, it, expect } from "vitest";
import {
  buildLegendData,
  layoutLegend,
  legendCapacityUnits,
  dropGroupLabel,
  DROP_SERVICE_LABELS,
  DROP_PLATE_COLORS,
  LEGEND_HEADER_HEIGHT,
  LEGEND_LINE_HEIGHT,
  LEGEND_PADDING,
  OTHER_ROW_LABEL,
  sideLegendBounds,
  sideTitleBlockBounds,
  LEGEND_STRIP_WIDTH,
  LEGEND_STRIP_BOX_X,
  LEGEND_STRIP_TITLE_HEIGHT,
  type LegendData,
  type LegendDeviceRow,
  type LegendDropRow,
  type LegendSection,
} from "../src/lib/legendData";
import { devices, devicesById } from "../src/data/devices";
import { categoryColor } from "../src/brand/tokens";
import type { DeviceMarkup, DropMarkup, Markup } from "../src/store/projectStore";

// ───────── fixtures ─────────

function deviceMarkup(deviceId: string): DeviceMarkup {
  const dev = devicesById[deviceId];
  if (!dev) throw new Error(`no such device: ${deviceId}`);
  return {
    id: `m-${deviceId}`,
    kind: "device",
    layer: dev.category,
    deviceId,
    category: dev.category,
    x: 0,
    y: 0,
    tag: "T-01",
  };
}

function dropMarkup(partial: Partial<DropMarkup> = {}): DropMarkup {
  return {
    id: `drop-${Math.random().toString(36).slice(2, 10)}`,
    kind: "drop",
    layer: "drop",
    number: "D-001",
    faceplateId: "fp-1",
    x: 0,
    y: 0,
    ...partial,
  };
}

const deviceRow = (key: string, qty = 1): LegendDeviceRow => ({
  kind: "device",
  key,
  label: key,
  color: "#2BD37C",
  qty,
});
const dropRow = (key: string, qty = 1): LegendDropRow => ({
  kind: "drop",
  key,
  label: key,
  qty,
});
const section = (
  title: "DEVICES" | "DROPS",
  rows: LegendDeviceRow[] | LegendDropRow[],
): LegendSection => ({ title, rows });

// ───────── drop group labels ─────────

describe("dropGroupLabel", () => {
  it("jack type wins and is uppercased — 'cat 6' and 'Cat 6' merge", () => {
    expect(dropGroupLabel(dropMarkup({ jackType: "Cat 6" }))).toBe("CAT 6 DROPS");
    expect(dropGroupLabel(dropMarkup({ jackType: "cat 6" }))).toBe("CAT 6 DROPS");
    expect(dropGroupLabel(dropMarkup({ jackType: "Cat 6 keystone" }))).toBe(
      "CAT 6 KEYSTONE DROPS",
    );
  });
  it("falls back to the service label when no jack type is set", () => {
    expect(dropGroupLabel(dropMarkup({ service: "voice" }))).toBe("Phone DROPS");
    expect(dropGroupLabel(dropMarkup({ service: "data" }))).toBe("Data DROPS");
    expect(dropGroupLabel(dropMarkup({ service: "poe" }))).toBe("PoE DROPS");
    expect(dropGroupLabel(dropMarkup({ service: "coax" }))).toBe("Coax DROPS");
    expect(dropGroupLabel(dropMarkup({ service: "fiber" }))).toBe("Fiber DROPS");
  });
  it("bare fallback, including blank/whitespace jack types", () => {
    expect(dropGroupLabel(dropMarkup())).toBe("DROPS");
    expect(dropGroupLabel(dropMarkup({ jackType: "   " }))).toBe("DROPS");
  });
  it("service label map covers every DropService", () => {
    expect(Object.keys(DROP_SERVICE_LABELS).sort()).toEqual([
      "coax",
      "data",
      "fiber",
      "poe",
      "voice",
    ]);
  });
  it("drop plate square echoes the canvas drop colors", () => {
    expect(DROP_PLATE_COLORS.plate).toBe("#0B1220");
    expect(DROP_PLATE_COLORS.stroke).toBe("#4FB7FF");
    expect(DROP_PLATE_COLORS.jack).toBe("#F4B740");
  });
});

// ───────── aggregation ─────────

describe("buildLegendData", () => {
  const switches = devices.filter((d) => d.subcategory === "Switches");
  const cameras = devices.filter((d) => d.category === "cameras");

  it("groups devices per SUBCATEGORY (Patch 19), not per category or model", () => {
    expect(switches.length).toBeGreaterThanOrEqual(2);
    expect(switches.every((d) => d.category === "network")).toBe(true);
    const dome = cameras.find((d) => d.subcategory === "Dome")!;
    const bullet = cameras.find((d) => d.subcategory === "Bullet")!;
    const markups: Markup[] = [
      deviceMarkup(switches[0].id),
      deviceMarkup(switches[1].id),
      deviceMarkup(dome.id),
      deviceMarkup(bullet.id),
      dropMarkup({ jackType: "Cat 6" }),
      dropMarkup({ jackType: "cat 6" }),
      dropMarkup({ service: "voice" }),
    ];
    const data = buildLegendData(markups);
    expect(data.sections.map((s) => s.title)).toEqual(["DEVICES", "DROPS"]);

    const dev = data.sections[0];
    // Switches (2 models) collapse to ONE row; Dome + Bullet are separate.
    expect(dev.rows.map((r) => r.key)).toEqual(["Switches", "Dome", "Bullet"]);
    const swRow = dev.rows.find(
      (r) => r.kind === "device" && r.key === "Switches",
    ) as LegendDeviceRow;
    expect(swRow.label).toBe("Switches");
    expect(swRow.qty).toBe(2);
    // Disc keeps the CATEGORY color (network green)…
    expect(swRow.color).toBe(categoryColor.network);
    // …and the row carries the standardized subcategory icon (same object
    // the catalog stamps — the one the canvas/palette/export draws).
    expect(swRow.icon).toBeDefined();
    expect(swRow.icon).toBe(devicesById[switches[0].id].icon);
    const domeRow = dev.rows.find(
      (r) => r.kind === "device" && r.key === "Dome",
    ) as LegendDeviceRow;
    expect(domeRow.color).toBe(categoryColor.cameras);
    expect(domeRow.qty).toBe(1);

    const drops = data.sections[1];
    expect(drops.rows.map((r) => [r.label, r.qty])).toEqual([
      ["CAT 6 DROPS", 2], // "Cat 6" + "cat 6" merged by normalization
      ["Phone DROPS", 1],
    ]);
    expect(data.totalItems).toBe(7);
  });

  it("rolls subcategory-less devices into one neutral OTHER row", () => {
    const noSub = devices.filter((d) => !d.subcategory);
    expect(noSub.length).toBeGreaterThan(0);
    const markups: Markup[] = noSub.map((d) => deviceMarkup(d.id));
    const data = buildLegendData(markups);
    const dev = data.sections[0];
    expect(dev.rows).toHaveLength(1);
    const row = dev.rows[0] as LegendDeviceRow;
    expect(row.key).toBe(OTHER_ROW_LABEL);
    expect(row.label).toBe("OTHER");
    expect(row.qty).toBe(noSub.length);
    // Neutral disc, no icon — subcategory-less devices have neither.
    expect(row.color).toBe("#94A0B8");
    expect(row.icon).toBeUndefined();
    expect(data.totalItems).toBe(noSub.length);
  });

  it("OTHER row sorts last among DEVICES rows", () => {
    const noSub = devices.find((d) => !d.subcategory)!;
    const data = buildLegendData([
      deviceMarkup(cameras.find((d) => d.subcategory === "Dome")!.id),
      deviceMarkup(noSub.id),
    ]);
    const keys = data.sections[0].rows.map((r) => r.key);
    expect(keys[keys.length - 1]).toBe(OTHER_ROW_LABEL);
  });

  it("skips device markups whose id does not resolve in the catalog", () => {
    const unknown: DeviceMarkup = {
      id: "m-unknown",
      kind: "device",
      layer: "network",
      deviceId: "not-a-real-device-id",
      category: "network",
      x: 0,
      y: 0,
      tag: "T-99",
    };
    const data = buildLegendData([unknown]);
    expect(data.sections).toHaveLength(0);
    expect(data.totalItems).toBe(0);
  });

  it("drops-only sheet keeps the DEVICES section out entirely", () => {
    const data = buildLegendData([dropMarkup({ jackType: "Cat 5e" })]);
    expect(data.sections.map((s) => s.title)).toEqual(["DROPS"]);
    expect(data.totalItems).toBe(1);
  });

  it("empty input yields no sections", () => {
    const data = buildLegendData([]);
    expect(data.sections).toEqual([]);
    expect(data.totalItems).toBe(0);
  });
});

// ───────── geometry budget ─────────

describe("legendCapacityUnits", () => {
  it("the fixed 180×200 default box budgets 11 line units", () => {
    expect(legendCapacityUnits(200)).toBe(11);
  });
  it("derives from the shared geometry constants", () => {
    expect(
      Math.floor(
        (200 - LEGEND_HEADER_HEIGHT - LEGEND_PADDING * 2) / LEGEND_LINE_HEIGHT,
      ),
    ).toBe(11);
  });
  it("clamps small boxes to zero", () => {
    expect(legendCapacityUnits(30)).toBe(0);
  });
});

// ───────── clipping / layout ─────────

describe("layoutLegend", () => {
  it("fits unclipped when the units ≤ capacity, DEVICES first", () => {
    const data: LegendData = {
      sections: [
        section("DEVICES", [deviceRow("a"), deviceRow("b")]),
        section("DROPS", [dropRow("CAT 6 DROPS", 10)]),
      ],
      totalItems: 13,
    };
    const l = layoutLegend(data, 11);
    expect(l.overflow).toBe(0);
    expect(l.lines.map((x) => x.type)).toEqual([
      "header",
      "row",
      "row",
      "header",
      "row",
    ]);
    expect(l.itemCountLabel).toBe("13 ITEMS");
  });

  it("clips a full DEVICES section with a '+ N more' footer", () => {
    // Budget 10: the DEVICES header + 9 visible rows consume it all; the
    // 10th device row and both DROPS rows clip → overflow 3, and the
    // DROPS header would strand with zero rows, so it's dropped.
    const data: LegendData = {
      sections: [
        section("DEVICES", ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((k) => deviceRow(k))),
        section("DROPS", [dropRow("CAT 6 DROPS"), dropRow("CAT 5E DROPS")]),
      ],
      totalItems: 12,
    };
    const l = layoutLegend(data, 11);
    expect(l.overflow).toBe(3);
    expect(l.lines).toHaveLength(11);
    expect(l.lines[l.lines.length - 1]).toEqual({ type: "more", count: 3 });
    // The DROPS header would strand with zero rows — dropped, not drawn.
    expect(
      l.lines.filter((x) => x.type === "header").map((x) => (x as { title: string }).title),
    ).toEqual(["DEVICES"]);
    // Header count reflects the whole sheet, not just the visible rows.
    expect(l.itemCountLabel).toBe("12 ITEMS");
  });

  it("splits the budget across sections and footers the remainder", () => {
    const data: LegendData = {
      sections: [
        section("DEVICES", [deviceRow("a"), deviceRow("b")]),
        section(
          "DROPS",
          ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9"].map((k) => dropRow(k)),
        ),
      ],
      totalItems: 11,
    };
    const l = layoutLegend(data, 11);
    // Budget 10: DEVICES header+2 (3) + DROPS header (4) + 6 rows (10).
    expect(l.overflow).toBe(3);
    expect(l.lines).toHaveLength(11);
    expect(l.lines[9]).toMatchObject({ type: "row", kind: "drop", key: "c6" });
    expect(l.lines[10]).toEqual({ type: "more", count: 3 });
  });

  it("drops a trailing section header that would strand with zero rows", () => {
    const data: LegendData = {
      sections: [
        section("DEVICES", ["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((k) => deviceRow(k))),
        section("DROPS", [dropRow("CAT 6 DROPS")]),
      ],
      totalItems: 10,
    };
    const l = layoutLegend(data, 11);
    expect(l.overflow).toBe(1);
    expect(
      l.lines.some(
        (x) => x.type === "header" && (x as { title: string }).title === "DROPS",
      ),
    ).toBe(false);
    expect(l.lines[l.lines.length - 1]).toEqual({ type: "more", count: 1 });
  });

  it("degrades to a single footer when nothing fits", () => {
    const data: LegendData = {
      sections: [section("DEVICES", [deviceRow("a")]), section("DROPS", [dropRow("b")])],
      totalItems: 2,
    };
    const l = layoutLegend(data, 0);
    expect(l.lines).toEqual([{ type: "more", count: 2 }]);
    expect(l.overflow).toBe(2);
  });

  it("renders a singular count chip", () => {
    const l = layoutLegend(
      { sections: [section("DEVICES", [deviceRow("a")])], totalItems: 1 },
      11,
    );
    expect(l.itemCountLabel).toBe("1 ITEM");
  });
});

// ───────── side-strip placement (Patch 19) ─────────

describe("sideLegendBounds", () => {
  it("places the 180-wide box inside the widened page's strip", () => {
    const data: LegendData = {
      sections: [section("DEVICES", [deviceRow("a"), deviceRow("b")])],
      totalItems: 3,
    };
    // Typical arch sheet: 24×36 landscape (864×518pt) + 200 strip.
    const pw = 864 + LEGEND_STRIP_WIDTH;
    const ph = 518;
    const b = sideLegendBounds(pw, ph, data);
    expect(b.width).toBe(180);
    // Inside the strip: right of the plan, left of the page edge.
    expect(b.x).toBe(pw - LEGEND_STRIP_WIDTH + LEGEND_STRIP_BOX_X);
    expect(b.x).toBeGreaterThanOrEqual(864);
    expect(b.x + b.width).toBeLessThanOrEqual(pw);
    // Top-anchored (pdf y-up: y measured from the page BOTTOM).
    expect(b.y + b.height).toBe(ph - 12);
    // Auto-height: 2 rows + header = 2 header units → content height.
    const units = 1 + 2; // section header + 2 rows
    expect(b.height).toBe(units * LEGEND_LINE_HEIGHT + LEGEND_PADDING * 2 + LEGEND_HEADER_HEIGHT + 2);
  });

  it("caps the box at the page height so tiny sheets clip, not overflow", () => {
    const data: LegendData = {
      sections: [section("DEVICES", Array.from({ length: 30 }, (_, i) => deviceRow(`d${i}`)))],
      totalItems: 30,
    };
    const b = sideLegendBounds(400, 100, data);
    expect(b.height).toBeLessThanOrEqual(100);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.y + b.height).toBeLessThanOrEqual(100);
  });

  it("keeps a sane minimum height even with a single row", () => {
    const data: LegendData = {
      sections: [section("DROPS", [dropRow("CAT 6 DROPS")])],
      totalItems: 1,
    };
    const b = sideLegendBounds(1064, 518, data);
    // 1 section header + 1 row = 2 units → header + 2 lines + padding fits.
    expect(b.height).toBeGreaterThanOrEqual(
      LEGEND_HEADER_HEIGHT + LEGEND_PADDING * 2 + 2,
    );
  });
});

// ───────── side-strip title block (Patch 20) ─────────

describe("sideTitleBlockBounds", () => {
  it("bottom-anchors the 180-wide title block inside the strip", () => {
    const pw = 864 + LEGEND_STRIP_WIDTH;
    const ph = 518;
    const b = sideTitleBlockBounds(pw, ph);
    expect(b.width).toBe(180);
    expect(b.height).toBe(LEGEND_STRIP_TITLE_HEIGHT); // mirrors the 138pt overlay default
    // Bottom-anchored (pdf y-up): y IS the bottom edge, 16pt above the
    // page bottom; the box top sits at y+height, leaving everything
    // above clear for the top-anchored legend.
    expect(b.y).toBe(16);
    expect(b.x).toBe(pw - LEGEND_STRIP_WIDTH + LEGEND_STRIP_BOX_X);
    expect(b.x).toBeGreaterThanOrEqual(864); // right of the plan
    expect(b.x + b.width).toBeLessThanOrEqual(pw); // left of the page edge
    expect(b.y + b.height).toBe(16 + LEGEND_STRIP_TITLE_HEIGHT);
  });

  it("stacks under a side legend without overlap on a typical sheet", () => {
    // Legend top-anchored (Patch 19): 2 rows + header ≈ 124pt tall from the
    // top; title block bottom-anchored 138pt tall — no overlap on 518pt.
    const pw = 1064;
    const ph = 518;
    const data: LegendData = {
      sections: [section("DEVICES", [deviceRow("a"), deviceRow("b")])],
      totalItems: 3,
    };
    const lg = sideLegendBounds(pw, ph, data);
    const tb = sideTitleBlockBounds(pw, ph);
    expect(lg.y).toBeGreaterThan(tb.y + tb.height);
  });

  it("caps the height on very short pages (never runs off the page)", () => {
    const b = sideTitleBlockBounds(400, 100);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.y + b.height).toBeLessThanOrEqual(100);
    expect(b.height).toBeLessThanOrEqual(100 - 32); // 16pt margins × 2
    expect(b.height).toBeGreaterThanOrEqual(50);
  });
});

// ───────── standardized subcategory icons ─────────

describe("standardized subcategory icons", () => {
  const subcats = Array.from(
    new Set(
      devices
        .map((d) => d.subcategory)
        .filter((s): s is string => typeof s === "string" && s.length > 0),
    ),
  );

  it("the catalog carries exactly the 19 icon'd subcategories", () => {
    expect(subcats.sort()).toEqual(
      [
        "Switches",
        "Firewalls",
        "Routers",
        "Gateways",
        "Infrastructure",
        "Wireless",
        "Access Points",
        "Bullet",
        "Dome",
        "Turret",
        "Compact",
        "PTZ",
        "Fisheye",
        "Box",
        "Panoramic",
        "Mini",
        "Multisensor",
        "Thermal",
        "Distribution",
      ].sort(),
    );
  });

  it("stamps one shared icon object per subcategory — and devicesById inherits it", () => {
    expect(subcats).toHaveLength(19);
    for (const sub of subcats) {
      const group = devices.filter((d) => d.subcategory === sub);
      expect(group.length).toBeGreaterThan(0);
      const icon = group[0].icon;
      // Same reference everywhere — the placeholder literals were
      // per-device objects, so identity proves the stamp ran.
      expect(group.every((d) => d.icon === icon)).toBe(true);
      expect(devicesById[group[0].id].icon === icon).toBe(true);
    }
  });

  it("gives each subcategory a distinct icon", () => {
    const icons = subcats.map((s) => devices.find((d) => d.subcategory === s)!.icon);
    expect(new Set(icons.map((i) => JSON.stringify(i.paths))).size).toBe(subcats.length);
  });

  it("uses only currentFill/currentStroke theme tokens — never hard hex", () => {
    for (const d of devices) {
      if (!d.subcategory) continue;
      for (const p of d.icon.paths) {
        if (p.fill !== undefined) {
          expect(["currentFill", "currentStroke"]).toContain(p.fill);
        }
        if (p.stroke !== undefined) {
          expect(["currentFill", "currentStroke"]).toContain(p.stroke);
        }
        expect(typeof p.d).toBe("string");
        expect(p.d.length).toBeGreaterThan(0);
      }
    }
  });
});