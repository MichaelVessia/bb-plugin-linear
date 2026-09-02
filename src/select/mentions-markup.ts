/**
 * Linear stores user mentions as markdown links to opaque user ids. Those ids
 * are not destinations in bb, so keep the visible name and remove the false
 * affordance while retaining enough emphasis to read as a mention.
 */
export function renderMentions(markdown: string): string {
  // A display name is text, not markdown: emphasis markers inside it would
  // otherwise close the bold early and bleed into the surrounding body.
  return markdown.replace(
    /@\[([^\]\r\n]+)\]\([A-Za-z0-9_-]{1,128}\)/g,
    (_match, name: string) => `**@${name.replace(/([*_`~\\])/g, "\\$1")}**`,
  );
}
