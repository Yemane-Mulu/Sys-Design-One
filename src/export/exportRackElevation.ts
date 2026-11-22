// Rack Elevation PDF — branded, vector, shareable.
// Renders the same faceplate schema that the on-screen RackDeviceFaceplate
// uses, but with pdf-lib draw calls so it stays crisp at any zoom.

import { PDFDocument, PDFImage, PDFPage, rgb } from "pdf-lib";
import type { Project, Rack } from "../store/projectStore";
import {
  rackDevicesById,
  type Faceplate,
  type RackDeviceType,
  type LedKind,
} from "../data/rackDevices";
import { loadBrandFonts, hex, safeText, type BrandFonts } from "./titleBlockRenderer";
import { resolveBranding, type BrandingConfig } from "../lib/branding";
import {
  devicesBySwitchRows,
  occupiedUSlots,
  patchTableRows,
  placementUHeight,
  placementWidth,
  type PatchTableRow,
} from "../rack/rackUtils";
import { allDropMarkups } from "../lib/dropLabels";

const KN_MID = hex("#0B1220");
const KN_INK = hex("#F5F7FA");
const KN_INK_300 = hex("#94A0B8");
const KN_INK_400 = hex("#5E6B85");
const KN_INK_500 = hex("#3A4458");
const KN_STEEL = hex("#1B2433");

const LED_RGB: Record<LedKind, ReturnType<typeof hex>> = {
  power: hex("#2BD37C"),
  status: hex("#4FB7FF"),
  // `link` LEDs follow the brand accent at draw time — see `drawFaceplate`.
  link: hex("#F4B740"),
  alert: hex("#FF5C7A"),
};

const BASE_RGB: Record<Faceplate["base"], ReturnType<typeof hex>> = {
  black: hex("#1A1F29"),
  graphite: hex("#2A3140"),
  white: hex("#E2E7EF"),
  silver: hex("#B8C0CF"),
  // `amber` faceplates also follow the brand accent — they look correct
  // for any team's brand color, not just the bundled amber.
  amber: hex("#F4B740"),
};

type ElevColor = ReturnType<typeof hex>;

/** Color theme for the elevation. The color theme is the current dark
 *  look; the B&W theme is the same layout on a white page for printers
 *  with no color — black text and bars, white faceplates, black ports
 *  and LEDs. `faceBase` / `port` / `led` / `bayBg` are functions because
 *  the color theme varies them by equipment and the B&W theme flattens
 *  them all to one value. */
interface ElevTheme {
  bw: boolean;
  pageBg: ElevColor;
  accent: ElevColor;
  onAccent: ElevColor;
  ink: ElevColor;
  ink300: ElevColor;
  ink400: ElevColor;
  ink500: ElevColor;
  steel: ElevColor;
  chassis: ElevColor;
  rail: ElevColor;
  railHole: ElevColor;
  guide: ElevColor;
  scheduleBg: ElevColor;
  totalsBg: ElevColor;
  faceBase: (base: Faceplate["base"]) => ElevColor;
  faceText: (kind: "accent" | "muted" | "plain") => ElevColor;
  port: (kind: "amber" | "navy" | "green" | "white" | "black") => ElevColor;
  led: (kind: LedKind) => ElevColor;
  bayBg: (style: string | undefined) => ElevColor;
}

function colorTheme(accent: ElevColor): ElevTheme {
  return {
    bw: false,
    pageBg: KN_MID,
    accent,
    onAccent: KN_MID,
    ink: KN_INK,
    ink300: KN_INK_300,
    ink400: KN_INK_400,
    ink500: KN_INK_500,
    steel: KN_STEEL,
    chassis: hex("#04080F"),
    rail: hex("#1A2030"),
    railHole: hex("#04080F"),
    guide: hex("#0E1422"),
    scheduleBg: hex("#0E141F"),
    totalsBg: hex("#141C2B"),
    faceBase: (base) => (base === "amber" ? accent : BASE_RGB[base]),
    faceText: (kind) =>
      kind === "accent" ? accent : kind === "muted" ? KN_INK_400 : KN_INK,
    port: (kind) =>
      ({
        amber: accent,
        navy: hex("#1F3A5F"),
        green: hex("#2BD37C"),
        white: hex("#E2E7EF"),
        black: hex("#1A2030"),
      })[kind],
    led: (kind) => (kind === "link" ? accent : LED_RGB[kind]),
    bayBg: (style) =>
      style === "battery"
        ? hex("#14202E")
        : style === "outlet"
          ? hex("#08101A")
          : style === "vent"
            ? hex("#1A2030")
            : hex("#0B0F18"),
  };
}

function bwTheme(): ElevTheme {
  const black = hex("#000000");
  const white = hex("#FFFFFF");
  return {
    bw: true,
    pageBg: white,
    accent: black,
    onAccent: white,
    ink: black,
    ink300: hex("#333333"),
    ink400: hex("#666666"),
    ink500: hex("#999999"),
    steel: black,
    chassis: hex("#F2F2F2"),
    rail: hex("#E5E5E5"),
    railHole: black,
    guide: hex("#DDDDDD"),
    scheduleBg: white,
    totalsBg: hex("#F2F2F2"),
    faceBase: () => white,
    faceText: (kind) => (kind === "muted" ? hex("#555555") : black),
    port: () => black,
    led: () => black,
    bayBg: () => hex("#E5E5E5"),
  };
}

export async function exportRackElevation(
  project: Project,
  rack: Rack,
  opts?: { blackAndWhite?: boolean; showTotals?: boolean },
) {
  const out = await PDFDocument.create();
  const fonts = await loadBrandFonts(out);
  const branding = resolveBranding(project.branding);
  const logoImage = await maybeEmbedLogo(out, branding.logoDataUrl);
  // Letter portrait — fits a 42U rack comfortably with title + schedule.
  const page = out.addPage([612, 792]);
  const showTotals = opts?.showTotals ?? true;
  drawElevation(page, fonts, project, rack, branding, logoImage, opts?.blackAndWhite ?? false, showTotals);

  // Patching gets its own page, two columns, every drop included — the
  // schedule panel is only as tall as the rack and a full patching table
  // never fit there. Pages repeat while rows remain; a rack with no
  // patching rows gets no extra page.
  const dropsById = new Map(allDropMarkups(project).map((d) => [d.id, d]));
  const patchRows = patchTableRows(rack, rackDevicesById, dropsById);
  let patchStart = 0;
  while (patchStart < patchRows.length) {
    const patchPage = out.addPage([612, 792]);
    patchStart = drawPatchingPage(
      patchPage,
      fonts,
      project,
      rack,
      branding,
      logoImage,
      opts?.blackAndWhite ?? false,
      patchRows,
      patchStart,
    );
  }

  const bytes = await out.save();
  // Brand the filename so multi-company users can tell exports apart at
  // a glance in their downloads folder.
  const brandSlug =
    safeText(branding.fullName)
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "Brand";
  triggerDownload(
    bytes,
    `${project.meta.projectName.replace(/\s+/g, "-")}_${brandSlug}_${rack.name.replace(/\s+/g, "-")}_Elevation${opts?.blackAndWhite ? "_BW" : ""}.pdf`,
  );
}

/** Same logo embedder used by the markup PDF — kept independent so this
 *  module can ship without depending on the markup file's internals. */
async function maybeEmbedLogo(
  out: PDFDocument,
  dataUrl: string | undefined,
): Promise<PDFImage | undefined> {
  if (!dataUrl) return undefined;
  try {
    const m = /^data:image\/(png|jpeg|jpg);base64,(.+)$/i.exec(dataUrl);
    if (!m) return undefined;
    const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
    return m[1].toLowerCase() === "png"
      ? await out.embedPng(bytes)
      : await out.embedJpg(bytes);
  } catch (e) {
    console.error("[rack-elev] logo embed failed:", e);
    return undefined;
  }
}

function drawElevation(
  page: PDFPage,
  fonts: BrandFonts,
  project: Project,
  rack: Rack,
  branding: BrandingConfig,
  logoImage: PDFImage | undefined,
  blackAndWhite: boolean,
  showTotals: boolean,
) {
  const { width: pw, height: ph } = page.getSize();
  const theme = blackAndWhite ? bwTheme() : colorTheme(hex(branding.accentColor));
  const ACCENT = theme.accent;

  // Background
  page.drawRectangle({ x: 0, y: 0, width: pw, height: ph, color: theme.pageBg });
  page.drawRectangle({ x: 0, y: ph - 6, width: pw, height: 6, color: ACCENT });

  // ─── Header — uploaded logo (no default mark) + wordmark ───
  if (logoImage) {
    const dims = logoImage.scaleToFit(38, 38);
    page.drawImage(logoImage, {
      x: 30 + (38 - dims.width) / 2,
      y: ph - 80 + (38 - dims.height) / 2,
      width: dims.width,
      height: dims.height,
    });
  }
  // Wordmark — primary in bold, secondary in accent. Either piece may be
  // empty; we just shift the cursor. Slides left when no logo so the
  // wordmark doesn't sit awkwardly far from the page edge.
  const wmA = safeText(branding.wordmarkPrimary);
  const wmB = safeText(branding.wordmarkSecondary);
  const headerLeft = logoImage ? 78 : 30;
  let wmCursor = headerLeft;
  if (wmA) {
    page.drawText(wmA, { x: wmCursor, y: ph - 56, size: 22, font: fonts.bold, color: theme.ink });
    wmCursor += fonts.bold.widthOfTextAtSize(wmA, 22) + 2;
  }
  if (wmB) {
    page.drawText(wmB, { x: wmCursor, y: ph - 56, size: 22, font: fonts.regular, color: ACCENT });
  }
  page.drawText("RACK ELEVATION", { x: headerLeft, y: ph - 76, size: 8, font: fonts.bold, color: theme.ink300 });

  page.drawText("DOCUMENT", { x: pw - 130, y: ph - 50, size: 7, font: fonts.bold, color: theme.ink400 });
  // Doc code uses the brand's prefix so codes match what the markup PDF
  // and bid PDF print (e.g. AC-12345-RACK-Equipment).
  const code = safeText(
    `${branding.docCodePrefix}-${project.meta.projectNumber || "NEW"}-RACK-${rack.name.replace(/\s+/g, "")}`,
  );
  page.drawText(code, { x: pw - 130, y: ph - 64, size: 11, font: fonts.bold, color: ACCENT });
  page.drawText(new Date().toLocaleDateString(), {
    x: pw - 130,
    y: ph - 78,
    size: 7,
    font: fonts.regular,
    color: theme.ink300,
  });

  // ─── Project + rack title block ───
  let y = ph - 110;
  page.drawText("PROJECT", { x: 30, y, size: 7, font: fonts.bold, color: theme.ink400 });
  y -= 12;
  page.drawText(safeText(project.meta.projectName), { x: 30, y, size: 14, font: fonts.bold, color: theme.ink });
  y -= 14;
  if (project.meta.location) {
    page.drawText(safeText(project.meta.location), { x: 30, y, size: 8, font: fonts.regular, color: theme.ink300 });
    y -= 10;
  }

  page.drawText("RACK", { x: pw / 2, y: ph - 110, size: 7, font: fonts.bold, color: theme.ink400 });
  page.drawText(safeText(rack.name.toUpperCase()), {
    x: pw / 2,
    y: ph - 122,
    size: 14,
    font: fonts.bold,
    color: ACCENT,
  });
  page.drawText(safeText(`${rack.uHeight}U  ${rack.location ?? ""}`), {
    x: pw / 2,
    y: ph - 136,
    size: 8,
    font: fonts.regular,
    color: theme.ink300,
  });

  // ─── Rack chassis ───
  const rackTop = ph - 170;
  const rackBottom = 200; // leave room for schedule
  const rackHeight = rackTop - rackBottom;
  const uPx = rackHeight / rack.uHeight;
  const railW = 14;
  const interiorW = 200; // logical width
  const rackLeft = 60;
  const interiorLeft = rackLeft + railW;
  const rackTotalW = interiorW + railW * 2;

  // Chassis backplate
  page.drawRectangle({
    x: rackLeft,
    y: rackBottom,
    width: rackTotalW,
    height: rackHeight,
    color: theme.chassis,
    borderColor: theme.steel,
    borderWidth: 0.5,
  });

  // Rails
  drawRail(page, fonts, rackLeft, rackBottom, railW, rackHeight, rack.uHeight, "left", theme);
  drawRail(page, fonts, rackLeft + railW + interiorW, rackBottom, railW, rackHeight, rack.uHeight, "right", theme);

  // Subtle U guides
  for (let u = 1; u < rack.uHeight; u++) {
    const ly = rackBottom + u * uPx;
    page.drawLine({
      start: { x: interiorLeft, y: ly },
      end: { x: interiorLeft + interiorW, y: ly },
      color: theme.guide,
      thickness: 0.3,
    });
  }

  // Devices
  for (const p of rack.placements) {
    const dev = rackDevicesById[p.deviceId];
    if (!dev) continue;
    const effH = placementUHeight(p, dev);
    const deviceTop = rackBottom + (p.uSlot + effH - 1) * uPx;
    const deviceBottom = rackBottom + (p.uSlot - 1) * uPx;
    // Half-width devices take one side of the interior.
    const w = placementWidth(p);
    const faceX =
      w === "half"
        ? interiorLeft + (p.side === "right" ? interiorW / 2 : 0)
        : interiorLeft;
    const faceW = w === "half" ? interiorW / 2 : interiorW;
    drawFaceplate(page, fonts, dev, p.label, faceX, deviceBottom, faceW, deviceTop - deviceBottom, theme);
  }

  // ─── Schedule + totals ───
  drawSchedule(page, fonts, project, rack, 290, rackBottom, pw - 320, rackHeight, theme, showTotals);

  // Footer — drawnBy falls through to the brand's full name when the
  // user hasn't put their own name in the project metadata.
  page.drawText(
    safeText(
      `Drawn by ${project.meta.drawnBy || branding.fullName} · ${branding.fullName} · This rack elevation may be shared.`,
    ),
    {
      x: 30,
      y: 24,
      size: 7,
      font: fonts.regular,
      color: theme.ink400,
    },
  );
}

/** Patching page: the full patching table on its own page, with the same
 *  header and footer as page one. Two columns, rows split evenly across
 *  them, so a full 48-port panel fits on one page and no drop is ever
 *  cut. Draws the rows starting at `start` and returns the index after
 *  the last row drawn, so the caller can add more pages while rows
 *  remain. A drop-first port prints with a blank switch cell; a patched
 *  port with no drop yet prints with a blank drop cell. */
function drawPatchingPage(
  page: PDFPage,
  fonts: BrandFonts,
  project: Project,
  rack: Rack,
  branding: BrandingConfig,
  logoImage: PDFImage | undefined,
  blackAndWhite: boolean,
  patchRows: PatchTableRow[],
  start: number,
): number {
  const { width: pw, height: ph } = page.getSize();
  const theme = blackAndWhite ? bwTheme() : colorTheme(hex(branding.accentColor));
  const ACCENT = theme.accent;

  // Same page chrome as the elevation page.
  page.drawRectangle({ x: 0, y: 0, width: pw, height: ph, color: theme.pageBg });
  page.drawRectangle({ x: 0, y: ph - 6, width: pw, height: 6, color: ACCENT });
  if (logoImage) {
    const dims = logoImage.scaleToFit(38, 38);
    page.drawImage(logoImage, {
      x: 30 + (38 - dims.width) / 2,
      y: ph - 80 + (38 - dims.height) / 2,
      width: dims.width,
      height: dims.height,
    });
  }
  const wmA = safeText(branding.wordmarkPrimary);
  const wmB = safeText(branding.wordmarkSecondary);
  const headerLeft = logoImage ? 78 : 30;
  let wmCursor = headerLeft;
  if (wmA) {
    page.drawText(wmA, { x: wmCursor, y: ph - 56, size: 22, font: fonts.bold, color: theme.ink });
    wmCursor += fonts.bold.widthOfTextAtSize(wmA, 22) + 2;
  }
  if (wmB) {
    page.drawText(wmB, { x: wmCursor, y: ph - 56, size: 22, font: fonts.regular, color: ACCENT });
  }
  page.drawText("RACK ELEVATION", { x: headerLeft, y: ph - 76, size: 8, font: fonts.bold, color: theme.ink300 });
  page.drawText("DOCUMENT", { x: pw - 130, y: ph - 50, size: 7, font: fonts.bold, color: theme.ink400 });
  const code = safeText(
    `${branding.docCodePrefix}-${project.meta.projectNumber || "NEW"}-RACK-${rack.name.replace(/\s+/g, "")}`,
  );
  page.drawText(code, { x: pw - 130, y: ph - 64, size: 11, font: fonts.bold, color: ACCENT });
  page.drawText(new Date().toLocaleDateString(), {
    x: pw - 130,
    y: ph - 78,
    size: 7,
    font: fonts.regular,
    color: theme.ink300,
  });

  let y = ph - 110;
  page.drawText("PROJECT", { x: 30, y, size: 7, font: fonts.bold, color: theme.ink400 });
  y -= 12;
  page.drawText(safeText(project.meta.projectName), { x: 30, y, size: 14, font: fonts.bold, color: theme.ink });
  y -= 14;
  if (project.meta.location) {
    page.drawText(safeText(project.meta.location), { x: 30, y, size: 8, font: fonts.regular, color: theme.ink300 });
    y -= 10;
  }
  page.drawText("RACK", { x: pw / 2, y: ph - 110, size: 7, font: fonts.bold, color: theme.ink400 });
  page.drawText(safeText(rack.name.toUpperCase()), {
    x: pw / 2,
    y: ph - 122,
    size: 14,
    font: fonts.bold,
    color: ACCENT,
  });
  page.drawText(safeText(`${rack.uHeight}U  ${rack.location ?? ""}`), {
    x: pw / 2,
    y: ph - 136,
    size: 8,
    font: fonts.regular,
    color: theme.ink300,
  });

  // Table — two columns, same amber header as the schedule panel. Rows
  // split evenly across the columns; a chunk is sized to what fits on
  // one page, so nothing is ever cut.
  const x = 30;
  const w = pw - 60;
  const gutter = 24;
  const colW = (w - gutter) / 2;
  let py = ph - 170;
  page.drawText("PATCHING", { x, y: py, size: 11, font: fonts.bold, color: theme.accent });
  py -= 18;
  // Rows per column, from the geometry above: header bar 14pt, rows
  // 11pt each, down to the footer line at y=40.
  const perCol = Math.max(1, Math.floor((py - 14 - 40) / 11));
  const chunk = patchRows.slice(start, start + perCol * 2);
  const leftCount = Math.ceil(chunk.length / 2);
  const cols = [
    { cx: x, rows: chunk.slice(0, leftCount) },
    { cx: x + colW + gutter, rows: chunk.slice(leftCount) },
  ];
  for (const col of cols) {
    const colX = [col.cx + 8, col.cx + colW / 3, col.cx + (2 * colW) / 3];
    const colWidths = [colW / 3 - 16, colW / 3 - 8, colW / 3 - 8];
    let cpy = py;
    page.drawRectangle({
      x: col.cx + 6,
      y: cpy - 14,
      width: colW - 12,
      height: 14,
      color: theme.accent,
    });
    page.drawText("DROP", { x: colX[0], y: cpy - 11, size: 7, font: fonts.bold, color: theme.onAccent });
    page.drawText("PATCH PANEL", { x: colX[1], y: cpy - 11, size: 7, font: fonts.bold, color: theme.onAccent });
    page.drawText("SWITCH", { x: colX[2], y: cpy - 11, size: 7, font: fonts.bold, color: theme.onAccent });
    cpy -= 14;
    for (const row of col.rows) {
      cpy -= 11;
      const cells = [row.drop, row.panel, row.switch];
      cells.forEach((cell, i) => {
        page.drawText(safeText(fitText(fonts.regular, cell, colWidths[i], 7)), {
          x: colX[i],
          y: cpy,
          size: 7,
          font: fonts.regular,
          color: theme.ink,
        });
      });
    }
  }

  page.drawText(
    safeText(
      `Drawn by ${project.meta.drawnBy || branding.fullName} · ${branding.fullName} · This rack elevation may be shared.`,
    ),
    { x: 30, y: 24, size: 7, font: fonts.regular, color: theme.ink400 },
  );

  return start + chunk.length;
}

// ───── Rail with hole pattern + U numbers ─────

function drawRail(
  page: PDFPage,
  fonts: BrandFonts,
  x: number,
  yBottom: number,
  w: number,
  h: number,
  uHeight: number,
  side: "left" | "right",
  theme: ElevTheme,
) {
  page.drawRectangle({
    x,
    y: yBottom,
    width: w,
    height: h,
    color: theme.rail,
    borderColor: theme.steel,
    borderWidth: 0.4,
  });
  const uPx = h / uHeight;
  for (let u = 1; u <= uHeight; u++) {
    const cy = yBottom + (u - 0.5) * uPx;
    // mounting hole
    page.drawCircle({
      x: x + w / 2,
      y: cy,
      size: 1.4,
      color: theme.railHole,
    });
    // U number every 4U for readability
    if (u % 4 === 0 || u === 1 || u === uHeight) {
      const txt = String(u);
      const tw = fonts.regular.widthOfTextAtSize(txt, 5);
      page.drawText(txt, {
        x: side === "left" ? x + 1 : x + w - tw - 1,
        y: cy - 1.6,
        size: 5,
        font: fonts.regular,
        color: theme.ink400,
      });
    }
  }
}

// ───── Faceplate (mirror of RackDeviceFaceplate) ─────

function drawFaceplate(
  page: PDFPage,
  fonts: BrandFonts,
  dev: RackDeviceType,
  overlayLabel: string | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
  theme: ElevTheme,
) {
  const f = dev.faceplate;
  // The `amber` faceplate base color tracks the user's brand accent so
  // a non-amber brand still gets a coherent-looking equipment chassis.
  // The other base colors (black/graphite/white/silver) are physical
  // materials — they don't change with branding. In B&W every base is
  // white so the print stays readable.
  const baseColor = theme.faceBase(f.base);
  // Base
  page.drawRectangle({ x, y, width: w, height: h, color: baseColor });
  // top highlight band
  page.drawRectangle({ x, y: y + h - 0.6, width: w, height: 0.6, color: hex("#FFFFFF"), opacity: 0.12 });
  // bottom shadow band
  page.drawRectangle({ x, y, width: w, height: 0.6, color: hex("#000000"), opacity: 0.4 });

  // Vents
  if (f.vents) {
    for (let vx = x + 8; vx < x + w - 8; vx += 2) {
      page.drawLine({
        start: { x: vx, y: y + 1 },
        end: { x: vx, y: y + h - 1 },
        thickness: 0.6,
        color: hex("#000000"),
        opacity: 0.55,
      });
    }
  }

  // Mounting screws
  if (f.screws) {
    page.drawCircle({ x: x + 3.5, y: y + h / 2, size: 1.6, color: theme.ink400 });
    page.drawCircle({ x: x + w - 3.5, y: y + h / 2, size: 1.6, color: theme.ink400 });
  }

  // Brand stripe (per-equipment color — e.g. Cisco blue, APC green).
  // When the equipment doesn't specify a color we fall back to the
  // user's brand accent so the document feels coherent.
  if (f.brand) {
    const bx = x + (f.brand.x / 100) * w;
    const stripeColor = theme.bw ? theme.accent : f.brand.accent ? hex(f.brand.accent) : theme.accent;
    page.drawRectangle({
      x: bx,
      y: y + h * 0.18,
      width: 1.6,
      height: h * 0.64,
      color: stripeColor,
    });
  }

  // Bays
  for (const b of f.bays ?? []) {
    const bx = x + (b.x / 100) * w;
    const bw = (b.w / 100) * w;
    const bh = (b.h / 100) * h;
    const yPct = (b.y ?? 12) / 100;
    const by = y + h - bh - h * yPct;
    const bg = theme.bayBg(b.style);

    page.drawRectangle({
      x: bx,
      y: by,
      width: bw,
      height: bh,
      color: bg,
      borderColor: theme.ink500,
      borderWidth: 0.3,
    });
    if (b.style === "vent") {
      for (let vx = bx + 1; vx < bx + bw - 1; vx += 1.5) {
        page.drawLine({
          start: { x: vx, y: by + 1 },
          end: { x: vx, y: by + bh - 1 },
          thickness: 0.3,
          color: hex("#000000"),
          opacity: 0.5,
        });
      }
    }
    if (b.style === "hdd") {
      // Activity LED dot
      page.drawCircle({
        x: bx + bw - 1.6,
        y: by + bh - 1.6,
        size: 0.6,
        color: theme.led("power"),
      });
    }
    if (b.style === "outlet") {
      // Two slot prongs + ground hole
      page.drawRectangle({
        x: bx + bw / 2 - 1.5,
        y: by + bh * 0.55,
        width: 0.6,
        height: 1.6,
        color: hex("#000000"),
      });
      page.drawRectangle({
        x: bx + bw / 2 + 0.9,
        y: by + bh * 0.55,
        width: 0.6,
        height: 1.6,
        color: hex("#000000"),
      });
      page.drawCircle({ x: bx + bw / 2, y: by + bh * 0.25, size: 0.6, color: hex("#000000") });
    }
    if (b.label) {
      const lblSize = Math.max(3.5, bh * 0.18);
      const tw = fonts.regular.widthOfTextAtSize(b.label, lblSize);
      page.drawText(b.label, {
        x: bx + (bw - tw) / 2,
        y: by + 1,
        size: lblSize,
        font: fonts.regular,
        color: theme.ink300,
      });
    }
  }

  // Brand + model on ONE line — the two used to print on top of each other
  // in 1U rows. Drawn after the bays so a bay never paints over it (the
  // generic NVR's HDD bay sits in this band). The line sits low on the
  // faceplate, clear of the port rows above it, and truncates to leave room
  // for the tag pill on the right.
  {
    const lineY = y + h * 0.32;
    let lineX = x + 16; // clear of the mounting screws
    if (f.brand) {
      const bx = x + (f.brand.x / 100) * w;
      lineX = bx + 3;
    }
    let lineMaxW = x + w - 8 - lineX;
    if (overlayLabel) {
      const sz = Math.max(4, h * 0.18);
      const tw = fonts.bold.widthOfTextAtSize(overlayLabel.toUpperCase(), sz);
      lineMaxW = x + w - tw - 12 - lineX;
    }
    const sizeMap = { xs: 4.5, sm: 5.5, md: 6.5, lg: 7.5 } as const;
    const segments: {
      text: string;
      size: number;
      font: BrandFonts["bold"];
      color: ReturnType<typeof hex>;
    }[] = [];
    if (f.brand) {
      segments.push({
        text: f.brand.text,
        size: Math.max(5, h * 0.22),
        font: fonts.bold,
        color: theme.bw ? theme.accent : f.brand.accent ? hex(f.brand.accent) : theme.accent,
      });
    }
    for (const t of f.texts ?? []) {
      segments.push({
        text: t.text,
        size: sizeMap[t.size ?? "sm"],
        font: t.weight === "bold" ? fonts.bold : fonts.regular,
        // Faceplate text colors — `amber` refers to the brand accent (so
        // the text follows the user's color), the other tokens are neutral.
        color: theme.faceText(
          t.color === "amber" ? "accent" : t.color === "muted" ? "muted" : "plain",
        ),
      });
    }
    if (segments.length > 0 && lineMaxW > 10) {
      const joined = segments.map((s) => s.text).join(" ");
      const totalW = segments.reduce(
        (acc, s, i) =>
          acc +
          s.font.widthOfTextAtSize(s.text, s.size) +
          (i > 0 ? s.font.widthOfTextAtSize(" ", s.size) : 0),
        0,
      );
      if (totalW <= lineMaxW) {
        let cx = lineX;
        segments.forEach((s, i) => {
          if (i > 0) cx += s.font.widthOfTextAtSize(" ", s.size);
          page.drawText(s.text, { x: cx, y: lineY, size: s.size, font: s.font, color: s.color });
          cx += s.font.widthOfTextAtSize(s.text, s.size);
        });
      } else {
        // Rare overflow (very long model in a 1U row): one truncated line.
        page.drawText(fitText(fonts.regular, joined, lineMaxW, segments[0].size), {
          x: lineX,
          y: lineY,
          size: segments[0].size,
          font: fonts.regular,
          color: theme.ink,
        });
      }
    }
  }

  // Port groups — `amber` is the abstract brand-accent token, the rest
  // are literal port colors that match the physical equipment. In B&W
  // every port is black.
  for (const g of f.ports ?? []) {
    const portColor = theme.port(g.color ?? "amber");
    const rows = g.rows ?? 1;
    const portsPerRow = Math.ceil(g.count / rows);
    const portW = Math.max(1.4, Math.min(3.2, 16 / portsPerRow));
    const portH = Math.max(1.6, Math.min(2.4, h * 0.32 / rows));
    const startX = x + (g.x / 100) * w;
    const yPct = (g.y ?? 18) / 100;
    const startY = y + h - portH - h * yPct;
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < portsPerRow; c++) {
        if (i >= g.count) break;
        page.drawRectangle({
          x: startX + c * (portW + 0.3),
          y: startY - r * (portH + 0.3),
          width: portW,
          height: portH,
          color: portColor,
          borderColor: hex("#000000"),
          borderWidth: 0.15,
        });
        i++;
      }
    }
  }

  // LEDs — `link` (yellow/amber LED) follows the brand accent so it
  // reads as part of the same family as the rest of the document chrome.
  // Power/status/alert LEDs are physical signal colors that don't change.
  for (const l of f.leds ?? []) {
    const lx = x + (l.x / 100) * w;
    const yPct = (l.y ?? 28) / 100;
    const ly = y + h - h * yPct - 2;
    const size = Math.max(0.7, h * 0.08);
    const color = theme.led(l.kind);
    page.drawCircle({
      x: lx,
      y: ly,
      size,
      color,
      opacity: l.on ? 1 : 0.25,
    });
  }

  // Overlay label
  if (overlayLabel) {
    const txt = overlayLabel.toUpperCase();
    const sz = Math.max(4, h * 0.18);
    const tw = fonts.bold.widthOfTextAtSize(txt, sz);
    page.drawRectangle({
      x: x + w - tw - 6,
      y: y + 1,
      width: tw + 4,
      height: sz + 1.5,
      color: hex("#000000"),
      opacity: 0.7,
      borderColor: theme.accent,
      borderWidth: 0.3,
    });
    page.drawText(txt, {
      x: x + w - tw - 4,
      y: y + 1.8,
      size: sz,
      font: fonts.bold,
      color: theme.bw ? theme.onAccent : theme.accent,
    });
  }
}

// ───── Schedule on the right ─────

function drawSchedule(
  page: PDFPage,
  fonts: BrandFonts,
  project: Project,
  rack: Rack,
  x: number,
  y: number,
  w: number,
  h: number,
  theme: ElevTheme,
  showTotals: boolean,
) {
  // Background panel
  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    color: theme.scheduleBg,
    borderColor: theme.steel,
    borderWidth: 0.4,
  });
  // Header
  page.drawRectangle({
    x,
    y: y + h - 18,
    width: w,
    height: 18,
    color: theme.accent,
  });
  page.drawText("RACK SCHEDULE", {
    x: x + 8,
    y: y + h - 13,
    size: 9,
    font: fonts.bold,
    color: theme.onAccent,
  });
  page.drawText(`${rack.placements.length} ITEMS`, {
    x: x + w - 70,
    y: y + h - 13,
    size: 8,
    font: fonts.bold,
    color: theme.onAccent,
  });

  // Column widths rebalanced: the TAG column was 42pt and every value was
  // cut to 22 / 18 / 14 characters. Cells now truncate to fit their
  // column width instead of a fixed character count.
  const colW = [30, 94, 72, w - 212];
  let cursorY = y + h - 32;
  // Column header
  drawCols(page, fonts, x + 8, cursorY, ["U", "DEVICE", "MFG·MODEL", "TAG"], colW, theme);
  cursorY -= 9;
  page.drawLine({
    start: { x: x + 6, y: cursorY + 6 },
    end: { x: x + w - 6, y: cursorY + 6 },
    thickness: 0.3,
    color: theme.ink500,
  });

  // The devices table prints under the totals; reserve room for it at
  // the bottom of the panel so the schedule rows never run into the
  // totals box or the devices table. Patching lives on its own page now,
  // so it reserves nothing here.
  const dropsById = new Map(allDropMarkups(project).map((d) => [d.id, d]));
  const deviceRows = devicesBySwitchRows(rack, rackDevicesById, dropsById);
  const reserve =
    (showTotals ? 100 : 12) +
    (deviceRows.length > 0 ? 45 + deviceRows.length * 11 : 0);

  let totalW = 0;
  let totalLb = 0;
  let totalCost = 0;

  // Sort top-down
  const sorted = [...rack.placements].sort((a, b) => b.uSlot - a.uSlot);
  for (const p of sorted) {
    const d = rackDevicesById[p.deviceId];
    if (!d) continue;
    if (cursorY < y + reserve) {
      page.drawText("…", { x: x + 8, y: cursorY, size: 8, font: fonts.bold, color: theme.ink400 });
      break;
    }
    const effH = placementUHeight(p, d);
    drawCols(page, fonts, x + 8, cursorY, [
      `U${p.uSlot}${effH > 1 ? `–${p.uSlot + effH - 1}` : ""}`,
      fitText(fonts.regular, d.label, colW[1] - 4),
      fitText(
        fonts.regular,
        `${d.manufacturer}${d.model ? ` ${d.model}` : ""}`,
        colW[2] - 4,
      ),
      fitText(fonts.regular, p.label ?? "", colW[3] - 4),
    ], colW, theme);
    cursorY -= 11;
    totalW += d.powerWatts;
    totalLb += d.weightLbs;
    totalCost += p.costOverride ?? d.defaultCost;
  }

  // "U Used" counts each occupied U once — two half-width devices sharing
  // a U row still only use that U once.
  const totalUsed = occupiedUSlots(rack).size;

  // Totals box sits directly under the last schedule row, not pinned to
  // the bottom of the panel. Off means no box at all — the devices table
  // (or the panel bottom) just moves up to the schedule rows.
  const tbH = 88;
  const tbY = cursorY - 6 - tbH;
  if (showTotals) {
    page.drawRectangle({
      x: x + 6,
      y: tbY,
      width: w - 12,
      height: tbH,
      color: theme.totalsBg,
      borderColor: theme.accent,
      borderWidth: 0.4,
    });
    page.drawRectangle({
      x: x + 6,
      y: tbY + tbH - 14,
      width: w - 12,
      height: 14,
      color: theme.accent,
    });
    page.drawText("TOTALS", {
      x: x + 12,
      y: tbY + tbH - 11,
      size: 8,
      font: fonts.bold,
      color: theme.onAccent,
    });

    const lines: [string, string][] = [
      ["U Used", `${totalUsed} / ${rack.uHeight} U  (${rack.uHeight - totalUsed} free)`],
      ["Power", `${totalW} W`],
      ["Weight", `${totalLb} lb`],
      ["Material", usd(totalCost)],
    ];
    let ly = tbY + tbH - 28;
    for (const [k, v] of lines) {
      page.drawText(k, { x: x + 12, y: ly, size: 8, font: fonts.regular, color: theme.ink300 });
      const vw = fonts.bold.widthOfTextAtSize(v, 8);
      page.drawText(v, { x: x + w - 12 - vw, y: ly, size: 8, font: fonts.bold, color: theme.ink });
      ly -= 14;
    }
  }

  // Devices by switch — one row per device type per switch, with the
  // switch ports collapsed into ranges. Only drops that have both a
  // device type and a switch patch appear. Sits under the totals, or
  // under the schedule when totals are off.
  const contentTop = showTotals ? tbY : cursorY - 6;
  if (deviceRows.length > 0) {
    let py = contentTop - 12;
    const devColX = [x + 12, x + w / 3, x + (2 * w) / 3];
    const devColW = [w / 3 - 20, w / 3 - 12, w / 3 - 12];
    page.drawText("DEVICES BY SWITCH", {
      x: x + 8,
      y: py,
      size: 8,
      font: fonts.bold,
      color: theme.accent,
    });
    py -= 11;
    page.drawRectangle({
      x: x + 6,
      y: py - 14,
      width: w - 12,
      height: 14,
      color: theme.accent,
    });
    page.drawText("DEVICE", {
      x: devColX[0],
      y: py - 11,
      size: 7,
      font: fonts.bold,
      color: theme.onAccent,
    });
    page.drawText("SWITCH", {
      x: devColX[1],
      y: py - 11,
      size: 7,
      font: fonts.bold,
      color: theme.onAccent,
    });
    page.drawText("PORTS", {
      x: devColX[2],
      y: py - 11,
      size: 7,
      font: fonts.bold,
      color: theme.onAccent,
    });
    py -= 14;
    for (const row of deviceRows) {
      py -= 11;
      if (py < y + 10) {
        page.drawText("…", { x: x + 8, y: py, size: 8, font: fonts.bold, color: theme.ink400 });
        break;
      }
      const cells = [row.device, row.switch, row.ports];
      cells.forEach((cell, i) => {
        page.drawText(safeText(fitText(fonts.regular, cell, devColW[i], 7)), {
          x: devColX[i],
          y: py,
          size: 7,
          font: fonts.regular,
          color: theme.ink,
        });
      });
    }
  }
}

function drawCols(
  page: PDFPage,
  fonts: BrandFonts,
  x0: number,
  y: number,
  cols: string[],
  widths: number[],
  theme: ElevTheme,
) {
  let cx = x0;
  cols.forEach((c, i) => {
    page.drawText(c, {
      x: cx,
      y,
      size: 7,
      font: fonts.regular,
      color: theme.ink,
    });
    cx += widths[i];
  });
}

/** Truncate text to fit a pixel width (measured, not a character count). */
function fitText(
  font: BrandFonts["regular"],
  text: string,
  maxWidth: number,
  size = 7,
): string {
  if (!text) return "";
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  const ell = "…";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (font.widthOfTextAtSize(text.slice(0, mid) + ell, size) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + ell : ell;
}



function usd(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function triggerDownload(bytes: Uint8Array, name: string) {
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
