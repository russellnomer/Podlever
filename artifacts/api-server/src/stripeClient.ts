/**
 * stripeClient.ts — Stripe SDK + StripeSync factory for the API server
 *
 * Part of: PodLever API Server
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Task #14 — Stripe subscriptions)
 *
 * Credential resolution order:
 *   1. STRIPE_SECRET_KEY env var (production secret)
 *   2. Stripe_secret_key_dev env var (dev secret added via Replit Secrets)
 *   3. Replit connector proxy API (fallback)
 *
 * SECURITY: Keys never logged. getUncachableStripeClient() must be called
 * fresh on every request — do not cache the returned client.
 */

import Stripe        from "stripe";
import { StripeSync } from "stripe-replit-sync";
import { execFile }  from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ─── Connector proxy helpers ──────────────────────────────────────────────────

async function getConnectorBaseUrl(): Promise<string> {
  const h = process.env.REPLIT_CONNECTORS_HOSTNAME ?? "connectors.replit.com";
  return h.startsWith("http") ? h : `https://${h}`;
}

async function getIdentityToken(): Promise<string | null> {
  // Try CLI first
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

  if (process.env.REPL_IDENTITY)   return `repl ${process.env.REPL_IDENTITY}`;
  if (process.env.WEB_REPL_RENEWAL) return `depl ${process.env.WEB_REPL_RENEWAL}`;
  return null;
}

async function fetchFromConnector(): Promise<{ secretKey: string; webhookSecret?: string } | null> {
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
      items?: Array<{ settings?: { secret_key?: string; webhook_secret?: string } }>;
    };
    const s = data.items?.[0]?.settings;
    if (!s?.secret_key) return null;

    return { secretKey: s.secret_key, webhookSecret: s.webhook_secret };
  } catch {
    return null;
  }
}

// ─── Credential resolution ────────────────────────────────────────────────────

interface StripeCredentials { secretKey: string; webhookSecret?: string }

export async function getStripeCredentials(): Promise<StripeCredentials> {
  // 1. Production secret (STRIPE_SECRET_KEY)
  const prodKey = process.env.STRIPE_SECRET_KEY;
  if (prodKey) return { secretKey: prodKey, webhookSecret: process.env.STRIPE_WEBHOOK_SECRET };

  // 2. Dev secret added via Replit Secrets panel
  const devKey = process.env.Stripe_secret_key_dev;
  if (devKey) return { secretKey: devKey, webhookSecret: process.env.Stripe_webhook_secret_dev };

  // 3. Replit connector proxy
  const connector = await fetchFromConnector();
  if (connector) return connector;

  throw new Error(
    "Stripe secret key not found. Set STRIPE_SECRET_KEY or Stripe_secret_key_dev in Replit Secrets.",
  );
}

// ─── Factories ─────────────────────────────────────────────────────────────────

/** Fresh Stripe client — call on every request, never cache. */
export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getStripeCredentials();
  return new Stripe(secretKey);
}

/** Fresh StripeSync instance. */
export async function getStripeSync(): Promise<StripeSync> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const { secretKey, webhookSecret } = await getStripeCredentials();
  return new StripeSync({
    poolConfig:          { connectionString: databaseUrl },
    stripeSecretKey:     secretKey,
    stripeWebhookSecret: webhookSecret ?? "",
  });
}
