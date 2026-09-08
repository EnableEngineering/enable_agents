import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';

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
import { useActivityTrail } from './hooks';
import './App.css';

// Pages
import Dashboard from './pages/Dashboard';
import Home from './pages/Home';
import ChatRoutingPage from './pages/ChatRoutingPage';

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

// Root redirect - go to the chat-first Home if logged in, /login otherwise
function RootRedirect() {
  return <Navigate to={isLoggedIn() ? '/home' : '/login'} replace />;
}

// The docked AI Assistant panel is redundant on pages that are themselves a
// full-page chat surface.
const PANEL_HIDDEN_PATHS = ['/home', '/route'];

// Unauthenticated-only pages - never show the logged-in app shell (sidebar,
// AI panel) here, and bounce an already-logged-in user straight to /home
// instead of stacking the auth card on top of the shell.
const AUTH_ONLY_PATHS = ['/login', '/register'];

function App() {
  const [loggedIn, setLoggedIn] = useState(isLoggedIn());
  const [panelOpen, setPanelOpen] = useState(() => {
    const saved = sessionStorage.getItem('aiAssistantOpen');
    if (saved !== null) return saved === 'true';
    // No saved preference yet: default open on desktop (it docks beside
    // content there), but default closed below the panel's own 1024px
    // breakpoint, where it switches to a 100vw overlay - opening it there
    // by default covers the entire page with no hint of what's underneath.
    return typeof window === 'undefined' || window.innerWidth > 1024;
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
      <AppShell
        loggedIn={loggedIn}
        panelOpen={panelOpen}
        onPanelToggle={handlePanelToggle}
      />
    </Router>
  );
}

function AppShell({ loggedIn, panelOpen, onPanelToggle }) {
  const location = useLocation();
  useActivityTrail();
  const isAuthOnlyPath = AUTH_ONLY_PATHS.includes(location.pathname);
  const showShell = loggedIn && !isAuthOnlyPath;
  const showPanel = showShell && !PANEL_HIDDEN_PATHS.includes(location.pathname);

  return (
    <>
      <SkipLink />
      <div className="App">
        <ErrorBoundary>
          {showShell && <Sidebar />}
          <main
            id="main-content"
            className={[
              showShell ? 'main-content--sidebar-open' : '',
              showPanel && panelOpen ? 'main-content--panel-open' : '',
              showPanel && !panelOpen ? 'main-content--panel-trigger' : '',
            ].filter(Boolean).join(' ')}
          >
          <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/login" element={loggedIn ? <Navigate to="/home" replace /> : <Login />} />
           <Route path="/register" element={loggedIn ? <Navigate to="/home" replace /> : <RegisterUser />} />
          <Route path="/home" element={<Home />} />
          <Route path="/route" element={<ChatRoutingPage />} />
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
          {showPanel && <AiAssistantPanel open={panelOpen} onToggle={onPanelToggle} />}
        </ErrorBoundary>
      </div>
    </>
  );
}

export default App;