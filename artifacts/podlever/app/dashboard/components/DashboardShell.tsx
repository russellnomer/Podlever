/**
 * DashboardShell.tsx — Global nav header + footer for all /dashboard pages
 *
 * Part of: PodLever
 * Created: 2026-07-26 by agent (dashboard shell — nav, help, cross-promotion)
 *
 * Server components (no client JS). Rendered by app/dashboard/layout.tsx:
 *
 *   DashboardHeader — wordmark, primary nav (Episodes · Help & FAQ · Pricing),
 *                     Admin link for owners, "Signed in as", Log out
 *   DashboardFooter — help/pricing/logout links + cross-promotion
 *                     ("More from the maker", sourced from lib/cross-promo.ts)
 *
 * Before this existed the app had no way to log out, no help entry point, and
 * no indication of who was signed in (owner feedback, 2026-07-26).
 */

import Link                    from "next/link";
import { Zap, LogOut, ShieldCheck } from "lucide-react";
import { CROSS_PROMO_LINKS }   from "@/lib/cross-promo";

interface DashboardHeaderProps {
  /** Display name from the session (Replit OIDC profile). */
  displayName: string;
  /** True when the signed-in user is the owner (shows the Admin link). */
  isOwner: boolean;
}

export function DashboardHeader({ displayName, isOwner }: DashboardHeaderProps) {
  return (
    <nav className="bg-white border-b border-gray-200">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
        {/* Wordmark + primary nav */}
        <div className="flex items-center gap-6 min-w-0">
          <Link href="/dashboard/episodes" className="flex items-center gap-2 shrink-0">
            <span className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" />
            </span>
            <span className="text-sm font-bold text-gray-900 tracking-tight">PodLever</span>
          </Link>
          <div className="hidden sm:flex items-center gap-4 text-sm text-gray-600">
            <Link href="/dashboard/episodes" className="hover:text-gray-900 transition-colors">Episodes</Link>
            <Link href="/help"               className="hover:text-gray-900 transition-colors">Help &amp; FAQ</Link>
            <Link href="/pricing"            className="hover:text-gray-900 transition-colors">Pricing</Link>
            {isOwner && (
              <Link href="/admin" className="flex items-center gap-1 text-indigo-600 hover:text-indigo-800 transition-colors">
                <ShieldCheck className="w-3.5 h-3.5" />
                Admin
              </Link>
            )}
          </div>
        </div>

        {/* Identity + logout */}
        <div className="flex items-center gap-3 shrink-0">
          <span className="hidden md:inline text-xs text-gray-500">
            Signed in as <span className="font-medium text-gray-800">{displayName}</span>
          </span>
          <a
            href="/auth/logout"
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5
                       text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900
                       transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Log out
          </a>
        </div>
      </div>
    </nav>
  );
}

export function DashboardFooter() {
  return (
    <footer className="mt-16 border-t border-gray-200 bg-white">
      <div className="max-w-6xl mx-auto px-6 py-8 grid gap-8 sm:grid-cols-2">
        {/* Product links */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">PodLever</p>
          <ul className="space-y-2 text-sm text-gray-600">
            <li><Link href="/help"    className="hover:text-gray-900 transition-colors">Help &amp; FAQ</Link></li>
            <li><Link href="/pricing" className="hover:text-gray-900 transition-colors">Plans &amp; pricing</Link></li>
            <li><a href="/auth/logout" className="hover:text-gray-900 transition-colors">Log out</a></li>
          </ul>
        </div>

        {/* Cross-promotion */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">More from the maker</p>
          <ul className="space-y-2 text-sm">
            {CROSS_PROMO_LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-600 hover:text-gray-900 transition-colors"
                >
                  {link.label}
                </a>
                <span className="text-gray-400"> — {link.description}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="border-t border-gray-100">
        <p className="max-w-6xl mx-auto px-6 py-4 text-xs text-gray-400">
          © {new Date().getFullYear()} PodLever · Built by Russell Nomer
        </p>
      </div>
    </footer>
  );
}
