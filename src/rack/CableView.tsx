// Cable View — one picture per pair of patchable devices, one cable
// per patch. Patching happens here now: click a port on the top
// device, then a port on the bottom one, and the cable appears between
// them. A pair is any two patch panels or switches — two switches make
// an uplink, which prints on the elevation like any other patch. The
// devices are drawn where they sit in the rack, so a long run is
// visible before the cord goes on: the run is the distance between
// the two device centers (1U = 1.75") plus 6" for the bend and slack.
// A cable is TIGHT when the cord on it is shorter than the run
// (strain on the cable). Cord color is the VLAN; length is a separate
// pick. Click a cable to move its drop, its switch port, or its cord.
import { useEffect, useMemo, useState } from "react";
import {
  useProjectStore,
  type DropMarkup,
  type Rack,
  type RackPatchLink,
  type RackPlacement,
} from "../store/projectStore";
import { rackDevicesById, type RackDeviceType } from "../data/rackDevices";
import { allDropMarkups } from "../lib/dropLabels";
import {
  CORD_COLORS,
  CORD_LENGTHS,
  cordStatus,
  dropDisplayNumber,
  patchablePorts,
  patchCordRunInches,
  placementPatchName,
  placementUHeight,
  portGridPosition,
  portRowRange,
  suggestedCordLength,
  type CordColor,
} from "./rackUtils";
import { Field } from "./RackProperties";

const CORD_HEX: Record<CordColor, string> = {
  red: "#ef4444",
  orange: "#f97316",
  yellow: "#eab308",
  green: "#22c55e",
  blue: "#3b82f6",
  indigo: "#6366f1",
  violet: "#8b5cf6",
  amber: "#f59e0b",
  // Black cords read as grey on the dark background.
  black: "#9ca3af",
  purple: "#a855f7",
  white: "#ffffff",
};

interface EnrichedLink {
  link: RackPatchLink;
  drop: DropMarkup | undefined;
  run: number;
  suggested: 1 | 3 | 5 | undefined;
  status: "ok" | "tight" | "unset";
}

interface Pair {
  /** Top device of the section — a patch panel or a switch. */
  from: RackPlacement;
  fromDev: RackDeviceType;
  /** Bottom device — a patch panel or a switch. Two switches make an
   *  uplink pair. */
  to: RackPlacement;
  toDev: RackDeviceType;
  links: EnrichedLink[];
  tight: number;
  /** Patch-cord run for this pair, in inches — same for every link in
   *  it, since it only depends on the two devices. */
  run: number;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/** RJ45 port count on a device: its first faceplate port group, else
 *  frontPorts. SFP slots (ports past this count) never take a drop. */
function rj45Count(dev: RackDeviceType): number {
  return dev.faceplate?.ports?.[0]?.count ?? dev.frontPorts ?? 0;
}

/** U range label for a placement: "U22" or "U20–21". */
function uRange(p: RackPlacement, dev: RackDeviceType): string {
  const h = placementUHeight(p, dev);
  return h > 1 ? `U${p.uSlot}–${p.uSlot + h - 1}` : `U${p.uSlot}`;
}

/** SVG center of a port square on a device bar. RJ45 ports run in rows
 *  from x=180; SFP slots sit past the RJ45 block. Port positions follow
 *  the group's numbering order — on the JetStreams port 2 sits under
 *  port 1, not beside it. */
function portPoint(
  dev: RackDeviceType,
  barY: number,
  port: number,
): { x: number; y: number } {
  const groups = dev.faceplate?.ports ?? [];
  const rj = groups[0];
  const rjN = rj?.count ?? dev.frontPorts ?? 0;
  if (port <= rjN && rj) {
    const { col, row } = portGridPosition(rj, port - 1);
    return { x: 186 + col * 24, y: barY + 12 + row * 18 };
  }
  const perRow = Math.ceil((rj?.count ?? 0) / (rj?.rows ?? 1));
  const sfpX = 180 + perRow * 24 + 14;
  const sfp = groups[1];
  const idx = port - rjN - 1;
  if (sfp) {
    const { col, row } = portGridPosition(sfp, idx);
    // A 2-row SFP block lines up with the RJ45 rows; a single-row block
    // sits centered between them, as before.
    const y = (sfp.rows ?? 1) > 1 ? barY + 12 + row * 18 : barY + 22;
    return { x: sfpX + col * 20 + 7, y };
  }
  return { x: sfpX + idx * 20 + 7, y: barY + 22 };
}

function DeviceBar({
  p,
  dev,
  y,
  hoveredPort,
  onPortHover,
  onPortLeave,
  patchedPorts,
  selectedPort,
  destPort,
  onPortClick,
}: {
  p: RackPlacement;
  dev: RackDeviceType;
  y: number;
  /** The port square the mouse is over, if any — drawn with an amber
   *  outline. `n` is the port number (SFP slots are rjN+1..). */
  hoveredPort?: { n: number; isSfp: boolean } | null;
  onPortHover?: (
    n: number,
    isSfp: boolean,
    ev: { clientX: number; clientY: number },
  ) => void;
  onPortLeave?: () => void;
  /** RJ45 ports that already have a cable on this bar — amber fill. */
  patchedPorts?: Set<number>;
  /** The port picked for patching on this bar — blue outline. */
  selectedPort?: number | null;
  /** The port this bar's picked port already patches to — green
   *  outline. Only set on the bottom bar. */
  destPort?: number | null;
  /** Click a port square to patch. SFP slots are hover-only — they
   *  never take a drop patch. */
  onPortClick?: (n: number) => void;
}) {
  const rj = dev.faceplate?.ports?.[0];
  const rjN = rj?.count ?? dev.frontPorts ?? 0;
  const perRow = Math.ceil(rjN / (rj?.rows ?? 1));
  const rows = rj?.rows ?? 1;
  const sfp = dev.faceplate?.ports?.[1];
  const sfpX = 180 + perRow * 24 + 14;
  // First/last port number on each row, following the group's order.
  const topRange = rj ? portRowRange(rj, 0) : { first: 1, last: perRow };
  const bottomRange = rj
    ? portRowRange(rj, 1)
    : { first: perRow + 1, last: rjN };
  const ports: { x: number; y: number; key: string; n: number }[] = [];
  for (let i = 0; i < rjN; i++) {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    // Port number follows the group's order: row-major on panels,
    // odd on top / even on bottom on the JetStreams.
    const n =
      rj?.order === "column"
        ? col * rows + row + 1
        : row * perRow + col + 1;
    ports.push({ x: 180 + col * 24, y: y + 6 + row * 18, key: `p${n}`, n });
  }
  return (
    <g>
      <rect
        x={20}
        y={y}
        width={860}
        height={46}
        rx={4}
        fill="#1a232e"
        stroke="#2a3644"
      />
      <text x={32} y={y + 18} fill="#e8eef4" fontSize={12} fontWeight={700}>
        {placementPatchName(p, dev)}
      </text>
      <text x={32} y={y + 36} fill="#8b9bb0" fontSize={10}>
        {uRange(p, dev)}
      </text>
      {ports.map((pt) => {
        const isHot = hoveredPort?.n === pt.n && !hoveredPort.isSfp;
        const isPatched = patchedPorts?.has(pt.n) ?? false;
        const isSelected = selectedPort === pt.n;
        const isDest = destPort === pt.n;
        return (
          <rect
            key={pt.key}
            x={pt.x}
            y={pt.y}
            width={12}
            height={12}
            fill={isPatched ? "#f59e0b" : "#0b1220"}
            stroke={
              isSelected
                ? "#4fb7ff"
                : isDest
                  ? "#2bd37c"
                  : isHot
                    ? "#f59e0b"
                    : "#5b6b80"
            }
            strokeWidth={isSelected || isDest || isHot ? 2 : 1}
            style={{ cursor: "pointer" }}
            onClick={() => onPortClick?.(pt.n)}
            onMouseEnter={(ev) => onPortHover?.(pt.n, false, ev)}
            onMouseMove={(ev) => onPortHover?.(pt.n, false, ev)}
            onMouseLeave={onPortLeave}
          />
        );
      })}
      {sfp && (
        <g>
          {Array.from({ length: sfp.count }, (_, s) => {
            const { col, row } = portGridPosition(sfp, s);
            const sy = (sfp.rows ?? 1) > 1 ? y + 6 + row * 18 : y + 15;
            // SFP slots are numbered past the RJ45 block.
            const n = rjN + s + 1;
            const isHot = hoveredPort?.n === n && hoveredPort.isSfp;
            return (
              <rect
                key={s}
                x={sfpX + col * 20}
                y={sy}
                width={14}
                height={14}
                fill="#0b1220"
                stroke={isHot ? "#fbbf24" : "#f59e0b"}
                strokeWidth={isHot ? 2 : 1}
                style={{ cursor: "pointer" }}
                onMouseEnter={(ev) => onPortHover?.(n, true, ev)}
                onMouseMove={(ev) => onPortHover?.(n, true, ev)}
                onMouseLeave={onPortLeave}
              />
            );
          })}
          <text x={sfpX} y={y + 42} fill="#8b9bb0" fontSize={9}>
            SFP
          </text>
        </g>
      )}
      {/* Port numbers at the row ends — first and last number on each row,
          following the group's numbering order. */}
      <text x={186} y={y + 4} fill="#5b6b80" fontSize={8} textAnchor="middle">
        {topRange.first}
      </text>
      <text
        x={186 + (perRow - 1) * 24}
        y={y + 4}
        fill="#5b6b80"
        fontSize={8}
        textAnchor="middle"
      >
        {topRange.last}
      </text>
      {rows > 1 && (
        <>
          <text
            x={186}
            y={y + 4 + (rows - 1) * 18}
            fill="#5b6b80"
            fontSize={8}
            textAnchor="middle"
          >
            {bottomRange.first}
          </text>
          <text
            x={186 + (perRow - 1) * 24}
            y={y + 4 + (rows - 1) * 18}
            fill="#5b6b80"
            fontSize={8}
            textAnchor="middle"
          >
            {bottomRange.last}
          </text>
        </>
      )}
    </g>
  );
}

export function CableView() {
  const project = useProjectStore((s) => s.project);
  const racks = project?.racks ?? [];
  const activeRackId = useProjectStore((s) => s.activeRackId);
  const setActiveRack = useProjectStore((s) => s.setActiveRack);
  const assignDrop = useProjectStore((s) => s.assignPanelPortDrop);
  const movePatch = useProjectStore((s) => s.movePatchLink);
  const addPatchLink = useProjectStore((s) => s.addPatchLink);
  const addPatchLinks = useProjectStore((s) => s.addPatchLinks);
  const removePatchLink = useProjectStore((s) => s.removePatchLink);
  const setCord = useProjectStore((s) => s.setPatchLinkCord);
  const setBulkCords = useProjectStore((s) => s.setPatchLinkCords);

  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  // Bulk apply: link ids picked with the table checkboxes, plus the
  // length/color the bulk bar will apply to all of them at once.
  const [bulkIds, setBulkIds] = useState<string[]>([]);
  const [bulkLength, setBulkLength] = useState<
    "" | "1" | "3" | "5" | "suggested"
  >("");
  const [bulkColor, setBulkColor] = useState<"" | CordColor>("");
  const [bulkNote, setBulkNote] = useState<string | null>(null);
  // Pairs started from the picker that have no cables yet — they render
  // as empty sections so the first cable can be plugged in.
  const [extraPairs, setExtraPairs] = useState<
    Array<{ fromId: string; toId: string }>
  >([]);
  const [pairFromId, setPairFromId] = useState("");
  const [pairToId, setPairToId] = useState("");
  const [pairMsg, setPairMsg] = useState<string | null>(null);

  const rack = racks.find((r) => r.id === activeRackId) ?? racks[0];

  useEffect(() => {
    setSelectedLinkId(null);
    setBulkIds([]);
    setBulkLength("");
    setBulkColor("");
    setBulkNote(null);
    setExtraPairs([]);
    setPairFromId("");
    setPairToId("");
    setPairMsg(null);
  }, [rack?.id]);

  const drops = useMemo(
    () => (project ? allDropMarkups(project) : []),
    [project],
  );
  const dropById = useMemo(
    () => new Map(drops.map((d) => [d.id, d])),
    [drops],
  );

  // Patchable devices on this rack: patch panels and switches. Two
  // switches make an uplink pair.
  const patchable = useMemo(
    () =>
      rack
        ? rack.placements.filter((p) => {
            const d = rackDevicesById[p.deviceId];
            return (
              d &&
              (d.category === "patch" || d.category === "switch") &&
              (d.frontPorts ?? 0) > 0
            );
          })
        : [],
    [rack],
  );

  const pairs = useMemo<Pair[]>(() => {
    if (!rack) return [];
    const byId = new Map(rack.placements.map((p) => [p.id, p]));
    const groups = new Map<string, Pair>();
    const ensurePair = (
      from: RackPlacement,
      to: RackPlacement,
    ): Pair | undefined => {
      const fromDev = rackDevicesById[from.deviceId];
      const toDev = rackDevicesById[to.deviceId];
      if (!fromDev || !toDev) return undefined;
      if (fromDev.category !== "patch" && fromDev.category !== "switch")
        return undefined;
      if (toDev.category !== "patch" && toDev.category !== "switch")
        return undefined;
      const key = `${from.id}->${to.id}`;
      let pair = groups.get(key);
      if (!pair) {
        pair = {
          from,
          fromDev,
          to,
          toDev,
          links: [],
          tight: 0,
          run: patchCordRunInches(from, fromDev, to, toDev),
        };
        groups.set(key, pair);
      }
      return pair;
    };
    for (const link of rack.patchLinks ?? []) {
      const from = byId.get(link.fromPlacementId);
      const to = byId.get(link.toPlacementId);
      if (!from || !to) continue;
      const pair = ensurePair(from, to);
      if (!pair) continue;
      const status = cordStatus(pair.run, link.cordLength);
      if (status === "tight") pair.tight++;
      pair.links.push({
        link,
        drop: link.dropId ? dropById.get(link.dropId) : undefined,
        run: pair.run,
        suggested: suggestedCordLength(pair.run),
        status,
      });
    }
    // Pairs started from the picker with no cables yet still get a
    // section, so the first cable can be plugged in.
    for (const ep of extraPairs) {
      const from = byId.get(ep.fromId);
      const to = byId.get(ep.toId);
      if (!from || !to) continue;
      ensurePair(from, to);
    }
    const out = [...groups.values()];
    for (const p of out) p.links.sort((a, b) => a.link.fromPort - b.link.fromPort);
    // Top of the rack first.
    out.sort((a, b) => b.from.uSlot - a.from.uSlot);
    return out;
  }, [rack, dropById, extraPairs]);

  /** Start a pair from the picker: an empty section appears below,
   *  ready to patch. A pair that already has a section just scrolls
   *  into view. */
  const startPair = () => {
    const fromId = pairFromId || patchable[0]?.id;
    const toId = pairToId || patchable[1]?.id;
    if (!fromId || !toId) return;
    if (fromId === toId) {
      setPairMsg("Pick two different devices.");
      return;
    }
    const exists =
      pairs.some((p) => p.from.id === fromId && p.to.id === toId) ||
      extraPairs.some((p) => p.fromId === fromId && p.toId === toId);
    if (exists) {
      setPairMsg("That pair is already on this page — scrolled to it.");
      document
        .getElementById(`pair-${fromId}-${toId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setPairMsg(null);
    setExtraPairs((prev) => [...prev, { fromId, toId }]);
    setTimeout(
      () =>
        document
          .getElementById(`pair-${fromId}-${toId}`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
      0,
    );
  };

  /** Unpatch from the detail card: the link goes away and its drop
   *  stays terminated on its panel port. */
  const handleRemovePatch = (linkId: string) => {
    if (!rack) return;
    removePatchLink(rack.id, linkId);
    setBulkIds((prev) => prev.filter((id) => id !== linkId));
    setSelectedLinkId(null);
  };

  const totalLinks = pairs.reduce((n, p) => n + p.links.length, 0);
  const totalTight = pairs.reduce((n, p) => n + p.tight, 0);
  const selected = useMemo(() => {
    if (!selectedLinkId) return null;
    for (const pair of pairs) {
      const found = pair.links.find((e) => e.link.id === selectedLinkId);
      if (found) return { pair, enriched: found };
    }
    return null;
  }, [pairs, selectedLinkId]);

  const toggleBulk = (id: string) => {
    setBulkNote(null);
    setBulkIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const togglePairBulk = (pair: Pair) => {
    setBulkNote(null);
    const ids = pair.links.map((e) => e.link.id);
    setBulkIds((prev) => {
      const all = ids.every((id) => prev.includes(id));
      return all
        ? prev.filter((id) => !ids.includes(id))
        : [...prev, ...ids.filter((id) => !prev.includes(id))];
    });
  };

  const clearBulk = () => {
    setBulkIds([]);
    setBulkLength("");
    setBulkColor("");
    setBulkNote(null);
  };

  /** Apply the bar's length and/or color to every picked row, in one
   *  save. A field left on "—" is untouched. "Suggested lengths"
   *  gives each row its own suggested length; rows with no suggested
   *  length are skipped and counted. */
  const applyBulk = () => {
    if (bulkIds.length === 0) return;
    if (bulkLength === "" && bulkColor === "") return;
    const updates: Array<{
      linkId: string;
      cord: { length?: 1 | 3 | 5; color?: CordColor };
    }> = [];
    let skipped = 0;
    for (const id of bulkIds) {
      let found: EnrichedLink | undefined;
      for (const p of pairs) {
        found = p.links.find((e) => e.link.id === id);
        if (found) break;
      }
      if (!found) continue;
      const cord: { length?: 1 | 3 | 5; color?: CordColor } = {};
      if (bulkLength === "suggested") {
        if (found.suggested !== undefined) cord.length = found.suggested;
        else skipped++;
      } else if (bulkLength !== "") {
        cord.length = Number(bulkLength) as 1 | 3 | 5;
      }
      if (bulkColor !== "") cord.color = bulkColor;
      if ("length" in cord || "color" in cord) updates.push({ linkId: id, cord });
    }
    if (updates.length > 0 && rack) setBulkCords(rack.id, updates);
    const applied = updates.length;
    setBulkIds([]);
    setBulkLength("");
    setBulkColor("");
    setBulkNote(
      skipped > 0
        ? `Applied to ${applied} row${applied === 1 ? "" : "s"}; ${skipped} row${skipped === 1 ? "" : "s"} had no suggested length — left unset.`
        : `Applied to ${applied} row${applied === 1 ? "" : "s"}.`,
    );
  };

  if (racks.length === 0 || !rack) {
    return (
      <div className="flex-1 overflow-auto p-4">
        <div className="panel rounded-lg p-6 text-sm text-ink-300 text-center">
          No racks yet — add a rack in the Racks view first.
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-ink-100">Cable View</h2>
          <p className="text-xs text-ink-300">
            Click a port on each device to plug a cable in — patched ports
            are amber, the picked port is blue. Run is the distance
            between the device centers (1U = 1.75&Prime;) plus 6&Prime; for
            the bend and slack. A cable is tight when the cord on it is
            shorter than the run. Color is the VLAN, length is separate.
          </p>
        </div>
        <div className="text-xs text-ink-300">
          {totalLinks} cables
          {totalTight > 0 && (
            <span className="ml-2 text-red-300 font-semibold">
              {totalTight} tight
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 max-w-xs">
        <Field label="Rack">
          <select
            className="input"
            value={rack.id}
            onChange={(e) => setActiveRack(e.target.value || null)}
          >
            {racks.map((r: Rack) => (
              <option key={r.id} value={r.id}>
                {r.name} · {r.uHeight}U
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="panel rounded-lg p-3 space-y-2 max-w-xl">
        <div className="label">Start a new pair</div>
        <p className="text-xs text-ink-300">
          A pair with no patches yet has no section — pick its two devices
          here and their bars appear below, ready to patch. Two switches
          make an uplink pair.
        </p>
        {patchable.length < 2 ? (
          <div className="text-xs text-ink-400 italic">
            Add a patch panel and a switch to this rack to start patching.
          </div>
        ) : (
          <div className="flex items-end gap-2 flex-wrap">
            <Field label="From">
              <select
                className="input"
                value={pairFromId || patchable[0]?.id || ""}
                onChange={(e) => setPairFromId(e.target.value)}
              >
                {patchable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {placementPatchName(p, rackDevicesById[p.deviceId]!)}
                  </option>
                ))}
              </select>
            </Field>
            <span className="text-ink-400 text-xs pb-2">→</span>
            <Field label="To">
              <select
                className="input"
                value={pairToId || patchable[1]?.id || ""}
                onChange={(e) => setPairToId(e.target.value)}
              >
                {patchable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {placementPatchName(p, rackDevicesById[p.deviceId]!)}
                  </option>
                ))}
              </select>
            </Field>
            <button className="btn" onClick={startPair}>
              Start patching
            </button>
            {pairMsg && (
              <span className="text-xs text-ink-300">{pairMsg}</span>
            )}
          </div>
        )}
      </div>

      {bulkIds.length > 0 && (
        <BulkBar
          count={bulkIds.length}
          length={bulkLength}
          onLength={setBulkLength}
          color={bulkColor}
          onColor={setBulkColor}
          onApply={applyBulk}
          onClear={clearBulk}
        />
      )}

      {bulkNote && <p className="text-xs text-ink-300">{bulkNote}</p>}

      {pairs.length === 0 ? (
        <div className="panel rounded-lg p-6 text-sm text-ink-300 text-center">
          No cables yet — start a pair above and click a port on each
          device to plug the first cable in.
        </div>
      ) : (
        pairs.map((pair) => (
          <PairSection
            key={`${pair.from.id}->${pair.to.id}`}
            rack={rack}
            pair={pair}
            selectedLinkId={selectedLinkId}
            onSelect={setSelectedLinkId}
            onAddPatchLink={addPatchLink}
            onAddPatchLinks={addPatchLinks}
            onSetCord={setCord}
            onSetCords={setBulkCords}
            bulkIds={bulkIds}
            onToggleBulk={toggleBulk}
            onTogglePairBulk={() => togglePairBulk(pair)}
          />
        ))
      )}

      {selected && (
        <DetailCard
          rack={rack}
          pair={selected.pair}
          enriched={selected.enriched}
          onAssignDrop={assignDrop}
          onMovePatch={movePatch}
          onSetCord={setCord}
          onRemovePatch={handleRemovePatch}
        />
      )}
    </div>
  );
}

/** Bulk-apply bar: shows while any table rows are picked. One length
 *  and/or one color, applied to every picked row in a single save. A
 *  field left on "—" is untouched. */
function BulkBar({
  count,
  length,
  onLength,
  color,
  onColor,
  onApply,
  onClear,
}: {
  count: number;
  length: "" | "1" | "3" | "5" | "suggested";
  onLength: (v: "" | "1" | "3" | "5" | "suggested") => void;
  color: "" | CordColor;
  onColor: (v: "" | CordColor) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  const canApply = length !== "" || color !== "";
  return (
    <div className="panel rounded-lg p-3 sticky top-0 z-10 flex items-center gap-3 flex-wrap">
      <span className="text-xs font-semibold text-ink-100">
        {count} selected
      </span>
      <label className="flex items-center gap-1.5 text-xs text-ink-300">
        Length
        <select
          className="input !py-0.5 !px-1 text-xs w-[140px]"
          value={length}
          onChange={(e) =>
            onLength(e.target.value as "" | "1" | "3" | "5" | "suggested")
          }
          aria-label="Bulk cord length"
        >
          <option value="">— leave unchanged</option>
          <option value="1">1 ft</option>
          <option value="3">3 ft</option>
          <option value="5">5 ft</option>
          <option value="suggested">Suggested lengths</option>
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-xs text-ink-300">
        Color
        <select
          className="input !py-0.5 !px-1 text-xs w-[120px]"
          value={color}
          onChange={(e) => onColor(e.target.value as "" | CordColor)}
          aria-label="Bulk cord color (VLAN)"
        >
          <option value="">— leave unchanged</option>
          {CORD_COLORS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <button className="btn btn-sm" disabled={!canApply} onClick={onApply}>
        Apply to {count}
      </button>
      <button className="btn btn-sm" onClick={onClear}>
        Clear
      </button>
    </div>
  );
}

function PairSection({
  rack,
  pair,
  selectedLinkId,
  onSelect,
  onAddPatchLink,
  onAddPatchLinks,
  onSetCord,
  onSetCords,
  bulkIds,
  onToggleBulk,
  onTogglePairBulk,
}: {
  rack: Rack;
  pair: Pair;
  selectedLinkId: string | null;
  onSelect: (id: string | null) => void;
  onAddPatchLink: (rackId: string, link: RackPatchLink) => void;
  onAddPatchLinks: (rackId: string, links: RackPatchLink[]) => void;
  onSetCord: (
    rackId: string,
    linkId: string,
    cord: { length?: 1 | 3 | 5; color?: CordColor },
  ) => void;
  onSetCords: (
    rackId: string,
    updates: Array<{
      linkId: string;
      cord: { length?: 1 | 3 | 5; color?: CordColor };
    }>,
  ) => void;
  bulkIds: string[];
  onToggleBulk: (id: string) => void;
  onTogglePairBulk: () => void;
}) {
  const { from, fromDev, to, toDev, links } = pair;
  const allBulk =
    links.length > 0 && links.every((e) => bulkIds.includes(e.link.id));
  const someBulk = links.some((e) => bulkIds.includes(e.link.id));
  // Click-to-patch: the port picked on the top device, waiting for its
  // partner on the bottom device.
  const [pickedPort, setPickedPort] = useState<number | null>(null);
  // The cord every new cable from this pair gets: Suggested gives each
  // cable its own length from the pair's run; green is the default
  // color, "—" records no color.
  const [newLength, setNewLength] = useState<
    "suggested" | "1" | "3" | "5"
  >("suggested");
  const [newColor, setNewColor] = useState<"" | CordColor>("green");
  const [showRange, setShowRange] = useState(false);
  const [rangeFrom, setRangeFrom] = useState("1");
  const [rangeTo, setRangeTo] = useState("12");
  const [rangeStart, setRangeStart] = useState("1");
  // Port hover: the port square the mouse is over, with the cursor
  // position for the tooltip. The tooltip names the drop on that port,
  // and the port's cable lights up while the rest dim.
  const [portHover, setPortHover] = useState<{
    side: "from" | "to";
    n: number;
    isSfp: boolean;
    x: number;
    y: number;
  } | null>(null);

  const onPortHover = (
    side: "from" | "to",
    n: number,
    isSfp: boolean,
    ev: { clientX: number; clientY: number },
  ) => {
    setPortHover({ side, n, isSfp, x: ev.clientX, y: ev.clientY });
  };

  const onPortLeave = () => setPortHover(null);

  const fromName = placementPatchName(from, fromDev);
  const toName = placementPatchName(to, toDev);
  const fromPatched = new Set(links.map((e) => e.link.fromPort));
  const toPatched = new Set(links.map((e) => e.link.toPort));
  const pickedLink =
    pickedPort !== null
      ? links.find((e) => e.link.fromPort === pickedPort)
      : undefined;
  const destPort = pickedLink?.link.toPort ?? null;

  /** The cord a new cable from this pair gets, from the toolbar picks. */
  const newCordFor = (): { length?: 1 | 3 | 5; color?: CordColor } => {
    const cord: { length?: 1 | 3 | 5; color?: CordColor } = {};
    const len =
      newLength === "suggested"
        ? suggestedCordLength(pair.run)
        : (Number(newLength) as 1 | 3 | 5);
    if (len !== undefined) cord.length = len;
    if (newColor !== "") cord.color = newColor;
    return cord;
  };

  /** Record the toolbar cord on freshly plugged cables, in one save. */
  const applyNewCords = (made: RackPatchLink[]) => {
    const cord = newCordFor();
    if (!("length" in cord) && !("color" in cord)) return;
    onSetCords(
      rack.id,
      made.map((l) => ({ linkId: l.id, cord })),
    );
  };

  /** Click a port on the top device: pick it (and open its cable, if
   *  it has one). Clicking the same port again unpicks it. */
  const onFromPortClick = (port: number) => {
    setPickedPort((cur) => (cur === port ? null : port));
    const link = links.find((e) => e.link.fromPort === port);
    onSelect(link ? link.link.id : null);
  };

  /** Click a port on the bottom device: with a top port picked, plug
   *  the cable in. Plugging into a taken port takes it over — the old
   *  cable's drop goes back to its panel port, same as the sidebar.
   *  With nothing picked, jump to the cable on this port, if any. */
  const onToPortClick = (port: number) => {
    if (pickedPort === null) {
      const link = links.find((e) => e.link.toPort === port);
      if (link) {
        setPickedPort(link.link.fromPort);
        onSelect(link.link.id);
      }
      return;
    }
    const id = uid();
    onAddPatchLink(rack.id, {
      id,
      fromPlacementId: from.id,
      fromPort: pickedPort,
      toPlacementId: to.id,
      toPort: port,
    });
    const cord = newCordFor();
    if ("length" in cord || "color" in cord) onSetCord(rack.id, id, cord);
    setPickedPort(null);
    onSelect(id);
  };

  /** RJ45 ports on a device — SFP slots never take a patch here. */
  const rj45Ports = (dev: RackDeviceType) =>
    Array.from({ length: rj45Count(dev) }, (_, i) => i + 1);

  /** Auto-map 1:1 down the pair, skipping ports that already have a
   *  cable — unlike the sidebar, which re-patches them (and drops the
   *  cord on the replaced link). */
  const autoMap = () => {
    const fromPorts = rj45Ports(fromDev);
    const toPorts = rj45Ports(toDev);
    const n = Math.min(fromPorts.length, toPorts.length);
    const made: RackPatchLink[] = [];
    for (let i = 0; i < n; i++) {
      const fp = fromPorts[i];
      const tp = toPorts[i];
      if (
        links.some((e) => e.link.fromPort === fp || e.link.toPort === tp)
      )
        continue;
      made.push({
        id: uid(),
        fromPlacementId: from.id,
        fromPort: fp,
        toPlacementId: to.id,
        toPort: tp,
      });
    }
    if (made.length === 0) return;
    onAddPatchLinks(rack.id, made);
    applyNewCords(made);
    setPickedPort(null);
    onSelect(null);
  };

  const rangeValid = (() => {
    const f = parseInt(rangeFrom, 10);
    const t = parseInt(rangeTo, 10);
    const s = parseInt(rangeStart, 10);
    const fromN = rj45Count(fromDev);
    const toN = rj45Count(toDev);
    return (
      isFinite(f) &&
      isFinite(t) &&
      isFinite(s) &&
      f >= 1 &&
      t >= f &&
      t <= fromN &&
      s >= 1 &&
      s + (t - f) <= toN
    );
  })();

  const applyRange = () => {
    if (!rangeValid) return;
    const f = parseInt(rangeFrom, 10);
    const t = parseInt(rangeTo, 10);
    const s = parseInt(rangeStart, 10);
    const made: RackPatchLink[] = [];
    for (let i = 0; i <= t - f; i++) {
      const fp = f + i;
      const tp = s + i;
      if (
        links.some((e) => e.link.fromPort === fp || e.link.toPort === tp)
      )
        continue;
      made.push({
        id: uid(),
        fromPlacementId: from.id,
        fromPort: fp,
        toPlacementId: to.id,
        toPort: tp,
      });
    }
    setShowRange(false);
    if (made.length === 0) return;
    onAddPatchLinks(rack.id, made);
    applyNewCords(made);
    setPickedPort(null);
    onSelect(null);
  };

  const hoveredLink =
    portHover && !portHover.isSfp
      ? portHover.side === "from"
        ? links.find((e) => e.link.fromPort === portHover.n)
        : links.find((e) => e.link.toPort === portHover.n)
      : undefined;
  const hoveredLinkId = hoveredLink?.link.id;
  const gapU = Math.abs(
    (from.uSlot + (placementUHeight(from, fromDev) - 1) / 2) -
      (to.uSlot + (placementUHeight(to, toDev) - 1) / 2),
  );
  const fromY = 24;
  const toY = fromY + 120 + Math.round(gapU * 8);
  const height = toY + 78;

  return (
    <div
      id={`pair-${from.id}-${to.id}`}
      className="panel rounded-lg p-3 space-y-3"
    >
      <div className="flex items-baseline justify-between flex-wrap gap-1">
        <div className="label flex items-center gap-2">
          <input
            type="checkbox"
            ref={(el) => {
              if (el) el.indeterminate = someBulk && !allBulk;
            }}
            checked={allBulk}
            onChange={onTogglePairBulk}
            aria-label={`Select all ${links.length} cables in this pair`}
          />
          {fromName} → {toName}
          <span className="ml-2 font-normal text-ink-300">
            {fromDev.label} · {toDev.model ? `${toDev.model} · ` : ""}
            {uRange(from, fromDev)} → {uRange(to, toDev)} · {gapU % 1 === 0 ? gapU : gapU.toFixed(1)}U apart
          </span>
        </div>
        <div className="text-xs text-ink-300">
          {links.length} cables
          {pair.tight > 0 && (
            <span className="ml-2 text-red-300 font-semibold">
              {pair.tight} tight
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="text-ink-300 flex-1 min-w-[220px]">
          {pickedPort !== null ? (
            <>
              <b className="text-ink-100">
                {fromName} port {pickedPort}
              </b>{" "}
              picked — now click its {toName} port.
            </>
          ) : (
            <>
              Click a port on {fromName}, then a port on {toName}.
            </>
          )}
        </span>
        <label className="flex items-center gap-1.5 text-ink-300">
          Cord for new cables
          <select
            className="input !py-0.5 !px-1 text-xs w-[110px]"
            value={newLength}
            onChange={(e) =>
              setNewLength(
                e.target.value as "suggested" | "1" | "3" | "5",
              )
            }
            aria-label="New cord length"
          >
            <option value="suggested">Suggested</option>
            <option value="1">1 ft</option>
            <option value="3">3 ft</option>
            <option value="5">5 ft</option>
          </select>
          <select
            className="input !py-0.5 !px-1 text-xs w-[100px]"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value as "" | CordColor)}
            aria-label="New cord color (VLAN)"
          >
            <option value="">— color</option>
            {CORD_COLORS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-sm" onClick={autoMap}>
          Auto-map 1:1
        </button>
        <button className="btn btn-sm" onClick={() => setShowRange((v) => !v)}>
          Map range…
        </button>
      </div>

      {showRange && (
        <div className="flex items-end gap-1.5 text-xs">
          <Field label={fromName}>
            <input
              className="input font-mono w-14"
              inputMode="numeric"
              value={rangeFrom}
              onChange={(e) => setRangeFrom(e.target.value)}
            />
          </Field>
          <span className="text-ink-400 pb-2">to</span>
          <Field label={fromName}>
            <input
              className="input font-mono w-14"
              inputMode="numeric"
              value={rangeTo}
              onChange={(e) => setRangeTo(e.target.value)}
            />
          </Field>
          <Field label={`${toName} from`}>
            <input
              className="input font-mono w-14"
              inputMode="numeric"
              value={rangeStart}
              onChange={(e) => setRangeStart(e.target.value)}
            />
          </Field>
          <button
            className="btn-primary"
            disabled={!rangeValid}
            onClick={applyRange}
          >
            Apply
          </button>
        </div>
      )}

      <svg
        viewBox={`0 0 900 ${height}`}
        className="w-full"
        role="img"
        aria-label={`${fromName} to ${toName} cables`}
      >
        <DeviceBar
          p={from}
          dev={fromDev}
          y={fromY}
          hoveredPort={
            portHover?.side === "from"
              ? { n: portHover.n, isSfp: portHover.isSfp }
              : null
          }
          onPortHover={(n, isSfp, ev) => onPortHover("from", n, isSfp, ev)}
          onPortLeave={onPortLeave}
          patchedPorts={fromPatched}
          selectedPort={pickedPort}
          onPortClick={onFromPortClick}
        />
        <DeviceBar
          p={to}
          dev={toDev}
          y={toY}
          hoveredPort={
            portHover?.side === "to"
              ? { n: portHover.n, isSfp: portHover.isSfp }
              : null
          }
          onPortHover={(n, isSfp, ev) => onPortHover("to", n, isSfp, ev)}
          onPortLeave={onPortLeave}
          patchedPorts={toPatched}
          destPort={destPort}
          onPortClick={onToPortClick}
        />
        {links.map(({ link, drop, status }) => {
          const a = portPoint(fromDev, fromY, link.fromPort);
          const b = portPoint(toDev, toY, link.toPort);
          const midY = (a.y + b.y) / 2;
          const color = link.cordColor
            ? CORD_HEX[link.cordColor]
            : "#64748b";
          // Black reads as grey on the dark background, so a black cord
          // draws as a dotted light-grey line — visible, and distinct
          // from a solid white cord.
          const isBlackCord = link.cordColor === "black";
          const selected = link.id === selectedLinkId;
          const label = drop ? dropDisplayNumber(drop) : "";
          return (
            <g
              key={link.id}
              onClick={() => onSelect(selected ? null : link.id)}
              style={{ cursor: "pointer" }}
              opacity={hoveredLinkId && link.id !== hoveredLinkId ? 0.15 : 1}
            >
              <title>
                {label || "No drop"} · {fromName}{" "}
                {link.fromPort} → {toName} / P{" "}
                {link.toPort}
                {link.cordLength ? ` · ${link.cordLength} ft` : ""}
                {link.cordColor ? ` · ${link.cordColor}` : ""}
              </title>
              {status === "tight" && (
                <path
                  d={`M ${a.x} ${a.y} C ${a.x} ${midY}, ${b.x} ${midY}, ${b.x} ${b.y}`}
                  fill="none"
                  stroke="#ef4444"
                  strokeWidth={8}
                  opacity={0.35}
                  strokeLinecap="round"
                />
              )}
              <path
                d={`M ${a.x} ${a.y} C ${a.x} ${midY}, ${b.x} ${midY}, ${b.x} ${b.y}`}
                fill="none"
                stroke={isBlackCord ? "#e5e7eb" : color}
                strokeDasharray={isBlackCord ? "0.1 7" : undefined}
                strokeWidth={selected || link.id === hoveredLinkId ? 4 : 2.5}
                strokeLinecap="round"
              />
              {selected && (
                <g>
                  <text
                    x={a.x}
                    y={a.y - 6}
                    fill="#e8eef4"
                    fontSize={9}
                    textAnchor="middle"
                  >
                    P {link.fromPort}
                  </text>
                  <text
                    x={b.x}
                    y={b.y + 16}
                    fill="#e8eef4"
                    fontSize={9}
                    textAnchor="middle"
                  >
                    P {link.toPort}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-ink-300 border-b border-white/10">
              <th className="py-1 pr-2 font-medium w-6" aria-label="Select row" />
              <th className="py-1 pr-2 font-medium">Drop</th>
              <th className="py-1 pr-2 font-medium">Device</th>
              <th className="py-1 pr-2 font-medium">{fromName} port</th>
              <th className="py-1 pr-2 font-medium">{toName} port</th>
              <th className="py-1 pr-2 font-medium">Run</th>
              <th className="py-1 pr-2 font-medium">Cord</th>
              <th className="py-1 pr-2 font-medium">Suggested</th>
              <th className="py-1 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {links.map(({ link, drop, run, suggested, status }) => (
              <tr
                key={link.id}
                className={`border-b border-white/5 cursor-pointer ${
                  link.id === selectedLinkId ? "bg-white/5" : ""
                } ${bulkIds.includes(link.id) ? "bg-amber-400/10" : ""}`}
                onClick={() =>
                  onSelect(link.id === selectedLinkId ? null : link.id)
                }
              >
                <td className="py-1 pr-2" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={bulkIds.includes(link.id)}
                    onChange={() => onToggleBulk(link.id)}
                    aria-label={`Select ${drop ? dropDisplayNumber(drop) : `port ${link.fromPort}`} for bulk apply`}
                  />
                </td>
                <td className="py-1 pr-2 font-mono text-ink-100">
                  {drop ? dropDisplayNumber(drop) : <span className="italic text-ink-300">—</span>}
                </td>
                <td className="py-1 pr-2 text-ink-100">
                  {drop?.deviceType?.trim() ? (
                    drop.deviceType
                  ) : (
                    <span className="italic text-ink-300">—</span>
                  )}
                </td>
                <td className="py-1 pr-2 text-ink-100">
                  {fromName} {link.fromPort}
                </td>
                <td className="py-1 pr-2 text-ink-100">
                  {toName} / P {link.toPort}
                </td>
                <td className="py-1 pr-2 text-ink-100">
                  ~{Math.round(run)}&Prime;
                </td>
                <td className="py-1 pr-2" onClick={(e) => e.stopPropagation()}>
                  <CordPickers
                    link={link}
                    onSetCord={(cord) => onSetCord(rack.id, link.id, cord)}
                  />
                </td>
                <td className="py-1 pr-2 text-ink-100">
                  {suggested !== undefined ? `${suggested} ft` : "no cord fits"}
                </td>
                <td className="py-1">
                  {status === "ok" ? (
                    <span className="text-green-400">OK</span>
                  ) : status === "tight" ? (
                    <span className="text-red-300 font-semibold">
                      TIGHT — strain
                    </span>
                  ) : (
                    <span className="italic text-ink-300">Set cord</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {portHover && (
        <div
          className="fixed z-20 pointer-events-none rounded-md border border-amber-400 bg-slate-950 px-2.5 py-2 text-xs leading-relaxed shadow-lg"
          style={{
            left: Math.min(portHover.x + 14, window.innerWidth - 280),
            top: Math.min(portHover.y + 14, window.innerHeight - 150),
          }}
        >
          <div className="text-[13px] font-bold text-ink-100">
            {portHover.side === "from" ? fromName : toName} ·{" "}
            {portHover.isSfp ? `SFP ${portHover.n}` : `Port ${portHover.n}`}
          </div>
          {portHover.isSfp ? (
            <div className="italic text-ink-300">SFP slot — no drop</div>
          ) : hoveredLink ? (
            <>
              <div className="text-ink-100">
                Drop:{" "}
                <b className="font-semibold">
                  {hoveredLink.drop
                    ? dropDisplayNumber(hoveredLink.drop)
                    : "—"}
                </b>
              </div>
              <div className="text-ink-100">
                Device:{" "}
                <b className="font-semibold">
                  {hoveredLink.drop?.deviceType?.trim()
                    ? hoveredLink.drop.deviceType
                    : "—"}
                </b>
              </div>
              <div className="text-ink-100">
                {portHover.side === "from" ? (
                  <>
                    Patches to:{" "}
                    <b className="font-semibold">
                      {toName} / P {hoveredLink.link.toPort}
                    </b>
                  </>
                ) : (
                  <>
                    From:{" "}
                    <b className="font-semibold">
                      {fromName} · Port {hoveredLink.link.fromPort}
                    </b>
                  </>
                )}
              </div>
              <div className="text-ink-100">
                Cord:{" "}
                <b className="font-semibold">
                  {hoveredLink.link.cordLength
                    ? `${hoveredLink.link.cordLength} ft`
                    : "not set"}
                  {hoveredLink.link.cordColor
                    ? ` · ${hoveredLink.link.cordColor}`
                    : ""}
                </b>
                {hoveredLink.status === "ok" ? (
                  <span className="text-green-400"> — OK</span>
                ) : hoveredLink.status === "tight" ? (
                  <span className="font-semibold text-red-300"> — TIGHT</span>
                ) : null}
              </div>
            </>
          ) : (
            <div className="italic text-ink-300">
              {portHover.side === "from"
                ? "No drop — not patched"
                : "No patch — free"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CordPickers({
  link,
  onSetCord,
}: {
  link: RackPatchLink;
  onSetCord: (cord: { length?: 1 | 3 | 5; color?: CordColor }) => void;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <select
        className="input !py-0.5 !px-1 text-xs w-[64px]"
        value={link.cordLength ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          onSetCord({ length: v === "" ? undefined : (Number(v) as 1 | 3 | 5) });
        }}
        aria-label="Cord length"
      >
        <option value="">— ft</option>
        {CORD_LENGTHS.map((len) => (
          <option key={len} value={len}>
            {len} ft
          </option>
        ))}
      </select>
      <select
        className="input !py-0.5 !px-1 text-xs w-[76px]"
        value={link.cordColor ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          onSetCord({ color: v === "" ? undefined : (v as CordColor) });
        }}
        aria-label="Cord color (VLAN)"
      >
        <option value="">— color</option>
        {CORD_COLORS.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </span>
  );
}

function DetailCard({
  rack,
  pair,
  enriched,
  onAssignDrop,
  onMovePatch,
  onSetCord,
  onRemovePatch,
}: {
  rack: Rack;
  pair: Pair;
  enriched: EnrichedLink;
  onAssignDrop: (
    rackId: string,
    placementId: string,
    port: number,
    dropId: string | undefined,
  ) => void;
  onMovePatch: (
    rackId: string,
    linkId: string,
    toPlacementId: string,
    toPort: number,
  ) => void;
  onSetCord: (
    rackId: string,
    linkId: string,
    cord: { length?: 1 | 3 | 5; color?: CordColor },
  ) => void;
  onRemovePatch: (linkId: string) => void;
}) {
  const { link, drop, run, suggested, status } = enriched;
  const { from, fromDev, to, toDev } = pair;

  // Panel ports with no drop on them (a patched port with no drop still
  // takes one) — plus the drop's current port.
  const dropPorts = useMemo(() => {
    const taken = new Set<number>();
    for (const l of rack.patchLinks ?? []) {
      if (l.fromPlacementId === from.id && l.dropId) taken.add(l.fromPort);
    }
    for (const d of rack.panelPortDrops ?? []) {
      if (d.placementId === from.id) taken.add(d.port);
    }
    return patchablePorts(fromDev).filter(
      (p) => !taken.has(p) || p === link.fromPort,
    );
  }, [rack, from, fromDev, link.fromPort]);

  const switches = useMemo(
    () =>
      rack.placements.filter((p) => {
        const d = rackDevicesById[p.deviceId];
        return d && d.category === "switch" && (d.frontPorts ?? 0) > 0;
      }),
    [rack],
  );
  const [moveSwitchId, setMoveSwitchId] = useState(to.id);
  useEffect(() => {
    setMoveSwitchId(to.id);
  }, [link.id, to.id]);
  const moveSwDev = moveSwitchId
    ? rackDevicesById[
        switches.find((p) => p.id === moveSwitchId)?.deviceId ?? ""
      ]
    : undefined;
  const movePorts = useMemo(() => {
    if (!moveSwDev) return [];
    const taken = new Set<number>();
    for (const l of rack.patchLinks ?? []) {
      if (l.toPlacementId === moveSwitchId && l.id !== link.id)
        taken.add(l.toPort);
    }
    // SFP slots never take a drop patch.
    return Array.from({ length: rj45Count(moveSwDev) }, (_, i) => i + 1).filter(
      (p) => !taken.has(p),
    );
  }, [rack, moveSwitchId, moveSwDev, link.id]);

  // The detail card stays glued to the bottom of the screen while a
  // cable is selected, so it is always in reach without scrolling down
  // to the bottom of the page. It settles into its natural spot at the
  // very bottom when scrolled all the way down.
  return (
    <div className="panel rounded-lg p-3 space-y-3 sticky bottom-0 z-10 shadow-[0_-8px_24px_rgba(0,0,0,0.45)]">
      <div className="flex items-baseline justify-between flex-wrap gap-1">
        <div className="label">
          {drop ? dropDisplayNumber(drop) : "No drop"}
          {drop?.deviceType?.trim() ? ` · ${drop.deviceType}` : ""}
        </div>
        <div className="text-xs text-ink-300">
          {placementPatchName(from, fromDev)} {link.fromPort} →{" "}
          {placementPatchName(to, toDev)} / P {link.toPort} · Run ~
          {Math.round(run)}&Prime; · Cord{" "}
          {link.cordLength ? `${link.cordLength} ft` : "—"}
          {link.cordColor ? ` · ${link.cordColor}` : ""} · Suggested{" "}
          {suggested !== undefined ? `${suggested} ft` : "no cord fits"} ·{" "}
          {status === "ok" ? (
            <span className="text-green-400">OK</span>
          ) : status === "tight" ? (
            <span className="text-red-300 font-semibold">TIGHT — strain</span>
          ) : (
            <span className="italic">no cord recorded</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {drop && (
          <Field label="Move drop to panel port">
            <select
              className="input"
              value={link.fromPort}
              onChange={(e) =>
                onAssignDrop(
                  rack.id,
                  from.id,
                  Number(e.target.value),
                  drop.id,
                )
              }
            >
              {dropPorts.map((p) => (
                <option key={p} value={p}>
                  {placementPatchName(from, fromDev)} {p}
                  {p === link.fromPort ? " (current)" : ""}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Move patch to switch">
          <select
            className="input"
            value={moveSwitchId}
            onChange={(e) => setMoveSwitchId(e.target.value)}
          >
            {switches.map((p) => {
              const d = rackDevicesById[p.deviceId]!;
              return (
                <option key={p.id} value={p.id}>
                  {placementPatchName(p, d)}
                  {p.id === to.id ? " (current)" : ""}
                </option>
              );
            })}
          </select>
        </Field>
        <Field label="Move patch to port">
          <select
            className="input"
            value=""
            onChange={(e) => {
              if (e.target.value === "") return;
              onMovePatch(rack.id, link.id, moveSwitchId, Number(e.target.value));
            }}
          >
            <option value="">Pick a port…</option>
            {movePorts.map((p) => (
              <option key={p} value={p}>
                {moveSwitchId === to.id && p === link.toPort
                  ? `P ${p} (current)`
                  : `P ${p}`}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex items-end gap-2">
        <Field label="Cord on this link">
          <CordPickers
            link={link}
            onSetCord={(cord) => onSetCord(rack.id, link.id, cord)}
          />
        </Field>
        {suggested !== undefined && link.cordLength !== suggested && (
          <button
            className="btn btn-sm"
            onClick={() =>
              onSetCord(rack.id, link.id, { length: suggested as 1 | 3 | 5 })
            }
          >
            Use suggested {suggested} ft
          </button>
        )}
        <button
          className="btn btn-sm text-signal-red"
          onClick={() => onRemovePatch(link.id)}
        >
          Remove this patch
        </button>
      </div>
    </div>
  );
}
