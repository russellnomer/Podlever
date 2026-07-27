/**
 * app/admin/page.tsx — Owner admin hub
 *
 * Part of: PodLever
 * Created: 2026-07-26 by agent (admin console navigation hub)
 *
 * Route: /admin (owner-only)
 *
 * Single landing page linking to every admin surface, so the owner only
 * has to remember one URL. Non-owners are redirected away.
 *
 * Security: requireOwnerFromSession() — redirects non-owners.
 */

import { redirect }                from "next/navigation";
import Link                        from "next/link";
import { getAuthUser }             from "@/providers/auth";
import { requireOwnerFromSession } from "@/providers/owner-guard";
import {
  ArrowLeft,
  Users,
  Mail,
  BarChart3,
  DollarSign,
  ListVideo,
  MessageSquareText,
  ShieldAlert,
} from "lucide-react";

// ─── Menu definition ──────────────────────────────────────────────────────────

const MENU = [
  {
    href:  "/admin/users",
    title: "Demo & Beta Users",
    desc:  "Usage vs caps, per-user cost, deal notes, suspend / reinstate access",
    icon:  ShieldAlert,
    color: "text-red-600 bg-red-50",
  },
  {
    href:  "/admin/waitlist",
    title: "Waitlist & Invites",
    desc:  "Invite anyone by email, review access requests, send the invite email",
    icon:  Mail,
    color: "text-indigo-600 bg-indigo-50",
  },
  {
    href:  "/admin/analytics",
    title: "Analytics",
    desc:  "Signups, activation funnel, UTM sources, daily trends",
    icon:  BarChart3,
    color: "text-blue-600 bg-blue-50",
  },
  {
    href:  "/admin/cogs",
    title: "COGS",
    desc:  "What each processed episode costs you (transcription + AI)",
    icon:  DollarSign,
    color: "text-green-600 bg-green-50",
  },
  {
    href:  "/dashboard/admin/episodes",
    title: "All Episodes",
    desc:  "Every episode across all users — status, owner, processing state",
    icon:  ListVideo,
    color: "text-purple-600 bg-purple-50",
  },
  {
    href:  "/admin/feedback",
    title: "Feedback Inbox",
    desc:  "Bug reports and feedback submitted through the in-app widget",
    icon:  MessageSquareText,
    color: "text-amber-600 bg-amber-50",
  },
] as const;

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function AdminHubPage() {
  const auth = await getAuthUser();
  if (!auth) redirect("/auth/login");
  await requireOwnerFromSession(auth);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">

        {/* Header */}
        <div className="mb-8 flex items-center gap-3">
          <Link
            href="/dashboard"
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Admin Console</h1>
            <p className="text-sm text-gray-500">Owner-only controls for PodLever</p>
          </div>
        </div>

        {/* Menu */}
        <div className="grid gap-4 sm:grid-cols-2">
          {MENU.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="group rounded-xl border border-gray-200 bg-white p-5 shadow-sm
                           transition-all hover:border-indigo-300 hover:shadow-md"
              >
                <div className={`mb-3 inline-flex rounded-lg p-2 ${item.color}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <h2 className="font-semibold text-gray-900 group-hover:text-indigo-700">
                  {item.title}
                </h2>
                <p className="mt-1 text-sm text-gray-500">{item.desc}</p>
              </Link>
            );
          })}

          {/* Back to product */}
          <Link
            href="/dashboard"
            className="group rounded-xl border border-dashed border-gray-300 bg-gray-50 p-5
                       transition-all hover:border-gray-400"
          >
            <div className="mb-3 inline-flex rounded-lg bg-gray-100 p-2 text-gray-500">
              <Users className="h-5 w-5" />
            </div>
            <h2 className="font-semibold text-gray-700">Your Dashboard</h2>
            <p className="mt-1 text-sm text-gray-500">
              Back to the product — your own episodes and uploads
            </p>
          </Link>
        </div>
      </div>
    </div>
  );
}
