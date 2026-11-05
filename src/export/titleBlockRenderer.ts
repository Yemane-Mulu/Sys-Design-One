import {
  PDFDocument,
  PDFPage,
  PDFFont,
  PDFImage,
  rgb,
  StandardFonts,
} from "pdf-lib";
import type { Project, Sheet, Markup } from "../store/projectStore";
import {
  buildLegendData,
  layoutLegend,
  legendCapacityUnits,
  LEGEND_HEADER_HEIGHT,
  LEGEND_LINE_HEIGHT,
  LEGEND_PADDING,
  DROP_PLATE_COLORS,
  type LegendData,
} from "../lib/legendData";
import {
  categoryColor as catColor,
  categoryLabel as catLabel,
} from "../brand/tokens";
import { resolveBranding, type BrandingConfig } from "../lib/branding";

const KN_AMBER = hex("#F4B740");
const KN_AMBER_DEEP = hex("#C99227");
const KN_MIDNIGHT = hex("#0B1220");
const KN_INK_50 = hex("#F5F7FA");
const KN_INK_300 = hex("#94A0B8");
const KN_INK_400 = hex("#5E6B85");
const KN_INK_500 = hex("#3A4458");

export function hex(h: string) {
  const v = (h ?? "#94A0B8").replace("#", "");
  const r = parseInt(v.slice(0, 2), 16) / 255;
  const g = parseInt(v.slice(2, 4), 16) / 255;
  const b = parseInt(v.slice(4, 6), 16) / 255;
  if (!isFinite(r) || !isFinite(g) || !isFinite(b)) return rgb(0.58, 0.62, 0.72);
  return rgb(r, g, b);
}

/** Linear blend of two pdf-lib colors (t=0 → a, t=1 → b) — mirrors mix()
 * in exportMarkupPdf.ts so the legend icon fill matches the placed
 * device's fill exactly. */
function mixRgb(a: ReturnType<typeof hex>, b: ReturnType<typeof hex>, t: number) {
  return rgb(
    a.red * (1 - t) + b.red * t,
    a.green * (1 - t) + b.green * t,
    a.blue * (1 - t) + b.blue * t,
  );
}

/**
 * Standard pdf-lib fonts (Helvetica/Courier) are WinAnsi-encoded and only
 * cover ~256 codepoints. Any character outside WinAnsi (emoji, Asian scripts,
 * box-drawing, math symbols, etc.) makes `drawText` throw mid-export and the
 * user just sees a generic "Export failed" toast. Sanitize once at the edge:
 * map common look-alikes to ASCII, then strip anything still un-encodable so
 * the export always completes.
 */
const WINANSI_LOOKALIKES: Record<string, string> = {
  "\u2018": "'", // ‘
  "\u2019": "'", // ’
  "\u201A": "'", // ‚
  "\u201B": "'", // ‛
  "\u201C": '"', // “
  "\u201D": '"', // ”
  "\u201E": '"', // „
  "\u2032": "'", // ′
  "\u2033": '"', // ″
  "\u00A0": " ", // nbsp
  "\u2009": " ", // thin space
  "\u200A": " ", // hair space
  "\u200B": "",  // zero-width space
  "\u200C": "",  // ZWNJ
  "\u200D": "",  // ZWJ
  "\uFEFF": "",  // BOM
  "\u2010": "-", // ‐
  "\u2011": "-", // non-breaking hyphen
  "\u2012": "-", // figure dash
  "\u2043": "-", // hyphen bullet
  "\u00D7": "x", // ×
  "\u00F7": "/", // ÷
  "\u2044": "/", // ⁄
  "\u2026": "...", // …  (mapped explicitly even though WinAnsi has it, to keep it deterministic across hosts)
};

// WinAnsi (CP1252) covers 0x20–0x7E plus the high-byte set documented in pdf-lib.
// Codepoints in this set are safe to draw with the standard fonts.
const WINANSI_SET = new Set<number>([
  ...Array.from({ length: 0x7F - 0x20 }, (_, i) => 0x20 + i),
  // C1 high-byte additions used by WinAnsi
  0x20AC, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017D, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022,
  0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x017E, 0x0178,
  ...Array.from({ length: 0xFF - 0xA0 + 1 }, (_, i) => 0xA0 + i),
]);

export function safeText(input: string | null | undefined): string {
  if (input == null) return "";
  let s = String(input);
  // First pass: substitute well-known look-alikes
  let out = "";
  for (const ch of s) {
    const sub = WINANSI_LOOKALIKES[ch];
    out += sub !== undefined ? sub : ch;
  }
  // Second pass: drop anything still outside WinAnsi
  let safe = "";
  for (const ch of out) {
    const cp = ch.codePointAt(0)!;
    if (WINANSI_SET.has(cp)) safe += ch;
    else if (cp >= 0x20 && cp < 0x7F) safe += ch; // ASCII printable
    // else: silently drop
  }
  return safe;
}

export interface BrandFonts {
  bold: PDFFont;
  regular: PDFFont;
  light: PDFFont;
  mono: PDFFont;
}

export async function loadBrandFonts(doc: PDFDocument): Promise<BrandFonts> {
  return {
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    regular: await doc.embedFont(StandardFonts.Helvetica),
    light: await doc.embedFont(StandardFonts.Helvetica),
    mono: await doc.embedFont(StandardFonts.Courier),
  };
}

/** Concrete theme. `auto` is resolved upstream into one of these so the
 *  drawing code never has to think about luminance. */
export type BrandTheme = "dark" | "light";

interface ThemeColors {
  bg: ReturnType<typeof hex>;
  bgInner: ReturnType<typeof hex>;
  border: ReturnType<typeof hex>;
  accent: ReturnType<typeof hex>;
  accentDeep: ReturnType<typeof hex>;
  ink: ReturnType<typeof hex>;
  ink2: ReturnType<typeof hex>;
  ink3: ReturnType<typeof hex>;
  divider: ReturnType<typeof hex>;
  /** Color used for the wordmark/header foreground when drawn on the
   *  amber bar (always KN_MIDNIGHT, both themes — amber stays amber). */
  onAccent: ReturnType<typeof hex>;
}

/** Build a palette for a given theme, swapping in the user's brand
 *  accent colors so the amber bar / accent strip pick up whatever the
 *  team chose in Settings. The other "ink" colors stay fixed because
 *  they're tuned for legibility on the chosen background. */
function paletteFor(
  theme: BrandTheme | undefined,
  branding: BrandingConfig,
): ThemeColors {
  const accent = hex(branding.accentColor);
  const accentDeep = hex(branding.accentDeepColor);
  if (theme === "light") {
    return {
      bg: hex("#FFFFFF"),
      bgInner: hex("#F2F4F8"),
      border: hex("#0B1220"),
      accent,
      accentDeep,
      ink: hex("#0B1220"),
      ink2: hex("#3A4458"),
      ink3: hex("#5E6B85"),
      divider: hex("#C2CADA"),
      onAccent: KN_MIDNIGHT,
    };
  }
  return {
    bg: KN_MIDNIGHT,
    bgInner: hex("#141C2B"),
    border: accent,
    accent,
    accentDeep,
    ink: KN_INK_50,
    ink2: KN_INK_300,
    ink3: KN_INK_400,
    divider: KN_INK_500,
    onAccent: KN_MIDNIGHT,
  };
}

interface TitleBlockOpts {
  page: PDFPage;
  fonts: BrandFonts;
  project: Project;
  sheet: Sheet;
  sheetIndex: number;
  totalSheets: number;
  /** Explicit position + size (in PDF points, page-up coords). Falls back
   *  to the default bottom-right placement when omitted. */
  bounds?: { x: number; y: number; width: number; height: number };
  theme?: BrandTheme;
  /** Branding config for this draw call. Pass `resolveBranding(project.branding)`
   *  upstream so any unset fields use the bundled defaults. */
  branding?: BrandingConfig;
  /** Logo image embedded into the same PDFDocument the page belongs to.
   *  When provided, replaces the built-in D1 monogram. */
  logoImage?: PDFImage;
}

/**
 * Draws the branded title block in the lower-right corner of the page.
 * Width-aware: scales relative to page width but caps at 360 pt.
 */
export function drawTitleBlock(opts: TitleBlockOpts) {
  const { page, fonts, project, sheet, sheetIndex, totalSheets, bounds, theme, logoImage } = opts;
  const { width: pw } = page.getSize();
  const branding = resolveBranding(opts.branding ?? project.branding);
  const palette = paletteFor(theme, branding);

  const w = bounds ? bounds.width : Math.min(380, Math.max(280, pw * 0.18));
  const h = bounds ? bounds.height : 138;
  const x = bounds ? bounds.x : pw - w - 16;
  const y = bounds ? bounds.y : 16;

  // Layout constants scale gracefully for stretched/squished bounds.
  const headerH = Math.max(20, Math.min(30, h * 0.19));
  const footerH = Math.max(14, h * 0.12);
  const accentH = Math.max(2, h * 0.022);

  // Outer panel
  page.drawRectangle({
    x, y, width: w, height: h,
    color: palette.bg,
    borderColor: palette.border,
    borderWidth: 0.75,
    opacity: 0.97,
  });
  // Header bar (always uses the brand accent color in both themes)
  page.drawRectangle({
    x, y: y + h - headerH, width: w, height: headerH, color: palette.accent,
  });
  // Bottom accent strip
  page.drawRectangle({
    x, y, width: w, height: accentH, color: palette.accentDeep,
  });

  // Header content: optional uploaded logo + wordmark. When no logo is
  // set we shrink the left padding so the wordmark doesn't sit
  // awkwardly far from the edge of the header bar.
  const logoSize = headerH - 8;
  const logoY = y + h - headerH + (headerH - logoSize) / 2;
  drawHeaderMark(page, x + 8, logoY, logoSize, palette, logoImage);
  const wordSize = Math.max(11, Math.min(16, headerH * 0.55));
  const wordY = y + h - headerH + (headerH - wordSize) / 2 + 1;
  const wordX = logoImage ? x + headerH + 8 : x + 10;
  // Either piece may be empty — print only the non-empty one and shift
  // the second over by the first's measured width.
  const wmA = safeText(branding.wordmarkPrimary);
  const wmB = safeText(branding.wordmarkSecondary);
  let cursor = wordX;
  if (wmA) {
    page.drawText(wmA, {
      x: cursor, y: wordY, size: wordSize, font: fonts.bold,
      color: palette.onAccent,
    });
    cursor += fonts.bold.widthOfTextAtSize(wmA, wordSize);
  }
  if (wmB) {
    page.drawText(wmB, {
      x: cursor, y: wordY, size: wordSize, font: fonts.regular,
      color: palette.onAccent,
    });
  }
  // Tagline ("SECURITY SYSTEMS" by default) — only renders if non-empty
  // AND there's clear room beyond the wordmark so it doesn't crowd it.
  const tagline = safeText(branding.tagline);
  if (tagline && w > 220) {
    const taglineW = fonts.bold.widthOfTextAtSize(tagline, 7);
    page.drawText(tagline, {
      x: x + w - 10 - taglineW,
      y: y + h - headerH + (headerH - 7) / 2,
      size: 7,
      font: fonts.bold,
      color: palette.onAccent,
    });
  }

  // Body grid
  const bx = x + 10;
  const by = y + h - headerH - 12;
  // Vertical real estate available for the body block (between header
  // and footer) — if the host mask is short we silently shrink the rows.
  const bodyH = h - headerH - footerH;
  const projTitleSize = Math.max(8, Math.min(12, bodyH * 0.16));
  const subSize = Math.max(7, Math.min(9, bodyH * 0.11));

  drawTextClipped(page, safeText(project.meta.projectName).toUpperCase(), {
    x: bx, y: by, size: projTitleSize,
    font: fonts.bold, color: palette.ink,
    maxWidth: w - 20,
  });
  drawTextClipped(page, safeText(project.meta.location), {
    x: bx, y: by - (projTitleSize + 2),
    size: subSize, font: fonts.regular, color: palette.ink2,
    maxWidth: w - 20,
  });

  page.drawLine({
    start: { x: bx, y: by - (projTitleSize + 8) },
    end: { x: x + w - 10, y: by - (projTitleSize + 8) },
    thickness: 0.4, color: palette.divider,
  });

  // Metadata grid. Wide boxes get the classic 4 columns; narrow boxes
  // (the 180pt side strip — Patch 20) switch to a 2×2 grid so values
  // aren't clipped to ~4 characters per cell.
  const metaY = by - (projTitleSize + 20);
  const compact = w < 240;
  const colW = (w - 20) / (compact ? 2 : 4);
  const rowStep = compact ? 24 : 0;
  const cells = [
    { label: "PROJECT", value: safeText(project.meta.projectNumber) || "-" },
    {
      label: "SHEET",
      value:
        safeText(sheet.sheetNumber) ||
        `S-${String(sheetIndex + 1).padStart(2, "0")}`,
    },
    {
      label: "REV",
      value: safeText(sheet.revision || project.meta.revision) || "0",
    },
    {
      label: "DATE",
      value: safeText(new Date(project.meta.date).toLocaleDateString()),
    },
  ];
  cells.forEach((c, i) => {
    const col = compact ? i % 2 : i;
    const row = compact ? Math.floor(i / 2) : 0;
    const cx = bx + colW * col;
    const cy = metaY - row * rowStep;
    page.drawText(c.label, {
      x: cx, y: cy + 11, size: 6,
      font: fonts.bold, color: palette.ink3,
    });
    drawTextClipped(page, c.value, {
      x: cx, y: cy, size: 9,
      font: fonts.bold, color: palette.ink,
      maxWidth: colW - 4,
    });
  });

  // Sheet title (if there's room) — shifted past the compact grid's
  // second row so it never overlaps it.
  const titleBase = metaY - rowStep - 16;
  if (titleBase > y + footerH) {
    page.drawText("SHEET TITLE", {
      x: bx, y: titleBase, size: 6,
      font: fonts.bold, color: palette.ink3,
    });
    drawTextClipped(page, safeText(sheet.sheetTitle || sheet.name).toUpperCase(), {
      x: bx, y: titleBase - 10, size: 9,
      font: fonts.bold, color: palette.ink,
      maxWidth: w - 20,
    });
  }

  // Footer row
  const footY = y + 8;
  page.drawText(
    safeText(
      sheet.scaleNote ||
        (sheet.calibration
          ? `1" = ${(12 / sheet.calibration.pixelsPerFoot).toFixed(2)}'`
          : "NOT TO SCALE"),
    ),
    { x: bx, y: footY, size: 7, font: fonts.bold, color: palette.accent },
  );
  const drawnBy = safeText(
    `BY  ${(project.meta.drawnBy || branding.fullName).toUpperCase()}`,
  );
  const drawnByW = fonts.regular.widthOfTextAtSize(drawnBy, 7);
  if (w > 220) {
    page.drawText(drawnBy, {
      x: x + w / 2 - drawnByW / 2, y: footY,
      size: 7, font: fonts.regular, color: palette.ink2,
    });
  }
  const idxStr = `${sheetIndex + 1} / ${totalSheets}`;
  const idxW = fonts.bold.widthOfTextAtSize(idxStr, 7);
  page.drawText(idxStr, {
    x: x + w - 10 - idxW, y: footY,
    size: 7, font: fonts.bold, color: palette.ink,
  });
}

/**
 * Draws the legend on the right edge — DEVICES + DROPS sections built from
 * the shared legend model (lib/legendData.ts) so the export and the editor
 * ghost render identical content: one row per device subcategory present
 * on the sheet (standardized icon inside the category-colored disc; a
 * neutral OTHER row collects subcategory-less devices), one row per drop
 * group, clipped to the box with a "+ N more" footer when the content
 * overflows.
 */
export function drawLegend({
  page,
  fonts,
  sheet,
  theme,
  bounds,
  branding,
  data: legendData,
}: {
  page: PDFPage;
  fonts: BrandFonts;
  sheet: Sheet;
  theme?: BrandTheme;
  /** User-placed rectangle (in pdf-lib page-up coords). When omitted we
   *  fall back to the historical default top-right slot. */
  bounds?: { x: number; y: number; width: number; height: number };
  branding?: BrandingConfig;
  /** Prebuilt legend model — lets the caller size side-strip bounds from
   *  the same data without rebuilding it. */
  data?: LegendData;
}) {
  const data = legendData ?? buildLegendData(sheet.markups);
  if (data.totalItems === 0) return;

  const palette = paletteFor(theme, resolveBranding(branding));
  const lineH = LEGEND_LINE_HEIGHT;
  const padding = LEGEND_PADDING;
  const headerH = LEGEND_HEADER_HEIGHT;

  // Resolve bounds — explicit user choice, otherwise default top-right
  // sized to fit the full model.
  let x: number;
  let y: number;
  let w: number;
  let h: number;
  if (bounds) {
    x = bounds.x;
    y = bounds.y;
    w = bounds.width;
    h = bounds.height;
  } else {
    const units = data.sections.reduce(
      (sum, sec) => sum + (sec.rows.length > 0 ? sec.rows.length + 1 : 0),
      0,
    );
    const { width: pw, height: ph } = page.getSize();
    w = 180;
    h = units * lineH + padding * 2 + headerH + 2;
    x = pw - w - 16;
    y = ph - h - 16;
  }

  const layout = layoutLegend(data, legendCapacityUnits(h));

  page.drawRectangle({
    x, y, width: w, height: h,
    color: palette.bg,
    borderColor: palette.accent,
    borderWidth: 0.5,
    opacity: 0.95,
  });
  page.drawRectangle({
    x, y: y + h - headerH, width: w, height: headerH,
    color: palette.accent,
  });
  page.drawText("LEGEND", {
    x: x + padding, y: y + h - 14, size: 9,
    font: fonts.bold, color: palette.onAccent,
  });
  const countLabel = safeText(layout.itemCountLabel);
  const countW = fonts.bold.widthOfTextAtSize(countLabel, 7);
  page.drawText(countLabel, {
    x: x + w - padding - countW, y: y + h - 14, size: 7,
    font: fonts.bold, color: palette.onAccent,
  });

  layout.lines.forEach((line, i) => {
    // pdf-lib y-up: line 0 sits just below the header, later lines run
    // down toward the bottom of the rect.
    const ly = y + h - headerH - padding - lineH * (i + 1) + 2;
    if (line.type === "header") {
      page.drawText(safeText(line.title), {
        x: x + padding, y: ly + 1, size: 7,
        font: fonts.bold, color: palette.ink2,
      });
      return;
    }
    if (line.type === "more") {
      page.drawText(safeText(`+ ${line.count} more`), {
        x: x + padding, y: ly, size: 8,
        font: fonts.regular, color: palette.ink2,
      });
      return;
    }
    // Row marker: colored disc for devices (category color, standardized
    // subcategory icon inside); faceplate square echoing the canvas drop
    // for drops (midnight plate, blue stroke, amber jack).
    if (line.kind === "device") {
      const dcx = x + padding + 6;
      const dcy = ly + 4;
      page.drawCircle({
        x: dcx, y: dcy, size: 5,
        color: palette.bgInner,
        borderColor: hex(line.color), borderWidth: 0.6,
      });
      if (line.icon) {
        const color = hex(line.color);
        // Same soft fill the device disc uses on the sheet itself
        // (mix(color, midnight, 0.78) in exportMarkupPdf) so the legend
        // icon reads identically to the placed device.
        const fillSoft = mixRgb(color, KN_MIDNIGHT, 0.78);
        const iconSize = 8;
        const scale = iconSize / 24;
        for (const p of line.icon.paths) {
          const fill =
            p.fill === "currentFill"
              ? fillSoft
              : p.fill === "currentStroke"
              ? color
              : p.fill
              ? hex(p.fill)
              : undefined;
          const stroke =
            p.stroke === "currentStroke"
              ? color
              : p.stroke === "currentFill"
              ? fillSoft
              : p.stroke
              ? hex(p.stroke)
              : undefined;
          page.drawSvgPath(p.d, {
            x: dcx - iconSize / 2,
            y: dcy + iconSize / 2,
            scale,
            color: fill,
            borderColor: stroke,
            // Legend icons draw at ~1/3 canvas scale — scale the stroke
            // back proportionally, floored for print legibility.
            borderWidth:
              stroke !== undefined
                ? Math.max(0.55, (p.strokeWidth ?? 1.4) * 0.6)
                : 0,
          });
        }
      }
    } else {
      page.drawRectangle({
        x: x + padding + 1, y: ly - 1, width: 10, height: 10,
        color: hex(DROP_PLATE_COLORS.plate),
        borderColor: hex(DROP_PLATE_COLORS.stroke), borderWidth: 0.7,
      });
      page.drawCircle({
        x: x + padding + 6, y: ly + 4, size: 1.3,
        color: hex(DROP_PLATE_COLORS.jack),
      });
    }
    drawTextClipped(page, safeText(line.label), {
      x: x + padding + 16, y: ly + 1, size: 8,
      font: fonts.regular, color: palette.ink,
      maxWidth: w - padding * 2 - 16 - 24,
    });
    const qty = String(line.qty);
    const qw = fonts.bold.widthOfTextAtSize(qty, 9);
    page.drawText(qty, {
      x: x + w - padding - qw, y: ly, size: 9,
      font: fonts.bold, color: palette.accent,
    });
  });
}

// ───────── Helpers ─────────

function drawTextClipped(
  page: PDFPage,
  text: string,
  opts: { x: number; y: number; size: number; font: PDFFont; color: any; maxWidth: number },
) {
  let t = safeText(text);
  while (opts.font.widthOfTextAtSize(t, opts.size) > opts.maxWidth && t.length > 1) {
    t = t.slice(0, -1);
  }
  if (t !== safeText(text) && t.length > 3) t = t.slice(0, -1) + "...";
  page.drawText(t, {
    x: opts.x,
    y: opts.y,
    size: opts.size,
    font: opts.font,
    color: opts.color,
  });
}

/** Mini D1 monogram drawn with pdf-lib path ops — the DesignOne tile:
 *  a square body in the palette's `bg` (so it sits cleanly inside
 *  whatever background the chrome is using) with a squared D and the
 *  single stroke of the 1 in `accent` (so swapping the user's brand
 *  color cascades down to the mark). */
export function drawMonogram(
  page: PDFPage,
  x: number,
  y: number,
  size: number,
  accent: ReturnType<typeof hex> = KN_AMBER,
  body: ReturnType<typeof hex> = KN_MIDNIGHT,
) {
  const s = size;
  // Tile body — a square with an accent edge (flip-invariant, so the
  // path-space convention cannot mirror it).
  page.drawSvgPath(`M 0 0 L ${s} 0 L ${s} ${s} L 0 ${s} Z`, {
    x,
    y: y + s,
    color: body,
    borderColor: accent,
    borderWidth: 0.6,
  });
  // D — squared bowl: stem, top, right side, bottom.
  const dx = x + s * 0.26;
  const dt = y + s * 0.75;
  const db = y + s * 0.25;
  const dw = s * 0.18;
  page.drawSvgPath(
    `M ${dx} ${db} L ${dx} ${dt} L ${dx + dw} ${dt} L ${dx + dw} ${db} L ${dx} ${db}`,
    {
      x: 0,
      y: 0,
      borderColor: accent,
      borderWidth: 1.2,
    },
  );
  // 1 — flag plus stem, right of the D.
  const ox = x + s * 0.6;
  page.drawSvgPath(
    `M ${ox - s * 0.1} ${dt - s * 0.1} L ${ox} ${dt} L ${ox} ${db}`,
    {
      x: 0,
      y: 0,
      borderColor: accent,
      borderWidth: 1.2,
    },
  );
}

/** Header mark — renders the user's uploaded logo when present, and
 *  otherwise falls back to the bundled DesignOne D1 monogram (the
 *  same mark the editor shell and favicon use). */
function drawHeaderMark(
  page: PDFPage,
  x: number,
  y: number,
  size: number,
  _palette: ThemeColors,
  logoImage: PDFImage | undefined,
) {
  if (!logoImage) {
    drawMonogram(page, x, y, size);
    return;
  }
  // Fit the image in a square box of `size`, preserving aspect ratio.
  // Center horizontally + vertically inside that box so wordmarks
  // longer than they are tall don't get squeezed.
  const dims = logoImage.scaleToFit(size, size);
  page.drawImage(logoImage, {
    x: x + (size - dims.width) / 2,
    y: y + (size - dims.height) / 2,
    width: dims.width,
    height: dims.height,
  });
}

export { catColor, catLabel };
