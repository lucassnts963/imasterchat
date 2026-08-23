import { ImageResponse } from "next/og";

// Replaces the default Next.js favicon with the iMasterChat brand mark
// — brand-red rounded square + the white `>_` terminal-prompt glyph.
//
// The geometry mirrors `src/components/brand/logo.tsx`, which this file
// deliberately does NOT import: ImageResponse renders in the edge
// runtime at build time and only handles inline JSX/SVG, not app
// components (cn/Tailwind classes never resolve here). Change one,
// change the other. Stroke weight is bumped vs the component because
// the glyph is rasterized at 32px.
//
// This route takes precedence over src/app/favicon.ico, which is the
// Next.js default and can stay on disk harmlessly (or be removed).

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#E5484D", // primary (iMasterChat / elucas.dev red)
          borderRadius: 6,
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path
            d="M6 7.5 L11 12 L6 16.5"
            stroke="#ffffff"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <rect
            x="12.6"
            y="14.4"
            width="6.4"
            height="3"
            rx="1.5"
            fill="#ffffff"
          />
        </svg>
      </div>
    ),
    { ...size },
  );
}
