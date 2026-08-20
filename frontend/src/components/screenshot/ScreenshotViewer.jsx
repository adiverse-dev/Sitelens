import React from 'react';
import SectionCard from '../audit/SectionCard';
import { getScreenshotUrl } from '../../utils/screenshotUrl';

const ScreenshotViewer = ({ screenshotPath }) => {
  if (!screenshotPath) return null;

  const imageUrl = getScreenshotUrl(screenshotPath);

  return (
    <div style={{ marginBottom: '3rem' }}>
      <div className="needs-attention-header">
        <h2>PAGE PREVIEW</h2>
      </div>
      
      <div className="screenshot-wrapper">
        <div className="screenshot-img-container">
          <img 
            src={imageUrl} 
            alt="Full-page screenshot of audited website" 
            className="screenshot-img"
            loading="lazy"
            onError={(e) => {
              e.target.onerror = null;
              e.target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="14px" fill="%2364748b">Screenshot Unavailable</text></svg>';
            }}
          />
        </div>
        <div className="screenshot-actions">
          <a 
            href={imageUrl} 
            target="_blank" 
            rel="noopener noreferrer" 
            className="btn-secondary"
          >
            Open Full Screenshot ↗
          </a>
        </div>
      </div>
    </div>
  );
};

export default ScreenshotViewer;
