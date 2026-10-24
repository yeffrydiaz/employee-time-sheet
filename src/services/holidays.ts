export type HolidayCountryCode = 'US' | 'CA' | 'GB' | 'AU' | 'MX' | 'PR' | 'DO';

export interface PublicHoliday {
  date: string; // YYYY-MM-DD
  name: string;
  localName?: string;
  countryCode: string;
  isCustom?: boolean;
  source?: 'predefined' | 'api' | 'custom';
}

export const SUPPORTED_HOLIDAY_COUNTRIES: Array<{
  code: HolidayCountryCode;
  name: string;
}> = [
  { code: 'US', name: 'United States (Federal Holidays)' },
  { code: 'CA', name: 'Canada (Statutory Holidays)' },
  { code: 'GB', name: 'United Kingdom (Bank Holidays)' },
  { code: 'AU', name: 'Australia (Public Holidays)' },
  { code: 'MX', name: 'Mexico (Días Festivos)' },
  { code: 'PR', name: 'Puerto Rico (Public Holidays)' },
  { code: 'DO', name: 'Dominican Republic (Días Feriados)' },
];

const HOLIDAY_API_CACHE_KEY = 'tsm_public_holidays_api_cache_v1';
const CUSTOM_HOLIDAYS_STORAGE_KEY = 'tsm_custom_public_holidays_v1';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatYMD(year: number, month1To12: number, day: number): string {
  return `${year}-${pad2(month1To12)}-${pad2(day)}`;
}

/**
 * Find the Nth weekday of a given month (1-indexed month 1..12, weekday 0=Sun..6=Sat, n=1..5)
 */
function getNthWeekdayOfMonth(
  year: number,
  month1To12: number,
  weekday0To6: number,
  n: number
): string {
  const firstDay = new Date(year, month1To12 - 1, 1);
  const firstWeekday = firstDay.getDay();
  const offset = (weekday0To6 - firstWeekday + 7) % 7;
  const day = 1 + offset + (n - 1) * 7;
  return formatYMD(year, month1To12, day);
}

/**
 * Find the last occurrence of a weekday in a given month (month 1..12, weekday 0=Sun..6=Sat)
 */
function getLastWeekdayOfMonth(
  year: number,
  month1To12: number,
  weekday0To6: number
): string {
  const lastDayOfMonth = new Date(year, month1To12, 0);
  const lastDate = lastDayOfMonth.getDate();
  const lastWeekday = lastDayOfMonth.getDay();
  const diff = (lastWeekday - weekday0To6 + 7) % 7;
  return formatYMD(year, month1To12, lastDate - diff);
}

/**
 * Anonymous Gregorian algorithm for Easter Sunday
 */
function getEasterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=March, 4=April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDaysToDate(dt: Date, days: number): string {
  const copy = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + days);
  return formatYMD(copy.getFullYear(), copy.getMonth() + 1, copy.getDate());
}

/**
 * If a fixed holiday falls on Saturday, observe on Friday; if Sunday, observe on Monday.
 */
function getObservedFixedDate(year: number, month1To12: number, day: number): {
  actual: string;
  observed: string;
} {
  const dt = new Date(year, month1To12 - 1, day);
  const actual = formatYMD(year, month1To12, day);
  const dow = dt.getDay();
  if (dow === 6) {
    return { actual, observed: addDaysToDate(dt, -1) };
  }
  if (dow === 0) {
    return { actual, observed: addDaysToDate(dt, 1) };
  }
  return { actual, observed: actual };
}

/**
 * Generate predefined public holidays for a given year and countryCode
 */
export function getPredefinedHolidaysForYear(
  year: number,
  countryCode: HolidayCountryCode = 'US'
): PublicHoliday[] {
  const list: PublicHoliday[] = [];
  const addHoliday = (date: string, name: string) => {
    if (!list.some(h => h.date === date)) {
      list.push({
        date,
        name,
        localName: name,
        countryCode,
        source: 'predefined',
      });
    }
  };

  const addFixedWithObserved = (month: number, day: number, name: string) => {
    const { actual, observed } = getObservedFixedDate(year, month, day);
    addHoliday(actual, name);
    if (observed !== actual) {
      addHoliday(observed, `${name} (Observed)`);
    }
  };

  const easter = getEasterSunday(year);
  const goodFriday = addDaysToDate(easter, -2);
  const easterMonday = addDaysToDate(easter, 1);

  if (countryCode === 'US' || countryCode === 'PR') {
    addFixedWithObserved(1, 1, "New Year's Day");
    addHoliday(getNthWeekdayOfMonth(year, 1, 1, 3), 'Martin Luther King Jr. Day');
    addHoliday(getNthWeekdayOfMonth(year, 2, 1, 3), "Presidents' Day");
    addHoliday(getLastWeekdayOfMonth(year, 5, 1), 'Memorial Day');
    addFixedWithObserved(6, 19, 'Juneteenth National Independence Day');
    addFixedWithObserved(7, 4, 'Independence Day');
    addHoliday(getNthWeekdayOfMonth(year, 9, 1, 1), 'Labor Day');
    addHoliday(getNthWeekdayOfMonth(year, 10, 1, 2), 'Columbus Day / Indigenous Peoples’ Day');
    addHoliday(formatYMD(year, 10, 31), 'Halloween (Observance)');
    addFixedWithObserved(11, 11, 'Veterans Day');
    const thanksgiving = getNthWeekdayOfMonth(year, 11, 4, 4);
    addHoliday(thanksgiving, 'Thanksgiving Day');
    // Day after Thanksgiving (Black Friday / Native American Heritage Day)
    const [ty, tm, td] = thanksgiving.split('-').map(Number);
    addHoliday(formatYMD(ty, tm, td + 1), 'Day After Thanksgiving');
    addFixedWithObserved(12, 24, 'Christmas Eve');
    addFixedWithObserved(12, 25, 'Christmas Day');
    if (countryCode === 'PR') {
      addFixedWithObserved(1, 6, 'Three Kings Day (Día de Reyes)');
      addHoliday(goodFriday, 'Good Friday');
      addFixedWithObserved(7, 25, 'Puerto Rico Constitution Day');
      addFixedWithObserved(11, 19, 'Discovery of Puerto Rico');
    }
  } else if (countryCode === 'CA') {
    addFixedWithObserved(1, 1, "New Year's Day");
    addHoliday(getNthWeekdayOfMonth(year, 2, 1, 3), 'Family Day');
    addHoliday(goodFriday, 'Good Friday');
    addHoliday(easterMonday, 'Easter Monday');
    // Victoria Day: Monday before May 25
    const may24 = new Date(year, 4, 24);
    const victoriaDiff = (may24.getDay() - 1 + 7) % 7;
    addHoliday(addDaysToDate(may24, -victoriaDiff), 'Victoria Day');
    addFixedWithObserved(7, 1, 'Canada Day');
    addHoliday(getNthWeekdayOfMonth(year, 8, 1, 1), 'Civic Holiday');
    addHoliday(getNthWeekdayOfMonth(year, 9, 1, 1), 'Labour Day');
    addFixedWithObserved(9, 30, 'National Day for Truth and Reconciliation');
    addHoliday(getNthWeekdayOfMonth(year, 10, 1, 2), 'Thanksgiving Day (Canada)');
    addFixedWithObserved(11, 11, 'Remembrance Day');
    addFixedWithObserved(12, 25, 'Christmas Day');
    addFixedWithObserved(12, 26, 'Boxing Day');
  } else if (countryCode === 'GB') {
    addFixedWithObserved(1, 1, "New Year's Day");
    addHoliday(goodFriday, 'Good Friday');
    addHoliday(easterMonday, 'Easter Monday');
    addHoliday(getNthWeekdayOfMonth(year, 5, 1, 1), 'Early May Bank Holiday');
    addHoliday(getLastWeekdayOfMonth(year, 5, 1), 'Spring Bank Holiday');
    addHoliday(getLastWeekdayOfMonth(year, 8, 1), 'Summer Bank Holiday');
    addFixedWithObserved(12, 25, 'Christmas Day');
    addFixedWithObserved(12, 26, 'Boxing Day');
  } else if (countryCode === 'AU') {
    addFixedWithObserved(1, 1, "New Year's Day");
    addFixedWithObserved(1, 26, 'Australia Day');
    addHoliday(goodFriday, 'Good Friday');
    addHoliday(easterMonday, 'Easter Monday');
    addFixedWithObserved(4, 25, 'Anzac Day');
    addHoliday(getNthWeekdayOfMonth(year, 6, 1, 2), "King's Birthday");
    addHoliday(getNthWeekdayOfMonth(year, 10, 1, 1), 'Labour Day');
    addFixedWithObserved(12, 25, 'Christmas Day');
    addFixedWithObserved(12, 26, 'Boxing Day');
  } else if (countryCode === 'MX') {
    addFixedWithObserved(1, 1, 'Año Nuevo');
    addHoliday(getNthWeekdayOfMonth(year, 2, 1, 1), 'Día de la Constitución');
    addHoliday(getNthWeekdayOfMonth(year, 3, 1, 3), 'Natalicio de Benito Juárez');
    addHoliday(goodFriday, 'Viernes Santo');
    addFixedWithObserved(5, 1, 'Día del Trabajo');
    addFixedWithObserved(9, 16, 'Día de la Independencia');
    addFixedWithObserved(11, 2, 'Día de los Muertos');
    addHoliday(getNthWeekdayOfMonth(year, 11, 1, 3), 'Día de la Revolución');
    addFixedWithObserved(12, 12, 'Día de la Virgen de Guadalupe');
    addFixedWithObserved(12, 25, 'Navidad');
  } else if (countryCode === 'DO') {
    addFixedWithObserved(1, 1, 'Año Nuevo');
    addFixedWithObserved(1, 6, 'Día de los Santos Reyes');
    addFixedWithObserved(1, 21, 'Día de Nuestra Señora de la Altagracia');
    addFixedWithObserved(1, 26, 'Día del Patricio Juan Pablo Duarte');
    addFixedWithObserved(2, 27, 'Día de la Independencia Nacional');
    addHoliday(goodFriday, 'Viernes Santo');
    addFixedWithObserved(5, 1, 'Día del Trabajo');
    addFixedWithObserved(8, 16, 'Día de la Restauración');
    addFixedWithObserved(9, 24, 'Día de Nuestra Señora de las Mercedes');
    addFixedWithObserved(11, 6, 'Día de la Constitución');
    addFixedWithObserved(12, 25, 'Día de Navidad');
  }

  return list.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Load cached API holidays from localStorage
 */
export function getCachedApiHolidays(
  year: number,
  countryCode: HolidayCountryCode
): PublicHoliday[] | null {
  try {
    const raw = localStorage.getItem(HOLIDAY_API_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const key = `${countryCode}_${year}`;
    if (Array.isArray(parsed[key]) && parsed[key].length > 0) {
      return parsed[key];
    }
  } catch {}
  return null;
}

/**
 * Fetch official public holidays from the Nager.Date public API and merge with predefined holidays
 */
export async function fetchPublicHolidaysFromAPI(
  year: number,
  countryCode: HolidayCountryCode
): Promise<{ holidays: PublicHoliday[]; fromApi: boolean }> {
  const predefined = getPredefinedHolidaysForYear(year, countryCode);
  try {
    const response = await fetch(
      `https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`
    );
    if (!response.ok) {
      return { holidays: predefined, fromApi: false };
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
      return { holidays: predefined, fromApi: false };
    }

    const byDate = new Map<string, PublicHoliday>();
    for (const h of predefined) {
      byDate.set(h.date, h);
    }
    for (const item of data) {
      if (item && typeof item.date === 'string' && (item.name || item.localName)) {
        byDate.set(item.date, {
          date: item.date,
          name: item.name || item.localName,
          localName: item.localName || item.name,
          countryCode,
          source: 'api',
        });
      }
    }

    const merged = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));

    try {
      const raw = localStorage.getItem(HOLIDAY_API_CACHE_KEY);
      const cache = raw ? JSON.parse(raw) : {};
      cache[`${countryCode}_${year}`] = merged;
      localStorage.setItem(HOLIDAY_API_CACHE_KEY, JSON.stringify(cache));
    } catch {}

    return { holidays: merged, fromApi: true };
  } catch {
    return { holidays: predefined, fromApi: false };
  }
}

/**
 * Custom User/Company Holidays stored in localStorage
 */
export function getCustomHolidays(): PublicHoliday[] {
  try {
    const raw = localStorage.getItem(CUSTOM_HOLIDAYS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCustomHolidays(list: PublicHoliday[]): PublicHoliday[] {
  const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
  try {
    localStorage.setItem(CUSTOM_HOLIDAYS_STORAGE_KEY, JSON.stringify(sorted));
    window.dispatchEvent(new CustomEvent('tsm-holidays-updated'));
  } catch {}
  return sorted;
}

export function addCustomHoliday(date: string, name: string): PublicHoliday[] {
  const cleanDate = date.trim();
  const cleanName = name.trim();
  if (!cleanDate || !cleanName) return getCustomHolidays();
  const existing = getCustomHolidays().filter(h => h.date !== cleanDate);
  existing.push({
    date: cleanDate,
    name: cleanName,
    localName: cleanName,
    countryCode: 'CUSTOM',
    isCustom: true,
    source: 'custom',
  });
  return saveCustomHolidays(existing);
}

export function removeCustomHoliday(date: string): PublicHoliday[] {
  const next = getCustomHolidays().filter(h => h.date !== date);
  return saveCustomHolidays(next);
}

/**
 * Build a fast lookup map (YYYY-MM-DD -> PublicHoliday) for all years spanned by `dates`
 */
export function buildHolidayMapForDates(
  dates: string[],
  countryCode: HolidayCountryCode = 'US',
  customHolidays: PublicHoliday[] = []
): Record<string, PublicHoliday> {
  const years = new Set<number>();
  const currentYear = new Date().getFullYear();
  years.add(currentYear);

  for (const d of dates) {
    if (d && d.length >= 4) {
      const y = parseInt(d.slice(0, 4), 10);
      if (!isNaN(y)) years.add(y);
    }
  }

  const map: Record<string, PublicHoliday> = {};
  for (const y of years) {
    const cached = getCachedApiHolidays(y, countryCode);
    const baseList = cached || getPredefinedHolidaysForYear(y, countryCode);
    for (const h of baseList) {
      map[h.date] = h;
    }
  }

  for (const custom of customHolidays) {
    if (custom.date && custom.name) {
      map[custom.date] = custom;
    }
  }

  return map;
}
