import React, { useState, useMemo } from 'react';
import {
  Check,
  CheckCircle2,
  Star,
  Download,
  FileSpreadsheet,
  FileText,
  Search,
  Lock,
  X,
  Printer,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { exportAdminReportVectorPDF } from '../../services/pdfExport';
import {
  ApprovalMode,
  AppUser,
  AutoLunchMode,
  Company,
  DateFormatType,
  Department,
  NotificationEventType,
  NotificationSettings,
  PayPeriodType,
  RoundingDirection,
  RoundingMinutes,
  TimeFormatType,
  TimeRecord,
  TimeTotalsFormat,
} from '../../types/timeclock';
import {
  getFavoriteReports,
  getNotificationLogs,
  getNotificationSettings,
  getTodayISO,
  resolveEmployeeRequest,
  saveNotificationSettings,
  setRecordsApproval,
  toggleFavoriteReport,
  updateCompanySettings,
} from '../../services/dataStore';
import {
  EvaluatedRecord,
  evaluateRecordsWithOvertime,
  formatDateDisplay,
  formatHours,
  formatTimeDisplay,
  getPayPeriodRange,
  isRecordFullyApproved,
  listDatesInRange,
  summarizeEvaluatedRecords,
} from '../../services/calculations';
import {
  HolidayCountryCode,
  SUPPORTED_HOLIDAY_COUNTRIES,
} from '../../services/holidays';

// ============================================================================
// PART D7: APPROVALS VIEW
// ============================================================================

interface ApprovalsViewProps {
  company: Company;
  currentUser: AppUser;
  users: AppUser[];
  departments: Department[];
  records: TimeRecord[];
  onRefresh: () => void;
}

export function ApprovalsView({
  company,
  currentUser,
  users,
  departments,
  records,
  onRefresh,
}: ApprovalsViewProps) {
  const todayISO = getTodayISO();
  const currentPeriod = useMemo(
    () => getPayPeriodRange(company, todayISO, 0),
    [company, todayISO]
  );

  const [deptFilter, setDeptFilter] = useState('ALL');
  const [fromDate, setFromDate] = useState(currentPeriod.startDate);
  const [toDate, setToDate] = useState(currentPeriod.endDate);
  const [searchName, setSearchName] = useState('');
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([]);
  const [statusBanner, setStatusBanner] = useState('');

  const usersById = useMemo(() => {
    const map: Record<string, AppUser> = {};
    users.forEach(u => {
      map[u.id] = u;
    });
    return map;
  }, [users]);

  const evaluatedMap = useMemo(
    () => evaluateRecordsWithOvertime(records, company, usersById),
    [records, company, usersById]
  );

  // Pending Employee Entry/Absence Requests (Part G3)
  const pendingRequests = useMemo(() => {
    return records.filter(r => r.requestStatus === 'Pending');
  }, [records]);

  // Filtered records for approval table
  const filteredRecords = useMemo(() => {
    return records
      .filter(r => r.requestStatus !== 'Pending' && r.requestStatus !== 'Denied')
      .filter(r => {
        if (fromDate && r.date < fromDate) return false;
        if (toDate && r.date > toDate) return false;
        const u = usersById[r.userId];
        if (deptFilter !== 'ALL' && u?.departmentId !== deptFilter) return false;
        if (searchName.trim()) {
          const t = searchName.trim().toLowerCase();
          if (
            !u?.fullName.toLowerCase().includes(t) &&
            !u?.username.toLowerCase().includes(t)
          ) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [records, fromDate, toDate, deptFilter, searchName, usersById]);

  const groupedByEmployee = useMemo(() => {
    const map = new Map<string, TimeRecord[]>();
    for (const r of filteredRecords) {
      const list = map.get(r.userId) || [];
      list.push(r);
      map.set(r.userId, list);
    }
    return Array.from(map.entries());
  }, [filteredRecords]);

  const showEmployeeColumn = company.approvalMode === 'Employee and Manager';

  // F1 Permissions mirroring Approve:
  // Manager approval/unapproval is available only to Admin and Managers with allowApproveRecords
  const canApproveAsManager =
    currentUser.role === 'Admin' ||
    (currentUser.role === 'Manager' && Boolean(currentUser.permissions.allowApproveRecords));

  // Employee approval/unapproval is available to the employee who owns the record (for their own records) and to Admins acting on a record.
  const canActAsEmployeeOnRecord = (rec: TimeRecord) =>
    currentUser.role === 'Admin' || rec.userId === currentUser.id;

  const canActAsEmployeeOnSelection =
    selectedRecordIds.length > 0 &&
    (currentUser.role === 'Admin' ||
      selectedRecordIds.every(id => {
        const rec = records.find(r => r.id === id);
        return Boolean(rec && rec.userId === currentUser.id);
      }));

  const handleBulkApproveManager = () => {
    if (selectedRecordIds.length === 0 || !canApproveAsManager) return;
    setRecordsApproval(company.id, selectedRecordIds, { approvedByManager: true });
    setSelectedRecordIds([]);
    onRefresh();
    setStatusBanner(`Approved ${selectedRecordIds.length} record(s) as Manager.`);
  };

  const handleBulkApproveEmployee = () => {
    if (selectedRecordIds.length === 0 || !canActAsEmployeeOnSelection) return;
    setRecordsApproval(company.id, selectedRecordIds, { approvedByEmployee: true });
    setSelectedRecordIds([]);
    onRefresh();
    setStatusBanner(`Approved ${selectedRecordIds.length} record(s) as Employee.`);
  };

  const handleBulkUnapproveManager = () => {
    if (selectedRecordIds.length === 0 || !canApproveAsManager) return;
    setRecordsApproval(company.id, selectedRecordIds, { approvedByManager: false });
    setSelectedRecordIds([]);
    onRefresh();
    setStatusBanner(`Unapproved ${selectedRecordIds.length} record(s) as Manager.`);
  };

  const handleBulkUnapproveEmployee = () => {
    if (selectedRecordIds.length === 0 || !canActAsEmployeeOnSelection) return;
    setRecordsApproval(company.id, selectedRecordIds, { approvedByEmployee: false });
    setSelectedRecordIds([]);
    onRefresh();
    setStatusBanner(`Unapproved ${selectedRecordIds.length} record(s) as Employee.`);
  };

  return (
    <div className="space-y-5">
      {/* Filters & Bulk Approval Actions */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
              Department
            </label>
            <select
              value={deptFilter}
              onChange={e => setDeptFilter(e.target.value)}
              className="w-full min-h-[38px] px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="ALL">All Departments</option>
              {departments.map(d => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
              From Date
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              className="w-full min-h-[38px] px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
              To Date
            </label>
            <input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              className="w-full min-h-[38px] px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
              Search by Name
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchName}
                onChange={e => setSearchName(e.target.value)}
                placeholder="Employee name..."
                className="w-full min-h-[38px] pl-8 pr-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-2">
            {canApproveAsManager && (
              <button
                type="button"
                disabled={selectedRecordIds.length === 0}
                onClick={handleBulkApproveManager}
                className="px-3.5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-40 whitespace-nowrap"
              >
                Approve ({selectedRecordIds.length})
              </button>
            )}
            {showEmployeeColumn && (currentUser.role === 'Admin' || canActAsEmployeeOnSelection || selectedRecordIds.length === 0) && (
              <button
                type="button"
                disabled={!canActAsEmployeeOnSelection}
                onClick={handleBulkApproveEmployee}
                className="px-3.5 py-2 text-xs font-semibold text-emerald-800 bg-emerald-100 hover:bg-emerald-200 rounded-lg disabled:opacity-40 whitespace-nowrap"
              >
                Approve as Employee ({selectedRecordIds.length})
              </button>
            )}
            {canApproveAsManager && (
              <button
                type="button"
                disabled={selectedRecordIds.length === 0}
                onClick={handleBulkUnapproveManager}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-40 whitespace-nowrap"
              >
                Unapprove as Manager ({selectedRecordIds.length})
              </button>
            )}
            {showEmployeeColumn && (currentUser.role === 'Admin' || canActAsEmployeeOnSelection || selectedRecordIds.length === 0) && (
              <button
                type="button"
                disabled={!canActAsEmployeeOnSelection}
                onClick={handleBulkUnapproveEmployee}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-40 whitespace-nowrap"
              >
                Unapprove as Employee ({selectedRecordIds.length})
              </button>
            )}
          </div>
          <span className="text-xs text-slate-500">
            Approval Mode: <strong>{company.approvalMode}</strong>
          </span>
        </div>
      </div>

      {statusBanner && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800 rounded-lg flex items-center justify-between">
          <span>{statusBanner}</span>
          <button onClick={() => setStatusBanner('')}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Pending Employee Requests (from My Hours) */}
      {pendingRequests.length > 0 && (
        <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-4 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-amber-900">
            Pending Employee Entry / Absence Requests ({pendingRequests.length})
          </h3>
          <div className="space-y-2">
            {pendingRequests.map(req => {
              const u = usersById[req.userId];
              return (
                <div
                  key={req.id}
                  className="bg-white border border-amber-200 rounded-lg p-3 flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <div>
                    <strong className="text-slate-900">{u?.fullName || 'Employee'}</strong> ·{' '}
                    <span className="font-mono">{req.date}</span> ·{' '}
                    <span>
                      {req.recordType === 'Work'
                        ? `Work Entry: ${formatTimeDisplay(req.timeIn, company.timeFormat)} – ${formatTimeDisplay(req.timeOut, company.timeFormat)}`
                        : `Absence Request: ${req.absenceType} (${req.absenceHours} hrs)`}
                    </span>
                    {req.comment && <span className="text-slate-500"> — &ldquo;{req.comment}&rdquo;</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        resolveEmployeeRequest(company.id, req.id, 'Approve');
                        onRefresh();
                        setStatusBanner('Employee request approved and converted to a real record.');
                      }}
                      className="px-3 py-1.5 font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg"
                    >
                      Approve Request
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        resolveEmployeeRequest(company.id, req.id, 'Deny');
                        onRefresh();
                        setStatusBanner('Employee request denied and employee notified.');
                      }}
                      className="px-3 py-1.5 font-semibold text-red-700 bg-red-50 hover:bg-red-100 rounded-lg"
                    >
                      Deny Request
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Approvals Table Grouped by Employee */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-xs text-left">
          <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider">
            <tr>
              <th className="px-3 py-3 w-10">
                <input
                  type="checkbox"
                  checked={
                    filteredRecords.length > 0 &&
                    selectedRecordIds.length === filteredRecords.length
                  }
                  onChange={e => {
                    if (e.target.checked) {
                      setSelectedRecordIds(filteredRecords.map(r => r.id));
                    } else {
                      setSelectedRecordIds([]);
                    }
                  }}
                  className="w-4 h-4 rounded border-slate-300"
                />
              </th>
              <th className="px-3 py-3">Date</th>
              <th className="px-3 py-3">In</th>
              <th className="px-3 py-3">Out</th>
              <th className="px-3 py-3 text-right">Hours</th>
              <th className="px-3 py-3">Type</th>
              <th className="px-3 py-3 text-center">Approved by Manager</th>
              {showEmployeeColumn && (
                <th className="px-3 py-3 text-center">Approved by Employee</th>
              )}
              <th className="px-3 py-3 text-right">Lock Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {groupedByEmployee.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                  No time records found for the selected filters.
                </td>
              </tr>
            ) : (
              groupedByEmployee.map(([userId, empRecords]) => {
                const emp = usersById[userId];
                return (
                  <React.Fragment key={userId}>
                    <tr className="bg-slate-100/90">
                      <td colSpan={9} className="px-3 py-2 font-bold text-slate-900">
                        {emp?.fullName || 'Employee'} ({empRecords.length} record(s))
                      </td>
                    </tr>
                    {empRecords.map(rec => {
                      const ev = evaluatedMap.get(rec.id);
                      const fullyApproved = isRecordFullyApproved(rec, company);
                      const checked = selectedRecordIds.includes(rec.id);

                      return (
                        <tr key={rec.id} className="hover:bg-slate-50">
                          <td className="px-3 py-2.5">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={e => {
                                if (e.target.checked) {
                                  setSelectedRecordIds(prev => [...prev, rec.id]);
                                } else {
                                  setSelectedRecordIds(prev => prev.filter(id => id !== rec.id));
                                }
                              }}
                              className="w-4 h-4 rounded border-slate-300"
                            />
                          </td>
                          <td className="px-3 py-2.5 font-mono tabular-nums text-slate-800">
                            {formatDateDisplay(rec.date, company.dateFormat)}
                          </td>
                          <td className="px-3 py-2.5 font-mono tabular-nums text-slate-800">
                            {rec.recordType === 'Work'
                              ? formatTimeDisplay(rec.timeIn, company.timeFormat)
                              : '—'}
                          </td>
                          <td className="px-3 py-2.5 font-mono tabular-nums text-slate-800">
                            {rec.recordType === 'Work'
                              ? rec.workingNow || !rec.timeOut
                                ? 'Working Now'
                                : formatTimeDisplay(rec.timeOut, company.timeFormat)
                              : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums font-bold text-slate-900">
                            {formatHours(ev?.totalHours || 0, company.timeTotalsFormat)}
                          </td>
                          <td className="px-3 py-2.5 text-slate-700">{rec.recordType}</td>
                          <td className="px-3 py-2.5 text-center">
                            <button
                              type="button"
                              disabled={!canApproveAsManager}
                              onClick={() => {
                                if (!canApproveAsManager) return;
                                setRecordsApproval(company.id, [rec.id], {
                                  approvedByManager: !rec.approvedByManager,
                                });
                                onRefresh();
                              }}
                              className={`px-2.5 py-1 rounded text-xs font-bold transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                                rec.approvedByManager
                                  ? 'text-emerald-800 bg-emerald-100 hover:bg-emerald-200'
                                  : 'text-amber-800 bg-amber-50 hover:bg-amber-100'
                              }`}
                            >
                              {rec.approvedByManager ? '✓ Approved' : 'Pending'}
                            </button>
                          </td>
                          {showEmployeeColumn && (
                            <td className="px-3 py-2.5 text-center">
                              <button
                                type="button"
                                disabled={!canActAsEmployeeOnRecord(rec)}
                                onClick={() => {
                                  if (!canActAsEmployeeOnRecord(rec)) return;
                                  setRecordsApproval(company.id, [rec.id], {
                                    approvedByEmployee: !rec.approvedByEmployee,
                                  });
                                  onRefresh();
                                }}
                                className={`px-2.5 py-1 rounded text-xs font-bold transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                                  rec.approvedByEmployee
                                    ? 'text-emerald-800 bg-emerald-100 hover:bg-emerald-200'
                                    : 'text-amber-800 bg-amber-50 hover:bg-amber-100'
                                }`}
                              >
                                {rec.approvedByEmployee ? '✓ Approved' : 'Pending'}
                              </button>
                            </td>
                          )}
                          <td className="px-3 py-2.5 text-right">
                            {fullyApproved ? (
                              <span className="inline-flex items-center gap-1 text-emerald-700 font-bold">
                                <Lock className="w-3.5 h-3.5" /> Fully Approved
                              </span>
                            ) : (
                              <span className="text-slate-400">Unlocked</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// PART D8: REPORTS VIEW
// ============================================================================

type ReportId =
  | 'Timecard Detail'
  | 'Timecard Summary'
  | 'Payroll Summary'
  | 'Who Has No Entry';

const ALL_REPORTS: Array<{ id: ReportId; description: string }> = [
  {
    id: 'Timecard Detail',
    description: 'Per employee per day breakdown with employee subtotals and company total.',
  },
  {
    id: 'Timecard Summary',
    description: 'One row per employee showing Reg, OT, Absence, Paid, Unpaid, and Total.',
  },
  {
    id: 'Payroll Summary',
    description: 'Total Paid Hours, Pay Rate, and Gross Pay per employee plus company total.',
  },
  {
    id: 'Who Has No Entry',
    description: 'Active employees with no record on each day of the selected date range.',
  },
];

interface ReportsViewProps {
  company: Company;
  users: AppUser[];
  departments: Department[];
  records: TimeRecord[];
}

export function ReportsView({
  company,
  users,
  departments,
  records,
}: ReportsViewProps) {
  const todayISO = getTodayISO();
  const currentPeriod = useMemo(
    () => getPayPeriodRange(company, todayISO, 0),
    [company, todayISO]
  );

  const [favorites, setFavorites] = useState<string[]>(() => getFavoriteReports(company.id));
  const [selectedReport, setSelectedReport] = useState<ReportId>('Timecard Summary');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [empFilter, setEmpFilter] = useState('ALL');
  const [fromDate, setFromDate] = useState(currentPeriod.startDate);
  const [toDate, setToDate] = useState(currentPeriod.endDate);

  const activeUsers = useMemo(
    () => users.filter(u => !u.archived && u.status === 'Active'),
    [users]
  );

  const deptMap = useMemo(() => {
    const map: Record<string, string> = {};
    departments.forEach(d => {
      map[d.id] = d.name;
    });
    return map;
  }, [departments]);

  const usersById = useMemo(() => {
    const map: Record<string, AppUser> = {};
    users.forEach(u => {
      map[u.id] = u;
    });
    return map;
  }, [users]);

  const sortedReports = useMemo(() => {
    return [...ALL_REPORTS].sort((a, b) => {
      const aFav = favorites.includes(a.id) ? 0 : 1;
      const bFav = favorites.includes(b.id) ? 0 : 1;
      return aFav - bFav;
    });
  }, [favorites]);

  const evaluatedMap = useMemo(
    () => evaluateRecordsWithOvertime(records, company, usersById, { fromDate, toDate }),
    [records, company, usersById, fromDate, toDate]
  );

  const targetEmployees = useMemo(() => {
    return activeUsers.filter(u => {
      if (deptFilter !== 'ALL' && u.departmentId !== deptFilter) return false;
      if (empFilter !== 'ALL' && u.id !== empFilter) return false;
      return true;
    });
  }, [activeUsers, deptFilter, empFilter]);

  const filteredPeriodRecords = useMemo(() => {
    const targetIds = new Set(targetEmployees.map(u => u.id));
    return records
      .filter(r => r.requestStatus !== 'Pending' && r.requestStatus !== 'Denied')
      .filter(r => targetIds.has(r.userId) && r.date >= fromDate && r.date <= toDate)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [records, targetEmployees, fromDate, toDate]);

  // Build tabular export rows for CSV / Excel / PDF
  const buildReportExportRows = (): { headers: string[]; rows: string[][] } => {
    if (selectedReport === 'Timecard Detail') {
      const headers = [
        'Employee',
        'Date',
        'In',
        'Out',
        'Lunch Deducted (m)',
        'Reg',
        'OT',
        'Absence',
        'Paid',
        'Unpaid',
        'Total',
      ];
      const rows: string[][] = [];
      for (const emp of targetEmployees) {
        const empRecs = filteredPeriodRecords.filter(r => r.userId === emp.id);
        for (const r of empRecs) {
          const ev = evaluatedMap.get(r.id);
          if (!ev) continue;
          rows.push([
            emp.fullName,
            formatDateDisplay(r.date, company.dateFormat),
            r.recordType === 'Work' ? formatTimeDisplay(r.timeIn, company.timeFormat) : '—',
            r.recordType === 'Work' ? formatTimeDisplay(r.timeOut, company.timeFormat) : '—',
            String(ev.lunchDeductedMins || 0),
            formatHours(ev.regHours, company.timeTotalsFormat),
            formatHours(ev.otHours, company.timeTotalsFormat),
            formatHours(ev.paidAbsenceHours + ev.unpaidAbsenceHours, company.timeTotalsFormat),
            formatHours(ev.paidHours, company.timeTotalsFormat),
            formatHours(ev.unpaidHours, company.timeTotalsFormat),
            formatHours(ev.totalHours, company.timeTotalsFormat),
          ]);
        }
        const empSummary = summarizeEvaluatedRecords(
          empRecs.map(r => evaluatedMap.get(r.id)).filter((x): x is EvaluatedRecord => Boolean(x))
        );
        rows.push([
          `${emp.fullName} Subtotal`,
          '',
          '',
          '',
          '',
          formatHours(empSummary.regHours, company.timeTotalsFormat),
          formatHours(empSummary.otHours, company.timeTotalsFormat),
          formatHours(
            empSummary.paidAbsenceHours + empSummary.unpaidAbsenceHours,
            company.timeTotalsFormat
          ),
          formatHours(empSummary.paidHours, company.timeTotalsFormat),
          formatHours(empSummary.unpaidHours, company.timeTotalsFormat),
          formatHours(empSummary.totalHours, company.timeTotalsFormat),
        ]);
      }
      return { headers, rows };
    }

    if (selectedReport === 'Timecard Summary') {
      const headers = ['Employee', 'Department', 'Reg', 'OT', 'Absence', 'Paid', 'Unpaid', 'Total'];
      const rows: string[][] = [];
      for (const emp of targetEmployees) {
        const empRecs = filteredPeriodRecords.filter(r => r.userId === emp.id);
        const s = summarizeEvaluatedRecords(
          empRecs.map(r => evaluatedMap.get(r.id)).filter((x): x is EvaluatedRecord => Boolean(x))
        );
        rows.push([
          emp.fullName,
          deptMap[emp.departmentId] || 'Unassigned',
          formatHours(s.regHours, company.timeTotalsFormat),
          formatHours(s.otHours, company.timeTotalsFormat),
          formatHours(s.paidAbsenceHours + s.unpaidAbsenceHours, company.timeTotalsFormat),
          formatHours(s.paidHours, company.timeTotalsFormat),
          formatHours(s.unpaidHours, company.timeTotalsFormat),
          formatHours(s.totalHours, company.timeTotalsFormat),
        ]);
      }
      return { headers, rows };
    }

    if (selectedReport === 'Payroll Summary') {
      const headers = [
        'Employee',
        'Department',
        'Rate Type',
        'Regular Hours',
        'Overtime Hours',
        'Total Paid Hours',
        'Pay Rate',
        'Gross Pay',
      ];
      const rows: string[][] = [];
      for (const emp of targetEmployees) {
        const empRecs = filteredPeriodRecords.filter(r => r.userId === emp.id);
        const s = summarizeEvaluatedRecords(
          empRecs.map(r => evaluatedMap.get(r.id)).filter((x): x is EvaluatedRecord => Boolean(x))
        );
        const gross =
          emp.rateType === 'Salary' ? emp.payRate : s.paidHours * emp.payRate + s.amountAdjustment;
        rows.push([
          emp.fullName,
          deptMap[emp.departmentId] || 'Unassigned',
          emp.rateType,
          formatHours(s.regHours, company.timeTotalsFormat),
          formatHours(s.otHours, company.timeTotalsFormat),
          formatHours(s.paidHours, company.timeTotalsFormat),
          `${company.currencySymbol}${emp.payRate.toFixed(2)}`,
          `${company.currencySymbol}${gross.toFixed(2)}`,
        ]);
      }
      return { headers, rows };
    }

    // Who Has No Entry
    const headers = ['Date', 'Employee', 'Department', 'Role'];
    const rows: string[][] = [];
    const dates = listDatesInRange(fromDate, toDate);
    for (const d of dates) {
      for (const emp of targetEmployees) {
        const hasRec = filteredPeriodRecords.some(r => r.userId === emp.id && r.date === d);
        if (!hasRec) {
          rows.push([
            formatDateDisplay(d, company.dateFormat),
            emp.fullName,
            deptMap[emp.departmentId] || 'Unassigned',
            emp.role,
          ]);
        }
      }
    }
    return { headers, rows };
  };

  const handleDownloadCSV = () => {
    const { headers, rows } = buildReportExportRows();
    const csvContent = [headers, ...rows]
      .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedReport.replace(/\s+/g, '_')}_${fromDate}_${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadExcel = () => {
    const { headers, rows } = buildReportExportRows();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    XLSX.writeFile(wb, `${selectedReport.replace(/\s+/g, '_')}_${fromDate}_${toDate}.xlsx`);
  };

  const companyOverallSummary = useMemo(() => {
    const evals = filteredPeriodRecords
      .map(r => evaluatedMap.get(r.id))
      .filter((x): x is EvaluatedRecord => Boolean(x));
    return summarizeEvaluatedRecords(evals);
  }, [filteredPeriodRecords, evaluatedMap]);

  const buildFooterTotalRow = (): string[] | undefined => {
    if (selectedReport === 'Timecard Detail') {
      return [
        'COMPANY TOTAL',
        '',
        '',
        '',
        '',
        '',
        formatHours(companyOverallSummary.regHours, company.timeTotalsFormat),
        formatHours(companyOverallSummary.otHours, company.timeTotalsFormat),
        formatHours(
          companyOverallSummary.paidAbsenceHours + companyOverallSummary.unpaidAbsenceHours,
          company.timeTotalsFormat
        ),
        formatHours(companyOverallSummary.paidHours, company.timeTotalsFormat),
        formatHours(companyOverallSummary.unpaidHours, company.timeTotalsFormat),
        formatHours(companyOverallSummary.totalHours, company.timeTotalsFormat),
      ];
    }
    if (selectedReport === 'Timecard Summary') {
      return [
        'COMPANY TOTAL',
        '',
        formatHours(companyOverallSummary.regHours, company.timeTotalsFormat),
        formatHours(companyOverallSummary.otHours, company.timeTotalsFormat),
        formatHours(
          companyOverallSummary.paidAbsenceHours + companyOverallSummary.unpaidAbsenceHours,
          company.timeTotalsFormat
        ),
        formatHours(companyOverallSummary.paidHours, company.timeTotalsFormat),
        formatHours(companyOverallSummary.unpaidHours, company.timeTotalsFormat),
        formatHours(companyOverallSummary.totalHours, company.timeTotalsFormat),
      ];
    }
    if (selectedReport === 'Payroll Summary') {
      let totalGross = 0;
      for (const emp of targetEmployees) {
        const empRecs = filteredPeriodRecords.filter(r => r.userId === emp.id);
        const s = summarizeEvaluatedRecords(
          empRecs.map(r => evaluatedMap.get(r.id)).filter((x): x is EvaluatedRecord => Boolean(x))
        );
        const gross =
          emp.rateType === 'Salary' ? emp.payRate : s.paidHours * emp.payRate + s.amountAdjustment;
        totalGross += gross;
      }
      return [
        'COMPANY TOTAL',
        '',
        '',
        formatHours(companyOverallSummary.regHours, company.timeTotalsFormat),
        formatHours(companyOverallSummary.otHours, company.timeTotalsFormat),
        formatHours(companyOverallSummary.paidHours, company.timeTotalsFormat),
        '—',
        `${company.currencySymbol}${totalGross.toFixed(2)}`,
      ];
    }
    return undefined;
  };

  const handleDownloadPDF = () => {
    const { headers, rows } = buildReportExportRows();
    exportAdminReportVectorPDF({
      companyName: company.name,
      reportTitle: selectedReport,
      fromDate: formatDateDisplay(fromDate, company.dateFormat),
      toDate: formatDateDisplay(toDate, company.dateFormat),
      headers,
      rows,
      footerTotalRow: buildFooterTotalRow(),
      filename: `${selectedReport.replace(/\s+/g, '_')}_${fromDate}_${toDate}.pdf`,
    });
  };

  const handlePrintReport = () => {
    handleDownloadPDF();
    window.setTimeout(() => {
      try {
        window.print();
      } catch {}
    }, 120);
  };

  return (
    <div className="space-y-5">
      {/* Report Picker List with Favorite Star Pinning */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {sortedReports.map(rep => {
          const isFav = favorites.includes(rep.id);
          const isSelected = selectedReport === rep.id;
          return (
            <div
              key={rep.id}
              onClick={() => setSelectedReport(rep.id)}
              className={`p-4 rounded-xl border cursor-pointer transition-all flex flex-col justify-between ${
                isSelected
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-900 border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-bold">{rep.id}</span>
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    setFavorites(toggleFavoriteReport(company.id, rep.id));
                  }}
                  title={isFav ? 'Unpin Favorite' : 'Pin Favorite to top'}
                  className="p-1"
                >
                  <Star
                    className={`w-4 h-4 ${
                      isFav
                        ? 'fill-amber-400 text-amber-400'
                        : isSelected
                        ? 'text-slate-400'
                        : 'text-slate-300'
                    }`}
                  />
                </button>
              </div>
              <p
                className={`text-xs mt-1.5 ${
                  isSelected ? 'text-slate-300' : 'text-slate-500'
                }`}
              >
                {rep.description}
              </p>
            </div>
          );
        })}
      </div>

      {/* Filters & Export Buttons */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
              Department
            </label>
            <select
              value={deptFilter}
              onChange={e => setDeptFilter(e.target.value)}
              className="w-full min-h-[38px] px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="ALL">All Departments</option>
              {departments.map(d => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
              Employee
            </label>
            <select
              value={empFilter}
              onChange={e => setEmpFilter(e.target.value)}
              className="w-full min-h-[38px] px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="ALL">All Employees</option>
              {activeUsers.map(u => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
              From Date
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              className="w-full min-h-[38px] px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
              To Date
            </label>
            <input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              className="w-full min-h-[38px] px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-800">
            <span>
              Previewing: {selectedReport} ({formatDateDisplay(fromDate, company.dateFormat)} –{' '}
              {formatDateDisplay(toDate, company.dateFormat)})
            </span>
            <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 text-[11px] font-bold">
              Overtime Rule: Weekly (&gt;40h/wk)
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handlePrintReport}
              className="px-3 py-1.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Report</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadPDF}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Download as PDF</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadExcel}
              className="px-3 py-1.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Download as Excel</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadCSV}
              className="px-3 py-1.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download as CSV</span>
            </button>
          </div>
        </div>
      </div>

      {/* Report Preview Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        {selectedReport === 'Timecard Detail' && (
          <table className="min-w-full divide-y divide-slate-200 text-xs font-mono tabular-nums">
            <thead className="bg-slate-50 text-slate-600 font-sans font-bold uppercase tracking-wider">
              <tr>
                <th className="px-3 py-3 text-left">Employee / Date</th>
                <th className="px-3 py-3 text-left">In</th>
                <th className="px-3 py-3 text-left">Out</th>
                <th className="px-3 py-3 text-right">Lunch Deducted</th>
                <th className="px-3 py-3 text-right">Reg</th>
                <th className="px-3 py-3 text-right">OT</th>
                <th className="px-3 py-3 text-right">Absence</th>
                <th className="px-3 py-3 text-right">Paid</th>
                <th className="px-3 py-3 text-right">Unpaid</th>
                <th className="px-3 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {targetEmployees.map(emp => {
                const empRecs = filteredPeriodRecords.filter(r => r.userId === emp.id);
                const empSum = summarizeEvaluatedRecords(
                  empRecs
                    .map(r => evaluatedMap.get(r.id))
                    .filter((x): x is EvaluatedRecord => Boolean(x))
                );
                return (
                  <React.Fragment key={emp.id}>
                    <tr className="bg-slate-100 font-sans font-bold text-slate-900">
                      <td colSpan={10} className="px-3 py-2">
                        {emp.fullName} ({deptMap[emp.departmentId] || 'Unassigned'})
                      </td>
                    </tr>
                    {empRecs.map(r => {
                      const ev = evaluatedMap.get(r.id);
                      if (!ev) return null;
                      return (
                        <tr key={r.id} className="hover:bg-slate-50">
                          <td className="px-3 py-2">
                            {formatDateDisplay(r.date, company.dateFormat)}{' '}
                            {r.recordType !== 'Work' && `(${r.recordType})`}
                          </td>
                          <td className="px-3 py-2">
                            {r.recordType === 'Work'
                              ? formatTimeDisplay(r.timeIn, company.timeFormat)
                              : '—'}
                          </td>
                          <td className="px-3 py-2">
                            {r.recordType === 'Work'
                              ? formatTimeDisplay(r.timeOut, company.timeFormat)
                              : '—'}
                          </td>
                          <td className="px-3 py-2 text-right">{ev.lunchDeductedMins}m</td>
                          <td className="px-3 py-2 text-right">
                            {formatHours(ev.regHours, company.timeTotalsFormat)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {formatHours(ev.otHours, company.timeTotalsFormat)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {formatHours(
                              ev.paidAbsenceHours + ev.unpaidAbsenceHours,
                              company.timeTotalsFormat
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-bold">
                            {formatHours(ev.paidHours, company.timeTotalsFormat)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {formatHours(ev.unpaidHours, company.timeTotalsFormat)}
                          </td>
                          <td className="px-3 py-2 text-right font-bold">
                            {formatHours(ev.totalHours, company.timeTotalsFormat)}
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="bg-blue-50/70 font-bold text-blue-950">
                      <td colSpan={4} className="px-3 py-2 font-sans">
                        Subtotal — {emp.fullName}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatHours(empSum.regHours, company.timeTotalsFormat)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatHours(empSum.otHours, company.timeTotalsFormat)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatHours(
                          empSum.paidAbsenceHours + empSum.unpaidAbsenceHours,
                          company.timeTotalsFormat
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatHours(empSum.paidHours, company.timeTotalsFormat)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatHours(empSum.unpaidHours, company.timeTotalsFormat)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatHours(empSum.totalHours, company.timeTotalsFormat)}
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })}
              <tr className="bg-slate-900 text-white font-bold">
                <td colSpan={4} className="px-3 py-3 font-sans">
                  Company Total
                </td>
                <td className="px-3 py-3 text-right">
                  {formatHours(companyOverallSummary.regHours, company.timeTotalsFormat)}
                </td>
                <td className="px-3 py-3 text-right">
                  {formatHours(companyOverallSummary.otHours, company.timeTotalsFormat)}
                </td>
                <td className="px-3 py-3 text-right">
                  {formatHours(
                    companyOverallSummary.paidAbsenceHours +
                      companyOverallSummary.unpaidAbsenceHours,
                    company.timeTotalsFormat
                  )}
                </td>
                <td className="px-3 py-3 text-right">
                  {formatHours(companyOverallSummary.paidHours, company.timeTotalsFormat)}
                </td>
                <td className="px-3 py-3 text-right">
                  {formatHours(companyOverallSummary.unpaidHours, company.timeTotalsFormat)}
                </td>
                <td className="px-3 py-3 text-right">
                  {formatHours(companyOverallSummary.totalHours, company.timeTotalsFormat)}
                </td>
              </tr>
            </tbody>
          </table>
        )}

        {selectedReport === 'Timecard Summary' && (
          <table className="min-w-full divide-y divide-slate-200 text-xs font-mono tabular-nums">
            <thead className="bg-slate-50 text-slate-600 font-sans font-bold uppercase tracking-wider">
              <tr>
                <th className="px-3 py-3 text-left">Employee</th>
                <th className="px-3 py-3 text-left">Department</th>
                <th className="px-3 py-3 text-right">Reg</th>
                <th className="px-3 py-3 text-right">OT</th>
                <th className="px-3 py-3 text-right">Absence</th>
                <th className="px-3 py-3 text-right">Paid</th>
                <th className="px-3 py-3 text-right">Unpaid</th>
                <th className="px-3 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {targetEmployees.map(emp => {
                const empRecs = filteredPeriodRecords.filter(r => r.userId === emp.id);
                const s = summarizeEvaluatedRecords(
                  empRecs
                    .map(r => evaluatedMap.get(r.id))
                    .filter((x): x is EvaluatedRecord => Boolean(x))
                );
                return (
                  <tr key={emp.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5 font-sans font-bold text-slate-900">
                      {emp.fullName}
                    </td>
                    <td className="px-3 py-2.5 font-sans text-slate-600">
                      {deptMap[emp.departmentId] || 'Unassigned'}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {formatHours(s.regHours, company.timeTotalsFormat)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {formatHours(s.otHours, company.timeTotalsFormat)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {formatHours(
                        s.paidAbsenceHours + s.unpaidAbsenceHours,
                        company.timeTotalsFormat
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-bold text-slate-900">
                      {formatHours(s.paidHours, company.timeTotalsFormat)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {formatHours(s.unpaidHours, company.timeTotalsFormat)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-bold text-slate-900">
                      {formatHours(s.totalHours, company.timeTotalsFormat)}
                    </td>
                  </tr>
                );
              })}
              <tr className="bg-slate-900 text-white font-bold">
                <td colSpan={2} className="px-3 py-3 font-sans">
                  Company Total
                </td>
                <td className="px-3 py-3 text-right">
                  {formatHours(companyOverallSummary.regHours, company.timeTotalsFormat)}
                </td>
                <td className="px-3 py-3 text-right">
                  {formatHours(companyOverallSummary.otHours, company.timeTotalsFormat)}
                </td>
                <td className="px-3 py-3 text-right">
                  {formatHours(
                    companyOverallSummary.paidAbsenceHours +
                      companyOverallSummary.unpaidAbsenceHours,
                    company.timeTotalsFormat
                  )}
                </td>
                <td className="px-3 py-3 text-right">
                  {formatHours(companyOverallSummary.paidHours, company.timeTotalsFormat)}
                </td>
                <td className="px-3 py-3 text-right">
                  {formatHours(companyOverallSummary.unpaidHours, company.timeTotalsFormat)}
                </td>
                <td className="px-3 py-3 text-right">
                  {formatHours(companyOverallSummary.totalHours, company.timeTotalsFormat)}
                </td>
              </tr>
            </tbody>
          </table>
        )}

        {selectedReport === 'Payroll Summary' && (
          <table className="min-w-full divide-y divide-slate-200 text-xs font-mono tabular-nums">
            <thead className="bg-slate-50 text-slate-600 font-sans font-bold uppercase tracking-wider">
              <tr>
                <th className="px-3 py-3 text-left">Employee</th>
                <th className="px-3 py-3 text-left">Department</th>
                <th className="px-3 py-3 text-left">Rate Type</th>
                <th className="px-3 py-3 text-right">
                  Regular Hours (≤40/wk)
                </th>
                <th className="px-3 py-3 text-right">
                  Overtime Hours (&gt;40/wk)
                </th>
                <th className="px-3 py-3 text-right">Total Paid Hours</th>
                <th className="px-3 py-3 text-right">Pay Rate</th>
                <th className="px-3 py-3 text-right">Gross Pay</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {(() => {
                let companyGrossTotal = 0;
                const rows = targetEmployees.map(emp => {
                  const empRecs = filteredPeriodRecords.filter(r => r.userId === emp.id);
                  const s = summarizeEvaluatedRecords(
                    empRecs
                      .map(r => evaluatedMap.get(r.id))
                      .filter((x): x is EvaluatedRecord => Boolean(x))
                  );
                  const gross =
                    emp.rateType === 'Salary'
                      ? emp.payRate
                      : s.paidHours * emp.payRate + s.amountAdjustment;
                  companyGrossTotal += gross;
                  return (
                    <tr key={emp.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2.5 font-sans font-bold text-slate-900">
                        {emp.fullName}
                      </td>
                      <td className="px-3 py-2.5 font-sans text-slate-600">
                        {deptMap[emp.departmentId] || 'Unassigned'}
                      </td>
                      <td className="px-3 py-2.5 font-sans text-slate-600">{emp.rateType}</td>
                      <td className="px-3 py-2.5 text-right">
                        {formatHours(s.regHours, company.timeTotalsFormat)}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right ${
                          s.otHours > 0 ? 'font-bold text-rose-600' : ''
                        }`}
                      >
                        {formatHours(s.otHours, company.timeTotalsFormat)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold">
                        {formatHours(s.paidHours, company.timeTotalsFormat)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {company.currencySymbol}
                        {emp.payRate.toFixed(2)}
                        {emp.rateType === 'Salary' ? ' / period' : ' / hr'}
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold text-slate-900">
                        {company.currencySymbol}
                        {gross.toFixed(2)}
                      </td>
                    </tr>
                  );
                });
                return (
                  <>
                    {rows}
                    <tr className="bg-slate-900 text-white font-bold">
                      <td colSpan={3} className="px-3 py-3 font-sans">
                        Company Total
                      </td>
                      <td className="px-3 py-3 text-right">
                        {formatHours(companyOverallSummary.regHours, company.timeTotalsFormat)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {formatHours(companyOverallSummary.otHours, company.timeTotalsFormat)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {formatHours(companyOverallSummary.paidHours, company.timeTotalsFormat)}
                      </td>
                      <td className="px-3 py-3 text-right">—</td>
                      <td className="px-3 py-3 text-right">
                        {company.currencySymbol}
                        {companyGrossTotal.toFixed(2)}
                      </td>
                    </tr>
                  </>
                );
              })()}
            </tbody>
          </table>
        )}

        {selectedReport === 'Who Has No Entry' && (
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider">
              <tr>
                <th className="px-3 py-3 text-left">Date</th>
                <th className="px-3 py-3 text-left">Employee</th>
                <th className="px-3 py-3 text-left">Department</th>
                <th className="px-3 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {listDatesInRange(fromDate, toDate).flatMap(d =>
                targetEmployees
                  .filter(emp => !filteredPeriodRecords.some(r => r.userId === emp.id && r.date === d))
                  .map(emp => (
                    <tr key={`${d}_${emp.id}`} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono tabular-nums text-slate-700">
                        {formatDateDisplay(d, company.dateFormat)} ({d})
                      </td>
                      <td className="px-3 py-2 font-bold text-slate-900">{emp.fullName}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {deptMap[emp.departmentId] || 'Unassigned'}
                      </td>
                      <td className="px-3 py-2 text-amber-700 font-semibold">No Entry</td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// PART D6: COMPANY SETTINGS VIEW
// ============================================================================

interface CompanySettingsViewProps {
  company: Company;
  currentUser: AppUser;
  onRefresh: () => void;
}

const ROUNDING_MINS: RoundingMinutes[] = [1, 5, 6, 7, 10, 15, 30];

export function CompanySettingsView({
  company,
  currentUser,
  onRefresh,
}: CompanySettingsViewProps) {
  const [name, setName] = useState(company.name);
  const [shortName, setShortName] = useState(company.shortName);
  const [ownerEmail, setOwnerEmail] = useState(company.ownerEmail);
  const [weekStartDay, setWeekStartDay] = useState(company.weekStartDay);
  const [payPeriodType, setPayPeriodType] = useState<PayPeriodType>(company.payPeriodType);
  const [payPeriodStartDate, setPayPeriodStartDate] = useState(company.payPeriodStartDate);
  const [defaultTimezone, setDefaultTimezone] = useState(company.defaultTimezone);
  const [dateFormat, setDateFormat] = useState<DateFormatType>(company.dateFormat);
  const [timeFormat, setTimeFormat] = useState<TimeFormatType>(company.timeFormat);
  const [timeTotalsFormat, setTimeTotalsFormat] = useState<TimeTotalsFormat>(
    company.timeTotalsFormat
  );
  const [currencySymbol, setCurrencySymbol] = useState(company.currencySymbol);

  // Time Rules
  const [roundingInDir, setRoundingInDir] = useState<RoundingDirection>(company.roundingInDir);
  const [roundingInMins, setRoundingInMins] = useState<RoundingMinutes>(company.roundingInMins);
  const [roundingOutDir, setRoundingOutDir] = useState<RoundingDirection>(company.roundingOutDir);
  const [roundingOutMins, setRoundingOutMins] = useState<RoundingMinutes>(company.roundingOutMins);
  const [autoLunchMode, setAutoLunchMode] = useState<AutoLunchMode>(company.autoLunchMode);
  const [autoLunchMinutes, setAutoLunchMinutes] = useState(String(company.autoLunchMinutes));
  const [autoLunchAfterHours, setAutoLunchAfterHours] = useState(
    String(company.autoLunchAfterHours)
  );
  const [defaultShiftStart, setDefaultShiftStart] = useState(company.defaultShiftStart);
  const [defaultShiftEnd, setDefaultShiftEnd] = useState(company.defaultShiftEnd);
  const [minLunchMinutes, setMinLunchMinutes] = useState(String(company.minLunchMinutes));
  const [calculateOvertimeWeekly, setCalculateOvertimeWeekly] = useState<boolean>(
    company.calculateOvertimeWeekly !== false
  );
  const [highlightPublicHolidays, setHighlightPublicHolidays] = useState<boolean>(
    company.highlightPublicHolidays !== false
  );
  const [holidayCountry, setHolidayCountry] = useState<HolidayCountryCode>(
    company.holidayCountry || 'US'
  );

  // Approvals
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>(company.approvalMode);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateCompanySettings(company.id, {
      name,
      shortName,
      ownerEmail,
      weekStartDay: Number(weekStartDay),
      payPeriodType,
      payPeriodStartDate,
      defaultTimezone,
      dateFormat,
      timeFormat,
      timeTotalsFormat,
      currencySymbol,
      roundingInDir,
      roundingInMins: Number(roundingInMins) as RoundingMinutes,
      roundingOutDir,
      roundingOutMins: Number(roundingOutMins) as RoundingMinutes,
      autoLunchMode,
      autoLunchMinutes: Number(autoLunchMinutes) || 0,
      autoLunchAfterHours: Number(autoLunchAfterHours) || 6,
      defaultShiftStart,
      defaultShiftEnd,
      minLunchMinutes: Number(minLunchMinutes) || 30,
      calculateOvertimeWeekly,
      highlightPublicHolidays,
      holidayCountry,
      approvalMode,
    });
    onRefresh();
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  return (
    <form onSubmit={handleSave} className="space-y-6 max-w-4xl">
      {savedSuccess && (
        <div
          role="status"
          className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>Settings saved</span>
        </div>
      )}

      {/* Section 1: Common */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 border-b border-slate-100 pb-2">
          Common Company Settings
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Company Name
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Company Short Name
            </label>
            <input
              type="text"
              value={shortName}
              onChange={e => setShortName(e.target.value)}
              className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg font-mono"
            />
          </div>
          {currentUser.role === 'Admin' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Account Owner Email
              </label>
              <input
                type="email"
                value={ownerEmail}
                onChange={e => setOwnerEmail(e.target.value)}
                className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
              />
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Week Start Day
            </label>
            <select
              value={weekStartDay}
              onChange={e => setWeekStartDay(Number(e.target.value))}
              className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            >
              {[
                'Sunday',
                'Monday',
                'Tuesday',
                'Wednesday',
                'Thursday',
                'Friday',
                'Saturday',
              ].map((d, idx) => (
                <option key={d} value={idx}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Pay Period
            </label>
            <select
              value={payPeriodType}
              onChange={e => setPayPeriodType(e.target.value as PayPeriodType)}
              className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="Weekly">Weekly</option>
              <option value="Bi-Weekly">Bi-Weekly</option>
              <option value="Semi-Monthly">Semi-Monthly</option>
              <option value="Monthly">Monthly</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Pay Period Start Date
            </label>
            <input
              type="date"
              value={payPeriodStartDate}
              onChange={e => setPayPeriodStartDate(e.target.value)}
              className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Default Timezone
            </label>
            <select
              value={defaultTimezone}
              onChange={e => setDefaultTimezone(e.target.value)}
              className="w-full min-h-[38px] px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            >
              {[
                'America/New_York',
                'America/Chicago',
                'America/Denver',
                'America/Los_Angeles',
                'America/Phoenix',
                'Europe/London',
                'UTC',
              ].map(tz => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Date Format
            </label>
            <select
              value={dateFormat}
              onChange={e => setDateFormat(e.target.value as DateFormatType)}
              className="w-full min-h-[38px] px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="US">US (MM/DD/YYYY)</option>
              <option value="Canada">Canada (YYYY-MM-DD)</option>
              <option value="UK">UK (DD/MM/YYYY)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Time Format
            </label>
            <select
              value={timeFormat}
              onChange={e => setTimeFormat(e.target.value as TimeFormatType)}
              className="w-full min-h-[38px] px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="12-hour">12-hour</option>
              <option value="24-hour">24-hour</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Time Totals Format
            </label>
            <select
              value={timeTotalsFormat}
              onChange={e => setTimeTotalsFormat(e.target.value as TimeTotalsFormat)}
              className="w-full min-h-[38px] px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="2:30">2:30</option>
              <option value="2h 30m">2h 30m</option>
              <option value="2.50">2.50</option>
              <option value="2.500">2.500</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Currency Symbol
            </label>
            <input
              type="text"
              value={currencySymbol}
              onChange={e => setCurrencySymbol(e.target.value)}
              className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
            />
          </div>
        </div>
      </div>

      {/* Section 2: Time Rules */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 border-b border-slate-100 pb-2">
          Time Rules (Rounding, Auto Lunch &amp; Shift Thresholds)
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
            <label className="block text-xs font-bold text-slate-800">
              Rounding — Clock In
            </label>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={roundingInDir}
                onChange={e => setRoundingInDir(e.target.value as RoundingDirection)}
                className="min-h-[36px] px-2.5 py-1 text-xs border border-slate-300 rounded-lg bg-white"
              >
                <option value="NEAREST">NEAREST</option>
                <option value="UP">UP</option>
                <option value="DOWN">DOWN</option>
              </select>
              <select
                value={roundingInMins}
                onChange={e => setRoundingInMins(Number(e.target.value) as RoundingMinutes)}
                className="min-h-[36px] px-2.5 py-1 text-xs border border-slate-300 rounded-lg bg-white"
              >
                {ROUNDING_MINS.map(m => (
                  <option key={m} value={m}>
                    {m} minute{m > 1 ? 's' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
            <label className="block text-xs font-bold text-slate-800">
              Rounding — Clock Out
            </label>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={roundingOutDir}
                onChange={e => setRoundingOutDir(e.target.value as RoundingDirection)}
                className="min-h-[36px] px-2.5 py-1 text-xs border border-slate-300 rounded-lg bg-white"
              >
                <option value="NEAREST">NEAREST</option>
                <option value="UP">UP</option>
                <option value="DOWN">DOWN</option>
              </select>
              <select
                value={roundingOutMins}
                onChange={e => setRoundingOutMins(Number(e.target.value) as RoundingMinutes)}
                className="min-h-[36px] px-2.5 py-1 text-xs border border-slate-300 rounded-lg bg-white"
              >
                {ROUNDING_MINS.map(m => (
                  <option key={m} value={m}>
                    {m} minute{m > 1 ? 's' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Auto Lunch Deduction
            </label>
            <select
              value={autoLunchMode}
              onChange={e => setAutoLunchMode(e.target.value as AutoLunchMode)}
              className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="No">No</option>
              <option value="Yes">Yes</option>
              <option value="Per user">Per user</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Minutes to Deduct
            </label>
            <input
              type="number"
              value={autoLunchMinutes}
              onChange={e => setAutoLunchMinutes(e.target.value)}
              className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              After X Hours Worked
            </label>
            <input
              type="number"
              step="0.5"
              value={autoLunchAfterHours}
              onChange={e => setAutoLunchAfterHours(e.target.value)}
              className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Default Shift Start
            </label>
            <input
              type="time"
              value={defaultShiftStart}
              onChange={e => setDefaultShiftStart(e.target.value)}
              className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Default Shift End
            </label>
            <input
              type="time"
              value={defaultShiftEnd}
              onChange={e => setDefaultShiftEnd(e.target.value)}
              className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Minimum Lunch Minutes
            </label>
            <input
              type="number"
              value={minLunchMinutes}
              onChange={e => setMinLunchMinutes(e.target.value)}
              className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
            />
          </div>
        </div>

        {/* Overtime Calculation Rule */}
        <div className="pt-3 border-t border-slate-100">
          <label className="flex items-start justify-between gap-3 p-3.5 rounded-xl bg-indigo-50/60 border border-indigo-200/80 cursor-pointer">
            <div>
              <span className="text-xs font-bold text-slate-900 block">
                Calculate Overtime Weekly (Default)
              </span>
              <span className="text-[11px] text-slate-600 mt-0.5 block leading-snug">
                {calculateOvertimeWeekly
                  ? 'Overtime (>40 hrs) is calculated per 7-day workweek and reflected in Payroll Summary.'
                  : 'Overtime (>40 hrs) is calculated per pay period instead of weekly.'}
              </span>
            </div>
            <input
              type="checkbox"
              checked={calculateOvertimeWeekly}
              onChange={e => setCalculateOvertimeWeekly(e.target.checked)}
              className="w-5 h-5 mt-0.5 rounded text-indigo-600 focus:ring-indigo-500 shrink-0"
            />
          </label>
        </div>

        {/* Public Holidays Highlighting */}
        <div className="pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
          <label className="flex items-start justify-between gap-3 p-3.5 rounded-xl bg-violet-50/60 border border-violet-200/80 cursor-pointer">
            <div>
              <span className="text-xs font-bold text-slate-900 block">
                Highlight Public Holidays in Timesheet
              </span>
              <span className="text-[11px] text-slate-600 mt-0.5 block leading-snug">
                Automatically mark and highlight official public holidays and custom company holidays on timesheet rows.
              </span>
            </div>
            <input
              type="checkbox"
              checked={highlightPublicHolidays}
              onChange={e => setHighlightPublicHolidays(e.target.checked)}
              className="w-5 h-5 mt-0.5 rounded text-violet-600 focus:ring-violet-500 shrink-0"
            />
          </label>

          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
            <label className="block text-xs font-bold text-slate-800 mb-1">
              Public Holiday Calendar / Region
            </label>
            <select
              value={holidayCountry}
              onChange={e => setHolidayCountry(e.target.value as HolidayCountryCode)}
              disabled={!highlightPublicHolidays}
              className="w-full min-h-[36px] px-2.5 py-1 text-xs border border-slate-300 rounded-lg bg-white disabled:opacity-50"
            >
              {SUPPORTED_HOLIDAY_COUNTRIES.map(c => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Section 3: Approvals (Part D7) */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 border-b border-slate-100 pb-2">
          Approvals
        </h3>
        <div className="max-w-sm">
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Approval Mode
          </label>
          <select
            value={approvalMode}
            onChange={e => setApprovalMode(e.target.value as ApprovalMode)}
            className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
          >
            <option value="Off">Off</option>
            <option value="Manager only">Manager only</option>
            <option value="Employee and Manager">Employee and Manager</option>
          </select>
          <p className="text-xs text-slate-500 mt-1.5">
            Note: A Manager can approve their own records in Phase 1.
          </p>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          className="px-6 py-2.5 text-sm font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl shadow-xs"
        >
          Save Settings
        </button>
      </div>
    </form>
  );
}

// ============================================================================
// PART D9: NOTIFICATIONS VIEW
// ============================================================================

const NOTIFICATION_EVENTS: Array<{ event: NotificationEventType; desc: string }> = [
  { event: 'Clock IN', desc: 'When an employee punches in on the Web Punch Clock' },
  { event: 'Clock OUT', desc: 'When an employee punches out on the Web Punch Clock' },
  { event: 'Late IN', desc: 'Punch in after Default Shift Start + 5 min grace' },
  { event: 'Early OUT', desc: 'Punch out before Default Shift End' },
  { event: 'Forgot Clock In', desc: 'No entry by Default Shift Start + 60 min on a weekday' },
  { event: 'Manager Approve Timecard', desc: 'When a manager approves time records' },
  { event: 'Employee Approve Timecard', desc: 'When an employee approves their timecard' },
  { event: 'Daily Total', desc: 'End-of-day summary per employee' },
  { event: 'Weekly Total', desc: 'End-of-week summary per employee' },
];

interface NotificationsViewProps {
  company: Company;
  onRefresh: () => void;
}

export function NotificationsView({ company, onRefresh }: NotificationsViewProps) {
  const [settings, setSettings] = useState<NotificationSettings>(() =>
    getNotificationSettings(company.id)
  );
  const [savedToast, setSavedToast] = useState(false);

  const logs = getNotificationLogs(company.id);

  const updateAndPersist = (next: NotificationSettings) => {
    setSettings(next);
    saveNotificationSettings(company.id, next);
    onRefresh();
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2000);
  };

  return (
    <div className="space-y-6">
      {savedToast && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs font-semibold text-emerald-800 flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-600" />
          <span>Notification settings updated.</span>
        </div>
      )}

      {/* Master Notify Switch & Extra Emails */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Master Notify Switch</h3>
            <p className="text-xs text-slate-500">
              Turn all automated email &amp; log notifications ON or OFF for {company.name}.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-800 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.masterEnabled}
              onChange={e =>
                updateAndPersist({
                  ...settings,
                  masterEnabled: e.target.checked,
                })
              }
              className="w-5 h-5 rounded border-slate-300"
            />
            <span>{settings.masterEnabled ? 'Master Notify: ON' : 'Master Notify: OFF'}</span>
          </label>
        </div>

        <div className="pt-3 border-t border-slate-100">
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Notify Emails (extra recipients, comma or semicolon separated)
          </label>
          <input
            type="text"
            value={settings.extraEmails}
            onChange={e =>
              updateAndPersist({
                ...settings,
                extraEmails: e.target.value,
              })
            }
            placeholder="payroll@company.com; hr@company.com"
            className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
          />
        </div>
      </div>

      {/* Event Rules Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-xs text-left">
          <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider">
            <tr>
              <th className="px-4 py-3">Event</th>
              <th className="px-4 py-3 text-center">ON / OFF</th>
              <th className="px-4 py-3 text-center">To Employee</th>
              <th className="px-4 py-3 text-center">To Managers</th>
              <th className="px-4 py-3 text-center">To Admins</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {NOTIFICATION_EVENTS.map(({ event, desc }) => {
              const rule = settings.events[event] || {
                enabled: false,
                toEmployee: false,
                toManagers: false,
                toAdmins: false,
              };
              const toggleField = (
                field: 'enabled' | 'toEmployee' | 'toManagers' | 'toAdmins',
                val: boolean
              ) => {
                updateAndPersist({
                  ...settings,
                  events: {
                    ...settings.events,
                    [event]: {
                      ...rule,
                      [field]: val,
                    },
                  },
                });
              };

              return (
                <tr key={event} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-bold text-slate-900">{event}</div>
                    <div className="text-[11px] text-slate-500">{desc}</div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={e => toggleField('enabled', e.target.checked)}
                      aria-label={`${event} ON/OFF`}
                      className="w-4 h-4 rounded border-slate-300"
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={rule.toEmployee}
                      onChange={e => toggleField('toEmployee', e.target.checked)}
                      aria-label={`${event} To Employee`}
                      className="w-4 h-4 rounded border-slate-300"
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={rule.toManagers}
                      onChange={e => toggleField('toManagers', e.target.checked)}
                      aria-label={`${event} To Managers`}
                      className="w-4 h-4 rounded border-slate-300"
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={rule.toAdmins}
                      onChange={e => toggleField('toAdmins', e.target.checked)}
                      aria-label={`${event} To Admins`}
                      className="w-4 h-4 rounded border-slate-300"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Recent Notifications Log */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 font-bold text-xs uppercase tracking-wider text-slate-700">
          Recent Notifications Log ({logs.length})
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-xs text-left">
            <thead className="bg-white text-slate-500 font-semibold">
              <tr>
                <th className="px-4 py-2.5">Time</th>
                <th className="px-4 py-2.5">Event</th>
                <th className="px-4 py-2.5">Employee</th>
                <th className="px-4 py-2.5">Recipients</th>
                <th className="px-4 py-2.5">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                    No notifications logged yet.
                  </td>
                </tr>
              ) : (
                logs.map(log => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono text-slate-600 whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 font-bold text-slate-900">{log.event}</td>
                    <td className="px-4 py-2.5 font-medium text-slate-800">{log.employeeName}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-600">
                      {log.recipients.join(', ')}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{log.details}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
