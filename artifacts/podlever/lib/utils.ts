/**
 * utils.ts — shadcn/ui utility helpers for PodLever
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent
 *
 * Dependencies: clsx (conditional class composition), tailwind-merge (deduplication)
 *
 * HUMAN REVIEW NOTES:
 * This file is required by shadcn/ui components (initialized in T1, components
 * added in later phases). The cn() helper merges Tailwind classes without
 * duplicates, which prevents specificity conflicts in component composition.
 */

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * cn — Compose Tailwind CSS class names safely
 *
 * @param inputs - Any number of class values (strings, objects, arrays)
 * @returns Merged, deduplicated Tailwind class string
 *
 * Business context: shadcn/ui uses this on every component to allow
 * consumers to override styles via className props without specificity fights.
 * Never use raw string concatenation for Tailwind classes in this codebase.
 *
 * Side effects: none
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
