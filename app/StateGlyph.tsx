import type { BbFact } from "../src/contract.js";
import type { GlyphSpec } from "../src/select/glyph.js";
import {
  ISSUE_DISC_DASH,
  ISSUE_DISC_GAP,
  ISSUE_PIE_DASH,
  ISSUE_PIE_GAP,
} from "../src/select/glyph.js";
import { toneClass, type Tone } from "../src/select/tone.js";

/**
 * One 14px glyph per state, drawn rather than imported.
 *
 * Geometry and configured colour arrive as a pure projection. Started states
 * therefore carry their position-derived fill rather than all collapsing to
 * the same half wedge.
 *
 * Every path uses `currentColor`, and the colour comes from `--bbl` on an
 * ancestor via `.bbl-glyph`. One class swap on the row recolours the glyph,
 * the identifier and the border tint together.
 *
 * `aria-hidden` throughout: the state is already in the row's accessible name,
 * and a second announcement of it is noise in a list of forty.
 */
const COMPLETED_CHECK = "M10.951 4.24896C11.283 4.58091 11.283 5.11909 10.951 5.45104L5.95104 10.451C5.61909 10.783 5.0809 10.783 4.74896 10.451L2.74896 8.45104C2.41701 8.11909 2.41701 7.5809 2.74896 7.24896C3.0809 6.91701 3.61909 6.91701 3.95104 7.24896L5.35 8.64792L9.74896 4.24896C10.0809 3.91701 10.6191 3.91701 10.951 4.24896Z";
const CANCELED_X = "M3.73657 3.73657C4.05199 3.42114 4.56339 3.42114 4.87881 3.73657L5.93941 4.79716L7 5.85775L9.12117 3.73657C9.4366 3.42114 9.94801 3.42114 10.2634 3.73657C10.5789 4.05199 10.5789 4.56339 10.2634 4.87881L8.14225 7L10.2634 9.12118C10.5789 9.4366 10.5789 9.94801 10.2634 10.2634C9.94801 10.5789 9.4366 10.5789 9.12117 10.2634L7 8.14225L4.87881 10.2634C4.56339 10.5789 4.05199 10.5789 3.73657 10.2634C3.42114 9.94801 3.42114 9.4366 3.73657 9.12118L4.79716 8.06059L5.85775 7L3.73657 4.87881C3.42114 4.56339 3.42114 4.05199 3.73657 3.73657Z";

export function StateGlyph({
  tone,
  glyph,
  className,
}: {
  tone: Tone;
  glyph: GlyphSpec;
  className?: string;
}) {
  const color = glyph.color ?? "currentColor";
  return (
    <svg
      viewBox="0 0 14 14"
      width="14"
      height="14"
      fill="none"
      className={`${toneClass(tone)} bbl-glyph shrink-0 ${className ?? ""}`}
      aria-hidden
      focusable="false"
    >
      <circle
        cx="7"
        cy="7"
        r="6"
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeDasharray={glyph.ring === "dashed" ? "1.4 1.74" : "3.14 0"}
        strokeDashoffset={glyph.ring === "dashed" ? "0.65" : "-0.7"}
      />
      {glyph.pie !== null ? (
        <circle
          cx="7"
          cy="7"
          r="2"
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeDasharray={`${ISSUE_PIE_DASH} ${ISSUE_PIE_GAP}`}
          strokeDashoffset={ISSUE_PIE_DASH * (1 - glyph.pie)}
          transform="rotate(-90 7 7)"
        />
      ) : null}
      {glyph.disc ? (
        <circle
          cx="7"
          cy="7"
          r="3"
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeDasharray={`${ISSUE_DISC_DASH} ${ISSUE_DISC_GAP}`}
          strokeDashoffset="0"
          transform="rotate(-90 7 7)"
        />
      ) : null}
      {glyph.mark === "check" ? <path d={COMPLETED_CHECK} fill="var(--background)" /> : null}
      {glyph.mark === "x" ? <path d={CANCELED_X} fill="var(--background)" /> : null}
      {glyph.mark === "dot" ? <circle cx="7" cy="7" r="1.5" fill={color} /> : null}
    </svg>
  );
}

/**
 * The bb-native lead: what bb knows about an issue that Linear cannot.
 *
 * Deliberately drawn from the same 14px grid as the state glyph so the two
 * lead columns line up when the grouping changes and the column swaps meaning.
 * `none` renders an empty box rather than nothing, so rows do not shift
 * horizontally as facts arrive.
 */
export function BbFactGlyph({ fact }: { fact: BbFact }) {
  const label = BB_FACT_LABEL[fact];
  return (
    <svg
      viewBox="0 0 14 14"
      width="14"
      height="14"
      className={`${fact === "none" ? "bbl-neutral" : "bbl-started"} bbl-glyph shrink-0`}
      aria-hidden
      focusable="false"
      data-fact={label}
    >
      {fact === "thread-running" ? (
        <>
          <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="7" cy="7" r="2.4" fill="currentColor">
            <animate
              attributeName="opacity"
              values="1;0.35;1"
              dur="1.8s"
              repeatCount="indefinite"
            />
          </circle>
        </>
      ) : null}

      {fact === "thread-idle" ? (
        <>
          <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="7" cy="7" r="2.4" fill="currentColor" />
        </>
      ) : null}

      {/* git's own glyph vocabulary, borrowed rather than reinvented: a branch
          is two nodes and a curve, a pull request adds the arrow. */}
      {fact === "branch" || fact === "pull-request" ? (
        <>
          <circle cx="4" cy="3" r="1.7" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="4" cy="11" r="1.7" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M4 4.7v4.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          {fact === "pull-request" ? (
            <>
              <circle
                cx="10.5"
                cy="3"
                r="1.7"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
              />
              <path
                d="M10.5 4.7v3.1a2 2 0 0 1-2 2H5.9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </>
          ) : null}
        </>
      ) : null}
    </svg>
  );
}

const BB_FACT_LABEL: Record<BbFact, string> = {
  "thread-running": "thread running",
  "thread-idle": "thread",
  "pull-request": "pull request",
  branch: "branch",
  none: "",
};

export function describeBbFact(fact: BbFact): string {
  return BB_FACT_LABEL[fact];
}
