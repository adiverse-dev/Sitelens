import React from 'react';
import SectionCard from '../audit/SectionCard';

const TechnicalSEO = ({ seo, canonical, robots, sitemap, headingHierarchy }) => {
  return (
    <SectionCard title="TECHNICAL SEO">
      <div className="health-list">
        {/* Meta Description */}
        <div className="health-item">
          <div className={`health-icon ${seo?.metaDescription?.exists ? 'pass' : 'fail'}`}>
            {seo?.metaDescription?.exists ? '✓' : '⚠'}
          </div>
          <div className="health-content">
            <div className="health-title">Meta Description</div>
            <div className="health-result">
              {seo?.metaDescription?.exists ? 'Present' : 'Missing'}
            </div>
            <div className="health-explanation">
              {seo?.metaDescription?.exists 
                ? `Meta description exists and is ${seo.metaDescription.length} characters.` 
                : 'Search engines may generate their own snippet, which can lower click-through rates.'}
            </div>
            {!seo?.metaDescription?.exists && (
              <div className="health-action">
                <strong>Recommended action:</strong> Add a descriptive meta description under 160 characters.
              </div>
            )}
          </div>
        </div>

        {/* H1 */}
        <div className="health-item">
          <div className={`health-icon ${seo?.h1?.hasSingleH1 ? 'pass' : 'warn'}`}>
            {seo?.h1?.hasSingleH1 ? '✓' : '⚠'}
          </div>
          <div className="health-content">
            <div className="health-title">H1 Tag</div>
            <div className="health-result">
              {seo?.h1?.count === 1 ? '1 primary H1 detected' : `${seo?.h1?.count || 0} H1 tags detected`}
            </div>
            <div className="health-explanation">
              {seo?.h1?.hasSingleH1 
                ? 'Page has exactly one H1 tag, which is ideal for SEO.'
                : 'Having multiple or zero H1 tags can confuse search engines about the primary topic of the page.'}
            </div>
            {!seo?.h1?.hasSingleH1 && (
              <div className="health-action">
                <strong>Recommended action:</strong> Ensure the page has exactly one descriptive H1 tag.
              </div>
            )}
          </div>
        </div>

        {/* Canonical */}
        <div className="health-item">
          <div className={`health-icon ${canonical?.exists ? 'pass' : 'fail'}`}>
            {canonical?.exists ? '✓' : '⚠'}
          </div>
          <div className="health-content">
            <div className="health-title">Canonical Tag</div>
            <div className="health-result">
              {canonical?.exists ? 'Present' : 'Missing'}
            </div>
            <div className="health-explanation">
              {canonical?.exists 
                ? 'Canonical tag points to the preferred URL.' 
                : 'Search engines may have difficulty determining which URL should be indexed, leading to duplicate content issues.'}
            </div>
            {!canonical?.exists && (
              <div className="health-action">
                <strong>Recommended action:</strong> Add a canonical tag pointing to the preferred URL.
              </div>
            )}
          </div>
        </div>

        {/* Robots.txt */}
        <div className="health-item">
          <div className={`health-icon ${robots?.exists ? 'pass' : 'fail'}`}>
            {robots?.exists ? '✓' : '⚠'}
          </div>
          <div className="health-content">
            <div className="health-title">Robots.txt</div>
            <div className="health-result">
              {robots?.exists ? `Found (${robots.ruleCount} rules)` : 'Missing'}
            </div>
            <div className="health-explanation">
              {robots?.exists 
                ? 'Robots.txt file is present to guide search engine crawlers.'
                : 'Without robots.txt, crawlers might access sensitive or unnecessary areas of your site.'}
            </div>
            {!robots?.exists && (
              <div className="health-action">
                <strong>Recommended action:</strong> Create a robots.txt file at the root of your domain.
              </div>
            )}
          </div>
        </div>

        {/* Sitemap */}
        <div className="health-item">
          <div className={`health-icon ${sitemap?.exists && sitemap?.statusCode === 200 ? 'pass' : 'warn'}`}>
            {sitemap?.exists && sitemap?.statusCode === 200 ? '✓' : '⚠'}
          </div>
          <div className="health-content">
            <div className="health-title">Sitemap</div>
            <div className="health-result">
              {!sitemap?.exists 
                ? 'Missing' 
                : sitemap.statusCode === 200 
                  ? 'Found and accessible' 
                  : `Returned HTTP ${sitemap.statusCode}`}
            </div>
            <div className="health-explanation">
              {sitemap?.exists && sitemap?.statusCode === 200
                ? 'Sitemap is correctly linked in robots.txt and accessible.'
                : 'Sitemaps help search engines discover your pages faster.'}
            </div>
            {(!sitemap?.exists || sitemap?.statusCode !== 200) && (
              <div className="health-action">
                <strong>Recommended action:</strong> Ensure a valid XML sitemap exists and is linked in your robots.txt.
              </div>
            )}
          </div>
        </div>
      </div>
    </SectionCard>
  );
};

export default TechnicalSEO;
