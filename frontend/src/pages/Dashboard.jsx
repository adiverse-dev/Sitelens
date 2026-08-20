import React, { useState } from 'react';
import AuditForm from '../components/audit/AuditForm';
import AuditResults from '../components/audit/AuditResults';

const Dashboard = () => {
  const [auditData, setAuditData] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleAuditStart = () => {
    setIsLoading(true);
    setError(null);
    setAuditData(null);
  };

  const handleAuditComplete = (data) => {
    setAuditData(data);
    setError(null);
    setIsLoading(false);
  };

  const handleAuditError = (errMsg) => {
    setError(errMsg);
    setAuditData(null);
    setIsLoading(false);
  };

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <h1>SiteLens</h1>
        <p>Comprehensive website auditing and analysis</p>
      </header>

      <AuditForm 
        onAuditStart={handleAuditStart}
        onAuditComplete={handleAuditComplete}
        onAuditError={handleAuditError}
      />

      {isLoading && (
        <div className="state-container loading-state">
          <div className="spinner"></div>
          <h3 className="loading-title">Auditing website...</h3>
          <p className="loading-subtitle">Checking SEO, accessibility, and performance.</p>
        </div>
      )}

      {error && (
        <div className="state-container error-state">
          <h3 className="error-title">Audit Failed</h3>
          <p className="error-message">{error}</p>
        </div>
      )}

      {auditData && !isLoading && (
        <AuditResults audit={auditData} />
      )}
    </div>
  );
};

export default Dashboard;
