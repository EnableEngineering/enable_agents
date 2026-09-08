import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AgentOutcomesStrip, AgentPrefillBanner, BackButton, ProjectGate, ProjectSelector, WorkflowExecutionBanner, WorkflowContextCard, EmptyState, Spinner, Modal, Button } from '../components';
import { API_CONFIG } from '../config/apiConfig';
import { authJsonHeaders } from '../core/authHeaders';
import { showToast } from '../core/toast';
import { useWorkflowContext, usePendingAgentPrefill, notifyAgentCompleted } from '../hooks';
import { useSelectedProjectId } from '../hooks/useSelectedProjectId';
import './SupplyChainAgent.css';

const AUDIT_CRITERIA = [
  { id: 'facility', name: 'Facility & Equipment', weight: 25 },
  { id: 'quality', name: 'Quality Systems', weight: 30 },
  { id: 'capacity', name: 'Production Capacity', weight: 20 },
  { id: 'financial', name: 'Financial Stability', weight: 15 },
  { id: 'compliance', name: 'Compliance & Certifications', weight: 10 },
];

function SupplyChainAgent() {
  const selectedProjectId = useSelectedProjectId();
  const { isInWorkflow, isHistoryView, stageData, stageId, saveStageData, getContext, context: workflowContext } = useWorkflowContext();

  const [suppliers, setSuppliers] = useState([]);
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [auditScores, setAuditScores] = useState({});
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [showAddSupplierModal, setShowAddSupplierModal] = useState(false);
  const [newSupplier, setNewSupplier] = useState({ name: '', location: '', capacity: '', certifications: '', capabilities: '' });

  const { prefill, dismiss: dismissPrefill } = usePendingAgentPrefill('supplyChainAudit', (fields) => {
    if (isHistoryView) return;
    const map = Object.fromEntries(fields.map((f) => [f.field_key, f.field_value]));
    setNewSupplier((prev) => ({ ...prev, ...map }));
    setShowAddSupplierModal(true);
  });
  const [isLoadingSuppliers, setIsLoadingSuppliers] = useState(false);
  const [saving, setSaving] = useState(false);

  const getCurrentUserId = () => localStorage.getItem('userEmail') || localStorage.getItem('username') || 'anonymous';

  const fetchSuppliers = async () => {
    if (!selectedProjectId) return;
    try {
      setIsLoadingSuppliers(true);
      const response = await fetch(`${API_CONFIG.API_URL}/api/supply-chain/suppliers?project_id=${encodeURIComponent(selectedProjectId)}`, {
        headers: authJsonHeaders(),
      });
      const data = await response.json();
      if (data.success) {
        setSuppliers(data.suppliers || []);
      } else {
        showToast(data.error || 'Failed to load suppliers', 'error');
      }
    } catch (error) {
      console.error('Error fetching suppliers:', error);
      showToast('Failed to load suppliers', 'error');
    } finally {
      setIsLoadingSuppliers(false);
    }
  };

  // Load suppliers when project changes
  useEffect(() => {
    if (!selectedProjectId) {
      setSuppliers([]);
      return;
    }
    fetchSuppliers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId]);

  const handleAddSupplier = async () => {
    if (!newSupplier.name.trim()) {
      showToast('Please enter a supplier name', 'warning');
      return;
    }

    try {
      const response = await fetch(`${API_CONFIG.API_URL}/api/supply-chain/suppliers`, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({
          project_id: selectedProjectId,
          user_id: getCurrentUserId(),
          name: newSupplier.name,
          location: newSupplier.location,
          capacity: newSupplier.capacity,
          certifications: newSupplier.certifications.split(',').map(c => c.trim()).filter(Boolean),
          capabilities: newSupplier.capabilities.split(',').map(c => c.trim()).filter(Boolean),
        }),
      });
      const data = await response.json();
      if (data.success) {
        setSuppliers(prev => [data.supplier, ...prev]);
        setShowAddSupplierModal(false);
        setNewSupplier({ name: '', location: '', capacity: '', certifications: '', capabilities: '' });
        showToast('Supplier added', 'success');
      } else {
        showToast(data.error || 'Failed to add supplier', 'error');
      }
    } catch (error) {
      console.error('Error adding supplier:', error);
      showToast('Failed to add supplier', 'error');
    }
  };

  // Load workflow data when viewing completed stage history
  useEffect(() => {
    if (!isHistoryView) return;

    const data = stageData && Object.keys(stageData).length > 0 ? stageData : null;
    if (!data) return;

    console.log('[SupplyChain] Loading workflow history:', { isHistoryView, stageData: data });

    // Update suppliers with audit results from stageData
    if (data.supplier_audited) {
      setSuppliers(prev => prev.map(s =>
        s.name === data.supplier_audited
          ? {
              ...s,
              auditStatus: data.audit_result || 'passed',
              score: data.audit_score || 0,
              auditDate: new Date().toISOString().split('T')[0],
            }
          : s
      ));
    }
  }, [isHistoryView, stageData]);

  const handleStartAudit = (supplier) => {
    setSelectedSupplier(supplier);
    setAuditScores({});
    setShowAuditModal(true);
  };

  const handleScoreChange = (criteriaId, score) => {
    setAuditScores(prev => ({ ...prev, [criteriaId]: parseInt(score) || 0 }));
  };

  const calculateTotalScore = () => {
    let total = 0;
    let totalWeight = 0;
    AUDIT_CRITERIA.forEach(criteria => {
      if (auditScores[criteria.id] !== undefined) {
        total += (auditScores[criteria.id] / 100) * criteria.weight;
        totalWeight += criteria.weight;
      }
    });
    return totalWeight > 0 ? Math.round((total / totalWeight) * 100) : 0;
  };

  const handleSubmitAudit = async () => {
    const totalScore = calculateTotalScore();
    const auditResult = totalScore >= 70 ? 'passed' : 'failed';
    const auditDate = new Date().toISOString().split('T')[0];

    setSaving(true);
    try {
      const response = await fetch(`${API_CONFIG.API_URL}/api/supply-chain/suppliers/${selectedSupplier.id}/audit`, {
        method: 'PUT',
        headers: authJsonHeaders(),
        body: JSON.stringify({ score: totalScore }),
      });
      const data = await response.json();
      if (!data.success) {
        showToast(data.error || 'Failed to save audit', 'error');
        setSaving(false);
        return;
      }
    } catch (error) {
      console.error('Error saving audit:', error);
      showToast('Failed to save audit', 'error');
      setSaving(false);
      return;
    }
    setSaving(false);

    // Update supplier with audit results
    const updatedSuppliers = suppliers.map(s =>
      s.id === selectedSupplier.id
        ? { ...s, auditStatus: auditResult, score: totalScore, auditDate }
        : s
    );
    setSuppliers(updatedSuppliers);

    // Calculate metrics from actual data
    const passedSuppliers = updatedSuppliers
      .filter(s => s.auditStatus === 'passed')
      .map(s => ({ name: s.name, score: s.score }));
    const auditedCount = updatedSuppliers.filter(s => s.auditStatus !== 'pending' && s.auditStatus !== 'scheduled').length;
    const topScorer = passedSuppliers.length > 0
      ? passedSuppliers.reduce((top, s) => s.score > top.score ? s : top)
      : null;

    // Save to workflow if in workflow context
    if (isInWorkflow) {
      saveStageData({
        supplier_audited: selectedSupplier.name,
        audit_score: totalScore,
        audit_result: auditResult,
        total_audited: auditedCount,
        passed_count: passedSuppliers.length,
        top_scorer: topScorer?.name || 'N/A',
        top_score: topScorer?.score || 0,
        audit_criteria: AUDIT_CRITERIA.map(c => c.name),
      });
    }

    setShowAuditModal(false);
    showToast(`Audit completed: ${auditResult === 'passed' ? 'Passed' : 'Failed'} (${totalScore}%)`, auditResult === 'passed' ? 'success' : 'warning');
    notifyAgentCompleted('supplyChainAudit', `Completed audit for ${selectedSupplier.name} (${totalScore}%)`, [
      { field_key: 'title', field_value: `Follow up on ${selectedSupplier.name} audit (${totalScore}%)` },
    ]);
  };

  const getStatusBadge = (status) => {
    const config = {
      passed: { label: '✓ Passed', className: 'passed' },
      failed: { label: '✕ Failed', className: 'failed' },
      scheduled: { label: '◐ Scheduled', className: 'scheduled' },
      pending: { label: '○ Pending', className: 'pending' },
    };
    return config[status] || config.pending;
  };

  const passedCount = suppliers.filter(s => s.auditStatus === 'passed').length;
  const auditedCount = suppliers.filter(s => ['passed', 'failed'].includes(s.auditStatus)).length;

  return (
    <>

      <div className="agent-page-header">
        <div className="agent-header-left">
          {!isInWorkflow && <BackButton />}
          <div className="agent-header-content">
            <div className="agent-title-row">
              <h1>Supply Chain Audit</h1>
            </div>
            <p className="text-muted">
              Qualify suppliers through capability and compliance audits
            </p>
          </div>
        </div>
        <div className="agent-header-right">
          <ProjectSelector agentKey="supplyChainAudit" />
        </div>
      </div>

      <AgentOutcomesStrip
        items={[
          { iconSrc: '/assets/icons/checklist.png', title: 'Capability audits', description: 'Score suppliers against your qualification criteria.' },
          { iconSrc: '/assets/icons/data-security.png', title: 'Compliance checks', description: 'Flag risk and compliance gaps before you commit.' },
          { iconSrc: '/assets/icons/reports.png', title: 'Audit reports', description: 'Exportable summaries for procurement decisions.' },
        ]}
      />

      <AgentPrefillBanner
        prefill={prefill}
        onDismiss={dismissPrefill}
        labels={{ name: 'Name', location: 'Location', capacity: 'Capacity', certifications: 'Certifications', capabilities: 'Capabilities' }}
      />

      <ProjectGate agentLabel="Supply Chain workspace">
        <div className="supply-chain-page">
          <WorkflowExecutionBanner />

          {/* Show context from previous workflow stages */}
          {isInWorkflow && !isHistoryView && (
            <WorkflowContextCard context={getContext()} currentStageId={stageId} />
          )}

          {/* Summary Stats */}
          <div className="audit-stats">
            <div className="stat-card">
              <span className="stat-value">{suppliers.length}</span>
              <span className="stat-label">Total Suppliers</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">{auditedCount}</span>
              <span className="stat-label">Audited</span>
            </div>
            <div className="stat-card highlight">
              <span className="stat-value">{passedCount}</span>
              <span className="stat-label">Qualified</span>
            </div>
          </div>

          {/* Suppliers List */}
          <div className="suppliers-section">
            <div className="suppliers-section-header">
              <h2>
                <img src="/assets/icons/supply-chain-management.png" alt="" />
                Supplier Qualification Status
              </h2>
              <Button variant="primary" size="sm" onClick={() => setShowAddSupplierModal(true)}>
                + Add Supplier
              </Button>
            </div>

            {isLoadingSuppliers ? (
              <Spinner size="md" />
            ) : suppliers.length === 0 ? (
              <EmptyState
                iconType="data"
                title="No suppliers yet"
                description="Add one to start tracking qualification audits."
                size="sm"
              />
            ) : (
            <div className="suppliers-grid">
              {suppliers.map(supplier => {
                const statusBadge = getStatusBadge(supplier.auditStatus);
                return (
                  <div key={supplier.id} className={`supplier-card ${supplier.auditStatus}`}>
                    <div className="supplier-header">
                      <h3>{supplier.name}</h3>
                      <span className={`status-badge ${statusBadge.className}`}>
                        {statusBadge.label}
                      </span>
                    </div>

                    <div className="supplier-location">
                      <img src="/assets/icons/networking.png" alt="" />
                      {supplier.location}
                    </div>

                    <div className="supplier-certs">
                      {supplier.certifications.map(cert => (
                        <span key={cert} className="cert-badge">{cert}</span>
                      ))}
                    </div>

                    <div className="supplier-capabilities">
                      <strong>Capabilities:</strong> {supplier.capabilities.join(', ')}
                    </div>

                    <div className="supplier-capacity">
                      <strong>Capacity:</strong> {supplier.capacity}
                    </div>

                    {supplier.score !== null && (
                      <div className="supplier-score">
                        <div className="score-bar">
                          <div
                            className="score-fill"
                            style={{ width: `${supplier.score}%`, background: supplier.score >= 70 ? 'var(--color-success)' : 'var(--color-error)' }}
                          />
                        </div>
                        <span className="score-value">{supplier.score}/100</span>
                      </div>
                    )}

                    <div className="supplier-actions">
                      {supplier.auditStatus === 'pending' && (
                        <Button variant="primary" size="sm" onClick={() => handleStartAudit(supplier)}>
                          Start Audit
                        </Button>
                      )}
                      {supplier.auditStatus === 'scheduled' && (
                        <Button variant="primary" size="sm" onClick={() => handleStartAudit(supplier)}>
                          Conduct Audit
                        </Button>
                      )}
                      {['passed', 'failed'].includes(supplier.auditStatus) && (
                        <Button variant="secondary" size="sm" onClick={() => handleStartAudit(supplier)}>
                          Re-audit
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            )}
          </div>

          {/* Add Supplier Modal */}
          <Modal
            open={showAddSupplierModal}
            onClose={() => setShowAddSupplierModal(false)}
            title="Add Supplier"
            size="md"
            footer={
              <>
                <Button variant="secondary" onClick={() => setShowAddSupplierModal(false)}>Cancel</Button>
                <Button variant="primary" onClick={handleAddSupplier}>Add Supplier</Button>
              </>
            }
          >
            <div className="criteria-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '4px' }}>
              <label>Supplier Name *</label>
              <input
                type="text"
                className="criteria-score"
                style={{ width: '100%' }}
                value={newSupplier.name}
                onChange={(e) => setNewSupplier(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., Precision Components Ltd"
              />
            </div>
            <div className="criteria-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '4px' }}>
              <label>Location</label>
              <input
                type="text"
                className="criteria-score"
                style={{ width: '100%' }}
                value={newSupplier.location}
                onChange={(e) => setNewSupplier(prev => ({ ...prev, location: e.target.value }))}
                placeholder="e.g., Pune, India"
              />
            </div>
            <div className="criteria-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '4px' }}>
              <label>Capacity</label>
              <input
                type="text"
                className="criteria-score"
                style={{ width: '100%' }}
                value={newSupplier.capacity}
                onChange={(e) => setNewSupplier(prev => ({ ...prev, capacity: e.target.value }))}
                placeholder="e.g., 50,000 units/month"
              />
            </div>
            <div className="criteria-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '4px' }}>
              <label>Certifications (comma separated)</label>
              <input
                type="text"
                className="criteria-score"
                style={{ width: '100%' }}
                value={newSupplier.certifications}
                onChange={(e) => setNewSupplier(prev => ({ ...prev, certifications: e.target.value }))}
                placeholder="e.g., ISO 9001, IATF 16949"
              />
            </div>
            <div className="criteria-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '4px' }}>
              <label>Capabilities (comma separated)</label>
              <input
                type="text"
                className="criteria-score"
                style={{ width: '100%' }}
                value={newSupplier.capabilities}
                onChange={(e) => setNewSupplier(prev => ({ ...prev, capabilities: e.target.value }))}
                placeholder="e.g., CNC Machining, Assembly"
              />
            </div>
          </Modal>

          {/* Audit Modal */}
          <Modal
            open={showAuditModal && !!selectedSupplier}
            onClose={() => setShowAuditModal(false)}
            title={selectedSupplier ? `Supplier Audit: ${selectedSupplier.name}` : 'Supplier Audit'}
            size="md"
            footer={
              <>
                <Button variant="secondary" onClick={() => setShowAuditModal(false)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handleSubmitAudit}
                  disabled={saving || Object.keys(auditScores).length < AUDIT_CRITERIA.length || isHistoryView}
                >
                  {saving ? 'Saving...' : 'Submit Audit'}
                </Button>
              </>
            }
          >
            <p className="audit-instructions">
              Score each criteria from 0-100. A total weighted score of 70+ is required to pass.
            </p>

            <div className="audit-criteria-list">
              {AUDIT_CRITERIA.map(criteria => (
                <div key={criteria.id} className="criteria-row">
                  <div className="criteria-info">
                    <span className="criteria-name">{criteria.name}</span>
                    <span className="criteria-weight">Weight: {criteria.weight}%</span>
                  </div>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={auditScores[criteria.id] || ''}
                    onChange={(e) => handleScoreChange(criteria.id, e.target.value)}
                    placeholder="0-100"
                    className="criteria-score"
                  />
                </div>
              ))}
            </div>

            <div className="audit-total">
              <span>Total Weighted Score:</span>
              <span className={`total-score ${calculateTotalScore() >= 70 ? 'pass' : 'fail'}`}>
                {calculateTotalScore()}/100
                {Object.keys(auditScores).length === AUDIT_CRITERIA.length && (
                  <span className="score-result">
                    {calculateTotalScore() >= 70 ? ' (Pass)' : ' (Fail)'}
                  </span>
                )}
              </span>
            </div>
          </Modal>
        </div>
      </ProjectGate>
    </>
  );
}

export default SupplyChainAgent;
