/**
 * Convenience alias for the host half.
 *
 * The package entry declared in `package.json` is `./lib/index.js` (that is
 * what the cordis bundle patch loads). This file only re-exports it so the
 * documented layout `index.js` at the package root also resolves to the same
 * plugin face.
 *
 * @module dsh-session-stats-panel
 */

export {
  DEFAULTS,
  HEAVY_PATH,
  LIVE_PATH,
  OVERVIEW_PATH,
  WARMUP_DELAY_MS,
  apply,
  createLiveSampler,
  formatUptime,
  inject,
  isLoopbackRequest,
  normalizeConfig,
} from "./lib/index.js";
