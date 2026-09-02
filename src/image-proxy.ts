export const LINEAR_UPLOAD_HOST = "uploads.linear.app";
export const IMAGE_PROXY_PATH = "/api/v1/plugins/linear/http/image";
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// A stalled upload must not hold a locally-authenticated bb request forever.
export const IMAGE_FETCH_TIMEOUT_MS = 30_000;

export type ImageFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface ImageAccessCandidate {
  readonly teamId: string;
  readonly workspaceSlot: string | null;
}

/** Resolve scope and credential routing without coupling the policy to Store. */
export function resolveImageAccess(input: {
  readonly directCandidate: ImageAccessCandidate | null;
  readonly identifierCandidates: readonly ImageAccessCandidate[];
  readonly readableTeamIds: readonly string[];
  readonly primarySlot: string;
  readonly credentialSlots: readonly string[];
}): { readonly slot: string } | null {
  const readable = new Set(input.readableTeamIds);
  const candidates = input.directCandidate === null
    ? input.identifierCandidates
    : [input.directCandidate];
  const inScope = candidates.filter((candidate) => readable.has(candidate.teamId));
  if (inScope.length !== 1) return null;
  const slot = inScope[0]!.workspaceSlot;
  return {
    slot:
      slot !== null && input.credentialSlots.includes(slot)
        ? slot
        : input.primarySlot,
  };
}

/** Parse, rather than prefix-match, so user-info and lookalike-host tricks fail. */
export function linearUploadUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.hostname !== LINEAR_UPLOAD_HOST || url.port !== "") return null;
    if (url.username !== "" || url.password !== "") return null;
    return url;
  } catch {
    return null;
  }
}

export function proxiedImageUrl(issueId: string, source: string): string | null {
  const url = linearUploadUrl(source);
  if (url === null) return null;
  return `${IMAGE_PROXY_PATH}?issue=${encodeURIComponent(issueId)}&src=${encodeURIComponent(url.href)}`;
}

/** Rewrite only Linear-hosted inline images. Every other markdown image stays remote. */
export function rewriteLinearImages(markdown: string, issueId: string): string {
  return markdown.replace(
    /!\[([^\]\r\n]*)\]\((https:\/\/uploads\.linear\.app\/[^\s)]+)(\s+["'][^"']*["'])?\)/g,
    (whole, alt: string, source: string, title: string | undefined) => {
      const proxy = proxiedImageUrl(issueId, source);
      return proxy === null ? whole : `![${alt}](${proxy}${title ?? ""})`;
    },
  );
}

function response(status: number, text: string): Response {
  return new Response(text, { status });
}

/**
 * Credentialed, bounded image retrieval. Fetch is injectable so policy tests
 * never open a socket; production defaults to the platform fetch here, the
 * sole non-transport backend egress sanctioned by the hygiene census.
 */
export async function fetchLinearImage(input: {
  readonly source: string;
  readonly authorization: string;
  readonly fetchImpl?: ImageFetch;
  readonly signal?: AbortSignal;
}): Promise<Response> {
  const url = linearUploadUrl(input.source);
  if (url === null) return response(403, "forbidden");

  let upstream: Response;
  try {
    const timeout = AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS);
    const signal = input.signal === undefined
      ? timeout
      : AbortSignal.any([input.signal, timeout]);
    upstream = await (input.fetchImpl ?? globalThis.fetch)(url, {
      headers: { Authorization: input.authorization },
      redirect: "manual",
      signal,
    });
  } catch {
    return response(502, "upstream failed");
  }

  if (upstream.status >= 300 && upstream.status < 400) return response(502, "redirect refused");
  if (!upstream.ok) return response(502, "upstream failed");
  const contentType = upstream.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "";
  if (!contentType.toLowerCase().startsWith("image/")) return response(502, "not an image");
  // SVG remains active XML when opened top-level. Serving it from bb's API
  // origin would give uploaded script the local-auth origin it must never get.
  if (contentType.toLowerCase() === "image/svg+xml") return response(502, "unsafe image");
  const declared = Number(upstream.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) return response(502, "image too large");
  if (upstream.body === null) return response(502, "empty image");

  const reader = upstream.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_IMAGE_BYTES) {
        await reader.cancel();
        return response(502, "image too large");
      }
      chunks.push(next.value);
    }
  } catch {
    return response(502, "upstream failed");
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=3600",
      "Content-Length": String(size),
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
