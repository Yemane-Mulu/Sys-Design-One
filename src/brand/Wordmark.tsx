import { useMemo } from "react";
import { brand } from "./tokens";
import { useProjectStore } from "../store/projectStore";
import {
  loadStickyBranding,
  resolveBranding,
  type BrandingConfig,
} from "../lib/branding";

interface WordmarkProps {
  size?: "sm" | "md" | "lg";
  showTagline?: boolean;
  className?: string;
  /** Override branding (e.g. for testing / preview chips). When omitted
   *  we read the active project's branding, falling back to the
   *  cross-session sticky copy in localStorage so the StartScreen still
   *  shows the user's identity even before they open a project. */
  branding?: BrandingConfig;
}

const SIZE = {
  sm: { mono: 18, knox: 14, tag: 8 },
  md: { mono: 28, knox: 20, tag: 9 },
  lg: { mono: 40, knox: 28, tag: 11 },
} as const;

/**
 * Resolve the branding for the editor shell. Pulls from `Project.branding`
 * when a project is open; otherwise falls back to the user's sticky brand
 * (saved to localStorage on every `setBranding` call) so the StartScreen
 * + login flow already reflect their company.
 */
function useShellBranding(override?: BrandingConfig): BrandingConfig {
  const projectBranding = useProjectStore((s) => s.project?.branding);
  return useMemo(() => {
    if (override) return override;
    return resolveBranding(projectBranding ?? loadStickyBranding());
  }, [override, projectBranding]);
}

/**
 * Brand monogram. Renders the user's uploaded logo when present, and
 * otherwise falls back to the bundled DesignOne D1 tile — a rounded
 * midnight square with a white D and amber 1, matching the favicon and
 * the print monogram. Upload a logo in `Settings → Branding → Logo` to
 * replace it everywhere.
 */
function DefaultD1Mark({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      style={{ flex: "0 0 auto" }}
    >
      <rect
        x="2"
        y="2"
        width="60"
        height="60"
        rx="14"
        fill="#0B1220"
        stroke="#C99227"
        strokeWidth="2"
      />
      <path
        d="M19 17 v30 M19 17 h5 a15 15 0 0 1 0 30 h-5"
        stroke="#F5F7FA"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M38 23 l6 -6 M44 17 v30"
        stroke="#F4B740"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export function Monogram({
  size = 28,
  branding: brandingOverride,
}: {
  size?: number;
  branding?: BrandingConfig;
}) {
  const branding = useShellBranding(brandingOverride);
  if (branding.logoDataUrl) {
    return (
      <img
        src={branding.logoDataUrl}
        alt="Brand mark"
        width={size}
        height={size}
        style={{ width: size, height: size, objectFit: "contain" }}
      />
    );
  }
  return <DefaultD1Mark size={size} />;
}

/**
 * Brand wordmark — the dual-tone lockup ("DESIGN·ONE" by default) plus an
 * optional small-caps tagline. Both halves of the wordmark are
 * customizable via the Branding panel; either can be empty.
 *
 * The tagline auto-splits at " · " or " " into two lines for the
 * vertical lockup styling. Single-word taglines render as one line.
 */
export function Wordmark({
  size = "md",
  showTagline = true,
  className = "",
  branding: brandingOverride,
}: WordmarkProps) {
  const s = SIZE[size];
  const branding = useShellBranding(brandingOverride);
  const wmA = branding.wordmarkPrimary;
  const wmB = branding.wordmarkSecondary;
  const taglineLines = splitTagline(branding.tagline);
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <Monogram size={s.mono} branding={branding} />
      <div className="flex items-center gap-3 leading-none">
        <div
          className="font-extrabold tracking-wordmark text-ink-50"
          style={{ fontSize: s.knox }}
        >
          {wmA}
          {wmB && (
            <span
              className="font-light"
              style={{ color: branding.accentColor }}
            >
              {wmB}
            </span>
          )}
        </div>
        {showTagline && taglineLines.length > 0 && (
          <div
            className="border-l border-ink-500 pl-3 font-mono uppercase text-ink-300"
            style={{ fontSize: s.tag, lineHeight: 1.1, letterSpacing: "0.15em" }}
          >
            {taglineLines.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Break a tagline into the 2-line lockup format the bundled identity
 *  uses. We split on " · " or whitespace, capping at two lines so longer
 *  taglines render as one line instead of stacking weirdly. */
function splitTagline(tagline: string): string[] {
  const t = (tagline ?? "").trim();
  if (!t) return [];
  // Prefer splitting on the bullet separator that the bundled defaults use
  if (t.includes(" · ")) {
    const parts = t.split(" · ").map((p) => p.trim()).filter(Boolean);
    if (parts.length === 2) return parts;
  }
  // Two-word taglines look great stacked ("Security / Systems"); longer
  // strings render as a single line.
  const words = t.split(/\s+/);
  if (words.length === 2) return words;
  return [t];
}

export { brand };
