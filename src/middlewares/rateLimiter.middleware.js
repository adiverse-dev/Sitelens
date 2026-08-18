const rateLimit = require("express-rate-limit");
const {
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,
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

module.exports = {
  auditRateLimiter,
};
