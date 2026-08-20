import React from 'react';
import SectionCard from '../audit/SectionCard';

const SocialSEO = ({ openGraph, twitterCard }) => {
  const ogMissing = openGraph?.missingFields || [];
  const twitterMissing = twitterCard?.missingFields || [];

  return (
    <SectionCard title="SOCIAL SEO">
      <div className="health-list">
        {/* Open Graph */}
        <div className="health-item">
          <div className={`health-icon ${openGraph?.exists && ogMissing.length === 0 ? 'pass' : 'warn'}`}>
            {openGraph?.exists && ogMissing.length === 0 ? '✓' : '⚠'}
          </div>
          <div className="health-content">
            <div className="health-title">Open Graph</div>
            <div className="health-result">
              {!openGraph?.exists 
                ? 'Missing Open Graph tags' 
                : ogMissing.length > 0 
                  ? 'Incomplete tags' 
                  : 'Metadata detected'}
            </div>
            <div className="health-explanation">
              {openGraph?.exists && ogMissing.length === 0
                ? 'Your website will display richly on Facebook, LinkedIn, and other platforms.'
                : 'Missing Open Graph tags prevent rich link previews when shared on social media.'}
            </div>
            {ogMissing.length > 0 && (
              <div className="health-action" style={{ color: 'var(--warning)' }}>
                <strong>Missing fields:</strong> {ogMissing.join(', ')}
              </div>
            )}
          </div>
        </div>

        {/* Twitter Card */}
        <div className="health-item">
          <div className={`health-icon ${twitterCard?.exists && twitterMissing.length === 0 ? 'pass' : 'warn'}`}>
            {twitterCard?.exists && twitterMissing.length === 0 ? '✓' : '⚠'}
          </div>
          <div className="health-content">
            <div className="health-title">Twitter Card</div>
            <div className="health-result">
              {!twitterCard?.exists 
                ? 'Missing Twitter Card tags' 
                : twitterMissing.length > 0 
                  ? 'Incomplete tags' 
                  : 'Metadata detected'}
            </div>
            <div className="health-explanation">
              {twitterCard?.exists && twitterMissing.length === 0
                ? 'Your website will display richly when tweeted.'
                : 'Missing Twitter Card tags prevent rich previews on X (Twitter).'}
            </div>
            {twitterMissing.length > 0 && (
              <div className="health-action" style={{ color: 'var(--warning)' }}>
                <strong>Missing fields:</strong> {twitterMissing.join(', ')}
              </div>
            )}
          </div>
        </div>
      </div>
    </SectionCard>
  );
};

export default SocialSEO;
