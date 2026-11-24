// Patch Panels view — one table per panel, one row per port. A drop
// lands on a panel port first and the switch patch can come later, so
// every port is listed with two slots — Drop and Switch — and either
// can be filled first. One drop per port; picking a drop that is
// already on another port moves it here. The same rows print on the
// elevation (Drop | Patch panel | Switch), so the tab, the rack, and
// the printout always agree.

import { useEffect, useMemo, useState } from "react";
import { Pencil, X } from "lucide-react";
import {
  useProjectStore,
  type DropMarkup,
  type Rack,
} from "../store/projectStore";
import { rackDevicesById } from "../data/rackDevices";
import { allDropMarkups, normalizeDropNumber } from "../lib/dropLabels";
import {
  dropDisplayNumber,
  patchablePorts,
  placementPatchName,
} from "./rackUtils";
import { Field } from "./RackProperties";

export function PatchPanelBuilder() {
  const project = useProjectStore((s) => s.project);
  const racks = project?.racks ?? [];
  const activeRackId = useProjectStore((s) => s.activeRackId);
  const setActiveRack = useProjectStore((s) => s.setActiveRack);
  const assignDrop = useProjectStore((s) => s.assignPanelPortDrop);
  const setDeviceType = useProjectStore((s) => s.setDropDeviceType);
  const setDropNumber = useProjectStore((s) => s.setDropNumber);

  const [panelId, setPanelId] = useState("");

  const rack = racks.find((r) => r.id === activeRackId) ?? racks[0];
  const panels = useMemo(
    () =>
      (rack?.placements ?? []).filter((p) => {
        const d = rackDevicesById[p.deviceId];
        return d && d.category === "patch" && (d.frontPorts ?? 0) > 0;
      }),
    [rack],
  );

  // Patched-port count per panel — for the dropdown, the default panel
  // pick, and the empty state, so patched ports never look lost.
  const linkCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of rack?.patchLinks ?? []) {
      m.set(l.fromPlacementId, (m.get(l.fromPlacementId) ?? 0) + 1);
    }
    return m;
  }, [rack]);

  // Reset the panel pick when the rack changes.
  useEffect(() => {
    setPanelId("");
  }, [rack?.id]);

  const panel =
    panels.find((p) => p.id === panelId) ??
    panels.find((p) => (linkCounts.get(p.id) ?? 0) > 0) ??
    panels[0];
  const panelDev = panel ? rackDevicesById[panel.deviceId] : undefined;

  const links = useMemo(
    () =>
      (rack?.patchLinks ?? [])
        .filter((l) => l.fromPlacementId === panel?.id)
        .sort((a, b) => a.fromPort - b.fromPort),
    [rack, panel],
  );

  const drops = useMemo(
    () => (project ? allDropMarkups(project) : []),
    [project],
  );
  const dropById = useMemo(
    () => new Map(drops.map((d) => [d.id, d])),
    [drops],
  );

  // Every port on the selected panel — the table lists all of them, not
  // just the patched ones, because a drop lands on a port first and the
  // switch patch can come later.
  const ports = useMemo(
    () => (panelDev ? patchablePorts(panelDev) : []),
    [panelDev],
  );

  // The drop on each panel port, from either source: the link carries
  // it once the port is patched, a panelPortDrop holds it before that.
  const portDrop = useMemo(() => {
    const byPort = new Map<string, string>();
    const byDrop = new Map<string, { placementId: string; port: number }>();
    for (const d of rack?.panelPortDrops ?? []) {
      byPort.set(`${d.placementId}:${d.port}`, d.dropId);
      byDrop.set(d.dropId, { placementId: d.placementId, port: d.port });
    }
    for (const l of rack?.patchLinks ?? []) {
      if (!l.dropId) continue;
      byPort.set(`${l.fromPlacementId}:${l.fromPort}`, l.dropId);
      byDrop.set(l.dropId, {
        placementId: l.fromPlacementId,
        port: l.fromPort,
      });
    }
    return { byPort, byDrop };
  }, [rack]);

  const dropForPort = (port: number) =>
    panel ? portDrop.byPort.get(`${panel.id}:${port}`) : undefined;

  // Unassigned drops first — those are the ones still waiting for a port.
  const options = useMemo(
    () =>
      [...drops].sort((a, b) => {
        const au = portDrop.byDrop.has(a.id) ? 1 : 0;
        const bu = portDrop.byDrop.has(b.id) ? 1 : 0;
        if (au !== bu) return au - bu;
        return (a.number || "").localeCompare(b.number || "");
      }),
    [drops, portDrop],
  );

  const assignedCount = ports.filter(
    (p) => dropForPort(p) !== undefined,
  ).length;

  // Drops with no port yet — shown on this tab even before any port
  // is patched, so a fresh import never looks like it vanished.
  const unassigned = useMemo(
    () => options.filter((d) => !portDrop.byDrop.has(d.id)),
    [options, portDrop],
  );

  // Rename a drop's label in place (the LV crew's field label replaces
  // the planned one). The pencil swaps the dropdown for a text box:
  // Enter saves, Esc or clicking away cancels. A blank label or one
  // already used by another drop (case-insensitive) can't be saved.
  const [editingDropId, setEditingDropId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const startRename = (drop: DropMarkup) => {
    setEditingDropId(drop.id);
    setEditValue(dropDisplayNumber(drop));
    setEditError(null);
  };
  const cancelRename = () => {
    setEditingDropId(null);
    setEditError(null);
  };
  const saveRename = () => {
    if (!editingDropId) return;
    const drop = dropById.get(editingDropId);
    if (!drop) {
      cancelRename();
      return;
    }
    const next = editValue.trim();
    if (!next) {
      setEditError("Label can't be blank.");
      return;
    }
    if (
      normalizeDropNumber(next) !== normalizeDropNumber(drop.number) &&
      drops.some(
        (d) =>
          d.id !== drop.id &&
          normalizeDropNumber(d.number) === normalizeDropNumber(next),
      )
    ) {
      setEditError("That label is already used by another drop.");
      return;
    }
    if (next !== drop.number?.trim()) setDropNumber(drop.id, next);
    setEditingDropId(null);
    setEditError(null);
  };

  return (
    <div className="flex-1 overflow-auto workspace-grid">
      <div className="max-w-3xl mx-auto w-full p-6 space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-ink-50">Patch Panels</h1>
          <p className="text-xs text-ink-400 leading-relaxed">
            Attach a drop to a panel port, then patch the port to a switch
            — either order works. A drop on a port with no switch yet just
            waits there. One drop per port — picking a drop that is already
            on another port moves it here. Type the device on each drop
            (Inside Cam, POS, ATM…) — the export groups drops by switch
            and device type. The table prints on the elevation as Drop |
            Patch panel | Switch.
          </p>
        </div>

        {racks.length === 0 || !rack ? (
          <div className="panel rounded-lg p-6 text-sm text-ink-300 text-center">
            No racks yet — add a rack in the Racks view first.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Rack">
                <select
                  className="input"
                  value={rack.id}
                  onChange={(e) => setActiveRack(e.target.value || null)}
                >
                  {racks.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} · {r.uHeight}U
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Patch panel">
                <select
                  className="input"
                  value={panel?.id ?? ""}
                  onChange={(e) => setPanelId(e.target.value)}
                  disabled={panels.length === 0}
                >
                  {panels.map((p) => {
                    const n = linkCounts.get(p.id) ?? 0;
                    return (
                      <option key={p.id} value={p.id}>
                        {placementPatchName(p, rackDevicesById[p.deviceId]!)}
                        {n > 0 ? ` · ${n} patched` : ""}
                      </option>
                    );
                  })}
                </select>
              </Field>
            </div>

            {panels.length === 0 ? (
              <div className="panel rounded-lg p-6 text-sm text-ink-300 text-center">
                This rack has no patch panels — add one in the Racks view first.
              </div>
            ) : !panel ? null : (
              <div className="panel rounded-lg p-3 space-y-2">
                <div className="flex items-baseline justify-between">
                  <div className="label">
                    {placementPatchName(panel, panelDev!)} — {ports.length}{" "}
                    ports
                  </div>
                  <div className="text-[11px] text-ink-400">
                    {links.length} patched · {assignedCount} drops attached
                  </div>
                </div>
                <div className="grid grid-cols-[64px_1fr_150px_1fr] gap-2 items-center text-[11px] font-medium text-ink-400 px-1">
                  <span>Port</span>
                  <span>Drop</span>
                  <span>Device</span>
                  <span>Switch</span>
                </div>
                {ports.map((port) => {
                  const link = links.find((l) => l.fromPort === port);
                  const toP = link
                    ? rack.placements.find((p) => p.id === link.toPlacementId)
                    : undefined;
                  const toDev = toP
                    ? rackDevicesById[toP.deviceId]
                    : undefined;
                  const toName =
                    link && toP && toDev
                      ? `${placementPatchName(toP, toDev)} / P ${link.toPort}`
                      : "Not patched";
                  const dropId = dropForPort(port);
                  const assignedDrop = dropId
                    ? dropById.get(dropId)
                    : undefined;
                  return (
                    <div
                      key={port}
                      className="grid grid-cols-[64px_1fr_150px_1fr] gap-2 items-center px-1 py-1 rounded-md hover:bg-white/5"
                    >
                      <span className="text-xs text-ink-100 font-mono">
                        Port {port}
                      </span>
                      <div className="min-w-0">
                        {editingDropId === dropId ? (
                          <>
                            <div className="flex gap-1.5 items-center">
                              <input
                                className="input w-full font-mono"
                                value={editValue}
                                autoFocus
                                onFocus={(e) => e.target.select()}
                                onChange={(e) => {
                                  setEditValue(e.target.value);
                                  setEditError(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") saveRename();
                                  else if (e.key === "Escape") cancelRename();
                                }}
                                onBlur={() => cancelRename()}
                                aria-label="Rename drop"
                              />
                              <button
                                className="btn btn-sm shrink-0"
                                onClick={cancelRename}
                                aria-label="Cancel rename"
                                title="Cancel"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            {editError ? (
                              <div className="text-[11px] text-signal-red px-1 pt-0.5">
                                {editError}
                              </div>
                            ) : (
                              <div className="text-[11px] text-ink-400 px-1 pt-0.5">
                                Enter to save · Esc to cancel
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="flex gap-1.5 items-center">
                            <select
                              className="input w-full"
                              value={dropId ?? ""}
                              onChange={(e) =>
                                assignDrop(
                                  rack.id,
                                  panel.id,
                                  port,
                                  e.target.value || undefined,
                                )
                              }
                            >
                              <option value="">— no drop —</option>
                              {options.map((d) => {
                                const current = portDrop.byDrop.get(d.id);
                                const suffix =
                                  current &&
                                  !(
                                    current.placementId === panel.id &&
                                    current.port === port
                                  )
                                    ? ` — on ${portLabel(current.placementId, current.port, rack)}`
                                    : "";
                                return (
                                  <option key={d.id} value={d.id}>
                                    {dropDisplayNumber(d)}
                                    {d.label && d.label !== d.number
                                      ? ` (${d.label})`
                                      : ""}
                                    {d.notes?.trim() ? ` — ${d.notes.trim()}` : ""}
                                    {suffix}
                                  </option>
                                );
                              })}
                            </select>
                            {dropId && assignedDrop ? (
                              <button
                                className="btn btn-sm shrink-0"
                                onClick={() => startRename(assignedDrop)}
                                aria-label="Rename drop"
                                title="Rename this drop"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            ) : null}
                          </div>
                        )}
                        {assignedDrop?.notes?.trim() ? (
                          <div
                            className="text-[11px] text-ink-400 truncate px-1 pt-0.5"
                            title={assignedDrop.notes.trim()}
                          >
                            {assignedDrop.notes.trim()}
                          </div>
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        {dropId ? (
                          <input
                            className="input w-full"
                            value={assignedDrop?.deviceType ?? ""}
                            placeholder="Device type"
                            autoComplete="off"
                            spellCheck={false}
                            onChange={(e) =>
                              setDeviceType(dropId, e.target.value)
                            }
                          />
                        ) : (
                          <input
                            className="input w-full"
                            value=""
                            placeholder="—"
                            disabled
                          />
                        )}
                      </div>
                      <span
                        className={
                          link
                            ? "text-xs text-ink-200"
                            : "text-xs text-ink-400 italic"
                        }
                      >
                        {toName}
                      </span>
                    </div>
                  );
                })}
                {drops.length === 0 && (
                  <div className="text-[11px] text-ink-400 italic px-1 pt-1">
                    No drops in this project yet — import a plan or add drops
                    on a sheet first.
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {unassigned.length > 0 && (
          <div className="panel rounded-lg p-3 space-y-1">
            <div className="label">
              Unassigned drops — {unassigned.length} waiting for a port
            </div>
            <div className="text-xs text-ink-200 leading-relaxed">
              {unassigned.map((d) => (
                <span key={d.id} className="inline-block mr-3">
                  {editingDropId === d.id ? (
                    <span className="inline-flex gap-1 items-center align-middle">
                      <input
                        className="input font-mono !py-0.5 !px-1.5 text-xs w-32"
                        value={editValue}
                        autoFocus
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => {
                          setEditValue(e.target.value);
                          setEditError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveRename();
                          else if (e.key === "Escape") cancelRename();
                        }}
                        onBlur={() => cancelRename()}
                        aria-label="Rename drop"
                      />
                      <button
                        className="btn btn-sm shrink-0 !px-1.5"
                        onClick={cancelRename}
                        aria-label="Cancel rename"
                        title="Cancel"
                      >
                        <X className="w-3 h-3" />
                      </button>
                      {editError ? (
                        <span className="text-signal-red text-[11px]">
                          {editError}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <>
                      <span className="font-mono">{dropDisplayNumber(d)}</span>
                      <button
                        className="btn btn-sm shrink-0 !px-1.5 ml-1 align-middle"
                        onClick={() => startRename(d)}
                        aria-label={`Rename ${dropDisplayNumber(d)}`}
                        title="Rename this drop"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    </>
                  )}
                  {d.notes?.trim() ? (
                    <span className="text-ink-400"> — {d.notes.trim()}</span>
                  ) : null}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Short "PP Port 3" label for where a drop is currently attached. */
function portLabel(
  placementId: string,
  port: number,
  rack: Rack,
): string {
  const p = rack.placements.find((x) => x.id === placementId);
  if (!p) return "";
  const dev = rackDevicesById[p.deviceId];
  if (!dev) return "";
  return `${placementPatchName(p, dev)} Port ${port}`;
}
