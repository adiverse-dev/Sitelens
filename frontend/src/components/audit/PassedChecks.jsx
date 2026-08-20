import React, { useState } from 'react';

const PassedChecks = ({ audit }) => {
  const [expanded, setExpanded] = useState(false);

  if (!audit) return null;

  const passedItems = [];

  if (audit.seo?.metaDescription?.exists) passedItems.push('Meta Description present');
  if (audit.seo?.h1?.hasSingleH1) passedItems.push('Only 1 primary H1 tag detected');
  if (audit.canonical?.exists) passedItems.push('Canonical URL explicitly defined');
  if (audit.robots?.exists) passedItems.push('Robots.txt found');
  if (audit.sitemap?.exists && audit.sitemap?.statusCode === 200) passedItems.push('Sitemap XML accessible');
  if (audit.openGraph?.exists && (!audit.openGraph?.missingFields || audit.openGraph.missingFields.length === 0)) passedItems.push('Open Graph tags fully defined');
  if (audit.twitterCard?.exists && (!audit.twitterCard?.missingFields || audit.twitterCard.missingFields.length === 0)) passedItems.push('Twitter Card tags fully defined');
  if (audit.summary?.consoleErrorCount === 0) passedItems.push('No console errors detected on load');
  if (audit.summary?.failedRequestCount === 0) passedItems.push('No failed network requests');
  if (audit.indexability?.indexable) passedItems.push('Page is indexable by search engines');
  
  if (passedItems.length === 0) return null;

  return (
    <div style={{ marginBottom: '2rem' }}>
      <button 
        className="expandable-toggle" 
        onClick={() => setExpanded(!expanded)}
        style={{ color: 'var(--slate-600)', fontSize: '1rem' }}
      >
        {expanded ? '▼ Hide passed checks' : `▶ View passed checks (${passedItems.length})`}
      </button>
      
      {expanded && (
        <div className="expandable-content" style={{ marginTop: '1rem', padding: '1.5rem' }}>
          <ul style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {passedItems.map((item, idx) => (
              <li key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', border: 'none' }}>
                <span style={{ color: 'var(--success)' }}>✓</span>
                <span style={{ color: 'var(--slate-700)', fontWeight: 500 }}>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default PassedChecks;
