/**
 * lib/stripe.ts — Stripe client factory for Next.js Route Handlers
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #14 — Stripe subscriptions)
 *
 * Credential resolution order:
 *   1. STRIPE_SECRET_KEY env var (production)
 *   2. Stripe_secret_key_dev env var (dev secret in Replit Secrets)
 *   3. Replit connector proxy API
 *
 * Server-side only — never import from client components.
 */

import Stripe        from "stripe";
import { execFile }  from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function getConnectorBaseUrl(): Promise<string> {
  const h = process.env.REPLIT_CONNECTORS_HOSTNAME ?? "connectors.replit.com";
  return h.startsWith("http") ? h : `https://${h}`;
}

async function getIdentityToken(): Promise<string | null> {
  try {
    const baseUrl   = await getConnectorBaseUrl();
    const replitBin = process.env.REPLIT_CLI ?? "replit";
    const { stdout } = await execFileAsync(
      replitBin,
      ["identity", "create", "--audience", baseUrl],
      { timeout: 5_000 },
    );
    const token = stdout.trim();
    if (token) return token;
  } catch { /* CLI not available */ }

  if (process.env.REPL_IDENTITY)    return `repl ${process.env.REPL_IDENTITY}`;
  if (process.env.WEB_REPL_RENEWAL) return `depl ${process.env.WEB_REPL_RENEWAL}`;
  return null;
}

async function fetchSecretFromConnector(): Promise<string | null> {
  const token = await getIdentityToken();
  if (!token) return null;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (token.startsWith("repl ") || token.startsWith("depl ")) {
    headers["X-Replit-Token"] = token;
  } else {
    headers["Replit-Authentication"] = `Bearer ${token}`;
  }

  try {
    const baseUrl = await getConnectorBaseUrl();
    const resp    = await fetch(
      `${baseUrl}/api/v2/connection?include_secrets=true&connector_names=stripe`,
      { headers, signal: AbortSignal.timeout(8_000) },
    );
    if (!resp.ok) return null;

    const data = (await resp.json()) as {
      items?: Array<{ settings?: { secret_key?: string } }>;
    };
    return data.items?.[0]?.settings?.secret_key ?? null;
  } catch {
    return null;
  }
}

/**
 * getStripeClient — Fresh authenticated Stripe client.
 * Call on every request — never cache.
 */
export async function getStripeClient(): Promise<Stripe> {
  // 1. Production env var
  const prodKey = process.env.STRIPE_SECRET_KEY;
  if (prodKey) return new Stripe(prodKey);

  // 2. Dev secret via Replit Secrets
  const devKey = process.env.Stripe_secret_key_dev;
  if (devKey) return new Stripe(devKey);

  // 3. Connector proxy
  const connectorKey = await fetchSecretFromConnector();
  if (connectorKey) return new Stripe(connectorKey);

  throw new Error(
    "Stripe secret key not found. Set STRIPE_SECRET_KEY or Stripe_secret_key_dev in Replit Secrets.",
  );
}
