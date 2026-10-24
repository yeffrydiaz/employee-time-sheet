import React, { useState, useEffect, useMemo } from 'react';
import {
  LayoutDashboard,
  Clock,
  CheckSquare,
  Users,
  Building2,
  FileBarChart,
  Settings,
  Bell,
  Search,
  LogOut,
  ArrowLeft,
  Menu,
  X,
} from 'lucide-react';
import { AppUser, Company } from '../types/timeclock';
import {
  evaluateForgotClockInNotifications,
  getCompanyById,
  getDepartments,
  getTimeRecords,
  getTodayISO,
  getUsers,
  signOutSession,
} from '../services/dataStore';
import {
  EvaluatedRecord,
  evaluateRecordsWithOvertime,
  formatDateDisplay,
  formatHours,
  formatTimeDisplay,
  getPayPeriodRange,
  isRecordPendingApproval,
  parseTimeToMinutes,
  summarizeEvaluatedRecords,
} from '../services/calculations';
import TimeRecordsViews from './admin/TimeRecordsViews';
import { DepartmentsView, UsersView } from './admin/UsersAndDeptsViews';
import {
  ApprovalsView,
  CompanySettingsView,
  NotificationsView,
  ReportsView,
} from './admin/ReportsAndSettingsViews';

export type AdminViewId =
  | 'Dashboard'
  | 'Time Records'
  | 'Approvals'
  | 'Users'
  | 'Departments'
  | 'Reports'
  | 'Company Settings'
  | 'Notifications';

interface AdminConsoleProps {
  user: AppUser;
  company: Company;
  onNavigate: (path: string) => void;
  onSignOut: () => void;
}

export default function AdminConsole({
  user: initialUser,
  company: initialCompany,
  onNavigate,
  onSignOut,
}: AdminConsoleProps) {
  const [activeView, setActiveView] = useState<AdminViewId>('Dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);

  const triggerRefresh = () => setRefreshTick(t => t + 1);

  const company = useMemo(
    () => getCompanyById(initialCompany.id) || initialCompany,
    [initialCompany, refreshTick]
  );

  const allUsers = useMemo(
    () => getUsers(company.id, { includeArchived: true }),
    [company.id, refreshTick]
  );

  const currentUser = useMemo(
    () => allUsers.find(u => u.id === initialUser.id) || initialUser,
    [allUsers, initialUser]
  );

  const activeUsers = useMemo(
    () => allUsers.filter(u => !u.archived && u.status === 'Active'),
    [allUsers]
  );

  const departments = useMemo(
    () => getDepartments(company.id),
    [company.id, refreshTick]
  );

  const records = useMemo(
    () => getTimeRecords(company.id),
    [company.id, refreshTick]
  );

  // Evaluate Forgot Clock In when Dashboard or Notifications is opened (Part D9)
  useEffect(() => {
    if (activeView === 'Dashboard' || activeView === 'Notifications') {
      evaluateForgotClockInNotifications(company.id);
    }
  }, [activeView, company.id]);

  const deptMap = useMemo(() => {
    const map: Record<string, string> = {};
    departments.forEach(d => {
      map[d.id] = d.name;
    });
    return map;
  }, [departments]);

  const usersById = useMemo(() => {
    const map: Record<string, AppUser> = {};
    allUsers.forEach(u => {
      map[u.id] = u;
    });
    return map;
  }, [allUsers]);

  // Pending approvals count (live badge)
  const pendingApprovalRecords = useMemo(() => {
    if (company.approvalMode === 'Off') return [];
    return records.filter(r => isRecordPendingApproval(r, company));
  }, [records, company]);

  const pendingCount = pendingApprovalRecords.length;

  // Sidebar items in exact Part D0 order, respecting permissions (Part E2)
  const navItems = useMemo(() => {
    const items: Array<{
      id: AdminViewId;
      label: string;
      icon: React.ComponentType<{ className?: string }>;
      badge?: number;
      visible: boolean;
    }> = [
      {
        id: 'Dashboard',
        label: 'Dashboard',
        icon: LayoutDashboard,
        visible: true,
      },
      {
        id: 'Time Records',
        label: 'Time Records',
        icon: Clock,
        visible: true,
      },
      {
        id: 'Approvals',
        label: 'Approvals',
        icon: CheckSquare,
        badge: pendingCount,
        visible:
          company.approvalMode !== 'Off' && Boolean(currentUser.permissions.allowApproveRecords),
      },
      {
        id: 'Users',
        label: 'Users',
        icon: Users,
        visible: Boolean(currentUser.permissions.accessUsers),
      },
      {
        id: 'Departments',
        label: 'Departments',
        icon: Building2,
        visible: true,
      },
      {
        id: 'Reports',
        label: 'Reports',
        icon: FileBarChart,
        visible: Boolean(currentUser.permissions.allowViewReports),
      },
      {
        id: 'Company Settings',
        label: 'Company Settings',
        icon: Settings,
        visible: Boolean(currentUser.permissions.accessCompanySettings),
      },
      {
        id: 'Notifications',
        label: 'Notifications',
        icon: Bell,
        visible: Boolean(currentUser.permissions.accessNotifications),
      },
    ];
    return items.filter(i => i.visible);
  }, [company.approvalMode, currentUser.permissions, pendingCount]);

  // Ensure activeView is permitted
  useEffect(() => {
    if (!navItems.some(i => i.id === activeView)) {
      setActiveView('Dashboard');
    }
  }, [navItems, activeView]);

  // ==========================================================================
  // DASHBOARD METRICS (Part D1)
  // ==========================================================================
  const todayISO = getTodayISO();
  const currentPeriod = useMemo(
    () => getPayPeriodRange(company, todayISO, 0),
    [company, todayISO]
  );

  const evaluatedMap = useMemo(
    () => evaluateRecordsWithOvertime(records, company, usersById),
    [records, company, usersById]
  );

  const dashboardStats = useMemo(() => {
    const todayWorkRecords = records.filter(
      r =>
        r.date === todayISO &&
        r.recordType === 'Work' &&
        r.requestStatus !== 'Pending' &&
        r.requestStatus !== 'Denied'
    );

    const openRecordsNow = records.filter(
      r =>
        r.recordType === 'Work' &&
        (r.workingNow || !r.timeOut) &&
        r.requestStatus !== 'Pending' &&
        r.requestStatus !== 'Denied'
    );

    const clockedInUserIds = new Set(openRecordsNow.map(r => r.userId));
    const clockedOutTodayUserIds = new Set(
      todayWorkRecords
        .filter(r => !r.workingNow && Boolean(r.timeOut) && !clockedInUserIds.has(r.userId))
        .map(r => r.userId)
    );

    const activeEmpList = activeUsers;
    const noEntryTodayCount = activeEmpList.filter(
      u => !records.some(r => r.userId === u.id && r.date === todayISO)
    ).length;

    // Current Pay Period records
    const periodRecs = records.filter(
      r =>
        r.requestStatus !== 'Pending' &&
        r.requestStatus !== 'Denied' &&
        r.date >= currentPeriod.startDate &&
        r.date <= currentPeriod.endDate
    );

    const periodEvals = periodRecs
      .map(r => evaluatedMap.get(r.id))
      .filter((x): x is EvaluatedRecord => Boolean(x));
    const periodSummary = summarizeEvaluatedRecords(periodEvals);

    const usersWithNoEntryInPeriod = activeEmpList.filter(
      u => !periodRecs.some(r => r.userId === u.id)
    );

    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();

    const whoIsInRows = openRecordsNow.map(rec => {
      const emp = usersById[rec.userId];
      const inMins = parseTimeToMinutes(rec.timeIn) ?? nowMins;
      let diffMins = nowMins - inMins;
      if (diffMins < 0) diffMins = 0;
      const hoursSoFar = diffMins / 60;
      return {
        record: rec,
        employeeName: emp?.fullName || 'Unknown',
        departmentName: deptMap[emp?.departmentId || ''] || 'Unassigned',
        clockedInAt: formatTimeDisplay(rec.timeIn, company.timeFormat),
        hoursSoFar: formatHours(hoursSoFar, company.timeTotalsFormat),
      };
    });

    return {
      clockedInNowCount: clockedInUserIds.size,
      clockedOutTodayCount: clockedOutTodayUserIds.size,
      noEntryTodayCount,
      periodPaidHours: periodSummary.paidHours,
      periodTotalRecords: periodRecs.length,
      usersWithNoEntryInPeriod,
      whoIsInRows,
    };
  }, [
    records,
    todayISO,
    activeUsers,
    currentPeriod,
    evaluatedMap,
    usersById,
    deptMap,
    company.timeFormat,
    company.timeTotalsFormat,
  ]);

  const handleGlobalSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (globalSearch.trim()) {
      setActiveView('Time Records');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Bar */}
      <header className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3 flex items-center justify-between gap-4 sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100"
            aria-label="Toggle Menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div>
            <div className="text-base font-bold text-slate-900 leading-tight whitespace-nowrap">
              {company.name}
            </div>
            <div className="text-[11px] font-medium text-slate-500">
              Time Sheet Manager • Admin Console
            </div>
          </div>
        </div>

        {/* Global Employee Search Box */}
        <form
          onSubmit={handleGlobalSearchSubmit}
          className="hidden md:flex items-center flex-1 max-w-xs mx-4"
        >
          <div className="relative w-full">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={globalSearch}
              onChange={e => setGlobalSearch(e.target.value)}
              placeholder="Search employee records..."
              className="w-full min-h-[36px] pl-8 pr-3 py-1 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
        </form>

        {/* Signed-in User + Exit to Timesheet + Sign Out */}
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-end">
          <div className="hidden sm:block text-right text-xs">
            <div className="font-bold text-slate-900">{currentUser.fullName}</div>
            <div className="text-slate-500">{currentUser.role}</div>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('/clock')}
            className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap"
          >
            Punch Clock
          </button>

          <button
            type="button"
            onClick={() => onNavigate('/')}
            className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors inline-flex items-center gap-1 whitespace-nowrap"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Exit to Timesheet</span>
          </button>

          <button
            type="button"
            onClick={() => {
              signOutSession();
              onSignOut();
            }}
            className="px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-lg transition-colors inline-flex items-center gap-1 whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      <div className="flex-1 flex relative">
        {/* Left Sidebar Navigation */}
        <aside
          className={`${
            mobileMenuOpen ? 'block fixed inset-y-0 left-0 z-40 pt-16 shadow-xl' : 'hidden'
          } md:block w-52 lg:w-60 bg-white border-r border-slate-200 shrink-0 p-3 space-y-1`}
        >
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveView(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`w-full px-3 py-2.5 rounded-lg text-xs font-bold flex items-center justify-between transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </span>
                {item.badge !== undefined && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-[11px] font-mono font-bold ${
                      isActive
                        ? 'bg-white text-slate-900'
                        : item.badge > 0
                        ? 'bg-amber-100 text-amber-900'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </aside>

        {/* Main Content Viewport */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-x-hidden">
          <div className="max-w-6xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
              <h1 className="text-xl font-bold text-slate-900">{activeView}</h1>
              <span className="text-xs text-slate-500 font-mono">
                Pay Period: {formatDateDisplay(currentPeriod.startDate, company.dateFormat)} –{' '}
                {formatDateDisplay(currentPeriod.endDate, company.dateFormat)}
              </span>
            </div>

            {/* ===============================================================
                VIEW 1: DASHBOARD (Part D1)
               =============================================================== */}
            {activeView === 'Dashboard' && (
              <div className="space-y-6">
                {/* Stat Cards for TODAY */}
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2.5">
                    Today ({formatDateDisplay(todayISO, company.dateFormat)})
                  </h2>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-white border border-slate-200 rounded-xl p-4">
                      <div className="text-xs font-medium text-slate-500">
                        Employees clocked in now
                      </div>
                      <div className="text-2xl font-bold font-mono tabular-nums text-emerald-700 mt-1">
                        {dashboardStats.clockedInNowCount}
                      </div>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-xl p-4">
                      <div className="text-xs font-medium text-slate-500">
                        Employees clocked out
                      </div>
                      <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                        {dashboardStats.clockedOutTodayCount}
                      </div>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-xl p-4">
                      <div className="text-xs font-medium text-slate-500">No entry yet</div>
                      <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                        {dashboardStats.noEntryTodayCount}
                      </div>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-xl p-4">
                      <div className="text-xs font-medium text-slate-500">Pending approvals</div>
                      <div className="text-2xl font-bold font-mono tabular-nums text-amber-700 mt-1">
                        {pendingCount}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Stat Cards for CURRENT PAY PERIOD */}
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2.5">
                    Current Pay Period ({formatDateDisplay(currentPeriod.startDate, company.dateFormat)}{' '}
                    – {formatDateDisplay(currentPeriod.endDate, company.dateFormat)})
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white border border-slate-200 rounded-xl p-4">
                      <div className="text-xs font-medium text-slate-500">Total paid hours</div>
                      <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                        {formatHours(dashboardStats.periodPaidHours, company.timeTotalsFormat)}
                      </div>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-xl p-4">
                      <div className="text-xs font-medium text-slate-500">Total records</div>
                      <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                        {dashboardStats.periodTotalRecords}
                      </div>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-xl p-4">
                      <div className="text-xs font-medium text-slate-500">
                        Employees with no entry in the period
                      </div>
                      <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                        {dashboardStats.usersWithNoEntryInPeriod.length}
                      </div>
                      {dashboardStats.usersWithNoEntryInPeriod.length > 0 && (
                        <div className="text-xs text-slate-500 mt-1.5">
                          Who has no entry:{' '}
                          <strong className="text-slate-700">
                            {dashboardStats.usersWithNoEntryInPeriod
                              .map(u => u.fullName)
                              .join(', ')}
                          </strong>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* "Who is in right now" live board (shown if permitted) */}
                {currentUser.permissions.allowSeeWhoIsIn && (
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 font-bold text-xs uppercase tracking-wider text-slate-700">
                      Who is in right now ({dashboardStats.whoIsInRows.length})
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-slate-200 text-xs text-left">
                        <thead className="bg-white text-slate-500 font-semibold">
                          <tr>
                            <th className="px-4 py-2.5">Employee</th>
                            <th className="px-4 py-2.5">Department</th>
                            <th className="px-4 py-2.5">Clocked in at</th>
                            <th className="px-4 py-2.5 text-right">Hours so far</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {dashboardStats.whoIsInRows.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                                No employees are currently clocked in.
                              </td>
                            </tr>
                          ) : (
                            dashboardStats.whoIsInRows.map(row => (
                              <tr key={row.record.id} className="hover:bg-slate-50">
                                <td className="px-4 py-2.5 font-bold text-slate-900">
                                  {row.employeeName}
                                </td>
                                <td className="px-4 py-2.5 text-slate-600">{row.departmentName}</td>
                                <td className="px-4 py-2.5 font-mono tabular-nums text-slate-800">
                                  {row.clockedInAt}
                                </td>
                                <td className="px-4 py-2.5 text-right font-mono tabular-nums font-bold text-emerald-700">
                                  {row.hoursSoFar}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Pending Approvals Preview List (up to 5) */}
                {company.approvalMode !== 'Off' &&
                  currentUser.permissions.allowApproveRecords && (
                    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                        <span className="font-bold text-xs uppercase tracking-wider text-slate-700">
                          Pending Approvals Preview ({pendingCount})
                        </span>
                        <button
                          type="button"
                          onClick={() => setActiveView('Approvals')}
                          className="text-xs font-bold text-indigo-600 hover:underline"
                        >
                          Go to Approvals →
                        </button>
                      </div>
                      <div className="divide-y divide-slate-200 text-xs">
                        {pendingApprovalRecords.slice(0, 5).map(rec => {
                          const emp = usersById[rec.userId];
                          const ev = evaluatedMap.get(rec.id);
                          return (
                            <div
                              key={rec.id}
                              className="px-4 py-3 flex items-center justify-between gap-2 hover:bg-slate-50"
                            >
                              <div>
                                <strong className="text-slate-900">
                                  {emp?.fullName || 'Employee'}
                                </strong>{' '}
                                ·{' '}
                                <span className="font-mono">
                                  {formatDateDisplay(rec.date, company.dateFormat)}
                                </span>{' '}
                                · <span>{rec.recordType}</span>
                              </div>
                              <div className="font-mono font-bold text-slate-900">
                                {formatHours(ev?.totalHours || 0, company.timeTotalsFormat)} hrs
                              </div>
                            </div>
                          );
                        })}
                        {pendingCount === 0 && (
                          <div className="px-4 py-6 text-center text-slate-400">
                            All time records are approved.
                          </div>
                        )}
                      </div>
                    </div>
                  )}
              </div>
            )}

            {/* ===============================================================
                VIEW 2: TIME RECORDS (List View & Day View)
               =============================================================== */}
            {activeView === 'Time Records' && (
              <TimeRecordsViews
                company={company}
                currentUser={currentUser}
                users={allUsers}
                activeUsers={activeUsers}
                departments={departments}
                records={records}
                initialSearchTerm={globalSearch}
                onRefresh={triggerRefresh}
              />
            )}

            {/* ===============================================================
                VIEW 3: APPROVALS
               =============================================================== */}
            {activeView === 'Approvals' && (
              <ApprovalsView
                company={company}
                users={allUsers}
                departments={departments}
                records={records}
                onRefresh={triggerRefresh}
              />
            )}

            {/* ===============================================================
                VIEW 4: USERS
               =============================================================== */}
            {activeView === 'Users' && (
              <UsersView
                company={company}
                currentUser={currentUser}
                allUsers={allUsers}
                departments={departments}
                initialSearch={globalSearch}
                onRefresh={triggerRefresh}
              />
            )}

            {/* ===============================================================
                VIEW 5: DEPARTMENTS
               =============================================================== */}
            {activeView === 'Departments' && (
              <DepartmentsView
                company={company}
                users={allUsers}
                departments={departments}
                onRefresh={triggerRefresh}
              />
            )}

            {/* ===============================================================
                VIEW 6: REPORTS
               =============================================================== */}
            {activeView === 'Reports' && (
              <ReportsView
                company={company}
                users={allUsers}
                departments={departments}
                records={records}
              />
            )}

            {/* ===============================================================
                VIEW 7: COMPANY SETTINGS
               =============================================================== */}
            {activeView === 'Company Settings' && (
              <CompanySettingsView
                company={company}
                currentUser={currentUser}
                onRefresh={triggerRefresh}
              />
            )}

            {/* ===============================================================
                VIEW 8: NOTIFICATIONS
               =============================================================== */}
            {activeView === 'Notifications' && (
              <NotificationsView company={company} onRefresh={triggerRefresh} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
