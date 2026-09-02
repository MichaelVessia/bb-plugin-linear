import { useId } from "react";
import type { ProjectGlyphSpec } from "../src/select/glyph.js";

const OUTLINE = "M2.95778 3.02069L5.70777 1.36023C6.50244 0.88041 7.49756 0.88041 8.29223 1.36024L11.0422 3.02074C11.7918 3.47336 12.25 4.2852 12.25 5.16086V8.84803C12.25 9.7251 11.7904 10.5381 11.0388 10.9902L8.29114 12.6433C7.49693 13.1211 6.50355 13.1203 5.71011 12.6412L2.95775 10.9792C2.20815 10.5266 1.75 9.7148 1.75 8.83911V5.16082C1.75 4.28516 2.20816 3.47332 2.95778 3.02069Z";
const MASK = "M8.3779 4.74233C8.14438 4.60607 7.85562 4.60607 7.6221 4.74233L5.37209 6.05513C5.14168 6.18957 5 6.4363 5 6.70311V9.34216C5 9.60897 5.14168 9.85573 5.37209 9.99016L7.6221 11.303C7.85562 11.4392 8.14438 11.4392 8.3779 11.303L10.6279 9.99016C10.8583 9.85573 11 9.60897 11 9.34216V6.70311C11 6.4363 10.8583 6.18957 10.6279 6.05513L8.3779 4.74233Z";
const CHECK = "M10.7803 5.28033C11.0732 4.98744 11.0732 4.51256 10.7803 4.21967C10.4874 3.92678 10.0126 3.92678 9.7197 4.21967L5.75 8.18934L4.28033 6.71967C3.98744 6.42678 3.51256 6.42678 3.21967 6.71967C2.92678 7.01256 2.92678 7.48744 3.21967 7.78033L5.21967 9.7803C5.51256 10.0732 5.98744 10.0732 6.28033 9.7803L10.7803 5.28033Z";

export function ProjectGlyph({ glyph, className }: { glyph: ProjectGlyphSpec; className?: string }) {
  const maskId = `bbl-project-${useId().replace(/:/g, "")}`;
  const color = glyph.color ?? "currentColor";
  return (
    <svg
      width="16"
      height="16"
      viewBox="-1 -1 16 16"
      className={`bbl-neutral bbl-glyph shrink-0 ${className ?? ""}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <mask id={maskId}>
          <path d={MASK} transform="translate(-1, -1)" fill="white" />
        </mask>
      </defs>
      <path
        d={OUTLINE}
        stroke={color}
        strokeWidth="1.5"
        fill="none"
        strokeDasharray={glyph.type === "backlog" ? "1.65 1.35" : "3.14 0"}
        strokeDashoffset={glyph.type === "backlog" ? "2.3" : "1"}
      />
      <g mask={`url(#${maskId})`}>
        <circle
          r="4"
          cx="7"
          cy="7"
          stroke={color}
          fill="none"
          strokeWidth="8"
          strokeDasharray={`${glyph.progress * 25.12} 25.12`}
          transform="rotate(-90) translate(-14, 0)"
        />
      </g>
      {glyph.type === "completed" ? <path d={CHECK} fill="var(--background)" /> : null}
    </svg>
  );
}
