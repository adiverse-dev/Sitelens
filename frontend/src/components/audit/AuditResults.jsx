import React, { useState } from 'react';
import AuditSummary from './AuditSummary';
import ScoreGrid from './ScoreGrid';
import NeedsAttention from './NeedsAttention';
import TechnicalSEO from '../seo/TechnicalSEO';
import SocialSEO from '../seo/SocialSEO';
import ImageAudit from '../seo/ImageAudit';
import Recommendations from '../recommendations/Recommendations';
import ScreenshotViewer from '../screenshot/ScreenshotViewer';
import PassedChecks from './PassedChecks';

const AuditResults = ({ audit }) => {
  const [showRaw, setShowRaw] = useState(false);

  if (!audit) return null;

  return (
    <div className="audit-results-container">
      <AuditSummary audit={audit} />
      
      <ScoreGrid lighthouse={audit.lighthouse} />
      
      <NeedsAttention recommendations={audit.recommendations} />
      
      <TechnicalSEO 
        seo={audit.seo}
        canonical={audit.canonical}
        indexability={audit.indexability}
        robots={audit.robots}
        sitemap={audit.sitemap}
        headingHierarchy={audit.headingHierarchy}
      />
      
      <SocialSEO 
        openGraph={audit.openGraph}
        twitterCard={audit.twitterCard}
      />
      
      <ImageAudit images={audit.images} />
      
      <div id="recommendations-full">
        <Recommendations recommendations={audit.recommendations} />
      </div>
      
      <ScreenshotViewer screenshotPath={audit.screenshot} />
      
      <PassedChecks audit={audit} />

      <div className="raw-json-section">
        <div className="raw-json-container">
          <div 
            className="raw-json-summary"
            onClick={() => setShowRaw(!showRaw)}
          >
            {showRaw ? '▼ Hide Developer Data / Raw JSON' : '▸ View Developer Data / Raw JSON'}
          </div>
          {showRaw && (
            <pre className="raw-json-pre">
              {JSON.stringify(audit, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
};

export default AuditResults;
