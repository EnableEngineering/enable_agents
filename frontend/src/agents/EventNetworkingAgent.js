import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import Header from '../core/Header';
import { BackButton, ProjectSelector, LiveModeHint, AgentOutcomesStrip, ProjectGate } from '../components';
import '../styles/EventNetworkingAgent.css';
import { API_CONFIG } from '../config/apiConfig';
import { showToast } from '../core/toast';
import { useSelectedProjectId } from '../hooks/useSelectedProjectId';
import { authJsonHeaders } from '../core/authHeaders';

// Storage key for persisting state
const STATE_KEY = 'eventNetworkingState';

// Demo mock data - comprehensive sample to showcase features
const DEMO_EVENTS = [
  { id: 'demo-event-1', name: 'Tech Summit 2026', description: 'Annual technology conference featuring keynotes from industry leaders', date: '2026-08-15', location: 'San Francisco, CA', attendee_count: 156, status: 'upcoming' },
  { id: 'demo-event-2', name: 'AI & ML Meetup', description: 'Monthly AI practitioners gathering - deep learning focus', date: '2026-07-20', location: 'Austin, TX', attendee_count: 42, status: 'upcoming' },
  { id: 'demo-event-3', name: 'SaaS Growth Conference', description: 'B2B SaaS strategies and networking', date: '2026-06-10', location: 'New York, NY', attendee_count: 89, status: 'past' },
  { id: 'demo-event-4', name: 'Startup Pitch Night', description: 'Early-stage startups pitch to investors', date: '2026-07-25', location: 'Boston, MA', attendee_count: 34, status: 'upcoming' },
];

const DEMO_ATTENDEES = [
  { id: 'att-1', name: 'Sarah Chen', email: 'sarah@techflow.io', company: 'TechFlow', role: 'CTO', interests: ['AI', 'Cloud', 'DevOps'], linkedin: 'linkedin.com/in/sarahchen', notes: 'Met at the keynote session. Very interested in our AI automation platform. She mentioned they are looking for solutions in Q3.', lastContact: '2026-07-15', followUpDate: '2026-07-20', priority: 'high' },
  { id: 'att-2', name: 'Michael Roberts', email: 'michael@datawise.com', company: 'DataWise', role: 'VP Engineering', interests: ['Data', 'ML', 'Analytics'], linkedin: 'linkedin.com/in/mroberts', notes: 'Great conversation about data pipelines. He shared insights on their current ML stack. Wants a demo next month.', lastContact: '2026-07-14', followUpDate: '2026-07-18', priority: 'high' },
  { id: 'att-3', name: 'Emily Watson', email: 'emily@startupco.io', company: 'StartupCo', role: 'Founder & CEO', interests: ['Startups', 'Fundraising', 'Product'], linkedin: 'linkedin.com/in/emilyw', notes: 'Founder of a promising startup. Discussed potential partnership opportunities. She is raising Series A.', lastContact: '2026-07-14', followUpDate: '', priority: 'medium' },
  { id: 'att-4', name: 'David Kim', email: 'david@enterprise.com', company: 'Enterprise Corp', role: 'Director of IT', interests: ['Enterprise', 'Security', 'Cloud'], linkedin: 'linkedin.com/in/davidkim', notes: 'Enterprise buyer. Security is their top priority. Need to send case studies about our compliance features.', lastContact: '2026-07-13', followUpDate: '2026-07-16', priority: 'high' },
  { id: 'att-5', name: 'Jessica Martinez', email: 'jessica@aiventures.co', company: 'AI Ventures', role: 'Partner', interests: ['AI', 'Investment', 'Startups'], linkedin: 'linkedin.com/in/jessicam', notes: 'Investor at AI-focused VC firm. Interested in learning more about our growth metrics. Could be valuable for future funding.', lastContact: '2026-07-12', followUpDate: '', priority: 'medium' },
  { id: 'att-6', name: 'Alex Thompson', email: 'alex@cloudnative.dev', company: 'CloudNative', role: 'Principal Engineer', interests: ['Kubernetes', 'Cloud', 'Infrastructure'], linkedin: 'linkedin.com/in/alexthompson', notes: 'Deep technical background. Could be a great technical advisor or early adopter.', lastContact: '2026-07-15', followUpDate: '2026-07-22', priority: 'medium' },
  { id: 'att-7', name: 'Rachel Green', email: 'rachel@innovatevc.com', company: 'Innovate VC', role: 'Associate', interests: ['Investing', 'B2B', 'SaaS'], linkedin: 'linkedin.com/in/rachelgreen', notes: 'Junior associate but very engaged. Her firm focuses on Series A/B investments.', lastContact: '2026-07-14', followUpDate: '', priority: 'low' },
  { id: 'att-8', name: 'James Wilson', email: 'james@megacorp.com', company: 'MegaCorp', role: 'VP Product', interests: ['Product', 'Strategy', 'Enterprise'], linkedin: 'linkedin.com/in/jameswilson', notes: 'Leads product for their enterprise division. Potential large deal if we can meet their requirements.', lastContact: '2026-07-15', followUpDate: '2026-07-19', priority: 'high' },
];

function EventNetworkingAgent() {
  const selectedProjectId = useSelectedProjectId();
  const [searchParams, setSearchParams] = useSearchParams();

  // Load persisted state from sessionStorage
  const loadPersistedState = useCallback(() => {
    try {
      const saved = sessionStorage.getItem(STATE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  }, []);

  // Demo mode detection
  const [isDemoMode, setIsDemoMode] = useState(() => {
    return localStorage.getItem('enableAgentsMode') === 'demo';
  });

  // State with persistence from URL/sessionStorage
  const [activeTab, setActiveTab] = useState(() => {
    return searchParams.get('tab') || loadPersistedState().activeTab || 'events';
  });
  const [events, setEvents] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [pendingEventId, setPendingEventId] = useState(() => {
    return searchParams.get('event') || loadPersistedState().selectedEventId || null;
  });
  const [attendees, setAttendees] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  // Event creation
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [newEvent, setNewEvent] = useState({ name: '', description: '', date: '', location: '' });

  // Attendee upload
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [csvText, setCsvText] = useState('');

  // Recommendations
  const [userInterests, setUserInterests] = useState('');
  const [userGoals, setUserGoals] = useState('');

  // Follow-up
  const [selectedAttendees, setSelectedAttendees] = useState([]);
  const [followupSubject, setFollowupSubject] = useState('Great connecting at the event!');
  const [followupBody, setFollowupBody] = useState('');

  // Contact notes/diary
  const [selectedContact, setSelectedContact] = useState(null);
  const [showContactModal, setShowContactModal] = useState(false);
  const [editingNotes, setEditingNotes] = useState('');

  // Persist state to sessionStorage and URL
  useEffect(() => {
    const state = {
      activeTab,
      selectedEventId: selectedEvent?.id || null,
      selectedContactId: selectedContact?.id || null,
    };
    sessionStorage.setItem(STATE_KEY, JSON.stringify(state));

    // Update URL params
    const params = new URLSearchParams(searchParams);
    if (activeTab !== 'events') {
      params.set('tab', activeTab);
    } else {
      params.delete('tab');
    }
    if (selectedEvent?.id) {
      params.set('event', selectedEvent.id);
    } else {
      params.delete('event');
    }
    setSearchParams(params, { replace: true });
  }, [activeTab, selectedEvent, selectedContact, searchParams, setSearchParams]);

  // Restore selected event after events load
  useEffect(() => {
    if (pendingEventId && events.length > 0 && !selectedEvent) {
      const event = events.find(e => e.id === pendingEventId);
      if (event) {
        // Inline restore logic (can't call handleSelectEvent yet)
        setSelectedEvent(event);
        if (isDemoMode) {
          setAttendees(DEMO_ATTENDEES);
        }
        setPendingEventId(null);
      }
    }
  }, [pendingEventId, events, selectedEvent, isDemoMode]);

  // Listen for mode changes (storage event handles cross-tab changes)
  useEffect(() => {
    const handleModeChange = () => {
      const newMode = localStorage.getItem('enableAgentsMode') === 'demo';
      if (newMode !== isDemoMode) {
        setIsDemoMode(newMode);
        setEvents([]);
        setSelectedEvent(null);
        setAttendees([]);
        setRecommendations([]);
      }
    };
    window.addEventListener('storage', handleModeChange);
    return () => {
      window.removeEventListener('storage', handleModeChange);
    };
  }, [isDemoMode]);

  // Helper: get upcoming follow-ups
  const getUpcomingFollowUps = () => {
    const today = new Date().toISOString().split('T')[0];
    return attendees
      .filter(a => a.followUpDate && a.followUpDate >= today)
      .sort((a, b) => a.followUpDate.localeCompare(b.followUpDate))
      .slice(0, 5);
  };

  // Helper: get overdue follow-ups
  const getOverdueFollowUps = () => {
    const today = new Date().toISOString().split('T')[0];
    return attendees.filter(a => a.followUpDate && a.followUpDate < today);
  };

  // Helper: get initials
  const getInitials = (name) => {
    return name.split(' ').filter(Boolean).map(p => p[0]).join('').slice(0, 2).toUpperCase();
  };

  // Helper: get monogram variant
  const getMonogramVariant = (id) => {
    const variants = ['ember', 'ink', 'sage', 'slate'];
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
    return variants[Math.abs(hash) % variants.length];
  };

  // Load events when a project is selected
  useEffect(() => {
    if (!selectedProjectId) {
      setEvents([]);
      setSelectedEvent(null);
      setAttendees([]);
      setRecommendations([]);
      return;
    }
    fetchEvents();
  }, [isDemoMode, selectedProjectId]);

  const getCurrentUserId = () => {
    return localStorage.getItem('userEmail') || localStorage.getItem('username') || 'anonymous';
  };

  const fetchEvents = async () => {
    if (isDemoMode) {
      setEvents(DEMO_EVENTS);
      return;
    }

    try {
      setIsLoading(true);
      const response = await fetch(`${API_CONFIG.API_URL}/api/event-networking/events`, {
        headers: authJsonHeaders(),
      });
      const data = await response.json();
      if (data.success) {
        setEvents(data.events || []);
      }
    } catch (error) {
      console.error('Error fetching events:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateEvent = async () => {
    if (!newEvent.name.trim()) {
      showToast('Please enter an event name', 'warning');
      return;
    }

    if (isDemoMode) {
      const demoEvent = {
        id: `demo-${Date.now()}`,
        ...newEvent,
        attendee_count: 0,
        created_at: new Date().toISOString(),
      };
      setEvents([...events, demoEvent]);
      setSelectedEvent(demoEvent);
      setShowCreateEvent(false);
      setNewEvent({ name: '', description: '', date: '', location: '' });
      showToast('Event created (Demo Mode)', 'info');
      return;
    }

    try {
      setIsLoading(true);
      const response = await fetch(`${API_CONFIG.API_URL}/api/event-networking/events`, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify(newEvent),
      });
      const data = await response.json();
      if (data.success) {
        setEvents([...events, data.event]);
        setSelectedEvent(data.event);
        setShowCreateEvent(false);
        setNewEvent({ name: '', description: '', date: '', location: '' });
        showToast('Event created successfully', 'success');
      } else {
        showToast(data.error || 'Failed to create event', 'error');
      }
    } catch (error) {
      console.error('Error creating event:', error);
      showToast('Failed to create event', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectEvent = async (event) => {
    setSelectedEvent(event);
    setActiveTab('attendees');

    if (isDemoMode) {
      setAttendees(DEMO_ATTENDEES);
      return;
    }

    try {
      const response = await fetch(`${API_CONFIG.API_URL}/api/event-networking/events/${event.id}/attendees`, {
        headers: authJsonHeaders(),
      });
      const data = await response.json();
      if (data.success) {
        setAttendees(data.attendees || []);
      }
    } catch (error) {
      console.error('Error fetching attendees:', error);
    }
  };

  const handleUploadAttendees = async () => {
    if (!csvText.trim()) {
      showToast('Please enter attendee data', 'warning');
      return;
    }

    // Parse CSV - expected format: name,email,company,role,interests
    const lines = csvText.trim().split('\n');
    const attendeesToUpload = [];

    for (const line of lines) {
      const parts = line.split(',').map(p => p.trim());
      if (parts.length >= 2) {
        attendeesToUpload.push({
          name: parts[0] || '',
          email: parts[1] || '',
          company: parts[2] || '',
          role: parts[3] || '',
          interests: parts[4] ? parts[4].split(';').map(i => i.trim()) : [],
        });
      }
    }

    if (attendeesToUpload.length === 0) {
      showToast('No valid attendees found', 'warning');
      return;
    }

    if (isDemoMode) {
      const newAttendees = attendeesToUpload.map((a, idx) => ({
        ...a,
        id: `att-new-${idx}`,
      }));
      setAttendees([...attendees, ...newAttendees]);
      setShowUploadModal(false);
      setCsvText('');
      showToast(`${newAttendees.length} attendees added (Demo Mode)`, 'info');
      return;
    }

    try {
      setIsLoading(true);
      const response = await fetch(`${API_CONFIG.API_URL}/api/event-networking/events/${selectedEvent.id}/attendees`, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({ attendees: attendeesToUpload }),
      });
      const data = await response.json();
      if (data.success) {
        setAttendees(data.attendees || []);
        setShowUploadModal(false);
        setCsvText('');
        showToast(`${data.count} attendees uploaded`, 'success');
      } else {
        showToast(data.error || 'Failed to upload attendees', 'error');
      }
    } catch (error) {
      console.error('Error uploading attendees:', error);
      showToast('Failed to upload attendees', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGetRecommendations = async () => {
    if (!userInterests.trim() && !userGoals.trim()) {
      showToast('Please enter your interests or goals', 'warning');
      return;
    }

    const interests = userInterests.split(',').map(i => i.trim()).filter(Boolean);

    if (isDemoMode) {
      // Demo recommendations
      const demoRecs = DEMO_ATTENDEES.slice(0, 3).map((a, idx) => ({
        attendee: a,
        score: 85 - idx * 10,
        reasons: [`Shared interest in ${interests[0] || 'technology'}`, `Works at ${a.company}`],
      }));
      setRecommendations(demoRecs);
      showToast('Recommendations generated (Demo Mode)', 'info');
      return;
    }

    try {
      setIsLoading(true);
      const response = await fetch(`${API_CONFIG.API_URL}/api/event-networking/events/${selectedEvent.id}/recommendations`, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({ interests, goals: userGoals }),
      });
      const data = await response.json();
      if (data.success) {
        setRecommendations(data.recommendations || []);
        if (data.recommendations?.length === 0) {
          showToast('No matching recommendations found', 'info');
        }
      } else {
        showToast(data.error || 'Failed to get recommendations', 'error');
      }
    } catch (error) {
      console.error('Error getting recommendations:', error);
      showToast('Failed to get recommendations', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendFollowup = async () => {
    if (selectedAttendees.length === 0) {
      showToast('Please select attendees to follow up with', 'warning');
      return;
    }

    if (!followupBody.trim()) {
      showToast('Please enter a message', 'warning');
      return;
    }

    if (isDemoMode) {
      showToast(`Follow-up sent to ${selectedAttendees.length} attendees (Demo Mode)`, 'info');
      setSelectedAttendees([]);
      setFollowupBody('');
      return;
    }

    try {
      setIsLoading(true);
      const response = await fetch(`${API_CONFIG.API_URL}/api/event-networking/events/${selectedEvent.id}/followup`, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({
          recipient_ids: selectedAttendees,
          subject: followupSubject,
          body: followupBody,
          sender_email: getCurrentUserId(),
        }),
      });
      const data = await response.json();
      if (data.success) {
        showToast(data.message || 'Follow-up sent', 'success');
        setSelectedAttendees([]);
        setFollowupBody('');
      } else {
        showToast(data.error || 'Failed to send follow-up', 'error');
      }
    } catch (error) {
      console.error('Error sending follow-up:', error);
      showToast('Failed to send follow-up', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleAttendeeSelection = (attendeeId) => {
    if (selectedAttendees.includes(attendeeId)) {
      setSelectedAttendees(selectedAttendees.filter(id => id !== attendeeId));
    } else {
      setSelectedAttendees([...selectedAttendees, attendeeId]);
    }
  };

  // Open contact details modal
  const handleViewContact = (attendee) => {
    setSelectedContact(attendee);
    setEditingNotes(attendee.notes || '');
    setShowContactModal(true);
  };

  // Save contact notes
  const handleSaveNotes = async () => {
    if (!selectedContact) return;

    const updatedAttendee = {
      ...selectedContact,
      notes: editingNotes,
      lastContact: new Date().toISOString().split('T')[0],
    };

    if (isDemoMode) {
      setAttendees(attendees.map(a => a.id === selectedContact.id ? updatedAttendee : a));
      setSelectedContact(updatedAttendee);
      showToast('Notes saved (Demo Mode)', 'info');
      return;
    }

    try {
      setIsLoading(true);
      const response = await fetch(`${API_CONFIG.API_URL}/api/event-networking/attendees/${selectedContact.id}/notes`, {
        method: 'PUT',
        headers: authJsonHeaders(),
        body: JSON.stringify({ notes: editingNotes }),
      });
      const data = await response.json();
      if (data.success) {
        setAttendees(attendees.map(a => a.id === selectedContact.id ? { ...a, notes: editingNotes, lastContact: new Date().toISOString().split('T')[0] } : a));
        setSelectedContact({ ...selectedContact, notes: editingNotes });
        showToast('Notes saved', 'success');
      } else {
        showToast(data.error || 'Failed to save notes', 'error');
      }
    } catch (error) {
      console.error('Error saving notes:', error);
      showToast('Failed to save notes', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // Update follow-up date
  const handleUpdateFollowUp = async (date) => {
    if (!selectedContact) return;

    const updatedAttendee = { ...selectedContact, followUpDate: date };

    if (isDemoMode) {
      setAttendees(attendees.map(a => a.id === selectedContact.id ? updatedAttendee : a));
      setSelectedContact(updatedAttendee);
      showToast('Follow-up date set (Demo Mode)', 'info');
      return;
    }

    try {
      const response = await fetch(`${API_CONFIG.API_URL}/api/event-networking/attendees/${selectedContact.id}/followup-date`, {
        method: 'PUT',
        headers: authJsonHeaders(),
        body: JSON.stringify({ followUpDate: date }),
      });
      const data = await response.json();
      if (data.success) {
        setAttendees(attendees.map(a => a.id === selectedContact.id ? updatedAttendee : a));
        setSelectedContact(updatedAttendee);
        showToast('Follow-up date updated', 'success');
      } else {
        showToast(data.error || 'Failed to update follow-up date', 'error');
      }
    } catch (error) {
      console.error('Error updating follow-up date:', error);
      showToast('Failed to update follow-up date', 'error');
    }
  };

  // Render tabs
  const renderTabs = () => (
    <div className="event-tabs module-tabs">
      <button
        type="button"
        className={`module-tab ${activeTab === 'events' ? 'module-tab--active' : ''}`}
        onClick={() => setActiveTab('events')}
      >
        Events ({events.length})
      </button>
      <button
        type="button"
        className={`module-tab ${activeTab === 'attendees' ? 'module-tab--active' : ''}`}
        onClick={() => selectedEvent && setActiveTab('attendees')}
        disabled={!selectedEvent}
        title={!selectedEvent ? 'Select an event first' : undefined}
      >
        Contacts ({attendees.length})
      </button>
      <button
        type="button"
        className={`module-tab ${activeTab === 'recommendations' ? 'module-tab--active' : ''}`}
        onClick={() => selectedEvent && setActiveTab('recommendations')}
        disabled={!selectedEvent}
        title={!selectedEvent ? 'Select an event first' : undefined}
      >
        Match
      </button>
      <button
        type="button"
        className={`module-tab ${activeTab === 'followup' ? 'module-tab--active' : ''}`}
        onClick={() => selectedEvent && setActiveTab('followup')}
        disabled={!selectedEvent}
        title={!selectedEvent ? 'Select an event first' : undefined}
      >
        Follow-up {getOverdueFollowUps().length > 0 && <span className="tab-badge">{getOverdueFollowUps().length}</span>}
      </button>
    </div>
  );

  // Render content based on active tab
  const renderContent = () => {
    switch (activeTab) {
      case 'events':
        const upcomingEvents = events.filter(e => e.status === 'upcoming' || new Date(e.date) >= new Date());
        const pastEvents = events.filter(e => e.status === 'past' || new Date(e.date) < new Date());
        const totalContacts = events.reduce((sum, e) => sum + (e.attendee_count || 0), 0);

        return (
          <div className="events-view">
            {/* Stats Strip */}
            {events.length > 0 && (
              <div className="en-stats-strip">
                <div className="en-stat">
                  <span className="en-stat-value">{events.length}</span>
                  <span className="en-stat-label">Events</span>
                </div>
                <div className="en-stat">
                  <span className="en-stat-value">{upcomingEvents.length}</span>
                  <span className="en-stat-label">Upcoming</span>
                </div>
                <div className="en-stat">
                  <span className="en-stat-value">{totalContacts}</span>
                  <span className="en-stat-label">Total Contacts</span>
                </div>
                <div className="en-stat">
                  <span className="en-stat-value">{getOverdueFollowUps().length}</span>
                  <span className="en-stat-label">Overdue</span>
                </div>
              </div>
            )}

            <div className="section-header">
              <h2>Your Events</h2>
              <button
                className={showCreateEvent ? 'btn-secondary' : 'btn-primary'}
                onClick={() => setShowCreateEvent((open) => !open)}
              >
                {showCreateEvent ? 'Cancel' : '+ New Event'}
              </button>
            </div>

            {showCreateEvent && (
              <div className="inline-panel">
                <div className="inline-panel-header">
                  <h3>Create New Event</h3>
                  <button type="button" className="close-btn" onClick={() => setShowCreateEvent(false)} aria-label="Close">×</button>
                </div>
                <div className="inline-panel-body">
                  <div className="field">
                    <label>Event Name *</label>
                    <input
                      type="text"
                      value={newEvent.name}
                      onChange={e => setNewEvent({ ...newEvent, name: e.target.value })}
                      placeholder="e.g., Tech Summit 2026"
                    />
                  </div>
                  <div className="field">
                    <label>Description</label>
                    <textarea
                      value={newEvent.description}
                      onChange={e => setNewEvent({ ...newEvent, description: e.target.value })}
                      placeholder="Brief description of the event"
                      rows={2}
                    />
                  </div>
                  <div className="field-row">
                    <div className="field">
                      <label>Date</label>
                      <input
                        type="date"
                        value={newEvent.date}
                        onChange={e => setNewEvent({ ...newEvent, date: e.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label>Location</label>
                      <input
                        type="text"
                        value={newEvent.location}
                        onChange={e => setNewEvent({ ...newEvent, location: e.target.value })}
                        placeholder="e.g., San Francisco, CA"
                      />
                    </div>
                  </div>
                </div>
                <div className="inline-panel-footer">
                  <button type="button" className="btn-secondary" onClick={() => setShowCreateEvent(false)}>Cancel</button>
                  <button type="button" className="btn-primary" onClick={handleCreateEvent} disabled={isLoading}>
                    {isLoading ? 'Creating...' : 'Create Event'}
                  </button>
                </div>
              </div>
            )}

            {events.length === 0 && !showCreateEvent ? (
              <div className="empty-state">
                <p>No events yet. Create your first event to start networking!</p>
              </div>
            ) : events.length > 0 ? (
              <div className="events-list">
                {events.map(event => {
                  const isUpcoming = event.status === 'upcoming' || new Date(event.date) >= new Date();
                  return (
                    <div
                      key={event.id}
                      className={`event-card ${selectedEvent?.id === event.id ? 'selected' : ''} ${!isUpcoming ? 'past' : ''}`}
                      onClick={() => handleSelectEvent(event)}
                    >
                      <div className="event-card-header">
                        <div className="event-icon">
                          <img src="/assets/icons/networking.png" alt="" width={20} height={20} />
                        </div>
                        <span className={`event-status-badge ${isUpcoming ? 'upcoming' : 'past'}`}>
                          {isUpcoming ? 'Upcoming' : 'Past'}
                        </span>
                      </div>
                      <h3>{event.name}</h3>
                      <p className="event-description">{event.description}</p>
                      <div className="event-meta">
                        <span className="event-meta-item">
                          <img src="/assets/icons/checklist.png" alt="" width={14} height={14} />
                          {event.date}
                        </span>
                        {event.location && (
                          <span className="event-meta-item">
                            <img src="/assets/icons/travel.png" alt="" width={14} height={14} />
                            {event.location}
                          </span>
                        )}
                      </div>
                      <div className="event-footer">
                        <span className="attendee-count">{event.attendee_count || 0} contacts</span>
                        <span className="view-link">View details →</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        );

      case 'attendees':
        const highPriority = attendees.filter(a => a.priority === 'high');
        const upcomingFollowUps = getUpcomingFollowUps();
        const overdueFollowUps = getOverdueFollowUps();

        return (
          <div className="attendees-view">
            {/* Contact Stats */}
            {attendees.length > 0 && (
              <div className="en-stats-strip">
                <div className="en-stat">
                  <span className="en-stat-value">{attendees.length}</span>
                  <span className="en-stat-label">Contacts</span>
                </div>
                <div className="en-stat">
                  <span className="en-stat-value">{highPriority.length}</span>
                  <span className="en-stat-label">High Priority</span>
                </div>
                <div className="en-stat">
                  <span className="en-stat-value">{upcomingFollowUps.length}</span>
                  <span className="en-stat-label">Follow-ups Due</span>
                </div>
                <div className="en-stat en-stat--warning">
                  <span className="en-stat-value">{overdueFollowUps.length}</span>
                  <span className="en-stat-label">Overdue</span>
                </div>
              </div>
            )}

            <div className="section-header">
              <h2>Contacts - {selectedEvent?.name}</h2>
              <button
                className={showUploadModal ? 'btn-secondary' : 'btn-primary'}
                onClick={() => setShowUploadModal((open) => !open)}
              >
                {showUploadModal ? 'Cancel' : '+ Import Contacts'}
              </button>
            </div>

            {showUploadModal && (
              <div className="inline-panel">
                <div className="inline-panel-header">
                  <h3>Import Contacts</h3>
                  <button type="button" className="close-btn" onClick={() => setShowUploadModal(false)} aria-label="Close">×</button>
                </div>
                <div className="inline-panel-body">
                  <p className="help-text">
                    Enter contact data in CSV format: <code>name,email,company,role,interests</code>
                  </p>
                  <textarea
                    value={csvText}
                    onChange={e => setCsvText(e.target.value)}
                    placeholder="John Doe,john@company.com,TechCorp,CEO,AI;ML;Cloud
Jane Smith,jane@startup.io,StartupIO,CTO,Product;Engineering"
                    rows={6}
                    className="csv-input"
                  />
                </div>
                <div className="inline-panel-footer">
                  <button type="button" className="btn-secondary" onClick={() => setShowUploadModal(false)}>Cancel</button>
                  <button type="button" className="btn-primary" onClick={handleUploadAttendees} disabled={isLoading}>
                    {isLoading ? 'Importing...' : 'Import'}
                  </button>
                </div>
              </div>
            )}

            {showContactModal && selectedContact && (
              <div className="contact-detail-panel">
                <button type="button" className="panel-close" onClick={() => setShowContactModal(false)} aria-label="Close">×</button>

                <div className="contact-detail-layout">
                  {/* Left Column - Profile Info */}
                  <div className="contact-profile-col">
                    <div className="profile-card">
                      <div className={`profile-avatar contact-avatar--${getMonogramVariant(selectedContact.id)}`}>
                        {getInitials(selectedContact.name)}
                      </div>
                      <h3>{selectedContact.name}</h3>
                      <p className="profile-role">{selectedContact.role}</p>
                      <p className="profile-company">{selectedContact.company}</p>

                      {/* Quick Actions */}
                      <div className="profile-actions">
                        <a href={`mailto:${selectedContact.email}`} className="profile-action-btn" title="Send email">
                          <img src="/assets/icons/mail.png" alt="" width={18} height={18} />
                        </a>
                        {selectedContact.linkedin && (
                          <a href={`https://${selectedContact.linkedin}`} target="_blank" rel="noopener noreferrer" className="profile-action-btn" title="View LinkedIn">
                            <img src="/assets/icons/linkedin.png" alt="" width={18} height={18} />
                          </a>
                        )}
                        <button
                          type="button"
                          className="profile-action-btn"
                          title="Send follow-up"
                          onClick={() => {
                            toggleAttendeeSelection(selectedContact.id);
                            setActiveTab('followup');
                            setShowContactModal(false);
                          }}
                        >
                          <img src="/assets/icons/checklist.png" alt="" width={18} height={18} />
                        </button>
                      </div>
                    </div>

                    {/* Contact Details */}
                    <div className="profile-details">
                      <div className="detail-row">
                        <span className="detail-icon">✉</span>
                        <a href={`mailto:${selectedContact.email}`}>{selectedContact.email}</a>
                      </div>
                      {selectedContact.linkedin && (
                        <div className="detail-row">
                          <span className="detail-icon">in</span>
                          <a href={`https://${selectedContact.linkedin}`} target="_blank" rel="noopener noreferrer">LinkedIn Profile</a>
                        </div>
                      )}
                    </div>

                    {/* Interests */}
                    {selectedContact.interests?.length > 0 && (
                      <div className="profile-interests">
                        <h4>Interests</h4>
                        <div className="interest-tags">
                          {(Array.isArray(selectedContact.interests) ? selectedContact.interests : []).map((interest, i) => (
                            <span key={i} className="interest-chip">{interest}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Quick Stats */}
                    <div className="profile-stats">
                      <div className="stat-item">
                        <span className="stat-value">{selectedContact.lastContact || '—'}</span>
                        <span className="stat-label">Last Contact</span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">Follow-up</span>
                        <input
                          type="date"
                          className="stat-date-input"
                          value={selectedContact.followUpDate || ''}
                          onChange={e => handleUpdateFollowUp(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Right Column - Conversation Notes */}
                  <div className="contact-notes-col">
                    <div className="notes-header">
                      <h4>Conversation Notes</h4>
                      <span className="notes-hint">Track your interactions</span>
                    </div>

                    {/* Conversation Timeline */}
                    <div className="notes-timeline">
                      {/* Current notes */}
                      {selectedContact.notes && (
                        <div className="timeline-entry">
                          <div className="timeline-marker" />
                          <div className="timeline-content">
                            <div className="timeline-date">{selectedContact.lastContact || 'Recent'}</div>
                            <div className="timeline-text">{selectedContact.notes}</div>
                          </div>
                        </div>
                      )}

                      {/* Demo sample entries to show timeline concept */}
                      {isDemoMode && selectedContact.id?.startsWith('att-') && (
                        <>
                          <div className="timeline-entry">
                            <div className="timeline-marker" />
                            <div className="timeline-content">
                              <div className="timeline-date">2026-07-10</div>
                              <div className="timeline-text">• Initial connection at event
• Exchanged business cards
• Discussed mutual interest in AI</div>
                            </div>
                          </div>
                          <div className="timeline-entry">
                            <div className="timeline-marker" />
                            <div className="timeline-content">
                              <div className="timeline-date">2026-07-08</div>
                              <div className="timeline-text">• Pre-event research
• Identified as key contact for {selectedContact.company}</div>
                            </div>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Add New Note */}
                    <div className="add-note-section">
                      <div className="add-note-header">
                        <span className="add-note-date">{new Date().toLocaleDateString('en-CA')}</span>
                        <span className="add-note-label">Add note</span>
                      </div>
                      <textarea
                        value={editingNotes}
                        onChange={e => setEditingNotes(e.target.value)}
                        placeholder="What did you discuss? Any action items or follow-ups?"
                        rows={3}
                      />
                      <div className="note-templates">
                        <button type="button" onClick={() => setEditingNotes(editingNotes + '\n• Action item: ')}>+ Action</button>
                        <button type="button" onClick={() => setEditingNotes(editingNotes + '\n• Key insight: ')}>+ Insight</button>
                        <button type="button" onClick={() => setEditingNotes(editingNotes + '\n• Next step: ')}>+ Next step</button>
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="notes-footer">
                      <button type="button" className="btn-secondary" onClick={() => setShowContactModal(false)}>Cancel</button>
                      <button type="button" className="btn-primary" onClick={handleSaveNotes} disabled={isLoading}>
                        {isLoading ? 'Saving...' : 'Save Notes'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {attendees.length === 0 ? (
              <div className="empty-state">
                <p>No contacts yet. Import a CSV or add contacts manually.</p>
              </div>
            ) : (
              <div className="contacts-grid">
                {attendees.map(attendee => {
                  const isOverdue = attendee.followUpDate && new Date(attendee.followUpDate) < new Date();
                  const isSelected = selectedContact?.id === attendee.id && showContactModal;
                  return (
                    <div
                      key={attendee.id}
                      className={`contact-card ${attendee.priority === 'high' ? 'priority-high' : ''} ${isOverdue ? 'overdue' : ''} ${isSelected ? 'selected' : ''}`}
                      onClick={() => handleViewContact(attendee)}
                    >
                      <div className="contact-card-header">
                        <div className={`contact-avatar contact-avatar--${getMonogramVariant(attendee.id)}`}>
                          {getInitials(attendee.name)}
                        </div>
                        <div className="contact-card-identity">
                          <h4>{attendee.name}</h4>
                          <p>{attendee.role}</p>
                        </div>
                        {attendee.priority === 'high' && (
                          <span className="priority-badge">High</span>
                        )}
                      </div>
                      <div className="contact-card-company">{attendee.company}</div>
                      <div className="contact-card-interests">
                        {(Array.isArray(attendee.interests) ? attendee.interests.slice(0, 3) : []).map((interest, i) => (
                          <span key={i} className="interest-chip">{interest}</span>
                        ))}
                      </div>
                      {attendee.notes && (
                        <p className="contact-card-notes">
                          {attendee.notes.length > 80 ? attendee.notes.substring(0, 80) + '...' : attendee.notes}
                        </p>
                      )}
                      <div className="contact-card-footer">
                        {attendee.followUpDate && (
                          <span className={`followup-date ${isOverdue ? 'overdue' : ''}`}>
                            {isOverdue ? 'Overdue: ' : 'Follow-up: '}{attendee.followUpDate}
                          </span>
                        )}
                        <span className="view-link">View →</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );

      case 'recommendations':
        return (
          <div className="recommendations-view">
            <div className="section-header">
              <h2>Find Your Best Matches</h2>
            </div>

            {/* Match Finder */}
            <div className="match-finder">
              <div className="match-finder-header">
                <img src="/assets/icons/search-analysis.png" alt="" width={24} height={24} />
                <div>
                  <h3>AI-Powered Matching</h3>
                  <p>Tell us what you're looking for and we'll find the best connections</p>
                </div>
              </div>
              <div className="match-finder-form">
                <div className="match-input-group">
                  <label>I'm interested in</label>
                  <input
                    type="text"
                    value={userInterests}
                    onChange={e => setUserInterests(e.target.value)}
                    placeholder="AI, Machine Learning, Cloud Computing..."
                  />
                </div>
                <div className="match-input-group">
                  <label>I want to</label>
                  <input
                    type="text"
                    value={userGoals}
                    onChange={e => setUserGoals(e.target.value)}
                    placeholder="Find partners, Meet investors, Learn about..."
                  />
                </div>
                <button
                  className="btn-primary match-btn"
                  onClick={handleGetRecommendations}
                  disabled={isLoading || attendees.length === 0}
                >
                  {isLoading ? 'Analyzing...' : 'Find Matches'}
                </button>
              </div>
            </div>

            {/* Results */}
            {recommendations.length > 0 && (
              <div className="match-results">
                <h3 className="results-title">Top Matches for You</h3>
                <div className="match-cards">
                  {recommendations.map((rec, idx) => (
                    <div key={idx} className="match-card">
                      <div className="match-score-ring" style={{'--score': rec.score}}>
                        <span>{rec.score}%</span>
                      </div>
                      <div className="match-card-body">
                        <div className="match-card-header">
                          <div className={`contact-avatar contact-avatar--${getMonogramVariant(rec.attendee.id)}`}>
                            {getInitials(rec.attendee.name)}
                          </div>
                          <div>
                            <h4>{rec.attendee.name}</h4>
                            <p>{rec.attendee.role} at {rec.attendee.company}</p>
                          </div>
                        </div>
                        <div className="match-reasons">
                          {rec.reasons.map((reason, i) => (
                            <span key={i} className="match-reason">✓ {reason}</span>
                          ))}
                        </div>
                        <div className="match-card-actions">
                          <a href={`mailto:${rec.attendee.email}`} className="match-action-btn primary">
                            <img src="/assets/icons/mail.png" alt="" width={14} height={14} />
                            Connect
                          </a>
                          <button
                            type="button"
                            className="match-action-btn"
                            onClick={() => handleViewContact(rec.attendee)}
                          >
                            View Profile
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {recommendations.length === 0 && attendees.length > 0 && !isLoading && (
              <div className="match-empty">
                <p>Enter your interests above to find your best matches among {attendees.length} contacts.</p>
              </div>
            )}
          </div>
        );

      case 'followup':
        const overdueList = getOverdueFollowUps();
        const upcomingList = getUpcomingFollowUps();
        const selectedContactsList = attendees.filter(a => selectedAttendees.includes(a.id));

        return (
          <div className="followup-view">
            {/* Overdue Alert */}
            {overdueList.length > 0 && (
              <div className="followup-alert">
                <div className="alert-icon">⚠️</div>
                <div className="alert-content">
                  <strong>{overdueList.length} overdue follow-up{overdueList.length > 1 ? 's' : ''}</strong>
                  <p>
                    {overdueList.slice(0, 3).map(a => a.name).join(', ')}
                    {overdueList.length > 3 ? ` and ${overdueList.length - 3} more` : ''}
                  </p>
                </div>
                <button
                  className="btn-primary btn-sm"
                  onClick={() => {
                    setSelectedAttendees(overdueList.map(a => a.id));
                  }}
                >
                  Select All Overdue
                </button>
              </div>
            )}

            <div className="followup-layout">
              {/* Contact Picker */}
              <div className="followup-picker">
                <h3>Select Contacts</h3>
                <div className="picker-actions">
                  <button
                    type="button"
                    className={`picker-filter ${selectedAttendees.length === 0 ? '' : 'active'}`}
                    onClick={() => setSelectedAttendees([])}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    className="picker-filter"
                    onClick={() => setSelectedAttendees(attendees.map(a => a.id))}
                  >
                    All
                  </button>
                </div>
                <div className="contact-picker-list">
                  {attendees.map(attendee => {
                    const isSelected = selectedAttendees.includes(attendee.id);
                    const isOverdue = attendee.followUpDate && new Date(attendee.followUpDate) < new Date();
                    return (
                      <div
                        key={attendee.id}
                        className={`picker-item ${isSelected ? 'selected' : ''} ${isOverdue ? 'overdue' : ''}`}
                        onClick={() => toggleAttendeeSelection(attendee.id)}
                      >
                        <div className="picker-checkbox">
                          {isSelected && <span>✓</span>}
                        </div>
                        <div className={`picker-avatar contact-avatar--${getMonogramVariant(attendee.id)}`}>
                          {getInitials(attendee.name)}
                        </div>
                        <div className="picker-info">
                          <span className="picker-name">{attendee.name}</span>
                          <span className="picker-company">{attendee.company}</span>
                        </div>
                        {isOverdue && <span className="overdue-badge">Overdue</span>}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Compose Area */}
              <div className="followup-compose">
                <h3>Compose Message</h3>

                {/* Selected Recipients */}
                {selectedContactsList.length > 0 && (
                  <div className="compose-recipients">
                    <span className="recipients-label">To:</span>
                    <div className="recipients-list">
                      {selectedContactsList.slice(0, 5).map(c => (
                        <span key={c.id} className="recipient-chip">
                          {c.name}
                          <button type="button" onClick={() => toggleAttendeeSelection(c.id)}>×</button>
                        </span>
                      ))}
                      {selectedContactsList.length > 5 && (
                        <span className="recipient-more">+{selectedContactsList.length - 5} more</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Templates */}
                <div className="compose-templates">
                  <span className="templates-label">Quick templates:</span>
                  <div className="template-chips">
                    <button
                      type="button"
                      className="template-chip"
                      onClick={() => {
                        setFollowupSubject('Great connecting at the event!');
                        setFollowupBody('Hi [Name],\n\nIt was great meeting you at the event! I really enjoyed our conversation about [topic].\n\nI\'d love to continue the discussion. Would you be available for a quick call next week?\n\nBest regards');
                      }}
                    >
                      Post-Event
                    </button>
                    <button
                      type="button"
                      className="template-chip"
                      onClick={() => {
                        setFollowupSubject('Following up on our conversation');
                        setFollowupBody('Hi [Name],\n\nI wanted to follow up on our conversation from [event]. As discussed, I\'m sharing [resource/info].\n\nLet me know if you have any questions!\n\nBest regards');
                      }}
                    >
                      Resource Share
                    </button>
                    <button
                      type="button"
                      className="template-chip"
                      onClick={() => {
                        setFollowupSubject('Schedule a meeting?');
                        setFollowupBody('Hi [Name],\n\nI hope you\'re doing well! I\'ve been thinking about our discussion at [event] and would love to explore potential collaboration.\n\nWould you have time for a 30-minute call this week?\n\nBest regards');
                      }}
                    >
                      Meeting Request
                    </button>
                  </div>
                </div>

                <div className="compose-field">
                  <label>Subject</label>
                  <input
                    type="text"
                    value={followupSubject}
                    onChange={e => setFollowupSubject(e.target.value)}
                    placeholder="Email subject line"
                  />
                </div>

                <div className="compose-field">
                  <label>Message</label>
                  <textarea
                    value={followupBody}
                    onChange={e => setFollowupBody(e.target.value)}
                    placeholder="Write your message here... Use [Name] for personalization."
                    rows={8}
                  />
                </div>

                <button
                  className="btn-primary send-btn"
                  onClick={handleSendFollowup}
                  disabled={isLoading || selectedAttendees.length === 0 || !followupBody.trim()}
                >
                  {isLoading ? 'Sending...' : `Send to ${selectedAttendees.length} Contact${selectedAttendees.length !== 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="agent-page event-networking-agent">
      <Header />
      <div className="agent-page-header">
        <div className="agent-header-left">
          <BackButton />
          <div className="agent-header-content">
            <div className="agent-title-row">
              <h1>Event Networking</h1>
            </div>
            <p className="text-muted">
              {selectedEvent ? selectedEvent.name : 'Manage events, attendees, and follow-ups'}
            </p>
          </div>
        </div>
        <div className="agent-header-right">
          <ProjectSelector
            agentKey="eventNetworking"
            onProjectChange={(project) => {
              if (project) {
                console.log('Project selected:', project.name);
              }
            }}
          />
        </div>
      </div>

      <AgentOutcomesStrip
        items={[
          { iconSrc: '/assets/icons/networking.png', title: 'Event hub', description: 'Create events and import attendee lists.' },
          { iconSrc: '/assets/icons/search-analysis.png', title: 'Smart matching', description: 'AI recommendations based on your goals.' },
          { iconSrc: '/assets/icons/mail.png', title: 'Follow-ups', description: 'Send post-event emails to connections.' },
        ]}
      />

      <LiveModeHint
        requireProject
        message="Select a project, then create events in Live mode or switch to Demo for sample events."
      />

      <ProjectGate agentLabel="Event Networking data">
        <div className="event-networking-body">
          {renderTabs()}
          {renderContent()}
        </div>
      </ProjectGate>
    </div>
  );
}

export default EventNetworkingAgent;
