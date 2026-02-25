/**
 * Review Gate — Safety layer for the content approval workflow.
 *
 * Enforces that nothing reaches distribution unless explicitly approved.
 * Distribution layer must check approved status before publishing.
 */

import type { ContentQueueRow, MediaAssetRow } from "./supabase";

// TODO: Distribution layer must check approved status before publishing.

/** Valid statuses for content_queue and media_assets */
export type ReviewStatus =
  | "draft"
  | "approved"
  | "needs_revision"
  | "rejected"
  | "scheduled"
  | "published";

/**
 * Allowed status transitions for the review state machine.
 *
 * draft        → approved | needs_revision | rejected
 * needs_revision → approved
 * approved     → scheduled (future distribution layer)
 * scheduled    → published (future distribution layer)
 */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft: ["approved", "needs_revision", "rejected"],
  needs_revision: ["approved"],
  approved: ["scheduled"],
  scheduled: ["published"],
};

/**
 * Check if a status transition is valid.
 */
export function isValidTransition(
  currentStatus: string,
  newStatus: string
): boolean {
  const allowed = ALLOWED_TRANSITIONS[currentStatus];
  if (!allowed) return false;
  return allowed.includes(newStatus);
}

/**
 * Safety gate — returns true only if the item is approved for distribution.
 *
 * No code should trigger distribution unless this returns true.
 */
export function isPublishable(
  item: ContentQueueRow | MediaAssetRow | { status: string }
): boolean {
  return item.status === "approved";
}
