'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Loader2, Users, Eye, EyeOff, X, Trash2 } from 'lucide-react';
import Select from '../common/Select';
import type { StaffMember, StaffRole, ExperienceService } from '../../types/experience';

const ROLE_LABELS: Record<StaffRole, string> = {
  server: 'Server',
  host: 'Host',
  chef: 'Chef',
  bartender: 'Bartender',
  manager: 'Manager',
};

const ROLE_COLORS: Record<string, string> = {
  server: 'bg-blue-100 text-blue-700',
  host: 'bg-purple-100 text-purple-700',
  chef: 'bg-orange-100 text-orange-700',
  bartender: 'bg-teal-100 text-teal-700',
  manager: 'bg-indigo-100 text-indigo-700',
};

interface StaffManagementProps {
  restaurantId: string | null;
  service: ExperienceService;
}

export default function StaffManagement({ restaurantId, service }: StaffManagementProps) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formRole, setFormRole] = useState<StaffRole>('server');
  const [formPassword, setFormPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [creating, setCreating] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const showFeedback = (type: 'success' | 'error', message: string) => {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 4000);
  };

  const fetchStaff = useCallback(async () => {
    if (!restaurantId) return;
    setLoading(true);
    try {
      const data = await service.getStaff(restaurantId);
      setStaff(data.staff);
    } catch (err: any) {
      console.error('Failed to load staff:', err);
      showFeedback('error', 'Failed to load staff');
    } finally {
      setLoading(false);
    }
  }, [restaurantId, service]);

  useEffect(() => {
    fetchStaff();
  }, [fetchStaff]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restaurantId) return;

    setCreating(true);
    try {
      await service.createStaff(restaurantId, {
        name: formName,
        email: formEmail,
        role: formRole,
        temporary_password: formPassword,
      });
      showFeedback('success', `${formName} has been added as ${ROLE_LABELS[formRole]}`);
      setFormName('');
      setFormEmail('');
      setFormRole('server');
      setFormPassword('');
      setShowForm(false);
      await fetchStaff();
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to create staff member';
      showFeedback('error', msg);
    } finally {
      setCreating(false);
    }
  };

  const handleToggleActive = async (member: StaffMember) => {
    if (!restaurantId) return;
    setTogglingId(member.id);
    try {
      await service.updateStaff(restaurantId, member.id, {
        is_active: !member.is_active,
      });
      await fetchStaff();
      showFeedback('success', `${member.name} ${member.is_active ? 'deactivated' : 'activated'}`);
    } catch (err: any) {
      showFeedback('error', err?.response?.data?.error || err?.message || 'Failed to update staff');
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (member: StaffMember) => {
    if (!restaurantId || !service.deleteStaff) return;
    setDeletingId(member.id);
    try {
      await service.deleteStaff(restaurantId, member.id);
      setConfirmDeleteId(null);
      showFeedback('success', `${member.name} has been removed`);
      await fetchStaff();
    } catch (err: any) {
      showFeedback('error', err?.response?.data?.error || err?.message || 'Failed to remove staff member');
    } finally {
      setDeletingId(null);
    }
  };

  if (!restaurantId) {
    return (
      <div className="text-center py-20 text-gray-500">
        <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
        <p className="font-medium">No restaurant selected</p>
        <p className="text-sm mt-1">Select a restaurant from your dashboard first.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="page-title">Staff</h1>
          <p className="page-sub mt-1">Manage team members and their access</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-orange-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-orange-600 transition-colors flex items-center gap-2"
        >
          {showForm ? <X className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
          {showForm ? 'Cancel' : 'Add Staff'}
        </button>
      </div>

      {/* Feedback */}
      {feedback && (
        <div
          className={`mb-4 px-4 py-2.5 rounded-lg text-sm font-medium ${
            feedback.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}
        >
          {feedback.message}
        </div>
      )}

      {/* Add Staff Form */}
      {showForm && (
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <h3 className="text-title text-gray-900 mb-4">Add New Staff Member</h3>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-label text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Full name"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-label text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="staff@example.com"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-label text-gray-700 mb-1">Role</label>
                <Select
                  fullWidth
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value as StaffRole)}
                  options={(Object.entries(ROLE_LABELS) as [StaffRole, string][]).map(([value, label]) => ({ value, label }))}
                  data-testid="staff-role-select"
                />
              </div>
              <div>
                <label className="block text-label text-gray-700 mb-1">Temporary Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    placeholder="Min 8 characters"
                    minLength={8}
                    className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={creating}
                className="bg-orange-500 text-white px-6 py-2 rounded-lg font-medium hover:bg-orange-600 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {creating && <Loader2 className="h-4 w-4 animate-spin" />}
                {creating ? 'Creating...' : 'Create Staff Account'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Staff List */}
      {loading ? (
        <div className="text-center py-12">
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-orange-500 mb-3" />
          <p className="text-sm text-gray-500">Loading staff...</p>
        </div>
      ) : staff.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl shadow-sm">
          <Users className="h-12 w-12 mx-auto mb-3 text-gray-300" />
          <h3 className="text-title text-gray-900 mb-1">No staff members yet</h3>
          <p className="text-body text-gray-500 mb-4">Add your first team member to get started</p>
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="bg-orange-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-orange-600 transition-colors inline-flex items-center gap-2"
            >
              <Plus className="h-5 w-5" />
              Add Staff
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {staff.map((member) => (
            <div
              key={member.id}
              className={`bg-white rounded-xl shadow-sm p-4 flex items-center gap-4 border-2 transition-colors ${
                member.is_active ? 'border-transparent' : 'border-gray-200 opacity-60'
              }`}
            >
              <div className="bg-gradient-to-br from-orange-400 to-orange-600 w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
                {member.name.split(' ').map(n => n[0]).join('').toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="text-subtitle text-gray-900">{member.name}</h4>
                  <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${ROLE_COLORS[member.role] || 'bg-gray-100 text-gray-700'}`}>
                    {ROLE_LABELS[member.role as StaffRole] || member.role}
                  </span>
                  {!member.is_active && (
                    <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-red-100 text-red-700">
                      Inactive
                    </span>
                  )}
                </div>
                <p title={member.email} className="text-sm text-gray-500 truncate">{member.email}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => handleToggleActive(member)}
                  disabled={togglingId === member.id || deletingId === member.id}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 ${
                    member.is_active
                      ? 'text-red-700 bg-red-50 hover:bg-red-100'
                      : 'text-green-700 bg-green-50 hover:bg-green-100'
                  }`}
                >
                  {togglingId === member.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : member.is_active ? (
                    'Deactivate'
                  ) : (
                    'Activate'
                  )}
                </button>
                {service.deleteStaff && (
                  confirmDeleteId === member.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleDelete(member)}
                        disabled={deletingId === member.id}
                        className="px-2 py-1.5 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center gap-1"
                      >
                        {deletingId === member.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          'Confirm'
                        )}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        disabled={deletingId === member.id}
                        className="px-2 py-1.5 text-xs font-medium rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(member.id)}
                      disabled={togglingId === member.id || deletingId === member.id}
                      title="Remove staff member"
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
