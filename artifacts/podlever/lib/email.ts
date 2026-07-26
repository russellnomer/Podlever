/**
 * lib/email.ts — Outbound email via the owner's Google Workspace
 *
 * Part of: PodLever
 * Created: 2026-07-26 by agent (automated invite emails)
 * Last modified: 2026-07-26 by agent (service-account auth — no stored password)
 *
 * Two auth methods, tried in order:
 *
 *  1. SERVICE ACCOUNT (preferred — no user password stored anywhere)
 *     Gmail API + domain-wide delegation. The service account impersonates
 *     GMAIL_IMPERSONATE_USER and sends via the Gmail API with the
 *     gmail.send scope ONLY. Revocable in the Admin console at any time.
 *     Secrets:
 *       GMAIL_SERVICE_ACCOUNT_KEY — full JSON key of the service account
 *       GMAIL_IMPERSONATE_USER    — mailbox to send as, e.g. russell@russellnomer.com
 *     One-time Workspace setup:
 *       a. console.cloud.google.com → project → enable "Gmail API"
 *       b. IAM → Service Accounts → create → Keys → Add key (JSON)
 *       c. admin.google.com → Security → API controls → Domain-wide delegation
 *          → Add new → the service account's numeric Client ID
 *          → scope: https://www.googleapis.com/auth/gmail.send
 *
 *  2. SMTP APP PASSWORD (fallback)
 *     smtp.gmail.com with a Google App Password.
 *     Secrets: GMAIL_SMTP_USER, GMAIL_SMTP_APP_PASSWORD
 *
 * Either way, mail is sent AS INVITE_FROM_EMAIL (default invites@podlever.com —
 * podlever.com is a verified user-alias domain of russellnomer.com). The From
 * address must be configured under Gmail → Settings → Accounts → "Send mail as"
 * for the impersonated/SMTP user, or Gmail rewrites the From header.
 *
 * DELIVERABILITY: publish DKIM for podlever.com (Admin → Gmail → Authenticate email).
 *
 * HUMAN REVIEW NOTES:
 * - isEmailConfigured() lets callers fall back to the manual mailto flow when
 *   no method is configured — invites must never hard-fail on email.
 * - Failures return false and log; they never throw to the caller.
 */

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { JWT } from "google-auth-library";

// ─── Configuration ────────────────────────────────────────────────────────────

const SA_KEY_JSON      = process.env.GMAIL_SERVICE_ACCOUNT_KEY;
const IMPERSONATE_USER = process.env.GMAIL_IMPERSONATE_USER;
const SMTP_USER        = process.env.GMAIL_SMTP_USER;
const SMTP_PASSWORD    = process.env.GMAIL_SMTP_APP_PASSWORD;
const FROM_EMAIL       = process.env.INVITE_FROM_EMAIL ?? "invites@podlever.com";
const FROM_HEADER      = `PodLever <${FROM_EMAIL}>`;

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

function serviceAccountConfigured(): boolean {
  return Boolean(SA_KEY_JSON && IMPERSONATE_USER);
}

function smtpConfigured(): boolean {
  return Boolean(SMTP_USER && SMTP_PASSWORD);
}

/** isEmailConfigured — true when at least one send method is configured. */
export function isEmailConfigured(): boolean {
  return serviceAccountConfigured() || smtpConfigured();
}

// ─── Method 1: Gmail API via service account (domain-wide delegation) ─────────

let cachedJwt: JWT | null = null;

function getServiceAccountClient(): JWT {
  if (!cachedJwt) {
    const key = JSON.parse(SA_KEY_JSON!) as {
      client_email: string;
      private_key: string;
    };
    cachedJwt = new JWT({
      email:   key.client_email,
      key:     key.private_key,
      scopes:  [GMAIL_SEND_SCOPE],
      subject: IMPERSONATE_USER, // impersonate the Workspace user
    });
  }
  return cachedJwt;
}

/** base64url-encode a UTF-8 string (Gmail API `raw` format). */
function base64url(input: string): string {
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Build a minimal multipart/alternative RFC 822 message. */
function buildMime(to: string, subject: string, text: string, html: string): string {
  const boundary = "podlever-" + Date.now().toString(36);
  return [
    `From: ${FROM_HEADER}`,
    `To: ${to}`,
    `Reply-To: ${IMPERSONATE_USER ?? FROM_EMAIL}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    text,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    html,
    "",
    `--${boundary}--`,
  ].join("\r\n");
}

async function sendViaServiceAccount(
  to: string,
  subject: string,
  text: string,
  html: string,
): Promise<boolean> {
  try {
    const client = getServiceAccountClient();
    const raw = base64url(buildMime(to, subject, text, html));
    const res = await client.request({
      url:    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      method: "POST",
      data:   { raw },
    });
    return res.status >= 200 && res.status < 300;
  } catch (err) {
    console.error("[sendViaServiceAccount] failed:", (err as Error).message);
    return false;
  }
}

// ─── Method 2: Gmail SMTP via App Password (fallback) ─────────────────────────

let cachedTransporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport({
      host:   "smtp.gmail.com",
      port:   465,
      secure: true,
      auth:   { user: SMTP_USER, pass: SMTP_PASSWORD },
    });
  }
  return cachedTransporter;
}

async function sendViaSmtp(
  to: string,
  subject: string,
  text: string,
  html: string,
): Promise<boolean> {
  try {
    await getTransporter().sendMail({
      from:    FROM_HEADER,
      to,
      replyTo: SMTP_USER,
      subject,
      text,
      html,
    });
    return true;
  } catch (err) {
    console.error("[sendViaSmtp] failed:", (err as Error).message);
    return false;
  }
}

// ─── Invite email ─────────────────────────────────────────────────────────────

/**
 * sendInviteEmail — Send the beta invitation to an invitee.
 *
 * Tries the service account first (no stored password), then SMTP.
 *
 * @param toEmail   - the invitee's address (also the address they must enter
 *                    on /verify-access to claim the invite)
 * @param firstName - optional first name for a personal greeting ("Hi David,")
 * @returns true if the message was accepted, false on any failure
 *          (callers fall back to the manual mailto flow — never throw).
 */
export async function sendInviteEmail(toEmail: string, firstName?: string): Promise<boolean> {
  if (!isEmailConfigured()) return false;

  const subject = "Your private beta invitation to PodLever";

  const greeting = firstName?.trim() ? `Hi ${firstName.trim()},` : "Hi,";
  const text = `${greeting}

I'd like to personally invite you to the private beta of PodLever.

PodLever turns a raw podcast recording into a complete, publish-ready content package — full transcript, polished show notes, a blog post, social media posts, and a shareable guest page — in minutes, not hours.

As a beta member you get complimentary Pro-level access (10 episodes per month) at no cost for the duration of the beta.

Getting started takes about two minutes:

  1. Go to https://podlever.com/auth/login
  2. Sign in with your Replit account (free to create if you don't have one)
  3. When prompted, enter this email address (${toEmail}) to claim your invite
  4. Upload your first episode and watch the content package build itself

Beta access is limited and personal to you. Your feedback directly shapes the product — if anything is confusing or falls short, I want to hear about it.

Welcome aboard,

Russell Nomer
Founder, PodLever
https://podlever.com`;

  const htmlBody = text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/(https:\/\/[^\s)]+)/g, '<a href="$1">$1</a>')
    .replace(/\n/g, "<br/>");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#18181b;max-width:600px">${htmlBody}</div>`;

  let sent = false;
  if (serviceAccountConfigured()) {
    sent = await sendViaServiceAccount(toEmail, subject, text, html);
  }
  if (!sent && smtpConfigured()) {
    sent = await sendViaSmtp(toEmail, subject, text, html);
  }

  if (sent) {
    console.log(JSON.stringify({
      event:  "email.invite.sent",
      method: serviceAccountConfigured() ? "service_account" : "smtp",
      ts:     new Date().toISOString(),
      // recipient intentionally not logged (PII)
    }));
  }
  return sent;
}
