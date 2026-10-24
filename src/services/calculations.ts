import {
  AppUser,
  Company,
  RoundingDirection,
  RoundingMinutes,
  TimeRecord,
  TimeTotalsFormat,
} from '../types/timeclock';

/**
 * Parse "HH:mm" into total minutes from midnight (0..1439)
 */
export function parseTimeToMinutes(hhmm?: string): number | null {
  if (!hhmm || !hhmm.includes(':')) return null;
  const parts = hhmm.trim().split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

/**
 * Convert minutes from midnight (mod 1440) back into "HH:mm"
 */
export function minutesToHHMM(totalMinutes: number): string {
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Round a punch time string "HH:mm" according to direction and increment
 */
export function roundTimeHHMM(
  hhmm: string | undefined,
  direction: RoundingDirection,
  incrementMins: RoundingMinutes
): string {
  if (!hhmm) return '';
  const mins = parseTimeToMinutes(hhmm);
  if (mins === null) return hhmm;
  if (!incrementMins || incrementMins <= 1) return minutesToHHMM(mins);

  let rounded = mins;
  if (direction === 'NEAREST') {
    rounded = Math.round(mins / incrementMins) * incrementMins;
  } else if (direction === 'UP') {
    rounded = Math.ceil(mins / incrementMins) * incrementMins;
  } else if (direction === 'DOWN') {
    rounded = Math.floor(mins / incrementMins) * incrementMins;
  }
  return minutesToHHMM(rounded);
}

/**
 * Compute Late IN and Early OUT flags against Company Default Shift Start/End
 * H6: Late IN = In later than Default Shift Start + 5 minutes.
 *     Early OUT = Out earlier than Default Shift End.
 */
export function detectShiftFlags(
  roundedIn: string | undefined,
  roundedOut: string | undefined,
  company: Company
): { lateIn: boolean; earlyOut: boolean } {
  const inMins = parseTimeToMinutes(roundedIn);
  const outMins = parseTimeToMinutes(roundedOut);
  const shiftStartMins = parseTimeToMinutes(company.defaultShiftStart);
  const shiftEndMins = parseTimeToMinutes(company.defaultShiftEnd);

  const lateIn =
    inMins !== null && shiftStartMins !== null ? inMins > shiftStartMins + 5 : false;
  const earlyOut =
    outMins !== null &&
    inMins !== null &&
    shiftEndMins !== null &&
    outMins >= inMins // same-day shift
      ? outMins < shiftEndMins
      : false;

  return { lateIn, earlyOut };
}

/**
 * Compute worked hours and lunch deduction at the moment a Work record is saved (Part H1–H3, D6).
 */
export function computeWorkRecordSnapshot(
  roundedIn: string | undefined,
  roundedOut: string | undefined,
  lunchStart: string | undefined,
  lunchEnd: string | undefined,
  workingNow: boolean | undefined,
  company: Company,
  user?: AppUser
): { workedHours: number; lunchDeductedMins: number } {
  if (workingNow || !roundedIn || !roundedOut) {
    return { workedHours: 0, lunchDeductedMins: 0 };
  }

  const inMins = parseTimeToMinutes(roundedIn);
  const outMins = parseTimeToMinutes(roundedOut);
  if (inMins === null || outMins === null) {
    return { workedHours: 0, lunchDeductedMins: 0 };
  }

  // H1: Duration: Out - In. If Out is earlier than In, treat as next-day (overnight) and add 24h.
  let rawDurationMins = outMins - inMins;
  if (rawDurationMins < 0) {
    rawDurationMins += 24 * 60;
  }
  if (rawDurationMins === 0) {
    return { workedHours: 0, lunchDeductedMins: 0 };
  }

  let lunchDeductedMins = 0;

  // H3(a): Explicit Lunch Start / End
  const lStart = parseTimeToMinutes(lunchStart);
  const lEnd = parseTimeToMinutes(lunchEnd);
  if (lStart !== null && lEnd !== null) {
    let explicitLunch = lEnd - lStart;
    if (explicitLunch < 0) explicitLunch += 24 * 60;
    if (explicitLunch > 0 && explicitLunch < rawDurationMins) {
      lunchDeductedMins = explicitLunch;
    }
  } else {
    // H3(b): Auto Lunch Deduction (never deduct twice)
    let applyAuto = false;
    let deductMins = company.autoLunchMinutes || 0;
    let thresholdHours = company.autoLunchAfterHours || 6;

    if (user && user.autoLunchMode === 'No') {
      applyAuto = false;
    } else if (user && user.autoLunchMode === 'Yes') {
      applyAuto = true;
      deductMins = user.autoLunchMinutes ?? company.autoLunchMinutes;
      thresholdHours = user.autoLunchAfterHours ?? company.autoLunchAfterHours;
    } else {
      // 'Use company setting' or no user override
      if (company.autoLunchMode === 'Yes') {
        applyAuto = true;
      } else if (company.autoLunchMode === 'Per user' && user?.autoLunchMode === 'Yes') {
        applyAuto = true;
      }
    }

    const rawHours = rawDurationMins / 60;
    if (applyAuto && rawHours >= thresholdHours && deductMins > 0) {
      lunchDeductedMins = Math.min(deductMins, rawDurationMins);
    }
  }

  const netMins = Math.max(0, rawDurationMins - lunchDeductedMins);
  return {
    workedHours: Number((netMins / 60).toFixed(4)),
    lunchDeductedMins,
  };
}

/**
 * Determine if a record is Fully Approved based on Company Approval Mode (D7)
 */
export function isRecordFullyApproved(record: TimeRecord, company: Company): boolean {
  if (record.requestStatus === 'Pending' || record.requestStatus === 'Denied') {
    return false;
  }
  if (company.approvalMode === 'Off') {
    return false;
  }
  if (company.approvalMode === 'Manager only') {
    return Boolean(record.approvedByManager);
  }
  return Boolean(record.approvedByManager && record.approvedByEmployee);
}

/**
 * Determine if a record needs approval in the Approvals queue
 */
export function isRecordPendingApproval(record: TimeRecord, company: Company): boolean {
  if (company.approvalMode === 'Off') return false;
  if (record.requestStatus === 'Denied') return false;
  if (record.requestStatus === 'Pending') return true;
  if (record.recordType === 'Work' && (record.workingNow || !record.timeOut)) {
    return false;
  }
  if (company.approvalMode === 'Manager only') {
    return !record.approvedByManager;
  }
  return !(record.approvedByManager && record.approvedByEmployee);
}

/**
 * Get the start date (YYYY-MM-DD) of the week containing `dateStr`,
 * anchored on `weekStartDay` (0=Sunday..6=Saturday).
 */
export function getWeekStartDateStr(dateStr: string, weekStartDay: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay();
  const diff = (day - weekStartDay + 7) % 7;
  dt.setDate(dt.getDate() - diff);
  return formatDateISO(dt);
}

export function formatDateISO(dt: Date): string {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysISO(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return formatDateISO(dt);
}

/**
 * Evaluated breakdown for each individual record after weekly 40h OT allocation
 */
export interface EvaluatedRecord {
  record: TimeRecord;
  workedHours: number;
  lunchDeductedMins: number;
  regHours: number;
  otHours: number;
  dtHours: number;
  paidAbsenceHours: number;
  unpaidAbsenceHours: number;
  hoursAdjustment: number;
  amountAdjustment: number;
  paidHours: number;
  unpaidHours: number;
  totalHours: number;
  isOpenWork: boolean;
}

export interface CalculatedSummary {
  regHours: number;
  otHours: number;
  dtHours: number;
  paidAbsenceHours: number;
  unpaidAbsenceHours: number;
  hoursAdjustment: number;
  amountAdjustment: number;
  paidHours: number;
  unpaidHours: number;
  totalHours: number;
}

/**
 * THE SINGLE SHARED CALCULATION FUNCTION (Part D3, D8, H1–H6)
 * Takes all records for the company (or employee) so that 40-hour weekly overtime
 * is accurately allocated across each company week (starting on company.weekStartDay),
 * then returns evaluated records and aggregate totals for any requested filter set.
 */
export function evaluateRecordsWithOvertime(
  allCompanyRecords: TimeRecord[],
  company: Company,
  usersById?: Record<string, AppUser>,
  periodRangeOverride?: { fromDate?: string; toDate?: string }
): Map<string, EvaluatedRecord> {
  const result = new Map<string, EvaluatedRecord>();

  // Filter out pending/denied requests from official hour calculations
  const activeRecords = allCompanyRecords.filter(
    r => r.requestStatus !== 'Pending' && r.requestStatus !== 'Denied'
  );

  const calculateWeekly = company.calculateOvertimeWeekly !== false;
  const calculateDaily = Boolean(company.calculateDailyOvertime);

  // Group Work records by (userId + weekStartDate) when Weekly, or (userId + payPeriod) when Per-period
  const workByUserGroup = new Map<string, TimeRecord[]>();

  for (const rec of activeRecords) {
    if (rec.recordType === 'Work') {
      let bucketKey: string;
      if (calculateWeekly) {
        bucketKey = `${rec.userId}__week__${getWeekStartDateStr(rec.date, company.weekStartDay)}`;
      } else if (
        periodRangeOverride?.fromDate &&
        periodRangeOverride?.toDate &&
        rec.date >= periodRangeOverride.fromDate &&
        rec.date <= periodRangeOverride.toDate
      ) {
        bucketKey = `${rec.userId}__period__${periodRangeOverride.fromDate}_${periodRangeOverride.toDate}`;
      } else {
        const periodBounds = getPayPeriodRange(company, rec.date, 0);
        bucketKey = `${rec.userId}__period__${periodBounds.startDate}_${periodBounds.endDate}`;
      }
      const list = workByUserGroup.get(bucketKey) || [];
      list.push(rec);
      workByUserGroup.set(bucketKey, list);
    } else if (rec.recordType === 'Absence') {
      const hrs = Number(rec.absenceHours || 0);
      const isPaid = rec.isPaid !== false;
      const paidAbs = isPaid ? hrs : 0;
      const unpaidAbs = isPaid ? 0 : hrs;
      result.set(rec.id, {
        record: rec,
        workedHours: 0,
        lunchDeductedMins: 0,
        regHours: 0,
        otHours: 0,
        dtHours: 0,
        paidAbsenceHours: paidAbs,
        unpaidAbsenceHours: unpaidAbs,
        hoursAdjustment: 0,
        amountAdjustment: 0,
        paidHours: paidAbs,
        unpaidHours: unpaidAbs,
        totalHours: paidAbs + unpaidAbs,
        isOpenWork: false,
      });
    } else if (rec.recordType === 'Adjustment') {
      const val = Number(rec.adjustmentValue || 0);
      const signed = rec.adjustmentOp === 'Deduction' ? -val : val;
      const isHours = rec.adjustmentType !== 'Amount';
      const hrsAdj = isHours ? signed : 0;
      const amtAdj = isHours ? 0 : signed;
      result.set(rec.id, {
        record: rec,
        workedHours: 0,
        lunchDeductedMins: 0,
        regHours: 0,
        otHours: 0,
        dtHours: 0,
        paidAbsenceHours: 0,
        unpaidAbsenceHours: 0,
        hoursAdjustment: hrsAdj,
        amountAdjustment: amtAdj,
        paidHours: hrsAdj,
        unpaidHours: 0,
        totalHours: hrsAdj,
        isOpenWork: false,
      });
    }
  }

  // Allocate Reg (up to 8h/day when daily OT is enabled, and up to 40h per week/period) and OT chronologically per user bucket
  for (const [, weekRecords] of workByUserGroup.entries()) {
    weekRecords.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      const tA = a.timeIn || '';
      const tB = b.timeIn || '';
      if (tA !== tB) return tA.localeCompare(tB);
      return a.id.localeCompare(b.id);
    });

    let weeklyRegCandidateAccumulator = 0;
    const dailyWorkedByDate = new Map<string, number>();

    for (const rec of weekRecords) {
      const isOpen = Boolean(rec.workingNow || !rec.timeIn || !rec.timeOut);
      if (isOpen) {
        result.set(rec.id, {
          record: rec,
          workedHours: 0,
          lunchDeductedMins: 0,
          regHours: 0,
          otHours: 0,
          dtHours: 0,
          paidAbsenceHours: 0,
          unpaidAbsenceHours: 0,
          hoursAdjustment: 0,
          amountAdjustment: 0,
          paidHours: 0,
          unpaidHours: 0,
          totalHours: 0,
          isOpenWork: true,
        });
        continue;
      }

      let workedHours = rec.savedWorkedHours;
      let lunchDeductedMins = rec.savedLunchDeductedMins ?? 0;

      if (workedHours === undefined) {
        const snap = computeWorkRecordSnapshot(
          rec.timeIn,
          rec.timeOut,
          rec.lunchStart,
          rec.lunchEnd,
          rec.workingNow,
          company,
          usersById ? usersById[rec.userId] : undefined
        );
        workedHours = snap.workedHours;
        lunchDeductedMins = snap.lunchDeductedMins;
      }

      // 1. Daily Overtime (>8 hrs in a single day) if enabled
      let dailyRegCandidate = workedHours;
      let dailyOtHours = 0;
      if (calculateDaily) {
        const prevDayWorked = dailyWorkedByDate.get(rec.date) || 0;
        const remainingDailyReg = Math.max(0, 8 - prevDayWorked);
        dailyRegCandidate = Math.min(workedHours, remainingDailyReg);
        dailyOtHours = Math.max(0, workedHours - dailyRegCandidate);
        dailyWorkedByDate.set(rec.date, prevDayWorked + workedHours);
      }

      // 2. Weekly / Per-Period Overtime (>40 regular candidate hours)
      const remainingRegular = Math.max(0, 40 - weeklyRegCandidateAccumulator);
      const regHours = Math.min(dailyRegCandidate, remainingRegular);
      const bucketOtHours = Math.max(0, dailyRegCandidate - regHours);
      const otHours = dailyOtHours + bucketOtHours;
      weeklyRegCandidateAccumulator += dailyRegCandidate;

      result.set(rec.id, {
        record: rec,
        workedHours,
        lunchDeductedMins,
        regHours,
        otHours,
        dtHours: 0,
        paidAbsenceHours: 0,
        unpaidAbsenceHours: 0,
        hoursAdjustment: 0,
        amountAdjustment: 0,
        paidHours: regHours + otHours,
        unpaidHours: 0,
        totalHours: regHours + otHours,
        isOpenWork: false,
      });
    }
  }

  return result;
}

/**
 * Sum a list of EvaluatedRecords into a single CalculatedSummary
 */
export function summarizeEvaluatedRecords(records: EvaluatedRecord[]): CalculatedSummary {
  const summary: CalculatedSummary = {
    regHours: 0,
    otHours: 0,
    dtHours: 0,
    paidAbsenceHours: 0,
    unpaidAbsenceHours: 0,
    hoursAdjustment: 0,
    amountAdjustment: 0,
    paidHours: 0,
    unpaidHours: 0,
    totalHours: 0,
  };

  for (const item of records) {
    if (item.isOpenWork) continue;
    summary.regHours += item.regHours;
    summary.otHours += item.otHours;
    summary.dtHours += item.dtHours;
    summary.paidAbsenceHours += item.paidAbsenceHours;
    summary.unpaidAbsenceHours += item.unpaidAbsenceHours;
    summary.hoursAdjustment += item.hoursAdjustment;
    summary.amountAdjustment += item.amountAdjustment;
    summary.paidHours += item.paidHours;
    summary.unpaidHours += item.unpaidHours;
    summary.totalHours += item.totalHours;
  }

  return summary;
}

/**
 * Format numeric hours according to company.timeTotalsFormat ('2:30' | '2h 30m' | '2.50' | '2.500')
 */
export function formatHours(hours: number, format: TimeTotalsFormat = '2.50'): string {
  const safe = Number.isFinite(hours) ? hours : 0;
  const sign = safe < 0 ? '-' : '';
  const abs = Math.abs(safe);

  if (format === '2.500') {
    return `${sign}${abs.toFixed(3)}`;
  }
  if (format === '2.50') {
    return `${sign}${abs.toFixed(2)}`;
  }

  const totalMins = Math.round(abs * 60);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;

  if (format === '2:30') {
    return `${sign}${h}:${String(m).padStart(2, '0')}`;
  }
  if (format === '2h 30m') {
    return `${sign}${h}h ${String(m).padStart(2, '0')}m`;
  }
  return `${sign}${abs.toFixed(2)}`;
}

/**
 * Format "HH:mm" time according to company.timeFormat ('12-hour' | '24-hour')
 */
export function formatTimeDisplay(hhmm: string | undefined, timeFormat: '12-hour' | '24-hour' = '12-hour'): string {
  if (!hhmm) return '—';
  const mins = parseTimeToMinutes(hhmm);
  if (mins === null) return hhmm;
  const h24 = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  if (timeFormat === '24-hour') {
    return `${String(h24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * Format YYYY-MM-DD date according to company.dateFormat ('US' | 'Canada' | 'UK')
 */
export function formatDateDisplay(dateStr: string | undefined, dateFormat: 'US' | 'Canada' | 'UK' = 'US'): string {
  if (!dateStr) return '—';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const [yyyy, mm, dd] = parts;
  if (dateFormat === 'Canada') return `${yyyy}-${mm}-${dd}`;
  if (dateFormat === 'UK') return `${dd}/${mm}/${yyyy}`;
  return `${mm}/${dd}/${yyyy}`;
}

/**
 * Compute Pay Period bounds (startDate, endDate in YYYY-MM-DD) for a Company
 * anchored on company.payPeriodStartDate.
 */
export function getPayPeriodRange(
  company: Company,
  referenceDateStr: string,
  offsetPeriods = 0
): { startDate: string; endDate: string } {
  const anchorStr = company.payPeriodStartDate || '2026-10-11';
  const [ay, am, ad] = anchorStr.split('-').map(Number);
  const [ry, rm, rd] = referenceDateStr.split('-').map(Number);

  if (company.payPeriodType === 'Weekly' || company.payPeriodType === 'Bi-Weekly') {
    const periodDays = company.payPeriodType === 'Weekly' ? 7 : 14;
    const anchorMs = Date.UTC(ay, am - 1, ad);
    const refMs = Date.UTC(ry, rm - 1, rd);
    const diffDays = Math.floor((refMs - anchorMs) / (1000 * 60 * 60 * 24));
    const periodIndex = Math.floor(diffDays / periodDays) + offsetPeriods;
    const startDt = new Date(ay, am - 1, ad + periodIndex * periodDays);
    const endDt = new Date(ay, am - 1, ad + (periodIndex + 1) * periodDays - 1);
    return {
      startDate: formatDateISO(startDt),
      endDate: formatDateISO(endDt),
    };
  }

  if (company.payPeriodType === 'Semi-Monthly') {
    let year = ry;
    let month = rm - 1;
    let isFirstHalf = rd <= 15;
    let halfIndex = year * 24 + month * 2 + (isFirstHalf ? 0 : 1) + offsetPeriods;
    year = Math.floor(halfIndex / 24);
    const rem = ((halfIndex % 24) + 24) % 24;
    month = Math.floor(rem / 2);
    isFirstHalf = rem % 2 === 0;
    if (isFirstHalf) {
      return {
        startDate: formatDateISO(new Date(year, month, 1)),
        endDate: formatDateISO(new Date(year, month, 15)),
      };
    } else {
      return {
        startDate: formatDateISO(new Date(year, month, 16)),
        endDate: formatDateISO(new Date(year, month + 1, 0)),
      };
    }
  }

  // Monthly
  const startDt = new Date(ry, rm - 1 + offsetPeriods, 1);
  const endDt = new Date(ry, rm + offsetPeriods, 0);
  return {
    startDate: formatDateISO(startDt),
    endDate: formatDateISO(endDt),
  };
}

/**
 * List all YYYY-MM-DD dates in [startDate, endDate] inclusive
 */
export function listDatesInRange(startDate: string, endDate: string): string[] {
  if (!startDate || !endDate || startDate > endDate) return [];
  const dates: string[] = [];
  let curr = startDate;
  let safety = 0;
  while (curr <= endDate && safety < 366) {
    dates.push(curr);
    curr = addDaysISO(curr, 1);
    safety++;
  }
  return dates;
}
