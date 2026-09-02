export interface PanelSubPath {
  readonly teamKey: string | null;
  readonly identifier: string | null;
  readonly commentId: string | null;
}

/**
 * Parse the Linear panel's deliberately small deep-link grammar.
 *
 * The address bar is user input. Extra or missing segments are not a partial
 * match: they return to the list instead of opening a different issue than the
 * URL names.
 */
export function parsePanelSubPath(subPath: string): PanelSubPath {
  const parts = subPath.split("/").filter(Boolean);
  if (parts.length === 2 && parts[0] === "t" && parts[1] !== undefined) {
    return { teamKey: parts[1], identifier: null, commentId: null };
  }
  if (parts.length === 2 && parts[0] === "i" && parts[1] !== undefined) {
    return { teamKey: null, identifier: parts[1], commentId: null };
  }
  if (
    parts.length === 4 &&
    parts[0] === "i" &&
    parts[1] !== undefined &&
    parts[2] === "c" &&
    parts[3] !== undefined
  ) {
    return { teamKey: null, identifier: parts[1], commentId: parts[3] };
  }
  return { teamKey: null, identifier: null, commentId: null };
}
