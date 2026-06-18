const express = require("express");
const { auditWebsite } = require("../controllers/audit.controller");

const router = express.Router();

router.post("/audit", auditWebsite);

module.exports = router;
