// Drop Sequences view — type a start label and how high the sequence
// goes, and the drops fill themselves in: FCAM-001 up to 22 →
// FCAM-001 … FCAM-022. No presets, no dropdowns — every label family
// is typed by hand. Generated drops land in rows on the active sheet
// (drag each to its spot) and show up in the Patch Panels tab, where
// they get attached to ports.

import { useMemo, useState } from "react";
import { ListOrdered, Plus, Trash2, Cable } from "lucide-react";
import {
  useProjectStore,
  type DropMarkup,
} from "../store/projectStore";
import { allDropMarkups } from "../lib/dropLabels";
import {
  expandDropSequence,
  parseSequenceStart,
  parseUpTo,
  MAX_SEQUENCE_LABELS,
} from "../lib/dropSequences";

const uid = () => Math.random().toString(36).slice(2, 10);

interface SequenceRow {
  id: string;
  start: string;
  upTo: string;
  /** Note for the whole row — lands on every drop it generates, and
   *  shows on the Patch Panels tab. */
  note: string;
}

/** Stage drops in rows near the top of the sheet — same layout as the
 *  System Surveyor table import, so the user drags each to its spot. */
const PER_ROW = 12;

export function DropSequenceBuilder() {
  const project = useProjectStore((s) => s.project);
  const activeSheetId = useProjectStore((s) => s.activeSheetId);
  const setView = useProjectStore((s) => s.setView);
  const [rows, setRows] = useState<SequenceRow[]>([
    { id: uid(), start: "", upTo: "", note: "" },
  ]);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dropCount = useMemo(
    () => (project ? allDropMarkups(project).length : 0),
    [project],
  );

  const existing = useMemo(() => {
    const set = new Set<string>();
    if (project) {
      for (const d of allDropMarkups(project)) set.add(d.number.trim().toLowerCase());
    }
    return set;
  }, [project]);

  const sheet =
    project?.sheets.find((s) => s.id === activeSheetId) ?? project?.sheets[0];

  // Live preview per row: what the sequence expands to, and what is
  // wrong with it when it expands to nothing.
  const previews = useMemo(
    () =>
      rows.map((r) => {
        const upTo = parseUpTo(r.upTo);
        const labels =
          upTo === null ? [] : expandDropSequence(r.start, upTo);
        const parsed = parseSequenceStart(r.start);
        const already = labels.filter((l) => existing.has(l.toLowerCase())).length;
        let note: string | null = null;
        if (r.start.trim() !== "" && !parsed) {
          note = "Needs a number at the end — e.g. FCAM-001.";
        } else if (r.start.trim() !== "" && r.upTo.trim() !== "" && labels.length === 0) {
          note = `"Up to" has to be ${parsed?.first ?? 1} or higher.`;
        } else if (labels.length >= MAX_SEQUENCE_LABELS) {
          note = `Capped at ${MAX_SEQUENCE_LABELS} labels — split it into two rows for more.`;
        }
        return { labels, already, note };
      }),
    [rows, existing],
  );

  // Labels this would add, deduped across rows and against the project,
  // each carrying its row's note.
  const toAdd = useMemo(() => {
    const seen = new Set<string>();
    const out: { number: string; notes?: string }[] = [];
    rows.forEach((r, i) => {
      const note = r.note.trim() || undefined;
      for (const label of previews[i].labels) {
        const key = label.toLowerCase();
        if (existing.has(key) || seen.has(key)) continue;
        seen.add(key);
        out.push({ number: label, notes: note });
      }
    });
    return out;
  }, [rows, previews, existing]);

  const setRow = (id: string, patch: Partial<SequenceRow>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const addRow = () =>
    setRows((prev) => [...prev, { id: uid(), start: "", upTo: "", note: "" }]);

  const deleteRow = (id: string) =>
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));

  const generate = () => {
    if (!project || !sheet || toAdd.length === 0 || busy) return;
    setBusy(true);
    try {
      const st = useProjectStore.getState();
      st.setActiveSheet(sheet.id);
      const w = sheet.pageWidth ?? 612;
      const h = sheet.pageHeight ?? 792;
      toAdd.forEach((d, i) => {
        const row = Math.floor(i / PER_ROW);
        const col = i % PER_ROW;
        const x = w * 0.08 + (col * (w * 0.84)) / (PER_ROW - 1);
        const y = h - 70 - row * 44;
        st.addMarkup({
          kind: "drop",
          id: uid(),
          layer: "drop",
          number: d.number,
          faceplateId: "",
          x,
          y,
          service: "data",
          ...(d.notes ? { notes: d.notes } : {}),
        } as DropMarkup);
      });
      // Read back what actually landed — the count reported is the
      // count in the project, not the count attempted.
      const fresh = useProjectStore.getState().project;
      const landed = new Set(
        (fresh ? allDropMarkups(fresh) : []).map((m) =>
          m.number.trim().toLowerCase(),
        ),
      );
      const added = toAdd.filter((d) => landed.has(d.number.toLowerCase())).length;
      const expanded = previews.reduce((acc, p) => acc + p.labels.length, 0);
      const skipped = expanded - toAdd.length;
      const missing = toAdd.length - added;
      const msg = `Added ${added} drop${added === 1 ? "" : "s"} on ${sheet.name}${skipped > 0 ? ` — ${skipped} already existed, skipped` : ""}${missing > 0 ? ` — ${missing} did not land, try again` : ""}.`;
      setResult(`${msg} Attach them to ports in the Patch Panels tab.`);
      st.pushToast(missing > 0 ? "error" : "success", msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 overflow-auto workspace-grid">
      <div className="max-w-3xl mx-auto w-full p-6 space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-ink-50 flex items-center gap-2">
            <ListOrdered className="w-5 h-5 text-amber-knox" />
            Drop Sequences
          </h1>
          <p className="text-xs text-ink-400 leading-relaxed">
            Type a start label and how high the sequence goes — the drops
            fill themselves in. FCAM-001 up to 22 gives FCAM-001 …
            FCAM-022. Works for every label family: type the prefix
            yourself, there is no list to pick from.
          </p>
          <div className="text-[11px] text-ink-400 mt-1">
            {dropCount} drop{dropCount === 1 ? "" : "s"} in this project.
          </div>
        </div>

        {!sheet ? (
          <div className="panel rounded-lg p-6 text-sm text-ink-300 text-center">
            Add a drawing first — drops need a sheet to land on.
          </div>
        ) : (
          <>
            <div className="panel rounded-lg p-3 space-y-2">
              <div className="grid grid-cols-[1fr_110px_28px] gap-2 items-center text-[11px] font-medium text-ink-400 px-1">
                <span>Start label</span>
                <span>Up to</span>
                <span />
              </div>
              {rows.map((r, i) => {
                const p = previews[i];
                return (
                  <div key={r.id} className="space-y-1">
                    <div className="grid grid-cols-[1fr_110px_28px] gap-2 items-center">
                      <input
                        value={r.start}
                        onChange={(e) => setRow(r.id, { start: e.target.value })}
                        placeholder="FCAM-001"
                        className="input font-mono"
                        autoCapitalize="characters"
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <input
                        value={r.upTo}
                        onChange={(e) => setRow(r.id, { upTo: e.target.value })}
                        placeholder="22"
                        className="input font-mono"
                        inputMode="numeric"
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <button
                        onClick={() => deleteRow(r.id)}
                        className="text-ink-400 hover:text-signal-red disabled:opacity-30"
                        disabled={rows.length === 1}
                        title="Remove this row"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {p.note ? (
                      <div className="text-[11px] text-amber-400 px-1">{p.note}</div>
                    ) : p.labels.length > 0 ? (
                      <div className="text-[11px] text-ink-400 px-1">
                        {p.labels.length === 1
                          ? p.labels[0]
                          : `${p.labels[0]} … ${p.labels[p.labels.length - 1]}`}{" "}
                        — {p.labels.length} drop{p.labels.length === 1 ? "" : "s"}
                        {p.already > 0
                          ? ` (${p.already} already in the project — skipped)`
                          : ""}
                      </div>
                    ) : null}
                    <input
                      value={r.note}
                      onChange={(e) => setRow(r.id, { note: e.target.value })}
                      placeholder="Note — optional, shows on the patch panel"
                      className="input w-full"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                );
              })}
              <button onClick={addRow} className="btn-ghost text-xs">
                <Plus className="w-3.5 h-3.5" /> Add another sequence
              </button>
            </div>

            {result && (
              <div className="panel rounded-lg p-3 text-xs text-ink-200 leading-relaxed">
                {result}
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                className="btn-primary"
                onClick={generate}
                disabled={busy || toAdd.length === 0}
              >
                {busy
                  ? "Adding…"
                  : toAdd.length === 0
                    ? "Generate drops"
                    : `Generate ${toAdd.length} drop${toAdd.length === 1 ? "" : "s"}`}
              </button>
              <button className="btn" onClick={() => setView("patch-panels")}>
                <Cable className="w-3.5 h-3.5" /> Go to Patch Panels
              </button>
            </div>

            <p className="text-[11px] text-ink-400 leading-relaxed">
              Drops land in rows near the top of {sheet.name} — drag each to
              its spot on the plan. They land as data drops; change the
              service on a drop in the sidebar when it is a camera or PoE.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
