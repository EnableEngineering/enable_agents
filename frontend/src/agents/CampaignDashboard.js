import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Header from '../core/Header';
import BackButton from '../components/BackButton';
import { LiveModeHint, AgentOutcomesStrip, ProjectSelector, ProjectGate, EmptyState } from '../components';
import '../styles/RequirementsGathering.css';
import { API_CONFIG } from '../config/apiConfig';
import { formatDate, formatDateTime } from '../utils/dateFormat';
import { useSelectedProjectId } from '../hooks/useSelectedProjectId';
import { authOptionalHeaders } from '../core/authHeaders';

// Storage key for state persistence
const STATE_KEY = 'campaignDashboardState';

function CampaignDashboard() {
  const navigate = useNavigate();
  const selectedProjectId = useSelectedProjectId();
  const [searchParams, setSearchParams] = useSearchParams();
  const userId = localStorage.getItem("firstName") || "";

  // Load persisted state
  const loadPersistedState = useCallback(() => {
    try {
      const saved = sessionStorage.getItem(STATE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  }, []);

  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaign, setSelectedCampaign] = useState(() => {
    return searchParams.get('campaign') || loadPersistedState().selectedCampaign || null;
  });
  const [recipients, setRecipients] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [isRefreshingReplies, setIsRefreshingReplies] = useState(false);

  // Persist state
  useEffect(() => {
    const state = { selectedCampaign };
    sessionStorage.setItem(STATE_KEY, JSON.stringify(state));

    const params = new URLSearchParams(searchParams);
    if (selectedCampaign) {
      params.set('campaign', selectedCampaign);
    } else {
      params.delete('campaign');
    }
    setSearchParams(params, { replace: true });
  }, [selectedCampaign, searchParams, setSearchParams]);

  // Clear state when project changes
  useEffect(() => {
    if (!selectedProjectId) {
      setCampaigns([]);
      setSelectedCampaign(null);
      setRecipients([]);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    fetchCampaigns();
    const intervalId = setInterval(fetchCampaigns, 30000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!selectedCampaign) return;
    viewCampaign(selectedCampaign);
    const intervalId = setInterval(() => viewCampaign(selectedCampaign), 30000);
    return () => clearInterval(intervalId);
  }, [selectedCampaign]);

  const fetchCampaigns = async () => {
    setIsLoading(true);
    setLoadError('');

    try {
      const res = await fetch(`${API_CONFIG.GET_CAMPAIGNS_STATS}`, { headers: authOptionalHeaders() });
      const data = await res.json();
      if (data.success) {
        setCampaigns(data.campaigns);
        if (data.campaigns && data.campaigns.length > 0) {
          refreshRepliesInBackground(data.campaigns);
        }
      } else {
        setLoadError(data.error || 'Failed to load campaign stats.');
      }
    } catch (e) {
      console.error(e);
      setLoadError('Unable to load campaign dashboard right now.');
    } finally {
      setIsLoading(false);
    }
  };

  const refreshRepliesInBackground = async (campaignList) => {
    setIsRefreshingReplies(true);
    try {
      await Promise.all(
        campaignList.map((campaign) =>
          fetch(API_CONFIG.GET_CAMPAIGN_RECIPIENTS.replace('{campaignId}', campaign.id), {
            method: 'GET',
            headers: authOptionalHeaders(),
          }).catch((error) => {
            console.error('Reply refresh failed for campaign', campaign.id, error);
          })
        )
      );
      const res = await fetch(`${API_CONFIG.GET_CAMPAIGNS_STATS}`, { headers: authOptionalHeaders() });
      const data = await res.json();
      if (data.success) {
        setCampaigns(data.campaigns);
      }
    } catch (error) {
      console.error('Background reply refresh failed:', error);
    } finally {
      setIsRefreshingReplies(false);
    }
  };

  const viewCampaign = async (campaignId) => {
    try {
      const res = await fetch(API_CONFIG.GET_CAMPAIGN_RECIPIENTS.replace('{campaignId}', campaignId), { headers: authOptionalHeaders() });
      const data = await res.json();
      if (data.success) {
        setRecipients(data.recipients);
        setSelectedCampaign(campaignId);
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="requirements-page">
      <Header />
      <div className="requirements-container">
        <div className="agent-page-header">
          <div className="agent-header-left">
            <BackButton />
            <div className="agent-header-content">
              <div className="agent-title-row">
                <h1>Campaign Dashboard</h1>
              </div>
              <p className="text-muted">
                Track email campaign performance, reply rates, and recipient status.
              </p>
            </div>
          </div>
          <div className="agent-header-right">
            <ProjectSelector agentKey="campaignDashboard" />
          </div>
        </div>

        <AgentOutcomesStrip
          items={[
            { iconSrc: '/assets/icons/mail.png', title: 'Email campaigns', description: 'Send and track outbound email from Market Research.' },
            { iconSrc: '/assets/icons/bar-chart.png', title: 'Reply metrics', description: 'Monitor sent, opened, and reply rates.' },
            { iconSrc: '/assets/icons/reports.png', title: 'Recipient detail', description: 'Drill into per-campaign recipient status.' },
          ]}
        />

        <LiveModeHint
          requireProject
          message="Choose a project from the header dropdown, or create one with + New Project."
        />

        <ProjectGate agentLabel="Campaign data">
        <div className="main-workspace-area">
          <div className="tabs-container">
            <button type="button" className="workspace-tab" onClick={() => navigate('/market-research')}>Market Research</button>
            <button type="button" className="workspace-tab active-tab">Campaign Dashboard</button>
          </div>

          <div className="workspace-content-box">
            <div className="ai-assisted transparent-bg">
              {!selectedCampaign ? (
                <div className="panel-content-flex">
                  <h2 className="section-title">Campaign Performance</h2>
                  <p className="section-subtitle">Reply data auto-refreshes every 30 seconds.</p>
                  {isLoading ? (
                    <p>Loading...</p>
                  ) : loadError ? (
                    <p className="error-text">{loadError}</p>
                  ) : campaigns.length === 0 ? (
                    <EmptyState
                      iconType="document"
                      title="No campaigns yet"
                      description="Email campaigns from Market Research will appear here. Create a campaign to get started."
                    />
                  ) : (
                    <div className="table-wrapper">
                      {isRefreshingReplies && <p className="section-subtitle">Refreshing reply counts...</p>}
                      <table className="research-table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Campaign Name</th>
                            <th>Subject Line</th>
                            <th className="text-center">Sent</th>
                            <th className="text-center">Replies</th>
                            <th className="text-center">Rate</th>
                            <th className="text-center">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {campaigns.map(c => (
                            <tr key={c.id}>
                              <td>{formatDate(c.createdAt)}</td>
                              <td>{c.name}</td>
                              <td>{c.subject}</td>
                              <td className="text-center">{c.totalSent}</td>
                              <td className="text-center">{c.totalReplied}</td>
                              <td className="text-center">{c.replyRate}%</td>
                              <td className="text-center">
                                <button className="table-btn-secondary" onClick={() => viewCampaign(c.id)}>
                                  View
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : (
                <div className="panel-content-flex">
                  <div className="section-header-row">
                    <h2 className="section-title no-border">Recipient Details</h2>
                    <button className="table-btn-outline" onClick={() => setSelectedCampaign(null)}>
                      Back to Campaigns
                    </button>
                  </div>
                  <div className="table-wrapper">
                    <table className="research-table">
                      <thead>
                        <tr>
                          <th>Business Name</th>
                          <th>Email Address</th>
                          <th>Sent At</th>
                          <th className="text-center">Reply Status</th>
                          <th>Replied At</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recipients.map((r, i) => (
                          <tr key={i}>
                            <td>{r.name || 'N/A'}</td>
                            <td>{r.email}</td>
                            <td>{formatDateTime(r.sentAt)}</td>
                            <td className="text-center">
                              <span className={`status-badge ${r.replyStatus === 'Replied' ? 'status-success' : 'status-pending'}`}>
                                {r.replyStatus}
                              </span>
                            </td>
                            <td>{r.repliedAt ? formatDateTime(r.repliedAt) : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        </ProjectGate>
      </div>
    </div>
  );
}

export default CampaignDashboard;
