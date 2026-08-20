import React, { useState } from 'react';
import { auditWebsite } from '../../services/audit.service';

const AuditForm = ({ onAuditStart, onAuditComplete, onAuditError }) => {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!url.trim()) return;

    setIsLoading(true);
    onAuditStart();

    try {
      const response = await auditWebsite(url);
      
      if (response.success) {
        onAuditComplete(response);
      } else {
        onAuditError(response.error || 'Audit failed');
      }
    } catch (error) {
      onAuditError(error.message || 'Failed to connect to the server');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="audit-form-card">
      <form onSubmit={handleSubmit}>
        <label htmlFor="audit-url-input">Website URL</label>
        <div className="audit-form">
          <input
            id="audit-url-input"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            className="audit-input"
            disabled={isLoading}
            required
          />
          <button 
            type="submit" 
            className="audit-button"
            disabled={isLoading || !url.trim()}
          >
            {isLoading ? 'Auditing website...' : 'Audit Website'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default AuditForm;
