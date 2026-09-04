import React, { useState, useEffect, useRef } from 'react';
import Header from '../core/Header';
import '../styles/ExecutiveAssistantPage.css';
import { showToast } from '../core/toast';
import { Input, Textarea, BackButton, ProjectSelector, LiveModeHint, AgentOutcomesStrip, EmptyState, ProjectGate, WorkflowExecutionBanner, WorkflowContextCard } from '../components';
import ReminderModal from '../components/ReminderModal';
import { setAgentData, AGENT_KEYS } from '../utils';
import { formatDate } from '../utils/dateFormat';
import { useProjectData } from '../hooks/useProjectData';
import { useSelectedProjectId } from '../hooks/useSelectedProjectId';
import { useWorkflowContext } from '../hooks';

function ExecutiveAssistantPage() {
  // Workflow context - for saving results back to workflow
  const { isInWorkflow, isHistoryView, stageData, stageId, saveStageData, getContext, context: workflowContext } = useWorkflowContext();

  // Global project data hook - manages cross-agent project context
  const {
    project: globalProject,
    hasProject: hasGlobalProject,
    data: projectData,
    saveData: saveProjectData,
    sharedData,
    getSharedAgentData,
    hasSharedData,
  } = useProjectData('executiveAssistant', {
    defaultData: { localProjects: [], tasks: [], people: [] },
    onProjectLoad: (project, data, shared) => {
      const hasSavedData = data?.localProjects?.length || data?.tasks?.length || data?.people?.length;

      if (hasSavedData) {
        setProjects(data.localProjects || []);
        setTasks(data.tasks || []);
        setPeople(data.people || []);
      } else {
        setProjects([]);
        setTasks([]);
        setPeople([]);
      }

      if (shared && Object.keys(shared).length > 0) {
        const agentNames = Object.keys(shared).join(', ');
        console.log(`Shared data available from: ${agentNames}`);
      }
    },
  });

  const selectedProjectId = useSelectedProjectId();

  const [activeTab, setActiveTab] = useState('projects-tasks');

  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [people, setPeople] = useState([]);
  const [showPersonForm, setShowPersonForm] = useState(false);

  // Form states
  const [newTask, setNewTask] = useState({
    id: '',
    projectId: '',
    title: '',
    description: '',
    assignedTo: '',
    dueDate: '',
    priority: 'Medium',
    status: 'Pending'
  });

  const [newPerson, setNewPerson] = useState({
    id: '',
    name: '',
    email: '',
    phone: '',
    role: '',
    projects: []
  });

  // Drag state - track what we're dragging and where
  const [draggedTaskId, setDraggedTaskId] = useState(null);
  const [dragOverTarget, setDragOverTarget] = useState(null); // 'column-Pending' | 'person-id123'

  // Reminder modal state
  const [reminderTask, setReminderTask] = useState(null);
  const [reminderPerson, setReminderPerson] = useState(null);

  // Clear local state when no project is selected
  useEffect(() => {
    if (!selectedProjectId) {
      setProjects([]);
      setTasks([]);
      setPeople([]);
    }
  }, [selectedProjectId]);

  // Debounced save to prevent flicker from rapid re-renders
  const saveTimeoutRef = useRef(null);
  // Use ref for saveProjectData to avoid dependency instability
  const saveProjectDataRef = useRef(saveProjectData);
  saveProjectDataRef.current = saveProjectData;

  useEffect(() => {
    if (!selectedProjectId) return;
    if (projects.length > 0 || tasks.length > 0 || people.length > 0) {
      // Clear previous timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // Debounce save by 300ms
      saveTimeoutRef.current = setTimeout(() => {
        // Save to agent-specific storage
        setAgentData(AGENT_KEYS.EXECUTIVE_ASSISTANT, { projects, tasks, people });

        // Also save to global project if one is selected
        if (hasGlobalProject) {
          saveProjectDataRef.current({
            localProjects: projects,
            tasks: tasks,
            people: people,
            lastUpdated: new Date().toISOString(),
          });
        }
      }, 300);
    }

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [projects, tasks, people, hasGlobalProject, selectedProjectId]);

  // Add Task
  const quickAddTextareaRef = useRef(null);

  const handleAddTask = () => {
    if (newTask.title.trim()) {
      const task = {
        ...newTask,
        id: Date.now().toString(),
        projectId: selectedProjectId || 'default'
      };
      setTasks([...tasks, task]);
      setNewTask({
        id: '',
        projectId: '',
        title: '',
        description: '',
        assignedTo: '',
        dueDate: '',
        priority: 'Medium',
        status: 'Pending'
      });
      if (quickAddTextareaRef.current) {
        quickAddTextareaRef.current.style.height = 'auto';
      }
    }
  };

  // Delete Task
  const handleDeleteTask = (id) => {
    setTasks(tasks.filter(t => t.id !== id));
  };

  // Add Person
  const handleAddPerson = () => {
    if (newPerson.name.trim() && newPerson.email.trim()) {
      const person = {
        ...newPerson,
        id: Date.now().toString()
      };
      setPeople([...people, person]);
      setNewPerson({
        id: '',
        name: '',
        email: '',
        phone: '',
        role: '',
        projects: []
      });
      setShowPersonForm(false);
    }
  };

  // Delete Person
  const handleDeletePerson = (id) => {
    setPeople(people.filter(p => p.id !== id));
  };

  // Save workflow progress when tasks are completed (for Final Selection stage)
  const saveWorkflowProgress = React.useCallback(() => {
    if (!isInWorkflow) return;

    const completedTasks = tasks.filter(t => t.status === 'Completed');
    const pendingTasks = tasks.filter(t => t.status === 'Pending');
    const inProgressTasks = tasks.filter(t => t.status === 'In Progress');

    saveStageData({
      total_tasks: tasks.length,
      completed_tasks: completedTasks.length,
      pending_tasks: pendingTasks.length,
      in_progress_tasks: inProgressTasks.length,
      completion_rate: tasks.length > 0 ? Math.round((completedTasks.length / tasks.length) * 100) : 0,
      recent_completions: completedTasks.slice(-3).map(t => t.title),
      team_members: people.length,
    });
  }, [isInWorkflow, tasks, people, saveStageData]);

  // Auto-save to workflow when significant changes occur
  useEffect(() => {
    if (isInWorkflow && tasks.length > 0) {
      const timer = setTimeout(saveWorkflowProgress, 2000); // Debounce
      return () => clearTimeout(timer);
    }
  }, [isInWorkflow, tasks, saveWorkflowProgress]);

  // Load workflow data when viewing completed stage history
  useEffect(() => {
    if (!isHistoryView) return;

    const data = stageData && Object.keys(stageData).length > 0 ? stageData : null;
    if (!data) return;

    console.log('[ExecutiveAssistant] Loading workflow history:', { isHistoryView, stageData: data });

    // The data contains task statistics from the workflow
    // We can't reconstruct full tasks, but we can show that the stage was completed
    // If recent_completions are available, we could try to match them to existing tasks
    if (data.recent_completions && data.recent_completions.length > 0) {
      // Mark tasks with matching titles as completed
      setTasks(prev => prev.map(t =>
        data.recent_completions.includes(t.title)
          ? { ...t, status: 'Completed' }
          : t
      ));
    }
  }, [isHistoryView, stageData]);

  const getInitials = (name) => {
    return name
      .split(' ')
      .filter(Boolean)
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  };

  const getMonogramVariant = (id) => {
    const variants = ['ember', 'ink', 'sage', 'slate'];
    let hash = 0;
    for (let i = 0; i < id.length; i += 1) {
      hash = id.charCodeAt(i) + ((hash << 5) - hash);
    }
    return variants[Math.abs(hash) % variants.length];
  };

  return (
    <div className="executive-assistant-page">
      <Header />

      <div className="agent-page-header">
        <div className="agent-header-left">
          {!isInWorkflow && <BackButton />}
          <div className="agent-header-content">
            <div className="agent-title-row">
              <h1>Executive Assistant</h1>
            </div>
            <p className="text-muted">
              Manage projects, tasks, and team coordination. Send email reminders to keep stakeholders aligned.
            </p>
          </div>
        </div>
        <div className="agent-header-right">
          <ProjectSelector
            agentKey="executiveAssistant"
            onProjectChange={(project) => {
              if (project) {
                showToast(`Loaded project: ${project.name}`, 'success');
              }
            }}
          />
        </div>
      </div>

      <AgentOutcomesStrip
        items={[
          { iconSrc: '/assets/icons/checklist.png', title: 'Track projects', description: 'Organize work by project with due dates and status.' },
          { iconSrc: '/assets/icons/users.png', title: 'Assign tasks', description: 'Delegate tasks to team members and track progress.' },
          { iconSrc: '/assets/icons/mail.png', title: 'Email reminders', description: 'Send reminders to stakeholders via email.' },
        ]}
      />

      <LiveModeHint
        requireProject
        message="Choose a project from the header dropdown, or create one with + New Project."
      />

      <div className="ea-container">
        <div className="ea-tabs module-tabs">
          <button
            type="button"
            className={`module-tab ${activeTab === 'projects-tasks' ? 'module-tab--active' : ''}`}
            onClick={() => setActiveTab('projects-tasks')}
          >
            Task Board
          </button>
          <button
            type="button"
            className={`module-tab ${activeTab === 'people' ? 'module-tab--active' : ''}`}
            onClick={() => setActiveTab('people')}
          >
            Team ({people.length})
          </button>
        </div>

        <ProjectGate agentLabel="Executive Assistant workspace">
        <WorkflowExecutionBanner />

        {/* Show context from previous workflow stages */}
        {isInWorkflow && !isHistoryView && (
          <WorkflowContextCard context={getContext()} currentStageId={stageId} />
        )}

        {/* Shared Context Banner - Shows when global project has data from other agents */}
        {hasGlobalProject && Object.keys(sharedData).length > 0 && (
          <div className="shared-context-banner">
            <div className="shared-context-icon">
              <img src="/assets/icons/integration.png" alt="" width={20} height={20} />
            </div>
            <div className="shared-context-info">
              <strong>Project Context Available</strong>
              <span>
                Data from: {Object.keys(sharedData).map(key => {
                  const names = {
                    salesHelper: 'Sales Helper',
                    contentMarketing: 'Content Marketing',
                    eventNetworking: 'Event Networking',
                    communityNetwork: 'Community Network',
                    dataInsights: 'Data Insights',
                    marketResearch: 'Market Research',
                  };
                  return names[key] || key;
                }).join(', ')}
              </span>
            </div>
            {hasSharedData('salesHelper') && getSharedAgentData('salesHelper')?.totalPipeline && (
              <div className="shared-stat">
                <span className="stat-value">${(getSharedAgentData('salesHelper').totalPipeline / 1000).toFixed(0)}k</span>
                <span className="stat-label">Pipeline</span>
              </div>
            )}
            {hasSharedData('salesHelper') && getSharedAgentData('salesHelper')?.leads && (
              <div className="shared-stat">
                <span className="stat-value">{getSharedAgentData('salesHelper').leads.length}</span>
                <span className="stat-label">Leads</span>
              </div>
            )}
            {hasSharedData('eventNetworking') && getSharedAgentData('eventNetworking')?.attendees && (
              <div className="shared-stat">
                <span className="stat-value">{getSharedAgentData('eventNetworking').attendees.length}</span>
                <span className="stat-label">Attendees</span>
              </div>
            )}
          </div>
        )}

        {/* Task Board */}
        {activeTab === 'projects-tasks' && (
          <div className="ea-content projects-tasks-section">
            {/* Quick Add Bar */}
            <div className="quick-add-bar">
              <Textarea
                ref={quickAddTextareaRef}
                rows={1}
                className="quick-add-textarea"
                placeholder={isHistoryView ? "Viewing completed stage - inputs disabled" : "Add a new task..."}
                value={newTask.title}
                onChange={(e) => {
                  setNewTask({ ...newTask, title: e.target.value });
                  const el = e.target;
                  el.style.height = 'auto';
                  el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (newTask.title.trim() && !isHistoryView) {
                      handleAddTask();
                    }
                  }
                }}
                disabled={isHistoryView}
              />
              {people.length > 0 && (
                <div className="assignee-pills">
                  {people.slice(0, 4).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`assignee-pill ${newTask.assignedTo === p.id ? 'active' : ''}`}
                      onClick={() => setNewTask({ ...newTask, assignedTo: newTask.assignedTo === p.id ? '' : p.id })}
                      title={p.name}
                    >
                      {getInitials(p.name)}
                    </button>
                  ))}
                </div>
              )}
              <div className="priority-pills">
                {['Low', 'Medium', 'High'].map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`priority-pill ${p.toLowerCase()} ${newTask.priority === p ? 'active' : ''}`}
                    onClick={() => setNewTask({ ...newTask, priority: p })}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn-add-task"
                disabled={!newTask.title.trim() || isHistoryView}
                onClick={handleAddTask}
              >
                Add
              </button>
            </div>

            {/* Team Strip - Drag tasks here to assign */}
            {people.length > 0 && (
              <div className="team-strip">
                <span className="team-strip-label">Drag to assign:</span>
                <div className="team-strip-members">
                  {people.map((person) => {
                    const personTaskCount = tasks.filter(t => t.assignedTo === person.id && t.status !== 'Completed').length;
                    const isDropTarget = dragOverTarget === `person-${person.id}`;
                    return (
                      <div
                        key={person.id}
                        className={`team-strip-member ${isDropTarget ? 'drag-over' : ''}`}
                        onDragEnter={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setDragOverTarget(`person-${person.id}`);
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onDragLeave={(e) => {
                          if (!e.currentTarget.contains(e.relatedTarget)) {
                            setDragOverTarget(null);
                          }
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (draggedTaskId) {
                            setTasks(prev => prev.map(t => t.id === draggedTaskId ? { ...t, assignedTo: person.id } : t));
                            showToast(`Assigned to ${person.name}`, 'success');
                          }
                          setDragOverTarget(null);
                          setDraggedTaskId(null);
                        }}
                        title={`${person.name} • ${personTaskCount} open tasks`}
                      >
                        <div className={`team-strip-avatar ${getMonogramVariant(person.id)}`}>
                          {getInitials(person.name)}
                        </div>
                        <span className="team-strip-name">{person.name.split(' ')[0]}</span>
                        {personTaskCount > 0 && (
                          <span className="team-strip-badge">{personTaskCount}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="team-strip-add"
                  onClick={() => setActiveTab('people')}
                  title="Add team member"
                >
                  +
                </button>
              </div>
            )}

            {people.length === 0 && (
              <div className="team-strip team-strip--empty">
                <span className="team-strip-hint">Add team members to assign tasks</span>
                <button
                  type="button"
                  className="btn-compact"
                  onClick={() => setActiveTab('people')}
                >
                  + Add Team
                </button>
              </div>
            )}

            {/* Kanban Board */}
            <div className="kanban-board">
              {['Pending', 'In Progress', 'Completed'].map((status) => {
                const columnTasks = tasks.filter(t => t.status === status);
                const isDropTarget = dragOverTarget === `column-${status}`;
                return (
                  <div
                    key={status}
                    className={`kanban-column ${status.toLowerCase().replace(' ', '-')} ${isDropTarget ? 'drag-over' : ''}`}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDragOverTarget(`column-${status}`);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDragLeave={(e) => {
                      // Only clear if leaving the column entirely (not entering a child)
                      if (!e.currentTarget.contains(e.relatedTarget)) {
                        setDragOverTarget(null);
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (draggedTaskId) {
                        setTasks(prev => prev.map(t => t.id === draggedTaskId ? { ...t, status } : t));
                        showToast(`Moved to ${status}`, 'success');
                      }
                      setDragOverTarget(null);
                      setDraggedTaskId(null);
                    }}
                  >
                    <div className="kanban-column-header">
                      <span className="column-title">{status}</span>
                      <span className="column-count">{columnTasks.length}</span>
                    </div>
                    <div className="kanban-column-body">
                      {columnTasks.length === 0 && status === 'Pending' && tasks.length === 0 && (
                        <p className="kanban-empty-hint">Type a task above and press Enter</p>
                      )}
                      {columnTasks.length === 0 && tasks.length > 0 && (
                        <p className="kanban-empty-hint">Drop tasks here</p>
                      )}
                      {columnTasks.map((task) => {
                        const assignedPerson = people.find(p => p.id === task.assignedTo);
                        return (
                          <article
                            key={task.id}
                            className={`kanban-card ${task.priority.toLowerCase()} ${draggedTaskId === task.id ? 'dragging' : ''}`}
                            draggable="true"
                            onDragStart={(e) => {
                              e.stopPropagation();
                              e.dataTransfer.effectAllowed = 'move';
                              e.dataTransfer.setData('text/plain', task.id);
                              e.dataTransfer.setDragImage(e.currentTarget, 50, 20);
                              setDraggedTaskId(task.id);
                            }}
                            onDragEnd={() => {
                              setDraggedTaskId(null);
                              setDragOverTarget(null);
                            }}
                          >
                            <span className={`priority-dot ${task.priority.toLowerCase()}`} />
                            <div className="kanban-card-content">
                              <span className="kanban-card-title">{task.title}</span>
                              <div className="kanban-card-meta">
                                {assignedPerson ? (
                                  <span
                                    className="assignee-chip"
                                    title={assignedPerson.name}
                                  >
                                    {getInitials(assignedPerson.name)}
                                  </span>
                                ) : (
                                  <span className="unassigned-chip" title="Unassigned">—</span>
                                )}
                                {task.dueDate && <span className="kanban-due">{formatDate(task.dueDate)}</span>}
                              </div>
                            </div>
                            {/* Card Actions */}
                            <div className="kanban-card-actions">
                              {assignedPerson && (
                                <button
                                  type="button"
                                  className="card-action-btn remind"
                                  draggable="false"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setReminderTask(task);
                                  }}
                                  title={`Send reminder to ${assignedPerson.name}`}
                                >
                                  <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
                                    <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
                                  </svg>
                                </button>
                              )}
                              <button
                                type="button"
                                className="card-action-btn delete"
                                draggable="false"
                                onClick={(e) => { e.stopPropagation(); handleDeleteTask(task.id); }}
                                title="Delete task"
                              >
                                ×
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Reminder Modal - Multi-channel (Task) */}
        <ReminderModal
          isOpen={!!reminderTask}
          onClose={() => setReminderTask(null)}
          recipient={reminderTask ? people.find(p => p.id === reminderTask.assignedTo) : null}
          context={reminderTask ? {
            taskTitle: reminderTask.title,
            taskDetails: {
              status: reminderTask.status,
              priority: reminderTask.priority,
              dueDate: reminderTask.dueDate ? formatDate(reminderTask.dueDate) : null,
            },
          } : null}
        />

        {/* Reminder Modal - Multi-channel (Person) */}
        <ReminderModal
          isOpen={!!reminderPerson}
          onClose={() => setReminderPerson(null)}
          recipient={reminderPerson}
          context={reminderPerson ? {
            taskTitle: null,
            taskDetails: null,
          } : null}
        />

        {activeTab === 'people' && (
          <div className="ea-content people-section">
            <div className="section-header">
              <h2>Team & Stakeholders</h2>
              <div className="header-actions">
                <button type="button" className="btn-compact" onClick={() => setShowPersonForm(v => !v)} disabled={isHistoryView}>
                  {showPersonForm ? 'Cancel' : '+ Person'}
                </button>
              </div>
            </div>

            {showPersonForm && (
              <div className="inline-panel person-form-panel">
                <div className="inline-panel-header">
                  <div className="panel-header-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </div>
                  <div className="panel-header-text">
                    <h3>Add Team Member</h3>
                    <p>Add a person to collaborate with or send reminders to</p>
                  </div>
                </div>
                <div className="inline-panel-body person-form-body">
                  <div className="person-form-grid">
                    <div className="field">
                      <label className="input-label input-required">Full Name</label>
                      <Input placeholder="John Smith" value={newPerson.name} onChange={(e) => setNewPerson({ ...newPerson, name: e.target.value })} />
                    </div>
                    <div className="field">
                      <label className="input-label input-required">Email Address</label>
                      <Input type="email" placeholder="john@company.com" value={newPerson.email} onChange={(e) => setNewPerson({ ...newPerson, email: e.target.value })} />
                    </div>
                    <div className="field">
                      <label className="input-label">Role / Title</label>
                      <Input placeholder="Product Manager" value={newPerson.role} onChange={(e) => setNewPerson({ ...newPerson, role: e.target.value })} />
                    </div>
                    <div className="field">
                      <label className="input-label">Phone</label>
                      <Input type="tel" placeholder="+1 (555) 123-4567" value={newPerson.phone} onChange={(e) => setNewPerson({ ...newPerson, phone: e.target.value })} />
                    </div>
                  </div>
                </div>
                <div className="inline-panel-footer">
                  <button type="button" className="btn btn-ghost" onClick={() => setShowPersonForm(false)}>Cancel</button>
                  <button type="button" className="btn btn-primary" onClick={handleAddPerson} disabled={!newPerson.name.trim() || !newPerson.email.trim() || isHistoryView}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="8.5" cy="7" r="4" />
                      <line x1="20" y1="8" x2="20" y2="14" />
                      <line x1="23" y1="11" x2="17" y2="11" />
                    </svg>
                    Add Person
                  </button>
                </div>
              </div>
            )}

            {people.length === 0 ? (
              <EmptyState
                iconType="data"
                title="No people added"
                description="Add team members with email addresses to send reminders."
                action={{ label: 'Add person', onClick: () => setShowPersonForm(true) }}
              />
            ) : (
              <div className="visiting-cards-grid">
                {people.map((person) => (
                  <article key={person.id} className="visiting-card">
                    <button
                      type="button"
                      className="visiting-card-remove"
                      aria-label={`Remove ${person.name}`}
                      onClick={() => handleDeletePerson(person.id)}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>

                    <div className="visiting-card-accent" aria-hidden="true" />

                    <div className="visiting-card-top">
                      <div className={`visiting-card-monogram visiting-card-monogram--${getMonogramVariant(person.id)}`}>
                        {getInitials(person.name)}
                      </div>
                      <div className="visiting-card-identity">
                        <h3 className="visiting-card-name">{person.name}</h3>
                        <p className="visiting-card-role">{person.role || 'Team member'}</p>
                      </div>
                    </div>

                    <div className="visiting-card-divider" aria-hidden="true" />

                    <div className="visiting-card-contacts">
                      {person.email && (
                        <a className="visiting-card-contact" href={`mailto:${person.email}`}>
                          <img src="/assets/icons/mail.png" alt="" className="visiting-card-contact-icon" />
                          <span>{person.email}</span>
                        </a>
                      )}
                      {person.phone && (
                        <span className="visiting-card-contact">
                          <img src="/assets/icons/mobile-data.png" alt="" className="visiting-card-contact-icon" />
                          <span>{person.phone}</span>
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      className="visiting-card-action"
                      onClick={() => setReminderPerson(person)}
                    >
                      Send reminder
                    </button>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}


        </ProjectGate>

      </div>
    </div>
  );
}

export default ExecutiveAssistantPage;
