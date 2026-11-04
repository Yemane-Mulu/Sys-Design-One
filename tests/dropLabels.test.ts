// @vitest-environment node
// Drops feature — numbering contract (openspec/changes/add-drops):
// one per-project sequence (D-001 default), stable with gaps after
// deletion, scheme changes affect only newly placed drops, and the
// generator is collision-tolerant of manual numbers.
import { describe, it, expect } from "vitest";
import {
  DEFAULT_DROP_LABEL_SCHEME,
  resolveDropLabelScheme,
  formatDropNumber,
  generateDropNumber,
  assignGeneratedDropNumbers,
  allDropMarkups,
} from "../src/lib/dropLabels";
import type { DropMarkup, Project } from "../src/store/projectStore";

function drop(partial: Partial<DropMarkup>): DropMarkup {
  return {
    id: `drop-${Math.random().toString(36).slice(2, 10)}`,
    kind: "drop",
    layer: "drop",
    number: "",
    faceplateId: "fp-1",
    x: 0,
    y: 0,
    ...partial,
  };
}

function projectWith(drops: DropMarkup[]): Project {
  return {
    id: "p1",
    meta: { projectName: "Fixture", date: new Date(0).toISOString() },
    sheets: [
      {
        id: "s1",
        name: "Plan A",
        fileName: "a.pdf",
        pageWidth: 800,
        pageHeight: 600,
        renderScale: 1,
        markups: drops.filter((_, i) => i % 2 === 0),
      },
      {
        id: "s2",
        name: "Plan B",
        fileName: "b.pdf",
        pageWidth: 800,
        pageHeight: 600,
        renderScale: 1,
        markups: drops.filter((_, i) => i % 2 === 1),
      },
    ],
    racks: [],
    createdAt: 1,
    updatedAt: 1,
  } as unknown as Project;
}

describe("drop label scheme", () => {
  it("pins the bundled D-001 defaults", () => {
    expect(DEFAULT_DROP_LABEL_SCHEME).toEqual({
      prefix: "D",
      minDigits: 3,
      separator: "-",
    });
  });

  it("falls back to defaults for blank and missing fields", () => {
    expect(resolveDropLabelScheme(undefined)).toEqual(DEFAULT_DROP_LABEL_SCHEME);
    expect(resolveDropLabelScheme({ prefix: " " })).toEqual(
      DEFAULT_DROP_LABEL_SCHEME,
    );
  });

  it("resolves custom schemes and clamps digits into 1–8 like the cable scheme", () => {
    const resolved = resolveDropLabelScheme({ prefix: "dr", minDigits: 99, separator: "." });
    expect(resolved).toEqual({ prefix: "DR", minDigits: 8, separator: "." });
    // 0 clamps up to 1 (the cable scheme's exact behavior), not to the default.
    expect(resolveDropLabelScheme({ minDigits: 0 }).minDigits).toBe(1);
  });

  it("formats numbers in the resolved scheme", () => {
    expect(formatDropNumber(1, undefined)).toBe("D-001");
    expect(formatDropNumber(12, { prefix: "DR", minDigits: 2 })).toBe("DR-12");
  });
});

describe("next number generation", () => {
  it("starts at D-001 in an empty project", () => {
    expect(generateDropNumber([], undefined)).toBe("D-001");
  });

  it("continues past the highest existing number", () => {
    expect(generateDropNumber(["D-001", "D-002", "D-003"], undefined)).toBe("D-004");
  });

  it("skips numbers taken by manual edits", () => {
    expect(generateDropNumber(["D-001", "D-003"], undefined)).toBe("D-004");
  });

  it("matches manually numbered drops regardless of padding", () => {
    expect(generateDropNumber(["D-1", "D2"], undefined)).toBe("D-003");
  });

  it("honors a custom scheme", () => {
    expect(
      generateDropNumber(["DR-01"], { prefix: "DR", minDigits: 2, separator: "-" }),
    ).toBe("DR-02");
  });
});

describe("per-project stability", () => {
  it("uses one sequence across every sheet", () => {
    const project = projectWith([
      drop({ number: "D-001" }),
      drop({ number: "D-002" }),
      drop({ number: "D-003" }),
    ]);
    expect(allDropMarkups(project)).toHaveLength(3);
    // Assign two new drops against a project whose numbers live on both
    // sheets — the generator must see them all through one sequence.
    const assigned = assignGeneratedDropNumbers(
      [drop({}), drop({})],
      project,
    );
    expect(assigned.map((d) => d.number)).toEqual(["D-004", "D-005"]);
  });

  it("never rewrites existing numbers — deletion gaps persist", () => {
    // D-002 was deleted; D-003 remains. The next drop is D-004 — the
    // gap is never healed and existing numbers never shift.
    const project = projectWith([drop({ number: "D-001" }), drop({ number: "D-003" })]);
    const [assigned] = assignGeneratedDropNumbers([drop({})], project);
    expect(assigned.number).toBe("D-004");
  });

  it("keeps pre-numbered drops verbatim and reserves their numbers", () => {
    const [kept, next] = assignGeneratedDropNumbers(
      [drop({ number: "D-010" }), drop({})],
      projectWith([]),
    );
    expect(kept.number).toBe("D-010");
    expect(next.number).toBe("D-011");
  });

  it("applies scheme changes to new drops only", () => {
    const oldProject = projectWith([drop({ number: "D-001" })]);
    const withNewScheme = { ...oldProject, dropLabelScheme: { prefix: "DR", minDigits: 2 } };
    // The existing drop keeps its old-scheme number verbatim.
    expect(allDropMarkups(withNewScheme)[0].number).toBe("D-001");
    // New drops use the new scheme, continuing from its own sequence.
    const [assigned] = assignGeneratedDropNumbers([drop({})], withNewScheme);
    expect(assigned.number).toBe("DR-01");
  });
});