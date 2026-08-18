const express = require("express");
const cors = require("cors");
const path = require("path");
const auditRoutes = require("./src/routes/audit.routes");
const { PORT, SCREENSHOT_DIR } = require("./src/utils/constants");
const { startCleanupScheduler } = require("./src/services/screenshotCleanup.service");

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Serve screenshot files at /screenshots/{filename}
app.use("/screenshots", express.static(path.resolve(SCREENSHOT_DIR)));

app.use(auditRoutes);

// Start screenshot cleanup scheduler (runs once immediately, then every interval)
startCleanupScheduler();

app.listen(PORT, () => {
  console.log(`SiteLens running on port ${PORT}`);
});

module.exports = app;

