/**
 * postcss.config.mjs — PostCSS configuration for Tailwind CSS v4
 *
 * Part of: PodLever
 * Created: 2026-07-18
 * Last modified: 2026-07-18 by agent
 *
 * Tailwind v4 uses @tailwindcss/postcss instead of the classic tailwindcss PostCSS plugin.
 * No separate tailwind.config.ts is needed — configuration is done via CSS @theme blocks
 * in globals.css.
 */

/** @type {import('postcss').Config} */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
