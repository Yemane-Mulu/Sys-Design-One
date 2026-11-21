import { useEffect, useState } from "react";
import {
  useProjectStore,
  type Rack,
  type RackPlacement,
} from "../store/projectStore";
import { rackDevicesById } from "../data/rackDevices";
import {
  groupPatchLinks,
  patchGroupText,
  patchablePorts,
  placementPatchName,
} from "./rackUtils";
import { Field } from "./RackProperties";

interface Props {
  rack: Rack;
  onSelectPlacement: (id: string | null) => void;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Patch panel -> switch port mapping, scoped to this rack.
 * Click a panel port, then the switch port it patches to. Auto-map fills
 * 1:1 down the row; Map range patches a run of ports at once. The links
 * print on the elevation as a two-column table (one row per patched port),
 * using each placement's short name when set — e.g. "PP 1" -> "SW 1 / P 1".
 */
export function RackPatching({ rack, onSelectPlacement }: Props) {
  const addPatchLink = useProjectStore((s) => s.addPatchLink);
  const addPatchLinks = useProjectStore((s) => s.addPatchLinks);
  const removePatchLink = useProjectStore((s) => s.removePatchLink);

  const [panelId, setPanelId] = useState("");
  const [switchId, setSwitchId] = useState("");
  const [selPort, setSelPort] = useState<number | null>(null);
  const [showRange, setShowRange] = useState(false);
  const [rangeFrom, setRangeFrom] = useState("1");
  const [rangeTo, setRangeTo] = useState("12");
  const [rangeStart, setRangeStart] = useState("1");

  useEffect(() => {
    setPanelId("");
    setSwitchId("");
    setSelPort(null);
    setShowRange(false);
  }, [rack.id]);

  const links = rack.patchLinks ?? [];
  const panels = rack.placements.filter((p) => {
    const d = rackDevicesById[p.deviceId];
    return d && d.category === "patch" && (d.frontPorts ?? 0) > 0;
  });
  const switches = rack.placements.filter((p) => {
    const d = rackDevicesById[p.deviceId];
    return d && d.category === "switch" && (d.frontPorts ?? 0) > 0;
  });
  const panel = panels.find((p) => p.id === panelId) ?? panels[0];
  const sw = switches.find((p) => p.id === switchId) ?? switches[0];
  const panelDev = panel ? rackDevicesById[panel.deviceId] : undefined;
  const switchDev = sw ? rackDevicesById[sw.deviceId] : undefined;
  const panelPorts = panelDev ? patchablePorts(panelDev) : [];
  const switchPorts = switchDev ? patchablePorts(switchDev) : [];

  const linkForPanelPort = (port: number) =>
    links.find((l) => l.fromPlacementId === panel?.id && l.fromPort === port);
  const linkForSwitchPort = (port: number) =>
    links.find((l) => l.toPlacementId === sw?.id && l.toPort === port);
  const selLink = selPort !== null ? linkForPanelPort(selPort) : undefined;

  const onPanelPortClick = (port: number) => {
    setSelPort((cur) => (cur === port ? null : port));
  };

  const onSwitchPortClick = (port: number) => {
    if (!panel || !sw) return;
    if (selPort !== null) {
      addPatchLink(rack.id, {
        id: uid(),
        fromPlacementId: panel.id,
        fromPort: selPort,
        toPlacementId: sw.id,
        toPort: port,
      });
      setSelPort(null);
      return;
    }
    // No panel port selected: jump to the panel port patched to this one.
    const existing = linkForSwitchPort(port);
    if (existing) {
      setPanelId(existing.fromPlacementId);
      setSelPort(existing.fromPort);
      onSelectPlacement(existing.fromPlacementId);
    }
  };

  const autoMap = () => {
    if (!panel || !sw) return;
    const n = Math.min(panelPorts.length, switchPorts.length);
    addPatchLinks(
      rack.id,
      Array.from({ length: n }, (_, i) => ({
        id: uid(),
        fromPlacementId: panel.id,
        fromPort: i + 1,
        toPlacementId: sw.id,
        toPort: i + 1,
      })),
    );
  };

  const rangeValid = (() => {
    const f = parseInt(rangeFrom, 10);
    const t = parseInt(rangeTo, 10);
    const s = parseInt(rangeStart, 10);
    return (
      isFinite(f) && isFinite(t) && isFinite(s) &&
      f >= 1 && t >= f && t <= panelPorts.length &&
      s >= 1 && s + (t - f) <= switchPorts.length
    );
  })();

  const applyRange = () => {
    if (!panel || !sw || !rangeValid) return;
    const f = parseInt(rangeFrom, 10);
    const t = parseInt(rangeTo, 10);
    const s = parseInt(rangeStart, 10);
    addPatchLinks(
      rack.id,
      Array.from({ length: t - f + 1 }, (_, i) => ({
        id: uid(),
        fromPlacementId: panel.id,
        fromPort: f + i,
        toPlacementId: sw.id,
        toPort: s + i,
      })),
    );
    setShowRange(false);
  };

  const groups = groupPatchLinks(links);
  const byId = new Map(rack.placements.map((p) => [p.id, p]));

  return (
    <div className="panel rounded-lg p-3 space-y-2">
      <div className="label">Patching — panel → switch</div>
      {panels.length === 0 || switches.length === 0 ? (
        <div className="text-[11px] text-ink-400 italic leading-relaxed">
          Add a patch panel and a switch to this rack to start patching ports.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Patch panel">
              <select
                className="input"
                value={panel?.id ?? ""}
                onChange={(e) => {
                  setPanelId(e.target.value);
                  setSelPort(null);
                }}
              >
                {panels.map((p) => (
                  <option key={p.id} value={p.id}>
                    {placementPatchName(p, rackDevicesById[p.deviceId]!)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Switch">
              <select
                className="input"
                value={sw?.id ?? ""}
                onChange={(e) => setSwitchId(e.target.value)}
              >
                {switches.map((p) => (
                  <option key={p.id} value={p.id}>
                    {placementPatchName(p, rackDevicesById[p.deviceId]!)}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div>
            <div className="label mb-1">
              {panel ? placementPatchName(panel, panelDev!) : "Panel"} — ports
            </div>
            <div className="grid grid-cols-12 gap-1">
              {panelPorts.map((n) => (
                <PortCell
                  key={n}
                  n={n}
                  state={
                    selPort === n
                      ? "selected"
                      : linkForPanelPort(n)
                        ? "patched"
                        : "free"
                  }
                  onClick={() => onPanelPortClick(n)}
                />
              ))}
            </div>
          </div>

          <div>
            <div className="label mb-1">
              {sw ? placementPatchName(sw, switchDev!) : "Switch"} — ports
            </div>
            <div className="grid grid-cols-12 gap-1">
              {switchPorts.map((n) => (
                <PortCell
                  key={n}
                  n={n}
                  state={
                    selLink && selLink.toPort === n
                      ? "dest"
                      : linkForSwitchPort(n)
                        ? "patched"
                        : "free"
                  }
                  onClick={() => onSwitchPortClick(n)}
                />
              ))}
            </div>
          </div>

          <div className="text-[11px] text-ink-400 leading-relaxed">
            Click a panel port, then the switch port it patches to.
            {selPort !== null && !selLink && " Now pick its switch port."}
            {selLink && ` Port ${selPort} is patched to switch port ${selLink.toPort}.`}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button className="btn" onClick={autoMap}>
              Auto-map 1:1
            </button>
            <button className="btn" onClick={() => setShowRange((v) => !v)}>
              Map range…
            </button>
            {selLink && (
              <button
                className="btn text-signal-red"
                onClick={() => {
                  removePatchLink(rack.id, selLink.id);
                  setSelPort(null);
                }}
              >
                Remove this patch
              </button>
            )}
          </div>

          {showRange && (
            <div className="flex items-end gap-1.5">
              <Field label="Panel">
                <input
                  className="input font-mono w-14"
                  inputMode="numeric"
                  value={rangeFrom}
                  onChange={(e) => setRangeFrom(e.target.value)}
                />
              </Field>
              <span className="text-ink-400 text-xs pb-2">to</span>
              <Field label="Panel">
                <input
                  className="input font-mono w-14"
                  inputMode="numeric"
                  value={rangeTo}
                  onChange={(e) => setRangeTo(e.target.value)}
                />
              </Field>
              <Field label="Switch from">
                <input
                  className="input font-mono w-14"
                  inputMode="numeric"
                  value={rangeStart}
                  onChange={(e) => setRangeStart(e.target.value)}
                />
              </Field>
              <button className="btn-primary" disabled={!rangeValid} onClick={applyRange}>
                Apply
              </button>
            </div>
          )}

          {groups.length > 0 && (
            <div className="space-y-1 pt-1">
              <div className="label">Patched ({links.length})</div>
              {groups.map((g) => {
                const fromP = byId.get(g.fromPlacementId) as RackPlacement | undefined;
                const toP = byId.get(g.toPlacementId) as RackPlacement | undefined;
                if (!fromP || !toP) return null;
                const fromName = placementPatchName(fromP, rackDevicesById[fromP.deviceId]!);
                const toName = placementPatchName(toP, rackDevicesById[toP.deviceId]!);
                return (
                  <div key={`${g.fromPlacementId}->${g.toPlacementId}`} className="flex items-start justify-between gap-2">
                    <span className="text-[11px] text-ink-200 leading-snug">
                      {patchGroupText(g, fromName, toName)}
                    </span>
                    <button
                      className="text-[11px] text-signal-red hover:underline shrink-0"
                      onClick={() => {
                        for (const l of links.filter(
                          (x) =>
                            x.fromPlacementId === g.fromPlacementId &&
                            x.toPlacementId === g.toPlacementId,
                        )) {
                          removePatchLink(rack.id, l.id);
                        }
                      }}
                    >
                      Unpatch
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PortCell({
  n,
  state,
  onClick,
}: {
  n: number;
  state: "free" | "patched" | "selected" | "dest";
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={`Port ${n}`}
      className={`aspect-square rounded-[3px] text-[9px] font-mono flex items-center justify-center border transition-colors ${
        state === "patched"
          ? "bg-amber-knox text-midnight border-amber-knox font-bold"
          : state === "selected"
            ? "border-2 border-[#4FB7FF] text-ink-50"
            : state === "dest"
              ? "border-2 border-[#2BD37C] text-ink-50"
              : "bg-ink-700/60 border-white/5 text-ink-400 hover:border-white/20"
      }`}
    >
      {n}
    </button>
  );
}
