import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { WebhookHandlers } from "./webhookHandlers";
import { logger } from "./lib/logger";

const app: Express = express();

// ── Stripe webhook route — MUST be registered BEFORE express.json() ───────────
// Stripe requires the raw Buffer to verify the signature; express.json() would
// parse it first and break verification.
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (!signature) {
      res.status(400).json({ error: "Missing stripe-signature header" });
      return;
    }
    const sig = Array.isArray(signature) ? signature[0] : signature;

    if (!Buffer.isBuffer(req.body)) {
      logger.error("Webhook body is not a Buffer — express.json() ran first");
      res.status(500).json({ error: "Webhook processing error" });
      return;
    }

    try {
      await WebhookHandlers.processWebhook(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (err: unknown) {
      logger.error({ err }, "Stripe webhook error");
      res.status(400).json({ error: "Webhook processing error" });
    }
  },
);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// ── Security headers + CORS (OWASP baseline, 2026-07-27) ─────────────────────
// The browser reaches this server same-origin through the workspace proxy at
// podlever.com/api/*, so CORS can be restricted to our own origins. Requests
// with no Origin header (server-to-server, curl, Stripe webhooks) are allowed.
const ALLOWED_ORIGINS = [
  "https://podlever.com",
  "https://www.podlever.com",
];
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || ALLOWED_ORIGINS.includes(origin) || /\.replit\.dev$/.test(new URL(origin).hostname)) {
        callback(null, true);
      } else {
        callback(null, false); // no CORS headers → browser blocks cross-origin use
      }
    },
  }),
);
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  next();
});
app.disable("x-powered-by");
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
