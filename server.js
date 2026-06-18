const express = require("express");
const cors = require("cors");
const auditRoutes = require("./src/routes/audit.routes");
const { PORT } = require("./src/utils/constants");

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(auditRoutes);

app.listen(PORT, () => {
  console.log(`SiteLens running on port ${PORT}`);
});

module.exports = app;
