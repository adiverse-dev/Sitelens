const express = require("express");
const { auditWebsite } = require("../controllers/audit.controller");
const { auditRateLimiter } = require("../middlewares/rateLimiter.middleware");

const router = express.Router();

router.post("/audit", auditRateLimiter, auditWebsite);

module.exports = router;
