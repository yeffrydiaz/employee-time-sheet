import React, { useState, useEffect, useMemo } from 'react';
import { Clock, LogOut, ArrowLeft, CheckCircle2, AlertCircle } from 'lucide-react';
import { AppUser, Company } from '../types/timeclock';
import {
  getActiveOpenRecordForUser,
  getDepartments,
  getTimeRecords,
  getTodayISO,
  punchClockIn,
  punchClockOut,
  signOutSession,
} from '../services/dataStore';
import {
  formatDateDisplay,
  formatHours,
  formatTimeDisplay,
  parseTimeToMinutes,
} from '../services/calculations';

interface PunchClockScreenProps {
  user: AppUser;
  company: Company;
  onNavigate: (path: string) => void;
  onSignOut: () => void;
}

export default function PunchClockScreen({
  user,
  company,
  onNavigate,
  onSignOut,
}: PunchClockScreenProps) {
  const [now, setNow] = useState(() => new Date());
  const [comment, setComment] = useState('');
  const [confirmationMsg, setConfirmationMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const effectiveTimezone =
    user.timezone && user.timezone !== 'Company default'
      ? user.timezone
      : company.defaultTimezone || 'America/New_York';

  const departmentName = useMemo(() => {
    const depts = getDepartments(company.id);
    return depts.find(d => d.id === user.departmentId)?.name || 'Unassigned';
  }, [company.id, user.departmentId, refreshTick]);

  const todayISO = getTodayISO();

  const openRecord = useMemo(
    () => getActiveOpenRecordForUser(company.id, user.id),
    [company.id, user.id, refreshTick]
  );

  const todayRecords = useMemo(() => {
    return getTimeRecords(company.id).filter(
      r =>
        r.userId === user.id &&
        r.date === todayISO &&
        r.recordType === 'Work' &&
        r.requestStatus !== 'Pending' &&
        r.requestStatus !== 'Denied'
    );
  }, [company.id, user.id, todayISO, refreshTick]);

  // Format live time in company timezone
  const liveTimeDisplay = useMemo(() => {
    try {
      return now.toLocaleTimeString('en-US', {
        timeZone: effectiveTimezone,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: company.timeFormat !== '24-hour',
      });
    } catch {
      return now.toLocaleTimeString();
    }
  }, [now, effectiveTimezone, company.timeFormat]);

  const liveDateDisplay = useMemo(() => {
    try {
      return now.toLocaleDateString('en-US', {
        timeZone: effectiveTimezone,
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return now.toDateString();
    }
  }, [now, effectiveTimezone]);

  // Compute elapsed time if currently clocked in
  const elapsedSoFarLabel = useMemo(() => {
    if (!openRecord || !openRecord.timeIn) return '';
    const inMins = parseTimeToMinutes(openRecord.timeIn);
    if (inMins === null) return '';
    const nowMins = now.getHours() * 60 + now.getMinutes();
    let diffMins = nowMins - inMins;
    if (diffMins < 0) diffMins = 0;
    const h = Math.floor(diffMins / 60);
    const m = diffMins % 60;
    return `${h}h ${String(m).padStart(2, '0')}m so far`;
  }, [openRecord, now]);

  const handlePunch = () => {
    setErrorMsg('');

    if (!openRecord) {
      const res = punchClockIn(company.id, user.id, comment);
      if (!res.ok) {
        setErrorMsg(res.error);
        return;
      }
      setComment('');
      setConfirmationMsg(
        `Clocked in at ${formatTimeDisplay(res.record.timeIn, company.timeFormat)} ✓`
      );
      setRefreshTick(t => t + 1);
    } else {
      const res = punchClockOut(company.id, user.id, comment);
      if (!res.ok) {
        setErrorMsg(res.error);
        return;
      }
      setComment('');
      setConfirmationMsg(
        `Clocked out at ${formatTimeDisplay(res.record.timeOut, company.timeFormat)} ✓`
      );
      setRefreshTick(t => t + 1);
    }
  };

  const isClockedIn = Boolean(openRecord);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Bar */}
      <header className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-slate-900 text-white flex items-center justify-center">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-900">{company.name}</div>
            <div className="text-xs text-slate-500">Web Punch Clock</div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button
            type="button"
            onClick={() => onNavigate('/my-hours')}
            className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap"
          >
            My Hours
          </button>
          {(user.role === 'Admin' || user.role === 'Manager') && (
            <button
              type="button"
              onClick={() => onNavigate('/admin')}
              className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap"
            >
              Admin Console
            </button>
          )}
          <button
            type="button"
            onClick={() => onNavigate('/')}
            className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 rounded-lg transition-colors inline-flex items-center gap-1 whitespace-nowrap"
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
            className="px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-lg transition-colors inline-flex items-center gap-1 whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      {/* Main Punch Card */}
      <main className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-xs p-6 sm:p-8 text-center space-y-6">
          {/* Employee Name & Department */}
          <div className="pb-4 border-b border-slate-100">
            <h1 className="text-xl font-bold text-slate-900">{user.fullName}</h1>
            <p className="text-xs font-medium text-slate-500 mt-1">
              Department: <span className="text-slate-700 font-semibold">{departmentName}</span> ·{' '}
              <span>{effectiveTimezone}</span>
            </p>
          </div>

          {/* Live Clock */}
          <div className="space-y-1">
            <div className="text-4xl sm:text-5xl font-black font-mono tabular-nums tracking-tight text-slate-900">
              {liveTimeDisplay}
            </div>
            <div className="text-xs font-medium text-slate-500">{liveDateDisplay}</div>
          </div>

          {/* Confirmation or Error */}
          {confirmationMsg && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-semibold flex items-center justify-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{confirmationMsg}</span>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold flex items-center justify-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* ONE BIG PRIMARY BUTTON: CLOCK IN or CLOCK OUT */}
          <div>
            <button
              type="button"
              onClick={handlePunch}
              className={`w-full min-h-[64px] py-4 px-6 rounded-2xl text-xl font-extrabold tracking-wide text-white shadow-sm transition-all active:scale-98 ${
                isClockedIn
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
            >
              {isClockedIn ? 'CLOCK OUT' : 'CLOCK IN'}
            </button>
          </div>

          {/* Today's Status Line */}
          <div className="text-sm font-semibold text-slate-700">
            {isClockedIn && openRecord ? (
              <span>
                Clocked in at {formatTimeDisplay(openRecord.timeIn, company.timeFormat)} •{' '}
                {elapsedSoFarLabel}
              </span>
            ) : (
              <span className="text-slate-500">Not clocked in today</span>
            )}
          </div>

          {/* Optional Comment Field (when user has allowComments permission) */}
          {user.permissions.allowComments && (
            <div className="text-left space-y-1 pt-2 border-t border-slate-100">
              <label className="block text-xs font-semibold text-slate-600">
                Comment (optional)
              </label>
              <input
                type="text"
                value={comment}
                onChange={e => setComment(e.target.value)}
                placeholder="Add shift note or comment..."
                className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-xl bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
          )}

          {/* Today's Earlier Punches Listed (In/Out pairs) */}
          <div className="text-left pt-4 border-t border-slate-200 space-y-2">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Today&apos;s Punches ({formatDateDisplay(todayISO, company.dateFormat)})
            </div>
            {todayRecords.length === 0 ? (
              <p className="text-xs text-slate-400">No punches recorded today yet.</p>
            ) : (
              <div className="space-y-1.5">
                {todayRecords.map(rec => (
                  <div
                    key={rec.id}
                    className="flex items-center justify-between text-xs py-2 px-3 rounded-lg bg-slate-50 border border-slate-200/80 font-mono tabular-nums"
                  >
                    <div>
                      <span className="font-semibold text-slate-800">
                        In: {formatTimeDisplay(rec.timeIn, company.timeFormat)}
                      </span>
                      <span className="mx-2 text-slate-400">→</span>
                      <span className="font-semibold text-slate-800">
                        Out:{' '}
                        {rec.workingNow || !rec.timeOut
                          ? 'Working Now'
                          : formatTimeDisplay(rec.timeOut, company.timeFormat)}
                      </span>
                    </div>
                    <div className="font-bold text-slate-900">
                      {rec.workingNow || !rec.timeOut
                        ? '—'
                        : `${formatHours(rec.savedWorkedHours || 0, company.timeTotalsFormat)} hrs`}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
