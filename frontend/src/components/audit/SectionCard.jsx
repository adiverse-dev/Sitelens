import React from 'react';

const SectionCard = ({ title, children }) => {
  return (
    <div className="section-card">
      <h2>{title}</h2>
      <div className="section-content">
        {children}
      </div>
    </div>
  );
};

export default SectionCard;
