import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import {
  Printer,
  Loader2,
  Clock,
  CheckCircle2,
  Utensils,
  Undo2,
  Redo2,
  PenTool,
  Type,
  LogIn,
  LogOut,
  Plus,
  Lock,
  ArrowLeft,
  X,
  AlertTriangle,
  Download,
  FileText,
  HelpCircle,
  Settings,
  DollarSign,
} from 'lucide-react';
import SignatureCanvas from 'react-signature-canvas';
import { AbsenceType, AppUser, Company, TimeRecord } from '../types/timeclock';
import { generateVectorTimesheetPDF, triggerPrintAndDownloadPDF } from '../services/pdfExport';
import {
  createAbsenceEntries,
  createWorkEntries,
  getTimeRecords,
  getTodayISO,
  setRecordsApproval,
  signOutSession,
  updateTimeRecord,
} from '../services/dataStore';
import {
  addDaysISO,
  evaluateRecordsWithOvertime,
  formatHours,
  getPayPeriodRange,
  isRecordFullyApproved,
  summarizeEvaluatedRecords,
} from '../services/calculations';
import {
  buildHolidayMapForDates,
  fetchPublicHolidaysFromAPI,
  getCustomHolidays,
} from '../services/holidays';
import { Calendar } from 'lucide-react';

interface MyHoursScreenProps {
  user: AppUser;
  company: Company;
  onNavigate: (path: string) => void;
  onSignOut: () => void;
}

const ABSENCE_TYPES: AbsenceType[] = [
  'Vacation',
  'Sick',
  'Personal',
  'Holiday',
  'Comp Time',
  'Unpaid Leave',
];

export default function MyHoursScreen({
  user,
  company,
  onNavigate,
  onSignOut,
}: MyHoursScreenProps) {
  const todayISO = getTodayISO();
  const initialPeriod = useMemo(
    () => getPayPeriodRange(company, todayISO, 0),
    [company, todayISO]
  );

  const [periodStart, setPeriodStart] = useState(initialPeriod.startDate);
  const [refreshTick, setRefreshTick] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');

  // Request modals
  const [showEntryRequestModal, setShowEntryRequestModal] = useState(false);
  const [reqDate, setReqDate] = useState(todayISO);
  const [reqTimeIn, setReqTimeIn] = useState('09:00');
  const [reqTimeOut, setReqTimeOut] = useState('17:00');
  const [reqComment, setReqComment] = useState('');
  const [reqError, setReqError] = useState('');

  const [showAbsenceRequestModal, setShowAbsenceRequestModal] = useState(false);
  const [absDate, setAbsDate] = useState(todayISO);
  const [absType, setAbsType] = useState<AbsenceType>('Sick');
  const [absHours, setAbsHours] = useState('8.00');
  const [absComment, setAbsComment] = useState('');
  const [absError, setAbsError] = useState('');

  // Signature state (same as landing sheet)
  const [signatureMode, setSignatureMode] = useState<'draw' | 'type'>('draw');
  const [typedName, setTypedName] = useState(user.fullName);
  const [signature, setSignature] = useState('');
  const [sigDate, setSigDate] = useState(todayISO);
  const [canvasHistory, setCanvasHistory] = useState<any[]>([]);
  const [historyPointer, setHistoryPointer] = useState<number>(-1);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const sigCanvas = useRef<SignatureCanvas>(null);

  const signatureDateWarning = useMemo(() => {
    if (!sigDate || !sigDate.includes('-')) return null;
    const [y, m, d] = sigDate.split('-').map(Number);
    if (!y || !m || !d) return null;
    const selectedMidnight = new Date(y, m - 1, d);
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.round(
      (selectedMidnight.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (diffDays > 0) {
      return `Signature Date is set to a future date (${diffDays === 1 ? '1 day ahead' : `${diffDays} days ahead`}).`;
    }
    if (diffDays < -7) {
      return `Signature Date is more than 7 days in the past (${Math.abs(diffDays)} days ago).`;
    }
    return null;
  }, [sigDate]);

  // Keyboard navigation refs for desktop table time cells
  const TIME_COLUMNS = ['timeIn', 'lunchStart', 'lunchEnd', 'timeOut'] as const;
  type TimeColumnKey = (typeof TIME_COLUMNS)[number];
  const timeCellRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const handleTimeCellKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, rowIndex: number, colKey: TimeColumnKey, totalRows: number) => {
      const colIndex = TIME_COLUMNS.indexOf(colKey);
      if (colIndex === -1) return;

      let targetRow = rowIndex;
      let targetCol = colIndex;

      if (e.key === 'ArrowUp') {
        targetRow = rowIndex - 1;
      } else if (e.key === 'ArrowDown') {
        targetRow = rowIndex + 1;
      } else if (e.key === 'ArrowLeft' && (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || !e.currentTarget.value)) {
        targetCol = colIndex - 1;
        if (targetCol < 0 && rowIndex > 0) {
          targetRow = rowIndex - 1;
          targetCol = TIME_COLUMNS.length - 1;
        }
      } else if (e.key === 'ArrowRight' && (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || !e.currentTarget.value)) {
        targetCol = colIndex + 1;
        if (targetCol >= TIME_COLUMNS.length && rowIndex < totalRows - 1) {
          targetRow = rowIndex + 1;
          targetCol = 0;
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        targetCol = e.key === 'ArrowLeft' ? colIndex - 1 : colIndex + 1;
        if (targetCol < 0 && rowIndex > 0) {
          targetRow = rowIndex - 1;
          targetCol = TIME_COLUMNS.length - 1;
        } else if (targetCol >= TIME_COLUMNS.length && rowIndex < totalRows - 1) {
          targetRow = rowIndex + 1;
          targetCol = 0;
        }
      } else {
        return;
      }

      if (targetRow < 0 || targetRow >= totalRows || targetCol < 0 || targetCol >= TIME_COLUMNS.length) {
        return;
      }

      const nextKey = `${targetRow}-${TIME_COLUMNS[targetCol]}`;
      const nextInput = timeCellRefs.current[nextKey];
      if (nextInput && !nextInput.disabled) {
        e.preventDefault();
        nextInput.focus();
        try {
          nextInput.select?.();
        } catch {
          // ignore select error on time inputs
        }
      }
    },
    []
  );

  const getWorkDayValidationWarning = useCallback((rec?: TimeRecord): string | null => {
    if (!rec) return null;
    const toMins = (t?: string) => {
      if (!t || !t.includes(':')) return null;
      const [h, m] = t.split(':').map(Number);
      if (isNaN(h) || isNaN(m)) return null;
      return h * 60 + m;
    };
    const inM = toMins(rec.timeIn);
    const outM = toMins(rec.timeOut);
    const lsM = toMins(rec.lunchStart);
    const leM = toMins(rec.lunchEnd);

    if (inM !== null && outM !== null && outM <= inM) {
      return 'Time Out must be later than Time In';
    }
    if ((lsM !== null && leM === null) || (lsM === null && leM !== null)) {
      return 'Enter both Lunch Start and Lunch End';
    }
    if (lsM !== null && leM !== null) {
      if (leM <= lsM) {
        return 'Lunch End must be later than Lunch Start';
      }
      const gap = leM - lsM;
      if (gap < 30) {
        return `Lunch break is ${gap} min — standard break policy requires at least 30 minutes`;
      }
    }
    return null;
  }, []);

  const numDays = company.payPeriodType === 'Weekly' ? 7 : 14;

  const periodDates = useMemo(() => {
    const list: { date: string; dayName: string }[] = [];
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    for (let i = 0; i < numDays; i++) {
      const dStr = addDaysISO(periodStart, i);
      const [y, m, d] = dStr.split('-').map(Number);
      const dt = new Date(y, m - 1, d);
      list.push({ date: dStr, dayName: days[dt.getDay()] });
    }
    return list;
  }, [periodStart, numDays]);

  const periodRangeLabel = useMemo(() => {
    if (!periodDates.length) return '';
    const first = periodDates[0].date;
    const last = periodDates[periodDates.length - 1].date;
    const [sy, sm, sd] = first.split('-').map(Number);
    const [ey, em, ed] = last.split('-').map(Number);
    const sDt = new Date(sy, sm - 1, sd);
    const eDt = new Date(ey, em - 1, ed);
    const sMonth = sDt.toLocaleDateString('en-US', { month: 'short' });
    const eMonth = eDt.toLocaleDateString('en-US', { month: 'short' });
    if (sMonth === eMonth) {
      return `${sMonth} ${sDt.getDate()} – ${eDt.getDate()}, ${eDt.getFullYear()}`;
    }
    return `${sMonth} ${sDt.getDate()} – ${eMonth} ${eDt.getDate()}, ${eDt.getFullYear()}`;
  }, [periodDates]);

  const allCompanyRecords = useMemo(
    () => getTimeRecords(company.id),
    [company.id, refreshTick]
  );

  const [holidaySyncTick, setHolidaySyncTick] = useState(0);
  const highlightHolidays = company.highlightPublicHolidays !== false;
  const holidayCountry = company.holidayCountry || 'US';

  useEffect(() => {
    if (!highlightHolidays || !periodDates.length) return;
    const years = Array.from(
      new Set(periodDates.map(p => parseInt(p.date.slice(0, 4), 10)).filter(Boolean))
    );
    Promise.all(years.map(y => fetchPublicHolidaysFromAPI(y, holidayCountry))).then(() => {
      setHolidaySyncTick(t => t + 1);
    });
  }, [highlightHolidays, holidayCountry, periodDates]);

  const holidayMap = useMemo(() => {
    if (!highlightHolidays) return {};
    return buildHolidayMapForDates(
      periodDates.map(p => p.date),
      holidayCountry,
      getCustomHolidays()
    );
  }, [highlightHolidays, holidayCountry, periodDates, holidaySyncTick, refreshTick]);

  const evaluatedMap = useMemo(
    () => evaluateRecordsWithOvertime(allCompanyRecords, company, { [user.id]: user }),
    [allCompanyRecords, company, user]
  );

  const userPeriodRecords = useMemo(() => {
    const start = periodDates[0]?.date || '';
    const end = periodDates[periodDates.length - 1]?.date || '';
    return allCompanyRecords.filter(
      r => r.userId === user.id && r.date >= start && r.date <= end
    );
  }, [allCompanyRecords, user.id, periodDates]);

  const periodSummary = useMemo(() => {
    const evals = userPeriodRecords
      .map(r => evaluatedMap.get(r.id))
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
    return summarizeEvaluatedRecords(evals);
  }, [userPeriodRecords, evaluatedMap]);

  const over40PeriodHours = useMemo(
    () => Math.max(0, periodSummary.totalHours - 40),
    [periodSummary.totalHours]
  );
  const overtimeDisplayHours = useMemo(
    () =>
      company.calculateOvertimeWeekly !== false
        ? periodSummary.otHours
        : over40PeriodHours,
    [
      company.calculateOvertimeWeekly,
      over40PeriodHours,
      periodSummary.otHours,
    ]
  );
  const isOvertimeStatus = overtimeDisplayHours > 0;


  const canEditOwnTime = Boolean(user.permissions.allowEditOwnTime);
  const showEmployeeApprove = company.approvalMode === 'Employee and Manager';
  const isAllowedBusinessPayUser =
    user.role === 'Admin' || user.role === 'Manager' || Boolean(user.permissions?.viewOwnPayRate);

  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [optionalHourlyWage, setOptionalHourlyWage] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(`tsm_optional_hourly_wage_${user.id}`);
      if (saved !== null) return saved;
    } catch {}
    return user.rateType === 'Hourly' && user.payRate > 0 ? String(user.payRate) : '';
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`tsm_optional_hourly_wage_${user.id}`);
      if (saved !== null) {
        setOptionalHourlyWage(saved);
      } else {
        setOptionalHourlyWage(
          user.rateType === 'Hourly' && user.payRate > 0 ? String(user.payRate) : ''
        );
      }
    } catch {}
  }, [user.id, user.payRate, user.rateType]);

  const handleHourlyWageChange = (val: string) => {
    setOptionalHourlyWage(val);
    try {
      localStorage.setItem(`tsm_optional_hourly_wage_${user.id}`, val);
    } catch {}
  };

  const parsedHourlyWage = useMemo(() => {
    if (!isAllowedBusinessPayUser) return 0;
    const num = parseFloat(optionalHourlyWage);
    return !isNaN(num) && num > 0 ? num : 0;
  }, [isAllowedBusinessPayUser, optionalHourlyWage]);

  const grossPayTotal = useMemo(() => {
    if (!isAllowedBusinessPayUser || parsedHourlyWage <= 0) return 0;
    return periodSummary.totalHours * parsedHourlyWage;
  }, [isAllowedBusinessPayUser, parsedHourlyWage, periodSummary.totalHours]);

  const handleWorkFieldEdit = (
    dateStr: string,
    existingRecord: TimeRecord | undefined,
    field: 'timeIn' | 'lunchStart' | 'lunchEnd' | 'timeOut' | 'comment',
    value: string
  ) => {
    if (!canEditOwnTime) return;

    if (existingRecord) {
      if (isRecordFullyApproved(existingRecord, company)) return;
      const res = updateTimeRecord(
        company.id,
        existingRecord.id,
        { [field]: value },
        { editedByEmployee: true }
      );
      if (res.ok) {
        setRefreshTick(t => t + 1);
        setStatusMessage('Record updated (manager approval reset).');
      }
    } else {
      // Create a work record on first time entry
      const timeIn = field === 'timeIn' ? value : '09:00';
      const timeOut = field === 'timeOut' ? value : '17:00';
      const res = createWorkEntries(company.id, {
        userIds: [user.id],
        date: dateStr,
        timeIn,
        timeOut,
        lunchStart: field === 'lunchStart' ? value : '',
        lunchEnd: field === 'lunchEnd' ? value : '',
        comment: field === 'comment' ? value : '',
      });
      if (res.ok) {
        setRefreshTick(t => t + 1);
      }
    }
  };

  const handleApproveMyTimecard = () => {
    const ids = userPeriodRecords
      .filter(r => r.requestStatus !== 'Pending' && r.requestStatus !== 'Denied')
      .map(r => r.id);
    if (ids.length === 0) {
      setStatusMessage('No records in this period to approve.');
      return;
    }
    setRecordsApproval(company.id, ids, { approvedByEmployee: true });
    setRefreshTick(t => t + 1);
    setStatusMessage('Your timecard for this period has been approved ✓');
  };

  const handleSubmitEntryRequest = (e: React.FormEvent) => {
    e.preventDefault();
    setReqError('');
    if (!user.permissions.allowAddEntryRequest) {
      setReqError('You do not have permission to request time entries.');
      return;
    }
    const res = createWorkEntries(company.id, {
      userIds: [user.id],
      date: reqDate,
      timeIn: reqTimeIn,
      timeOut: reqTimeOut,
      comment: reqComment,
      requestStatus: 'Pending',
    });
    if (!res.ok) {
      setReqError(res.error);
      return;
    }
    setShowEntryRequestModal(false);
    setReqComment('');
    setRefreshTick(t => t + 1);
    setStatusMessage('Entry request submitted (Pending manager approval).');
  };

  const handleSubmitAbsenceRequest = (e: React.FormEvent) => {
    e.preventDefault();
    setAbsError('');
    if (!user.permissions.allowAddAbsenceRequest) {
      setAbsError('You do not have permission to request absences.');
      return;
    }
    const hrs = parseFloat(absHours);
    const isPaid = absType !== 'Unpaid Leave';
    const res = createAbsenceEntries(company.id, {
      userIds: [user.id],
      date: absDate,
      absenceType: absType,
      hours: hrs,
      isPaid,
      comment: absComment,
      requestStatus: 'Pending',
    });
    if (!res.ok) {
      setAbsError(res.error);
      return;
    }
    setShowAbsenceRequestModal(false);
    setAbsComment('');
    setRefreshTick(t => t + 1);
    setStatusMessage('Absence request submitted (Pending manager approval).');
  };

  // Signature helpers
  const handleCanvasEnd = () => {
    if (!sigCanvas.current) return;
    const data = sigCanvas.current.toData();
    const nextHist = canvasHistory.slice(0, historyPointer + 1);
    nextHist.push(data);
    setCanvasHistory(nextHist);
    setHistoryPointer(nextHist.length - 1);
    setSignature(sigCanvas.current.toDataURL());
  };

  const handleUndo = () => {
    if (!sigCanvas.current || historyPointer <= 0) {
      if (historyPointer === 0) {
        sigCanvas.current?.clear();
        setHistoryPointer(-1);
        setSignature('');
      }
      return;
    }
    const nextPtr = historyPointer - 1;
    setHistoryPointer(nextPtr);
    sigCanvas.current.clear();
    sigCanvas.current.fromData(canvasHistory[nextPtr]);
    setSignature(sigCanvas.current.toDataURL());
  };

  const handleRedo = () => {
    if (!sigCanvas.current || historyPointer >= canvasHistory.length - 1) return;
    const nextPtr = historyPointer + 1;
    setHistoryPointer(nextPtr);
    sigCanvas.current.clear();
    sigCanvas.current.fromData(canvasHistory[nextPtr]);
    setSignature(sigCanvas.current.toDataURL());
  };

  const handleClearSignature = () => {
    sigCanvas.current?.clear();
    setCanvasHistory([]);
    setHistoryPointer(-1);
    setSignature('');
  };

  const buildMyHoursPdf = () => {
    const rows = periodDates.map(({ date: dStr, dayName }) => {
      const dayRecords = userPeriodRecords.filter(r => r.date === dStr);
      const workRec = dayRecords.find(r => r.recordType === 'Work');
      const otherRecs = dayRecords.filter(r => r.recordType !== 'Work');

      const evalWork = workRec ? evaluatedMap.get(workRec.id) : undefined;
      const otherHours = otherRecs.reduce((acc, r) => {
        const ev = evaluatedMap.get(r.id);
        return acc + (ev ? ev.totalHours : 0);
      }, 0);
      const totalDayHours = (evalWork ? evalWork.totalHours : 0) + otherHours;

      const noteParts: string[] = [];
      if (workRec?.comment) noteParts.push(workRec.comment);
      otherRecs.forEach(r => {
        if (r.recordType === 'Absence') {
          noteParts.push(`${r.absenceType || 'Absence'} (${(r.manualHours || 0).toFixed(2)}h)`);
        } else {
          noteParts.push(`Manual (${(r.manualHours || 0).toFixed(2)}h)`);
        }
      });

      return {
        day: dayName,
        date: dStr,
        timeIn: workRec?.timeIn || '',
        lunchStart: workRec?.lunchStart || '',
        lunchEnd: workRec?.lunchEnd || '',
        timeOut: workRec?.timeOut || '',
        totalHours: formatHours(totalDayHours, company.timeTotalsFormat),
        notes: noteParts.join('; '),
      };
    });

    let sigImg = signature;
    if (signatureMode === 'draw' && sigCanvas.current && !sigCanvas.current.isEmpty()) {
      sigImg = sigCanvas.current.toDataURL('image/png');
    }

    return generateVectorTimesheetPDF({
      companyName: company.name,
      periodType: company.payPeriodType,
      periodRangeLabel: periodRangeLabel || periodStart,
      periodStart,
      employeeName: user.fullName,
      employeeEmail: user.email,
      rows,
      totalPeriodHours: periodSummary.totalHours,
      regularPeriodHours: periodSummary.regHours,
      overtimePeriodHours: overtimeDisplayHours,
      signatureDataUrl: sigImg,
      typedSignature: signatureMode === 'type' ? (typedName || user.fullName) : '',
      signatureDate: sigDate || todayISO,
    });
  };

  const handleExportPDF = async () => {
    setIsGeneratingPDF(true);
    try {
      const pdf = buildMyHoursPdf();
      const filename = `Timesheet_${user.fullName.replace(/\s+/g, '_')}_${periodStart}.pdf`;
      pdf.save(filename);
      setStatusMessage(`Exported ${filename}`);
    } catch (e) {
      console.error('Export PDF error:', e);
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  const handlePrint = async () => {
    setIsGeneratingPDF(true);
    try {
      const pdf = buildMyHoursPdf();
      const filename = `Timesheet_${user.fullName.replace(/\s+/g, '_')}_${periodStart}.pdf`;
      triggerPrintAndDownloadPDF(pdf, filename);
      setStatusMessage(`Prepared print view & downloaded ${filename}`);
    } catch (e) {
      console.error('Print error:', e);
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-[#0b0f19] text-gray-900 dark:text-gray-100 py-4 sm:py-6 px-2.5 sm:px-5 lg:px-8">
      <div id="my-hours-sheet-content" className="max-w-7xl mx-auto space-y-4 sm:space-y-6">
        {/* Top Header for My Hours */}
        <header className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 shadow-sm border border-gray-200/80 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4 print:hidden">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-sm shrink-0">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-gray-900 dark:text-white leading-tight">
                My Hours — {company.name}
              </h1>
              <p className="text-xs font-medium text-gray-500 dark:text-slate-400">
                Signed in as <strong>{user.fullName}</strong> ({user.role})
                {!canEditOwnTime && ' • Read-Only Mode'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 justify-end">
            <button
              type="button"
              onClick={() => onNavigate('/clock')}
              className="min-h-[40px] px-3.5 py-2 text-xs sm:text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              <Clock className="w-4 h-4" />
              <span>Go to Punch Clock</span>
            </button>

            {user.permissions.allowAddEntryRequest && (
              <button
                type="button"
                onClick={() => setShowEntryRequestModal(true)}
                className="min-h-[40px] px-3 py-2 text-xs font-semibold text-gray-700 dark:text-slate-200 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 rounded-xl transition-colors flex items-center gap-1 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Entry Request</span>
              </button>
            )}

            {user.permissions.allowAddAbsenceRequest && (
              <button
                type="button"
                onClick={() => setShowAbsenceRequestModal(true)}
                className="min-h-[40px] px-3 py-2 text-xs font-semibold text-gray-700 dark:text-slate-200 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 rounded-xl transition-colors flex items-center gap-1 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Absence Request</span>
              </button>
            )}

            {showEmployeeApprove && (
              <button
                type="button"
                onClick={handleApproveMyTimecard}
                className="min-h-[40px] px-3.5 py-2 text-xs font-bold text-emerald-800 bg-emerald-100 hover:bg-emerald-200 rounded-xl transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                <span>Approve My Timecard</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleExportPDF}
              disabled={isGeneratingPDF}
              title="Download formatted A4 PDF timesheet"
              className="min-h-[40px] px-3 py-2 text-xs font-semibold text-gray-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl hover:bg-gray-50 flex items-center gap-1.5 whitespace-nowrap"
            >
              {isGeneratingPDF ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              <span>Export PDF</span>
            </button>

            <button
              type="button"
              onClick={handlePrint}
              disabled={isGeneratingPDF}
              title="Print timesheet and save PDF copy"
              className="min-h-[40px] px-3 py-2 text-xs font-semibold text-gray-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl hover:bg-gray-50 flex items-center gap-1.5 whitespace-nowrap"
            >
              {isGeneratingPDF ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Printer className="w-4 h-4" />
              )}
              <span>Print</span>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('/')}
              className="min-h-[40px] px-3 py-2 text-xs font-semibold text-gray-600 dark:text-slate-300 hover:text-gray-900 rounded-xl flex items-center gap-1 whitespace-nowrap"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Exit to Timesheet</span>
            </button>

            {isAllowedBusinessPayUser && (
              <button
                type="button"
                onClick={() => setShowSettingsModal(true)}
                title="Settings & Optional Hourly Wage"
                className="min-h-[40px] px-3 py-2 text-xs font-semibold text-gray-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl hover:bg-gray-50 flex items-center gap-1.5 whitespace-nowrap"
              >
                <Settings className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span>Settings</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                signOutSession();
                onSignOut();
              }}
              className="min-h-[40px] px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-xl flex items-center gap-1 whitespace-nowrap"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </header>

        {statusMessage && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-semibold text-emerald-800 flex items-center justify-between">
            <span>{statusMessage}</span>
            <button onClick={() => setStatusMessage('')} className="text-emerald-600 hover:text-emerald-900">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Main Sheet Card (Reusing Landing Sheet Design per G1) */}
        <div className="bg-white dark:bg-slate-900 shadow-sm rounded-2xl p-4 sm:p-6 lg:p-8 border border-gray-200/80 dark:border-slate-800">
          <div className="text-center mb-6 sm:mb-8">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
              {company.name}
            </h2>
            <p className="text-sm font-medium text-gray-500 dark:text-slate-400 mt-1 uppercase tracking-wider">
              EMPLOYEE TIME SHEET • {company.payPeriodType.toUpperCase()} PERIOD
            </p>
          </div>

          {/* Employee Info Header: Fixed Employee Name (read-only), Email, Period Starting */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8 pb-6 border-b border-gray-200/80 dark:border-slate-800">
            <div className="space-y-1">
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-slate-400">
                Employee Name
              </label>
              <input
                type="text"
                value={user.fullName}
                readOnly
                disabled
                className="w-full min-h-[44px] px-3.5 py-2 text-base font-bold text-gray-900 dark:text-white bg-gray-100 dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl cursor-not-allowed"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-slate-400">
                Your Email (for CC)
              </label>
              <input
                type="email"
                value={user.email}
                readOnly
                disabled
                className="w-full min-h-[44px] px-3.5 py-2 text-base font-medium text-gray-900 dark:text-white bg-gray-100 dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl cursor-not-allowed"
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-slate-400">
                  Period Starting
                </label>
                <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
                  {periodRangeLabel}
                </span>
              </div>
              <input
                type="date"
                value={periodStart}
                onChange={e => setPeriodStart(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2 text-base font-bold text-gray-900 dark:text-white bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Mobile Summary Strip (Visible on Mobile) */}
          <div className="md:hidden mb-4 p-3 rounded-xl border border-gray-200 dark:border-slate-800 bg-gray-50/80 dark:bg-slate-800/60 flex items-center justify-between gap-2 print:hidden">
            <div className="text-xs font-bold text-gray-700 dark:text-slate-300 flex items-center gap-1.5 flex-wrap">
              <span>
                Period Total:{' '}
                <strong
                  className={
                    isOvertimeStatus
                      ? 'text-rose-600 dark:text-rose-400 font-black'
                      : 'text-indigo-600 dark:text-indigo-400 font-black'
                  }
                >
                  {formatHours(periodSummary.totalHours, company.timeTotalsFormat)}
                </strong>{' '}
                hrs
              </span>
              {isOvertimeStatus && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800 text-[10px] font-extrabold uppercase">
                  <AlertTriangle className="w-3 h-3 text-rose-600 shrink-0" />
                  <span>+{formatHours(overtimeDisplayHours, company.timeTotalsFormat)} OT</span>
                </span>
              )}
              {isAllowedBusinessPayUser && parsedHourlyWage > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 text-[10px] font-extrabold">
                  <span>
                    Gross: {company.currencySymbol}
                    {grossPayTotal.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </span>
              )}
            </div>
          </div>

          {/* 7-column Grid with exact landing page colors & fonts */}
          <div className="overflow-x-auto mb-8 border border-gray-200 dark:border-slate-800 rounded-2xl bg-white dark:bg-slate-900">
            <table className="w-full min-w-[720px] md:min-w-0 md:table-fixed divide-y divide-gray-200 dark:divide-slate-800">
              <thead className="bg-gray-50/80 dark:bg-slate-800/60">
                <tr>
                  <th className="px-2.5 lg:px-3 py-3 text-left text-xs font-bold text-gray-600 dark:text-slate-300 uppercase tracking-wider w-[13%]">
                    Date
                  </th>
                  <th className="px-2.5 lg:px-3 py-3 text-left text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider w-[16%] bg-white dark:bg-slate-900">
                    <span className="flex items-center gap-1">
                      <LogIn className="w-3.5 h-3.5 text-emerald-600 shrink-0 inline" />
                      <span>Time In</span>
                    </span>
                  </th>
                  <th className="px-2 lg:px-3 py-3 text-left text-xs font-bold text-amber-900 dark:text-amber-200 uppercase tracking-wider w-[13.5%] bg-[#FEF9C3] dark:bg-amber-950/40">
                    <span className="flex items-center gap-1">
                      <Utensils className="w-3.5 h-3.5 text-amber-700 dark:text-amber-300 shrink-0 inline" />
                      <span className="truncate">Lunch Start</span>
                    </span>
                  </th>
                  <th className="px-2 lg:px-3 py-3 text-left text-xs font-bold text-amber-900 dark:text-amber-200 uppercase tracking-wider w-[13.5%] bg-[#FEF9C3] dark:bg-amber-950/40">
                    <span className="flex items-center gap-1">
                      <Utensils className="w-3.5 h-3.5 text-amber-700 dark:text-amber-300 shrink-0 inline" />
                      <span className="truncate">Lunch End</span>
                    </span>
                  </th>
                  <th className="px-2.5 lg:px-3 py-3 text-left text-xs font-bold text-rose-700 dark:text-rose-400 uppercase tracking-wider w-[16%] bg-white dark:bg-slate-900">
                    <span className="flex items-center gap-1">
                      <LogOut className="w-3.5 h-3.5 text-rose-600 shrink-0 inline" />
                      <span>Time Out</span>
                    </span>
                  </th>
                  <th className="px-2 py-3 text-center text-xs font-extrabold text-gray-900 dark:text-white uppercase tracking-wider w-[10%] bg-white dark:bg-slate-900">
                    Total Hrs
                  </th>
                  <th className="px-2.5 lg:px-3 py-3 text-left text-xs font-bold text-gray-600 dark:text-slate-300 uppercase tracking-wider w-[18%] bg-white dark:bg-slate-900">
                    Notes
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-800">
                {periodDates.map(({ date: dStr, dayName }, rowIdx) => {
                  const isToday = dStr === todayISO;
                  const holiday = holidayMap[dStr];
                  const dayRecords = userPeriodRecords.filter(r => r.date === dStr);
                  const workRec = dayRecords.find(r => r.recordType === 'Work');
                  const otherRecs = dayRecords.filter(r => r.recordType !== 'Work');

                  const isLocked = workRec ? isRecordFullyApproved(workRec, company) : false;
                  const isPendingReq = workRec?.requestStatus === 'Pending';
                  const rowEditable = canEditOwnTime && !isLocked && !isPendingReq;
                  const trimmedNote = workRec?.comment ? workRec.comment.trim() : '';
                  const hasNote = trimmedNote.length > 0;

                  const evalWork = workRec ? evaluatedMap.get(workRec.id) : undefined;
                  const otherHours = otherRecs.reduce((acc, r) => {
                    const ev = evaluatedMap.get(r.id);
                    return acc + (ev ? ev.totalHours : 0);
                  }, 0);
                  const totalDayHours = (evalWork ? evalWork.totalHours : 0) + otherHours;

                  return (
                    <tr
                      key={dStr}
                      className={`hover:bg-gray-50/60 dark:hover:bg-slate-800/40 transition-colors ${
                        isToday
                          ? 'today-row-glow bg-indigo-50/40 dark:bg-indigo-950/30'
                          : holiday
                            ? 'bg-violet-50/35 dark:bg-violet-950/20'
                            : ''
                      }`}
                    >
                      {/* DATE */}
                      <td
                        className={`px-2.5 lg:px-3 py-2.5 align-middle ${
                          isToday
                            ? 'bg-indigo-50/40 dark:bg-indigo-950/30 border-l-4 border-l-indigo-600 dark:border-l-indigo-400'
                            : holiday
                              ? 'bg-violet-50/45 dark:bg-violet-950/25 border-l-4 border-l-violet-500 dark:border-l-violet-400'
                              : 'bg-white dark:bg-slate-900'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-lg lg:text-xl xl:text-[22px] font-black text-gray-900 dark:text-white tracking-tight leading-none">
                            {dayName.slice(0, 3)}
                          </span>
                          {isToday && (
                            <span className="text-[10px] font-extrabold bg-indigo-600 text-white px-2 py-0.5 rounded-full uppercase shadow-xs ring-2 ring-indigo-400/50 animate-pulse">
                              Today
                            </span>
                          )}
                          {hasNote && (
                            <span
                              tabIndex={0}
                              aria-label={`Note for ${dayName} (${dStr}): ${trimmedNote}`}
                              aria-describedby={`myhours-date-note-tooltip-${rowIdx}`}
                              className="group/date-note relative inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800/70 text-[10px] font-bold cursor-help focus:outline-none focus:ring-2 focus:ring-indigo-500 print:hidden"
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 dark:bg-indigo-400 shrink-0" aria-hidden="true" />
                              <FileText className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                              <span
                                id={`myhours-date-note-tooltip-${rowIdx}`}
                                role="tooltip"
                                className={`pointer-events-none absolute left-0 ${
                                  rowIdx === 0 ? 'top-full mt-1.5' : 'bottom-full mb-1.5'
                                } z-40 w-56 max-w-xs p-2.5 rounded-xl bg-gray-900 dark:bg-slate-800 text-white text-xs font-medium leading-relaxed shadow-xl border border-gray-700 dark:border-slate-600 opacity-0 invisible group-hover/date-note:opacity-100 group-hover/date-note:visible group-focus-within/date-note:opacity-100 group-focus-within/date-note:visible transition-all duration-150 whitespace-normal break-words`}
                              >
                                <span className="block text-[10px] font-extrabold uppercase tracking-wider text-indigo-300 mb-0.5">
                                  {dayName} Note
                                </span>
                                <span>{trimmedNote}</span>
                              </span>
                            </span>
                          )}
                          {holiday && (
                            <span
                              title={`Public Holiday: ${holiday.name}`}
                              className="inline-flex items-center gap-1 text-[10px] font-extrabold bg-violet-100 dark:bg-violet-950/80 text-violet-800 dark:text-violet-200 border border-violet-300 dark:border-violet-700 px-1.5 py-0.5 rounded-md max-w-full truncate"
                            >
                              <Calendar className="w-2.5 h-2.5 text-violet-600 dark:text-violet-400 shrink-0" />
                              <span className="truncate">{holiday.name}</span>
                            </span>
                          )}
                          {isLocked && (
                            <span
                              title="Fully approved records are locked — unapprove to edit."
                              className="text-[10px] font-semibold text-emerald-700 flex items-center gap-0.5"
                            >
                              <Lock className="w-3 h-3" /> Locked
                            </span>
                          )}
                          {isPendingReq && (
                            <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                              Pending
                            </span>
                          )}
                        </div>
                        <div className="mt-1 leading-none">
                          {(() => {
                            if (!dStr || !dStr.includes('-')) {
                              return (
                                <span className="text-lg lg:text-xl font-black text-gray-900 dark:text-white">
                                  {dStr}
                                </span>
                              );
                            }
                            const [y, m, d] = dStr.split('-').map(Number);
                            const currentYear = new Date().getFullYear();
                            const dt = new Date(y, m - 1, d);
                            const monthShort = dt.toLocaleDateString('en-US', { month: 'short' });
                            return (
                              <span className="inline-flex items-baseline gap-1">
                                <span className="text-base lg:text-lg font-extrabold text-gray-600 dark:text-slate-300">
                                  {monthShort}
                                </span>
                                <span className="text-xl lg:text-2xl xl:text-[25px] font-black font-mono tabular-nums text-gray-900 dark:text-white">
                                  {d}
                                </span>
                                {y !== currentYear && (
                                  <span className="text-sm lg:text-base font-bold text-gray-500 dark:text-slate-400">
                                    , {y}
                                  </span>
                                )}
                              </span>
                            );
                          })()}
                        </div>
                      </td>

                      {/* TIME IN: STRICT PURE WHITE */}
                      <td className="px-2.5 lg:px-3 py-2 align-middle bg-white dark:bg-slate-900">
                        <input
                          ref={el => {
                            timeCellRefs.current[`${rowIdx}-timeIn`] = el;
                          }}
                          type="time"
                          value={workRec?.timeIn || ''}
                          disabled={!rowEditable}
                          readOnly={!rowEditable}
                          title={
                            isLocked
                              ? 'Fully approved records are locked — unapprove to edit.'
                              : !canEditOwnTime
                              ? 'Read-only: You do not have permission to edit your time.'
                              : 'Use arrow keys to navigate between cells'
                          }
                          onKeyDownCapture={e =>
                            handleTimeCellKeyDown(e, rowIdx, 'timeIn', periodDates.length)
                          }
                          onChange={e =>
                            handleWorkFieldEdit(dStr, workRec, 'timeIn', e.target.value)
                          }
                          className="time-input-mono w-full text-[19px] lg:text-[22px] xl:text-[24px] font-black font-mono tracking-tight tabular-nums text-gray-900 dark:text-white bg-white dark:bg-slate-900 border-none p-0 focus:ring-0 disabled:opacity-75"
                        />
                      </td>

                      {/* LUNCH START: STRICT LIGHT YELLOW #FEF9C3 ONLY */}
                      <td className="px-2 lg:px-2.5 py-2 align-middle bg-[#FEF9C3] dark:bg-amber-950/40">
                        <input
                          ref={el => {
                            timeCellRefs.current[`${rowIdx}-lunchStart`] = el;
                          }}
                          type="time"
                          value={workRec?.lunchStart || ''}
                          disabled={!rowEditable}
                          readOnly={!rowEditable}
                          title="Use arrow keys to navigate between cells"
                          onKeyDownCapture={e =>
                            handleTimeCellKeyDown(e, rowIdx, 'lunchStart', periodDates.length)
                          }
                          onChange={e =>
                            handleWorkFieldEdit(dStr, workRec, 'lunchStart', e.target.value)
                          }
                          className="time-input-mono w-full text-[15px] lg:text-[16px] xl:text-[17px] font-bold font-mono tracking-tight tabular-nums text-gray-900 dark:text-amber-100 bg-transparent border-none p-0 focus:ring-0 disabled:opacity-75"
                        />
                      </td>

                      {/* LUNCH END: STRICT LIGHT YELLOW #FEF9C3 ONLY */}
                      <td className="px-2 lg:px-2.5 py-2 align-middle bg-[#FEF9C3] dark:bg-amber-950/40">
                        <input
                          ref={el => {
                            timeCellRefs.current[`${rowIdx}-lunchEnd`] = el;
                          }}
                          type="time"
                          value={workRec?.lunchEnd || ''}
                          disabled={!rowEditable}
                          readOnly={!rowEditable}
                          title="Use arrow keys to navigate between cells"
                          onKeyDownCapture={e =>
                            handleTimeCellKeyDown(e, rowIdx, 'lunchEnd', periodDates.length)
                          }
                          onChange={e =>
                            handleWorkFieldEdit(dStr, workRec, 'lunchEnd', e.target.value)
                          }
                          className="time-input-mono w-full text-[15px] lg:text-[16px] xl:text-[17px] font-bold font-mono tracking-tight tabular-nums text-gray-900 dark:text-amber-100 bg-transparent border-none p-0 focus:ring-0 disabled:opacity-75"
                        />
                      </td>

                      {/* TIME OUT: STRICT PURE WHITE */}
                      <td className="px-2.5 lg:px-3 py-2 align-middle bg-white dark:bg-slate-900">
                        <input
                          ref={el => {
                            timeCellRefs.current[`${rowIdx}-timeOut`] = el;
                          }}
                          type="time"
                          value={workRec?.timeOut || ''}
                          disabled={!rowEditable}
                          readOnly={!rowEditable}
                          title="Use arrow keys to navigate between cells"
                          onKeyDownCapture={e =>
                            handleTimeCellKeyDown(e, rowIdx, 'timeOut', periodDates.length)
                          }
                          onChange={e =>
                            handleWorkFieldEdit(dStr, workRec, 'timeOut', e.target.value)
                          }
                          className="time-input-mono w-full text-[19px] lg:text-[22px] xl:text-[24px] font-black font-mono tracking-tight tabular-nums text-gray-900 dark:text-white bg-white dark:bg-slate-900 border-none p-0 focus:ring-0 disabled:opacity-75"
                        />
                      </td>

                      {/* TOTAL HRS: WHITE BACKGROUND */}
                      <td className="px-2 py-2 align-middle text-center bg-white dark:bg-slate-900">
                        {(() => {
                          const dayWarn = getWorkDayValidationWarning(workRec);
                          return (
                            <div className="flex flex-col items-center justify-center gap-0.5">
                              <span className="text-xl lg:text-2xl font-black font-mono tabular-nums text-gray-900 dark:text-white">
                                {workRec?.workingNow
                                  ? '—'
                                  : formatHours(totalDayHours, company.timeTotalsFormat)}
                              </span>
                              {dayWarn && (
                                <span
                                  title={dayWarn}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 text-[10px] font-bold leading-tight print:hidden"
                                >
                                  <AlertTriangle className="w-2.5 h-2.5 text-amber-600 shrink-0" />
                                  <span>{dayWarn.includes('30 minutes') ? '< 30m break policy' : 'Check time'}</span>
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </td>

                      {/* NOTES & ABSENCES / ADJUSTMENTS */}
                      <td className="px-2.5 lg:px-3 py-2 align-middle bg-white dark:bg-slate-900 space-y-1">
                        <div className="relative group/note flex items-center">
                          <input
                            type="text"
                            value={workRec?.comment || ''}
                            disabled={!rowEditable}
                            readOnly={!rowEditable}
                            onChange={e =>
                              handleWorkFieldEdit(dStr, workRec, 'comment', e.target.value)
                            }
                            placeholder="e.g., Overtime"
                            aria-label={`Notes for ${dayName}, ${dStr}`}
                            aria-describedby={hasNote ? `myhours-note-tooltip-${rowIdx}` : undefined}
                            className={`w-full text-xs lg:text-sm font-medium text-gray-900 dark:text-white bg-white dark:bg-slate-900 border rounded-lg py-1.5 focus:ring-2 focus:ring-indigo-500 disabled:opacity-75 transition-colors ${
                              hasNote
                                ? 'pl-2.5 pr-7 border-indigo-300 dark:border-indigo-700/80 bg-indigo-50/15 dark:bg-indigo-950/20'
                                : 'px-2.5 border-gray-200/80 dark:border-slate-700/80'
                            }`}
                          />
                          {hasNote && (
                            <>
                              <span
                                className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-4 h-4 rounded-full bg-indigo-100 dark:bg-indigo-900/70 text-indigo-600 dark:text-indigo-300 pointer-events-none print:hidden"
                                aria-hidden="true"
                              >
                                <FileText className="w-2.5 h-2.5" />
                              </span>
                              <div
                                id={`myhours-note-tooltip-${rowIdx}`}
                                role="tooltip"
                                className={`pointer-events-none absolute right-0 ${
                                  rowIdx === 0 ? 'top-full mt-1.5' : 'bottom-full mb-1.5'
                                } z-40 w-60 max-w-xs p-2.5 rounded-xl bg-gray-900 dark:bg-slate-800 text-white text-xs font-medium leading-relaxed shadow-xl border border-gray-700 dark:border-slate-600 opacity-0 invisible group-hover/note:opacity-100 group-hover/note:visible group-focus-within/note:opacity-100 group-focus-within/note:visible transition-all duration-150 whitespace-normal break-words print:hidden`}
                              >
                                <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-indigo-300 mb-0.5">
                                  <FileText className="w-3 h-3 shrink-0" aria-hidden="true" />
                                  <span>{dayName} Note</span>
                                </div>
                                <div>{trimmedNote}</div>
                              </div>
                            </>
                          )}
                        </div>
                        {otherRecs.map(or => (
                          <div
                            key={or.id}
                            className="text-xs font-medium text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5"
                          >
                            {or.recordType === 'Absence' ? (
                              <span>
                                [{or.absenceType}: {formatHours(or.absenceHours || 0, company.timeTotalsFormat)}h{' '}
                                {or.isPaid ? 'Paid' : 'Unpaid'}] {or.comment}
                              </span>
                            ) : (
                              <span>
                                [Adjustment: {or.adjustmentOp === 'Deduction' ? '-' : '+'}
                                {or.adjustmentValue} {or.adjustmentType}] {or.comment}
                              </span>
                            )}
                            {or.requestStatus === 'Pending' && (
                              <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                                Pending
                              </span>
                            )}
                          </div>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Signature Block & Totals Card (Same as Landing Page per G5) */}
          <div className="grid grid-cols-1 md:grid-cols-2 print:grid-cols-2 gap-6 print:gap-4 pt-4 print:pt-2.5 border-t border-gray-200/80 dark:border-slate-800 items-start print:break-inside-avoid">
            <div className="space-y-3 print:space-y-1.5 min-w-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-slate-400">
                    Employee Signature
                  </label>
                  <div className="relative group/sig-help inline-flex items-center print:hidden">
                    <button
                      type="button"
                      aria-label="Draw signature help"
                      aria-describedby="myhours-signature-help-tooltip"
                      className="text-gray-400 hover:text-indigo-600 dark:text-slate-500 dark:hover:text-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 rounded-full p-0.5 transition-colors"
                    >
                      <HelpCircle className="w-3.5 h-3.5" />
                    </button>
                    <div
                      id="myhours-signature-help-tooltip"
                      role="tooltip"
                      className="pointer-events-none invisible opacity-0 group-hover/sig-help:visible group-hover/sig-help:opacity-100 group-focus-within/sig-help:visible group-focus-within/sig-help:opacity-100 transition-all duration-150 absolute bottom-full left-0 mb-2 w-64 p-2.5 bg-slate-900 dark:bg-slate-800 text-white text-[11px] leading-relaxed rounded-xl shadow-xl border border-slate-700/80 z-30"
                    >
                      <p className="font-semibold text-indigo-300 mb-0.5">Draw Signature Help</p>
                      <p className="text-slate-200">
                        Use your <span className="font-semibold text-white">mouse or finger</span> to sign inside the canvas, or switch to <span className="font-semibold text-white">&apos;Type Name&apos;</span> mode if preferred.
                      </p>
                      <div className="absolute top-full left-2 -mt-1 border-4 border-transparent border-t-slate-900 dark:border-t-slate-800" />
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 bg-gray-100 dark:bg-slate-800 p-1 rounded-xl print:hidden">
                  <button
                    type="button"
                    onClick={() => setSignatureMode('draw')}
                    className={`min-h-[34px] px-3 py-1 text-xs font-bold rounded-lg flex items-center gap-1.5 ${
                      signatureMode === 'draw'
                        ? 'bg-white dark:bg-slate-700 text-indigo-600 shadow-xs'
                        : 'text-gray-600'
                    }`}
                  >
                    <PenTool className="w-3.5 h-3.5" />
                    <span>Draw</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSignatureMode('type')}
                    className={`min-h-[34px] px-3 py-1 text-xs font-bold rounded-lg flex items-center gap-1.5 ${
                      signatureMode === 'type'
                        ? 'bg-white dark:bg-slate-700 text-indigo-600 shadow-xs'
                        : 'text-gray-600'
                    }`}
                  >
                    <Type className="w-3.5 h-3.5" />
                    <span>Type Name</span>
                  </button>
                </div>
              </div>

              {signatureMode === 'draw' ? (
                <div>
                  <div className="relative border border-gray-300 dark:border-slate-700 rounded-2xl bg-white dark:bg-slate-800 overflow-hidden shadow-inner">
                    <SignatureCanvas
                      ref={sigCanvas}
                      penColor="#000000"
                      clearOnResize={false}
                      canvasProps={{
                        className: 'w-full h-36 sm:h-40 print:h-24 bg-white cursor-crosshair',
                      }}
                      onEnd={handleCanvasEnd}
                    />
                    <span className="pointer-events-none select-none absolute bottom-2 right-3 text-[10px] text-gray-400 dark:text-slate-500 print:hidden">
                      Sign with mouse or finger • or use &apos;Type Name&apos;
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-2 print:hidden">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleUndo}
                        disabled={historyPointer < 0}
                        className="min-h-[36px] px-3 py-1 text-xs font-semibold text-gray-700 bg-gray-100 rounded-lg disabled:opacity-40 flex items-center gap-1"
                      >
                        <Undo2 className="w-3.5 h-3.5" />
                        <span>Undo</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleRedo}
                        disabled={historyPointer >= canvasHistory.length - 1}
                        className="min-h-[36px] px-3 py-1 text-xs font-semibold text-gray-700 bg-gray-100 rounded-lg disabled:opacity-40 flex items-center gap-1"
                      >
                        <Redo2 className="w-3.5 h-3.5" />
                        <span>Redo</span>
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={handleClearSignature}
                      className="min-h-[36px] px-3 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-lg"
                    >
                      Clear Signature
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 print:space-y-1.5">
                  <input
                    type="text"
                    value={typedName}
                    onChange={e => setTypedName(e.target.value)}
                    className="w-full min-h-[44px] px-4 py-2 text-base font-semibold bg-white border border-gray-300 rounded-2xl print:hidden"
                  />
                  {typedName && (
                    <div className="p-4 print:p-2.5 border border-indigo-200 rounded-2xl bg-indigo-50/40">
                      <div className="font-signature text-3xl print:text-2xl text-gray-900 italic">
                        {typedName}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="pt-2 print:pt-1 space-y-1.5">
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-slate-400">
                  Signature Date
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={sigDate}
                    onChange={e => setSigDate(e.target.value)}
                    aria-invalid={Boolean(signatureDateWarning)}
                    aria-describedby={signatureDateWarning ? 'myhours-signature-date-warning' : undefined}
                    className={`min-h-[42px] print:min-h-0 px-3 py-1.5 print:p-1 text-sm print:text-xs font-semibold bg-white dark:bg-slate-800 text-gray-900 dark:text-white border rounded-xl transition-colors ${
                      signatureDateWarning
                        ? 'border-amber-400 dark:border-amber-500 ring-1 ring-amber-400/40'
                        : 'border-gray-300 dark:border-slate-700'
                    }`}
                  />
                  {signatureDateWarning && (
                    <button
                      type="button"
                      onClick={() => setSigDate(todayISO)}
                      className="min-h-[34px] px-2.5 py-1 text-xs font-bold text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-950/70 hover:bg-amber-200 dark:hover:bg-amber-900/70 border border-amber-300 dark:border-amber-700 rounded-lg transition-colors print:hidden"
                    >
                      Reset to Today
                    </button>
                  )}
                </div>
                {signatureDateWarning && (
                  <div
                    id="myhours-signature-date-warning"
                    role="alert"
                    className="flex items-start gap-1.5 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/80 text-xs font-semibold text-amber-800 dark:text-amber-300 print:hidden"
                  >
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <span>{signatureDateWarning}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Total Period Hours Card */}
            <div
              className={`bg-white dark:bg-slate-800 p-6 sm:p-8 print:p-3.5 rounded-2xl border min-w-0 overflow-hidden ${
                isOvertimeStatus
                  ? 'border-rose-300 dark:border-rose-700 ring-1 ring-rose-500/20'
                  : 'border-gray-200 dark:border-slate-700'
              } space-y-4 print:space-y-2`}
            >
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-sm print:text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-slate-400">
                  Total Period Hours
                </span>
                <div className="flex items-center gap-2">
                  {isOvertimeStatus && (
                    <span className="inline-flex items-center gap-1 text-xs print:text-[10px] font-extrabold px-2.5 py-1 print:px-1.5 print:py-0.5 bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800 rounded-lg uppercase tracking-wide">
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                      <span>Overtime (&gt;40 hrs)</span>
                    </span>
                  )}
                  <span className="text-xs print:text-[10px] font-semibold text-indigo-700 dark:text-indigo-300">
                    {company.payPeriodType}
                  </span>
                </div>
              </div>

              <div
                className={`text-4xl sm:text-5xl print:text-2xl font-black font-mono tabular-nums tracking-tight ${
                  isOvertimeStatus
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-gray-900 dark:text-white'
                }`}
              >
                {formatHours(periodSummary.totalHours, company.timeTotalsFormat)}
                <span
                  className={`text-lg sm:text-xl print:text-sm font-bold ml-2 ${
                    isOvertimeStatus ? 'text-rose-500 dark:text-rose-400' : 'text-gray-400'
                  }`}
                >
                  hrs
                </span>
              </div>

              <div className="text-xs print:text-[10px] text-gray-600 dark:text-slate-300 font-mono flex flex-wrap gap-3 print:gap-2 items-center">
                <span>Reg: {formatHours(periodSummary.regHours, company.timeTotalsFormat)}</span>
                <span>·</span>
                <span
                  className={
                    isOvertimeStatus
                      ? 'font-extrabold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/50 px-2 py-0.5 rounded border border-rose-200 dark:border-rose-800'
                      : ''
                  }
                >
                  OT (&gt;40h): {formatHours(overtimeDisplayHours, company.timeTotalsFormat)}
                </span>
                <span>·</span>
                <span>
                  Absence: {formatHours(periodSummary.paidAbsenceHours + periodSummary.unpaidAbsenceHours, company.timeTotalsFormat)}
                </span>
                <span>·</span>
                <span>Paid: {formatHours(periodSummary.paidHours, company.timeTotalsFormat)}</span>
              </div>

              {isAllowedBusinessPayUser && (
                <div className="pt-2.5 print:pt-1.5 border-t border-gray-100 dark:border-slate-700 space-y-2">
                  {parsedHourlyWage > 0 ? (
                    <div className="p-3.5 print:p-2 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] print:text-[9px] font-extrabold uppercase tracking-wider text-emerald-800 dark:text-emerald-300 flex items-center gap-1">
                          <DollarSign className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                          <span>Gross Pay</span>
                        </div>
                        <div className="text-[11px] print:text-[9px] font-medium text-emerald-700/90 dark:text-emerald-300/80 mt-0.5">
                          {formatHours(periodSummary.totalHours, company.timeTotalsFormat)} hrs ×{' '}
                          {company.currencySymbol}
                          {parsedHourlyWage.toFixed(2)}/hr
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xl sm:text-2xl print:text-base font-black font-mono tabular-nums text-emerald-700 dark:text-emerald-300">
                          {company.currencySymbol}
                          {grossPayTotal.toLocaleString('en-US', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowSettingsModal(true)}
                          className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline print:hidden"
                        >
                          Edit wage in Settings
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2 text-xs print:text-[10px] font-semibold text-gray-700 dark:text-slate-300">
                      <span>
                        Account Rate: {company.currencySymbol}
                        {user.payRate.toFixed(2)} ({user.rateType})
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowSettingsModal(true)}
                        className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline print:hidden"
                      >
                        + Set Hourly Wage in Settings
                      </button>
                    </div>
                  )}
                </div>
              )}

              <p className="text-xs print:text-[10px] text-gray-500 dark:text-slate-400 leading-relaxed print:leading-snug break-words whitespace-normal max-w-full">
                Total hours are automatically calculated based on
                <br className="hidden print:inline" /> Time In, Time Out, and Lunch deduction.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Settings Modal (Optional Hourly Wage for Allowed Business Account Users) */}
      {showSettingsModal && isAllowedBusinessPayUser && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4"
          onClick={() => setShowSettingsModal(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 border border-gray-200 dark:border-slate-800 shadow-2xl space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <DollarSign className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900 dark:text-white">
                    Compensation &amp; Wage Settings
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-slate-400">
                    Authorized for {user.fullName} ({company.name})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 rounded-xl bg-gray-50 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700 space-y-3">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-slate-200 mb-1">
                  Hourly Wage ({company.currencySymbol}/hr) — Optional
                </label>
                <p className="text-xs text-gray-500 dark:text-slate-400 mb-2">
                  Enter an hourly wage to calculate Gross Pay based on Total Period Hours in the summary section.
                </p>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-gray-500 dark:text-slate-400">
                    {company.currencySymbol}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={optionalHourlyWage}
                    onChange={e => handleHourlyWageChange(e.target.value)}
                    placeholder="e.g. 24.00 (optional)"
                    className="w-full min-h-[44px] pl-8 pr-16 py-2 text-sm font-bold font-mono border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-400">
                    / hr
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                {user.rateType === 'Hourly' && user.payRate > 0 && (
                  <button
                    type="button"
                    onClick={() => handleHourlyWageChange(String(user.payRate))}
                    className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    Use Account Rate ({company.currencySymbol}
                    {user.payRate.toFixed(2)}/hr)
                  </button>
                )}
                {optionalHourlyWage && (
                  <button
                    type="button"
                    onClick={() => handleHourlyWageChange('')}
                    className="text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline ml-auto"
                  >
                    Clear hourly wage
                  </button>
                )}
              </div>

              {parsedHourlyWage > 0 && (
                <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/70 flex items-center justify-between text-xs">
                  <span className="font-semibold text-emerald-800 dark:text-emerald-300">
                    Gross Pay Preview ({formatHours(periodSummary.totalHours, company.timeTotalsFormat)} hrs):
                  </span>
                  <span className="font-black font-mono text-sm text-emerald-700 dark:text-emerald-300">
                    {company.currencySymbol}
                    {grossPayTotal.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="min-h-[40px] px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Entry Request Modal */}
      {showEntryRequestModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowEntryRequestModal(false)}
        >
          <div
            className="bg-white rounded-2xl max-w-md w-full p-6 border border-gray-200 shadow-xl space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-gray-900">Add Entry Request</h3>
              <button onClick={() => setShowEntryRequestModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            {reqError && (
              <div className="p-2.5 bg-red-50 border border-red-200 text-xs text-red-700 rounded-lg">
                {reqError}
              </div>
            )}
            <form onSubmit={handleSubmitEntryRequest} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Date</label>
                <input
                  type="date"
                  required
                  value={reqDate}
                  onChange={e => setReqDate(e.target.value)}
                  className="w-full min-h-[40px] px-3 py-1.5 text-sm border border-gray-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Time In</label>
                  <input
                    type="time"
                    required
                    value={reqTimeIn}
                    onChange={e => setReqTimeIn(e.target.value)}
                    className="w-full min-h-[40px] px-3 py-1.5 text-sm border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Time Out</label>
                  <input
                    type="time"
                    required
                    value={reqTimeOut}
                    onChange={e => setReqTimeOut(e.target.value)}
                    className="w-full min-h-[40px] px-3 py-1.5 text-sm border border-gray-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Comment</label>
                <input
                  type="text"
                  value={reqComment}
                  onChange={e => setReqComment(e.target.value)}
                  placeholder="Reason for entry request..."
                  className="w-full min-h-[40px] px-3 py-1.5 text-sm border border-gray-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowEntryRequestModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-gray-700 bg-gray-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
                >
                  Submit Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Absence Request Modal */}
      {showAbsenceRequestModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowAbsenceRequestModal(false)}
        >
          <div
            className="bg-white rounded-2xl max-w-md w-full p-6 border border-gray-200 shadow-xl space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-gray-900">Add Absence Request</h3>
              <button onClick={() => setShowAbsenceRequestModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            {absError && (
              <div className="p-2.5 bg-red-50 border border-red-200 text-xs text-red-700 rounded-lg">
                {absError}
              </div>
            )}
            <form onSubmit={handleSubmitAbsenceRequest} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Date</label>
                <input
                  type="date"
                  required
                  value={absDate}
                  onChange={e => setAbsDate(e.target.value)}
                  className="w-full min-h-[40px] px-3 py-1.5 text-sm border border-gray-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Absence Type
                  </label>
                  <select
                    value={absType}
                    onChange={e => setAbsType(e.target.value as AbsenceType)}
                    className="w-full min-h-[40px] px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white"
                  >
                    {ABSENCE_TYPES.map(t => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Hours</label>
                  <input
                    type="number"
                    step="0.25"
                    required
                    value={absHours}
                    onChange={e => setAbsHours(e.target.value)}
                    className="w-full min-h-[40px] px-3 py-1.5 text-sm border border-gray-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Comment</label>
                <input
                  type="text"
                  value={absComment}
                  onChange={e => setAbsComment(e.target.value)}
                  placeholder="Optional note..."
                  className="w-full min-h-[40px] px-3 py-1.5 text-sm border border-gray-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAbsenceRequestModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-gray-700 bg-gray-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
                >
                  Submit Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
