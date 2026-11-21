// Shared rack geometry helpers — used by the editor frame, the properties
// panel, and the elevation export so all three agree on what fits where.
import { rackDevicesById, type RackDeviceType } from "../data/rackDevices";
import type { Rack, RackPlacement, RackPatchLink } from "../store/projectStore";

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

/** One row of the printed patch table: a panel port and the switch port
 *  it patches to, both by short name — e.g. { panel: "PP 1", switch:
 *  "SW 1 / P 1" }. Rows run panel top-down (highest U first), then by
 *  port number. */
export interface PatchTableRow {
  panel: string;
  switch: string;
}

export function patchTableRows(
  rack: Rack,
  devs: Record<string, RackDeviceType>,
): PatchTableRow[] {
  const byId = new Map(rack.placements.map((p) => [p.id, p]));
  const links = [...(rack.patchLinks ?? [])].sort((a, b) => {
    const ua = byId.get(a.fromPlacementId)?.uSlot ?? 0;
    const ub = byId.get(b.fromPlacementId)?.uSlot ?? 0;
    if (ub !== ua) return ub - ua;
    return a.fromPort - b.fromPort;
  });
  const rows: PatchTableRow[] = [];
  for (const l of links) {
    const fromP = byId.get(l.fromPlacementId);
    const toP = byId.get(l.toPlacementId);
    if (!fromP || !toP) continue;
    const fromDev = devs[fromP.deviceId];
    const toDev = devs[toP.deviceId];
    if (!fromDev || !toDev) continue;
    rows.push({
      panel: `${placementPatchName(fromP, fromDev)} ${l.fromPort}`,
      switch: `${placementPatchName(toP, toDev)} / P ${l.toPort}`,
    });
  }
  return rows;
}
