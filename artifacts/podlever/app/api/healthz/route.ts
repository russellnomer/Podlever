/**
 * app/api/healthz/route.ts — Health check endpoint
 *
 * Returns HTTP 200 immediately with no auth, no DB, no session reads.
 * Used by the Cloud Run startup probe (configured in artifact.toml).
 *
 * Why a dedicated route:
 *   The default probe hits GET / which renders the landing page — that involves
 *   iron-session cookie reads and Next.js SSR. A dedicated health check is
 *   isolated from app logic so a slow DB or broken session can never block
 *   the probe from responding.
 *
 * Deliberately minimal. Do not add auth, DB checks, or dependency probes here
 * unless you also raise the startup probe timeout in artifact.toml accordingly.
 */

export const dynamic = "force-dynamic";

export function GET(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
