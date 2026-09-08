import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './Team.css';
import { showToast } from '../core/toast';
import { authJsonHeaders, authOptionalHeaders } from '../core/authHeaders';
import { Modal, EmptyState, Button, Spinner } from '../components';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

const Icons = {
  ArrowLeft: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M19 12H5M12 19l-7-7 7-7"/>
    </svg>
  ),
  Plus: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  ),
  Mail: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
      <polyline points="22,6 12,13 2,6"/>
    </svg>
  ),
  Trash: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
    </svg>
  ),
  Crown: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"/>
    </svg>
  ),
  User: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  ),
  Clock: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  ),
  X: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  Check: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
};

const ROLES = {
  owner: { label: 'Owner', cssClass: 'role-owner' },
  admin: { label: 'Admin', cssClass: 'role-admin' },
  member: { label: 'Member', cssClass: 'role-member' },
  viewer: { label: 'Viewer', cssClass: 'role-viewer' },
};

function Team() {
  const navigate = useNavigate();
  const userEmail = localStorage.getItem('userEmail') || '';
  const userName = localStorage.getItem('firstName') || userEmail.split('@')[0];

  const [members, setMembers] = useState([]);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviting, setInviting] = useState(false);
  const [currentUserRole, setCurrentUserRole] = useState('owner');

  useEffect(() => {
    fetchTeam();
  }, []);

  const fetchTeam = async () => {
    try {
      const res = await fetch(`${API_URL}/api/team`, {
        headers: authOptionalHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members || []);
        setPendingInvites(data.pending_invites || []);
        const currentMember = data.members?.find(m => m.email === userEmail);
        if (currentMember) setCurrentUserRole(currentMember.role);
      }
    } catch (err) {
      console.error('Failed to fetch team:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;

    // Basic email validation
    if (!inviteEmail.includes('@')) {
      showToast('Enter a valid email', 'error');
      return;
    }

    setInviting(true);
    try {
      const res = await fetch(`${API_URL}/api/team/invite`, {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.emailSent) {
          showToast('Member added and invitation email sent', 'success');
        } else {
          showToast(
            `Member added, but the invite email could not be sent${data.emailError ? `: ${data.emailError}` : ''}`,
            'warning'
          );
        }
        setInviteEmail('');
        setShowInviteModal(false);
        fetchTeam();
      } else {
        const data = await res.json();
        showToast(data.error || 'Failed to invite', 'error');
      }
    } catch {
      showToast('Failed to send invite', 'error');
    } finally {
      setInviting(false);
    }
  };

  const handleRemoveMember = async (memberId, memberEmail) => {
    if (memberEmail === userEmail) {
      showToast("Can't remove yourself", 'error');
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/team/members/${memberId}`, {
        method: 'DELETE',
        headers: authOptionalHeaders(),
      });

      if (res.ok) {
        showToast('Member removed', 'success');
        fetchTeam();
      }
    } catch {
      showToast('Failed to remove member', 'error');
    }
  };

  const handleCancelInvite = async (inviteId) => {
    try {
      const res = await fetch(`${API_URL}/api/team/invites/${inviteId}`, {
        method: 'DELETE',
        headers: authOptionalHeaders(),
      });

      if (res.ok) {
        showToast('Invite cancelled', 'success');
        fetchTeam();
      }
    } catch {
      showToast('Failed to cancel invite', 'error');
    }
  };

  const handleRoleChange = async (memberId, newRole) => {
    try {
      const res = await fetch(`${API_URL}/api/team/members/${memberId}/role`, {
        method: 'PUT',
        headers: authJsonHeaders(),
        body: JSON.stringify({ role: newRole }),
      });

      if (res.ok) {
        showToast('Role updated', 'success');
        fetchTeam();
      }
    } catch {
      showToast('Failed to update role', 'error');
    }
  };

  const canManageTeam = currentUserRole === 'owner' || currentUserRole === 'admin';
  const canChangeRoles = currentUserRole === 'owner';

  const getInitials = (name, email) => {
    if (name && name !== email.split('@')[0]) {
      return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    }
    return email.slice(0, 2).toUpperCase();
  };

  const Icon = ({ name }) => {
    const I = Icons[name];
    return I ? <I /> : null;
  };

  return (
    <div className="team-page">
      <div className="team-container">
        <header className="team-header">
          <button className="back-btn" onClick={() => navigate(-1)} aria-label="Go back">
            <Icon name="ArrowLeft" />
          </button>
          <div className="header-content">
            <h1>Team</h1>
            <p className="text-muted">{members.length} member{members.length !== 1 ? 's' : ''}</p>
          </div>
          {canManageTeam && (
            <button className="btn-invite" onClick={() => setShowInviteModal(true)}>
              <Icon name="Plus" />
              Invite
            </button>
          )}
        </header>

        {loading ? (
          <div className="loading"><Spinner size="lg" /></div>
        ) : (
          <>
            {/* Members */}
            <section className="card">
              <h2>Members</h2>
              <div className="members-list">
                {members.length === 0 ? (
                  <EmptyState
                    icon={<Icon name="User" />}
                    title="No team members yet"
                    action={canManageTeam ? { label: 'Invite your first member', onClick: () => setShowInviteModal(true) } : undefined}
                  />
                ) : (
                  members.map(member => (
                    <div key={member.id} className="member-row">
                      <div className={`member-avatar role-avatar ${ROLES[member.role]?.cssClass || 'role-viewer'}`}>
                        {getInitials(member.name, member.email)}
                      </div>
                      <div className="member-info">
                        <span className="member-name">
                          {member.name || member.email.split('@')[0]}
                          {member.email === userEmail && <span className="you-badge">You</span>}
                        </span>
                        <span className="member-email">{member.email}</span>
                      </div>
                      <div className="member-actions">
                        {canChangeRoles && member.role !== 'owner' && member.email !== userEmail ? (
                          <select
                            value={member.role}
                            onChange={(e) => handleRoleChange(member.id, e.target.value)}
                            className="role-select"
                          >
                            <option value="admin">Admin</option>
                            <option value="member">Member</option>
                            <option value="viewer">Viewer</option>
                          </select>
                        ) : (
                          <span className={`role-badge ${ROLES[member.role]?.cssClass || 'role-viewer'}`}>
                            {member.role === 'owner' && <Icon name="Crown" />}
                            {ROLES[member.role]?.label}
                          </span>
                        )}
                        {canManageTeam && member.role !== 'owner' && member.email !== userEmail && (
                          <button
                            className="btn-icon danger"
                            onClick={() => handleRemoveMember(member.id, member.email)}
                            title="Remove member"
                          >
                            <Icon name="Trash" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* Pending Invites */}
            {pendingInvites.length > 0 && (
              <section className="card">
                <h2>Pending Invites</h2>
                <div className="members-list">
                  {pendingInvites.map(invite => (
                    <div key={invite.id} className="member-row pending">
                      <div className="member-avatar pending">
                        <Icon name="Clock" />
                      </div>
                      <div className="member-info">
                        <span className="member-email">{invite.email}</span>
                        <span className="invite-meta">
                          Invited as {ROLES[invite.role]?.label} · {new Date(invite.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="member-actions">
                        {canManageTeam && (
                          <button
                            className="btn-icon"
                            onClick={() => handleCancelInvite(invite.id)}
                            title="Cancel invite"
                          >
                            <Icon name="X" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      <Modal
        open={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        title="Invite team member"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowInviteModal(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleInvite} disabled={!inviteEmail.trim() || inviting}>
              {inviting ? 'Sending...' : 'Send invite'}
            </Button>
          </>
        }
      >
        <div className="field">
          <label>Email address</label>
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="colleague@company.com"
            autoFocus
          />
        </div>
        <div className="field">
          <label>Role</label>
          <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
            <option value="admin">Admin - Manage projects & members</option>
            <option value="member">Member - Create & edit projects</option>
            <option value="viewer">Viewer - View only</option>
          </select>
        </div>
      </Modal>
    </div>
  );
}

export default Team;
