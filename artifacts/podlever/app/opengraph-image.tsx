/**
 * app/opengraph-image.tsx — Dynamic OG image for the PodLever root route
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #13 — SEO/OG)
 *
 * Next.js 15 file-based OG image generation using ImageResponse.
 * Served at /opengraph-image (1200×630px) and referenced in layout metadata.
 *
 * Design:
 *   - Dark background (#0D0D0F) matching the site brand
 *   - Amber/gold accent (#F59E0B) for the primary visual element
 *   - Bold headline + tagline + PodLever brand mark
 *   - Waveform bars decorative element (the logo concept)
 *
 * HUMAN REVIEW NOTES:
 * ImageResponse uses a subset of CSS (flex, basic box model). No Tailwind
 * classes — all styles are inline objects with React-native-like syntax.
 * Fonts must be loaded explicitly; we use system-ui as a safe fallback
 * (Inter would require fetching from Google Fonts, which adds latency).
 */

import { ImageResponse } from "next/og";

// ─── OG image dimensions (LinkedIn/Twitter standard) ─────────────────────────

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// ─── Image generation ─────────────────────────────────────────────────────────

/**
 * OGImage — Generates the 1200×630 Open Graph image for the landing page.
 *
 * Rendered at build time and cached. No runtime data fetching.
 */
export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width:           "100%",
          height:          "100%",
          background:      "#0D0D0F",
          display:         "flex",
          flexDirection:   "column",
          alignItems:      "center",
          justifyContent:  "center",
          fontFamily:      "system-ui, -apple-system, sans-serif",
          position:        "relative",
          overflow:        "hidden",
        }}
      >
        {/* Ambient glow */}
        <div
          style={{
            position:     "absolute",
            top:          "50%",
            left:         "50%",
            transform:    "translate(-50%, -50%)",
            width:        800,
            height:       500,
            background:   "radial-gradient(ellipse at center, rgba(245,158,11,0.12) 0%, transparent 70%)",
            borderRadius: "50%",
          }}
        />

        {/* Grid dots */}
        <div
          style={{
            position:            "absolute",
            inset:               0,
            backgroundImage:     "radial-gradient(circle, rgba(255,255,255,0.04) 1.5px, transparent 1.5px)",
            backgroundSize:      "60px 60px",
          }}
        />

        {/* Content */}
        <div
          style={{
            position:      "relative",
            display:       "flex",
            flexDirection: "column",
            alignItems:    "center",
            gap:           32,
            padding:       "0 80px",
            textAlign:     "center",
          }}
        >
          {/* Logo mark */}
          <div
            style={{
              display:        "flex",
              alignItems:     "center",
              gap:            16,
              marginBottom:   8,
            }}
          >
            {/* Waveform bars */}
            <div
              style={{
                display:        "flex",
                alignItems:     "center",
                gap:            5,
                padding:        "10px 14px",
                background:     "rgba(245,158,11,0.08)",
                border:         "1.5px solid rgba(245,158,11,0.2)",
                borderRadius:   12,
              }}
            >
              {[16, 32, 48, 28, 8].map((h, i) => (
                <div
                  key={i}
                  style={{
                    width:        7,
                    height:       h,
                    background:   "#F59E0B",
                    borderRadius: 4,
                    opacity:      0.8 + i * 0.04,
                  }}
                />
              ))}
            </div>
            <span
              style={{
                fontSize:   42,
                fontWeight: 800,
                color:      "#FFFFFF",
                letterSpacing: "-1px",
              }}
            >
              PodLever
            </span>
          </div>

          {/* Headline */}
          <div
            style={{
              display:       "flex",
              flexDirection: "column",
              alignItems:    "center",
              gap:           12,
            }}
          >
            <h1
              style={{
                fontSize:      72,
                fontWeight:    800,
                lineHeight:    1.05,
                color:         "#FFFFFF",
                letterSpacing: "-2px",
                margin:        0,
              }}
            >
              One recording.{" "}
              <span style={{ color: "#F59E0B" }}>A complete</span>
              {"\n"}content library.
            </h1>
            <p
              style={{
                fontSize:   28,
                color:      "#71717A",
                lineHeight: 1.4,
                margin:     0,
                maxWidth:   800,
              }}
            >
              Transcript · Show notes · Blog post · Social clips · Guest media pack
            </p>
          </div>

          {/* CTA label */}
          <div
            style={{
              display:        "flex",
              alignItems:     "center",
              gap:            12,
              padding:        "12px 28px",
              background:     "#F59E0B",
              borderRadius:   12,
              marginTop:      8,
            }}
          >
            <span
              style={{
                fontSize:   24,
                fontWeight: 700,
                color:      "#0D0D0F",
              }}
            >
              Early access open — podlever.replit.app
            </span>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
