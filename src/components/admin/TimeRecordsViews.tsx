import React, { useState, useMemo } from 'react';
import {
  Plus,
  Upload,
  Search,
  Edit2,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  Lock,
  ArrowUpDown,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  AbsenceType,
  AdjustmentOperation,
  AdjustmentType,
  AppUser,
  Company,
  Department,
  RecordType,
  TimeRecord,
} from '../../types/timeclock';
import {
  createAbsenceEntries,
  createAdjustmentEntry,
  createWorkEntries,
  deleteTimeRecords,
  getTodayISO,
  importWorkEntriesFromRows,
  setRecordsApproval,
  updateTimeRecord,
} from '../../services/dataStore';
import {
  addDaysISO,
  EvaluatedRecord,
  evaluateRecordsWithOvertime,
  formatDateDisplay,
  formatDateISO,
  formatHours,
  formatTimeDisplay,
  getPayPeriodRange,
  getWeekStartDateStr,
  isRecordFullyApproved,
  listDatesInRange,
  summarizeEvaluatedRecords,
} from '../../services/calculations';

interface TimeRecordsViewsProps {
  company: Company;
  currentUser: AppUser;
  users: AppUser[]; // includes archived for history display
  activeUsers: AppUser[]; // non-archived, Active users for pickers
  departments: Department[];
  records: TimeRecord[];
  initialSearchTerm?: string;
  onRefresh: () => void;
}

const ABSENCE_TYPES: AbsenceType[] = [
  'Vacation',
  'Sick',
  'Personal',
  'Holiday',
  'Comp Time',
  'Unpaid Leave',
];

export default function TimeRecordsViews({
  company,
  currentUser,
  users,
  activeUsers,
  departments,
  records,
  initialSearchTerm = '',
  onRefresh,
}: TimeRecordsViewsProps) {
  const todayISO = getTodayISO();
  const currentPeriod = useMemo(
    () => getPayPeriodRange(company, todayISO, 0),
    [company, todayISO]
  );

  const [subView, setSubView] = useState<'list' | 'day'>('list');

  // Shared filters
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [fromDate, setFromDate] = useState(currentPeriod.startDate);
  const [toDate, setToDate] = useState(currentPeriod.endDate);
  const [quickDate, setQuickDate] = useState('This Pay Period');
  const [recordTypeFilter, setRecordTypeFilter] = useState<'ALL' | RecordType>('ALL');
  const [searchName, setSearchName] = useState(initialSearchTerm);
  const [groupByDate, setGroupByDate] = useState(false);
  const [sortAsc, setSortAsc] = useState(false);

  // Day view state
  const [selectedDayEmployeeId, setSelectedDayEmployeeId] = useState<string>(
    () => activeUsers.find(u => u.role === 'Employee')?.id || activeUsers[0]?.id || ''
  );
  const [daySearchTerm, setDaySearchTerm] = useState('');
  const [selectedDayRecordIds, setSelectedDayRecordIds] = useState<string[]>([]);

  // Feedback banner
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Dialogs: Add Entry, Add Absence, Add Adjustment, Edit Record, Import Excel
  const [showAddEntry, setShowAddEntry] = useState(false);
  const [entryDeptId, setEntryDeptId] = useState('ALL');
  const [entryDate, setEntryDate] = useState(todayISO);
  const [entryUserIds, setEntryUserIds] = useState<string[]>([]);
  const [entryTimeIn, setEntryTimeIn] = useState('09:00');
  const [entryTimeOut, setEntryTimeOut] = useState('17:00');
  const [entryWorkingNow, setEntryWorkingNow] = useState(false);
  const [entryComment, setEntryComment] = useState('');
  const [entryError, setEntryError] = useState('');

  const [showAddAbsence, setShowAddAbsence] = useState(false);
  const [absDeptId, setAbsDeptId] = useState('ALL');
  const [absDate, setAbsDate] = useState(todayISO);
  const [absUserIds, setAbsUserIds] = useState<string[]>([]);
  const [absType, setAbsType] = useState<AbsenceType>('Sick');
  const [absHours, setAbsHours] = useState('8.00');
  const [absIsPaid, setAbsIsPaid] = useState(true);
  const [absComment, setAbsComment] = useState('');
  const [absError, setAbsError] = useState('');

  const [showAddAdjustment, setShowAddAdjustment] = useState(false);
  const [adjUserId, setAdjUserId] = useState(activeUsers[0]?.id || '');
  const [adjDate, setAdjDate] = useState(todayISO);
  const [adjType, setAdjType] = useState<AdjustmentType>('Hours');
  const [adjOp, setAdjOp] = useState<AdjustmentOperation>('Addition');
  const [adjValue, setAdjValue] = useState('0.50');
  const [adjComment, setAdjComment] = useState('');
  const [adjError, setAdjError] = useState('');

  const [editingRecord, setEditingRecord] = useState<TimeRecord | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editTimeIn, setEditTimeIn] = useState('');
  const [editTimeOut, setEditTimeOut] = useState('');
  const [editWorkingNow, setEditWorkingNow] = useState(false);
  const [editAbsType, setEditAbsType] = useState<AbsenceType>('Sick');
  const [editAbsHours, setEditAbsHours] = useState('8.00');
  const [editAbsPaid, setEditAbsPaid] = useState(true);
  const [editAdjType, setEditAdjType] = useState<AdjustmentType>('Hours');
  const [editAdjOp, setEditAdjOp] = useState<AdjustmentOperation>('Addition');
  const [editAdjVal, setEditAdjVal] = useState('0.50');
  const [editComment, setEditComment] = useState('');
  const [editError, setEditError] = useState('');

  const [showImportModal, setShowImportModal] = useState(false);
  const [importReport, setImportReport] = useState<{
    importedCount: number;
    failedRows: Array<{ rowNumber: number; reason: string }>;
  } | null>(null);

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

  const applyQuickDate = (preset: string) => {
    setQuickDate(preset);
    if (preset === 'Today') {
      setFromDate(todayISO);
      setToDate(todayISO);
    } else if (preset === 'Yesterday') {
      const yest = addDaysISO(todayISO, -1);
      setFromDate(yest);
      setToDate(yest);
    } else if (preset === 'This Week') {
      const ws = getWeekStartDateStr(todayISO, company.weekStartDay);
      setFromDate(ws);
      setToDate(addDaysISO(ws, 6));
    } else if (preset === 'Last Week') {
      const ws = addDaysISO(getWeekStartDateStr(todayISO, company.weekStartDay), -7);
      setFromDate(ws);
      setToDate(addDaysISO(ws, 6));
    } else if (preset === 'This Pay Period') {
      const p = getPayPeriodRange(company, todayISO, 0);
      setFromDate(p.startDate);
      setToDate(p.endDate);
    } else if (preset === 'Last Pay Period') {
      const p = getPayPeriodRange(company, todayISO, -1);
      setFromDate(p.startDate);
      setToDate(p.endDate);
    }
  };

  // Filtered records for List View
  const filteredListRecords = useMemo(() => {
    return records
      .filter(r => r.requestStatus !== 'Pending' && r.requestStatus !== 'Denied')
      .filter(r => {
        if (fromDate && r.date < fromDate) return false;
        if (toDate && r.date > toDate) return false;
        if (recordTypeFilter !== 'ALL' && r.recordType !== recordTypeFilter) return false;
        const u = usersById[r.userId];
        if (deptFilter !== 'ALL' && u?.departmentId !== deptFilter) return false;
        if (searchName.trim()) {
          const term = searchName.trim().toLowerCase();
          const matchName = u?.fullName.toLowerCase().includes(term);
          const matchUser = u?.username.toLowerCase().includes(term);
          if (!matchName && !matchUser) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const cmp = a.date.localeCompare(b.date);
        if (cmp !== 0) return sortAsc ? cmp : -cmp;
        return (a.timeIn || '').localeCompare(b.timeIn || '');
      });
  }, [records, fromDate, toDate, recordTypeFilter, deptFilter, searchName, sortAsc, usersById]);

  const listSummary = useMemo(() => {
    const evals = filteredListRecords
      .map(r => evaluatedMap.get(r.id))
      .filter((x): x is EvaluatedRecord => Boolean(x));
    return summarizeEvaluatedRecords(evals);
  }, [filteredListRecords, evaluatedMap]);

  // Open Add Entry dialog (optionally pre-filled for Day View)
  const openAddEntryDialog = (prefillUserId?: string, prefillDate?: string) => {
    setEntryDeptId('ALL');
    setEntryDate(prefillDate || todayISO);
    setEntryUserIds(prefillUserId ? [prefillUserId] : []);
    setEntryTimeIn('09:00');
    setEntryTimeOut('17:00');
    setEntryWorkingNow(false);
    setEntryComment('');
    setEntryError('');
    setShowAddEntry(true);
  };

  const handleSaveEntry = (keepOpenForNext: boolean) => {
    setEntryError('');
    const res = createWorkEntries(company.id, {
      userIds: entryUserIds,
      date: entryDate,
      timeIn: entryTimeIn,
      timeOut: entryWorkingNow ? '' : entryTimeOut,
      workingNow: entryWorkingNow,
      comment: entryComment,
    });
    if (!res.ok) {
      setEntryError(res.error);
      return;
    }
    onRefresh();
    setBanner({
      type: 'success',
      text: `Created ${res.created.length} work record(s) for ${entryDate}.`,
    });
    if (keepOpenForNext) {
      setEntryDate(addDaysISO(entryDate, 1));
      setEntryComment('');
    } else {
      setShowAddEntry(false);
    }
  };

  const handleSaveAbsence = (e: React.FormEvent) => {
    e.preventDefault();
    setAbsError('');
    const res = createAbsenceEntries(company.id, {
      userIds: absUserIds,
      date: absDate,
      absenceType: absType,
      hours: parseFloat(absHours),
      isPaid: absIsPaid,
      comment: absComment,
    });
    if (!res.ok) {
      setAbsError(res.error);
      return;
    }
    onRefresh();
    setShowAddAbsence(false);
    setBanner({
      type: 'success',
      text: `Added ${absType} absence (${absHours} hrs) for ${res.created.length} employee(s).`,
    });
  };

  const handleSaveAdjustment = (e: React.FormEvent) => {
    e.preventDefault();
    setAdjError('');
    const res = createAdjustmentEntry(company.id, {
      userId: adjUserId,
      date: adjDate,
      adjustmentType: adjType,
      adjustmentOp: adjOp,
      value: parseFloat(adjValue),
      comment: adjComment,
    });
    if (!res.ok) {
      setAdjError(res.error);
      return;
    }
    onRefresh();
    setShowAddAdjustment(false);
    setBanner({
      type: 'success',
      text: `Added ${adjOp.toLowerCase()} adjustment (${adjValue} ${adjType}).`,
    });
  };

  const openEditModal = (rec: TimeRecord) => {
    if (isRecordFullyApproved(rec, company)) {
      setBanner({
        type: 'error',
        text: 'Fully approved records are locked — unapprove to edit.',
      });
      return;
    }
    setEditingRecord(rec);
    setEditDate(rec.date);
    setEditTimeIn(rec.timeIn || '09:00');
    setEditTimeOut(rec.timeOut || '17:00');
    setEditWorkingNow(Boolean(rec.workingNow));
    setEditAbsType(rec.absenceType || 'Sick');
    setEditAbsHours(String(rec.absenceHours ?? 8));
    setEditAbsPaid(rec.isPaid !== false);
    setEditAdjType(rec.adjustmentType || 'Hours');
    setEditAdjOp(rec.adjustmentOp || 'Addition');
    setEditAdjVal(String(rec.adjustmentValue ?? 0.5));
    setEditComment(rec.comment || '');
    setEditError('');
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRecord) return;
    setEditError('');

    const updates: Partial<TimeRecord> = {
      date: editDate,
      comment: editComment,
    };

    if (editingRecord.recordType === 'Work') {
      updates.timeIn = editTimeIn;
      updates.timeOut = editWorkingNow ? '' : editTimeOut;
      updates.workingNow = editWorkingNow;
    } else if (editingRecord.recordType === 'Absence') {
      updates.absenceType = editAbsType;
      updates.absenceHours = parseFloat(editAbsHours) || 0;
      updates.isPaid = editAbsPaid;
    } else if (editingRecord.recordType === 'Adjustment') {
      updates.adjustmentType = editAdjType;
      updates.adjustmentOp = editAdjOp;
      updates.adjustmentValue = parseFloat(editAdjVal) || 0;
    }

    const res = updateTimeRecord(company.id, editingRecord.id, updates);
    if (!res.ok) {
      setEditError(res.error);
      return;
    }
    setEditingRecord(null);
    onRefresh();
    setBanner({ type: 'success', text: 'Time record updated.' });
  };

  const handleDeleteSingle = (rec: TimeRecord) => {
    if (isRecordFullyApproved(rec, company)) {
      setBanner({
        type: 'error',
        text: 'Fully approved records are locked — unapprove to edit.',
      });
      return;
    }
    const res = deleteTimeRecords(company.id, [rec.id]);
    if (!res.ok) {
      setBanner({ type: 'error', text: res.error });
      return;
    }
    onRefresh();
    setBanner({ type: 'success', text: 'Record deleted.' });
  };

  // Excel/CSV File upload handler
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheetName];
      const jsonRows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { raw: false });

      const mapped = jsonRows.map(r => {
        const keys = Object.keys(r);
        const findVal = (target: string) => {
          const k = keys.find(key => key.trim().toLowerCase() === target);
          return k ? String(r[k] ?? '') : '';
        };
        return {
          name: findVal('name') || findVal('employee') || findVal('full name'),
          date: findVal('date'),
          in: findVal('in') || findVal('time in') || findVal('clock in'),
          out: findVal('out') || findVal('time out') || findVal('clock out'),
        };
      });

      const report = importWorkEntriesFromRows(company.id, mapped);
      setImportReport(report);
      onRefresh();
    } catch {
      setImportReport({
        importedCount: 0,
        failedRows: [
          {
            rowNumber: 1,
            reason: 'Could not read the uploaded file. Please upload a valid CSV or Excel (.xlsx) file with columns Name, Date, In, Out.',
          },
        ],
      });
    }
    e.target.value = '';
  };

  const runSampleImportTest = () => {
    const sampleRows = [
      { name: 'Emily Employee', date: '2026-10-21', in: '09:00', out: '17:30' },
      { name: 'David Driver', date: '2026-10-21', in: '08:30', out: '17:00' },
      { name: 'Emily Employee', date: '2026-10-22', in: '09:00', out: '17:30' },
      { name: 'Unknown Person', date: 'bad-date', in: '99:99', out: '17:00' },
    ];
    const report = importWorkEntriesFromRows(company.id, sampleRows);
    setImportReport(report);
    onRefresh();
  };

  // ==========================================================================
  // DAY VIEW HELPERS (Part D3)
  // ==========================================================================
  const dayViewEmployees = useMemo(() => {
    const list = activeUsers.filter(u => {
      if (!daySearchTerm.trim()) return true;
      const t = daySearchTerm.trim().toLowerCase();
      return (
        u.fullName.toLowerCase().includes(t) ||
        u.username.toLowerCase().includes(t) ||
        u.employeeNumber.toLowerCase().includes(t)
      );
    });
    return list.length > 0 ? list : activeUsers;
  }, [activeUsers, daySearchTerm]);

  const currentDayEmpIndex = useMemo(() => {
    const idx = dayViewEmployees.findIndex(u => u.id === selectedDayEmployeeId);
    return idx >= 0 ? idx : 0;
  }, [dayViewEmployees, selectedDayEmployeeId]);

  const currentDayEmployee = dayViewEmployees[currentDayEmpIndex] || activeUsers[0] || null;

  const dayViewWeeks = useMemo(() => {
    if (!currentDayEmployee) return [];
    const dates = listDatesInRange(fromDate, toDate);
    if (dates.length === 0) return [];

    // Group dates by weekStartDate
    const weekMap = new Map<string, string[]>();
    for (const d of dates) {
      const ws = getWeekStartDateStr(d, company.weekStartDay);
      const arr = weekMap.get(ws) || [];
      arr.push(d);
      weekMap.set(ws, arr);
    }

    const weeks: Array<{
      weekStart: string;
      days: Array<{
        date: string;
        records: EvaluatedRecord[];
      }>;
      weekSummary: ReturnType<typeof summarizeEvaluatedRecords>;
    }> = [];

    for (const [ws, weekDates] of weekMap.entries()) {
      const dayItems = weekDates.map(d => {
        const dayRecs = records
          .filter(
            r =>
              r.userId === currentDayEmployee.id &&
              r.date === d &&
              r.requestStatus !== 'Pending' &&
              r.requestStatus !== 'Denied'
          )
          .map(r => evaluatedMap.get(r.id))
          .filter((x): x is EvaluatedRecord => Boolean(x));
        return { date: d, records: dayRecs };
      });

      const allWeekEvals = dayItems.flatMap(di => di.records);
      weeks.push({
        weekStart: ws,
        days: dayItems,
        weekSummary: summarizeEvaluatedRecords(allWeekEvals),
      });
    }

    return weeks;
  }, [currentDayEmployee, fromDate, toDate, company.weekStartDay, records, evaluatedMap]);

  const dayViewOverallSummary = useMemo(() => {
    const allEvals = dayViewWeeks.flatMap(w => w.days.flatMap(d => d.records));
    return summarizeEvaluatedRecords(allEvals);
  }, [dayViewWeeks]);

  const handleDayBulkApprove = (approve: boolean) => {
    if (selectedDayRecordIds.length === 0) return;
    setRecordsApproval(company.id, selectedDayRecordIds, {
      approvedByManager: approve,
      ...(approve ? {} : { approvedByEmployee: false }),
    });
    setSelectedDayRecordIds([]);
    onRefresh();
    setBanner({
      type: 'success',
      text: approve
        ? `Approved ${selectedDayRecordIds.length} selected record(s).`
        : `Unapproved ${selectedDayRecordIds.length} selected record(s).`,
    });
  };

  const handleDayBulkDelete = () => {
    if (selectedDayRecordIds.length === 0) return;
    const res = deleteTimeRecords(company.id, selectedDayRecordIds);
    if (!res.ok) {
      setBanner({ type: 'error', text: res.error });
      return;
    }
    setSelectedDayRecordIds([]);
    onRefresh();
    setBanner({ type: 'success', text: `Deleted ${res.deletedCount} record(s).` });
  };

  const renderApprovedStatus = (rec: TimeRecord) => {
    if (company.approvalMode === 'Off') return <span className="text-slate-400">—</span>;
    const mgr = rec.approvedByManager ? '✓ manager' : '— manager';
    if (company.approvalMode === 'Manager only') {
      return (
        <span className={rec.approvedByManager ? 'text-emerald-700 font-semibold' : 'text-slate-400'}>
          {rec.approvedByManager ? '✓ manager' : '—'}
        </span>
      );
    }
    const emp = rec.approvedByEmployee ? '✓ employee' : '— employee';
    if (!rec.approvedByManager && !rec.approvedByEmployee) {
      return <span className="text-slate-400">—</span>;
    }
    return (
      <span className="text-xs font-medium text-slate-700">
        <span className={rec.approvedByManager ? 'text-emerald-700 font-semibold' : 'text-slate-400'}>
          {mgr}
        </span>{' '}
        /{' '}
        <span className={rec.approvedByEmployee ? 'text-emerald-700 font-semibold' : 'text-slate-400'}>
          {emp}
        </span>
      </span>
    );
  };

  return (
    <div className="space-y-5">
      {/* Sub-navigation tabs: List View | Day View */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSubView('list')}
            className={`px-4 py-2 text-xs sm:text-sm font-bold rounded-lg transition-colors whitespace-nowrap ${
              subView === 'list'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            List View
          </button>
          <button
            type="button"
            onClick={() => setSubView('day')}
            className={`px-4 py-2 text-xs sm:text-sm font-bold rounded-lg transition-colors whitespace-nowrap ${
              subView === 'day'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Day View
          </button>
        </div>

        {/* Action buttons above table */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => openAddEntryDialog()}
            className="px-3 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Entry</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setAbsUserIds([]);
              setAbsDate(todayISO);
              setAbsType('Sick');
              setAbsHours('8.00');
              setAbsIsPaid(true);
              setAbsComment('');
              setAbsError('');
              setShowAddAbsence(true);
            }}
            className="px-3 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Absence</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setAdjUserId(activeUsers[0]?.id || '');
              setAdjDate(todayISO);
              setAdjType('Hours');
              setAdjOp('Addition');
              setAdjValue('0.50');
              setAdjComment('');
              setAdjError('');
              setShowAddAdjustment(true);
            }}
            className="px-3 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Adjustment</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setImportReport(null);
              setShowImportModal(true);
            }}
            className="px-3 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import Excel</span>
          </button>
        </div>
      </div>

      {banner && (
        <div
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

      {/* Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
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
              Quick Dates
            </label>
            <select
              value={quickDate}
              onChange={e => applyQuickDate(e.target.value)}
              className="w-full min-h-[38px] px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            >
              {[
                'Today',
                'Yesterday',
                'This Week',
                'Last Week',
                'This Pay Period',
                'Last Pay Period',
              ].map(q => (
                <option key={q} value={q}>
                  {q}
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
              className="w-full min-h-[38px] px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
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
              className="w-full min-h-[38px] px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            />
          </div>

          {subView === 'list' && (
            <>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                  Record Type
                </label>
                <select
                  value={recordTypeFilter}
                  onChange={e => setRecordTypeFilter(e.target.value as 'ALL' | RecordType)}
                  className="w-full min-h-[38px] px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="ALL">All</option>
                  <option value="Work">Work</option>
                  <option value="Absence">Absence</option>
                  <option value="Adjustment">Adjustment</option>
                </select>
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
                    className="w-full min-h-[38px] pl-8 pr-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  />
                </div>
              </div>
            </>
          )}
        </div>

        {subView === 'list' && (
          <div className="flex items-center justify-between pt-2 border-t border-slate-100">
            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={groupByDate}
                onChange={e => setGroupByDate(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-slate-900"
              />
              <span>Group by Date</span>
            </label>
            <span className="text-xs text-slate-500">
              Showing {filteredListRecords.length} record(s)
            </span>
          </div>
        )}
      </div>

      {/* =====================================================================
          SUB-VIEW 1: LIST VIEW (Part D2)
         ===================================================================== */}
      {subView === 'list' && (
        <>
          {/* Summary Strip above table: Paid Hours, Unpaid Hours, Total Hours */}
          <div className="grid grid-cols-3 gap-4 bg-white border border-slate-200 rounded-xl p-4">
            <div>
              <div className="text-xs font-medium text-slate-500">Paid Hours</div>
              <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                {formatHours(listSummary.paidHours, company.timeTotalsFormat)}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500">Unpaid Hours</div>
              <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                {formatHours(listSummary.unpaidHours, company.timeTotalsFormat)}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500">Total Hours</div>
              <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                {formatHours(listSummary.totalHours, company.timeTotalsFormat)}
              </div>
            </div>
          </div>

          {/* List View Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider">
                <tr>
                  <th className="px-3 py-3 w-12">#</th>
                  <th className="px-3 py-3">Full Name</th>
                  <th className="px-3 py-3">
                    <button
                      type="button"
                      onClick={() => setSortAsc(!sortAsc)}
                      className="inline-flex items-center gap-1 hover:text-slate-900"
                    >
                      <span>Date</span>
                      <ArrowUpDown className="w-3.5 h-3.5" />
                    </button>
                  </th>
                  <th className="px-3 py-3">In</th>
                  <th className="px-3 py-3">Out</th>
                  <th className="px-3 py-3 text-right">Hours</th>
                  <th className="px-3 py-3">Type</th>
                  {company.approvalMode !== 'Off' && <th className="px-3 py-3">Approved</th>}
                  <th className="px-3 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredListRecords.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                      No time records match the current filters.
                    </td>
                  </tr>
                ) : (
                  filteredListRecords.map((rec, idx) => {
                    const u = usersById[rec.userId];
                    const ev = evaluatedMap.get(rec.id);
                    const locked = isRecordFullyApproved(rec, company);
                    const prevDate = idx > 0 ? filteredListRecords[idx - 1].date : null;
                    const showDateGroupHeader = groupByDate && rec.date !== prevDate;

                    let hoursDisplay = '—';
                    if (rec.recordType === 'Work') {
                      hoursDisplay =
                        rec.workingNow || !rec.timeOut
                          ? '—'
                          : formatHours(ev?.workedHours || 0, company.timeTotalsFormat);
                    } else if (rec.recordType === 'Absence') {
                      hoursDisplay = formatHours(rec.absenceHours || 0, company.timeTotalsFormat);
                    } else if (rec.recordType === 'Adjustment') {
                      if (rec.adjustmentType === 'Amount') {
                        hoursDisplay = `${rec.adjustmentOp === 'Deduction' ? '-' : '+'}${
                          company.currencySymbol
                        }${(rec.adjustmentValue || 0).toFixed(2)}`;
                      } else {
                        const signed =
                          rec.adjustmentOp === 'Deduction'
                            ? -(rec.adjustmentValue || 0)
                            : rec.adjustmentValue || 0;
                        hoursDisplay = `${signed >= 0 ? '+' : ''}${formatHours(
                          signed,
                          company.timeTotalsFormat
                        )}`;
                      }
                    }

                    let typeDisplay = rec.recordType as string;
                    if (rec.recordType === 'Absence') {
                      typeDisplay = `Absence (${rec.absenceType}${rec.isPaid ? ', Paid' : ', Unpaid'})`;
                    } else if (rec.recordType === 'Adjustment') {
                      typeDisplay = `Adjustment (${rec.adjustmentOp})`;
                    }

                    return (
                      <React.Fragment key={rec.id}>
                        {showDateGroupHeader && (
                          <tr className="bg-slate-100/80">
                            <td colSpan={9} className="px-3 py-2 font-bold text-slate-800">
                              Date: {formatDateDisplay(rec.date, company.dateFormat)} ({rec.date})
                            </td>
                          </tr>
                        )}
                        <tr className="hover:bg-slate-50">
                          <td className="px-3 py-2.5 font-mono text-slate-500">{idx + 1}</td>
                          <td className="px-3 py-2.5 font-semibold text-slate-900">
                            {u?.fullName || 'Unknown'}
                            {u?.archived && (
                              <span className="ml-1.5 text-[11px] font-normal text-slate-400">
                                (Archived)
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 font-mono tabular-nums text-slate-700">
                            {formatDateDisplay(rec.date, company.dateFormat)}
                          </td>
                          <td className="px-3 py-2.5 font-mono tabular-nums text-slate-800">
                            {rec.recordType === 'Work'
                              ? formatTimeDisplay(rec.timeIn, company.timeFormat)
                              : '—'}
                            {rec.lateIn && (
                              <span className="ml-1.5 text-[11px] font-bold text-amber-700">
                                · Late IN
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 font-mono tabular-nums text-slate-800">
                            {rec.recordType === 'Work'
                              ? rec.workingNow || !rec.timeOut
                                ? 'Working Now'
                                : formatTimeDisplay(rec.timeOut, company.timeFormat)
                              : '—'}
                            {rec.earlyOut && (
                              <span className="ml-1.5 text-[11px] font-bold text-amber-700">
                                · Early OUT
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums font-bold text-slate-900">
                            {hoursDisplay}
                          </td>
                          <td className="px-3 py-2.5 text-slate-700">
                            <div>{typeDisplay}</div>
                            {rec.comment && (
                              <div className="text-[11px] text-slate-400 truncate max-w-[180px]">
                                {rec.comment}
                              </div>
                            )}
                          </td>
                          {company.approvalMode !== 'Off' && (
                            <td className="px-3 py-2.5">{renderApprovedStatus(rec)}</td>
                          )}
                          <td className="px-3 py-2.5 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                disabled={locked}
                                onClick={() => openEditModal(rec)}
                                title={
                                  locked
                                    ? 'Fully approved records are locked — unapprove to edit.'
                                    : 'Edit record'
                                }
                                className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                {locked ? (
                                  <Lock className="w-3.5 h-3.5 text-slate-400" />
                                ) : (
                                  <Edit2 className="w-3.5 h-3.5" />
                                )}
                              </button>
                              <button
                                type="button"
                                disabled={locked}
                                onClick={() => handleDeleteSingle(rec)}
                                title={
                                  locked
                                    ? 'Fully approved records are locked — unapprove to edit.'
                                    : 'Delete record'
                                }
                                className="p-1.5 text-red-600 hover:bg-red-50 rounded disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* =====================================================================
          SUB-VIEW 2: DAY VIEW (Part D3)
         ===================================================================== */}
      {subView === 'day' && (
        <div className="space-y-4">
          {/* Employee Prev/Next & Search + Bulk Actions */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={currentDayEmpIndex <= 0}
                onClick={() => {
                  const prev = dayViewEmployees[currentDayEmpIndex - 1];
                  if (prev) setSelectedDayEmployeeId(prev.id);
                }}
                className="p-2 border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-40"
                title="Previous Employee"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <select
                value={currentDayEmployee?.id || ''}
                onChange={e => setSelectedDayEmployeeId(e.target.value)}
                className="min-h-[38px] px-3 py-1.5 text-sm font-bold border border-slate-300 rounded-lg bg-white text-slate-900"
              >
                {dayViewEmployees.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.fullName} ({u.username})
                  </option>
                ))}
              </select>

              <button
                type="button"
                disabled={currentDayEmpIndex >= dayViewEmployees.length - 1}
                onClick={() => {
                  const next = dayViewEmployees[currentDayEmpIndex + 1];
                  if (next) setSelectedDayEmployeeId(next.id);
                }}
                className="p-2 border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-40"
                title="Next Employee"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={daySearchTerm}
                  onChange={e => setDaySearchTerm(e.target.value)}
                  placeholder="Filter employee..."
                  className="min-h-[38px] pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {company.approvalMode !== 'Off' && (
                <>
                  <button
                    type="button"
                    onClick={() => handleDayBulkApprove(true)}
                    disabled={selectedDayRecordIds.length === 0}
                    className="px-3 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-40 whitespace-nowrap"
                  >
                    Approve Selected
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDayBulkApprove(false)}
                    disabled={selectedDayRecordIds.length === 0}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-40 whitespace-nowrap"
                  >
                    Unapprove Selected
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={handleDayBulkDelete}
                disabled={selectedDayRecordIds.length === 0}
                className="px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 rounded-lg disabled:opacity-40 whitespace-nowrap"
              >
                Delete Selected
              </button>
            </div>
          </div>

          {/* Weekly Grids for the Selected Employee */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider">
                <tr>
                  <th className="px-3 py-3 w-10"></th>
                  <th className="px-3 py-3 text-left">Date</th>
                  <th className="px-3 py-3 text-left">In</th>
                  <th className="px-3 py-3 text-left">Out</th>
                  <th className="px-3 py-3 text-right">Reg</th>
                  <th className="px-3 py-3 text-right">OT</th>
                  <th className="px-3 py-3 text-right">DT</th>
                  <th className="px-3 py-3 text-right">Absence</th>
                  <th className="px-3 py-3 text-right">Paid</th>
                  <th className="px-3 py-3 text-right">Unpaid</th>
                  <th className="px-3 py-3 text-right">Total</th>
                  <th className="px-3 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
                {dayViewWeeks.map(week => (
                  <React.Fragment key={week.weekStart}>
                    {week.days.map(dayItem => {
                      if (dayItem.records.length === 0) {
                        return (
                          <tr key={dayItem.date} className="hover:bg-slate-50 text-slate-400">
                            <td className="px-3 py-2"></td>
                            <td className="px-3 py-2 text-slate-700 font-sans font-medium">
                              {formatDateDisplay(dayItem.date, company.dateFormat)}{' '}
                              <button
                                type="button"
                                onClick={() =>
                                  currentDayEmployee &&
                                  openAddEntryDialog(currentDayEmployee.id, dayItem.date)
                                }
                                className="ml-2 text-indigo-600 hover:underline font-semibold text-[11px]"
                              >
                                add
                              </button>
                            </td>
                            <td className="px-3 py-2">—</td>
                            <td className="px-3 py-2">—</td>
                            <td className="px-3 py-2 text-right">
                              {formatHours(0, company.timeTotalsFormat)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {formatHours(0, company.timeTotalsFormat)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {formatHours(0, company.timeTotalsFormat)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {formatHours(0, company.timeTotalsFormat)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {formatHours(0, company.timeTotalsFormat)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {formatHours(0, company.timeTotalsFormat)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {formatHours(0, company.timeTotalsFormat)}
                            </td>
                            <td className="px-3 py-2 text-right"></td>
                          </tr>
                        );
                      }

                      return dayItem.records.map((ev, rIdx) => {
                        const rec = ev.record;
                        const checked = selectedDayRecordIds.includes(rec.id);
                        const locked = isRecordFullyApproved(rec, company);
                        const absTotal = ev.paidAbsenceHours + ev.unpaidAbsenceHours;

                        return (
                          <tr key={rec.id} className="hover:bg-slate-50 text-slate-800">
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={e => {
                                  if (e.target.checked) {
                                    setSelectedDayRecordIds(prev => [...prev, rec.id]);
                                  } else {
                                    setSelectedDayRecordIds(prev =>
                                      prev.filter(id => id !== rec.id)
                                    );
                                  }
                                }}
                                className="w-4 h-4 rounded border-slate-300"
                              />
                            </td>
                            <td className="px-3 py-2 font-sans font-medium text-slate-900">
                              {formatDateDisplay(dayItem.date, company.dateFormat)}
                              {rIdx === 0 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    currentDayEmployee &&
                                    openAddEntryDialog(currentDayEmployee.id, dayItem.date)
                                  }
                                  className="ml-2 text-indigo-600 hover:underline font-semibold text-[11px]"
                                >
                                  add
                                </button>
                              )}
                              {rec.recordType !== 'Work' && (
                                <span className="ml-1.5 text-[11px] text-slate-500">
                                  ({rec.recordType === 'Absence' ? rec.absenceType : 'Adjustment'})
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {rec.recordType === 'Work'
                                ? formatTimeDisplay(rec.timeIn, company.timeFormat)
                                : '—'}
                            </td>
                            <td className="px-3 py-2">
                              {rec.recordType === 'Work'
                                ? rec.workingNow || !rec.timeOut
                                  ? 'Working Now'
                                  : formatTimeDisplay(rec.timeOut, company.timeFormat)
                                : '—'}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {formatHours(ev.regHours, company.timeTotalsFormat)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {formatHours(ev.otHours, company.timeTotalsFormat)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {formatHours(ev.dtHours, company.timeTotalsFormat)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {formatHours(absTotal, company.timeTotalsFormat)}
                            </td>
                            <td className="px-3 py-2 text-right font-bold text-slate-900">
                              {formatHours(ev.paidHours, company.timeTotalsFormat)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {formatHours(ev.unpaidHours, company.timeTotalsFormat)}
                            </td>
                            <td className="px-3 py-2 text-right font-bold text-slate-900">
                              {formatHours(ev.totalHours, company.timeTotalsFormat)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={locked}
                                  onClick={() => openEditModal(rec)}
                                  title={
                                    locked
                                      ? 'Fully approved records are locked — unapprove to edit.'
                                      : 'Edit record'
                                  }
                                  className="p-1 text-slate-600 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  {locked ? (
                                    <Lock className="w-3.5 h-3.5 text-slate-400" />
                                  ) : (
                                    <Edit2 className="w-3.5 h-3.5" />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  disabled={locked}
                                  onClick={() => handleDeleteSingle(rec)}
                                  title={
                                    locked
                                      ? 'Fully approved records are locked — unapprove to edit.'
                                      : 'Delete record'
                                  }
                                  className="p-1 text-red-600 hover:text-red-800 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      });
                    })}

                    {/* Blue Total Row under each week (Part D3) */}
                    <tr className="bg-blue-50 text-blue-950 font-bold border-t border-b border-blue-200">
                      <td className="px-3 py-2.5"></td>
                      <td colSpan={3} className="px-3 py-2.5 font-sans">
                        Week Total (starting {formatDateDisplay(week.weekStart, company.dateFormat)})
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {formatHours(week.weekSummary.regHours, company.timeTotalsFormat)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {formatHours(week.weekSummary.otHours, company.timeTotalsFormat)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {formatHours(week.weekSummary.dtHours, company.timeTotalsFormat)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {formatHours(
                          week.weekSummary.paidAbsenceHours + week.weekSummary.unpaidAbsenceHours,
                          company.timeTotalsFormat
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {formatHours(week.weekSummary.paidHours, company.timeTotalsFormat)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {formatHours(week.weekSummary.unpaidHours, company.timeTotalsFormat)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {formatHours(week.weekSummary.totalHours, company.timeTotalsFormat)}
                      </td>
                      <td className="px-3 py-2.5"></td>
                    </tr>
                  </React.Fragment>
                ))}

                {/* Period Total Row for Day View */}
                <tr className="bg-slate-900 text-white font-bold">
                  <td className="px-3 py-3"></td>
                  <td colSpan={3} className="px-3 py-3 font-sans">
                    Selected Range Total ({currentDayEmployee?.fullName})
                  </td>
                  <td className="px-3 py-3 text-right">
                    {formatHours(dayViewOverallSummary.regHours, company.timeTotalsFormat)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {formatHours(dayViewOverallSummary.otHours, company.timeTotalsFormat)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {formatHours(dayViewOverallSummary.dtHours, company.timeTotalsFormat)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {formatHours(
                      dayViewOverallSummary.paidAbsenceHours +
                        dayViewOverallSummary.unpaidAbsenceHours,
                      company.timeTotalsFormat
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {formatHours(dayViewOverallSummary.paidHours, company.timeTotalsFormat)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {formatHours(dayViewOverallSummary.unpaidHours, company.timeTotalsFormat)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {formatHours(dayViewOverallSummary.totalHours, company.timeTotalsFormat)}
                  </td>
                  <td className="px-3 py-3"></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =====================================================================
          DIALOG 1: ADD ENTRY (Part D2)
         ===================================================================== */}
      {showAddEntry && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowAddEntry(false)}
        >
          <div
            className="bg-white rounded-xl max-w-lg w-full p-6 border border-slate-200 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Add Work Entry</h3>
              <button onClick={() => setShowAddEntry(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {entryError && (
              <div className="p-3 bg-red-50 border border-red-200 text-xs text-red-700 rounded-lg">
                {entryError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Department
                </label>
                <select
                  value={entryDeptId}
                  onChange={e => setEntryDeptId(e.target.value)}
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

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Date</label>
                <input
                  type="date"
                  value={entryDate}
                  onChange={e => setEntryDate(e.target.value)}
                  className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            {/* Employee Checklist (multi-select, active non-archived only) */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Employees (select one or more)
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const visible = activeUsers.filter(
                      u => entryDeptId === 'ALL' || u.departmentId === entryDeptId
                    );
                    if (entryUserIds.length === visible.length) {
                      setEntryUserIds([]);
                    } else {
                      setEntryUserIds(visible.map(u => u.id));
                    }
                  }}
                  className="text-[11px] font-semibold text-indigo-600 hover:underline"
                >
                  Select / Deselect All
                </button>
              </div>
              <div className="max-h-36 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1 bg-slate-50">
                {activeUsers
                  .filter(u => entryDeptId === 'ALL' || u.departmentId === entryDeptId)
                  .map(u => (
                    <label
                      key={u.id}
                      className="flex items-center gap-2 text-xs text-slate-800 px-2 py-1 rounded hover:bg-white cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={entryUserIds.includes(u.id)}
                        onChange={e => {
                          if (e.target.checked) {
                            setEntryUserIds(prev => [...prev, u.id]);
                          } else {
                            setEntryUserIds(prev => prev.filter(id => id !== u.id));
                          }
                        }}
                        className="w-4 h-4 rounded border-slate-300"
                      />
                      <span className="font-medium">{u.fullName}</span>
                      <span className="text-slate-400">({u.username})</span>
                    </label>
                  ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Clock In</label>
                <input
                  type="time"
                  value={entryTimeIn}
                  onChange={e => setEntryTimeIn(e.target.value)}
                  className="w-full min-h-[38px] px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Clock Out</label>
                <input
                  type="time"
                  value={entryTimeOut}
                  disabled={entryWorkingNow}
                  onChange={e => setEntryTimeOut(e.target.value)}
                  className="w-full min-h-[38px] px-3 py-1.5 text-sm border border-slate-300 rounded-lg disabled:opacity-50"
                />
              </div>
            </div>

            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={entryWorkingNow}
                onChange={e => setEntryWorkingNow(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300"
              />
              <span>Working Now (leave Out open)</span>
            </label>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Comment</label>
              <input
                type="text"
                value={entryComment}
                onChange={e => setEntryComment(e.target.value)}
                placeholder="Optional shift comment..."
                className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowAddEntry(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleSaveEntry(true)}
                className="px-4 py-2 text-xs font-semibold text-slate-900 bg-slate-200 hover:bg-slate-300 rounded-lg"
              >
                Add &amp; Next
              </button>
              <button
                type="button"
                onClick={() => handleSaveEntry(false)}
                className="px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          DIALOG 2: ADD ABSENCE (Part D2)
         ===================================================================== */}
      {showAddAbsence && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowAddAbsence(false)}
        >
          <div
            className="bg-white rounded-xl max-w-lg w-full p-6 border border-slate-200 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Add Absence</h3>
              <button onClick={() => setShowAddAbsence(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {absError && (
              <div className="p-3 bg-red-50 border border-red-200 text-xs text-red-700 rounded-lg">
                {absError}
              </div>
            )}

            <form onSubmit={handleSaveAbsence} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Department
                  </label>
                  <select
                    value={absDeptId}
                    onChange={e => setAbsDeptId(e.target.value)}
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
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Date</label>
                  <input
                    type="date"
                    value={absDate}
                    onChange={e => setAbsDate(e.target.value)}
                    className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Employee Checklist
                </label>
                <div className="max-h-36 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1 bg-slate-50">
                  {activeUsers
                    .filter(u => absDeptId === 'ALL' || u.departmentId === absDeptId)
                    .map(u => (
                      <label
                        key={u.id}
                        className="flex items-center gap-2 text-xs text-slate-800 px-2 py-1 rounded hover:bg-white cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={absUserIds.includes(u.id)}
                          onChange={e => {
                            if (e.target.checked) {
                              setAbsUserIds(prev => [...prev, u.id]);
                            } else {
                              setAbsUserIds(prev => prev.filter(id => id !== u.id));
                            }
                          }}
                          className="w-4 h-4 rounded border-slate-300"
                        />
                        <span className="font-medium">{u.fullName}</span>
                      </label>
                    ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Absence Type
                  </label>
                  <select
                    value={absType}
                    onChange={e => {
                      const nextType = e.target.value as AbsenceType;
                      setAbsType(nextType);
                      setAbsIsPaid(nextType !== 'Unpaid Leave');
                    }}
                    className="w-full min-h-[38px] px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    {ABSENCE_TYPES.map(t => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Hours</label>
                  <input
                    type="number"
                    step="0.25"
                    value={absHours}
                    onChange={e => setAbsHours(e.target.value)}
                    className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Paid / Unpaid
                  </label>
                  <select
                    value={absIsPaid ? 'Paid' : 'Unpaid'}
                    onChange={e => setAbsIsPaid(e.target.value === 'Paid')}
                    className="w-full min-h-[38px] px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Paid">Paid</option>
                    <option value="Unpaid">Unpaid</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Comment</label>
                <input
                  type="text"
                  value={absComment}
                  onChange={e => setAbsComment(e.target.value)}
                  placeholder="Optional comment..."
                  className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddAbsence(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
                >
                  Add
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          DIALOG 3: ADD ADJUSTMENT (Part D2)
         ===================================================================== */}
      {showAddAdjustment && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowAddAdjustment(false)}
        >
          <div
            className="bg-white rounded-xl max-w-md w-full p-6 border border-slate-200 shadow-xl space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Add Adjustment</h3>
              <button onClick={() => setShowAddAdjustment(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {adjError && (
              <div className="p-3 bg-red-50 border border-red-200 text-xs text-red-700 rounded-lg">
                {adjError}
              </div>
            )}

            <form onSubmit={handleSaveAdjustment} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Employee</label>
                <select
                  value={adjUserId}
                  onChange={e => setAdjUserId(e.target.value)}
                  className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  {activeUsers.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.fullName} ({u.username})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Date</label>
                <input
                  type="date"
                  value={adjDate}
                  onChange={e => setAdjDate(e.target.value)}
                  className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Type</label>
                  <select
                    value={adjType}
                    onChange={e => setAdjType(e.target.value as AdjustmentType)}
                    className="w-full min-h-[38px] px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Hours">Hours</option>
                    <option value="Amount">Amount</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Operation
                  </label>
                  <select
                    value={adjOp}
                    onChange={e => setAdjOp(e.target.value as AdjustmentOperation)}
                    className="w-full min-h-[38px] px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Addition">Addition</option>
                    <option value="Deduction">Deduction</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Value</label>
                  <input
                    type="number"
                    step="0.01"
                    value={adjValue}
                    onChange={e => setAdjValue(e.target.value)}
                    className="w-full min-h-[38px] px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Comment</label>
                <input
                  type="text"
                  value={adjComment}
                  onChange={e => setAdjComment(e.target.value)}
                  placeholder="Reason for adjustment..."
                  className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddAdjustment(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
                >
                  Add
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          DIALOG 4: EDIT RECORD
         ===================================================================== */}
      {editingRecord && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setEditingRecord(null)}
        >
          <div
            className="bg-white rounded-xl max-w-md w-full p-6 border border-slate-200 shadow-xl space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                Edit {editingRecord.recordType} Record
              </h3>
              <button onClick={() => setEditingRecord(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {editError && (
              <div className="p-3 bg-red-50 border border-red-200 text-xs text-red-700 rounded-lg">
                {editError}
              </div>
            )}

            <form onSubmit={handleSaveEdit} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Date</label>
                <input
                  type="date"
                  value={editDate}
                  onChange={e => setEditDate(e.target.value)}
                  className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                />
              </div>

              {editingRecord.recordType === 'Work' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Clock In
                      </label>
                      <input
                        type="time"
                        value={editTimeIn}
                        onChange={e => setEditTimeIn(e.target.value)}
                        className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Clock Out
                      </label>
                      <input
                        type="time"
                        value={editTimeOut}
                        disabled={editWorkingNow}
                        onChange={e => setEditTimeOut(e.target.value)}
                        className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg disabled:opacity-50"
                      />
                    </div>
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={editWorkingNow}
                      onChange={e => setEditWorkingNow(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300"
                    />
                    <span>Working Now</span>
                  </label>
                </>
              )}

              {editingRecord.recordType === 'Absence' && (
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Type</label>
                    <select
                      value={editAbsType}
                      onChange={e => setEditAbsType(e.target.value as AbsenceType)}
                      className="w-full min-h-[38px] px-2 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                    >
                      {ABSENCE_TYPES.map(t => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Hours</label>
                    <input
                      type="number"
                      step="0.25"
                      value={editAbsHours}
                      onChange={e => setEditAbsHours(e.target.value)}
                      className="w-full min-h-[38px] px-2 py-1.5 text-xs border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Paid</label>
                    <select
                      value={editAbsPaid ? 'Paid' : 'Unpaid'}
                      onChange={e => setEditAbsPaid(e.target.value === 'Paid')}
                      className="w-full min-h-[38px] px-2 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="Paid">Paid</option>
                      <option value="Unpaid">Unpaid</option>
                    </select>
                  </div>
                </div>
              )}

              {editingRecord.recordType === 'Adjustment' && (
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Type</label>
                    <select
                      value={editAdjType}
                      onChange={e => setEditAdjType(e.target.value as AdjustmentType)}
                      className="w-full min-h-[38px] px-2 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="Hours">Hours</option>
                      <option value="Amount">Amount</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Op</label>
                    <select
                      value={editAdjOp}
                      onChange={e => setEditAdjOp(e.target.value as AdjustmentOperation)}
                      className="w-full min-h-[38px] px-2 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="Addition">Addition</option>
                      <option value="Deduction">Deduction</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Value</label>
                    <input
                      type="number"
                      step="0.01"
                      value={editAdjVal}
                      onChange={e => setEditAdjVal(e.target.value)}
                      className="w-full min-h-[38px] px-2 py-1.5 text-xs border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Comment</label>
                <input
                  type="text"
                  value={editComment}
                  onChange={e => setEditComment(e.target.value)}
                  className="w-full min-h-[38px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingRecord(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold text-white bg-slate-900 rounded-lg"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          DIALOG 5: IMPORT EXCEL / CSV (Part D2 & K)
         ===================================================================== */}
      {showImportModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowImportModal(false)}
        >
          <div
            className="bg-white rounded-xl max-w-lg w-full p-6 border border-slate-200 shadow-xl space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                Import Work Entries (Excel / CSV)
              </h3>
              <button onClick={() => setShowImportModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-600">
              Upload a CSV or Excel (<code>.xlsx</code>) file with columns:{' '}
              <strong>Name, Date, In, Out</strong>. Valid rows are imported immediately; any rows
              with errors will be listed below in plain language.
            </p>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <label className="flex-1 px-4 py-2.5 border border-dashed border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer text-center">
                <span>Choose CSV / Excel File...</span>
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
              <button
                type="button"
                onClick={runSampleImportTest}
                className="px-3.5 py-2.5 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg whitespace-nowrap"
              >
                Test Import (3 Valid + 1 Bad Row)
              </button>
            </div>

            {importReport && (
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2 text-xs">
                <div className="font-bold text-slate-900">
                  Import Report: {importReport.importedCount} row(s) imported successfully,{' '}
                  {importReport.failedRows.length} row(s) skipped.
                </div>
                {importReport.failedRows.length > 0 && (
                  <ul className="space-y-1 text-red-700 list-disc pl-4">
                    {importReport.failedRows.map((err, i) => (
                      <li key={i}>
                        <strong>Row {err.rowNumber}:</strong> {err.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
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
