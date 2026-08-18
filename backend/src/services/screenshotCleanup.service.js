const fs = require("fs");
const path = require("path");
const {
  SCREENSHOT_DIR,
  SCREENSHOT_TTL_MS,
  SCREENSHOT_CLEANUP_INTERVAL_MS,
} = require("../utils/constants");

let cleanupRunning = false;

/**
 * Scans SCREENSHOT_DIR once and deletes any .png files whose
 * last-modified time is older than SCREENSHOT_TTL_MS.
 *
 * - Skips non-PNG files.
 * - Handles a missing or empty directory gracefully.
 * - A single file's deletion failure does not abort the scan.
 * - Guards against overlapping concurrent runs.
 */
async function cleanupOnce() {
  if (cleanupRunning) return;
  cleanupRunning = true;

  try {
    let entries;
    try {
      entries = await fs.promises.readdir(SCREENSHOT_DIR);
    } catch (err) {
      if (err.code === "ENOENT") {
        // Directory does not exist yet — nothing to clean up
        return;
      }
      throw err;
    }

    const now = Date.now();
    let deleted = 0;
    let skipped = 0;

    for (const entry of entries) {
      // Only process PNG files
      if (!entry.toLowerCase().endsWith(".png")) continue;

      const filePath = path.join(SCREENSHOT_DIR, entry);

      let stat;
      try {
        stat = await fs.promises.stat(filePath);
      } catch (_) {
        // File disappeared between readdir and stat — skip silently
        continue;
      }

      const ageMs = now - stat.mtimeMs;

      if (ageMs > SCREENSHOT_TTL_MS) {
        try {
          await fs.promises.unlink(filePath);
          deleted++;
        } catch (err) {
          // Log but do not crash — another process may have already deleted it
          console.warn(`[ScreenshotCleanup] Could not delete ${entry}: ${err.message}`);
        }
      } else {
        skipped++;
      }
    }

    if (deleted > 0 || skipped > 0) {
      console.log(
        `[ScreenshotCleanup] Deleted ${deleted} expired file(s), kept ${skipped} recent file(s).`
      );
    }
  } finally {
    cleanupRunning = false;
  }
}

/**
 * Runs cleanupOnce() immediately on call, then schedules it to repeat
 * every SCREENSHOT_CLEANUP_INTERVAL_MS.
 *
 * Returns the interval handle so callers can cancel it if needed (e.g., in tests).
 */
function startCleanupScheduler() {
  // Run once immediately to purge stale files from previous server sessions
  cleanupOnce().catch((err) =>
    console.error("[ScreenshotCleanup] Startup cleanup error:", err.message)
  );

  const handle = setInterval(() => {
    cleanupOnce().catch((err) =>
      console.error("[ScreenshotCleanup] Periodic cleanup error:", err.message)
    );
  }, SCREENSHOT_CLEANUP_INTERVAL_MS);

  // Allow the Node process to exit even if the interval is still scheduled
  if (handle.unref) handle.unref();

  console.log(
    `[ScreenshotCleanup] Scheduler started — TTL ${SCREENSHOT_TTL_MS / 60000} min, ` +
      `interval ${SCREENSHOT_CLEANUP_INTERVAL_MS / 60000} min.`
  );

  return handle;
}

module.exports = {
  cleanupOnce,
  startCleanupScheduler,
};
