import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

// Shared UI
import Login from './core/Login';
import SkipLink from './components/SkipLink';
import { ErrorBoundary } from './components';
import RegisterUser from './core/RegisterUser';
import Settings from './settings/Settings';
import Team from './team/Team';
import Projects from './projects/Projects';
import Usage from './usage/Usage';
import Sidebar from './core/Sidebar';
import AiAssistantPanel from './components/AiAssistantPanel';
import './App.css';

// Pages
import Dashboard from './pages/Dashboard';

// Agent components
import AgentsAssembly from './components/AgentsAssembly';
import RequirementsGathering from './agents/RequirementsGathering';
import CampaignDashboard from './agents/CampaignDashboard';
import EventNetworkingAgent from './agents/EventNetworkingAgent';
import DataInsights from './agents/DataInsights';
import Chatbot from './agents/Chatbot';
import CommunityNetworkAgent from './agents/CommunityNetworkAgent';
import SalesHelperAgent from './agents/SalesHelperAgent';
import ContentMarketingAgent from './agents/ContentMarketingAgent';
import InvestAgent from './agents/InvestAgent';
import SupplyChainAgent from './agents/SupplyChainAgent';
import ExecutiveAssistantPage from './agents/ExecutiveAssistantPage';
import EmailOutreachAgent from './agents/EmailOutreachAgent';

// Workflows
import WorkflowsPage from './workflows/WorkflowsPage';
import WorkflowRunner from './workflows/WorkflowRunner';


// Check if user is logged in (has session token)
function isLoggedIn() {
  return Boolean(localStorage.getItem('sessionToken') || localStorage.getItem('userEmail'));
}

// Root redirect - go to /dashboard if logged in, /login otherwise
function RootRedirect() {
  return <Navigate to={isLoggedIn() ? '/dashboard' : '/login'} replace />;
}

function App() {
  const [loggedIn, setLoggedIn] = useState(isLoggedIn());
  const [panelOpen, setPanelOpen] = useState(() => {
    const saved = sessionStorage.getItem('aiAssistantOpen');
    return saved === null ? true : saved === 'true';
  });

  // isLoggedIn() reads localStorage, which doesn't trigger a React re-render
  // on its own - listen for the same custom event used for same-tab
  // localStorage sync (Login/RegisterUser dispatch it on sign-in, Settings
  // on sign-out) plus the native storage event for cross-tab sign-in/out,
  // so the panel appears/disappears without a full page reload.
  useEffect(() => {
    const handleAuthChange = () => setLoggedIn(isLoggedIn());
    window.addEventListener('authChange', handleAuthChange);
    window.addEventListener('storage', handleAuthChange);
    return () => {
      window.removeEventListener('authChange', handleAuthChange);
      window.removeEventListener('storage', handleAuthChange);
    };
  }, []);

  const handlePanelToggle = (next) => {
    setPanelOpen(next);
    sessionStorage.setItem('aiAssistantOpen', next.toString());
  };

  return (
    <Router>
      <SkipLink />
      <div className="App">
        <ErrorBoundary>
          {loggedIn && <Sidebar />}
          <main
            id="main-content"
            className={[
              loggedIn ? 'main-content--sidebar-open' : '',
              loggedIn && panelOpen ? 'main-content--panel-open' : '',
            ].filter(Boolean).join(' ')}
          >
          <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/login" element={<Login />} />
           <Route path="/register" element={<RegisterUser />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/market-research" element={<RequirementsGathering />} />
          <Route path="/market-research/campaigns" element={<CampaignDashboard />} />
          {/* Redirects for old paths */}
          <Route path="/requirements" element={<Navigate to="/market-research" replace />} />
          <Route path="/campaign-dashboard" element={<Navigate to="/market-research/campaigns" replace />} />
          <Route path="/agents" element={<AgentsAssembly />} />
          <Route path="/agents-assembly" element={<AgentsAssembly />} />
          <Route path="/data-insights" element={<DataInsights />} />
          <Route path="/datainsights" element={<Navigate to="/data-insights" replace />} /> 
          <Route path="/aichatbot" element={<Chatbot />} />
          <Route path="/community-network" element={<CommunityNetworkAgent />} />
          <Route path="/sales-helper" element={<SalesHelperAgent />} />
          <Route path="/content-marketing" element={<ContentMarketingAgent />} />
          <Route path="/event-networking" element={<EventNetworkingAgent />} />
          <Route path="/event-networking-agent" element={<EventNetworkingAgent />} />
          <Route path="/invest-agent" element={<InvestAgent />} />
          <Route path="/supply-chain-agent" element={<SupplyChainAgent />} />
          <Route path="/executive-assistant" element={<ExecutiveAssistantPage />} />
          <Route path="/email-outreach" element={<EmailOutreachAgent />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/team" element={<Team />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/usage" element={<Usage />} />
          <Route path="/workflows" element={<WorkflowsPage />} />
          <Route path="/workflows/:instanceId" element={<WorkflowRunner />} />
          </Routes>
          </main>
          {loggedIn && <AiAssistantPanel open={panelOpen} onToggle={handlePanelToggle} />}
        </ErrorBoundary>
      </div>
    </Router>
  );
}

export default App;