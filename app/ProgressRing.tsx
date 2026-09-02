import type { CSSProperties } from "react";
import { SUB_ISSUE_CIRCUMFERENCE, subIssueArc } from "../src/select/glyph.js";

export function ProgressRing({
  done,
  total,
  color,
  size = 16,
}: {
  done: number;
  total: number;
  color: string | null;
  size?: 14 | 16;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className="bbl-completed bbl-glyph shrink-0"
      style={color === null ? undefined : ({ "--bbl": color } as CSSProperties)}
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx="8"
        cy="8"
        r="7"
        fill="none"
        strokeWidth="2"
        strokeDasharray="43.982297150257104"
        className="bbl-progress-track"
      />
      <circle
        cx="8"
        cy="8"
        r="7"
        fill="none"
        strokeWidth="2"
        strokeDasharray={SUB_ISSUE_CIRCUMFERENCE}
        strokeDashoffset={subIssueArc(done, total)}
        transform="rotate(-90 8 8)"
        stroke="var(--bbl)"
      />
    </svg>
  );
}
