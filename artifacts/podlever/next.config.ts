/**
 * next.config.ts — Next.js 15 App Router configuration for PodLever
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent
 *
 * Dependencies: next
 *
 * HUMAN REVIEW NOTES:
 * PORT binding is handled via the dev/start script flags (-p ${PORT:-3000} -H 0.0.0.0).
 * Replit's preview proxy connects to localhost on the assigned port; binding to 0.0.0.0
 * ensures the server is reachable through the Replit proxied iframe.
 *
 * Platform findings from T2 (Environment Discovery) will be recorded in
 * docs/adr/0001-architecture.md. Any Next.js platform-specific settings
 * discovered during T2 should be added here with an explanatory comment.
 */

import type { NextConfig } from "next";

/**
 * SECURITY_HEADERS — OWASP Secure Headers baseline (2026-07-27).
 *
 * CSP notes:
 * - No third-party scripts/fonts exist in the app (verified via repo grep),
 *   so script-src stays first-party. Next.js requires 'unsafe-inline' for its
 *   inline bootstrap scripts (nonce-based CSP is a future hardening step).
 * - storage.googleapis.com is allowed for connect-src (direct browser uploads
 *   via GCS signed URLs) and img/media-src (episode audio playback).
 * - frame-ancestors 'none' replaces X-Frame-Options (still sent for legacy).
 * - If a future feature embeds an external script (analytics, Stripe.js),
 *   its origin MUST be added here or the feature silently breaks.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://storage.googleapis.com",
  "media-src 'self' blob: https://storage.googleapis.com",
  "connect-src 'self' https://storage.googleapis.com",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  // Do not advertise the framework (removes `x-powered-by: Next.js`).
  poweredByHeader: false,

  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },

  // Allow Next.js dev server to serve /_next/* resources to the Replit proxy domain.
  // Without this, the dev server emits a cross-origin warning and future Next.js versions
  // will block these requests entirely. The Replit proxy relays from the public dev domain
  // to the local dev server, so its hostname must be explicitly trusted.
  allowedDevOrigins: [
    // Replit dev domain auto-injected by Replit into the container.
    // Format: <repl-id>-00-<slug>.<cluster>.replit.dev
    ...(process.env.REPLIT_DEV_DOMAIN ? [process.env.REPLIT_DEV_DOMAIN] : []),
    // Wildcard fallback for any Replit dev subdomain (covers both dev and preview domains).
    "*.replit.dev",
    "*.repl.co",
  ],

  // Bundled ffmpeg/ffprobe static binaries: these packages resolve absolute
  // paths to real executables at runtime and must NOT be inlined by webpack
  // (it would try to parse the binaries/README as modules and break the build).
  serverExternalPackages: [
    "@ffmpeg-installer/ffmpeg",
    "@ffprobe-installer/ffprobe",
  ],

  experimental: {
    // Allow Server Actions to receive audio file uploads up to 50MB.
    // Podcast episodes for beta are capped at 25MB (OpenAI Whisper limit)
    // but we add headroom for the multipart envelope.
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },

  // TypeScript and ESLint: fail builds on errors (default in Next.js 15)
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    // Allow production builds even with ESLint warnings during Phase 1A
    // (no ESLint config is set up yet; remove this once lint is configured)
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
