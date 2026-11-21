// Patch Panels view — assign drops to patched ports, one table per
// panel. The rack picker is where ports get patched; this tab is where
// the drops get attached: one drop per link, and picking a drop that is
// already on another link moves it here. Rows are the panel's patched
// ports only — patch a port in the Racks view first. The same links
// print on the elevation (Drop | Patch panel | Switch), so the tab, the
// rack, and the printout always agree.

import { useEffect, useMemo, useState } from "react";
import {
  useProjectStore,
  type Rack,
  type RackPatchLink,
} from "../store/projectStore";
import { rackDevicesById } from "../data/rackDevices";
import { allDropMarkups } from "../lib/dropLabels";
import {
  dropDisplayNumber,
  placementPatchName,
} from "./rackUtils";
import { Field } from "./RackProperties";

export function PatchPanelBuilder() {
  const project = useProjectStore((s) => s.project);
  const racks = project?.racks ?? [];
  const activeRackId = useProjectStore((s) => s.activeRackId);
  const setActiveRack = useProjectStore((s) => s.setActiveRack);
  const assignDrop = useProjectStore((s) => s.assignPatchLinkDrop);

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

  // Reset the panel pick when the rack changes.
  useEffect(() => {
    setPanelId("");
  }, [rack?.id]);

  const panel = panels.find((p) => p.id === panelId) ?? panels[0];
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
  // Which link each drop is currently on, so the dropdown can say so.
  const dropLink = useMemo(() => {
    const m = new Map<string, RackPatchLink>();
    for (const l of rack?.patchLinks ?? []) {
      if (l.dropId) m.set(l.dropId, l);
    }
    return m;
  }, [rack]);

  // Unassigned drops first — those are the ones still waiting for a port.
  const options = useMemo(
    () =>
      [...drops].sort((a, b) => {
        const au = dropLink.has(a.id) ? 1 : 0;
        const bu = dropLink.has(b.id) ? 1 : 0;
        if (au !== bu) return au - bu;
        return (a.number || "").localeCompare(b.number || "");
      }),
    [drops, dropLink],
  );

  const assignedCount = links.filter((l) => l.dropId).length;

  return (
    <div className="flex-1 overflow-auto workspace-grid">
      <div className="max-w-3xl mx-auto w-full p-6 space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-ink-50">Patch Panels</h1>
          <p className="text-xs text-ink-400 leading-relaxed">
            Attach a drop to each patched port. One drop per port — picking a
            drop that is already on another port moves it here. The table
            prints on the elevation as Drop | Patch panel | Switch.
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
                  {panels.map((p) => (
                    <option key={p.id} value={p.id}>
                      {placementPatchName(p, rackDevicesById[p.deviceId]!)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {panels.length === 0 ? (
              <div className="panel rounded-lg p-6 text-sm text-ink-300 text-center">
                This rack has no patch panels — add one in the Racks view first.
              </div>
            ) : !panel ? null : links.length === 0 ? (
              <div className="panel rounded-lg p-6 text-sm text-ink-300 text-center">
                No patched ports on{" "}
                {placementPatchName(panel, panelDev!)} yet — patch ports in the
                Racks view first, then come back here to attach drops.
              </div>
            ) : (
              <div className="panel rounded-lg p-3 space-y-2">
                <div className="flex items-baseline justify-between">
                  <div className="label">
                    {placementPatchName(panel, panelDev!)} — patched ports
                  </div>
                  <div className="text-[11px] text-ink-400">
                    {links.length} patched · {assignedCount} drops assigned
                  </div>
                </div>
                <div className="grid grid-cols-[64px_1fr_1fr] gap-2 items-center text-[11px] font-medium text-ink-400 px-1">
                  <span>Port</span>
                  <span>Drop</span>
                  <span>Switch</span>
                </div>
                {links.map((l) => {
                  const toP = rack.placements.find(
                    (p) => p.id === l.toPlacementId,
                  );
                  const toDev = toP
                    ? rackDevicesById[toP.deviceId]
                    : undefined;
                  const toName =
                    toP && toDev
                      ? `${placementPatchName(toP, toDev)} / P ${l.toPort}`
                      : "—";
                  return (
                    <div
                      key={l.id}
                      className="grid grid-cols-[64px_1fr_1fr] gap-2 items-center px-1 py-1 rounded-md hover:bg-white/5"
                    >
                      <span className="text-xs text-ink-100 font-mono">
                        Port {l.fromPort}
                      </span>
                      <select
                        className="input"
                        value={l.dropId ?? ""}
                        onChange={(e) =>
                          assignDrop(
                            rack.id,
                            l.id,
                            e.target.value || undefined,
                          )
                        }
                      >
                        <option value="">— no drop —</option>
                        {options.map((d) => {
                          const current = dropLink.get(d.id);
                          const suffix =
                            current && current.id !== l.id
                              ? ` — on ${currentLabel(current, rack)}`
                              : "";
                          return (
                            <option key={d.id} value={d.id}>
                              {dropDisplayNumber(d)}
                              {d.label && d.label !== d.number
                                ? ` (${d.label})`
                                : ""}
                              {suffix}
                            </option>
                          );
                        })}
                      </select>
                      <span className="text-xs text-ink-200">{toName}</span>
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
      </div>
    </div>
  );
}

/** Short "PP 2 Port 3" label for where a drop is currently patched. */
function currentLabel(link: RackPatchLink, rack: Rack): string {
  const p = rack.placements.find((x) => x.id === link.fromPlacementId);
  if (!p) return "";
  const dev = rackDevicesById[p.deviceId];
  if (!dev) return "";
  return `${placementPatchName(p, dev)} Port ${link.fromPort}`;
}
