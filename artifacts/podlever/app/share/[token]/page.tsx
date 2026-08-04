/**
 * app/share/[token]/page.tsx — Public shareable episode page
 *
 * Part of: PodLever
 * Created: 2026-07-19
 * Last modified: 2026-07-19 by agent (Board priority — viral shareable links)
 *
 * Route: /share/[token] (public — no auth required)
 *
 * Displays a read-only view of a podcast episode's show notes and transcript.
 * Drives viral growth via:
 *   - "Powered by PodLever" watermark on every shared page
 *   - CTA: "Get your content suite at podlever.com"
 *   - OG meta tags for social sharing previews
 *
 * The share_token is a UUID, random — not guessable, not sequential.
 * No episode ID, owner ID, or user data is exposed.
 *
 * SECURITY: read-only, no auth. Only show_notes + transcript visible.
 *           Episode owner identity is NOT displayed.
 */

import type { Metadata }      from "next";
import Link                   from "next/link";
import { notFound }           from "next/navigation";
import { db }                 from "@/db";
import { episodes }           from "@/db/schema";
import { eq }                 from "drizzle-orm";
import { assetRepository }    from "@/repositories";
import { Mic2, FileText, BookOpen, Sparkles } from "lucide-react";

// ─── Metadata (for OG/social cards) ──────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;

  const [episode] = await db
    .select({ title: episodes.title, id: episodes.id })
    .from(episodes)
    .where(eq(episodes.shareToken, token as unknown as string))
    .limit(1);

  if (!episode) return { title: "Episode not found · PodLever" };

  // Pull show notes for a real og:description — first 160 chars gives social
  // previews meaningful content instead of the generic boilerplate.
  let description = "AI-generated podcast content suite — show notes, blog post, social copy, and more.";
  try {
    const { assetRepository } = await import("@/repositories");
    const assets    = await assetRepository.listAssetsForEpisode(episode.id);
    const showNotes = assets.find((a) => a.assetType === "show_notes")?.content;
    if (showNotes) {
      // Strip markdown headings/bullets from the first 200 chars, then trim to 160
      const plainText = showNotes
        .replace(/^#+\s+/gm, "")
        .replace(/^[-*]\s+/gm, "")
        .replace(/\*\*/g, "")
        .trim();
      const snippet = plainText.slice(0, 160).replace(/\s+$/, "");
      if (snippet.length > 40) description = snippet + (plainText.length > 160 ? "…" : "");
    }
  } catch { /* non-fatal — fall back to generic description */ }

  const canonicalUrl = `https://podlever.com/share/${token}`;

  return {
    title:       `${episode.title} · PodLever`,
    description,
    openGraph: {
      type:        "article",
      url:         canonicalUrl,
      title:       `${episode.title} · PodLever`,
      description,
      siteName:    "PodLever",
      images: [{
        url:   "https://podlever.com/og-default.png",
        width:  1200,
        height:  630,
        alt:   `${episode.title} — AI-generated podcast content by PodLever`,
      }],
    },
    twitter: {
      card:        "summary_large_image",
      title:       `${episode.title} · PodLever`,
      description,
      images:      ["https://podlever.com/og-default.png"],
    },
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function SharedEpisodePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Fetch episode by share token
  const [episode] = await db
    .select()
    .from(episodes)
    .where(eq(episodes.shareToken, token as unknown as string))
    .limit(1);

  if (!episode || !episode.shareToken) notFound();

  // Fetch only the public-facing assets (show_notes + transcript)
  const allAssets   = await assetRepository.listAssetsForEpisode(episode.id);
  const showNotes   = allAssets.find((a) => a.assetType === "show_notes")?.content ?? null;
  const transcript  = allAssets.find((a) => a.assetType === "transcript")?.content ?? null;
  const blogPost    = allAssets.find((a) => a.assetType === "blog_post")?.content ?? null;

  const created = new Date(episode.createdAt).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Brand header */}
      <header className="bg-indigo-950 py-4 px-6">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-white font-bold text-lg">
            <Mic2 className="w-5 h-5 text-indigo-400" />
            PodLever
          </Link>
          <Link
            href="/"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white
                       hover:bg-indigo-500 transition-colors"
          >
            Get your content suite →
          </Link>
        </div>
      </header>

      {/* Episode hero */}
      <div className="bg-indigo-600 pb-10 pt-8 px-6">
        <div className="max-w-3xl mx-auto">
          <p className="text-indigo-300 text-xs uppercase tracking-widest mb-2">Podcast Episode</p>
          <h1 className="text-2xl md:text-3xl font-bold text-white leading-snug">{episode.title}</h1>
          <p className="text-indigo-300 text-sm mt-2">{created}</p>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-6 py-8 space-y-8">

        {/* Show notes */}
        {showNotes && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <BookOpen className="w-5 h-5 text-indigo-500" />
              <h2 className="text-lg font-bold text-gray-900">Show Notes</h2>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-6">
              <pre className="whitespace-pre-wrap text-sm text-gray-700 leading-relaxed font-sans">
                {showNotes}
              </pre>
            </div>
          </section>
        )}

        {/* Blog post preview (first 500 chars) */}
        {blogPost && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-5 h-5 text-indigo-500" />
              <h2 className="text-lg font-bold text-gray-900">Blog Post Preview</h2>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-6">
              <pre className="whitespace-pre-wrap text-sm text-gray-700 leading-relaxed font-sans line-clamp-[12]">
                {blogPost.slice(0, 600)}{blogPost.length > 600 ? "…" : ""}
              </pre>
              <p className="text-xs text-gray-400 mt-3">Full content available to the podcast owner.</p>
            </div>
          </section>
        )}

        {/* Transcript (collapsible preview) */}
        {transcript && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-5 h-5 text-indigo-500" />
              <h2 className="text-lg font-bold text-gray-900">Transcript</h2>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-6 max-h-72 overflow-y-auto">
              <pre className="whitespace-pre-wrap text-sm text-gray-700 leading-relaxed font-sans">
                {transcript.slice(0, 2000)}{transcript.length > 2000 ? "\n\n[…transcript continues…]" : ""}
              </pre>
            </div>
          </section>
        )}

        {/* CTA — viral growth driver */}
        <div className="rounded-2xl bg-indigo-950 text-white px-8 py-8 text-center">
          <div className="w-12 h-12 rounded-xl bg-indigo-600 flex items-center justify-center mx-auto mb-4">
            <Sparkles className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-bold mb-2">Get your full podcast content suite</h3>
          <p className="text-indigo-300 text-sm mb-6">
            Show notes, blog post, social copy, guest media pack, and a branded PDF — generated in minutes from your audio.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold
                       hover:bg-indigo-500 transition-colors"
          >
            Start free with PodLever →
          </Link>
        </div>

        {/* Footer watermark */}
        <p className="text-center text-xs text-gray-400 pb-4">
          This content was generated by{" "}
          <Link href="/" className="text-indigo-500 hover:underline">PodLever</Link>
          {" "}· AI-powered podcast content engine
        </p>
      </main>
    </div>
  );
}
