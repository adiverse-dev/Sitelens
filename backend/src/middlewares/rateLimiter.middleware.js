const rateLimit = require("express-rate-limit");
const {
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,
  CRAWL_RATE_LIMIT_WINDOW_MS,
  CRAWL_RATE_LIMIT_MAX_REQUESTS,
} = require("../utils/constants");

const auditRateLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    res.status(options.statusCode).json({
      success: false,
      error: "Too many audit requests from this IP, please try again after a minute.",
    });
  },
});

/**
 * Stricter rate limiter for POST /crawl.
 *
 * Crawl requests launch multiple browser sessions and are significantly more
 * resource-intensive than single-page audits.  Default: 1 crawl per IP per
 * minute (configurable via CRAWL_RATE_LIMIT_* env vars).
 */
const crawlRateLimiter = rateLimit({
  windowMs: CRAWL_RATE_LIMIT_WINDOW_MS,
  max: CRAWL_RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    res.status(options.statusCode).json({
      success: false,
      error: "Too many crawl requests from this IP, please try again after a minute.",
    });
  },
});

module.exports = {
  auditRateLimiter,
  crawlRateLimiter,
};
