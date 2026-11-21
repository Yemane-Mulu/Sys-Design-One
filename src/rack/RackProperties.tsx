import { useMemo } from "react";
import {
  useProjectStore,
  selectActiveRack,
  type Rack,
  type RackPlacement,
} from "../store/projectStore";
import { rackDevicesById } from "../data/rackDevices";
import {
  canFitAt,
  isShelfDevice,
  occupiedUSlots,
  placementHasShelf,
  placementUHeight,
  placementWidth,
} from "./rackUtils";
import { RackPatching } from "./RackPatching";
import { Trash2, Server } from "lucide-react";

interface Props {
  selectedPlacementId: string | null;
  onSelectPlacement: (id: string | null) => void;
}

export function RackProperties({ selectedPlacementId, onSelectPlacement }: Props) {
  const rack = useProjectStore(selectActiveRack);
  const project = useProjectStore((s) => s.project);
  const updateRack = useProjectStore((s) => s.updateRack);
  const updatePlacement = useProjectStore((s) => s.updatePlacement);
  const removePlacement = useProjectStore((s) => s.removePlacement);
  const removeRack = useProjectStore((s) => s.removeRack);

  const totals = useMemo(() => {
    if (!rack) return null;
    // "Used" counts each occupied U once — two half-width devices sharing
    // a U row still only use that U once.
    const usedU = occupiedUSlots(rack).size;
    let watts = 0;
    let weight = 0;
    let cost = 0;
    for (const p of rack.placements) {
      const d = rackDevicesById[p.deviceId];
      if (!d) continue;
      watts += d.powerWatts;
      weight += d.weightLbs;
      cost += p.costOverride ?? d.defaultCost;
    }
    return { usedU, watts, weight, cost, freeU: rack.uHeight - usedU };
  }, [rack]);

  const placement = useMemo<RackPlacement | null>(() => {
    if (!rack || !selectedPlacementId) return null;
    return rack.placements.find((p) => p.id === selectedPlacementId) ?? null;
  }, [rack, selectedPlacementId]);

  if (!rack) {
    return (
      <aside className="w-72 shrink-0 border-l border-white/5 bg-ink-800/60 backdrop-blur-md flex items-center justify-center text-xs text-ink-400 px-4 text-center">
        No rack selected. Create one from the toolbar.
      </aside>
    );
  }

  return (
    <aside className="w-72 shrink-0 border-l border-white/5 bg-ink-800/60 backdrop-blur-md flex flex-col">
      <div className="px-3 py-2.5 border-b border-white/5 flex items-center justify-between">
        <div className="label">Rack Properties</div>
        <Server className="w-3.5 h-3.5 text-amber-knox" />
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {placement ? (
          <PlacementEditor
            key={placement.id}
            rack={rack}
            placement={placement}
            onChange={(p) => updatePlacement(rack.id, placement.id, p)}
            onDelete={() => {
              removePlacement(rack.id, placement.id);
              onSelectPlacement(null);
            }}
            onClose={() => onSelectPlacement(null)}
          />
        ) : (
          <>
            <Field label="Rack Name">
              <input
                className="input"
                value={rack.name}
                onChange={(e) => updateRack(rack.id, { name: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="U Height">
                <select
                  className="input"
                  value={rack.uHeight}
                  onChange={(e) =>
                    updateRack(rack.id, { uHeight: parseInt(e.target.value, 10) })
                  }
                >
                  {[12, 18, 22, 24, 27, 32, 36, 42, 45, 48].map((u) => (
                    <option key={u} value={u}>
                      {u}U
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Sheet Link">
                <select
                  className="input"
                  value={rack.associatedSheetId ?? ""}
                  onChange={(e) =>
                    updateRack(rack.id, {
                      associatedSheetId: e.target.value || undefined,
                    })
                  }
                >
                  <option value="">— none —</option>
                  {project?.sheets.map((sh) => (
                    <option key={sh.id} value={sh.id}>
                      {sh.sheetNumber || ""} {sh.sheetTitle || sh.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Location">
              <input
                className="input"
                placeholder="e.g. Equipment Room 102"
                value={rack.location ?? ""}
                onChange={(e) =>
                  updateRack(rack.id, { location: e.target.value })
                }
              />
            </Field>

            {totals && (
              <div className="panel rounded-lg p-3 space-y-2">
                <div className="label">Totals</div>
                <Stat label="Used" value={`${totals.usedU} / ${rack.uHeight} U`} accent={totals.usedU > rack.uHeight} />
                <Stat label="Free" value={`${totals.freeU} U`} />
                <Stat label="Power" value={`${totals.watts} W`} />
                <Stat label="Weight" value={`${totals.weight} lb`} />
                <Stat label="Material" value={usd(totals.cost)} />
              </div>
            )}

            <div className="panel rounded-lg p-3 space-y-1">
              <div className="label mb-1">Placements ({rack.placements.length})</div>
              {rack.placements.length === 0 && (
                <div className="text-[11px] text-ink-400 italic">
                  Drag devices from the left palette into the rack.
                </div>
              )}
              {rack.placements
                .slice()
                .sort((a, b) => b.uSlot - a.uSlot)
                .map((p) => {
                  const d = rackDevicesById[p.deviceId];
                  if (!d) return null;
                  const effH = placementUHeight(p, d);
                  const w = placementWidth(p);
                  return (
                    <div
                      key={p.id}
                      className="flex items-center gap-2 px-1 py-1 rounded hover:bg-white/5 cursor-pointer"
                      onClick={() => onSelectPlacement(p.id)}
                    >
                      <span className="text-[10px] font-mono text-amber-knox tabular-nums w-12">
                        U{p.uSlot}
                        {effH > 1 ? `–${p.uSlot + effH - 1}` : ""}
                      </span>
                      <span className="text-xs text-ink-100 truncate flex-1">
                        {d.label}
                      </span>
                      <span className="text-[10px] font-mono text-ink-400">
                        {effH}U{w === "half" ? ` · ½ ${p.side ?? "left"}` : ""}
                      </span>
                    </div>
                  );
                })}
            </div>

            <button
              onClick={() => {
                if (confirm(`Delete rack "${rack.name}"?`)) {
                  removeRack(rack.id);
                }
              }}
              className="btn w-full justify-center text-signal-red hover:bg-signal-red/10"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete this rack
            </button>
          </>
        )}

        <RackPatching rack={rack} onSelectPlacement={onSelectPlacement} />
      </div>
    </aside>
  );
}

function PlacementEditor({
  rack,
  placement,
  onChange,
  onDelete,
  onClose,
}: {
  rack: Rack;
  placement: RackPlacement;
  onChange: (p: Partial<RackPlacement>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const dev = rackDevicesById[placement.deviceId];
  if (!dev) return null;
  const effH = placementUHeight(placement, dev);
  const width = placementWidth(placement);
  const side = placement.side ?? "left";
  const hasShelf = placementHasShelf(rack, placement);
  const heightOptions = dev.variableHeight
    ? Array.from(
        { length: dev.variableHeight.max - dev.variableHeight.min + 1 },
        (_, i) => dev.variableHeight!.min + i,
      )
    : null;
  const fits = (h: number, w: "full" | "half", s: "left" | "right") =>
    canFitAt(rack, placement.uSlot, h, w, s, placement.id);
  // Nearest shelf below the device this half-width device can snap onto.
  const snapSlot = (() => {
    if (width !== "half" || hasShelf) return null;
    const tops = rack.placements
      .filter((p) => p.id !== placement.id)
      .map((p) => {
        const sd = rackDevicesById[p.deviceId];
        return sd && isShelfDevice(sd)
          ? p.uSlot + placementUHeight(p, sd) - 1
          : null;
      })
      .filter((t): t is number => t !== null)
      .sort((a, b) => b - a);
    for (const topU of tops) {
      const slot = topU + 1;
      if (canFitAt(rack, slot, effH, "half", side, placement.id)) return slot;
    }
    return null;
  })();
  return (
    <>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-amber-knox font-mono">
            U{placement.uSlot}
            {effH > 1 ? `–${placement.uSlot + effH - 1}` : ""}
          </div>
          <div className="text-sm font-semibold text-ink-100 leading-tight">
            {dev.label}
          </div>
          <div className="text-[10px] font-mono text-ink-400">
            {dev.manufacturer}
            {dev.model ? ` · ${dev.model}` : ""} · {effH}U
            {width === "half" ? ` · ½ ${side}` : ""}
          </div>
        </div>
        <button onClick={onClose} className="btn-ghost text-ink-400">×</button>
      </div>

      <Field label="U Slot (bottom of device)">
        <input
          className="input font-mono"
          inputMode="numeric"
          value={placement.uSlot}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (isFinite(v)) onChange({ uSlot: v });
          }}
        />
      </Field>

      {dev.halfWidth && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Width">
            <select
              className="input"
              value={width}
              onChange={(e) =>
                onChange(
                  e.target.value === "half"
                    ? { width: "half", side }
                    : { width: "full", side: undefined },
                )
              }
            >
              <option value="full" disabled={!fits(effH, "full", "left")}>
                Full width
              </option>
              <option value="half">Half width</option>
            </select>
          </Field>
          {width === "half" && (
            <Field label="Side">
              <select
                className="input"
                value={side}
                onChange={(e) =>
                  onChange({ side: e.target.value as "left" | "right" })
                }
              >
                <option value="left" disabled={!fits(effH, "half", "left")}>
                  Left
                </option>
                <option value="right" disabled={!fits(effH, "half", "right")}>
                  Right
                </option>
              </select>
            </Field>
          )}
        </div>
      )}

      {heightOptions && (
        <Field label="Height">
          <select
            className="input"
            value={placement.uHeightOverride ?? dev.uHeight}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              onChange({ uHeightOverride: v === dev.uHeight ? undefined : v });
            }}
          >
            {heightOptions.map((h) => (
              <option key={h} value={h} disabled={!fits(h, width, side)}>
                {h}U
              </option>
            ))}
          </select>
        </Field>
      )}

      {width === "half" && !hasShelf && (
        <div className="rounded-lg border border-amber-knox/40 bg-amber-knox/10 p-3 text-xs space-y-2">
          <div className="text-amber-knox font-medium">
            No shelf under this device
          </div>
          <div className="text-ink-300">
            Half-width devices sit on a shelf.{" "}
            {placement.uSlot > 1
              ? `Place a shelf at U${placement.uSlot - 1} under it.`
              : "Move it up — it needs a shelf under it."}
          </div>
          {snapSlot !== null && (
            <button
              className="btn"
              onClick={() => onChange({ uSlot: snapSlot })}
            >
              Snap onto shelf (U{snapSlot})
            </button>
          )}
        </div>
      )}
      <Field label="Asset Tag / Label">
        <input
          className="input"
          placeholder="e.g. SW-CORE-01"
          value={placement.label ?? ""}
          onChange={(e) => onChange({ label: e.target.value || undefined })}
        />
      </Field>
      {(dev.category === "patch" || dev.category === "switch") && (
        <Field label="Short name (patch table)">
          <input
            className="input"
            placeholder={dev.category === "patch" ? "e.g. PP" : "e.g. SW 1"}
            value={placement.shortName ?? ""}
            onChange={(e) =>
              onChange({ shortName: e.target.value || undefined })
            }
          />
        </Field>
      )}
      <Field label={`Cost Override (default $${dev.defaultCost.toLocaleString()})`}>
        <input
          className="input"
          inputMode="decimal"
          value={placement.costOverride ?? ""}
          placeholder={dev.defaultCost.toString()}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            onChange({ costOverride: isFinite(v) ? v : undefined });
          }}
        />
      </Field>
      <Field label="Notes">
        <textarea
          className="input min-h-[60px]"
          placeholder="Internal notes (not exported)"
          value={placement.notes ?? ""}
          onChange={(e) => onChange({ notes: e.target.value })}
        />
      </Field>

      <div className="panel rounded-lg p-3 space-y-1.5 text-xs">
        <Stat label="Power" value={`${dev.powerWatts} W`} />
        <Stat label="Weight" value={`${dev.weightLbs} lb`} />
        <Stat label="Front Ports" value={`${dev.frontPorts ?? 0}`} />
        <Stat label="Labor" value={`${dev.laborHours} hr`} />
      </div>

      <button
        onClick={onDelete}
        className="btn w-full justify-center text-signal-red hover:bg-signal-red/10"
      >
        <Trash2 className="w-3.5 h-3.5" />
        Remove from rack
      </button>
    </>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label mb-1">{label}</div>
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-ink-300">{label}</span>
      <span className={`font-mono tabular-nums ${accent ? "text-signal-red" : "text-ink-100"}`}>
        {value}
      </span>
    </div>
  );
}

function usd(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}
