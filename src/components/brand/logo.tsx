import { cn } from "@/lib/utils";

// ============================================================
// iMasterChat brand mark.
//
// The glyph is a terminal prompt — a chevron plus a block cursor
// (`>_`) — not the generic chat bubble the upstream template used.
// It reads as "conversation" (the chevron doubles as a reply arrow)
// while carrying the elucas.dev CLI motif the rest of the brand
// leans on.
//
// Geometry lives here AND is mirrored in `src/app/icon.tsx`, which
// can't import this component: the favicon is rendered by next/og's
// ImageResponse at build time in the edge runtime, where only inline
// JSX/SVG is available. Change one, change the other.
// ============================================================

interface LogoMarkProps {
  /** Extra classes for the glyph itself (size, color). */
  className?: string;
}

/** The bare `>_` glyph. Inherits `currentColor`. */
export function LogoMark({ className }: LogoMarkProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={cn("h-4 w-4", className)}
      aria-hidden="true"
    >
      <path
        d="M6 7.5 L11 12 L6 16.5"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="12.6" y="14.6" width="6.4" height="2.6" rx="1.3" fill="currentColor" />
    </svg>
  );
}

interface LogoBadgeProps {
  /** Extra classes for the rounded container (size, radius). */
  className?: string;
  /** Extra classes for the glyph. */
  markClassName?: string;
}

/**
 * The mark inside its brand-red rounded square — the lockup used in
 * the sidebar, auth screens, and anywhere the app needs to identify
 * itself in one tile.
 */
export function LogoBadge({ className, markClassName }: LogoBadgeProps) {
  return (
    <div
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground",
        className,
      )}
    >
      <LogoMark className={markClassName} />
    </div>
  );
}
