// Cable View — one picture per panel -> switch pair, one cable per patch.
// The panel and the switch are drawn where they sit in the rack, so a
// long run is visible before the cord goes on: the run is the distance
// between the two device centers (1U = 1.75") plus 6" for the bend and
// slack. A cable is TIGHT when the cord on it is shorter than the run
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
  suggestedCordLength,
  type CordColor,
} from "./rackUtils";
import { Field } from "./RackProperties";

const CORD_HEX: Record<CordColor, string> = {
  red: "#ef4444",
  amber: "#f59e0b",
  green: "#22c55e",
  // Black cords read as grey on the dark background.
  black: "#9ca3af",
  purple: "#a855f7",
};

interface EnrichedLink {
  link: RackPatchLink;
  drop: DropMarkup | undefined;
  run: number;
  suggested: number | undefined;
  status: "ok" | "tight" | "unset";
}

interface Pair {
  panel: RackPlacement;
  panelDev: RackDeviceType;
  sw: RackPlacement;
  swDev: RackDeviceType;
  links: EnrichedLink[];
  tight: number;
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
 *  from x=180; SFP slots sit past the RJ45 block. */
function portPoint(
  dev: RackDeviceType,
  barY: number,
  port: number,
): { x: number; y: number } {
  const groups = dev.faceplate?.ports ?? [];
  const rj = groups[0];
  const rjN = rj?.count ?? dev.frontPorts ?? 0;
  if (port <= rjN && rj) {
    const perRow = Math.ceil(rj.count / (rj.rows ?? 1));
    const col = (port - 1) % perRow;
    const row = Math.floor((port - 1) / perRow);
    return { x: 186 + col * 24, y: barY + 12 + row * 18 };
  }
  const perRow = Math.ceil((rj?.count ?? 0) / (rj?.rows ?? 1));
  const sfpX = 180 + perRow * 24 + 14;
  const idx = port - rjN - 1;
  return { x: sfpX + idx * 20 + 7, y: barY + 22 };
}

function DeviceBar({
  p,
  dev,
  y,
}: {
  p: RackPlacement;
  dev: RackDeviceType;
  y: number;
}) {
  const rj = dev.faceplate?.ports?.[0];
  const rjN = rj?.count ?? dev.frontPorts ?? 0;
  const perRow = Math.ceil(rjN / (rj?.rows ?? 1));
  const rows = rj?.rows ?? 1;
  const sfp = dev.faceplate?.ports?.[1];
  const sfpX = 180 + perRow * 24 + 14;
  const ports: { x: number; y: number; key: string }[] = [];
  for (let i = 0; i < rjN; i++) {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    ports.push({ x: 180 + col * 24, y: y + 6 + row * 18, key: `p${i + 1}` });
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
      {ports.map((pt) => (
        <rect
          key={pt.key}
          x={pt.x}
          y={pt.y}
          width={12}
          height={12}
          fill="#0b1220"
          stroke="#5b6b80"
        />
      ))}
      {sfp && (
        <g>
          {Array.from({ length: sfp.count }, (_, s) => (
            <rect
              key={s}
              x={sfpX + s * 20}
              y={y + 15}
              width={14}
              height={14}
              fill="#0b1220"
              stroke="#f59e0b"
            />
          ))}
          <text x={sfpX} y={y + 42} fill="#8b9bb0" fontSize={9}>
            SFP
          </text>
        </g>
      )}
      {/* Row numbers on the RJ45 block ends. */}
      <text x={186} y={y + 4} fill="#5b6b80" fontSize={8} textAnchor="middle">
        1
      </text>
      <text
        x={186 + (perRow - 1) * 24}
        y={y + 4}
        fill="#5b6b80"
        fontSize={8}
        textAnchor="middle"
      >
        {perRow}
      </text>
      {rows > 1 && (
        <text
          x={186}
          y={y + 4 + (rows - 1) * 18}
          fill="#5b6b80"
          fontSize={8}
          textAnchor="middle"
        >
          {perRow + 1}
        </text>
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
  const setCord = useProjectStore((s) => s.setPatchLinkCord);

  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);

  const rack = racks.find((r) => r.id === activeRackId) ?? racks[0];

  useEffect(() => {
    setSelectedLinkId(null);
  }, [rack?.id]);

  const drops = useMemo(
    () => (project ? allDropMarkups(project) : []),
    [project],
  );
  const dropById = useMemo(
    () => new Map(drops.map((d) => [d.id, d])),
    [drops],
  );

  const pairs = useMemo<Pair[]>(() => {
    if (!rack) return [];
    const byId = new Map(rack.placements.map((p) => [p.id, p]));
    const groups = new Map<string, Pair>();
    for (const link of rack.patchLinks ?? []) {
      const panel = byId.get(link.fromPlacementId);
      const sw = byId.get(link.toPlacementId);
      if (!panel || !sw) continue;
      const panelDev = rackDevicesById[panel.deviceId];
      const swDev = rackDevicesById[sw.deviceId];
      if (!panelDev || !swDev) continue;
      if (panelDev.category !== "patch" || swDev.category !== "switch")
        continue;
      const key = `${link.fromPlacementId}->${link.toPlacementId}`;
      let pair = groups.get(key);
      if (!pair) {
        pair = { panel, panelDev, sw, swDev, links: [], tight: 0 };
        groups.set(key, pair);
      }
      const run = patchCordRunInches(panel, panelDev, sw, swDev);
      const status = cordStatus(run, link.cordLength);
      if (status === "tight") pair.tight++;
      pair.links.push({
        link,
        drop: link.dropId ? dropById.get(link.dropId) : undefined,
        run,
        suggested: suggestedCordLength(run),
        status,
      });
    }
    const out = [...groups.values()];
    for (const p of out) p.links.sort((a, b) => a.link.fromPort - b.link.fromPort);
    // Top of the rack first.
    out.sort((a, b) => b.panel.uSlot - a.panel.uSlot);
    return out;
  }, [rack, dropById]);

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
            One picture per panel → switch pair, one cable per patch. Run is
            the distance between the device centers (1U = 1.75&Prime;) plus
            6&Prime; for the bend and slack. A cable is tight when the cord on
            it is shorter than the run. Color is the VLAN, length is separate.
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

      {pairs.length === 0 ? (
        <div className="panel rounded-lg p-6 text-sm text-ink-300 text-center">
          No patches yet — patch a panel to a switch on the Patch Panels tab
          and the cables will show up here.
        </div>
      ) : (
        pairs.map((pair) => (
          <PairSection
            key={`${pair.panel.id}->${pair.sw.id}`}
            rack={rack}
            pair={pair}
            selectedLinkId={selectedLinkId}
            onSelect={setSelectedLinkId}
            onSetCord={setCord}
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
        />
      )}
    </div>
  );
}

function PairSection({
  rack,
  pair,
  selectedLinkId,
  onSelect,
  onSetCord,
}: {
  rack: Rack;
  pair: Pair;
  selectedLinkId: string | null;
  onSelect: (id: string | null) => void;
  onSetCord: (
    rackId: string,
    linkId: string,
    cord: { length?: 1 | 3 | 5; color?: CordColor },
  ) => void;
}) {
  const { panel, panelDev, sw, swDev, links } = pair;
  const gapU = Math.abs(
    (panel.uSlot + (placementUHeight(panel, panelDev) - 1) / 2) -
      (sw.uSlot + (placementUHeight(sw, swDev) - 1) / 2),
  );
  const panelY = 24;
  const switchY = panelY + 120 + Math.round(gapU * 8);
  const height = switchY + 78;

  return (
    <div className="panel rounded-lg p-3 space-y-3">
      <div className="flex items-baseline justify-between flex-wrap gap-1">
        <div className="label">
          {placementPatchName(panel, panelDev)} →{" "}
          {placementPatchName(sw, swDev)}
          <span className="ml-2 font-normal text-ink-300">
            {panelDev.label} · {swDev.model ? `${swDev.model} · ` : ""}
            {uRange(panel, panelDev)} → {uRange(sw, swDev)} · {gapU % 1 === 0 ? gapU : gapU.toFixed(1)}U apart
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

      <svg
        viewBox={`0 0 900 ${height}`}
        className="w-full"
        role="img"
        aria-label={`${placementPatchName(panel, panelDev)} to ${placementPatchName(sw, swDev)} cables`}
      >
        <DeviceBar p={panel} dev={panelDev} y={panelY} />
        <DeviceBar p={sw} dev={swDev} y={switchY} />
        {links.map(({ link, drop, status }) => {
          const a = portPoint(panelDev, panelY, link.fromPort);
          const b = portPoint(swDev, switchY, link.toPort);
          const midY = (a.y + b.y) / 2;
          const midX = (a.x + b.x) / 2;
          const color = link.cordColor
            ? CORD_HEX[link.cordColor]
            : "#64748b";
          const selected = link.id === selectedLinkId;
          const label = drop ? dropDisplayNumber(drop) : "";
          return (
            <g
              key={link.id}
              onClick={() => onSelect(selected ? null : link.id)}
              style={{ cursor: "pointer" }}
            >
              <title>
                {label || "No drop"} · {placementPatchName(panel, panelDev)}{" "}
                {link.fromPort} → {placementPatchName(sw, swDev)} / P{" "}
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
                stroke={color}
                strokeWidth={selected ? 4 : 2.5}
                strokeLinecap="round"
              />
              {label && (
                <text
                  x={midX}
                  y={midY - 5}
                  fill={color}
                  fontSize={9}
                  textAnchor="middle"
                >
                  {label}
                </text>
              )}
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
              <th className="py-1 pr-2 font-medium">Drop</th>
              <th className="py-1 pr-2 font-medium">Device</th>
              <th className="py-1 pr-2 font-medium">Panel port</th>
              <th className="py-1 pr-2 font-medium">Switch port</th>
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
                }`}
                onClick={() =>
                  onSelect(link.id === selectedLinkId ? null : link.id)
                }
              >
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
                  {placementPatchName(panel, panelDev)} {link.fromPort}
                </td>
                <td className="py-1 pr-2 text-ink-100">
                  {placementPatchName(sw, swDev)} / P {link.toPort}
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
}) {
  const { link, drop, run, suggested, status } = enriched;
  const { panel, panelDev, sw, swDev } = pair;

  // Panel ports with no drop on them (a patched port with no drop still
  // takes one) — plus the drop's current port.
  const dropPorts = useMemo(() => {
    const taken = new Set<number>();
    for (const l of rack.patchLinks ?? []) {
      if (l.fromPlacementId === panel.id && l.dropId) taken.add(l.fromPort);
    }
    for (const d of rack.panelPortDrops ?? []) {
      if (d.placementId === panel.id) taken.add(d.port);
    }
    return patchablePorts(panelDev).filter(
      (p) => !taken.has(p) || p === link.fromPort,
    );
  }, [rack, panel, panelDev, link.fromPort]);

  const switches = useMemo(
    () =>
      rack.placements.filter((p) => {
        const d = rackDevicesById[p.deviceId];
        return d && d.category === "switch" && (d.frontPorts ?? 0) > 0;
      }),
    [rack],
  );
  const [moveSwitchId, setMoveSwitchId] = useState(sw.id);
  useEffect(() => {
    setMoveSwitchId(sw.id);
  }, [link.id, sw.id]);
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

  return (
    <div className="panel rounded-lg p-3 space-y-3">
      <div className="flex items-baseline justify-between flex-wrap gap-1">
        <div className="label">
          {drop ? dropDisplayNumber(drop) : "No drop"}
          {drop?.deviceType?.trim() ? ` · ${drop.deviceType}` : ""}
        </div>
        <div className="text-xs text-ink-300">
          {placementPatchName(panel, panelDev)} {link.fromPort} →{" "}
          {placementPatchName(sw, swDev)} / P {link.toPort} · Run ~
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
                  panel.id,
                  Number(e.target.value),
                  drop.id,
                )
              }
            >
              {dropPorts.map((p) => (
                <option key={p} value={p}>
                  {placementPatchName(panel, panelDev)} {p}
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
                  {p.id === sw.id ? " (current)" : ""}
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
                {moveSwitchId === sw.id && p === link.toPort
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
      </div>
    </div>
  );
}
