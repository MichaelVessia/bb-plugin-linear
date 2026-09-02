import { describe, expect, it } from "vitest";
import { renderMentions } from "../src/select/mentions-markup.js";

describe("renderMentions", () => {
  it("keeps the visible name and removes the opaque Linear destination", () => {
    expect(renderMentions("Ask @[Ada Lovelace](user_123) about it.")).toBe(
      "Ask **@Ada Lovelace** about it.",
    );
  });

  it("leaves ordinary links and malformed mention markup alone", () => {
    expect(renderMentions("[Ada](https://example.com) @[Nope](https://example.com)")).toBe(
      "[Ada](https://example.com) @[Nope](https://example.com)",
    );
  });
});
