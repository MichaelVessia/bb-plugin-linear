import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  fetchLinearImage,
  IMAGE_PROXY_PATH,
  linearUploadUrl,
  MAX_IMAGE_BYTES,
  resolveImageAccess,
  rewriteLinearImages,
} from "../src/image-proxy.js";
import { safeRemoteMarkdown } from "../src/security-boundaries.js";

describe("Linear image URL policy", () => {
  it("registers the route with local session auth", () => {
    const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
    const route = server.slice(server.indexOf('"/image"'), server.indexOf("/* ── Webhooks"));
    expect(route).toContain('{ auth: "local" }');
    expect(route).not.toContain("lifetime.log");
  });

  it("accepts only exact HTTPS upload hosts without credentials or ports", () => {
    expect(linearUploadUrl("https://uploads.linear.app/a.png")?.hostname).toBe("uploads.linear.app");
    for (const url of [
      "http://uploads.linear.app/a.png",
      "https://uploads.linear.app.evil.test/a.png",
      "https://uploads.linear.app@evil.test/a.png",
      "https://user@uploads.linear.app/a.png",
      "https://uploads.linear.app:444/a.png",
      "not a url",
    ]) {
      expect(linearUploadUrl(url), url).toBeNull();
    }
  });

  it("rewrites only Linear uploads and lets the renderer keep only that local proxy", () => {
    const projected = rewriteLinearImages(
      "![shot](https://uploads.linear.app/path/shot.png) ![pixel](https://evil.test/p.gif)",
      "i 1",
    );
    expect(projected).toContain(`${IMAGE_PROXY_PATH}?issue=i%201&src=`);
    const safe = safeRemoteMarkdown(projected);
    expect(safe).toContain(`![shot](${IMAGE_PROXY_PATH}`);
    expect(safe).toContain("!\u200b[pixel]");
  });

  it("neutralizes every non-proxy image form before restoring the positive allowlist", () => {
    for (const markdown of [
      "![a [b] c](https://evil.test/p.gif)",
      "![a\nb](https://evil.test/p.gif)",
      "![x](  https://evil.test/p.gif)",
    ]) {
      expect(safeRemoteMarkdown(markdown), markdown).not.toContain("![");
    }
    expect(
      safeRemoteMarkdown(`![ok](${IMAGE_PROXY_PATH}?issue=i1&src=encoded)`),
    ).toBe(`![ok](${IMAGE_PROXY_PATH}?issue=i1&src=encoded)`);
  });

  it("resolves one readable issue to its workspace credential slot", () => {
    expect(resolveImageAccess({
      directCandidate: { teamId: "t1", workspaceSlot: "apiKey2" },
      identifierCandidates: [],
      readableTeamIds: ["t1"],
      primarySlot: "apiKey",
      credentialSlots: ["apiKey", "apiKey2"],
    })).toEqual({ slot: "apiKey2" });
    expect(resolveImageAccess({
      directCandidate: null,
      identifierCandidates: [{ teamId: "t2", workspaceSlot: "apiKey2" }],
      readableTeamIds: ["t1"],
      primarySlot: "apiKey",
      credentialSlots: ["apiKey", "apiKey2"],
    })).toBeNull();
  });
});

describe("fetchLinearImage", () => {
  it("forwards authorization, refuses redirects, and never follows them", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(null, { status: 302, headers: { Location: "https://evil.test/a" } }),
    );
    const result = await fetchLinearImage({
      source: "https://uploads.linear.app/a.png",
      authorization: "secret",
      fetchImpl,
    });
    expect(result.status).toBe(502);
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://uploads.linear.app/a.png"),
      expect.objectContaining({ headers: { Authorization: "secret" }, redirect: "manual" }),
    );
  });

  it("requires an image content type", async () => {
    const result = await fetchLinearImage({
      source: "https://uploads.linear.app/a",
      authorization: "secret",
      fetchImpl: async () => new Response("html", { headers: { "Content-Type": "text/html" } }),
    });
    expect(result.status).toBe(502);
  });

  it("refuses active SVG content even when the server labels it as an image", async () => {
    const result = await fetchLinearImage({
      source: "https://uploads.linear.app/a.svg",
      authorization: "secret",
      fetchImpl: async () =>
        new Response("<svg><script>top.alert(1)</script></svg>", {
          headers: { "Content-Type": "image/svg+xml" },
        }),
    });
    expect(result.status).toBe(502);
  });

  it("rejects a declared body over ten megabytes before reading it", async () => {
    const stream = new ReadableStream<Uint8Array>();
    const result = await fetchLinearImage({
      source: "https://uploads.linear.app/a.png",
      authorization: "secret",
      fetchImpl: async () =>
        new Response(stream, {
          headers: {
            "Content-Type": "image/png",
            "Content-Length": String(MAX_IMAGE_BYTES + 1),
          },
        }),
    });
    expect(result.status).toBe(502);
  });

  it("stops a chunked body when the streamed byte count crosses the cap", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(6 * 1024 * 1024));
        controller.enqueue(new Uint8Array(6 * 1024 * 1024));
        controller.close();
      },
    });
    const result = await fetchLinearImage({
      source: "https://uploads.linear.app/a.png",
      authorization: "secret",
      fetchImpl: async () => new Response(stream, { headers: { "Content-Type": "image/png" } }),
    });
    expect(result.status).toBe(502);
  });

  it("returns a private, bounded image response", async () => {
    const result = await fetchLinearImage({
      source: "https://uploads.linear.app/a.png?download=1",
      authorization: "secret",
      fetchImpl: async () =>
        new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } }),
    });
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(result.headers.get("x-content-type-options")).toBe("nosniff");
    expect(result.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect([...new Uint8Array(await result.arrayBuffer())]).toEqual([1, 2, 3]);
  });
});
