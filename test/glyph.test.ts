import { describe, expect, it } from "vitest";
import {
  ISSUE_PIE_DASH,
  SUB_ISSUE_CIRCUMFERENCE,
  glyphSpec,
  glyphsForStates,
  projectGlyphSpec,
  startedFraction,
  subIssueArc,
} from "../src/select/glyph.js";
import type { WorkflowStateRow } from "../src/store/rows.js";
import { threadIssueSchema } from "../src/rpc.js";

const spec = (type: string, color: string | null = "#5E6AD2") =>
  glyphSpec({ type, color, startedIndex: null, startedCount: null });

describe("Linear status glyph projection", () => {
  it("maps every status family to Linear's ring, fill, and mark", () => {
    expect(spec("backlog")).toMatchObject({ ring: "dashed", pie: 0, disc: false, mark: null });
    expect(spec("unstarted")).toMatchObject({ ring: "solid", pie: 0, disc: false, mark: null });
    expect(spec("started")).toMatchObject({ ring: "solid", pie: 0.5, disc: false, mark: null });
    expect(spec("completed")).toMatchObject({ ring: "solid", pie: null, disc: true, mark: "check" });
    expect(spec("canceled")).toMatchObject({ ring: "solid", pie: null, disc: true, mark: "x" });
    expect(spec("duplicate")).toMatchObject({ ring: "solid", pie: null, disc: true, mark: "x" });
    expect(spec("triage")).toMatchObject({ ring: "solid", pie: null, disc: false, mark: "dot" });
    expect(spec("future")).toMatchObject({ ring: "solid", pie: null, disc: false, mark: null });
  });

  it("preserves configured colour and its null fallback signal", () => {
    expect(spec("started", "#123456").color).toBe("#123456");
    expect(spec("started", null).color).toBeNull();
  });

  it("uses the exact started fractions for one, two, and three states", () => {
    expect([startedFraction(0, 1)]).toEqual([0.5]);
    expect([startedFraction(0, 2), startedFraction(1, 2)]).toEqual([0.5, 0.75]);
    expect([startedFraction(0, 3), startedFraction(1, 3), startedFraction(2, 3)]).toEqual([
      0.5,
      0.5 + 0.5 * (1 / 3),
      0.5 + 0.5 * (2 / 3),
    ]);
  });

  it("produces exact pie offsets from Linear's circumference constant", () => {
    expect(ISSUE_PIE_DASH * (1 - startedFraction(0, 1))).toBe(6.094689747964199);
    expect(ISSUE_PIE_DASH * (1 - startedFraction(1, 2))).toBe(3.0473448739820994);
  });

  it("indexes started states by position within each team, never by name", () => {
    const rows: WorkflowStateRow[] = [
      { id: "review", teamId: "a", name: "AAA", type: "started", position: 20, color: "#2", description: null },
      { id: "progress", teamId: "a", name: "ZZZ", type: "started", position: 10, color: "#1", description: null },
      { id: "other", teamId: "b", name: "Review", type: "started", position: 1, color: "#3", description: null },
    ];
    const glyphs = glyphsForStates(rows);
    expect(glyphs.get("progress")?.pie).toBe(0.5);
    expect(glyphs.get("review")?.pie).toBe(0.75);
    expect(glyphs.get("other")?.pie).toBe(0.5);
  });

  it("uses the exact sub-issue circumference and clamps bad arithmetic", () => {
    expect(subIssueArc(3, 4)).toBe(SUB_ISSUE_CIRCUMFERENCE * 0.25);
    expect(subIssueArc(0, 0)).toBe(43.982297150257104);
    expect(subIssueArc(9, 4)).toBe(0);
  });

  it("bounds mirrored project progress before it reaches the renderer", () => {
    expect(projectGlyphSpec({ type: "started", color: "#5E6AD2", progress: 1.5 }))
      .toEqual({ type: "started", color: "#5E6AD2", progress: 1 });
    expect(projectGlyphSpec({ type: "backlog", color: null, progress: null }))
      .toEqual({ type: "backlog", color: null, progress: 0 });
  });

  it("requires the projected glyph on thread issue payloads", () => {
    const glyph = spec("started");
    expect(
      threadIssueSchema.safeParse({
        binding: {
          issueId: "issue_1",
          identifier: "ENG-1",
          title: "Glyph parity",
          stateName: "In progress",
          tone: "started",
          glyph,
          url: null,
          origin: "manual",
          provenance: null,
          stateOptions: [
            { id: "started", name: "In progress", type: "started", tone: "started", glyph },
          ],
        },
        suggestion: null,
        alternates: [],
      }).success,
    ).toBe(true);
  });
});
