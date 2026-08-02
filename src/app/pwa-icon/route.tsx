import { ImageResponse } from 'next/og'

// ============================================================
// The home-screen icon, at whatever size the manifest asks for.
//
// Generated rather than checked in as PNGs, for the same reason
// `src/app/icon.tsx` is: the mark is twelve lines of SVG, and two
// binary files in `public/` would drift from it the first time the
// brand changes. The geometry here mirrors that file and
// `src/components/brand/logo.tsx` — change one, change all three.
//
// `maskable` pads the glyph into the safe zone Android crops to. The
// spec reserves the outer 20% on every side; a mark drawn edge to edge
// gets its corners sliced off on a device that uses circular icons.
// ============================================================

export const runtime = 'edge'

const BRAND = '#E5484D'

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const requested = Number(params.get('size'))
  // Clamp: this endpoint is public, and an unbounded size is an easy
  // way to ask the server to render a 20000px image.
  const size =
    Number.isFinite(requested) && requested >= 48 && requested <= 1024
      ? Math.floor(requested)
      : 512
  const maskable = params.get('maskable') === '1'

  // Inside the safe zone for maskable, edge to edge otherwise.
  const glyph = Math.round(size * (maskable ? 0.44 : 0.62))
  const stroke = Math.max(2, Math.round(glyph * 0.125))

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: BRAND,
          // A maskable icon must fill its whole canvas — the platform
          // rounds it. Rounding it ourselves too would show background
          // through the corners.
          borderRadius: maskable ? 0 : Math.round(size * 0.18),
        }}
      >
        <svg width={glyph} height={glyph} viewBox="0 0 24 24" fill="none">
          <path
            d="M6 7.5 L11 12 L6 16.5"
            stroke="#ffffff"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <rect x="12.6" y="14.4" width="6.4" height="3" rx="1.5" fill="#ffffff" />
        </svg>
      </div>
    ),
    {
      width: size,
      height: size,
      headers: {
        // Immutable per (size, maskable) pair: the mark only changes on
        // a deploy, and a home-screen icon refetched on every launch is
        // a request nobody needs.
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    },
  )
}
