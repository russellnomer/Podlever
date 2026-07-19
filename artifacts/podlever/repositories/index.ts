/**
 * repositories/index.ts — Barrel export for all PodLever repositories
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-19 by agent (Task #35 — add CRM audit + extended waitlist types)
 */

export {
  EpisodeRepository,
  episodeRepository,
  EpisodeNotFoundError,
  OptimisticLockError,
} from "./episode.repository";

export {
  AssetRepository,
  assetRepository,
  AssetNotFoundError,
} from "./asset.repository";

export {
  WaitlistRepository,
  waitlistRepository,
  type SourceBreakdown,
  type WaitlistSummary,
  type ListLeadsOpts,
  type ListLeadsResult,
  type LeadPatch,
} from "./waitlist.repository";

export {
  CrmAuditRepository,
  crmAuditRepository,
} from "./crm-audit.repository";

export {
  usageRepository,
  type UsageSummary,
  type UserUsageSummary,
} from "./usage.repository";
