import React from 'react';
import SectionCard from '../audit/SectionCard';

const Recommendations = ({ recommendations }) => {
  if (!recommendations || recommendations.length === 0) return null;

  return (
    <div style={{ marginBottom: '3rem' }}>
      <div className="needs-attention-header">
        <h2>ALL RECOMMENDATIONS</h2>
      </div>
      
      <div className="recommendations-list">
        {recommendations.map((rec, index) => {
          let severityClass = 'low';
          let priorityLabel = 'LOW PRIORITY';
          if (rec.severity.toLowerCase() === 'high') { severityClass = 'high'; priorityLabel = 'HIGH PRIORITY'; }
          else if (rec.severity.toLowerCase() === 'medium') { severityClass = 'medium'; priorityLabel = 'MEDIUM PRIORITY'; }

          return (
            <div key={index} className={`recommendation-card ${severityClass}`}>
              <div className="rec-header">
                <span className={`rec-badge ${severityClass}`}>
                  {severityClass === 'high' && '🔴 '}
                  {severityClass === 'medium' && '🟡 '}
                  {severityClass === 'low' && '🟢 '}
                  {priorityLabel}
                </span>
                <span className="rec-category">
                  {rec.category}
                </span>
              </div>
              
              <div className="rec-issue">{rec.issue}</div>
              
              <div className="rec-details">
                <div className="rec-detail-group">
                  <div className="rec-detail-label">Why it matters</div>
                  <div className="rec-detail-text">
                    This impacts your {rec.category.toLowerCase()} health. Fixing this issue improves user experience and search visibility.
                  </div>
                </div>
                <div className="rec-detail-group" style={{ marginTop: '1rem' }}>
                  <div className="rec-detail-label">Recommended Fix</div>
                  <div className="rec-detail-text" style={{ fontWeight: 500 }}>
                    {rec.fix}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Recommendations;
