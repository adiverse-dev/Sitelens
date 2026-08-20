import React from 'react';

const AuditSummary = ({ audit }) => {
  if (!audit) return null;

  const url = audit.url || 'Website';
  
  // Calculate health
  const lh = audit.summary?.lighthouse;
  let scoreDisplay = "Good overall health";
  let scoreClass = "success";
  let scoreNum = null;

  if (lh) {
    const scores = [lh.performance, lh.accessibility, lh.bestPractices, lh.seo].filter(s => s !== null && s !== undefined);
    if (scores.length > 0) {
      scoreNum = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
      if (scoreNum < 50) {
        scoreDisplay = "Poor — significant improvements required.";
        scoreClass = "error";
      } else if (scoreNum < 90) {
        scoreDisplay = "Average — needs improvement.";
        scoreClass = "warning";
      } else {
        scoreDisplay = "Good — a few improvements are recommended.";
      }
    }
  }

  // Calculate check counts
  const highPriority = audit.recommendations?.filter(r => r.severity.toLowerCase() === 'high').length || 0;
  const improvements = audit.recommendations?.filter(r => r.severity.toLowerCase() !== 'high').length || 0;
  
  // Very rough "passed checks" approximation from summary object
  // Total possible issues tracked in summary vs actual
  const summary = audit.summary || {};
  const passed = 
    (summary.robotsIssues === 0 ? 1 : 0) +
    (summary.sitemapIssues === 0 ? 1 : 0) +
    (summary.indexabilityIssues === 0 ? 1 : 0) +
    (summary.consoleErrorCount === 0 ? 1 : 0) +
    (summary.failedRequestCount === 0 ? 1 : 0) +
    (audit.seo?.h1?.hasSingleH1 ? 1 : 0) +
    (audit.seo?.metaDescription?.exists ? 1 : 0) +
    (audit.canonical?.exists ? 1 : 0) +
    (audit.openGraph?.exists && (!audit.openGraph?.missingFields || audit.openGraph.missingFields.length === 0) ? 1 : 0) +
    (audit.twitterCard?.exists && (!audit.twitterCard?.missingFields || audit.twitterCard.missingFields.length === 0) ? 1 : 0);

  return (
    <div className="audit-summary">
      <div className="summary-header">
        <div className="summary-badge">AUDIT COMPLETE ✓</div>
        <h2 className="summary-target">{url}</h2>
      </div>

      <div className="health-score-container">
        <div className="health-title">Website Health</div>
        {scoreNum !== null ? (
          <div className="health-score">
            {scoreNum} <span className="health-denominator">/ 100</span>
          </div>
        ) : (
          <div className="health-score">
            N/A
          </div>
        )}
        <div className="health-message" style={{ color: `var(--${scoreClass})` }}>
          {scoreDisplay}
        </div>
      </div>

      <div className="summary-stats">
        <div className="stat-item stat-pass">
          <span>✓</span> {passed} checks passed
        </div>
        <div className="stat-item stat-warn">
          <span>⚠</span> {improvements} improvements
        </div>
        {highPriority > 0 && (
          <div className="stat-item stat-fail">
            <span>🔴</span> {highPriority} high priority
          </div>
        )}
      </div>
    </div>
  );
};

export default AuditSummary;
