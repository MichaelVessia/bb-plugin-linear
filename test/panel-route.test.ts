import { describe, expect, it } from "vitest";
import { parsePanelSubPath } from "../src/panel-route.js";

describe("the Linear panel sub-path grammar", () => {
  it("parses team, issue, and comment deep links", () => {
    expect(parsePanelSubPath("/t/ENG")).toEqual({
      teamKey: "ENG",
      identifier: null,
      commentId: null,
    });
    expect(parsePanelSubPath("i/ENG-42")).toEqual({
      teamKey: null,
      identifier: "ENG-42",
      commentId: null,
    });
    expect(parsePanelSubPath("/i/ENG-42/c/comment_1/")).toEqual({
      teamKey: null,
      identifier: "ENG-42",
      commentId: "comment_1",
    });
  });

  it("rejects partial and extra segments instead of partially matching them", () => {
    for (const subPath of ["t", "i/ENG-42/c", "i/ENG-42/nope/comment_1", "i/ENG-42/extra"]) {
      expect(parsePanelSubPath(subPath)).toEqual({
        teamKey: null,
        identifier: null,
        commentId: null,
      });
    }
  });
});
