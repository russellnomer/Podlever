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

const nextConfig: NextConfig = {
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
