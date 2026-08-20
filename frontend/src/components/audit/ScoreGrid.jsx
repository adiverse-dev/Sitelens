import React from 'react';
import ScoreCard from './ScoreCard';

const ScoreGrid = ({ lighthouse }) => {
  // Safe fallback if lighthouse is entirely missing
  const lh = lighthouse || {};

  return (
    <div style={{ marginBottom: '3rem' }}>
      <div className="needs-attention-header">
        <h2>LIGHTHOUSE SCORES</h2>
      </div>
      <div className="score-grid">
        <ScoreCard title="Performance" score={lh.performance} />
        <ScoreCard title="Accessibility" score={lh.accessibility} />
        <ScoreCard title="Best Practices" score={lh.bestPractices} />
        <ScoreCard title="SEO" score={lh.seo} />
      </div>
    </div>
  );
};

export default ScoreGrid;
