import React from 'react';

const NeedsAttention = ({ recommendations }) => {
  if (!recommendations || recommendations.length === 0) return null;

  const high = recommendations.filter(r => r.severity.toLowerCase() === 'high');
  const medium = recommendations.filter(r => r.severity.toLowerCase() === 'medium');
  const low = recommendations.filter(r => r.severity.toLowerCase() === 'low');
  
  // Show max 5 top issues here
  const topIssues = [...high, ...medium, ...low].slice(0, 5);

  return (
    <div className="needs-attention-section">
      <div className="needs-attention-header">
        <span className="attention-icon">⚡</span>
        <h2>NEEDS ATTENTION</h2>
      </div>
      <p style={{ marginBottom: '1rem', color: 'var(--text-muted)' }}>
        {recommendations.length} improvements recommended
      </p>

      <div className="attention-list">
        {topIssues.map((rec, index) => {
          let severityClass = 'low';
          let icon = '🟢';
          if (rec.severity.toLowerCase() === 'high') { severityClass = 'high'; icon = '🔴'; }
          else if (rec.severity.toLowerCase() === 'medium') { severityClass = 'medium'; icon = '🟡'; }

          return (
            <div key={index} className={`attention-item attention-${severityClass}`}>
              <div className="attention-indicator">{icon}</div>
              <div className="attention-content">
                <div className="attention-issue">{rec.issue}</div>
                <div className="attention-category">{rec.category}</div>
              </div>
            </div>
          );
        })}
      </div>
      
      {recommendations.length > 5 && (
        <div style={{ marginTop: '1rem' }}>
          <a href="#recommendations-full" style={{ fontWeight: 500 }}>
            View all {recommendations.length} issues ↓
          </a>
        </div>
      )}
    </div>
  );
};

export default NeedsAttention;
