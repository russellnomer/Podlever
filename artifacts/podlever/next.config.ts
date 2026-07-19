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
