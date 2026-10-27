'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Loader2, Users, Eye, EyeOff, X, Trash2 } from 'lucide-react';
import Select from '../common/Select';
import { useIsMobile } from '../../hooks/useIsMobile';
import type { StaffMember, StaffRole, ExperienceService } from '../../types/experience';
import type { ListKit, ListKitColumn } from '../common/listKit';

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
  /**
   * Optional DOM node to portal the Add Staff control into — supplied by
   * ExperienceManagement so the button sits on the tab row rather than in a
   * second header strip. When omitted (standalone `/owner/staff` page) the
   * component keeps its own header + inline button.
   */
  actionsSlot?: HTMLElement | null;
  /**
   * The host app's list + modal primitives (owner portal, desktop). Staff then
   * renders as rows in that app's house table; a row opens a modal with
   * Activate / Deactivate and Remove, and Add Staff opens its form in a modal.
   * Omitted → the card grid (waiter, admin, phones).
   */
  listKit?: ListKit;
}

export default function StaffManagement({ restaurantId, service, actionsSlot, listKit: hostKit }: StaffManagementProps) {
  const isMobile = useIsMobile();
  // Phones keep the cards whatever the host passes.
  const listKit = isMobile ? undefined : hostKit;
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
  const [openMemberId, setOpenMemberId] = useState<string | null>(null);

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
    const nextActive = !member.is_active;
    setTogglingId(member.id);
    // Optimistic: flip is_active in place so the toggle responds instantly on a
    // phone; roll back on failure. Previously this awaited the round-trip AND a
    // full-list refetch, which made a simple toggle feel broken on mobile.
    setStaff(prev => prev.map(s => (s.id === member.id ? { ...s, is_active: nextActive } : s)));
    try {
      await service.updateStaff(restaurantId, member.id, { is_active: nextActive });
      showFeedback('success', `${member.name} ${nextActive ? 'activated' : 'deactivated'}`);
    } catch (err: any) {
      setStaff(prev => prev.map(s => (s.id === member.id ? { ...s, is_active: member.is_active } : s)));
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
      setOpenMemberId(null);
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

  const staffForm = (
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
              className={`absolute top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 flex items-center justify-center ${isMobile ? 'right-1 min-h-[44px] min-w-[44px]' : 'right-3'}`}
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
          className={`bg-orange-500 text-white px-6 rounded-lg font-medium hover:bg-orange-600 transition-colors disabled:opacity-50 flex items-center gap-2 ${isMobile ? 'min-h-[44px]' : 'py-2'}`}
        >
          {creating && <Loader2 className="h-4 w-4 animate-spin" />}
          {creating ? 'Creating...' : 'Create Staff Account'}
        </button>
      </div>
    </form>
  );

  const inTabContext = actionsSlot !== undefined;
  const addStaffButton = (
    <button
      onClick={() => setShowForm(!showForm)}
      data-testid="add-staff-btn"
      className={`bg-orange-500 text-white px-4 rounded-lg font-medium hover:bg-orange-600 transition-colors flex items-center gap-2 ${isMobile ? 'min-h-[44px] w-full justify-center' : 'py-2'}`}
    >
      {/* With a list kit the form is a modal with its own close, so the
          button never flips to Cancel underneath it. */}
      {showForm && !listKit ? <X className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
      {showForm && !listKit ? 'Cancel' : 'Add Staff'}
    </button>
  );

  return (
    <div>
      {/* Desktop tab context: the tab row owns the title AND the Add Staff
          control, so no header strip renders here at all. */}
      {actionsSlot ? (
        createPortal(addStaffButton, actionsSlot)
      ) : (
        <div className={`mb-6 flex ${isMobile ? 'flex-col' : 'items-center justify-between'}`}>
          {/* Redundant page-title header hidden on mobile (parity with Menu/Food
              Items + the Tables tab) and inside the Tables & Staff tab surface.
              Shown on the standalone /owner/staff page only. */}
          {!isMobile && !inTabContext && (
            <div>
              <h1 className="page-title">Staff</h1>
              <p className="page-sub mt-1">Manage team members and their access</p>
            </div>
          )}
          {addStaffButton}
        </div>
      )}

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

      {listKit ? (
        <StaffListView
          kit={listKit}
          staff={staff}
          loading={loading}
          showForm={showForm}
          onCloseForm={() => setShowForm(false)}
          form={staffForm}
          openMemberId={openMemberId}
          onOpenMember={(id) => { setConfirmDeleteId(null); setOpenMemberId(id); }}
          onCloseMember={() => { setConfirmDeleteId(null); setOpenMemberId(null); }}
          onToggleActive={handleToggleActive}
          togglingId={togglingId}
          canDelete={!!service.deleteStaff}
          confirmDeleteId={confirmDeleteId}
          onAskDelete={setConfirmDeleteId}
          onDelete={handleDelete}
          deletingId={deletingId}
        />
      ) : (
        <>
        {/* Add Staff Form */}
        {showForm && (
          <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
            <h3 className="text-title text-gray-900 mb-4">Add New Staff Member</h3>
            {staffForm}
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
                    className={`text-xs font-medium rounded-lg transition-colors disabled:opacity-50 ${isMobile ? 'px-4 min-h-[44px]' : 'px-3 py-1.5'} ${
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
                          className={`px-3 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center gap-1 ${isMobile ? 'min-h-[44px]' : 'py-1.5'}`}
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
                          className={`px-3 text-xs font-medium rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors ${isMobile ? 'min-h-[44px]' : 'py-1.5'}`}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(member.id)}
                        disabled={togglingId === member.id || deletingId === member.id}
                        title="Remove staff member"
                        className={`text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 ${isMobile ? 'min-h-[44px] min-w-[44px] flex items-center justify-center' : 'p-1.5'}`}
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
        </>
      )}
    </div>
  );
}

function StaffListView({
  kit, staff, loading, showForm, onCloseForm, form, openMemberId, onOpenMember, onCloseMember,
  onToggleActive, togglingId, canDelete, confirmDeleteId, onAskDelete, onDelete, deletingId,
}: {
  kit: ListKit;
  staff: StaffMember[];
  loading: boolean;
  showForm: boolean;
  onCloseForm: () => void;
  form: React.ReactNode;
  openMemberId: string | null;
  onOpenMember: (id: string) => void;
  onCloseMember: () => void;
  onToggleActive: (m: StaffMember) => void;
  togglingId: string | null;
  canDelete: boolean;
  confirmDeleteId: string | null;
  onAskDelete: (id: string | null) => void;
  onDelete: (m: StaffMember) => void;
  deletingId: string | null;
}) {
  const { DataTable, Drawer, DrawerFooter, StatusPill } = kit;
  const roleLabel = (m: StaffMember) => ROLE_LABELS[m.role as StaffRole] || m.role;
  const columns: ListKitColumn<StaffMember>[] = [
    { key: 'name', header: 'Name', width: 'minmax(180px,1.2fr)', render: (m) => <span className="font-semibold overflow-hidden text-ellipsis">{m.name}</span> },
    { key: 'role', header: 'Role', width: '130px', render: (m) => <StatusPill tone="tag">{roleLabel(m)}</StatusPill> },
    { key: 'email', header: 'Email', width: 'minmax(200px,1.6fr)', render: (m) => <span className="text-ink-soft overflow-hidden text-ellipsis" title={m.email}>{m.email}</span> },
    {
      key: 'status',
      header: 'Status',
      width: '110px',
      render: (m) => (m.is_active
        ? <StatusPill tone="ok" dot testId={`staff-status-${m.id}`}>Active</StatusPill>
        : <StatusPill tone="tag" testId={`staff-status-${m.id}`}>Inactive</StatusPill>),
    },
  ];
  const member = staff.find(m => m.id === openMemberId) ?? null;
  const btn = 'inline-flex items-center justify-center gap-1.5 min-h-10 px-4 rounded-ctl text-sm font-semibold whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <>
      <DataTable
        columns={columns}
        rows={staff}
        rowKey={(m) => m.id}
        onRowClick={(m) => onOpenMember(m.id)}
        rowLabel={(m) => m.name}
        rowProps={(m) => ({ 'data-testid': `staff-row-${m.id}`, className: m.is_active ? undefined : 'opacity-60' })}
        minWidth={640}
        testId="staff-list"
        ariaLabel="Staff"
        empty={loading ? 'Loading staff…' : 'No staff members yet — add your first team member with Add Staff.'}
      />

      <Drawer open={showForm} onClose={onCloseForm} eyebrow="Staff" title="Add a team member" width={640} testId="add-staff-modal">
        <div className="pt-3">{form}</div>
      </Drawer>

      {member && (
        <Drawer
          open
          onClose={onCloseMember}
          eyebrow="Staff"
          title={member.name}
          titleAdornment={<StatusPill tone="tag">{roleLabel(member)}</StatusPill>}
          sub={member.email}
          width={560}
          testId="staff-modal"
          footer={
            <DrawerFooter
              dangerAction={canDelete && (confirmDeleteId === member.id ? (
                <span className="inline-flex items-center gap-2">
                  <button type="button" onClick={() => onDelete(member)} disabled={deletingId === member.id}
                    data-testid="staff-remove-confirm" className={`${btn} bg-bad text-white border border-bad`}>
                    {deletingId === member.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Remove'}
                  </button>
                  <button type="button" onClick={() => onAskDelete(null)} className="text-sm font-semibold text-ink-soft hover:underline">
                    Keep
                  </button>
                </span>
              ) : (
                <button type="button" onClick={() => onAskDelete(member.id)} data-testid="staff-remove"
                  className="text-sm font-semibold text-bad hover:underline">Remove from team</button>
              ))}
            >
              <button
                type="button"
                onClick={() => onToggleActive(member)}
                disabled={togglingId === member.id || deletingId === member.id}
                data-testid="staff-toggle-active"
                className={`${btn} bg-surface text-ink border border-ink hover:bg-surface2`}
              >
                {togglingId === member.id ? <Loader2 className="h-4 w-4 animate-spin" /> : member.is_active ? 'Deactivate' : 'Activate'}
              </button>
              <button type="button" onClick={onCloseMember} className={`${btn} bg-ink text-on-ink border border-ink hover:bg-ink-hover`}>
                Done
              </button>
            </DrawerFooter>
          }
        >
          <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 pt-3 text-sm">
            <dt className="font-semibold text-ink-label">Role</dt><dd>{roleLabel(member)}</dd>
            <dt className="font-semibold text-ink-label">Email</dt><dd className="break-all">{member.email}</dd>
            <dt className="font-semibold text-ink-label">Status</dt>
            <dd>{member.is_active ? 'Active — can sign in to the staff app' : 'Inactive — cannot sign in'}</dd>
          </dl>
          {confirmDeleteId === member.id && (
            <p className="mt-4 text-sm text-bad">Remove {member.name} from the team? Their staff sign-in stops working.</p>
          )}
        </Drawer>
      )}
    </>
  );
}
