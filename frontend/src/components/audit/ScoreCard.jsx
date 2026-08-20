import React from 'react';

const ScoreCard = ({ title, score }) => {
  const getScoreData = (val, metricName) => {
    if (val === null || val === undefined) {
      return { class: 'score-na', label: 'Lighthouse unavailable' };
    }
    
    if (val >= 90) {
      const labels = {
        'Performance': 'Your page is loading efficiently.',
        'Accessibility': 'Excellent accessibility practices.',
        'Best Practices': 'Strong modern web standards.',
        'SEO': 'Search engine fundamentals look strong.'
      };
      return { class: 'score-excellent', label: labels[metricName] || 'Excellent' };
    }
    
    if (val >= 70) {
      return { class: 'score-average', label: 'Needs Improvement' };
    }
    
    return { class: 'score-poor', label: 'Poor — Action required' };
  };

  const displayScore = score !== null && score !== undefined ? score : 'N/A';
  const { class: scoreClass, label } = getScoreData(score, title);

  return (
    <div className="score-card">
      <div className="score-title">{title}</div>
      <div className={`score-value ${scoreClass}`}>
        {displayScore}
      </div>
      <div className="score-label" style={{ color: `var(--${scoreClass.split('-')[1]})` }}>
        {label}
      </div>
    </div>
  );
};

export default ScoreCard;
