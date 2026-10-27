import React, { useState, useMemo } from 'react';
import {
  Plus,
  Copy,
  Edit2,
  Archive,
  ArchiveRestore,
  Trash2,
  Printer,
  Search,
  Upload,
  Users,
  X,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  AppUser,
  Company,
  Department,
  Role,
  UserAutoLunchMode,
  UserPermissions,
  UserStatus,
} from '../../types/timeclock';
import {
  assignUsersToDepartment,
  bulkUpdateUsers,
  deleteDepartment,
  deleteUser,
  getAdminPermissions,
  getDefaultPermissionsForRole,
  getLastCreatedOrEditedUser,
  getTodayISO,
  importDepartmentsFromRows,
  removeUserFromDepartment,
  saveDepartment,
  saveUser,
  setDepartmentManagers,
  setUsersArchived,
} from '../../services/dataStore';

const TIMEZONES = [
  'Company default',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'Europe/London',
  'UTC',
];

const PERMISSION_LABELS: Array<{ key: keyof UserPermissions; label: string }> = [
  { key: 'allowEditOwnTime', label: 'Allow edit own time' },
  { key: 'allowComments', label: 'Allow comments on records' },
  { key: 'allowApproveRecords', label: 'Allow approve time records (Manager use)' },
  { key: 'allowViewReports', label: 'Allow view reports' },
  { key: 'viewOwnPayRate', label: 'View own pay rate & gross pay calculation' },
  { key: 'allowAddEntryRequest', label: 'Allow add entry request' },
  { key: 'allowAddAbsenceRequest', label: 'Allow add absence request' },
  { key: 'allowSeeWhoIsIn', label: 'Allow see Who Is In (Dashboard board)' },
  { key: 'accessCompanySettings', label: 'Access Company Settings (Admin use)' },
  { key: 'accessUsers', label: 'Access Users (Admin use)' },
  { key: 'accessNotifications', label: 'Access Notifications settings' },
];

// ============================================================================
// PART D4: USERS VIEW
// ============================================================================

interface UsersViewProps {
  company: Company;
  currentUser: AppUser;
  allUsers: AppUser[];
  departments: Department[];
  initialSearch?: string;
  onRefresh: () => void;
}

export function UsersView({
  company,
  currentUser,
  allUsers,
  departments,
  initialSearch = '',
  onRefresh,
}: UsersViewProps) {
  const [showArchived, setShowArchived] = useState(false);
  const [searchTerm, setSearchTerm] = useState(initialSearch);
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Add / Edit User Modal state
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | undefined>(undefined);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [employeeNumber, setEmployeeNumber] = useState('');
  const [email, setEmail] = useState('');
  const [mobilePhone, setMobilePhone] = useState('');
  const [departmentId, setDepartmentId] = useState(departments[0]?.id || '');
  const [role, setRole] = useState<Role>('Employee');
  const [status, setStatus] = useState<UserStatus>('Active');
  const [hireDate, setHireDate] = useState(getTodayISO());
  const [employmentType, setEmploymentType] = useState<'Full Time' | 'Part Time'>('Full Time');
  const [rateType, setRateType] = useState<'Hourly' | 'Salary'>('Hourly');
  const [payRate, setPayRate] = useState('20.00');
  const [timezone, setTimezone] = useState('Company default');
  const [autoLunchMode, setAutoLunchMode] = useState<UserAutoLunchMode>('Use company setting');
  const [autoLunchMinutes, setAutoLunchMinutes] = useState('30');
  const [autoLunchAfterHours, setAutoLunchAfterHours] = useState('6');
  const [permissions, setPermissions] = useState<UserPermissions>(() =>
    getDefaultPermissionsForRole('Employee')
  );
  const [formError, setFormError] = useState('');

  // Bulk Edit Modal state
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkDeptId, setBulkDeptId] = useState('');
  const [bulkRole, setBulkRole] = useState<'' | Role>('');
  const [bulkStatus, setBulkStatus] = useState<'' | UserStatus>('');

  const deptMap = useMemo(() => {
    const map: Record<string, string> = {};
    departments.forEach(d => {
      map[d.id] = d.name;
    });
    return map;
  }, [departments]);

  const filteredUsers = useMemo(() => {
    return allUsers.filter(u => {
      if (!showArchived && u.archived) return false;
      if (deptFilter !== 'ALL' && u.departmentId !== deptFilter) return false;
      if (searchTerm.trim()) {
        const t = searchTerm.trim().toLowerCase();
        const matchName = u.fullName.toLowerCase().includes(t);
        const matchUser = u.username.toLowerCase().includes(t);
        const matchNo = (u.employeeNumber || '').toLowerCase().includes(t);
        if (!matchName && !matchUser && !matchNo) return false;
      }
      return true;
    });
  }, [allUsers, showArchived, deptFilter, searchTerm]);

  const openAddUser = () => {
    setEditingUserId(undefined);
    setFirstName('');
    setLastName('');
    setUsername('');
    setPassword('welcome123');
    setEmployeeNumber(`EMP-00${allUsers.length + 1}`);
    setEmail('');
    setMobilePhone('');
    setDepartmentId(departments[0]?.id || '');
    setRole('Employee');
    setStatus('Active');
    setHireDate(getTodayISO());
    setEmploymentType('Full Time');
    setRateType('Hourly');
    setPayRate('24.00');
    setTimezone('Company default');
    setAutoLunchMode('Use company setting');
    setAutoLunchMinutes('30');
    setAutoLunchAfterHours('6');
    setPermissions(getDefaultPermissionsForRole('Employee'));
    setFormError('');
    setShowUserModal(true);
  };

  const openCopyFromUser = (source: AppUser) => {
    setEditingUserId(undefined);
    setFirstName('');
    setLastName('');
    setUsername('');
    setPassword('welcome123');
    setEmployeeNumber(`EMP-00${allUsers.length + 1}`);
    setEmail('');
    setMobilePhone('');
    setDepartmentId(source.departmentId);
    setRole(source.role);
    setStatus(source.status);
    setHireDate(getTodayISO());
    setEmploymentType(source.employmentType);
    setRateType(source.rateType);
    setPayRate(String(source.payRate));
    setTimezone(source.timezone);
    setAutoLunchMode(source.autoLunchMode);
    setAutoLunchMinutes(String(source.autoLunchMinutes));
    setAutoLunchAfterHours(String(source.autoLunchAfterHours));
    setPermissions({ ...source.permissions });
    setFormError('');
    setShowUserModal(true);
  };

  const handleCopyLastUser = () => {
    const last = getLastCreatedOrEditedUser(company.id);
    if (last) {
      openCopyFromUser(last);
    } else {
      openAddUser();
    }
  };

  const openEditUser = (u: AppUser) => {
    setEditingUserId(u.id);
    setFirstName(u.firstName);
    setLastName(u.lastName);
    setUsername(u.username);
    setPassword('');
    setEmployeeNumber(u.employeeNumber);
    setEmail(u.email);
    setMobilePhone(u.mobilePhone);
    setDepartmentId(u.departmentId);
    setRole(u.role);
    setStatus(u.status);
    setHireDate(u.hireDate);
    setEmploymentType(u.employmentType);
    setRateType(u.rateType);
    setPayRate(String(u.payRate));
    setTimezone(u.timezone);
    setAutoLunchMode(u.autoLunchMode);
    setAutoLunchMinutes(String(u.autoLunchMinutes));
    setAutoLunchAfterHours(String(u.autoLunchAfterHours));
    setPermissions(u.role === 'Admin' ? getAdminPermissions() : { ...u.permissions });
    setFormError('');
    setShowUserModal(true);
  };

  const handleSaveUserForm = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const res = saveUser(
      company.id,
      {
        firstName,
        lastName,
        username,
        password: password || undefined,
        employeeNumber,
        email,
        mobilePhone,
        departmentId,
        role,
        status,
        hireDate,
        employmentType,
        rateType,
        payRate: parseFloat(payRate) || 0,
        timezone,
        autoLunchMode,
        autoLunchMinutes: parseFloat(autoLunchMinutes) || 30,
        autoLunchAfterHours: parseFloat(autoLunchAfterHours) || 6,
        permissions: role === 'Admin' ? getAdminPermissions() : permissions,
      },
      editingUserId
    );

    if (!res.ok) {
      setFormError(res.error);
      return;
    }

    setShowUserModal(false);
    onRefresh();
    setBanner({
      type: 'success',
      text: editingUserId
        ? `Updated user ${res.user.fullName}.`
        : `Created user ${res.user.fullName} (${res.user.username}).`,
    });
  };

  const handleBulkSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedUserIds.length === 0) return;
    bulkUpdateUsers(company.id, selectedUserIds, {
      departmentId: bulkDeptId || undefined,
      role: bulkRole || undefined,
      status: bulkStatus || undefined,
    });
    setShowBulkModal(false);
    setSelectedUserIds([]);
    onRefresh();
    setBanner({
      type: 'success',
      text: `Bulk updated ${selectedUserIds.length} user(s).`,
    });
  };

  const handleArchiveSelected = () => {
    if (selectedUserIds.length === 0) return;
    setUsersArchived(company.id, selectedUserIds, true);
    setSelectedUserIds([]);
    onRefresh();
    setBanner({
      type: 'success',
      text: `Archived ${selectedUserIds.length} user(s).`,
    });
  };

  const handleDeleteUserClick = (u: AppUser) => {
    const res = deleteUser(company.id, u.id);
    if (!res.ok) {
      setBanner({ type: 'error', text: res.error });
      return;
    }
    onRefresh();
    setBanner({ type: 'success', text: `Deleted user ${u.fullName}.` });
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openAddUser}
              className="px-3.5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add User</span>
            </button>
            <button
              type="button"
              onClick={handleCopyLastUser}
              className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Copy Last User</span>
            </button>
            <button
              type="button"
              disabled={selectedUserIds.length === 0}
              onClick={() => {
                setBulkDeptId('');
                setBulkRole('');
                setBulkStatus('');
                setShowBulkModal(true);
              }}
              className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-40 whitespace-nowrap"
            >
              Bulk Edit ({selectedUserIds.length})
            </button>
            <button
              type="button"
              disabled={selectedUserIds.length === 0}
              onClick={handleArchiveSelected}
              className="px-3 py-2 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 rounded-lg disabled:opacity-40 inline-flex items-center gap-1 whitespace-nowrap"
            >
              <Archive className="w-3.5 h-3.5" />
              <span>Archive Selected</span>
            </button>
            <label className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer whitespace-nowrap">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={e => setShowArchived(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-slate-300"
              />
              <span>Show Archived</span>
            </label>
          </div>

          <button
            type="button"
            onClick={() => window.print()}
            className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print list</span>
          </button>
        </div>

        {/* Search & Department filter */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-100">
          <div className="sm:col-span-2 relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search Name, Username, or Employee No..."
              className="w-full min-h-[38px] pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <select
              value={deptFilter}
              onChange={e => setDeptFilter(e.target.value)}
              className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="ALL">All Departments</option>
              {departments.map(d => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {banner && (
        <div
          role="alert"
          className={`p-3 rounded-lg border text-xs font-semibold flex items-center justify-between ${
            banner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          <span className="flex items-center gap-2">
            {banner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            {banner.text}
          </span>
          <button onClick={() => setBanner(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Users Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-xs text-left">
          <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider">
            <tr>
              <th className="px-3 py-3 w-10">
                <input
                  type="checkbox"
                  checked={
                    filteredUsers.length > 0 && selectedUserIds.length === filteredUsers.length
                  }
                  onChange={e => {
                    if (e.target.checked) {
                      setSelectedUserIds(filteredUsers.map(u => u.id));
                    } else {
                      setSelectedUserIds([]);
                    }
                  }}
                  className="w-4 h-4 rounded border-slate-300"
                />
              </th>
              <th className="px-3 py-3 w-12">#</th>
              <th className="px-3 py-3">Department</th>
              <th className="px-3 py-3">Full Name</th>
              <th className="px-3 py-3">Username</th>
              <th className="px-3 py-3">Employee No</th>
              <th className="px-3 py-3">Role</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {filteredUsers.map((u, idx) => (
              <tr key={u.id} className="hover:bg-slate-50">
                <td className="px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={selectedUserIds.includes(u.id)}
                    onChange={e => {
                      if (e.target.checked) {
                        setSelectedUserIds(prev => [...prev, u.id]);
                      } else {
                        setSelectedUserIds(prev => prev.filter(id => id !== u.id));
                      }
                    }}
                    className="w-4 h-4 rounded border-slate-300"
                  />
                </td>
                <td className="px-3 py-2.5 font-mono text-slate-500">{idx + 1}</td>
                <td className="px-3 py-2.5 text-slate-700">
                  {deptMap[u.departmentId] || 'Unassigned'}
                </td>
                <td className="px-3 py-2.5 font-bold text-slate-900">
                  {u.fullName}
                  {u.archived && (
                    <span className="ml-1.5 text-[11px] font-normal text-amber-700">
                      (Archived)
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 font-mono text-slate-700">{u.username}</td>
                <td className="px-3 py-2.5 font-mono text-slate-600">{u.employeeNumber || '—'}</td>
                <td className="px-3 py-2.5 text-slate-700">{u.role}</td>
                <td className="px-3 py-2.5">
                  <span
                    className={`font-semibold ${
                      u.archived
                        ? 'text-amber-700'
                        : u.status === 'Active'
                        ? 'text-emerald-700'
                        : 'text-slate-400'
                    }`}
                  >
                    {u.archived ? 'Archived' : u.status}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap">
                  <div className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openEditUser(u)}
                      title="Edit User"
                      className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openCopyFromUser(u)}
                      title="Copy User"
                      className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    {u.archived ? (
                      <button
                        type="button"
                        onClick={() => {
                          setUsersArchived(company.id, [u.id], false);
                          onRefresh();
                          setBanner({ type: 'success', text: `Unarchived ${u.fullName}.` });
                        }}
                        title="Unarchive User"
                        className="p-1.5 text-emerald-700 hover:bg-emerald-50 rounded"
                      >
                        <ArchiveRestore className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setUsersArchived(company.id, [u.id], true);
                          onRefresh();
                          setBanner({ type: 'success', text: `Archived ${u.fullName}.` });
                        }}
                        title="Archive User"
                        className="p-1.5 text-amber-700 hover:bg-amber-50 rounded"
                      >
                        <Archive className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {/* B1: Managers see the same console minus Users-delete */}
                    {currentUser.role === 'Admin' && (
                      <button
                        type="button"
                        onClick={() => handleDeleteUserClick(u)}
                        title="Delete User"
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add / Edit User Modal (D4 + Part E Permissions) */}
      {showUserModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowUserModal(false)}
        >
          <div
            className="bg-white rounded-xl max-w-2xl w-full p-6 border border-slate-200 shadow-xl space-y-5 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {editingUserId ? 'Edit User' : 'Add User'}
              </h3>
              <button onClick={() => setShowUserModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div
                role="alert"
                className="p-3 bg-red-50 border border-red-200 text-xs font-semibold text-red-700 rounded-lg"
              >
                {formError}
              </div>
            )}

            <form onSubmit={handleSaveUserForm} className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    First Name <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Last Name
                  </label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={e => setLastName(e.target.value)}
                    className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Username <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {editingUserId ? 'Change Password (blank = keep)' : 'Set Password'}
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder={editingUserId ? 'Leave blank to keep' : 'Set password'}
                    className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Employee Number
                  </label>
                  <input
                    type="text"
                    value={employeeNumber}
                    onChange={e => setEmployeeNumber(e.target.value)}
                    className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Mobile Phone
                  </label>
                  <input
                    type="text"
                    value={mobilePhone}
                    onChange={e => setMobilePhone(e.target.value)}
                    className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Department
                  </label>
                  <select
                    value={departmentId}
                    onChange={e => setDepartmentId(e.target.value)}
                    className="w-full min-h-[38px] px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">Unassigned</option>
                    {departments.map(d => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Role</label>
                  <select
                    value={role}
                    onChange={e => {
                      const nextRole = e.target.value as Role;
                      setRole(nextRole);
                      setPermissions(getDefaultPermissionsForRole(nextRole));
                    }}
                    className="w-full min-h-[38px] px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Employee">Employee</option>
                    <option value="Manager">Manager</option>
                    <option value="Admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Status</label>
                  <select
                    value={status}
                    onChange={e => setStatus(e.target.value as UserStatus)}
                    className="w-full min-h-[38px] px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Hire Date
                  </label>
                  <input
                    type="date"
                    value={hireDate}
                    onChange={e => setHireDate(e.target.value)}
                    className="w-full min-h-[38px] px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Full/Part Time
                  </label>
                  <select
                    value={employmentType}
                    onChange={e => setEmploymentType(e.target.value as 'Full Time' | 'Part Time')}
                    className="w-full min-h-[38px] px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Full Time">Full Time</option>
                    <option value="Part Time">Part Time</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Rate Type
                  </label>
                  <select
                    value={rateType}
                    onChange={e => setRateType(e.target.value as 'Hourly' | 'Salary')}
                    className="w-full min-h-[38px] px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Hourly">Hourly</option>
                    <option value="Salary">Salary</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Pay Rate ({company.currencySymbol})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={payRate}
                    onChange={e => setPayRate(e.target.value)}
                    className="w-full min-h-[38px] px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Timezone
                  </label>
                  <select
                    value={timezone}
                    onChange={e => setTimezone(e.target.value)}
                    className="w-full min-h-[38px] px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    {TIMEZONES.map(tz => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Auto Lunch Deduction
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={autoLunchMode}
                      onChange={e => setAutoLunchMode(e.target.value as UserAutoLunchMode)}
                      className="min-h-[38px] px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="Use company setting">Use company setting</option>
                      <option value="No">No</option>
                      <option value="Yes">Yes</option>
                    </select>
                    {autoLunchMode === 'Yes' && (
                      <div className="flex items-center gap-2 text-xs">
                        <input
                          type="number"
                          value={autoLunchMinutes}
                          onChange={e => setAutoLunchMinutes(e.target.value)}
                          className="w-16 min-h-[38px] px-2 py-1 border border-slate-300 rounded-lg"
                        />
                        <span>mins after</span>
                        <input
                          type="number"
                          step="0.5"
                          value={autoLunchAfterHours}
                          onChange={e => setAutoLunchAfterHours(e.target.value)}
                          className="w-16 min-h-[38px] px-2 py-1 border border-slate-300 rounded-lg"
                        />
                        <span>hrs</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Part E: Permissions Checkboxes */}
              <div className="pt-3 border-t border-slate-200">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    User Permissions
                  </h4>
                  {role === 'Admin' && (
                    <span className="text-[11px] text-slate-500">
                      Admins always have every permission enabled.
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-slate-50 p-3 rounded-lg border border-slate-200">
                  {PERMISSION_LABELS.map(item => {
                    const isChecked = role === 'Admin' ? true : Boolean(permissions[item.key]);
                    return (
                      <label
                        key={item.key}
                        className="flex items-center gap-2 text-xs text-slate-800 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          disabled={role === 'Admin'}
                          checked={isChecked}
                          onChange={e =>
                            setPermissions(prev => ({
                              ...prev,
                              [item.key]: e.target.checked,
                            }))
                          }
                          className="w-4 h-4 rounded border-slate-300 disabled:opacity-60"
                        />
                        <span>{item.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowUserModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
                >
                  Save User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Edit Modal */}
      {showBulkModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowBulkModal(false)}
        >
          <div
            className="bg-white rounded-xl max-w-md w-full p-6 border border-slate-200 shadow-xl space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-slate-900">
              Bulk Edit ({selectedUserIds.length} Selected Users)
            </h3>
            <form onSubmit={handleBulkSave} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Department (leave unchanged if blank)
                </label>
                <select
                  value={bulkDeptId}
                  onChange={e => setBulkDeptId(e.target.value)}
                  className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="">— No Change —</option>
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Role (leave unchanged if blank)
                </label>
                <select
                  value={bulkRole}
                  onChange={e => setBulkRole(e.target.value as '' | Role)}
                  className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="">— No Change —</option>
                  <option value="Employee">Employee</option>
                  <option value="Manager">Manager</option>
                  <option value="Admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Status (leave unchanged if blank)
                </label>
                <select
                  value={bulkStatus}
                  onChange={e => setBulkStatus(e.target.value as '' | UserStatus)}
                  className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="">— No Change —</option>
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowBulkModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold text-white bg-slate-900 rounded-lg"
                >
                  Apply Bulk Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// PART D5: DEPARTMENTS VIEW
// ============================================================================

interface DepartmentsViewProps {
  company: Company;
  users: AppUser[];
  departments: Department[];
  onRefresh: () => void;
}

export function DepartmentsView({
  company,
  users,
  departments,
  onRefresh,
}: DepartmentsViewProps) {
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showDeptModal, setShowDeptModal] = useState(false);
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [deptName, setDeptName] = useState('');
  const [deptCode, setDeptCode] = useState('');
  const [deptError, setDeptError] = useState('');

  // Department Detail modal (Assign Users & Assign Managers)
  const [managingDept, setManagingDept] = useState<Department | null>(null);
  const [selectedAssignUserIds, setSelectedAssignUserIds] = useState<string[]>([]);
  const [selectedManagerIds, setSelectedManagerIds] = useState<string[]>([]);

  const activeUsers = useMemo(() => users.filter(u => !u.archived), [users]);
  const managers = useMemo(
    () => activeUsers.filter(u => u.role === 'Manager'),
    [activeUsers]
  );

  const openAddDept = () => {
    setEditingDept(null);
    setDeptName('');
    setDeptCode('');
    setDeptError('');
    setShowDeptModal(true);
  };

  const openEditDept = (d: Department) => {
    setEditingDept(d);
    setDeptName(d.name);
    setDeptCode(d.code);
    setDeptError('');
    setShowDeptModal(true);
  };

  const handleSaveDept = (e: React.FormEvent) => {
    e.preventDefault();
    setDeptError('');
    const res = saveDepartment(
      company.id,
      { name: deptName, code: deptCode },
      editingDept?.id
    );
    if (!res.ok) {
      setDeptError(res.error);
      return;
    }
    setShowDeptModal(false);
    onRefresh();
    setBanner({
      type: 'success',
      text: editingDept
        ? `Updated department "${res.department.name}".`
        : `Created department "${res.department.name}".`,
    });
  };

  const handleDeleteDept = (d: Department) => {
    const res = deleteDepartment(company.id, d.id);
    if (!res.ok) {
      setBanner({ type: 'error', text: res.error });
      return;
    }
    onRefresh();
    setBanner({ type: 'success', text: `Deleted department "${d.name}".` });
  };

  const handleImportDeptsFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { raw: false });
      const mapped = rows.map(r => {
        const keys = Object.keys(r);
        const find = (k: string) => {
          const found = keys.find(x => x.trim().toLowerCase() === k);
          return found ? String(r[found] ?? '') : '';
        };
        return {
          name: find('name') || find('department') || find('department name'),
          code: find('code'),
        };
      });
      const res = importDepartmentsFromRows(company.id, mapped);
      onRefresh();
      setBanner({
        type: res.errors.length > 0 && res.imported === 0 ? 'error' : 'success',
        text: `Imported ${res.imported} department(s). ${res.errors.join(' ')}`,
      });
    } catch {
      setBanner({
        type: 'error',
        text: 'Could not read the uploaded department file. Please upload a valid CSV or Excel file with columns Name, Code.',
      });
    }
    e.target.value = '';
  };

  const openManageDept = (d: Department) => {
    setManagingDept(d);
    setSelectedAssignUserIds([]);
    setSelectedManagerIds([...d.managerIds]);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openAddDept}
            className="px-3.5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg inline-flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Department</span>
          </button>

          <label className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1.5 cursor-pointer">
            <Upload className="w-3.5 h-3.5" />
            <span>Import Excel/CSV</span>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleImportDeptsFile}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {banner && (
        <div
          role="alert"
          className={`p-3 rounded-lg border text-xs font-semibold flex items-center justify-between ${
            banner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          <span>{banner.text}</span>
          <button onClick={() => setBanner(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Departments Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-xs text-left">
          <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider">
            <tr>
              <th className="px-3 py-3 w-12">#</th>
              <th className="px-3 py-3">Department Name</th>
              <th className="px-3 py-3">Code</th>
              <th className="px-3 py-3"># of Users</th>
              <th className="px-3 py-3">Managers</th>
              <th className="px-3 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {departments.map((d, idx) => {
              const deptUsers = activeUsers.filter(u => u.departmentId === d.id);
              const deptManagers = activeUsers.filter(u => d.managerIds.includes(u.id));
              return (
                <tr key={d.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2.5 font-mono text-slate-500">{idx + 1}</td>
                  <td className="px-3 py-2.5 font-bold text-slate-900">{d.name}</td>
                  <td className="px-3 py-2.5 font-mono text-slate-600">{d.code || '—'}</td>
                  <td className="px-3 py-2.5 font-mono text-slate-800">{deptUsers.length}</td>
                  <td className="px-3 py-2.5 text-slate-700">
                    {deptManagers.length > 0
                      ? deptManagers.map(m => m.fullName).join(', ')
                      : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => openManageDept(d)}
                        className="px-2.5 py-1 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded inline-flex items-center gap-1"
                      >
                        <Users className="w-3.5 h-3.5" />
                        <span>Assign Users / Managers</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditDept(d)}
                        title="Edit Department"
                        className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteDept(d)}
                        title="Delete Department"
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Department Modal */}
      {showDeptModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowDeptModal(false)}
        >
          <div
            className="bg-white rounded-xl max-w-md w-full p-6 border border-slate-200 shadow-xl space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                {editingDept ? 'Edit Department' : 'Add Department'}
              </h3>
              <button onClick={() => setShowDeptModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            {deptError && (
              <div className="p-2.5 bg-red-50 border border-red-200 text-xs text-red-700 rounded-lg">
                {deptError}
              </div>
            )}
            <form onSubmit={handleSaveDept} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Department Name <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={deptName}
                  onChange={e => setDeptName(e.target.value)}
                  className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Code (optional)
                </label>
                <input
                  type="text"
                  value={deptCode}
                  onChange={e => setDeptCode(e.target.value)}
                  className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg font-mono"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowDeptModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold text-white bg-slate-900 rounded-lg"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Department Detail Modal: Assign Users & Assign Managers */}
      {managingDept && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setManagingDept(null)}
        >
          <div
            className="bg-white rounded-xl max-w-lg w-full p-6 border border-slate-200 shadow-xl space-y-5 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                Department Detail — {managingDept.name}
              </h3>
              <button onClick={() => setManagingDept(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Current Assigned Users */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">
                Assigned Users
              </h4>
              <div className="space-y-1.5">
                {activeUsers.filter(u => u.departmentId === managingDept.id).length === 0 ? (
                  <p className="text-xs text-slate-400">No users currently in this department.</p>
                ) : (
                  activeUsers
                    .filter(u => u.departmentId === managingDept.id)
                    .map(u => (
                      <div
                        key={u.id}
                        className="flex items-center justify-between text-xs px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg"
                      >
                        <span className="font-medium text-slate-800">
                          {u.fullName} ({u.role})
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            removeUserFromDepartment(company.id, managingDept.id, u.id);
                            onRefresh();
                          }}
                          className="text-red-600 hover:underline font-semibold"
                        >
                          Remove
                        </button>
                      </div>
                    ))
                )}
              </div>
            </div>

            {/* Assign Users from other departments / unassigned */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">
                Assign User (from other departments)
              </h4>
              <div className="max-h-32 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1 bg-slate-50">
                {activeUsers
                  .filter(u => u.departmentId !== managingDept.id)
                  .map(u => (
                    <label
                      key={u.id}
                      className="flex items-center gap-2 text-xs text-slate-800 px-2 py-1 rounded hover:bg-white cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedAssignUserIds.includes(u.id)}
                        onChange={e => {
                          if (e.target.checked) {
                            setSelectedAssignUserIds(prev => [...prev, u.id]);
                          } else {
                            setSelectedAssignUserIds(prev => prev.filter(id => id !== u.id));
                          }
                        }}
                        className="w-4 h-4 rounded border-slate-300"
                      />
                      <span>{u.fullName}</span>
                    </label>
                  ))}
              </div>
              <button
                type="button"
                disabled={selectedAssignUserIds.length === 0}
                onClick={() => {
                  assignUsersToDepartment(company.id, managingDept.id, selectedAssignUserIds);
                  setSelectedAssignUserIds([]);
                  onRefresh();
                }}
                className="mt-2 px-3 py-1.5 text-xs font-bold text-white bg-slate-900 rounded-lg disabled:opacity-40"
              >
                Assign Selected Users
              </button>
            </div>

            {/* Assign Managers */}
            <div className="pt-3 border-t border-slate-100">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">
                Assign Managers (Users with Manager Role)
              </h4>
              <div className="space-y-1 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                {managers.length === 0 ? (
                  <p className="text-xs text-slate-400">No users have the Manager role yet.</p>
                ) : (
                  managers.map(m => (
                    <label
                      key={m.id}
                      className="flex items-center gap-2 text-xs text-slate-800 cursor-pointer py-1"
                    >
                      <input
                        type="checkbox"
                        checked={selectedManagerIds.includes(m.id)}
                        onChange={e => {
                          const next = e.target.checked
                            ? [...selectedManagerIds, m.id]
                            : selectedManagerIds.filter(id => id !== m.id);
                          setSelectedManagerIds(next);
                          setDepartmentManagers(company.id, managingDept.id, next);
                          onRefresh();
                        }}
                        className="w-4 h-4 rounded border-slate-300"
                      />
                      <span className="font-medium">{m.fullName}</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setManagingDept(null)}
                className="px-4 py-2 text-xs font-bold text-white bg-slate-900 rounded-lg"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
