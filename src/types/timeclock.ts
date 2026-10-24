export type Role = 'Admin' | 'Manager' | 'Employee';
export type UserStatus = 'Active' | 'Inactive';
export type PayPeriodType = 'Weekly' | 'Bi-Weekly' | 'Semi-Monthly' | 'Monthly';
export type DateFormatType = 'US' | 'Canada' | 'UK';
export type TimeFormatType = '12-hour' | '24-hour';
export type TimeTotalsFormat = '2:30' | '2h 30m' | '2.50' | '2.500';
export type RoundingDirection = 'NEAREST' | 'UP' | 'DOWN';
export type RoundingMinutes = 1 | 5 | 6 | 7 | 10 | 15 | 30;
export type AutoLunchMode = 'No' | 'Yes' | 'Per user';
export type UserAutoLunchMode = 'Use company setting' | 'No' | 'Yes';
export type ApprovalMode = 'Off' | 'Manager only' | 'Employee and Manager';

export type RecordType = 'Work' | 'Absence' | 'Adjustment';
export type AbsenceType =
  | 'Vacation'
  | 'Sick'
  | 'Personal'
  | 'Holiday'
  | 'Comp Time'
  | 'Unpaid Leave';

export type AdjustmentType = 'Hours' | 'Amount';
export type AdjustmentOperation = 'Addition' | 'Deduction';

export interface Company {
  id: string;
  name: string;
  shortName: string;
  ownerEmail: string;
  weekStartDay: number; // 0 = Sunday .. 6 = Saturday
  payPeriodType: PayPeriodType;
  payPeriodStartDate: string; // YYYY-MM-DD
  defaultTimezone: string;
  dateFormat: DateFormatType;
  timeFormat: TimeFormatType;
  timeTotalsFormat: TimeTotalsFormat;
  currencySymbol: string;
  // Time Rules
  roundingInDir: RoundingDirection;
  roundingInMins: RoundingMinutes;
  roundingOutDir: RoundingDirection;
  roundingOutMins: RoundingMinutes;
  autoLunchMode: AutoLunchMode;
  autoLunchMinutes: number;
  autoLunchAfterHours: number;
  defaultShiftStart: string; // HH:mm
  defaultShiftEnd: string; // HH:mm
  minLunchMinutes: number;
  calculateOvertimeWeekly?: boolean; // default true (Weekly >40h/wk vs Per-period >40h/period)
  calculateDailyOvertime?: boolean; // default false (Daily >8h/day overtime)
  highlightPublicHolidays?: boolean; // default true
  holidayCountry?: 'US' | 'CA' | 'GB' | 'AU' | 'MX' | 'PR' | 'DO'; // default 'US'
  // Approvals
  approvalMode: ApprovalMode;
}

export interface UserPermissions {
  allowEditOwnTime: boolean;
  allowComments: boolean;
  allowApproveRecords: boolean;
  allowViewReports: boolean;
  viewOwnPayRate: boolean;
  allowAddEntryRequest: boolean;
  allowAddAbsenceRequest: boolean;
  allowSeeWhoIsIn: boolean;
  accessCompanySettings: boolean;
  accessUsers: boolean;
  accessNotifications: boolean;
}

export interface AppUser {
  id: string;
  companyId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  username: string;
  password: string;
  employeeNumber: string;
  email: string;
  mobilePhone: string;
  departmentId: string;
  role: Role;
  status: UserStatus;
  archived: boolean;
  hireDate: string;
  employmentType: 'Full Time' | 'Part Time';
  rateType: 'Hourly' | 'Salary';
  payRate: number;
  timezone: string; // 'Company default' or IANA timezone
  autoLunchMode: UserAutoLunchMode;
  autoLunchMinutes: number;
  autoLunchAfterHours: number;
  permissions: UserPermissions;
}

export interface Department {
  id: string;
  companyId: string;
  name: string;
  code: string;
  managerIds: string[];
}

export interface TimeRecord {
  id: string;
  companyId: string;
  userId: string;
  date: string; // YYYY-MM-DD
  recordType: RecordType;
  // Work fields
  rawTimeIn?: string;
  rawTimeOut?: string;
  timeIn?: string; // HH:mm (rounded)
  timeOut?: string; // HH:mm (rounded)
  lunchStart?: string; // HH:mm (explicit from sheet)
  lunchEnd?: string; // HH:mm (explicit from sheet)
  workingNow?: boolean;
  savedWorkedHours?: number; // locked-in net hours at save time per D6
  savedLunchDeductedMins?: number;
  lateIn?: boolean;
  earlyOut?: boolean;
  // Absence fields
  absenceType?: AbsenceType;
  absenceHours?: number;
  isPaid?: boolean;
  // Adjustment fields
  adjustmentType?: AdjustmentType;
  adjustmentOp?: AdjustmentOperation;
  adjustmentValue?: number;
  // Shared
  comment?: string;
  approvedByManager: boolean;
  approvedByEmployee: boolean;
  requestStatus?: 'Approved' | 'Pending' | 'Denied';
  createdAt: string;
}

export type NotificationEventType =
  | 'Clock IN'
  | 'Clock OUT'
  | 'Late IN'
  | 'Early OUT'
  | 'Forgot Clock In'
  | 'Manager Approve Timecard'
  | 'Employee Approve Timecard'
  | 'Daily Total'
  | 'Weekly Total';

export interface NotificationEventRule {
  enabled: boolean;
  toEmployee: boolean;
  toManagers: boolean;
  toAdmins: boolean;
}

export interface NotificationSettings {
  companyId: string;
  masterEnabled: boolean;
  extraEmails: string;
  events: Record<NotificationEventType, NotificationEventRule>;
}

export interface NotificationLog {
  id: string;
  companyId: string;
  timestamp: string;
  event: string;
  employeeName: string;
  userId: string;
  recipients: string[];
  details: string;
}
