// Manual drop sequences — no AI, no presets, no dropdowns.
//
// Type a start label and how high the sequence goes, and the labels
// fill themselves in: FCAM-001 up to 22 → FCAM-001 … FCAM-022. Every
// label family is typed by hand, so any prefix works (FCAM, NJCK, WAP,
// FSPST, …). Generated drops land on the sheet and feed the Patch
// Panels tab, where they get attached to ports.

/** Hard cap per expansion — a typo like "up to 99999" must not stage
 *  ten thousand drops. Split bigger runs into two rows. */
export const MAX_SEQUENCE_LABELS = 500;

const TRAILING_NUMBER = /^(.*?)(\d+)$/;

/** Split a start label into its text prefix, first number, and the
 *  digit width the sequence keeps: FCAM-001 → prefix "FCAM-", first 1,
 *  width 3. Null when the label ends in no digits. */
export function parseSequenceStart(start: string): {
  prefix: string;
  first: number;
  width: number;
} | null {
  const m = TRAILING_NUMBER.exec(start.trim());
  if (!m) return null;
  return { prefix: m[1], first: parseInt(m[2], 10), width: m[2].length };
}

/** Read the "up to" field: a plain number (22), or a full label
 *  (FCAM-022) — either way the trailing number is what counts. Null
 *  when the field holds no number at all. */
export function parseUpTo(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const asLabel = TRAILING_NUMBER.exec(trimmed);
  if (asLabel) return parseInt(asLabel[2], 10);
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Expand a sequence: start "FCAM-001", up to 22 → FCAM-001 … FCAM-022,
 *  numbers zero-padded to the start's width (001 stays three digits;
 *  a start of FCAM-1 stays unpadded). Empty when the start has no
 *  trailing number or "up to" is below the first number. */
export function expandDropSequence(start: string, upTo: number): string[] {
  const parsed = parseSequenceStart(start);
  if (!parsed || !Number.isFinite(upTo) || upTo < parsed.first) return [];
  const labels: string[] = [];
  for (let n = parsed.first; n <= upTo && labels.length < MAX_SEQUENCE_LABELS; n++) {
    labels.push(`${parsed.prefix}${String(n).padStart(parsed.width, "0")}`);
  }
  return labels;
}
