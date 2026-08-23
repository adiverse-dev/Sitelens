const express = require("express");
const { auditWebsite } = require("../controllers/audit.controller");
const { crawlWebsite } = require("../controllers/crawl.controller");
const {
  auditRateLimiter,
  crawlRateLimiter,
} = require("../middlewares/rateLimiter.middleware");

const router = express.Router();

// Single-page audit — existing endpoint, unchanged.
router.post("/audit", auditRateLimiter, auditWebsite);

// Multi-page crawl — Phase 5. Stricter rate limit (1 req/min vs 5 req/min).
router.post("/crawl", crawlRateLimiter, crawlWebsite);

module.exports = router;
