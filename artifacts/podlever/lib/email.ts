/**
 * lib/email.ts — Outbound email via the owner's Google Workspace (Gmail SMTP)
 *
 * Part of: PodLever
 * Created: 2026-07-26 by agent (automated invite emails)
 *
 * Sends transactional email through smtp.gmail.com using a Google Workspace
 * App Password. podlever.com is a verified user-alias domain of the owner's
 * russellnomer.com Workspace, so mail can be sent AS invites@podlever.com
 * while authenticating as the primary mailbox.
 *
 * REQUIRED REPLIT SECRETS (email silently disabled if missing):
 *   GMAIL_SMTP_USER          — primary mailbox, e.g. russell@russellnomer.com
 *   GMAIL_SMTP_APP_PASSWORD  — 16-char Google App Password (requires 2FA on
 *                              the Google account: myaccount.google.com/apppasswords)
 * OPTIONAL:
 *   INVITE_FROM_EMAIL        — the From: address (default invites@podlever.com).
 *                              Must be configured in Gmail → Settings →
 *                              Accounts → "Send mail as" for the SMTP user,
 *                              otherwise Gmail rewrites From: to the SMTP user.
 *
 * DELIVERABILITY NOTE: for inbox placement, ensure SPF/DKIM are set on
 * podlever.com's DNS (Google Admin → Apps → Gmail → Authenticate email).
 *
 * HUMAN REVIEW NOTES:
 * - isEmailConfigured() lets callers fall back to the manual mailto flow
 *   when secrets are absent — invites must never hard-fail on email.
 * - The transporter is created lazily and cached at module level.
 */

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

// ─── Configuration ────────────────────────────────────────────────────────────

const SMTP_USER     = process.env.GMAIL_SMTP_USER;
const SMTP_PASSWORD = process.env.GMAIL_SMTP_APP_PASSWORD;
const FROM_EMAIL    = process.env.INVITE_FROM_EMAIL ?? "invites@podlever.com";
const FROM_HEADER   = `PodLever <${FROM_EMAIL}>`;

/** isEmailConfigured — true when SMTP credentials are present. */
export function isEmailConfigured(): boolean {
  return Boolean(SMTP_USER && SMTP_PASSWORD);
}

// ─── Transporter (lazy singleton) ─────────────────────────────────────────────

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

// ─── Invite email ─────────────────────────────────────────────────────────────

/**
 * sendInviteEmail — Send the beta invitation to an invitee.
 *
 * @param toEmail - the invitee's address (also the address they must enter
 *                  on /verify-access to claim the invite)
 * @returns true if the message was accepted by Gmail, false on any failure
 *          (callers fall back to the manual mailto flow — never throw).
 */
export async function sendInviteEmail(toEmail: string): Promise<boolean> {
  if (!isEmailConfigured()) return false;

  const subject = "Your private beta invitation to PodLever";

  const text = `Hi,

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

  const html = text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/(https:\/\/[^\s)]+)/g, '<a href="$1">$1</a>')
    .replace(/\n/g, "<br/>");

  try {
    await getTransporter().sendMail({
      from:    FROM_HEADER,
      to:      toEmail,
      replyTo: SMTP_USER,
      subject,
      text,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#18181b;max-width:600px">${html}</div>`,
    });
    console.log(JSON.stringify({
      event: "email.invite.sent",
      ts:    new Date().toISOString(),
      // recipient intentionally not logged (PII)
    }));
    return true;
  } catch (err) {
    console.error("[sendInviteEmail] failed:", (err as Error).message);
    return false;
  }
}
