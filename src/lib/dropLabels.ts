import type { DropMarkup, Project } from "../store/projectStore";

/**
 * Drop numbering — mirrors the cable physical-label scheme
 * (`src/lib/cableLabels.ts`). Drops are documentation-only markup:
 * numbers exist so a drawing, schedule, or handout can reference
 * "D-004" and have that still mean the same jack later. Numbers are
 * per-project, stable (deleting a drop leaves a gap — they never
 * re-sequence), and assigned at placement from the configured scheme.
 */
export interface DropLabelScheme {
  prefix?: string;
  minDigits?: number;
  separator?: string;
}

export const DEFAULT_DROP_LABEL_SCHEME: Required<DropLabelScheme> = {
  prefix: "D",
  minDigits: 3,
  separator: "-",
};

export function resolveDropLabelScheme(
  scheme: DropLabelScheme | undefined,
): Required<DropLabelScheme> {
  const defaults = DEFAULT_DROP_LABEL_SCHEME;
  return {
    prefix: cleanPrefix(scheme?.prefix) || defaults.prefix,
    minDigits: Math.max(
      1,
      Math.min(8, Math.floor(scheme?.minDigits ?? defaults.minDigits)),
    ),
    separator: scheme?.separator ?? defaults.separator,
  };
}

export function normalizeDropNumber(value: string | undefined): string {
  return value?.trim().replace(/\s+/g, " ").toUpperCase() ?? "";
}

/** Format a sequence number in the resolved scheme, e.g. D-001. */
export function formatDropNumber(
  sequence: number,
  scheme: DropLabelScheme | undefined,
): string {
  const resolved = resolveDropLabelScheme(scheme);
  return `${resolved.prefix}${resolved.separator}${String(sequence).padStart(resolved.minDigits, "0")}`;
}

/** Next unused drop number in the configured scheme. Collision-tolerant:
 * skips numbers taken by manual edits, mirroring the cable generator. */
export function generateDropNumber(
  existingNumbers: Iterable<string>,
  scheme: DropLabelScheme | undefined,
): string {
  const resolved = resolveDropLabelScheme(scheme);
  const used = new Set(
    Array.from(existingNumbers, normalizeDropNumber).filter(Boolean),
  );
  const matcher = new RegExp(
    `^${escapeRegExp(resolved.prefix)}${escapeRegExp(resolved.separator)}?(\\d+)$`,
    "i",
  );
  let next = 1;
  for (const label of used) {
    const match = label.match(matcher);
    if (!match) continue;
    next = Math.max(next, Number(match[1]) + 1);
  }

  let candidate = formatDropNumber(next, resolved);
  while (used.has(normalizeDropNumber(candidate))) {
    next += 1;
    candidate = formatDropNumber(next, resolved);
  }
  return candidate;
}

/** Fill in missing drop numbers for freshly placed drops. Drops that
 *  already carry a number are kept verbatim and reserve that number. */
export function assignGeneratedDropNumbers(
  markups: DropMarkup[],
  project: Project,
): DropMarkup[] {
  const scheme = project.dropLabelScheme;
  const used = new Set(
    allDropMarkups(project)
      .map((m) => normalizeDropNumber(m.number))
      .filter(Boolean),
  );
  return markups.map((markup) => {
    const existing = markup.number?.trim();
    if (existing) {
      used.add(normalizeDropNumber(existing));
      return markup;
    }
    const number = generateDropNumber(used, scheme);
    used.add(normalizeDropNumber(number));
    return { ...markup, number };
  });
}

/** Every drop in the project, across all sheets (one number sequence). */
export function allDropMarkups(project: Project): DropMarkup[] {
  return project.sheets.flatMap((sheet) =>
    sheet.markups.filter((m): m is DropMarkup => m.kind === "drop"),
  );
}

function cleanPrefix(value: string | undefined): string {
  return value?.trim().toUpperCase().replace(/\s+/g, "") ?? "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
