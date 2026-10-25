import {
  AbsenceType,
  AdjustmentOperation,
  AdjustmentType,
  AppUser,
  Company,
  Department,
  NotificationEventType,
  NotificationLog,
  NotificationSettings,
  Role,
  TimeRecord,
  UserPermissions,
  UserStatus,
} from '../types/timeclock';
import {
  computeWorkRecordSnapshot,
  detectShiftFlags,
  formatDateISO,
  formatTimeDisplay,
  isRecordFullyApproved,
  parseTimeToMinutes,
  roundTimeHHMM,
} from './calculations';

const STORE_KEY = 'tsm_phase1_backoffice_store_v1';
const SESSION_KEY = 'tsm_phase1_current_session_v1';
const FAVORITE_REPORTS_KEY = 'tsm_phase1_favorite_reports_v1';

interface BackofficeStore {
  companies: Company[];
  departments: Department[];
  users: AppUser[];
  records: TimeRecord[];
  notificationSettings: Record<string, NotificationSettings>;
  notificationLogs: NotificationLog[];
  lastCreatedUserIdByCompany: Record<string, string>;
}

export function getAdminPermissions(): UserPermissions {
  return {
    allowEditOwnTime: true,
    allowComments: true,
    allowApproveRecords: true,
    allowViewReports: true,
    viewOwnPayRate: true,
    allowAddEntryRequest: true,
    allowAddAbsenceRequest: true,
    allowSeeWhoIsIn: true,
    accessCompanySettings: true,
    accessUsers: true,
    accessNotifications: true,
  };
}

export function getDefaultPermissionsForRole(role: Role): UserPermissions {
  if (role === 'Admin') {
    return getAdminPermissions();
  }
  if (role === 'Manager') {
    return {
      allowEditOwnTime: true,
      allowComments: true,
      allowApproveRecords: true,
      allowViewReports: true,
      viewOwnPayRate: true,
      allowAddEntryRequest: true,
      allowAddAbsenceRequest: true,
      allowSeeWhoIsIn: true,
      accessCompanySettings: false,
      accessUsers: true,
      accessNotifications: false,
    };
  }
  return {
    allowEditOwnTime: true,
    allowComments: true,
    allowApproveRecords: false,
    allowViewReports: false,
    viewOwnPayRate: true,
    allowAddEntryRequest: true,
    allowAddAbsenceRequest: true,
    allowSeeWhoIsIn: false,
    accessCompanySettings: false,
    accessUsers: false,
    accessNotifications: false,
  };
}

export function createDefaultNotificationSettings(companyId: string): NotificationSettings {
  return {
    companyId,
    masterEnabled: true,
    extraEmails: '',
    events: {
      'Clock IN': { enabled: true, toEmployee: false, toManagers: true, toAdmins: true },
      'Clock OUT': { enabled: true, toEmployee: false, toManagers: false, toAdmins: true },
      'Late IN': { enabled: true, toEmployee: true, toManagers: true, toAdmins: true },
      'Early OUT': { enabled: true, toEmployee: true, toManagers: true, toAdmins: true },
      'Forgot Clock In': { enabled: true, toEmployee: true, toManagers: true, toAdmins: true },
      'Manager Approve Timecard': { enabled: true, toEmployee: true, toManagers: false, toAdmins: true },
      'Employee Approve Timecard': { enabled: true, toEmployee: false, toManagers: true, toAdmins: true },
      'Daily Total': { enabled: false, toEmployee: true, toManagers: false, toAdmins: false },
      'Weekly Total': { enabled: false, toEmployee: true, toManagers: true, toAdmins: true },
    },
  };
}

function buildInitialSeedStore(): BackofficeStore {
  const companyId = 'comp_royal';
  const royalCompany: Company = {
    id: companyId,
    name: 'Royal Transportation',
    shortName: 'ROYAL',
    ownerEmail: 'alex@royal-trans.com',
    weekStartDay: 0, // Sunday
    payPeriodType: 'Bi-Weekly',
    payPeriodStartDate: '2026-10-11',
    defaultTimezone: 'America/New_York',
    dateFormat: 'US',
    timeFormat: '12-hour',
    timeTotalsFormat: '2.50',
    currencySymbol: '$',
    roundingInDir: 'NEAREST',
    roundingInMins: 1,
    roundingOutDir: 'NEAREST',
    roundingOutMins: 1,
    autoLunchMode: 'Yes',
    autoLunchMinutes: 30,
    autoLunchAfterHours: 6,
    defaultShiftStart: '09:00',
    defaultShiftEnd: '17:00',
    minLunchMinutes: 30,
    calculateOvertimeWeekly: true,
    highlightPublicHolidays: true,
    holidayCountry: 'US',
    approvalMode: 'Employee and Manager',
  };

  const departments: Department[] = [
    {
      id: 'dept_office',
      companyId,
      name: 'Office',
      code: 'OFF',
      managerIds: [],
    },
    {
      id: 'dept_dispatch',
      companyId,
      name: 'Dispatch',
      code: 'DSP',
      managerIds: ['user_manager1'],
    },
    {
      id: 'dept_drivers',
      companyId,
      name: 'Drivers',
      code: 'DRV',
      managerIds: ['user_manager1'],
    },
  ];

  const users: AppUser[] = [
    {
      id: 'user_admin1',
      companyId,
      firstName: 'Alex',
      lastName: 'Owner',
      fullName: 'Alex Owner',
      username: 'admin1',
      password: 'demo1234',
      employeeNumber: 'EMP-001',
      email: 'alex@royal-trans.com',
      mobilePhone: '555-0101',
      departmentId: 'dept_office',
      role: 'Admin',
      status: 'Active',
      archived: false,
      hireDate: '2024-01-15',
      employmentType: 'Full Time',
      rateType: 'Salary',
      payRate: 2500.0,
      timezone: 'Company default',
      autoLunchMode: 'Use company setting',
      autoLunchMinutes: 30,
      autoLunchAfterHours: 6,
      permissions: getAdminPermissions(),
    },
    {
      id: 'user_manager1',
      companyId,
      firstName: 'Maria',
      lastName: 'Manager',
      fullName: 'Maria Manager',
      username: 'manager1',
      password: 'demo1234',
      employeeNumber: 'EMP-002',
      email: 'maria@royal-trans.com',
      mobilePhone: '555-0102',
      departmentId: 'dept_dispatch',
      role: 'Manager',
      status: 'Active',
      archived: false,
      hireDate: '2024-03-01',
      employmentType: 'Full Time',
      rateType: 'Hourly',
      payRate: 32.0,
      timezone: 'Company default',
      autoLunchMode: 'Use company setting',
      autoLunchMinutes: 30,
      autoLunchAfterHours: 6,
      permissions: {
        allowEditOwnTime: true,
        allowComments: true,
        allowApproveRecords: true,
        allowViewReports: true,
        viewOwnPayRate: true,
        allowAddEntryRequest: true,
        allowAddAbsenceRequest: true,
        allowSeeWhoIsIn: true,
        accessCompanySettings: false,
        accessUsers: true,
        accessNotifications: false,
      },
    },
    {
      id: 'user_emp1',
      companyId,
      firstName: 'Emily',
      lastName: 'Employee',
      fullName: 'Emily Employee',
      username: 'emp1',
      password: 'demo1234',
      employeeNumber: 'EMP-003',
      email: 'emily@royal-trans.com',
      mobilePhone: '555-0103',
      departmentId: 'dept_office',
      role: 'Employee',
      status: 'Active',
      archived: false,
      hireDate: '2025-02-10',
      employmentType: 'Full Time',
      rateType: 'Hourly',
      payRate: 24.0,
      timezone: 'Company default',
      autoLunchMode: 'Use company setting',
      autoLunchMinutes: 30,
      autoLunchAfterHours: 6,
      permissions: {
        allowEditOwnTime: true,
        allowComments: true,
        allowApproveRecords: false,
        allowViewReports: false,
        viewOwnPayRate: true,
        allowAddEntryRequest: true,
        allowAddAbsenceRequest: true,
        allowSeeWhoIsIn: false,
        accessCompanySettings: false,
        accessUsers: false,
        accessNotifications: false,
      },
    },
    {
      id: 'user_emp2',
      companyId,
      firstName: 'David',
      lastName: 'Driver',
      fullName: 'David Driver',
      username: 'emp2',
      password: 'demo1234',
      employeeNumber: 'EMP-004',
      email: 'david@royal-trans.com',
      mobilePhone: '555-0104',
      departmentId: 'dept_drivers',
      role: 'Employee',
      status: 'Active',
      archived: false,
      hireDate: '2025-05-12',
      employmentType: 'Full Time',
      rateType: 'Hourly',
      payRate: 28.0,
      timezone: 'Company default',
      autoLunchMode: 'Use company setting',
      autoLunchMinutes: 30,
      autoLunchAfterHours: 6,
      permissions: {
        allowEditOwnTime: false,
        allowComments: true,
        allowApproveRecords: false,
        allowViewReports: false,
        viewOwnPayRate: true,
        allowAddEntryRequest: true,
        allowAddAbsenceRequest: true,
        allowSeeWhoIsIn: false,
        accessCompanySettings: false,
        accessUsers: false,
        accessNotifications: false,
      },
    },
    {
      id: 'user_emp3',
      companyId,
      firstName: 'Ian',
      lastName: 'Inactive',
      fullName: 'Ian Inactive',
      username: 'emp3',
      password: 'demo1234',
      employeeNumber: 'EMP-005',
      email: 'ian@royal-trans.com',
      mobilePhone: '555-0105',
      departmentId: 'dept_drivers',
      role: 'Employee',
      status: 'Inactive',
      archived: false,
      hireDate: '2024-08-20',
      employmentType: 'Part Time',
      rateType: 'Hourly',
      payRate: 22.0,
      timezone: 'Company default',
      autoLunchMode: 'Use company setting',
      autoLunchMinutes: 30,
      autoLunchAfterHours: 6,
      permissions: {
        allowEditOwnTime: false,
        allowComments: false,
        allowApproveRecords: false,
        allowViewReports: false,
        viewOwnPayRate: true,
        allowAddEntryRequest: false,
        allowAddAbsenceRequest: false,
        allowSeeWhoIsIn: false,
        accessCompanySettings: false,
        accessUsers: false,
        accessNotifications: false,
      },
    },
  ];

  // Seed ~10 work records + 1 Sick absence (paid, 8.00h) + 1 Adjustment (+0.50h) across emp1 & emp2
  // in the current pay period (2026-10-11 to 2026-10-24), with 2 records pending approval.
  const records: TimeRecord[] = [
    // emp1 — Emily Employee
    {
      id: 'rec_seed_1',
      companyId,
      userId: 'user_emp1',
      date: '2026-10-12',
      recordType: 'Work',
      rawTimeIn: '09:00',
      rawTimeOut: '17:30',
      timeIn: '09:00',
      timeOut: '17:30',
      workingNow: false,
      savedWorkedHours: 8.0,
      savedLunchDeductedMins: 30,
      lateIn: false,
      earlyOut: false,
      comment: 'Regular Monday shift',
      approvedByManager: true,
      approvedByEmployee: true,
      createdAt: '2026-10-12T17:30:00Z',
    },
    {
      id: 'rec_seed_2',
      companyId,
      userId: 'user_emp1',
      date: '2026-10-13',
      recordType: 'Work',
      rawTimeIn: '09:15',
      rawTimeOut: '17:30',
      timeIn: '09:15',
      timeOut: '17:30',
      workingNow: false,
      savedWorkedHours: 7.75,
      savedLunchDeductedMins: 30,
      lateIn: true, // Late IN (after 09:00 + 5m grace)
      earlyOut: false,
      comment: 'Traffic delay on I-95',
      approvedByManager: true,
      approvedByEmployee: true,
      createdAt: '2026-10-13T17:30:00Z',
    },
    {
      id: 'rec_seed_3',
      companyId,
      userId: 'user_emp1',
      date: '2026-10-14',
      recordType: 'Work',
      rawTimeIn: '09:00',
      rawTimeOut: '17:30',
      timeIn: '09:00',
      timeOut: '17:30',
      workingNow: false,
      savedWorkedHours: 8.0,
      savedLunchDeductedMins: 30,
      lateIn: false,
      earlyOut: false,
      comment: '',
      approvedByManager: true,
      approvedByEmployee: true,
      createdAt: '2026-10-14T17:30:00Z',
    },
    {
      id: 'rec_seed_4',
      companyId,
      userId: 'user_emp1',
      date: '2026-10-15',
      recordType: 'Absence',
      absenceType: 'Sick',
      absenceHours: 8.0,
      isPaid: true,
      comment: 'Medical appointment / Sick day',
      approvedByManager: true,
      approvedByEmployee: true,
      createdAt: '2026-10-15T09:00:00Z',
    },
    {
      id: 'rec_seed_5',
      companyId,
      userId: 'user_emp1',
      date: '2026-10-16',
      recordType: 'Work',
      rawTimeIn: '09:00',
      rawTimeOut: '16:30',
      timeIn: '09:00',
      timeOut: '16:30',
      workingNow: false,
      savedWorkedHours: 7.0,
      savedLunchDeductedMins: 30,
      lateIn: false,
      earlyOut: true, // Early OUT (before 17:00)
      comment: 'Left 30m early with notice',
      approvedByManager: true,
      approvedByEmployee: true,
      createdAt: '2026-10-16T16:30:00Z',
    },
    {
      id: 'rec_seed_6',
      companyId,
      userId: 'user_emp1',
      date: '2026-10-19',
      recordType: 'Work',
      rawTimeIn: '09:00',
      rawTimeOut: '17:30',
      timeIn: '09:00',
      timeOut: '17:30',
      workingNow: false,
      savedWorkedHours: 8.0,
      savedLunchDeductedMins: 30,
      lateIn: false,
      earlyOut: false,
      comment: '',
      approvedByManager: true,
      approvedByEmployee: true,
      createdAt: '2026-10-19T17:30:00Z',
    },
    {
      id: 'rec_seed_7',
      companyId,
      userId: 'user_emp1',
      date: '2026-10-20',
      recordType: 'Work',
      rawTimeIn: '09:00',
      rawTimeOut: '17:30',
      timeIn: '09:00',
      timeOut: '17:30',
      workingNow: false,
      savedWorkedHours: 8.0,
      savedLunchDeductedMins: 30,
      lateIn: false,
      earlyOut: false,
      comment: 'Pending manager review',
      approvedByManager: false, // PENDING APPROVAL #1
      approvedByEmployee: true,
      createdAt: '2026-10-20T17:30:00Z',
    },
    {
      id: 'rec_seed_8',
      companyId,
      userId: 'user_emp1',
      date: '2026-10-21',
      recordType: 'Adjustment',
      adjustmentType: 'Hours',
      adjustmentOp: 'Addition',
      adjustmentValue: 0.5,
      comment: 'Safety training completion credit',
      approvedByManager: true,
      approvedByEmployee: true,
      createdAt: '2026-10-21T12:00:00Z',
    },

    // emp2 — David Driver
    {
      id: 'rec_seed_9',
      companyId,
      userId: 'user_emp2',
      date: '2026-10-12',
      recordType: 'Work',
      rawTimeIn: '08:30',
      rawTimeOut: '17:00',
      timeIn: '08:30',
      timeOut: '17:00',
      workingNow: false,
      savedWorkedHours: 8.0,
      savedLunchDeductedMins: 30,
      lateIn: false,
      earlyOut: false,
      comment: 'Route A-101',
      approvedByManager: true,
      approvedByEmployee: true,
      createdAt: '2026-10-12T17:00:00Z',
    },
    {
      id: 'rec_seed_10',
      companyId,
      userId: 'user_emp2',
      date: '2026-10-13',
      recordType: 'Work',
      rawTimeIn: '08:30',
      rawTimeOut: '17:00',
      timeIn: '08:30',
      timeOut: '17:00',
      workingNow: false,
      savedWorkedHours: 8.0,
      savedLunchDeductedMins: 30,
      lateIn: false,
      earlyOut: false,
      comment: 'Route A-102',
      approvedByManager: true,
      approvedByEmployee: true,
      createdAt: '2026-10-13T17:00:00Z',
    },
    {
      id: 'rec_seed_11',
      companyId,
      userId: 'user_emp2',
      date: '2026-10-14',
      recordType: 'Work',
      rawTimeIn: '08:30',
      rawTimeOut: '17:00',
      timeIn: '08:30',
      timeOut: '17:00',
      workingNow: false,
      savedWorkedHours: 8.0,
      savedLunchDeductedMins: 30,
      lateIn: false,
      earlyOut: false,
      comment: 'Route A-103',
      approvedByManager: true,
      approvedByEmployee: true,
      createdAt: '2026-10-14T17:00:00Z',
    },
    {
      id: 'rec_seed_12',
      companyId,
      userId: 'user_emp2',
      date: '2026-10-19',
      recordType: 'Work',
      rawTimeIn: '08:30',
      rawTimeOut: '17:00',
      timeIn: '08:30',
      timeOut: '17:00',
      workingNow: false,
      savedWorkedHours: 8.0,
      savedLunchDeductedMins: 30,
      lateIn: false,
      earlyOut: false,
      comment: 'North corridor shuttle',
      approvedByManager: true,
      approvedByEmployee: true,
      createdAt: '2026-10-19T17:00:00Z',
    },
    {
      id: 'rec_seed_13',
      companyId,
      userId: 'user_emp2',
      date: '2026-10-20',
      recordType: 'Work',
      rawTimeIn: '08:30',
      rawTimeOut: '17:00',
      timeIn: '08:30',
      timeOut: '17:00',
      workingNow: false,
      savedWorkedHours: 8.0,
      savedLunchDeductedMins: 30,
      lateIn: false,
      earlyOut: false,
      comment: 'Airport charter run',
      approvedByManager: false, // PENDING APPROVAL #2
      approvedByEmployee: false,
      createdAt: '2026-10-20T17:00:00Z',
    },
  ];

  const notificationLogs: NotificationLog[] = [
    {
      id: 'notif_seed_1',
      companyId,
      timestamp: '2026-10-13T09:15:00Z',
      event: 'Late IN',
      employeeName: 'Emily Employee',
      userId: 'user_emp1',
      recipients: ['emily@royal-trans.com', 'maria@royal-trans.com', 'alex@royal-trans.com'],
      details: 'Clocked in at 9:15 AM (Shift start: 9:00 AM)',
    },
    {
      id: 'notif_seed_2',
      companyId,
      timestamp: '2026-10-16T16:30:00Z',
      event: 'Early OUT',
      employeeName: 'Emily Employee',
      userId: 'user_emp1',
      recipients: ['emily@royal-trans.com', 'maria@royal-trans.com', 'alex@royal-trans.com'],
      details: 'Clocked out at 4:30 PM (Shift end: 5:00 PM)',
    },
  ];

  return {
    companies: [royalCompany],
    departments,
    users,
    records,
    notificationSettings: {
      [companyId]: createDefaultNotificationSettings(companyId),
    },
    notificationLogs,
    lastCreatedUserIdByCompany: {
      [companyId]: 'user_emp2',
    },
  };
}

function loadStore(): BackofficeStore {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.companies) && parsed.companies.length > 0) {
        parsed.companies = parsed.companies.map((c: Company) => ({
          ...c,
          calculateOvertimeWeekly: c.calculateOvertimeWeekly !== false,
          calculateDailyOvertime: Boolean(c.calculateDailyOvertime),
          highlightPublicHolidays: c.highlightPublicHolidays !== false,
          holidayCountry: c.holidayCountry || 'US',
        }));
        return parsed;
      }
    }
  } catch (e) {
    console.error('Failed to read backoffice store, initializing seed data:', e);
  }
  const seeded = buildInitialSeedStore();
  saveStore(seeded);
  return seeded;
}

function saveStore(store: BackofficeStore): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
    window.dispatchEvent(new CustomEvent('tsm-store-updated'));
  } catch (e) {
    console.error('Failed to save backoffice store:', e);
  }
}

export function getTodayISO(): string {
  return formatDateISO(new Date());
}

// ============================================================================
// SESSION & AUTHENTICATION
// ============================================================================

export interface ActiveSession {
  userId: string;
  companyId: string;
  rememberMe: boolean;
}

export function getCurrentSessionUser(): { user: AppUser; company: Company } | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session: ActiveSession = JSON.parse(raw);
    const store = loadStore();
    const user = store.users.find(u => u.id === session.userId && u.companyId === session.companyId);
    const company = store.companies.find(c => c.id === session.companyId);
    if (!user || !company || user.status === 'Inactive' || user.archived) {
      return null;
    }
    if (user.role === 'Admin') {
      user.permissions = getAdminPermissions();
    }
    return { user, company };
  } catch {
    return null;
  }
}

export function signInUser(
  usernameOrEmail: string,
  password: string,
  rememberMe: boolean
): { ok: true; user: AppUser; company: Company } | { ok: false; error: string } {
  const cleanIdentifier = usernameOrEmail.trim().toLowerCase();
  if (!cleanIdentifier || !password) {
    return { ok: false, error: 'Please enter both your username/email and password.' };
  }

  const store = loadStore();
  const matched = store.users.find(
    u =>
      (u.username.toLowerCase() === cleanIdentifier ||
        (u.email && u.email.toLowerCase() === cleanIdentifier)) &&
      u.password === password
  );

  if (!matched) {
    return { ok: false, error: 'Invalid username or password' };
  }

  if (matched.status === 'Inactive' || matched.archived) {
    return {
      ok: false,
      error: 'This account is inactive and cannot sign in. Please contact your administrator.',
    };
  }

  const company = store.companies.find(c => c.id === matched.companyId);
  if (!company) {
    return { ok: false, error: 'Company account not found.' };
  }

  const session: ActiveSession = {
    userId: matched.id,
    companyId: company.id,
    rememberMe,
  };

  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  window.dispatchEvent(new CustomEvent('tsm-store-updated'));

  return { ok: true, user: matched, company };
}

export function signOutSession(): void {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new CustomEvent('tsm-store-updated'));
}

export function createBusinessAccount(input: {
  companyName: string;
  ownerFullName: string;
  ownerEmail: string;
  password: string;
  timezone: string;
}): { ok: true; user: AppUser; company: Company } | { ok: false; error: string } {
  const companyName = input.companyName.trim();
  const fullName = input.ownerFullName.trim();
  const email = input.ownerEmail.trim().toLowerCase();
  const password = input.password;
  const timezone = input.timezone || 'America/New_York';

  if (!companyName || !fullName || !email || !password) {
    return { ok: false, error: 'Please fill in all required fields.' };
  }

  const store = loadStore();
  const duplicateOwner = store.companies.some(c => c.ownerEmail.toLowerCase() === email) ||
    store.users.some(u => u.email && u.email.toLowerCase() === email);

  if (duplicateOwner) {
    return { ok: false, error: 'An account with that email address already exists.' };
  }

  const companyId = `comp_${Date.now()}`;
  const shortName = companyName
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 6)
    .toUpperCase() || 'COMP';

  const today = new Date();
  const sunday = new Date(today);
  sunday.setDate(today.getDate() - today.getDay());

  const newCompany: Company = {
    id: companyId,
    name: companyName,
    shortName,
    ownerEmail: email,
    weekStartDay: 0,
    payPeriodType: 'Bi-Weekly',
    payPeriodStartDate: formatDateISO(sunday),
    defaultTimezone: timezone,
    dateFormat: 'US',
    timeFormat: '12-hour',
    timeTotalsFormat: '2.50',
    currencySymbol: '$',
    roundingInDir: 'NEAREST',
    roundingInMins: 1,
    roundingOutDir: 'NEAREST',
    roundingOutMins: 1,
    autoLunchMode: 'No',
    autoLunchMinutes: 30,
    autoLunchAfterHours: 6,
    defaultShiftStart: '09:00',
    defaultShiftEnd: '17:00',
    minLunchMinutes: 30,
    calculateOvertimeWeekly: true,
    highlightPublicHolidays: true,
    holidayCountry: 'US',
    approvalMode: 'Employee and Manager',
  };

  const defaultDeptId = `dept_${Date.now()}`;
  const defaultDept: Department = {
    id: defaultDeptId,
    companyId,
    name: 'General',
    code: 'GEN',
    managerIds: [],
  };

  const nameParts = fullName.split(/\s+/);
  const firstName = nameParts[0] || fullName;
  const lastName = nameParts.slice(1).join(' ') || '';

  const baseUsername = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '') || 'owner';
  const adminUser: AppUser = {
    id: `user_${Date.now()}`,
    companyId,
    firstName,
    lastName,
    fullName,
    username: baseUsername,
    password,
    employeeNumber: 'EMP-001',
    email,
    mobilePhone: '',
    departmentId: defaultDeptId,
    role: 'Admin',
    status: 'Active',
    archived: false,
    hireDate: formatDateISO(today),
    employmentType: 'Full Time',
    rateType: 'Salary',
    payRate: 0,
    timezone: 'Company default',
    autoLunchMode: 'Use company setting',
    autoLunchMinutes: 30,
    autoLunchAfterHours: 6,
    permissions: getAdminPermissions(),
  };

  store.companies.push(newCompany);
  store.departments.push(defaultDept);
  store.users.push(adminUser);
  store.notificationSettings[companyId] = createDefaultNotificationSettings(companyId);
  store.lastCreatedUserIdByCompany[companyId] = adminUser.id;
  saveStore(store);

  const session: ActiveSession = {
    userId: adminUser.id,
    companyId,
    rememberMe: true,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));

  return { ok: true, user: adminUser, company: newCompany };
}

// ============================================================================
// COMPANIES
// ============================================================================

export function getCompanyById(companyId: string): Company | null {
  const store = loadStore();
  return store.companies.find(c => c.id === companyId) || null;
}

export function updateCompanySettings(
  companyId: string,
  updates: Partial<Company>
): { ok: true; company: Company } | { ok: false; error: string } {
  const store = loadStore();
  const idx = store.companies.findIndex(c => c.id === companyId);
  if (idx === -1) return { ok: false, error: 'Company not found.' };

  const updated: Company = {
    ...store.companies[idx],
    ...updates,
    id: companyId,
  };
  store.companies[idx] = updated;
  saveStore(store);

  return { ok: true, company: updated };
}

export function syncOvertimeCalculationMode(
  calculateOvertimeWeekly: boolean
): void {
  const store = loadStore();
  store.companies = store.companies.map(c => ({
    ...c,
    calculateOvertimeWeekly,
  }));
  saveStore(store);
}

export function syncPublicHolidaySettings(
  highlightPublicHolidays: boolean,
  holidayCountry: 'US' | 'CA' | 'GB' | 'AU' | 'MX' | 'PR' | 'DO'
): void {
  const store = loadStore();
  store.companies = store.companies.map(c => ({
    ...c,
    highlightPublicHolidays,
    holidayCountry,
  }));
  saveStore(store);
}

// ============================================================================
// USERS
// ============================================================================

export function getUsers(companyId: string, options?: { includeArchived?: boolean }): AppUser[] {
  const store = loadStore();
  return store.users
    .filter(u => u.companyId === companyId && (options?.includeArchived ? true : !u.archived))
    .map(u => (u.role === 'Admin' ? { ...u, permissions: getAdminPermissions() } : u));
}

export function getLastCreatedOrEditedUser(companyId: string): AppUser | null {
  const store = loadStore();
  const lastId = store.lastCreatedUserIdByCompany[companyId];
  if (lastId) {
    const found = store.users.find(u => u.id === lastId && u.companyId === companyId);
    if (found) return found;
  }
  const companyUsers = store.users.filter(u => u.companyId === companyId);
  return companyUsers[companyUsers.length - 1] || null;
}

export function saveUser(
  companyId: string,
  userInput: Partial<AppUser> & { firstName: string; username: string },
  existingUserId?: string
): { ok: true; user: AppUser } | { ok: false; error: string } {
  const firstName = (userInput.firstName || '').trim();
  const lastName = (userInput.lastName || '').trim();
  const username = (userInput.username || '').trim();

  if (!firstName) {
    return { ok: false, error: 'First Name is required.' };
  }
  if (!username) {
    return { ok: false, error: 'Username is required.' };
  }

  const store = loadStore();
  const duplicateUsername = store.users.some(
    u =>
      u.companyId === companyId &&
      u.id !== existingUserId &&
      u.username.toLowerCase() === username.toLowerCase()
  );

  if (duplicateUsername) {
    return { ok: false, error: 'That username is taken' };
  }

  const role: Role = userInput.role || 'Employee';
  const permissions: UserPermissions =
    role === 'Admin'
      ? getAdminPermissions()
      : userInput.permissions || getDefaultPermissionsForRole(role);

  const fullName = `${firstName}${lastName ? ` ${lastName}` : ''}`;

  if (existingUserId) {
    const idx = store.users.findIndex(u => u.id === existingUserId && u.companyId === companyId);
    if (idx === -1) return { ok: false, error: 'User not found.' };
    const existing = store.users[idx];
    const updated: AppUser = {
      ...existing,
      ...userInput,
      firstName,
      lastName,
      fullName,
      username,
      password: userInput.password ? userInput.password : existing.password,
      role,
      permissions,
      id: existing.id,
      companyId,
    };
    store.users[idx] = updated;
    store.lastCreatedUserIdByCompany[companyId] = updated.id;
    saveStore(store);
    return { ok: true, user: updated };
  } else {
    const newUser: AppUser = {
      id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      companyId,
      firstName,
      lastName,
      fullName,
      username,
      password: userInput.password || 'welcome123',
      employeeNumber: userInput.employeeNumber || '',
      email: userInput.email || '',
      mobilePhone: userInput.mobilePhone || '',
      departmentId: userInput.departmentId || store.departments.find(d => d.companyId === companyId)?.id || '',
      role,
      status: userInput.status || 'Active',
      archived: false,
      hireDate: userInput.hireDate || getTodayISO(),
      employmentType: userInput.employmentType || 'Full Time',
      rateType: userInput.rateType || 'Hourly',
      payRate: Number(userInput.payRate) || 0,
      timezone: userInput.timezone || 'Company default',
      autoLunchMode: userInput.autoLunchMode || 'Use company setting',
      autoLunchMinutes: Number(userInput.autoLunchMinutes ?? 30),
      autoLunchAfterHours: Number(userInput.autoLunchAfterHours ?? 6),
      permissions,
    };
    store.users.push(newUser);
    store.lastCreatedUserIdByCompany[companyId] = newUser.id;
    saveStore(store);
    return { ok: true, user: newUser };
  }
}

export function bulkUpdateUsers(
  companyId: string,
  userIds: string[],
  updates: { departmentId?: string; role?: Role; status?: UserStatus }
): void {
  const store = loadStore();
  for (const u of store.users) {
    if (u.companyId === companyId && userIds.includes(u.id)) {
      if (updates.departmentId !== undefined && updates.departmentId !== '') {
        u.departmentId = updates.departmentId;
      }
      if (updates.role !== undefined) {
        u.role = updates.role;
        if (u.role === 'Admin') {
          u.permissions = getAdminPermissions();
        }
      }
      if (updates.status !== undefined) {
        u.status = updates.status;
      }
    }
  }
  saveStore(store);
}

export function setUsersArchived(companyId: string, userIds: string[], archived: boolean): void {
  const store = loadStore();
  for (const u of store.users) {
    if (u.companyId === companyId && userIds.includes(u.id)) {
      u.archived = archived;
    }
  }
  saveStore(store);
}

export function deleteUser(
  companyId: string,
  userId: string
): { ok: true } | { ok: false; error: string } {
  const store = loadStore();
  const user = store.users.find(u => u.id === userId && u.companyId === companyId);
  if (!user) return { ok: false, error: 'User not found.' };

  const hasRecords = store.records.some(r => r.companyId === companyId && r.userId === userId);
  if (hasRecords) {
    return {
      ok: false,
      error: `Cannot delete ${user.fullName} because they have time records on file. Please archive this user instead so their historical records remain intact.`,
    };
  }

  store.users = store.users.filter(u => !(u.id === userId && u.companyId === companyId));
  saveStore(store);
  return { ok: true };
}

// ============================================================================
// DEPARTMENTS
// ============================================================================

export function getDepartments(companyId: string): Department[] {
  const store = loadStore();
  return store.departments.filter(d => d.companyId === companyId);
}

export function saveDepartment(
  companyId: string,
  input: { name: string; code?: string; managerIds?: string[] },
  existingDeptId?: string
): { ok: true; department: Department } | { ok: false; error: string } {
  const name = (input.name || '').trim();
  const code = (input.code || '').trim();
  if (!name) return { ok: false, error: 'Department Name is required.' };

  const store = loadStore();
  const duplicate = store.departments.some(
    d =>
      d.companyId === companyId &&
      d.id !== existingDeptId &&
      d.name.toLowerCase() === name.toLowerCase()
  );
  if (duplicate) {
    return { ok: false, error: 'A department with that name already exists.' };
  }

  if (existingDeptId) {
    const idx = store.departments.findIndex(d => d.id === existingDeptId && d.companyId === companyId);
    if (idx === -1) return { ok: false, error: 'Department not found.' };
    store.departments[idx] = {
      ...store.departments[idx],
      name,
      code,
      managerIds: input.managerIds ?? store.departments[idx].managerIds,
    };
    saveStore(store);
    return { ok: true, department: store.departments[idx] };
  } else {
    const dept: Department = {
      id: `dept_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      companyId,
      name,
      code,
      managerIds: input.managerIds || [],
    };
    store.departments.push(dept);
    saveStore(store);
    return { ok: true, department: dept };
  }
}

export function deleteDepartment(
  companyId: string,
  departmentId: string
): { ok: true } | { ok: false; error: string } {
  const store = loadStore();
  const assignedUsers = store.users.filter(
    u => u.companyId === companyId && u.departmentId === departmentId && !u.archived
  );
  if (assignedUsers.length > 0) {
    return {
      ok: false,
      error: `Cannot delete this department while ${assignedUsers.length} user(s) are assigned to it. Please reassign those users first.`,
    };
  }
  store.departments = store.departments.filter(
    d => !(d.companyId === companyId && d.id === departmentId)
  );
  saveStore(store);
  return { ok: true };
}

export function assignUsersToDepartment(
  companyId: string,
  departmentId: string,
  userIdsToAssign: string[]
): void {
  const store = loadStore();
  for (const u of store.users) {
    if (u.companyId === companyId && userIdsToAssign.includes(u.id)) {
      u.departmentId = departmentId;
    }
  }
  saveStore(store);
}

export function removeUserFromDepartment(
  companyId: string,
  departmentId: string,
  userId: string
): void {
  const store = loadStore();
  const user = store.users.find(
    u => u.companyId === companyId && u.id === userId && u.departmentId === departmentId
  );
  if (user) {
    user.departmentId = '';
    saveStore(store);
  }
}

export function setDepartmentManagers(
  companyId: string,
  departmentId: string,
  managerIds: string[]
): void {
  const store = loadStore();
  const dept = store.departments.find(d => d.companyId === companyId && d.id === departmentId);
  if (dept) {
    dept.managerIds = managerIds;
    saveStore(store);
  }
}

export function importDepartmentsFromRows(
  companyId: string,
  rows: Array<{ name?: string; code?: string }>
): { imported: number; errors: string[] } {
  let imported = 0;
  const errors: string[] = [];
  rows.forEach((row, idx) => {
    const name = (row.name || '').trim();
    const code = (row.code || '').trim();
    if (!name) {
      errors.push(`Row ${idx + 1}: Missing Department Name.`);
      return;
    }
    const res = saveDepartment(companyId, { name, code });
    if (res.ok) {
      imported++;
    } else {
      errors.push(`Row ${idx + 1} (${name}): ${res.error}`);
    }
  });
  return { imported, errors };
}

// ============================================================================
// NOTIFICATIONS
// ============================================================================

export function getNotificationSettings(companyId: string): NotificationSettings {
  const store = loadStore();
  if (!store.notificationSettings[companyId]) {
    store.notificationSettings[companyId] = createDefaultNotificationSettings(companyId);
    saveStore(store);
  }
  return store.notificationSettings[companyId];
}

export function saveNotificationSettings(
  companyId: string,
  settings: NotificationSettings
): NotificationSettings {
  const store = loadStore();
  store.notificationSettings[companyId] = { ...settings, companyId };
  saveStore(store);
  return store.notificationSettings[companyId];
}

export function getNotificationLogs(companyId: string): NotificationLog[] {
  const store = loadStore();
  return store.notificationLogs
    .filter(l => l.companyId === companyId)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

function dispatchNotificationInternal(
  store: BackofficeStore,
  companyId: string,
  event: NotificationEventType,
  user: AppUser,
  details: string
): void {
  const settings =
    store.notificationSettings[companyId] || createDefaultNotificationSettings(companyId);
  if (!settings.masterEnabled) return;

  const rule = settings.events[event];
  if (!rule || !rule.enabled) return;

  const recipients = new Set<string>();

  if (rule.toEmployee) {
    recipients.add(user.email || `${user.username}@company.local`);
  }
  if (rule.toManagers) {
    const managers = store.users.filter(
      u => u.companyId === companyId && u.role === 'Manager' && u.status === 'Active' && !u.archived
    );
    managers.forEach(m => recipients.add(m.email || `${m.username}@company.local`));
  }
  if (rule.toAdmins) {
    const admins = store.users.filter(
      u => u.companyId === companyId && u.role === 'Admin' && u.status === 'Active' && !u.archived
    );
    admins.forEach(a => recipients.add(a.email || `${a.username}@company.local`));
  }
  if (settings.extraEmails) {
    settings.extraEmails
      .split(/[;,]/)
      .map(s => s.trim())
      .filter(Boolean)
      .forEach(e => recipients.add(e));
  }

  const recipientList = Array.from(recipients);
  if (recipientList.length === 0) {
    recipientList.push('admin@company.local');
  }

  store.notificationLogs.unshift({
    id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    companyId,
    timestamp: new Date().toISOString(),
    event,
    employeeName: user.fullName,
    userId: user.id,
    recipients: recipientList,
    details,
  });
}

export function evaluateForgotClockInNotifications(companyId: string): void {
  const store = loadStore();
  const company = store.companies.find(c => c.id === companyId);
  if (!company) return;

  const settings =
    store.notificationSettings[companyId] || createDefaultNotificationSettings(companyId);
  if (!settings.masterEnabled || !settings.events['Forgot Clock In']?.enabled) return;

  const now = new Date();
  const dayOfWeek = now.getDay();
  // Weekday check (Mon=1..Fri=5)
  if (dayOfWeek === 0 || dayOfWeek === 6) return;

  const currentMins = now.getHours() * 60 + now.getMinutes();
  const shiftStartMins = parseTimeToMinutes(company.defaultShiftStart) ?? 540;
  if (currentMins < shiftStartMins + 60) return;

  const todayStr = formatDateISO(now);
  const activeEmployees = store.users.filter(
    u =>
      u.companyId === companyId &&
      u.status === 'Active' &&
      !u.archived &&
      u.role === 'Employee'
  );

  let added = false;
  for (const emp of activeEmployees) {
    const hasEntryToday = store.records.some(
      r => r.companyId === companyId && r.userId === emp.id && r.date === todayStr
    );
    if (!hasEntryToday) {
      const alreadyLoggedToday = store.notificationLogs.some(
        l =>
          l.companyId === companyId &&
          l.userId === emp.id &&
          l.event === 'Forgot Clock In' &&
          l.timestamp.startsWith(todayStr)
      );
      if (!alreadyLoggedToday) {
        dispatchNotificationInternal(
          store,
          companyId,
          'Forgot Clock In',
          emp,
          `No clock-in recorded by ${formatTimeDisplay(company.defaultShiftStart, company.timeFormat)} + 60 min on ${todayStr}`
        );
        added = true;
      }
    }
  }
  if (added) {
    saveStore(store);
  }
}

// ============================================================================
// TIME RECORDS & PUNCH CLOCK
// ============================================================================

export function getTimeRecords(companyId: string): TimeRecord[] {
  const store = loadStore();
  return store.records.filter(r => r.companyId === companyId);
}

/**
 * Add Work Entry for one or multiple employees (Part D2)
 */
export function createWorkEntries(
  companyId: string,
  input: {
    userIds: string[];
    date: string;
    timeIn: string;
    timeOut?: string;
    lunchStart?: string;
    lunchEnd?: string;
    workingNow?: boolean;
    comment?: string;
    requestStatus?: 'Approved' | 'Pending';
  }
): { ok: true; created: TimeRecord[] } | { ok: false; error: string } {
  if (!input.userIds || input.userIds.length === 0) {
    return { ok: false, error: 'Please select at least one employee.' };
  }
  if (!input.date) {
    return { ok: false, error: 'Please select a date.' };
  }
  if (!input.timeIn) {
    return { ok: false, error: 'Please enter a Clock In time.' };
  }
  if (!input.workingNow && !input.timeOut) {
    return { ok: false, error: 'Please enter a Clock Out time or check "Working Now".' };
  }

  const store = loadStore();
  const company = store.companies.find(c => c.id === companyId);
  if (!company) return { ok: false, error: 'Company not found.' };

  const created: TimeRecord[] = [];

  for (const userId of input.userIds) {
    const user = store.users.find(u => u.id === userId && u.companyId === companyId);
    if (!user) continue;

    const roundedIn = roundTimeHHMM(input.timeIn, company.roundingInDir, company.roundingInMins);
    const roundedOut = input.workingNow
      ? ''
      : roundTimeHHMM(input.timeOut, company.roundingOutDir, company.roundingOutMins);

    const { workedHours, lunchDeductedMins } = computeWorkRecordSnapshot(
      roundedIn,
      roundedOut,
      input.lunchStart,
      input.lunchEnd,
      input.workingNow,
      company,
      user
    );

    const { lateIn, earlyOut } = detectShiftFlags(
      roundedIn,
      input.workingNow ? undefined : roundedOut,
      company
    );

    const rec: TimeRecord = {
      id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      companyId,
      userId,
      date: input.date,
      recordType: 'Work',
      rawTimeIn: input.timeIn,
      rawTimeOut: input.workingNow ? '' : input.timeOut,
      timeIn: roundedIn,
      timeOut: roundedOut,
      lunchStart: input.lunchStart || '',
      lunchEnd: input.lunchEnd || '',
      workingNow: Boolean(input.workingNow),
      savedWorkedHours: workedHours,
      savedLunchDeductedMins: lunchDeductedMins,
      lateIn,
      earlyOut,
      comment: input.comment || '',
      approvedByManager: false,
      approvedByEmployee: false,
      requestStatus: input.requestStatus || 'Approved',
      createdAt: new Date().toISOString(),
    };

    store.records.push(rec);
    created.push(rec);
  }

  saveStore(store);
  return { ok: true, created };
}

/**
 * Add Absence for one or multiple employees (Part D2)
 */
export function createAbsenceEntries(
  companyId: string,
  input: {
    userIds: string[];
    date: string;
    absenceType: AbsenceType;
    hours: number;
    isPaid: boolean;
    comment?: string;
    requestStatus?: 'Approved' | 'Pending';
  }
): { ok: true; created: TimeRecord[] } | { ok: false; error: string } {
  if (!input.userIds || input.userIds.length === 0) {
    return { ok: false, error: 'Please select at least one employee.' };
  }
  if (!input.date) {
    return { ok: false, error: 'Please select a date.' };
  }
  const hours = Number(input.hours);
  if (isNaN(hours) || hours <= 0) {
    return { ok: false, error: 'Please enter valid absence hours greater than 0.' };
  }

  const store = loadStore();
  const created: TimeRecord[] = [];

  for (const userId of input.userIds) {
    const rec: TimeRecord = {
      id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      companyId,
      userId,
      date: input.date,
      recordType: 'Absence',
      absenceType: input.absenceType,
      absenceHours: hours,
      isPaid: input.isPaid,
      comment: input.comment || '',
      approvedByManager: false,
      approvedByEmployee: false,
      requestStatus: input.requestStatus || 'Approved',
      createdAt: new Date().toISOString(),
    };
    store.records.push(rec);
    created.push(rec);
  }

  saveStore(store);
  return { ok: true, created };
}

/**
 * Add Adjustment entry (Part D2)
 */
export function createAdjustmentEntry(
  companyId: string,
  input: {
    userId: string;
    date: string;
    adjustmentType: AdjustmentType;
    adjustmentOp: AdjustmentOperation;
    value: number;
    comment?: string;
  }
): { ok: true; record: TimeRecord } | { ok: false; error: string } {
  if (!input.userId) return { ok: false, error: 'Please select an employee.' };
  if (!input.date) return { ok: false, error: 'Please select a date.' };
  const val = Number(input.value);
  if (isNaN(val) || val <= 0) {
    return { ok: false, error: 'Please enter a valid positive adjustment value.' };
  }

  const store = loadStore();
  const rec: TimeRecord = {
    id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    companyId,
    userId: input.userId,
    date: input.date,
    recordType: 'Adjustment',
    adjustmentType: input.adjustmentType,
    adjustmentOp: input.adjustmentOp,
    adjustmentValue: val,
    comment: input.comment || '',
    approvedByManager: false,
    approvedByEmployee: false,
    requestStatus: 'Approved',
    createdAt: new Date().toISOString(),
  };

  store.records.push(rec);
  saveStore(store);
  return { ok: true, record: rec };
}

/**
 * Edit / re-save an existing TimeRecord.
 * Enforces lock if Fully Approved, and re-calculates totals using current Company Settings on re-save (D6).
 * If edited by an employee, clears approvedByManager (G2).
 */
export function updateTimeRecord(
  companyId: string,
  recordId: string,
  updates: Partial<TimeRecord>,
  options?: { editedByEmployee?: boolean }
): { ok: true; record: TimeRecord } | { ok: false; error: string } {
  const store = loadStore();
  const company = store.companies.find(c => c.id === companyId);
  if (!company) return { ok: false, error: 'Company not found.' };

  const idx = store.records.findIndex(r => r.id === recordId && r.companyId === companyId);
  if (idx === -1) return { ok: false, error: 'Time record not found.' };

  const existing = store.records[idx];
  if (isRecordFullyApproved(existing, company)) {
    return {
      ok: false,
      error: 'Fully approved records are locked — unapprove to edit.',
    };
  }

  const user = store.users.find(u => u.id === existing.userId && u.companyId === companyId);
  const next: TimeRecord = {
    ...existing,
    ...updates,
  };

  if (options?.editedByEmployee) {
    next.approvedByManager = false;
  }

  if (next.recordType === 'Work') {
    const rawIn = updates.timeIn !== undefined ? updates.timeIn : next.timeIn;
    const rawOut = updates.timeOut !== undefined ? updates.timeOut : next.timeOut;
    const roundedIn = rawIn
      ? roundTimeHHMM(rawIn, company.roundingInDir, company.roundingInMins)
      : '';
    const roundedOut =
      next.workingNow || !rawOut
        ? ''
        : roundTimeHHMM(rawOut, company.roundingOutDir, company.roundingOutMins);

    next.timeIn = roundedIn;
    next.timeOut = roundedOut;

    const snap = computeWorkRecordSnapshot(
      roundedIn,
      roundedOut,
      next.lunchStart,
      next.lunchEnd,
      next.workingNow,
      company,
      user
    );
    next.savedWorkedHours = snap.workedHours;
    next.savedLunchDeductedMins = snap.lunchDeductedMins;

    const flags = detectShiftFlags(roundedIn, next.workingNow ? undefined : roundedOut, company);
    next.lateIn = flags.lateIn;
    next.earlyOut = flags.earlyOut;
  }

  store.records[idx] = next;
  saveStore(store);
  return { ok: true, record: next };
}

export function deleteTimeRecords(
  companyId: string,
  recordIds: string[]
): { ok: true; deletedCount: number } | { ok: false; error: string } {
  const store = loadStore();
  const company = store.companies.find(c => c.id === companyId);
  if (!company) return { ok: false, error: 'Company not found.' };

  const toDelete = store.records.filter(r => r.companyId === companyId && recordIds.includes(r.id));
  const locked = toDelete.find(r => isRecordFullyApproved(r, company));
  if (locked) {
    return {
      ok: false,
      error: 'Fully approved records are locked — unapprove to edit or delete.',
    };
  }

  const before = store.records.length;
  store.records = store.records.filter(r => !(r.companyId === companyId && recordIds.includes(r.id)));
  const deletedCount = before - store.records.length;
  saveStore(store);
  return { ok: true, deletedCount };
}

/**
 * Approve or Unapprove records by Manager OR Employee independently (Part D7, G4, F1)
 */
export function setRecordsApproval(
  companyId: string,
  recordIds: string[],
  changes: { approvedByManager?: boolean; approvedByEmployee?: boolean }
): void {
  const store = loadStore();
  const countByUser = new Map<string, number>();

  for (const r of store.records) {
    if (r.companyId === companyId && recordIds.includes(r.id)) {
      if (r.requestStatus === 'Pending' && changes.approvedByManager === true) {
        r.requestStatus = 'Approved';
      }
      if (changes.approvedByManager !== undefined) {
        r.approvedByManager = changes.approvedByManager;
      }
      if (changes.approvedByEmployee !== undefined) {
        r.approvedByEmployee = changes.approvedByEmployee;
      }
      countByUser.set(r.userId, (countByUser.get(r.userId) || 0) + 1);
    }
  }

  // Trigger per-column notifications for approve and unapprove actions separately
  for (const [userId, userRecCount] of countByUser.entries()) {
    const user = store.users.find(u => u.id === userId && u.companyId === companyId);
    if (!user) continue;
    if (changes.approvedByManager === true) {
      dispatchNotificationInternal(
        store,
        companyId,
        'Manager Approve Timecard',
        user,
        `Manager approved ${userRecCount} time record(s) for ${user.fullName}`
      );
    } else if (changes.approvedByManager === false) {
      dispatchNotificationInternal(
        store,
        companyId,
        'Manager Approve Timecard',
        user,
        `Manager unapproved ${userRecCount} time record(s) for ${user.fullName}`
      );
    }
    if (changes.approvedByEmployee === true) {
      dispatchNotificationInternal(
        store,
        companyId,
        'Employee Approve Timecard',
        user,
        `Employee approved their timecard (${userRecCount} record(s))`
      );
    } else if (changes.approvedByEmployee === false) {
      dispatchNotificationInternal(
        store,
        companyId,
        'Employee Approve Timecard',
        user,
        `Employee unapproved their timecard (${userRecCount} record(s))`
      );
    }
  }

  saveStore(store);
}

/**
 * Approve or Deny an employee's pending Entry / Absence Request (Part G3)
 */
export function resolveEmployeeRequest(
  companyId: string,
  recordId: string,
  decision: 'Approve' | 'Deny'
): void {
  const store = loadStore();
  const idx = store.records.findIndex(r => r.id === recordId && r.companyId === companyId);
  if (idx === -1) return;

  const rec = store.records[idx];
  const user = store.users.find(u => u.id === rec.userId && u.companyId === companyId);

  if (decision === 'Approve') {
    rec.requestStatus = 'Approved';
    rec.approvedByManager = true;
    if (user) {
      dispatchNotificationInternal(
        store,
        companyId,
        'Manager Approve Timecard',
        user,
        `Manager approved requested ${rec.recordType.toLowerCase()} on ${rec.date}`
      );
    }
  } else {
    store.records.splice(idx, 1);
    if (user) {
      store.notificationLogs.unshift({
        id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        companyId,
        timestamp: new Date().toISOString(),
        event: 'Request Denied',
        employeeName: user.fullName,
        userId: user.id,
        recipients: [user.email || `${user.username}@company.local`],
        details: `Manager denied requested ${rec.recordType.toLowerCase()} on ${rec.date}`,
      });
    }
  }

  saveStore(store);
}

/**
 * Web Punch Clock actions (Part F): CLOCK IN & CLOCK OUT
 */
export function getActiveOpenRecordForUser(companyId: string, userId: string): TimeRecord | null {
  const store = loadStore();
  return (
    store.records.find(
      r =>
        r.companyId === companyId &&
        r.userId === userId &&
        r.recordType === 'Work' &&
        (r.workingNow || !r.timeOut) &&
        r.requestStatus !== 'Pending' &&
        r.requestStatus !== 'Denied'
    ) || null
  );
}

export function punchClockIn(
  companyId: string,
  userId: string,
  comment?: string
): { ok: true; record: TimeRecord } | { ok: false; error: string } {
  const store = loadStore();
  const company = store.companies.find(c => c.id === companyId);
  const user = store.users.find(u => u.id === userId && u.companyId === companyId);
  if (!company || !user) return { ok: false, error: 'User or company not found.' };
  if (user.status === 'Inactive' || user.archived) {
    return { ok: false, error: 'Inactive users cannot clock in.' };
  }

  const existingOpen = store.records.find(
    r =>
      r.companyId === companyId &&
      r.userId === userId &&
      r.recordType === 'Work' &&
      (r.workingNow || !r.timeOut) &&
      r.requestStatus !== 'Pending'
  );
  if (existingOpen) {
    return { ok: false, error: 'You are already clocked in.' };
  }

  const now = new Date();
  const rawHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const dateStr = formatDateISO(now);

  const roundedIn = roundTimeHHMM(rawHHMM, company.roundingInDir, company.roundingInMins);
  const { lateIn } = detectShiftFlags(roundedIn, undefined, company);

  const newRecord: TimeRecord = {
    id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    companyId,
    userId,
    date: dateStr,
    recordType: 'Work',
    rawTimeIn: rawHHMM,
    rawTimeOut: '',
    timeIn: roundedIn,
    timeOut: '',
    workingNow: true,
    savedWorkedHours: 0,
    savedLunchDeductedMins: 0,
    lateIn,
    earlyOut: false,
    comment: user.permissions.allowComments && comment ? comment.trim() : '',
    approvedByManager: false,
    approvedByEmployee: false,
    requestStatus: 'Approved',
    createdAt: now.toISOString(),
  };

  store.records.push(newRecord);

  // Fire Clock IN notification
  dispatchNotificationInternal(
    store,
    companyId,
    'Clock IN',
    user,
    `Clocked in at ${formatTimeDisplay(roundedIn, company.timeFormat)} on ${dateStr}`
  );

  // Fire Late IN notification if applicable
  if (lateIn) {
    dispatchNotificationInternal(
      store,
      companyId,
      'Late IN',
      user,
      `Late clock-in at ${formatTimeDisplay(roundedIn, company.timeFormat)} (Shift start: ${formatTimeDisplay(company.defaultShiftStart, company.timeFormat)})`
    );
  }

  saveStore(store);
  return { ok: true, record: newRecord };
}

export function punchClockOut(
  companyId: string,
  userId: string,
  comment?: string
): { ok: true; record: TimeRecord } | { ok: false; error: string } {
  const store = loadStore();
  const company = store.companies.find(c => c.id === companyId);
  const user = store.users.find(u => u.id === userId && u.companyId === companyId);
  if (!company || !user) return { ok: false, error: 'User or company not found.' };

  const idx = store.records.findIndex(
    r =>
      r.companyId === companyId &&
      r.userId === userId &&
      r.recordType === 'Work' &&
      (r.workingNow || !r.timeOut) &&
      r.requestStatus !== 'Pending'
  );
  if (idx === -1) {
    return { ok: false, error: 'No active clock-in record found.' };
  }

  const now = new Date();
  const rawHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const openRec = store.records[idx];
  const roundedOut = roundTimeHHMM(rawHHMM, company.roundingOutDir, company.roundingOutMins);
  const { workedHours, lunchDeductedMins } = computeWorkRecordSnapshot(
    openRec.timeIn,
    roundedOut,
    openRec.lunchStart,
    openRec.lunchEnd,
    false,
    company,
    user
  );
  const { lateIn, earlyOut } = detectShiftFlags(openRec.timeIn, roundedOut, company);

  const updated: TimeRecord = {
    ...openRec,
    rawTimeOut: rawHHMM,
    timeOut: roundedOut,
    workingNow: false,
    savedWorkedHours: workedHours,
    savedLunchDeductedMins: lunchDeductedMins,
    lateIn: openRec.lateIn || lateIn,
    earlyOut,
    comment:
      user.permissions.allowComments && comment && comment.trim()
        ? openRec.comment
          ? `${openRec.comment} • ${comment.trim()}`
          : comment.trim()
        : openRec.comment,
  };

  store.records[idx] = updated;

  dispatchNotificationInternal(
    store,
    companyId,
    'Clock OUT',
    user,
    `Clocked out at ${formatTimeDisplay(roundedOut, company.timeFormat)} (${workedHours.toFixed(2)} hrs)`
  );

  if (earlyOut) {
    dispatchNotificationInternal(
      store,
      companyId,
      'Early OUT',
      user,
      `Early clock-out at ${formatTimeDisplay(roundedOut, company.timeFormat)} (Shift end: ${formatTimeDisplay(company.defaultShiftEnd, company.timeFormat)})`
    );
  }

  saveStore(store);
  return { ok: true, record: updated };
}

/**
 * Import Excel/CSV work rows with columns Name, Date, In, Out (Part D2 & K)
 */
export function importWorkEntriesFromRows(
  companyId: string,
  rows: Array<{ name?: string; date?: string; in?: string; out?: string }>
): { importedCount: number; failedRows: Array<{ rowNumber: number; reason: string }> } {
  const store = loadStore();
  const company = store.companies.find(c => c.id === companyId);
  if (!company) {
    return { importedCount: 0, failedRows: [{ rowNumber: 1, reason: 'Company not found.' }] };
  }

  const activeUsers = store.users.filter(u => u.companyId === companyId && !u.archived);
  let importedCount = 0;
  const failedRows: Array<{ rowNumber: number; reason: string }> = [];

  const normalizeDate = (raw?: string): string | null => {
    if (!raw) return null;
    const s = String(raw).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const [y, m, d] = s.split('-').map(Number);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000) return s;
      return null;
    }
    const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slash) {
      const mm = String(slash[1]).padStart(2, '0');
      const dd = String(slash[2]).padStart(2, '0');
      const yyyy = slash[3];
      return `${yyyy}-${mm}-${dd}`;
    }
    return null;
  };

  const normalizeTime = (raw?: string): string | null => {
    if (!raw) return null;
    const s = String(raw).trim();
    const ampmMatch = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (ampmMatch) {
      let h = parseInt(ampmMatch[1], 10);
      const m = parseInt(ampmMatch[2], 10);
      const mer = ampmMatch[3].toUpperCase();
      if (h < 1 || h > 12 || m < 0 || m > 59) return null;
      if (mer === 'PM' && h < 12) h += 12;
      if (mer === 'AM' && h === 12) h = 0;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    const match24 = s.match(/^(\d{1,2}):(\d{2})$/);
    if (match24) {
      const h = parseInt(match24[1], 10);
      const m = parseInt(match24[2], 10);
      if (h < 0 || h > 23 || m < 0 || m > 59) return null;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    return null;
  };

  rows.forEach((row, index) => {
    const rowNumber = index + 2; // 1-based after header row
    const empName = (row.name || '').trim();
    if (!empName) {
      failedRows.push({ rowNumber, reason: 'Missing employee Name.' });
      return;
    }

    const matchedUser = activeUsers.find(
      u =>
        u.fullName.toLowerCase() === empName.toLowerCase() ||
        u.username.toLowerCase() === empName.toLowerCase() ||
        u.firstName.toLowerCase() === empName.toLowerCase()
    );

    if (!matchedUser) {
      failedRows.push({
        rowNumber,
        reason: `Employee "${empName}" was not found in the active roster.`,
      });
      return;
    }

    if (matchedUser.status === 'Inactive') {
      failedRows.push({
        rowNumber,
        reason: `Employee "${empName}" is marked Inactive and cannot receive new work entries.`,
      });
      return;
    }

    const dateISO = normalizeDate(row.date);
    if (!dateISO) {
      failedRows.push({
        rowNumber,
        reason: `Invalid Date "${row.date || ''}". Expected YYYY-MM-DD or MM/DD/YYYY.`,
      });
      return;
    }

    const timeIn = normalizeTime(row.in);
    if (!timeIn) {
      failedRows.push({
        rowNumber,
        reason: `Invalid Clock In time "${row.in || ''}". Expected HH:MM (e.g. 09:00 or 9:00 AM).`,
      });
      return;
    }

    const timeOut = normalizeTime(row.out);
    if (!timeOut) {
      failedRows.push({
        rowNumber,
        reason: `Invalid Clock Out time "${row.out || ''}". Expected HH:MM (e.g. 17:00 or 5:00 PM).`,
      });
      return;
    }

    const roundedIn = roundTimeHHMM(timeIn, company.roundingInDir, company.roundingInMins);
    const roundedOut = roundTimeHHMM(timeOut, company.roundingOutDir, company.roundingOutMins);
    const snap = computeWorkRecordSnapshot(
      roundedIn,
      roundedOut,
      '',
      '',
      false,
      company,
      matchedUser
    );
    const flags = detectShiftFlags(roundedIn, roundedOut, company);

    store.records.push({
      id: `rec_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
      companyId,
      userId: matchedUser.id,
      date: dateISO,
      recordType: 'Work',
      rawTimeIn: timeIn,
      rawTimeOut: timeOut,
      timeIn: roundedIn,
      timeOut: roundedOut,
      workingNow: false,
      savedWorkedHours: snap.workedHours,
      savedLunchDeductedMins: snap.lunchDeductedMins,
      lateIn: flags.lateIn,
      earlyOut: flags.earlyOut,
      comment: 'Imported via Excel/CSV',
      approvedByManager: false,
      approvedByEmployee: false,
      requestStatus: 'Approved',
      createdAt: new Date().toISOString(),
    });
    importedCount++;
  });

  if (importedCount > 0) {
    saveStore(store);
  }

  return { importedCount, failedRows };
}

// ============================================================================
// FAVORITE REPORTS
// ============================================================================

export function getFavoriteReports(companyId: string): string[] {
  try {
    const raw = localStorage.getItem(`${FAVORITE_REPORTS_KEY}_${companyId}`);
    return raw ? JSON.parse(raw) : ['Timecard Detail'];
  } catch {
    return ['Timecard Detail'];
  }
}

export function toggleFavoriteReport(companyId: string, reportId: string): string[] {
  const current = getFavoriteReports(companyId);
  const next = current.includes(reportId)
    ? current.filter(id => id !== reportId)
    : [...current, reportId];
  localStorage.setItem(`${FAVORITE_REPORTS_KEY}_${companyId}`, JSON.stringify(next));
  return next;
}
