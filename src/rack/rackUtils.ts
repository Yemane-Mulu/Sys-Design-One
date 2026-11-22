// Shared rack geometry helpers — used by the editor frame, the properties
// panel, and the elevation export so all three agree on what fits where.
import { rackDevicesById, type FaceplatePortGroup, type RackDeviceType } from "../data/rackDevices";
import type {
  DropMarkup,
  Rack,
  RackPlacement,
  RackPatchLink,
} from "../store/projectStore";

/** Effective U height of a placement: a per-placement override wins over
 *  the catalog height (e.g. the generic NVR is 3–5U, picked per job). */
export function placementUHeight(p: RackPlacement, dev: RackDeviceType): number {
  return p.uHeightOverride ?? dev.uHeight;
}

export function placementWidth(p: RackPlacement): "full" | "half" {
  return p.width ?? "full";
}

/** A shelf is a passive device whose label names it a shelf (the five
 *  catalog shelves plus the two generic shelf defaults). */
export function isShelfDevice(dev: RackDeviceType): boolean {
  return dev.category === "passive" && /shelf/i.test(dev.label);
}

/** U slots a placement occupies (bottom-up U numbers). */
export function placementUSlots(p: RackPlacement, dev: RackDeviceType): number[] {
  const h = placementUHeight(p, dev);
  const out: number[] = [];
  for (let u = p.uSlot; u < p.uSlot + h; u++) out.push(u);
  return out;
}

/** Union of U slots occupied anywhere in the rack — a U counts once even
 *  when two half-width devices share it (used for the "U Used" total). */
export function occupiedUSlots(rack: Rack): Set<number> {
  const set = new Set<number>();
  for (const p of rack.placements) {
    const dev = rackDevicesById[p.deviceId];
    if (!dev) continue;
    for (const u of placementUSlots(p, dev)) set.add(u);
  }
  return set;
}

// ───── Collision (per-side occupancy) ─────

export interface UOccupancy {
  full?: RackPlacement;
  left?: RackPlacement;
  right?: RackPlacement;
}

export function buildOccupancy(rack: Rack): Map<number, UOccupancy> {
  const map = new Map<number, UOccupancy>();
  for (const p of rack.placements) {
    const dev = rackDevicesById[p.deviceId];
    if (!dev) continue;
    const w = placementWidth(p);
    for (const u of placementUSlots(p, dev)) {
      const occ = map.get(u) ?? {};
      if (w === "full") occ.full = p;
      else if (p.side === "right") occ.right = p;
      else occ.left = p;
      map.set(u, occ);
    }
  }
  return map;
}

/** True when a device of the given size fits at uSlot without colliding.
 *  A half-width device fits when nothing full-width and nothing on the
 *  same side occupies those U slots; a full-width device needs them empty. */
export function canFitAt(
  rack: Rack,
  uSlot: number,
  uHeight: number,
  width: "full" | "half",
  side: "left" | "right",
  ignorePlacementId?: string,
): boolean {
  if (uSlot < 1 || uSlot + uHeight - 1 > rack.uHeight) return false;
  const occ = buildOccupancy(rack);
  const clash = (p?: RackPlacement) => p !== undefined && p.id !== ignorePlacementId;
  for (let u = uSlot; u < uSlot + uHeight; u++) {
    const o = occ.get(u);
    if (!o) continue;
    if (width === "full") {
      if (clash(o.full) || clash(o.left) || clash(o.right)) return false;
    } else if (side === "right") {
      if (clash(o.full) || clash(o.right)) return false;
    } else {
      if (clash(o.full) || clash(o.left)) return false;
    }
  }
  return true;
}

export function findNearestFit(
  rack: Rack,
  desired: number,
  uHeight: number,
  width: "full" | "half",
  side: "left" | "right",
  ignorePlacementId?: string,
): number {
  for (let d = 0; d < rack.uHeight; d++) {
    if (canFitAt(rack, desired + d, uHeight, width, side, ignorePlacementId))
      return desired + d;
    if (canFitAt(rack, desired - d, uHeight, width, side, ignorePlacementId))
      return desired - d;
  }
  return -1;
}

// ───── Shelf support ─────

/** True when a shelf placement sits directly under the given placement
 *  (the shelf's top U is the placement's bottom U minus one). A half-width
 *  device must sit on a shelf; a shelf is full-width so either side works. */
export function placementHasShelf(rack: Rack, placement: RackPlacement): boolean {
  const bottomU = placement.uSlot;
  for (const p of rack.placements) {
    if (p.id === placement.id) continue;
    const sd = rackDevicesById[p.deviceId];
    if (!sd || !isShelfDevice(sd)) continue;
    const topU = p.uSlot + placementUHeight(p, sd) - 1;
    if (topU === bottomU - 1) return true;
  }
  return false;
}

// ───── Patching ─────

/** Ports available to patch on a device (1-based numbers, from its
 *  front-facing port count). */
export function patchablePorts(dev: RackDeviceType): number[] {
  const n = dev.frontPorts ?? 0;
  return Array.from({ length: n }, (_, i) => i + 1);
}

/** Display name for a placement in the patch list: the asset tag first,
 *  the device label when there is no tag. */
export function placementDisplayName(p: RackPlacement, dev: RackDeviceType): string {
  return p.label?.trim() ? p.label.trim() : dev.label;
}

/** One printed line of the patch list: a panel→switch pair with its
 *  patched ports grouped, e.g. "Cam Patch Panel, Port 1, Port 2 -> Security
 *  Switch, Port 1, Port 2". */
export interface PatchGroup {
  fromPlacementId: string;
  toPlacementId: string;
  fromPorts: number[];
  toPorts: number[];
}

export function groupPatchLinks(links: RackPatchLink[]): PatchGroup[] {
  const groups = new Map<string, PatchGroup>();
  for (const l of links) {
    const key = `${l.fromPlacementId}->${l.toPlacementId}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        fromPlacementId: l.fromPlacementId,
        toPlacementId: l.toPlacementId,
        fromPorts: [],
        toPorts: [],
      };
      groups.set(key, g);
    }
    if (!g.fromPorts.includes(l.fromPort)) g.fromPorts.push(l.fromPort);
    if (!g.toPorts.includes(l.toPort)) g.toPorts.push(l.toPort);
  }
  for (const g of groups.values()) {
    g.fromPorts.sort((a, b) => a - b);
    g.toPorts.sort((a, b) => a - b);
  }
  return [...groups.values()];
}

/** Render one patch group the way it prints on the elevation. */
export function patchGroupText(
  g: PatchGroup,
  fromName: string,
  toName: string,
): string {
  const ports = (ns: number[]) => ns.map((n) => `Port ${n}`).join(", ");
  return `${fromName}, ${ports(g.fromPorts)} -> ${toName}, ${ports(g.toPorts)}`;
}

/** Name used in the patch table: the placement's short name when set
 *  (e.g. "PP", "SW 1"), else its display name. */
export function placementPatchName(p: RackPlacement, dev: RackDeviceType): string {
  const s = p.shortName?.trim();
  return s ? s : placementDisplayName(p, dev);
}

/** Text for a drop in the patch table: its plan label (e.g. "NJCK-022",
 *  "FCAM-001"), falling back to its display label. "" when unassigned. */
export function dropDisplayNumber(drop: DropMarkup | undefined): string {
  if (!drop) return "";
  return drop.number?.trim() || drop.label?.trim() || "";
}

/** One row of the printed devices-by-switch table: a device type, the
 *  switch it is on (by short name), and its switch ports collapsed
 *  into ranges — e.g. { device: "Inside Cam", switch: "SW 1", ports:
 *  "1-22" }. Rows group by switch (top-down, highest U first), then by
 *  lowest port. Only drops that have both a device type and a switch
 *  patch appear; the type is matched case-insensitively with extra
 *  spaces ignored, so "Inside Cam" and "inside  cam" group together. */
export interface DevicesBySwitchRow {
  device: string;
  switch: string;
  ports: string;
}

export function devicesBySwitchRows(
  rack: Rack,
  devs: Record<string, RackDeviceType>,
  dropsById?: Map<string, DropMarkup>,
): DevicesBySwitchRow[] {
  const byId = new Map(rack.placements.map((p) => [p.id, p]));
  const groups = new Map<
    string,
    { device: string; switchId: string; ports: number[] }
  >();
  for (const l of rack.patchLinks ?? []) {
    const drop = l.dropId ? dropsById?.get(l.dropId) : undefined;
    const type = drop?.deviceType?.trim().replace(/\s+/g, " ");
    if (!type) continue;
    const toP = byId.get(l.toPlacementId);
    if (!toP) continue;
    const toDev = devs[toP.deviceId];
    if (!toDev) continue;
    const key = `${l.toPlacementId}\n${type.toLowerCase()}`;
    const g = groups.get(key);
    if (g) {
      g.ports.push(l.toPort);
    } else {
      groups.set(key, {
        device: type,
        switchId: l.toPlacementId,
        ports: [l.toPort],
      });
    }
  }
  return [...groups.values()]
    .map((g) => {
      const sw = byId.get(g.switchId)!;
      const swDev = devs[sw.deviceId]!;
      return {
        device: g.device,
        switch: placementPatchName(sw, swDev),
        ports: collapsePortRanges(g.ports),
        uSlot: sw.uSlot,
        firstPort: Math.min(...g.ports),
      };
    })
    .sort((a, b) => b.uSlot - a.uSlot || a.firstPort - b.firstPort)
    .map(({ device, switch: sw, ports }) => ({ device, switch: sw, ports }));
}

/** Collapse port numbers into ranges: [1, 2, 3, 5, 7, 8] -> "1-3, 5, 7-8". */
export function collapsePortRanges(ports: number[]): string {
  const sorted = [...new Set(ports)].sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (const n of sorted.slice(1)) {
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = prev = n;
  }
  parts.push(start === prev ? `${start}` : `${start}-${prev}`);
  return parts.join(", ");
}
/** One row of the printed patch table: a panel port, the drop on it
 *  ("" when none is assigned yet) and the switch port it patches to
 *  ("" when the port is not patched yet — a drop-first port still
 *  prints, with a blank switch cell). Rows run panel top-down
 *  (highest U first), then by port number. */
export interface PatchTableRow {
  drop: string;
  panel: string;
  switch: string;
}

export function patchTableRows(
  rack: Rack,
  devs: Record<string, RackDeviceType>,
  dropsById?: Map<string, DropMarkup>,
): PatchTableRow[] {
  const byId = new Map(rack.placements.map((p) => [p.id, p]));
  // One row per panel port that has a drop, a switch patch, or both.
  const byPort = new Map<
    string,
    { placementId: string; port: number; dropId?: string; link?: RackPatchLink }
  >();
  for (const l of rack.patchLinks ?? []) {
    byPort.set(`${l.fromPlacementId}:${l.fromPort}`, {
      placementId: l.fromPlacementId,
      port: l.fromPort,
      dropId: l.dropId,
      link: l,
    });
  }
  for (const d of rack.panelPortDrops ?? []) {
    const key = `${d.placementId}:${d.port}`;
    const existing = byPort.get(key);
    if (existing) {
      if (!existing.dropId) existing.dropId = d.dropId;
    } else {
      byPort.set(key, {
        placementId: d.placementId,
        port: d.port,
        dropId: d.dropId,
      });
    }
  }
  const entries = [...byPort.values()].sort((a, b) => {
    const ua = byId.get(a.placementId)?.uSlot ?? 0;
    const ub = byId.get(b.placementId)?.uSlot ?? 0;
    if (ub !== ua) return ub - ua;
    return a.port - b.port;
  });
  const rows: PatchTableRow[] = [];
  for (const { placementId, port, dropId, link } of entries) {
    const fromP = byId.get(placementId);
    if (!fromP) continue;
    const fromDev = devs[fromP.deviceId];
    if (!fromDev) continue;
    let switchText = "";
    if (link) {
      const toP = byId.get(link.toPlacementId);
      const toDev = toP ? devs[toP.deviceId] : undefined;
      if (toP && toDev) {
        switchText = `${placementPatchName(toP, toDev)} / P ${link.toPort}`;
      }
    }
    rows.push({
      drop: dropDisplayNumber(dropId ? dropsById?.get(dropId) : undefined),
      panel: `${placementPatchName(fromP, fromDev)} ${port}`,
      switch: switchText,
    });
  }
  return rows;
}

// ───── Patch cords (Cable View) ─────

/** Grid position (0-based column, row) of the i-th port in a faceplate
 *  group. Row-first groups number across the top row, then the next row
 *  down. Column groups (the JetStreams) number down each column — odd
 *  on top, even on the bottom — so port 2 sits under port 1, not beside
 *  it. Single-row groups are the same either way. */
export function portGridPosition(
  g: FaceplatePortGroup,
  i: number,
): { col: number; row: number } {
  const rows = g.rows ?? 1;
  if (g.order === "column") {
    return { col: Math.floor(i / rows), row: i % rows };
  }
  const perRow = Math.ceil(g.count / rows);
  return { col: i % perRow, row: Math.floor(i / perRow) };
}

/** First and last port numbers (1-based) on one row of a faceplate
 *  group — what the Cable View prints at the row ends. */
export function portRowRange(
  g: FaceplatePortGroup,
  row: number,
): { first: number; last: number } {
  const rows = g.rows ?? 1;
  const perRow = Math.ceil(g.count / rows);
  if (g.order === "column") {
    // Row 0 is the odd numbers (1, 3, 5 ...), row 1 the even (2, 4, 6 ...).
    const first = row + 1;
    return { first, last: Math.min(first + 2 * (perRow - 1), g.count) };
  }
  const first = row * perRow + 1;
  return { first, last: Math.min(first + perRow - 1, g.count) };
}

/** Patch-cord lengths stocked, in feet. */
export const CORD_LENGTHS = [1, 3, 5] as const;
/** Cord colors — each color is a VLAN, not a length. */
/** Cord colors — the seven rainbow colors first, then the extras. Each
 *  color is a VLAN, not a length. */
export const CORD_COLORS = [
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "indigo",
  "violet",
  "amber",
  "black",
  "purple",
  "white",
] as const;
export type CordColor = (typeof CORD_COLORS)[number];

/** Center U of a placement: the midpoint of the U slots it occupies. */
export function placementCenterU(p: RackPlacement, dev: RackDeviceType): number {
  const h = placementUHeight(p, dev);
  return p.uSlot + (h - 1) / 2;
}

/** Estimated patch-cord run for a panel -> switch link, in inches: the
 *  vertical distance between the two device centers (1U = 1.75") plus
 *  6" for the bend and slack. An estimate, not a measurement. */
export function patchCordRunInches(
  from: RackPlacement,
  fromDev: RackDeviceType,
  to: RackPlacement,
  toDev: RackDeviceType,
): number {
  const gapU = Math.abs(
    placementCenterU(from, fromDev) - placementCenterU(to, toDev),
  );
  return gapU * 1.75 + 6;
}

/** Shortest stocked cord that covers a run (inches), or undefined when
 *  no stocked cord is long enough — the run needs re-routing. */
export function suggestedCordLength(
  runInches: number,
): (typeof CORD_LENGTHS)[number] | undefined {
  for (const len of CORD_LENGTHS) {
    if (runInches <= len * 12) return len;
  }
  return undefined;
}

/** Cord status for a link: "ok" when the cord on it covers the run,
 *  "tight" when the cord is shorter than the run (strain on the cable),
 *  "unset" when no cord has been recorded for the link yet. */
export type CordStatus = "ok" | "tight" | "unset";
export function cordStatus(
  runInches: number,
  cordLength: number | undefined,
): CordStatus {
  if (cordLength === undefined) return "unset";
  return cordLength * 12 >= runInches ? "ok" : "tight";
}
