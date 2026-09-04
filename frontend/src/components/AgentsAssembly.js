import axios from 'axios';
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/AgentsAssembly.css';
import { API_CONFIG } from '../config/apiConfig';
import { getRouteByModuleName } from '../config/agentsConfig';
import { BUSINESS_MODULES, TECHNICAL_MODULES } from '../data/agentCatalog';
import { showAlert } from './ConfirmDialog';
import { Modal, ModalTabs } from './Modal';
import { CardGrid, ModuleCard } from './Card';
import Select from './Select';
import LiveModeHint from './LiveModeHint';

const businessModules = BUSINESS_MODULES;
const technicalModules = TECHNICAL_MODULES;

function AgentsAssembly() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIndustry, setSelectedIndustry] = useState('');
  const [selectedProcess, setSelectedProcess] = useState('');
  const [businessPage, setBusinessPage] = useState(1);
  const [businessesPerPage] = useState(50); // Show 50 per page
  const [allBusinesses, setAllBusinesses] = useState([]);
  const [filteredModules, setFilteredModules] = useState([]);
  const [moduleTab, setModuleTab] = useState(() => {
    return sessionStorage.getItem('agentsAssemblyModuleTab') || 'business';
  });

  const navigate = useNavigate();

  // Persist module tab when it changes
  useEffect(() => {
    sessionStorage.setItem('agentsAssemblyModuleTab', moduleTab);
  }, [moduleTab]);

  // FIXED: Use useEffect to handle filtering instead of calling setState during render
  useEffect(() => {
    // Fetch businesses from backend with pagination
    const fetchBusinesses = async () => {
      try {
        const res = await axios.get(`${API_CONFIG.API_URL}/search_businesses`, {
          params: {
            query: searchTerm,
            location: selectedIndustry,
            max_results: 500,
            page: businessPage,
            per_page: businessesPerPage
          }
        });
        setAllBusinesses(res.data.businesses || []);
      } catch (err) {
        setAllBusinesses([]);
      }
    };
    if (searchTerm.trim() || selectedIndustry) {
      fetchBusinesses();
    }
    // Keep all modules
    const allModules = [...businessModules, ...technicalModules];
    setFilteredModules(allModules);

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      const matchesSearch = (module) =>
        module.name.toLowerCase().includes(term) ||
        (module.keywords && module.keywords.some(k => k.toLowerCase().includes(term)));

      // Switch to whichever tab actually has a match, so the grid isn't
      // left showing "no results" on a tab that was never searched
      if (!businessModules.some(matchesSearch) && technicalModules.some(matchesSearch)) {
        setModuleTab('technical');
      } else if (businessModules.some(matchesSearch) && !technicalModules.some(matchesSearch)) {
        setModuleTab('business');
      }
    }
  }, [searchTerm, selectedIndustry, selectedProcess, businessPage]);

  const handleTryModule = (moduleName) => {
    const route = getRouteByModuleName(moduleName);
    if (route) {
      navigate(route);
    }
  };

  const handleBuyModule = async (module) => {
    console.log('Requesting demo for:', module.name);
    await showAlert(
      `Interested in ${module.name}? We'd love to show you how it can help your business.\n\nContact our sales team:\n📧 sales@enableagents.com\n🌐 enableagents.com/demo`,
      'Request a Demo'
    );
  };

  // Process Map Popup State
  const [showProcessMap, setShowProcessMap] = useState(false);
  const [processMapTab, setProcessMapTab] = useState('visual');
  const [processMapData, setProcessMapData] = useState(null);

  // Dummy process map generator
  const generateProcessMapData = () => {
    return {
      industry: selectedIndustry || 'Generic',
      department: 'General',
      responsibilities: ['Planning', 'Execution', 'Reporting'],
      steps: [
        { name: 'Initiate', description: 'Start the process', owner: 'Manager' },
        { name: 'Plan', description: 'Plan activities', owner: 'Team Lead' },
        { name: 'Execute', description: 'Carry out tasks', owner: 'Staff' },
        { name: 'Report', description: 'Report outcomes', owner: 'Analyst' }
      ]
    };
  };

  // Handler for process icon click
  const handleProcessClick = () => {
    setProcessMapData(generateProcessMapData());
    setShowProcessMap(true);
    setProcessMapTab('visual');
  };

  // Close popup
  const handleCloseProcessMap = () => {
    setShowProcessMap(false);
  };

  return (
    <div className="agents-page">
      <div className="agents-assembly">
        <div className="agents-hub-banner">
          <LiveModeHint message="Browse agents below to get started." />
        </div>
        {/* Process Map Modal */}
        <Modal
          open={showProcessMap}
          onClose={handleCloseProcessMap}
          title="Process Map"
          size="lg"
        >
          <ModalTabs
            tabs={[
              {
                id: 'visual',
                label: 'Visual',
                content: processMapData && (
                  <div className="process-map-visual">
                    <div className="process-map-info">
                      <p><strong>Industry:</strong> {processMapData.industry}</p>
                      <p><strong>Department:</strong> {processMapData.department}</p>
                      <p><strong>Responsibilities:</strong> {Array.isArray(processMapData.responsibilities) ? processMapData.responsibilities.join(', ') : processMapData.responsibilities}</p>
                    </div>
                    <div className="process-map-steps">
                      <h4>Process Steps</h4>
                      <ol>
                        {processMapData.steps.map((step, idx) => (
                          <li key={idx}>
                            <strong>{step.name}</strong>: {step.description}
                            <span className="process-step-owner">({step.owner})</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  </div>
                )
              }
            ]}
            activeTab={processMapTab}
            onTabChange={setProcessMapTab}
          />
        </Modal>
        <div className="page-header-row">
          <h2>Agents Assembly</h2>
        </div>


        {/* Unified toolbar: Tabs | Search | Filters */}
        <div className="agents-toolbar">
          <div className="module-tabs" role="tablist" aria-label="Module categories">
            <button
              role="tab"
              className={`module-tab module-tab--business ${moduleTab === 'business' ? 'module-tab--active' : ''}`}
              aria-selected={moduleTab === 'business'}
              onClick={() => setModuleTab('business')}
            >
              Business ({businessModules.length})
            </button>
            <button
              role="tab"
              className={`module-tab module-tab--technical ${moduleTab === 'technical' ? 'module-tab--active' : ''}`}
              aria-selected={moduleTab === 'technical'}
              onClick={() => setModuleTab('technical')}
            >
              Technical ({technicalModules.length})
            </button>
          </div>

          <div className="agent-search-wrapper">
            <input
              type="text"
              className="agent-search-input"
              placeholder="Search agent..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              aria-label="Search agent"
            />
            {searchTerm && (
              <button
                className="agent-search-clear"
                onClick={() => setSearchTerm('')}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>

          <div className="filter-chips" role="group" aria-label="Filter modules">
            <Select
              value={selectedIndustry}
              onChange={(e) => setSelectedIndustry(e.target.value)}
              aria-label="Select industry"
            >
              <option value="">All Industries</option>
              <option value="Retail">Retail</option>
              <option value="Food Service">Food Service</option>
              <option value="Manufacturing">Manufacturing</option>
              <option value="Healthcare">Healthcare</option>
              <option value="Finance">Finance</option>
              <option value="Technology">Technology</option>
              <option value="Consulting">Consulting</option>
            </Select>
            <Select
              value={selectedProcess}
              onChange={(e) => setSelectedProcess(e.target.value)}
              aria-label="Select process"
            >
              <option value="">All Processes</option>
              <option value="Sales">Sales</option>
              <option value="Procurement">Procurement</option>
              <option value="HR">HR</option>
              <option value="Operations">Operations</option>
              <option value="Finance">Finance</option>
              <option value="Customer Service">Customer Service</option>
            </Select>
            {(selectedIndustry || selectedProcess) && (
              <button
                className="clear-filters-btn"
                onClick={() => {
                  setSelectedIndustry('');
                  setSelectedProcess('');
                }}
                title="Clear filters"
                aria-label="Clear all filters"
              >
                ×
              </button>
            )}
          </div>
        </div>

        {/* Modules Section - Responsive grid of shared ModuleCards */}
        {(() => {
          const term = searchTerm.trim().toLowerCase();

          // Relevance score for a search term against a module - higher
          // weight for a name match, then keywords, then the looser
          // useCases/businessContext fields, so e.g. searching "lead"
          // surfaces Sales Helper Agent (via its "lead management" keyword)
          // ahead of a module that only mentions it in a use case. 0 = no
          // match. A whole-word name match (e.g. "Market" in "Market
          // Research") outweighs a substring-of-a-longer-word match (e.g.
          // "market" inside "marketing") so a query like "market" doesn't
          // rank Content Marketing Agent above Market Research just
          // because "marketing" happens to appear in more of its fields.
          const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const scoreModule = (module, searchTerm) => {
            let score = 0;
            const name = module.name.toLowerCase();
            if (name.includes(searchTerm)) {
              const wordBoundary = new RegExp(`\\b${escapeRegExp(searchTerm)}\\b`);
              score += wordBoundary.test(name) ? 25 : 10;
            }
            if (module.keywords?.some(k => k.toLowerCase().includes(searchTerm))) score += 5;
            if (module.useCases?.some(u => u.toLowerCase().includes(searchTerm))) score += 2;
            if (module.businessContext?.some(c => c.toLowerCase().includes(searchTerm))) score += 2;
            return score;
          };

          const displayModules = filteredModules
            .filter(module => {
              // Filter by tab (business/technical)
              if (moduleTab === 'business') {
                if (!businessModules.some(b => b.name === module.name)) return false;
              } else {
                if (!technicalModules.some(t => t.name === module.name)) return false;
              }
              // Filter by industry
              if (selectedIndustry && module.industries) {
                const industryMatch = module.industries.some(ind =>
                  ind.toLowerCase().includes(selectedIndustry.toLowerCase()) ||
                  ind.toLowerCase() === 'all industries'
                );
                if (!industryMatch) return false;
              }
              // Filter by process
              if (selectedProcess && module.keywords) {
                const processMatch = module.keywords.some(kw =>
                  kw.toLowerCase().includes(selectedProcess.toLowerCase())
                ) || (module.businessContext && module.businessContext.some(ctx =>
                  ctx.toLowerCase().includes(selectedProcess.toLowerCase())
                ));
                if (!processMatch) return false;
              }
              // Filter by search term - relevance score, not just presence
              if (term && scoreModule(module, term) === 0) return false;
              return true;
            })
            .sort((a, b) => {
              // While searching, rank by relevance first
              if (term) {
                const scoreDiff = scoreModule(b, term) - scoreModule(a, term);
                if (scoreDiff !== 0) return scoreDiff;
              }
              if (a.status === 'ready' && b.status !== 'ready') return -1;
              if (a.status !== 'ready' && b.status === 'ready') return 1;
              return 0;
            });

          if (displayModules.length === 0) {
            return (
              <div className="no-results">
                <h3>No modules found</h3>
                <p>Try adjusting your search or browse all available modules.</p>
                <button type="button" onClick={() => setSearchTerm('')}>Clear Search</button>
              </div>
            );
          }

          return (
            <CardGrid columns="auto" gap="md" className="catalog-grid">
              {displayModules.map((module) => {
                const isReady = module.status === 'ready';
                return (
                  <ModuleCard
                    key={module.name}
                    icon={module.icon}
                    title={module.name}
                    description={module.description}
                    price={module.price}
                    status={isReady ? 'ready' : 'in-progress'}
                    locked={!isReady}
                    onTry={() => { if (isReady) handleTryModule(module.name); }}
                    onBuy={() => handleBuyModule(module)}
                  />
                );
              })}
            </CardGrid>
          );
        })()}
      </div>
    </div>
  );
}

export default AgentsAssembly;