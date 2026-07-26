/**
 * services/prompts.ts — Prompt templates for PodLever text-asset generation
 *
 * Part of: PodLever
 * Created: 2026-07-26 by agent (Phase 1B — pipeline engine)
 *
 * Dependencies: none (pure strings)
 *
 * HUMAN REVIEW NOTES:
 * Prompts live here, separate from the Claude transport in @/providers/writer,
 * so copy can be tuned without touching the API layer. Each exported function
 * returns a { system, user } pair for one asset type.
 *
 * These are deliberately terse and structured — the writer provider runs at low
 * temperature (0.4) so output stays consistent and format-stable for the review UI.
 */

/** A system+user prompt pair for a single Claude generation. */
export type PromptPair = { system: string; user: string };

/**
 * showNotesPrompt — Generate structured, publish-ready show notes from a transcript.
 *
 * Output is markdown with: title, 2-sentence summary, 5 key takeaways,
 * 3 chapter labels, and one tweet-length promo line.
 */
export function showNotesPrompt(transcript: string, episodeTitle?: string): PromptPair {
  const system =
    "You are PodLever's show-notes writer. You turn raw podcast transcripts into " +
    "clean, publish-ready show notes. Be accurate to the transcript — never invent " +
    "facts, names, numbers, or quotes that are not present. Write in clear, engaging " +
    "prose. Output valid Markdown only, with no preamble or sign-off.";

  const titleHint = episodeTitle
    ? `The working episode title is "${episodeTitle}" — you may refine it.\n\n`
    : "";

  const user =
    titleHint +
    "From the transcript below, produce show notes with exactly these sections:\n\n" +
    "## Title\nA punchy episode title, 70 characters or fewer.\n\n" +
    "## Summary\nTwo sentences capturing the episode's core.\n\n" +
    "## Key Takeaways\nFive bullet points, each a concrete insight from the episode.\n\n" +
    "## Chapters\nThree chapter labels in the form `[mm:ss] Label` (estimate reasonable " +
    "timestamps from the flow of the conversation).\n\n" +
    "## Promo\nOne tweet-length line (<=200 chars) to promote the episode.\n\n" +
    "TRANSCRIPT:\n" +
    transcript;

  return { system, user };
}

/**
 * socialPostsPrompt — Generate a pack of platform-ready social posts from a transcript.
 *
 * Output is markdown with labelled sections for LinkedIn, X/Twitter (a 3-tweet
 * thread), and Instagram/TikTok caption. Draws only on the transcript content.
 */
export function socialPostsPrompt(transcript: string, episodeTitle?: string): PromptPair {
  const system =
    "You are PodLever's social copywriter. You turn podcast transcripts into " +
    "scroll-stopping, platform-native social posts that drive listens. Stay accurate " +
    "to the transcript — never fabricate quotes or claims. Match each platform's voice. " +
    "Output valid Markdown only, no preamble.";

  const titleHint = episodeTitle ? `Episode: "${episodeTitle}".\n\n` : "";

  const user =
    titleHint +
    "From the transcript below, write a social pack with exactly these sections:\n\n" +
    "## LinkedIn\nOne post, 3-5 short paragraphs, professional but human, ending with a " +
    "soft CTA to listen. No hashtags mid-text; up to 3 relevant hashtags at the end.\n\n" +
    "## X Thread\nA 3-tweet thread. Number them 1/ 2/ 3/. Each tweet <=270 characters.\n\n" +
    "## Instagram / TikTok Caption\nOne punchy caption with a hook first line and 5-8 " +
    "relevant hashtags.\n\n" +
    "TRANSCRIPT:\n" +
    transcript;

  return { system, user };
}
