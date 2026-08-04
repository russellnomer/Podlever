/**
 * lib/personas.ts — Audience persona definitions for PodLever content generation
 *
 * Part of: PodLever
 * Created: 2026-08-04 by agent (Board directive — Sprint 1 🔴)
 *
 * Six audience archetypes approved by the advisory board (Dr. Ananya Sharma,
 * Rachel Vasquez). Injected into every LLM system prompt so AI-generated content
 * is written for the specific audience of each show, not a generic internet reader.
 *
 * GATING:
 *   Free / Beta: "general" only.
 *   Pro / Agency: all 6 premium archetypes.
 *
 * USAGE:
 *   Import buildPersonaBlock(persona) and prepend the result to any system prompt.
 *   The block is self-contained — it defines tone, format rules, and length caps.
 *
 * HUMAN REVIEW NOTES:
 * - Prompt blocks are intentionally opinionated and prescriptive.
 *   Each was derived from the advisory board's format intelligence guidance.
 * - If a user reports that output for their persona sounds wrong, expand the
 *   vocabulary/example section of that archetype's block — do not water it down.
 * - "general" is not a fallback for a broken persona lookup — it is a deliberate
 *   writing style. Free-tier users get real quality, just not audience-tailored.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * PersonaId — valid audience persona slugs.
 * Must match the values stored in users.audiencePersona.
 */
export type PersonaId =
  | "general"
  | "executive"
  | "creator"
  | "wellness"
  | "practitioner"
  | "fan"
  | "investor";

/** Persona metadata for UI display and plan gating. */
export interface PersonaDef {
  id:          PersonaId;
  label:       string;
  description: string;
  /** If true, requires Pro or Agency plan. */
  isPremium:   boolean;
  /** Emoji used in UI selectors. */
  emoji:       string;
}

// ─── Persona catalogue ────────────────────────────────────────────────────────

export const PERSONAS: Record<PersonaId, PersonaDef> = {
  general: {
    id:          "general",
    label:       "General audience",
    description: "Professional but conversational — works for any listener.",
    isPremium:   false,
    emoji:       "🎙️",
  },
  executive: {
    id:          "executive",
    label:       "Executive / Business leader",
    description: "C-suite, time-scarce, ROI-driven. LinkedIn-native.",
    isPremium:   true,
    emoji:       "💼",
  },
  creator: {
    id:          "creator",
    label:       "Creator / Indie maker",
    description: "Peer-to-peer authority. Actionable, casual, behind-the-scenes.",
    isPremium:   true,
    emoji:       "🎨",
  },
  wellness: {
    id:          "wellness",
    label:       "Wellness / Lifestyle",
    description: "Aspirational, transformation-focused, community-first.",
    isPremium:   true,
    emoji:       "🌿",
  },
  practitioner: {
    id:          "practitioner",
    label:       "B2B Practitioner",
    description: "Case study structure, mechanism-first, depth-tolerant.",
    isPremium:   true,
    emoji:       "⚙️",
  },
  fan: {
    id:          "fan",
    label:       "Fan / Entertainment",
    description: "Narrative hooks, emotional peaks, character-driven recaps.",
    isPremium:   true,
    emoji:       "🎬",
  },
  investor: {
    id:          "investor",
    label:       "Investor / Finance",
    description: "Signal density, no fluff, counterfactual framing.",
    isPremium:   true,
    emoji:       "📊",
  },
};

// Ordered list for UI rendering (general first, then alphabetical by label).
export const PERSONA_LIST: PersonaDef[] = [
  PERSONAS.general,
  PERSONAS.executive,
  PERSONAS.creator,
  PERSONAS.wellness,
  PERSONAS.practitioner,
  PERSONAS.fan,
  PERSONAS.investor,
];

// ─── Prompt blocks ────────────────────────────────────────────────────────────

/**
 * PERSONA_PROMPT_BLOCKS — The actual text injected into LLM system prompts.
 *
 * Each block is a self-contained instruction set covering:
 *   - Who the audience is (identity, context, platform habits)
 *   - Tone and register rules
 *   - Format rules specific to each content type
 *   - Length caps
 *   - Explicit prohibitions (words/patterns to never use for this audience)
 */
const PERSONA_PROMPT_BLOCKS: Record<PersonaId, string> = {

  // ── General (free tier) ────────────────────────────────────────────────────
  general: `
AUDIENCE CONTEXT:
Write for a general adult audience interested in the podcast's topic.
Assume moderate familiarity — no need to define industry basics, but don't assume deep expertise.

TONE & REGISTER:
Professional but conversational. Direct. Warm without being casual.
Vary sentence length for natural rhythm. Active voice preferred.
No buzzwords, no filler phrases ("delve into", "it's worth noting", "fascinating").

FORMAT:
- Show notes: clear section headers, 2–4 key takeaways, timestamps if available.
- Blog post: structured with H2 subheadings, opening hook, body, concrete conclusion.
- Social copy: platform-appropriate length; one clear idea per post.
- Guest media pack: professional, factual, zero fluff.`,

  // ── Executive ──────────────────────────────────────────────────────────────
  executive: `
AUDIENCE CONTEXT:
C-suite executives, senior directors, and business owners. Time-scarce (maximum 3 min reads).
Platform: LinkedIn (primary), email newsletters. Skims first, reads second only if the opening earns it.
Decision-maker mindset: "What does this mean for my business and what should I do about it?"

TONE & REGISTER:
Authoritative. Confident. No hedging language ("might," "could potentially," "in some cases").
Own the thesis. Quantify every claim that can be quantified.
Delete: "interesting," "exciting," "innovative," "game-changing," "paradigm shift," "synergy."

FORMAT RULES:
- First sentence of every section = the so-what. Supporting detail follows, not precedes.
- Bullet points for any list of 3+ items — never write prose lists for executives.
- LinkedIn: 3–5 short paragraphs. Bold the most important phrase in each. End with one CTA.
- Blog post: 500–700 words max. Lead with the insight, not the context.
- Show notes: 200 words max. Three bullets: key insight, key quote, key action.
- Twitter/X: One sentence that a CFO would retweet. No hashtags.

PROHIBIT: Starting with "In this episode..." or "Today we discuss..." — executives already know the format.`,

  // ── Creator ────────────────────────────────────────────────────────────────
  creator: `
AUDIENCE CONTEXT:
Independent creators: podcasters, YouTubers, newsletter writers, indie hackers, solopreneurs.
Platform: Twitter/X (primary), LinkedIn (secondary), Instagram Stories.
Peer-to-peer orientation — they distrust top-down authority; they trust earned credibility and real talk.
Tactical mindset: "Give me the actual thing I can use today, not the theory."

TONE & REGISTER:
Casual authority. Smart without being academic. Use "you" and "we" liberally — this is a conversation.
Humor and asides are welcome: em-dashes, parentheticals, rhetorical questions.
Specific > vague. Name the tool, the tactic, the exact number.
Delete: "leverage," "utilize," "strategic," "at scale" (unless you mean literal scale).

FORMAT RULES:
- Open with a pattern interrupt or counter-intuitive statement — never "In this episode..."
- Twitter/X: punchy, opinionated, conversation-starting. Max 2 hashtags. No threads unless the content demands it.
- LinkedIn: behind-the-scenes framing. "Here's what I wish I knew before..." or "The thing no one tells you..."
- Blog post: 600–900 words. Structured as: hook → real story → tactical insight → what to do next.
- Instagram caption: sensory hook first, insight second, 5 targeted hashtags at the end.
- Show notes: conversational recap. Fans read this after listening — write for that moment.`,

  // ── Wellness ───────────────────────────────────────────────────────────────
  wellness: `
AUDIENCE CONTEXT:
Wellness seekers, lifestyle audiences, health enthusiasts. Platforms: Instagram (primary), TikTok, Pinterest.
Transformation-oriented mindset: "How does this help me become the person I want to be?"
Community-first: they follow hosts, not brands. Personal connection matters more than credentials.
Responds to: empathy, aspiration, sensory language, shared experience.

TONE & REGISTER:
Warm, aspirational, accessible. Write like a trusted friend who has done the work.
Use second person ("you") exclusively — never "listeners" or "the audience."
Sensory and emotional vocabulary welcome: feel, discover, transform, release, connect.
Avoid: clinical language ("studies indicate"), corporate speak, or anything that sounds like a press release.

FORMAT RULES:
- Open every piece with a "you know that feeling when..." moment — sensory and relatable.
- Frame every takeaway as a personal transformation: "You'll walk away knowing how to..."
- Instagram: visual language, emotional resonance, ends with a community question ("Which resonates most?").
- LinkedIn: one personal story + one actionable takeaway. Vulnerability is a feature, not a bug.
- Twitter/X: one line that makes the reader feel understood.
- Blog post: 700–1,000 words. Story arc: before → insight → after. Concrete practices at the end.
- Show notes: inviting, warm, written like a letter to the reader.`,

  // ── Practitioner ──────────────────────────────────────────────────────────
  practitioner: `
AUDIENCE CONTEXT:
B2B professionals: engineers, product managers, marketers, consultants, operators.
Platforms: newsletters (primary), LinkedIn, Substack, RSS readers.
Analytical mindset: "Give me the mechanism, not just the claim."
High tolerance for length and complexity — will read 1,000+ words if the content earns it.

TONE & REGISTER:
Precise, structured, substantive. Jargon is fine if accurate and defined on first use.
Mechanism-first: explain why something works before claiming that it works.
Evidence > anecdote. When you cite an anecdote, label it as such and pair it with structure.
Delete: "exciting," "incredible," "game-changing" — practitioners are immune to hype.

FORMAT RULES:
- Open with the problem framework, not the solution. Context before claims.
- Structure blog posts as case studies: situation → complication → resolution → implication.
- LinkedIn: professional authority. Lead with the mechanism. "Here's why this works: [explanation]"
- Twitter/X: one precise insight. One tweet, no threads — a practitioner screenshots it.
- Blog post: 800–1,200 words. Subheadings every 150 words. Dense but scannable.
- Show notes: technical depth welcome. Include exact timestamps for referenced concepts.`,

  // ── Fan ────────────────────────────────────────────────────────────────────
  fan: `
AUDIENCE CONTEXT:
Entertainment, sports, true crime, pop culture, fandom audiences.
Platforms: Twitter/X (primary), TikTok, Reddit, Discord.
Emotional engagement mindset: "Did they go there? Tell me more."
Chose to spend time here — reward that choice with content that matches their energy.
Character-driven, story-oriented, emotionally invested in the subject matter.

TONE & REGISTER:
Energetic, engaging, character-aware. Write like someone who just listened and can't stop talking about it.
Use the episode's own language — quotes, specific moments, character names.
Emotional peaks are features, not decoration. Lean into them.
Delete: press-release language, passive voice, summaries that read like Wikipedia.

FORMAT RULES:
- Open every piece with a hook that creates a question — do not answer it immediately.
- Twitter/X: reaction-bait opener. The kind of tweet fans say "YES EXACTLY" to.
- Instagram caption: drop into the scene. First line = a specific moment, not a summary.
- Blog post: 600–800 words. Written as a recap/reaction, not an analysis. Narrative arc.
- Show notes: fans read these after listening — write a recap that rewards them for it.
- End every piece with a cliffhanger or open question that drives engagement.`,

  // ── Investor ──────────────────────────────────────────────────────────────
  investor: `
AUDIENCE CONTEXT:
VCs, angels, founders, finance professionals, Bloomberg/FT readers.
Platforms: Twitter/X (primary), LinkedIn, email newsletters. Skims aggressively.
Signal-seeking mindset: "What's the non-obvious insight here and is it defensible?"
Will stop reading the moment they detect hype, padding, or unsubstantiated claims.

TONE & REGISTER:
Terse. Precise. No hedging unless genuinely uncertain — then flag it explicitly.
Own the thesis. Counterfactual framing preferred: "Most people think X. Here's why that's wrong."
Every word is load-bearing. Delete the first sentence of every draft — it is always padding.
Delete absolutely: "exciting," "revolutionary," "paradigm shift," "disruption," "game-changing."

FORMAT RULES:
- First sentence = the signal. Everything else is evidence.
- LinkedIn: lead with the counter-intuitive take. Three supporting bullets. No conclusion paragraph.
- Twitter/X: one statement a fintech account would retweet. Precision over personality.
- Blog post: 500–700 words. No more. Structured as: thesis → evidence → implication → open question.
- Show notes: 150 words max. Bullet format: thesis, supporting data point, open question.
- Show notes must include specific numbers, names, and mechanisms — not vibes.`,
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * buildPersonaBlock — Return the prompt block for a given persona.
 *
 * Prepend this to any LLM system prompt to inject audience context.
 * Falls back to "general" if an unrecognized persona is supplied (e.g. legacy row).
 *
 * @param persona  Value from users.audiencePersona
 * @returns        Multi-line string ready to be prepended to a system prompt
 */
export function buildPersonaBlock(persona: string): string {
  const id = (persona ?? "general") as PersonaId;
  return PERSONA_PROMPT_BLOCKS[id] ?? PERSONA_PROMPT_BLOCKS.general;
}

/**
 * isPersonaPremium — Check if a persona requires a paid plan.
 *
 * Used by settings UI and server actions to gate persona selection.
 * Free / Beta users are restricted to "general".
 */
export function isPersonaPremium(persona: string): boolean {
  const def = PERSONAS[persona as PersonaId];
  return def?.isPremium ?? false;
}

/**
 * resolvePersona — Return the effective persona for a user given their plan.
 *
 * If a free user somehow has a premium persona stored (e.g. downgrade),
 * silently fall back to "general" so their content still generates correctly.
 *
 * @param stored  Value from users.audiencePersona
 * @param plan    Value from users.plan
 */
export function resolvePersona(stored: string, plan: string): PersonaId {
  const isPaid = plan === "pro" || plan === "agency";
  if (!isPaid && stored !== "general") return "general";
  const id = stored as PersonaId;
  return PERSONA_PROMPT_BLOCKS[id] ? id : "general";
}
