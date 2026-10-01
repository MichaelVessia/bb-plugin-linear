import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InboxList, type InboxActions } from "../app/InboxList.js";
import type { InboxItemView } from "../src/contract.js";

const ACTIONS: InboxActions = { open: () => {}, markRead: () => {}, dismiss: () => {} };

function item(overrides: Partial<InboxItemView> = {}): InboxItemView {
  return {
    key: "ws:g_1",
    kind: "assigned",
    text: "Kai assigned you OFP-1 · Ship it.",
    identifier: "OFP-1",
    open: { kind: "issue", ref: "i_1", commentId: null },
    url: "https://linear.app/acme/inbox/n_1",
    workspace: null,
    age: "2h",
    unseen: true,
    ...overrides,
  };
}

function render(items: InboxItemView[]): string {
  return renderToStaticMarkup(createElement(InboxList, { items, actions: ACTIONS }));
}

/** The opening tag of the element whose accessible name starts with `name`. */
function control(html: string, name: string): string | null {
  const match = new RegExp(`<(button|a)[^>]*aria-label="${name}[^"]*"[^>]*>`).exec(html);
  return match?.[0] ?? null;
}

describe("the Inbox renders its actions", () => {
  it("offers Mark read and Dismiss on an unread row, labelled as bb-only", () => {
    const html = render([item()]);

    expect(control(html, "Mark read in bb: Kai assigned you OFP-1")).not.toBeNull();
    expect(control(html, "Dismiss from bb: Kai assigned you OFP-1")).not.toBeNull();
    expect(html).toContain(">Mark read</span>");
    expect(html).toContain(">Dismiss</span>");
    expect(html).toContain("Mark read and Dismiss change bb only.");
  });

  it("never hides a row action behind hover", () => {
    // `bbl-row-actions` is opacity 0 until hover, which is how Mark read went
    // unseen on a touch screen and in a quick look.
    const html = render([item(), item({ key: "ws:g_2", unseen: false })]);

    expect(html).not.toContain("bbl-row-actions");
  });

  it("drops Mark read from a read row and keeps Dismiss", () => {
    const html = render([item({ unseen: false })]);

    expect(control(html, "Mark read in bb")).toBeNull();
    expect(control(html, "Dismiss from bb")).not.toBeNull();
    expect(html).toContain("All read");
    expect(html).not.toContain("Mark all read");
  });

  it("puts the bulk actions above the list, counted", () => {
    const html = render([
      item({ key: "a" }),
      item({ key: "b" }),
      item({ key: "c", unseen: false }),
    ]);

    expect(html).toContain("2 unread");
    expect(html).toContain(">Mark all read</button>");
    expect(html).toContain(">Dismiss 1 read</button>");
    expect(html.indexOf("Mark all read")).toBeLessThan(html.indexOf("<ul"));
  });

  it("keeps an accessible name on every icon when narrow widths hide the words", () => {
    const html = render([item()]);
    const labels = html.match(/class="bbl-inbox-action-label"/g) ?? [];

    expect(labels).toHaveLength(2);
    for (const name of ["Mark read in bb", "Dismiss from bb", "Open in Linear"]) {
      expect(control(html, name)).not.toBeNull();
    }
  });

  it("opens a bb issue in bb, with Linear as a separate link", () => {
    const html = render([item()]);

    expect(html).toMatch(/<button type="button" class="min-w-0[^"]*">/);
    expect(control(html, "Open in Linear")).toContain('href="https://linear.app/acme/inbox/n_1"');
  });

  it("makes a row outside bb's teams a Linear link", () => {
    const html = render([
      item({ open: { kind: "linear", url: "https://linear.app/acme/inbox/n_9" } }),
    ]);

    expect(html).toMatch(/<a href="https:\/\/linear.app\/acme\/inbox\/n_9" target="_blank"/);
    expect(html).toContain("(opens in Linear)");
    expect(control(html, "Open in Linear")).toBeNull();
  });

  it("renders a row with nowhere to go, or an unsafe link, as text", () => {
    for (const open of [
      { kind: "none" as const },
      { kind: "linear" as const, url: "javascript:alert(1)" },
    ]) {
      const html = render([item({ open, url: null })]);
      expect(html).not.toContain("javascript:");
      expect(html).toMatch(/<span class="min-w-0 flex-1 truncate/);
      expect(control(html, "Dismiss from bb")).not.toBeNull();
    }
  });
});
