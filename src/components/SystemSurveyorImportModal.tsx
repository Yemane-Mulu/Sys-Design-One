// Review modal for the no-AI System Surveyor import.
//
// After a client PDF uploads, the parser reads the report's BOM /
// Element Report tables (plain text, no AI) and proposes drops plus a
// rack sized from the counts. Nothing is created until the user
// confirms here: drops stage in a row on the first sheet (drag each to
// its spot — the tables carry rooms, not coordinates), and a rack is
// built from the generic defaults with the panels/switches the port
// count calls for.

import { useEffect, useMemo, useRef, useState } from "react";
import { X, FileDown, Server, Camera, Plug, Wifi, HardDrive, Box, Trash2 } from "lucide-react";
import {
  useProjectStore,
  type DropMarkup,
  type DropService,
} from "../store/projectStore";
import {
  analyzeSurveyorPage,
  buildSurveyorRackPlacements,
  extractSurveyorText,
  parseSurveyorPages,
  planRackForSurveyor,
  renderSurveyorPageImage,
  visionProposalForAssignments,
  visionServiceFor,
  VISION_DEVICE_TYPES,
  type SurveyorItem,
  type SurveyorKind,
  type SurveyorProposal,
  type VisionDeviceType,
  type VisionKeyEntry,
} from "../lib/systemSurveyor";

const uid = () => Math.random().toString(36).slice(2, 10);

const KIND_LABEL: Record<SurveyorKind, string> = {
  camera: "Cameras",
  drop: "Data drops",
  switch: "Switches",
  nvr: "Recorders",
  ap: "Access points",
  other: "Other devices",
};

const KIND_ICON: Record<SurveyorKind, React.ReactNode> = {
  camera: <Camera className="w-3.5 h-3.5" />,
  drop: <Plug className="w-3.5 h-3.5" />,
  switch: <Server className="w-3.5 h-3.5" />,
  nvr: <HardDrive className="w-3.5 h-3.5" />,
  ap: <Wifi className="w-3.5 h-3.5" />,
  other: <Box className="w-3.5 h-3.5" />,
};

/** One label the vision read off the plan, awaiting a device type. */
interface VisionRow {
  id: string;
  text: string;
  x: number;
  y: number;
  type: VisionDeviceType | "Skip" | "";
}

/** Drop service for a proposed item kind — cameras and APs ride PoE. */
function serviceFor(kind: SurveyorKind): DropService {
  if (kind === "camera") return "camera";
  if (kind === "ap") return "poe";
  return "data";
}

export function SystemSurveyorImportModal() {
  const imp = useProjectStore((s) => s.surveyorImport);
  const setSurveyorImport = useProjectStore((s) => s.setSurveyorImport);
  const [phase, setPhase] = useState<
    "reading" | "ready" | "error" | "vision-reading" | "vision-review" | "vision-error"
  >("reading");
  const [proposal, setProposal] = useState<SurveyorProposal | null>(null);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // Vision review state — labels the model read, each awaiting a type.
  const bytesRef = useRef<Uint8Array | null>(null);
  const [visionImage, setVisionImage] = useState<string | null>(null);
  const [visionRows, setVisionRows] = useState<VisionRow[]>([]);
  const [visionKey, setVisionKey] = useState<VisionKeyEntry[]>([]);
  const [visionError, setVisionError] = useState<string | null>(null);

  const close = () => setSurveyorImport(null);

  useEffect(() => {
    if (!imp) return;
    setPhase("reading");
    setProposal(null);
    setVisionImage(null);
    setVisionRows([]);
    setVisionKey([]);
    setVisionError(null);
    // Copy the bytes before any parse — pdf.js may detach the buffer it
    // is given, and the vision render needs its own fresh copy later.
    const bytes = imp.bytes.slice();
    bytesRef.current = bytes;
    let cancelled = false;
    (async () => {
      try {
        const pages = await extractSurveyorText(bytes);
        if (cancelled) return;
        const p = parseSurveyorPages(pages);
        setProposal(p);
        // Everything counts toward the plan except "other" devices,
        // which the user can opt into.
        setIncluded(
          new Set(p.items.filter((i) => i.kind !== "other").map((i) => keyOf(i))),
        );
        setPhase("ready");
      } catch (e) {
        console.error("[surveyor-import]", e);
        if (!cancelled) setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [imp]);

  const filtered = useMemo<SurveyorProposal | null>(() => {
    if (!proposal) return null;
    const items = proposal.items.filter((i) => included.has(keyOf(i)));
    const sum = (kind: SurveyorKind) =>
      items.filter((i) => i.kind === kind).reduce((acc, i) => acc + i.quantity, 0);
    const cameras = sum("camera");
    const drops = sum("drop");
    const aps = sum("ap");
    return {
      ...proposal,
      items,
      cameras,
      drops,
      aps,
      networkPorts: cameras + drops + aps,
    };
  }, [proposal, included]);

  const plan = useMemo(
    () => (filtered ? planRackForSurveyor(filtered) : null),
    [filtered],
  );

  // ── Vision (single-page layout, no device table) ──

  /** Render the page and ask the Worker to read the labels off it. */
  const analyzeVision = async () => {
    if (!imp || busy) return;
    setBusy(true);
    setVisionError(null);
    setPhase("vision-reading");
    try {
      const bytes = bytesRef.current;
      if (!bytes) throw new Error("The upload is no longer available — close and re-upload.");
      const { dataUrl } = await renderSurveyorPageImage(bytes.slice());
      const result = await analyzeSurveyorPage(dataUrl);
      setVisionImage(dataUrl);
      setVisionKey(result.key);
      setVisionRows(
        result.labels.map((l) => ({ id: uid(), text: l.text, x: l.x, y: l.y, type: "" })),
      );
      setPhase("vision-review");
    } catch (e) {
      console.error("[surveyor-vision]", e);
      setVisionError(e instanceof Error ? e.message : "Vision read failed.");
      setPhase("vision-error");
    } finally {
      setBusy(false);
    }
  };

  /** Rows that become drops: typed (not Skip) with a label left on them. */
  const visionAssigned = useMemo(
    () =>
      visionRows.filter((r) => r.type !== "" && r.type !== "Skip" && r.text.trim() !== ""),
    [visionRows],
  );

  /** Assigned counts per type, for the legend check. */
  const visionCounts = useMemo(() => {
    const assigned = new Map<VisionDeviceType, number>();
    for (const r of visionAssigned) {
      const t = r.type as VisionDeviceType;
      assigned.set(t, (assigned.get(t) ?? 0) + 1);
    }
    const unassigned = visionRows.filter((r) => r.type === "").length;
    return { assigned, unassigned };
  }, [visionRows, visionAssigned]);

  /** Rows whose label text repeats — drop numbers must be unique, so
   *  flag them in the review instead of failing on import. */
  const visionDupes = useMemo(() => {
    const seen = new Map<string, number>();
    for (const r of visionRows) {
      const t = r.text.trim().toLowerCase();
      if (t) seen.set(t, (seen.get(t) ?? 0) + 1);
    }
    return new Set(
      visionRows
        .filter((r) => (seen.get(r.text.trim().toLowerCase()) ?? 0) > 1)
        .map((r) => r.id),
    );
  }, [visionRows]);

  const setVisionRowType = (id: string, type: VisionRow["type"]) => {
    setVisionRows((prev) => prev.map((r) => (r.id === id ? { ...r, type } : r)));
  };

  const setVisionRowText = (id: string, text: string) => {
    setVisionRows((prev) => prev.map((r) => (r.id === id ? { ...r, text } : r)));
  };

  const deleteVisionRow = (id: string) => {
    setVisionRows((prev) => prev.filter((r) => r.id !== id));
  };

  const applyVision = async () => {
    if (!imp || busy || visionAssigned.length === 0) return;
    setBusy(true);
    try {
      const st = useProjectStore.getState();
      const project = st.project;
      if (!project) return;
      const firstSheet =
        project.sheets.find((s) => s.id === imp.sheetIds[0]) ?? project.sheets[0];

      // Drops land at the label positions, saved under the plan labels
      // exactly as printed — no renumbering. The store keeps a
      // non-blank number as-is.
      if (firstSheet) {
        st.setActiveSheet(firstSheet.id);
        const w = firstSheet.pageWidth ?? 612;
        const h = firstSheet.pageHeight ?? 792;
        for (const row of visionAssigned) {
          const type = row.type as VisionDeviceType;
          st.addMarkup({
            kind: "drop",
            id: uid(),
            layer: "drop",
            number: row.text.trim(),
            faceplateId: "",
            x: row.x * w,
            y: (1 - row.y) * h,
            service: visionServiceFor(type),
          } as DropMarkup);
        }
      }

      // Rack, sized from the assigned counts — every drop is a network
      // port, cameras drive the NVR.
      const plan = planRackForSurveyor(
        visionProposalForAssignments(visionAssigned.map((r) => r.type as VisionDeviceType)),
      );
      if (plan.networkPorts > 0) {
        const stem =
          imp.filename.replace(/\.pdf$/i, "").split(/[\\/]/).pop() ?? "Import";
        st.addRack({
          name: stem.slice(0, 40),
          uHeight: plan.rackU,
          placements: buildSurveyorRackPlacements(plan),
        });
      }
      const skipped = visionRows.length - visionAssigned.length;
      st.pushToast(
        "success",
        `Imported ${visionAssigned.length} drop${visionAssigned.length === 1 ? "" : "s"}${plan.networkPorts > 0 ? " + rack plan" : ""} from ${imp.filename}${skipped > 0 ? ` (${skipped} skipped)` : ""}`,
      );
      setSurveyorImport(null);
    } finally {
      setBusy(false);
    }
  };

  if (!imp) return null;

  const toggle = (item: SurveyorItem) => {
    setIncluded((prev) => {
      const next = new Set(prev);
      const k = keyOf(item);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const apply = async () => {
    if (!filtered || !plan || !imp || busy) return;
    setBusy(true);
    try {
      const st = useProjectStore.getState();
      const project = st.project;
      if (!project) return;
      const firstSheet =
        project.sheets.find((s) => s.id === imp.sheetIds[0]) ?? project.sheets[0];

      // Drops stage in rows near the top of the first sheet — the tables
      // carry rooms, not coordinates, so the user drags each drop to its
      // spot on the plan. Numbers and faceplate groups are assigned by
      // the store on add.
      if (firstSheet) {
        st.setActiveSheet(firstSheet.id);
        const w = firstSheet.pageWidth ?? 612;
        const h = firstSheet.pageHeight ?? 792;
        const staged: { service: DropService }[] = [];
        for (const item of filtered.items) {
          if (item.kind !== "camera" && item.kind !== "drop" && item.kind !== "ap") {
            continue;
          }
          for (let n = 0; n < item.quantity; n++) {
            staged.push({ service: serviceFor(item.kind) });
          }
        }
        const perRow = 12;
        staged.forEach((d, i) => {
          const row = Math.floor(i / perRow);
          const col = i % perRow;
          const x = w * 0.08 + (col * (w * 0.84)) / (perRow - 1);
          const y = h - 70 - row * 44;
          st.addMarkup({
            kind: "drop",
            id: uid(),
            layer: "drop",
            number: "",
            faceplateId: "",
            x,
            y,
            service: d.service,
          } as DropMarkup);
        });
      }

      // Rack, sized from the counts. addRack lands the user on the rack
      // view with the new rack active.
      if (plan.networkPorts > 0) {
        const stem =
          imp.filename.replace(/\.pdf$/i, "").split(/[\\/]/).pop() ?? "Import";
        st.addRack({
          name: stem.slice(0, 40),
          uHeight: plan.rackU,
          placements: buildSurveyorRackPlacements(plan),
        });
      }
      const dropCount =
        filtered.cameras + filtered.drops + filtered.aps;
      st.pushToast(
        "success",
        `Imported ${dropCount} drop${dropCount === 1 ? "" : "s"}${plan.networkPorts > 0 ? " + rack plan" : ""} from ${imp.filename}`,
      );
      setSurveyorImport(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-midnight/70 backdrop-blur-sm flex items-center justify-center animate-fade-in"
      onClick={busy ? undefined : close}
    >
      <div
        className={`panel rounded-xl ${phase === "vision-review" ? "w-[920px]" : "w-[560px]"} max-w-[94vw] max-h-[85vh] overflow-auto p-6 animate-scale-in`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-amber-knox/15 text-amber-knox flex items-center justify-center">
              <FileDown className="w-5 h-5" />
            </div>
            <div>
              <div className="font-semibold text-ink-50">Import from System Surveyor</div>
              <div className="text-xs text-ink-400">
                <span className="text-ink-200">{imp.filename}</span> —{" "}
                {phase.startsWith("vision")
                  ? "read from the plan picture with AI — you assign each label."
                  : "read from the report's bill of materials, no AI."}
              </div>
            </div>
          </div>
          <button onClick={close} className="text-ink-400 hover:text-ink-50" disabled={busy}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {phase === "reading" && (
          <div className="text-sm text-ink-300 py-8 text-center">
            Reading the report&apos;s device tables…
          </div>
        )}

        {phase === "error" && (
          <div className="space-y-4">
            <div className="text-sm text-ink-300 py-2 leading-relaxed">
              Couldn&apos;t read this PDF&apos;s text. It may be a scanned image
              with no text layer — the AI route reads the picture instead.
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn" onClick={close} disabled={busy}>
                Cancel
              </button>
              <button className="btn-primary" onClick={analyzeVision} disabled={busy}>
                Read labels with AI
              </button>
            </div>
          </div>
        )}

        {phase === "ready" && proposal && (
          <>
            {!proposal.isSurveyor || proposal.items.length === 0 ? (
              <div className="space-y-4">
                <div className="text-sm text-ink-300 leading-relaxed">
                  No device table found in this PDF — it&apos;s a layout-only
                  page, so there&apos;s nothing for the table reader to count.
                  The AI route reads the labels straight off the picture
                  instead: about a cent a page, and you assign each label
                  its device type before anything is created.
                </div>
                <div className="flex justify-end gap-2">
                  <button className="btn" onClick={close} disabled={busy}>
                    Cancel
                  </button>
                  <button className="btn-primary" onClick={analyzeVision} disabled={busy}>
                    Read labels with AI
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Stat value={String(filtered?.cameras ?? 0)} label="Cameras" />
                  <Stat value={String(filtered?.drops ?? 0)} label="Data drops" />
                  <Stat value={String(filtered?.networkPorts ?? 0)} label="Network ports" />
                </div>

                <div>
                  <div className="label mb-1">Devices found — uncheck anything to leave out</div>
                  <div className="space-y-1 max-h-[220px] overflow-auto pr-1">
                    {proposal.items.map((item) => {
                      const k = keyOf(item);
                      const checked = included.has(k);
                      return (
                        <label
                          key={k}
                          className="flex items-center gap-2 text-xs rounded-md px-2 py-1.5 hover:bg-white/5 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(item)}
                            className="accent-amber-500"
                          />
                          <span className="text-ink-400">{KIND_ICON[item.kind]}</span>
                          <span className="flex-1 text-ink-100 truncate" title={item.name}>
                            {item.name}
                          </span>
                          <span className="text-ink-400 font-mono">×{item.quantity}</span>
                        </label>
                      );
                    })}
                  </div>
                  {proposal.unmatchedRows > 0 && (
                    <div className="text-[11px] text-ink-400 mt-1">
                      {proposal.unmatchedRows} table row
                      {proposal.unmatchedRows === 1 ? "" : "s"} couldn&apos;t be read —
                      check the PDF&apos;s BOM page if a count looks short.
                    </div>
                  )}
                </div>

                {plan && plan.networkPorts > 0 && (
                  <div className="panel rounded-lg p-3 space-y-1 text-xs">
                    <div className="label">Rack plan</div>
                    <PlanLine
                      label="Patch panels"
                      value={plan.panels.map((p) => `${p.size}-port`).join(" + ") || "—"}
                    />
                    <PlanLine
                      label="Switches"
                      value={plan.switches.map((s) => `${s.size}-port`).join(" + ") || "—"}
                    />
                    {plan.nvrChannels > 0 && (
                      <PlanLine
                        label="NVR"
                        value={`${plan.nvrChannels}-channel, ${plan.nvrHeight}U`}
                      />
                    )}
                    <PlanLine label="Rack size" value={`${plan.rackU}U (${plan.totalU}U used)`} />
                    <div className="text-[11px] text-ink-400 pt-1">
                      Drops stage in a row on the first sheet — drag each to its
                      spot on the plan. Panels are named PP, PP 2… and switches
                      SW 1, SW 2… so the patch table works.
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <button className="btn" onClick={close} disabled={busy}>
                    Cancel
                  </button>
                  <button
                    className="btn-primary"
                    onClick={apply}
                    disabled={busy || !filtered || filtered.networkPorts === 0}
                  >
                    {busy ? "Importing…" : "Import drops + rack plan"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {phase === "vision-reading" && (
          <div className="text-sm text-ink-300 py-8 text-center">
            Reading the labels off the plan picture…
          </div>
        )}

        {phase === "vision-error" && (
          <div className="space-y-4">
            <div className="text-sm text-ink-300 py-2 leading-relaxed">{visionError}</div>
            <div className="flex justify-end gap-2">
              <button className="btn" onClick={close} disabled={busy}>
                Cancel
              </button>
              <button className="btn-primary" onClick={analyzeVision} disabled={busy}>
                Try again
              </button>
            </div>
          </div>
        )}

        {phase === "vision-review" && (
          <div className="space-y-3">
            <div className="grid grid-cols-[1.05fr_1fr] gap-3">
              {/* Plan with numbered pins at the label positions */}
              <div className="relative rounded-lg overflow-hidden border border-white/10 bg-white self-start">
                {visionImage && (
                  <img src={visionImage} alt="Plan page" className="w-full block" />
                )}
                {visionRows.map((r, i) => (
                  <span
                    key={r.id}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center shadow ${
                      r.type === "Skip"
                        ? "bg-ink-600 text-ink-300"
                        : r.type
                          ? "bg-amber-knox text-midnight"
                          : "bg-white text-midnight border border-black/30"
                    }`}
                    style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%` }}
                  >
                    {i + 1}
                  </span>
                ))}
              </div>
              {/* One row per label: label text, device type, delete */}
              <div className="space-y-1 max-h-[420px] overflow-auto pr-1">
                {visionRows.map((r, i) => (
                  <div key={r.id} className="flex items-center gap-1.5">
                    <span className="w-5 text-center text-[11px] font-mono text-ink-400 shrink-0">
                      {i + 1}
                    </span>
                    <input
                      value={r.text}
                      onChange={(e) => setVisionRowText(r.id, e.target.value)}
                      className={`input flex-1 min-w-0 ${visionDupes.has(r.id) ? "border-signal-red" : ""}`}
                      title={visionDupes.has(r.id) ? "This label appears twice — drop numbers must be unique" : undefined}
                    />
                    <select
                      value={r.type}
                      onChange={(e) => setVisionRowType(r.id, e.target.value as VisionRow["type"])}
                      className="input w-[104px] shrink-0"
                    >
                      <option value="">— type —</option>
                      {VISION_DEVICE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                      <option value="Skip">Skip</option>
                    </select>
                    <button
                      onClick={() => deleteVisionRow(r.id)}
                      className="text-ink-400 hover:text-signal-red shrink-0"
                      title="Delete this label — it won't be imported"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {visionRows.length === 0 && (
                  <div className="text-sm text-ink-300 py-4">
                    No labels found on this page — nothing to import.
                  </div>
                )}
              </div>
            </div>

            {/* Legend check — assigned counts vs the key, live */}
            <div className="panel rounded-lg p-3">
              <div className="label mb-1">Legend check — assigned vs key</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {VISION_DEVICE_TYPES.map((t) => {
                  const keyEntry = visionKey.find((k) => k.type === t);
                  const assigned = visionCounts.assigned.get(t) ?? 0;
                  if (assigned === 0 && !keyEntry) return null;
                  const keyCount = keyEntry?.count;
                  const hasKey = keyCount !== null && keyCount !== undefined;
                  const mismatch = hasKey && assigned !== keyCount;
                  return (
                    <span
                      key={t}
                      className={mismatch ? "text-amber-400" : "text-ink-200"}
                    >
                      {t}: {assigned}
                      {hasKey ? ` / ${keyCount}` : ""}
                      {mismatch
                        ? assigned < (keyCount as number)
                          ? ` — ${(keyCount as number) - assigned} short`
                          : ` — ${assigned - (keyCount as number)} extra`
                        : ""}
                    </span>
                  );
                })}
                {visionCounts.unassigned > 0 && (
                  <span className="text-ink-400">
                    {visionCounts.unassigned} unassigned — set a type or Skip
                  </span>
                )}
                {visionKey.length === 0 && visionAssigned.length === 0 && (
                  <span className="text-ink-400">No legend counts on this plan.</span>
                )}
              </div>
              {visionDupes.size > 0 && (
                <div className="text-[11px] text-amber-400 mt-1">
                  Two rows share the same label — drop numbers must be unique,
                  delete one.
                </div>
              )}
              <div className="text-[11px] text-ink-400 mt-1">
                Drops are saved under the plan labels exactly as printed. Rows
                with no type or no label are skipped.
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button className="btn" onClick={close} disabled={busy}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={applyVision}
                disabled={busy || visionAssigned.length === 0}
              >
                {busy
                  ? "Importing…"
                  : `Import ${visionAssigned.length} drop${visionAssigned.length === 1 ? "" : "s"} + rack plan`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function keyOf(item: SurveyorItem): string {
  return `${item.kind}:${item.name.toLowerCase()}`;
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="panel rounded-lg p-3">
      <div className="text-xl font-semibold text-ink-50">{value}</div>
      <div className="text-[11px] text-ink-400">{label}</div>
    </div>
  );
}

function PlanLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-ink-400">{label}</span>
      <span className="text-ink-100 font-medium text-right">{value}</span>
    </div>
  );
}
