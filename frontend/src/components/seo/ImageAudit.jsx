import React, { useState } from 'react';
import SectionCard from '../audit/SectionCard';

const ImageAudit = ({ images }) => {
  const [expanded, setExpanded] = useState(false);

  if (!images) return null;

  return (
    <SectionCard title="IMAGE HEALTH">
      <div className="summary-stats" style={{ justifyContent: 'flex-start', marginBottom: '1.5rem' }}>
        <div className="stat-item" style={{ color: 'var(--slate-700)' }}>
          Total images: {images.total || 0}
        </div>
        <div className="stat-item stat-pass">
          <span>✓</span> With alt text: {images.withAlt || 0}
        </div>
        <div className={`stat-item ${images.missingAlt > 0 ? 'stat-warn' : 'stat-pass'}`}>
          {images.missingAlt > 0 ? '⚠' : '✓'} Missing alt text: {images.missingAlt || 0}
        </div>
      </div>

      {images.missingAlt > 0 && images.missingAltSamples && images.missingAltSamples.length > 0 && (
        <div>
          <button 
            className="expandable-toggle" 
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? '▼ Hide affected images' : '▶ View affected images'}
          </button>
          
          {expanded && (
            <div className="expandable-content">
              <ul>
                {images.missingAltSamples.map((sample, idx) => (
                  <li key={idx}>{sample}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
};

export default ImageAudit;
