import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/AgentsAssembly.css';
import { getRouteByModuleName } from '../config/agentsConfig';
import { BUSINESS_MODULES, TECHNICAL_MODULES, DEPARTMENT_COLORS } from '../data/agentCatalog';
import { CardGrid, ModuleCard } from './Card';

const ALL_MODULES = [...BUSINESS_MODULES, ...TECHNICAL_MODULES];
const DEPARTMENTS = ['All', ...Object.keys(DEPARTMENT_COLORS)];

function AgentsAssembly() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('All');
  const navigate = useNavigate();

  // Persist the department filter per tab session, same pattern the old
  // business/technical tab used.
  useEffect(() => {
    sessionStorage.setItem('agentsAssemblyDepartment', selectedDepartment);
  }, [selectedDepartment]);

  const handleOpenModule = (moduleName) => {
    const route = getRouteByModuleName(moduleName);
    if (route) navigate(route);
  };

  const handleFindAgent = () => {
    const task = searchTerm.trim();
    if (!task) return;
    sessionStorage.setItem('pendingTaskRoute', task);
    navigate('/route');
  };

  const term = searchTerm.trim().toLowerCase();

  // Relevance score for a search term against a module - higher weight for
  // a name match, then keywords, then the looser useCases/businessContext
  // fields, so e.g. searching "lead" surfaces Sales Helper Agent (via its
  // "lead management" keyword) ahead of a module that only mentions it in a
  // use case. 0 = no match. A whole-word name match (e.g. "Market" in
  // "Market Research") outweighs a substring-of-a-longer-word match (e.g.
  // "market" inside "marketing") so a query like "market" doesn't rank
  // Content Marketing Agent above Market Research just because "marketing"
  // happens to appear in more of its fields.
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

  const displayModules = ALL_MODULES
    .filter((module) => {
      if (selectedDepartment !== 'All' && module.department !== selectedDepartment) return false;
      if (term && scoreModule(module, term) === 0) return false;
      return true;
    })
    .sort((a, b) => {
      if (term) {
        const scoreDiff = scoreModule(b, term) - scoreModule(a, term);
        if (scoreDiff !== 0) return scoreDiff;
      }
      if (a.status === 'ready' && b.status !== 'ready') return -1;
      if (a.status !== 'ready' && b.status === 'ready') return 1;
      return 0;
    });

  return (
    <div className="agents-page">
      <div className="agents-assembly">
        <div className="agents-page-header">
          <h1>Agents</h1>
          <p>Every AI assistant available in Enable, organized by what they help you do.</p>
        </div>

        <div className="agent-find-bar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-subtle)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="agent-find-icon">
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            className="agent-find-input"
            placeholder='Describe what you&apos;re trying to do — e.g. "find new customers in India"'
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleFindAgent(); }}
            aria-label="Describe what you're trying to do"
          />
          <button type="button" className="btn btn-primary btn-sm agent-find-btn" onClick={handleFindAgent} disabled={!searchTerm.trim()}>
            Find agent
          </button>
        </div>
        <p className="agent-find-hint">We'll point you to the agent (or workflow) that best matches what you type.</p>

        <div className="department-chips" role="group" aria-label="Filter by department">
          {DEPARTMENTS.map((dept) => (
            <button
              key={dept}
              type="button"
              className={`department-chip ${selectedDepartment === dept ? 'department-chip--active' : ''}`}
              onClick={() => setSelectedDepartment(dept)}
            >
              {dept}
            </button>
          ))}
        </div>

        {displayModules.length === 0 ? (
          <div className="no-results">
            <h3>No agents found</h3>
            <p>Try adjusting your search or browse a different department.</p>
            <button type="button" onClick={() => { setSearchTerm(''); setSelectedDepartment('All'); }}>Clear filters</button>
          </div>
        ) : (
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
                  department={module.department}
                  departmentColor={DEPARTMENT_COLORS[module.department]}
                  onOpen={() => handleOpenModule(module.name)}
                />
              );
            })}
          </CardGrid>
        )}
      </div>
    </div>
  );
}

export default AgentsAssembly;
