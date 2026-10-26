import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Mail,
  Printer,
  Save,
  Loader2,
  History,
  Search,
  X,
  ChevronRight,
  Trash2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  User,
  LogOut,
  LogIn,
  Moon,
  Sun,
  Clock,
  Settings,
  Check,
  Calendar,
  Utensils,
  Undo2,
  Redo2,
  PenTool,
  Type,
  AlertTriangle,
  ArrowDown,
  Copy,
  Download,
  Wrench,
  FileText,
  Bell,
  HelpCircle
} from 'lucide-react';
import SignatureCanvas from 'react-signature-canvas';
import { motion, AnimatePresence } from 'motion/react';
import jsPDF from 'jspdf';
import { auth, db, googleProvider } from './firebase';
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User as FirebaseUser,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword
} from 'firebase/auth';
import {
  collection,
  doc,
  setDoc,
  getDocs,
  serverTimestamp,
  query,
  where
} from 'firebase/firestore';
import AuthScreen from './components/AuthScreen';
import PunchClockScreen from './components/PunchClockScreen';
import MyHoursScreen from './components/MyHoursScreen';
import AdminConsole from './components/AdminConsole';
import { getCurrentSessionUser } from './services/dataStore';
import { AppUser, Company } from './types/timeclock';
import { generateVectorTimesheetPDF, triggerPrintAndDownloadPDF } from './services/pdfExport';

export interface DailyRecord {
  day: string;
  date: string;
  timeIn: string;
  lunchStart: string;
  lunchEnd: string;
  timeOut: string;
  totalHours: string;
  notes: string;
}

const STORAGE_KEY_PREFIX = 'employee_timesheet_data_';
const HISTORY_STORAGE_KEY_PREFIX = 'employee_timesheet_history_';
const LAST_COMPANY_KEY = 'last_active_company';
const DEFAULT_EMAIL = 'TIMESHEETS@ROYAL-TRANS.COM';

const getInitialPeriodStart = () => {
  const today = new Date();
  const diff = today.getDay(); // 0 is Sunday
  const sunday = new Date(today);
  sunday.setDate(today.getDate() - diff);
  return sunday.toISOString().split('T')[0];
};

const getTodayDate = () => {
  return new Date().toISOString().split('T')[0];
};

const formatPeriodRange = (startDateStr: string, period: string) => {
  if (!startDateStr) return '';
  const [year, month, day] = startDateStr.split('-').map(Number);
  const start = new Date(year, month - 1, day);
  
  let numDays = 14;
  if (period === 'Weekly') numDays = 7;
  else if (period === 'Monthly') {
    numDays = new Date(year, month, 0).getDate();
  }
  
  const end = new Date(year, month - 1, day + numDays - 1);
  const startMonth = start.toLocaleDateString('en-US', { month: 'short' });
  const endMonth = end.toLocaleDateString('en-US', { month: 'short' });
  
  if (startMonth === endMonth) {
    return `${startMonth} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}`;
  }
  return `${startMonth} ${start.getDate()} – ${endMonth} ${end.getDate()}, ${end.getFullYear()}`;
};

const formatDateSmartYear = (dateStr: string) => {
  if (!dateStr || !dateStr.includes('-')) return dateStr || '';
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const currentYear = new Date().getFullYear();
  const dt = new Date(y, m - 1, d);
  const monthShort = dt.toLocaleDateString('en-US', { month: 'short' });
  if (y !== currentYear) {
    return `${monthShort} ${d}, ${y}`;
  }
  return `${monthShort} ${d}`;
};

const getSmartDateParts = (dateStr: string) => {
  if (!dateStr || !dateStr.includes('-')) {
    return { monthShort: '', dayNum: dateStr || '', yearSuffix: '' };
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) {
    return { monthShort: '', dayNum: dateStr, yearSuffix: '' };
  }
  const currentYear = new Date().getFullYear();
  const dt = new Date(y, m - 1, d);
  const monthShort = dt.toLocaleDateString('en-US', { month: 'short' });
  return {
    monthShort,
    dayNum: String(d),
    yearSuffix: y !== currentYear ? `, ${y}` : '',
  };
};

const generateRecordsForPeriod = (period: string, startDateStr: string, existingRecords: DailyRecord[]) => {
  const startStr = startDateStr || getInitialPeriodStart();
  const [year, month, day] = startStr.split('-').map(Number);
  const startDate = new Date(year, month - 1, day);
  
  let numDays = 14; // Default Bi-weekly
  if (period === 'Weekly') numDays = 7;
  else if (period === 'Monthly') {
    numDays = new Date(year, month, 0).getDate();
  }
  
  const newRecords: DailyRecord[] = [];
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  
  for (let i = 0; i < numDays; i++) {
    const recordDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i);
    const dayName = days[recordDate.getDay()];
    const yyyy = recordDate.getFullYear();
    const mm = String(recordDate.getMonth() + 1).padStart(2, '0');
    const dd = String(recordDate.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    
    // Match existing record by date if available, or by index
    const existing = existingRecords.find(r => r.date === dateStr);
    if (existing) {
      newRecords.push({ ...existing, day: dayName });
    } else if (existingRecords[i] && existingRecords[i].day === dayName && !existingRecords[i].date) {
      newRecords.push({ ...existingRecords[i], date: dateStr, day: dayName });
    } else {
      newRecords.push({
        day: dayName,
        date: dateStr,
        timeIn: '',
        lunchStart: '',
        lunchEnd: '',
        timeOut: '',
        totalHours: '',
        notes: ''
      });
    }
  }
  return newRecords;
};

const getInitialCompany = () => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem(LAST_COMPANY_KEY) || 'Royal Transportation';
  }
  return 'Royal Transportation';
};

const loadSavedData = (company: string) => {
  try {
    let saved = localStorage.getItem(`${STORAGE_KEY_PREFIX}${company}`);
    if (!saved && company === 'Royal Transportation') {
      saved = localStorage.getItem('employee_timesheet_data');
    }
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error('Failed to load timesheet data from storage', e);
  }
  return null;
};

// Generates an image data URL for typed signature
const renderTypedSignatureImage = (typedName: string, isDark: boolean): string => {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 150;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = isDark ? '#ffffff' : '#0f172a';
  ctx.font = 'italic 52px "Caveat", "Brush Script MT", cursive, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(typedName, 24, 70);

  // Subtle digital verification line
  ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(20, 110);
  ctx.lineTo(580, 110);
  ctx.stroke();

  ctx.fillStyle = isDark ? '#94a3b8' : '#64748b';
  ctx.font = '13px sans-serif';
  ctx.fillText('Digitally signed & verified', 24, 128);

  return canvas.toDataURL('image/png');
};

function LandingTimesheet({ onOpenBusinessLogin }: { onOpenBusinessLogin: () => void }) {
  const initialCompany = getInitialCompany();
  const savedData = loadSavedData(initialCompany);

  // ReCaptcha site key setup
  useEffect(() => {
    const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
    if (siteKey && !document.querySelector(`script[src*="recaptcha/enterprise.js"]`)) {
      const script = document.createElement('script');
      script.src = `https://www.google.com/recaptcha/enterprise.js?render=${siteKey}`;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  }, []);

  const [companyName, setCompanyName] = useState(initialCompany);
  const [companies, setCompanies] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('companies_list');
      return saved ? JSON.parse(saved) : ['Royal Transportation'];
    } catch (e) {
      return ['Royal Transportation'];
    }
  });

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showEmailConfirm, setShowEmailConfirm] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<{ week: string; e?: React.MouseEvent } | null>(null);
  const [showSavedIndicator, setShowSavedIndicator] = useState(false);
  const [isCompanyDropdownOpen, setIsCompanyDropdownOpen] = useState(false);
  const [newCompanyInput, setNewCompanyInput] = useState('');

  const [shiftSettings, setShiftSettings] = useState(() => {
    const defaultSettings = {
      startTime: '09:00',
      lunchStart: '12:00',
      lunchEnd: '13:00',
      endTime: '17:00',
      enabled: true,
      period: 'Bi-weekly', // Default 14 days
    };
    try {
      const saved = localStorage.getItem('shift_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          startTime: parsed.startTime || defaultSettings.startTime,
          lunchStart: parsed.lunchStart || defaultSettings.lunchStart,
          endTime: parsed.endTime || defaultSettings.endTime,
          lunchEnd: parsed.lunchEnd || defaultSettings.lunchEnd,
          enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : defaultSettings.enabled,
          period: parsed.period || defaultSettings.period,
        };
      }
      return defaultSettings;
    } catch (e) {
      return defaultSettings;
    }
  });

  const [name, setName] = useState(savedData?.name || '');
  const [employeeEmail, setEmployeeEmail] = useState(savedData?.employeeEmail || '');
  const [periodStart, setPeriodStart] = useState(savedData?.weekOf || savedData?.periodStart || getInitialPeriodStart());

  const [records, setRecords] = useState<DailyRecord[]>(() => {
    const initialStart = savedData?.weekOf || savedData?.periodStart || getInitialPeriodStart();
    const loadedRecords = savedData?.records || [];
    return generateRecordsForPeriod(shiftSettings.period, initialStart, loadedRecords);
  });

  const [totalHours, setTotalHours] = useState('');
  const [signatureMode, setSignatureMode] = useState<'draw' | 'type'>('draw');
  const [typedName, setTypedName] = useState('');
  const [signature, setSignature] = useState(savedData?.signature || '');
  const [date, setDate] = useState(savedData?.date || getTodayDate());
  const [recipientEmail, setRecipientEmail] = useState(savedData?.recipientEmail || DEFAULT_EMAIL);
  const [sentLogs, setSentLogs] = useState<{ date: string; recipient: string }[]>(savedData?.sentLogs || []);
  const [lastSaved, setLastSaved] = useState<Date | null>(() => new Date());
  const [isSending, setIsSending] = useState(false);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [historySearchTerm, setHistorySearchTerm] = useState('');
  const [historyData, setHistoryData] = useState<Record<string, any>>({});
  const [showEmailHistory, setShowEmailHistory] = useState(false);

  // Accordion state for mobile: track open day index(es).
  // Default: today's card is open, all others collapsed.
  const todayDateStr = getTodayDate();
  const todayRecordIndex = useMemo(() => {
    const idx = records.findIndex(r => r.date === todayDateStr);
    return idx >= 0 ? idx : 0;
  }, [records, todayDateStr]);

  const [expandedDays, setExpandedDays] = useState<number[]>([todayRecordIndex]);

  // Auth states
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authError, setAuthError] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');

  // Dark mode state - Controlled ONLY inside Settings modal
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme');
      return saved === 'dark';
    }
    return false;
  });

  const sigCanvas = useRef<SignatureCanvas>(null);
  const emailContainerRef = useRef<HTMLDivElement>(null);
  const dayCardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const timeCellRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Canvas stroke history for Undo / Redo
  const [canvasHistory, setCanvasHistory] = useState<any[]>([]);
  const [historyPointer, setHistoryPointer] = useState<number>(-1);

  // Email history
  const [emailHistory, setEmailHistory] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(`email_history_${initialCompany}`);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`email_history_${companyName}`);
      setEmailHistory(saved ? JSON.parse(saved) : []);
    } catch (e) {
      setEmailHistory([]);
    }
  }, [companyName]);

  // Dark mode effect
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  // Global Escape key listener to close modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsSettingsOpen(false);
        setIsHistoryOpen(false);
        setShowClearConfirm(false);
        setShowEmailConfirm(false);
        setItemToDelete(null);
        setShowAuthModal(false);
        setShowEmailHistory(false);
        setIsCompanyDropdownOpen(false);
        setOverwriteTimeConfirm(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Handle outside clicks for email dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (emailContainerRef.current && !emailContainerRef.current.contains(event.target as Node)) {
        setShowEmailHistory(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Sync auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        const q = query(collection(db, 'users', currentUser.uid, 'timesheets'), where('companyName', '==', companyName));
        getDocs(q).then((querySnapshot) => {
          const history: Record<string, any> = {};
          querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (data.data) {
              history[data.weekOf || data.periodStart] = JSON.parse(data.data);
            }
          });
          const historyKey = `${HISTORY_STORAGE_KEY_PREFIX}${companyName}`;
          localStorage.setItem(historyKey, JSON.stringify(history));
          setHistoryData(history);
        }).catch(e => console.error('Error fetching timesheets from Firestore:', e));
      }
    });
    return () => unsubscribe();
  }, [companyName]);

  // Auto-calculate row hours
  const calculateRowHours = useCallback((record: DailyRecord) => {
    if (!record.timeIn || !record.timeOut) return '';

    const parseTime = (timeStr: string) => {
      if (!timeStr) return 0;
      const [h, m] = timeStr.split(':').map(Number);
      return h + m / 60;
    };

    const inTime = parseTime(record.timeIn);
    const outTime = parseTime(record.timeOut);

    // Time Out earlier than or equal to Time In
    if (outTime <= inTime) {
      return '0.00';
    }

    let total = outTime - inTime;

    if (record.lunchStart && record.lunchEnd) {
      const lStart = parseTime(record.lunchStart);
      const lEnd = parseTime(record.lunchEnd);
      if (lEnd <= lStart || lStart < inTime || lEnd > outTime) {
        return '0.00';
      }
      total -= lEnd - lStart;
    }

    return total > 0 ? total.toFixed(2) : '0.00';
  }, []);

  // Auto-calculate weekly total hours
  useEffect(() => {
    let sum = 0;
    const updated = records.map(r => {
      const hrs = calculateRowHours(r);
      if (hrs) {
        sum += parseFloat(hrs) || 0;
      }
      return { ...r, totalHours: hrs };
    });

    const changed = updated.some((r, i) => r.totalHours !== records[i].totalHours);
    if (changed) {
      setRecords(updated);
    }
    setTotalHours(sum > 0 ? sum.toFixed(2) : '');
  }, [records, calculateRowHours]);

  // Auto-save to localStorage on every change
  useEffect(() => {
    const dataToSave = {
      companyName,
      name,
      employeeEmail,
      weekOf: periodStart,
      periodStart,
      records,
      signature,
      date,
      recipientEmail,
      sentLogs
    };
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${companyName}`, JSON.stringify(dataToSave));
    setLastSaved(new Date());

    setShowSavedIndicator(true);
    const timer = setTimeout(() => setShowSavedIndicator(false), 2000);

    if (periodStart) {
      try {
        const historyKey = `${HISTORY_STORAGE_KEY_PREFIX}${companyName}`;
        let historyStr = localStorage.getItem(historyKey);
        if (!historyStr && companyName === 'Royal Transportation') {
          historyStr = localStorage.getItem('employee_timesheet_history');
        }
        const hist = JSON.parse(historyStr || '{}');
        hist[periodStart] = { ...dataToSave, lastModified: new Date().toISOString() };
        localStorage.setItem(historyKey, JSON.stringify(hist));

        if (user) {
          const timesheetRef = doc(db, 'users', user.uid, 'timesheets', `${companyName}_${periodStart}`);
          setDoc(timesheetRef, {
            userId: user.uid,
            companyName,
            weekOf: periodStart,
            periodStart,
            data: JSON.stringify(hist[periodStart]),
            updatedAt: serverTimestamp()
          }).catch(e => console.error('Failed to sync to Firestore', e));
        }
      } catch (e) {
        console.error('Failed to save to history', e);
      }
    }
    return () => clearTimeout(timer);
  }, [companyName, name, employeeEmail, periodStart, records, signature, date, recipientEmail, sentLogs, user]);

  // Load signature into canvas if available
  useEffect(() => {
    if (sigCanvas.current && signature && signature.startsWith('data:image')) {
      sigCanvas.current.fromDataURL(signature);
    }
  }, []);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    const capitalized = val.replace(/\b\w/g, (c) => c.toUpperCase());
    setName(capitalized);
    if (signatureMode === 'type' && !typedName) {
      setTypedName(capitalized);
      const rendered = renderTypedSignatureImage(capitalized, isDarkMode);
      setSignature(rendered);
    }
  };

  const handlePeriodStartChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newStart = e.target.value;
    setPeriodStart(newStart);
    if (newStart) {
      const newRecs = generateRecordsForPeriod(shiftSettings.period, newStart, records);
      setRecords(newRecs);
    }
  };

  const getCurrentTime = () => {
    const now = new Date();
    return now.toTimeString().slice(0, 5);
  };

  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [mobileToolMenuDayIndex, setMobileToolMenuDayIndex] = useState<number | null>(null);
  const [copyConfirmDayIndex, setCopyConfirmDayIndex] = useState<number | null>(null);
  const [overwriteTimeConfirm, setOverwriteTimeConfirm] = useState<{
    dayIndex: number;
    field: 'timeIn' | 'timeOut' | 'lunchStart' | 'lunchEnd';
    label: string;
    existingValue: string;
    proposedValue: string;
  } | null>(null);

  const handleRecordChange = (index: number, field: keyof DailyRecord, value: string) => {
    const updated = [...records];
    updated[index] = { ...updated[index], [field]: value };
    setRecords(updated);
  };

  const handleQuickTimeButtonTap = (
    index: number,
    field: 'timeIn' | 'timeOut' | 'lunchStart' | 'lunchEnd',
    label: string
  ) => {
    const currentVal = records[index]?.[field] || '';
    const nowTime = getCurrentTime();
    if (currentVal) {
      setOverwriteTimeConfirm({
        dayIndex: index,
        field,
        label,
        existingValue: currentVal,
        proposedValue: nowTime,
      });
      return;
    }
    handleRecordChange(index, field, nowTime);
  };

  const copyPreviousDay = (index: number) => {
    if (index <= 0 || index >= records.length) return;
    const prev = records[index - 1];
    const updated = [...records];
    const updatedRecord = {
      ...updated[index],
      timeIn: prev.timeIn,
      lunchStart: prev.lunchStart,
      lunchEnd: prev.lunchEnd,
      timeOut: prev.timeOut,
    };
    updatedRecord.totalHours = calculateRowHours(updatedRecord);
    updated[index] = updatedRecord;
    setRecords(updated);
    setCopiedIndex(index);
    setTimeout(() => {
      setCopiedIndex(current => (current === index ? null : current));
    }, 1500);
  };

  const toggleAccordion = (index: number) => {
    setExpandedDays(prev =>
      prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
    );
  };

  const expandAllDays = () => {
    setExpandedDays(records.map((_, i) => i));
  };

  const collapseAllDays = () => {
    setExpandedDays([]);
  };

  const jumpToToday = () => {
    if (todayRecordIndex >= 0) {
      if (!expandedDays.includes(todayRecordIndex)) {
        setExpandedDays(prev => [...prev, todayRecordIndex]);
      }
      setTimeout(() => {
        const el = dayCardRefs.current[todayRecordIndex];
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 50);
    }
  };

  const handleTimeAction = useCallback((action: 'clockIn' | 'startLunch' | 'endLunch' | 'clockOut') => {
    const currentTime = getCurrentTime();
    const idx = todayRecordIndex >= 0 ? todayRecordIndex : 0;
    setRecords(prevRecords => {
      const todayRecord = prevRecords[idx];
      if (!todayRecord) return prevRecords;
      const newRecords = [...prevRecords];
      const updatedRecord = { ...todayRecord };

      if (action === 'clockIn') {
        updatedRecord.timeIn = currentTime;
        if (todayRecord.timeIn && todayRecord.timeOut) {
          updatedRecord.timeOut = '';
          updatedRecord.lunchStart = '';
          updatedRecord.lunchEnd = '';
        }
        if (!todayRecord.date) {
          updatedRecord.date = getTodayDate();
        }
      } else if (action === 'startLunch') {
        updatedRecord.lunchStart = currentTime;
      } else if (action === 'endLunch') {
        updatedRecord.lunchEnd = currentTime;
      } else if (action === 'clockOut') {
        updatedRecord.timeOut = currentTime;
      }

      newRecords[idx] = updatedRecord;
      return newRecords;
    });

    // Make sure today's card is open
    setExpandedDays(prev => (prev.includes(idx) ? prev : [...prev, idx]));
  }, [todayRecordIndex]);

  // PWA Shift Alerts (Clock In, Lunch In, Lunch Out, Clock Out)
  const [activeShiftAlert, setActiveShiftAlert] = useState<{
    id: string;
    title: string;
    message: string;
    action: 'clockIn' | 'startLunch' | 'endLunch' | 'clockOut';
    actionLabel: string;
    scheduledTime: string;
  } | null>(null);

  const [notificationPermission, setNotificationPermission] = useState<string>(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Notification.permission;
    }
    return 'unsupported';
  });

  const playShiftAlertChime = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      osc1.type = 'sine';
      osc2.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now); // D5
      osc2.frequency.setValueAtTime(880, now + 0.16); // A5
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.15);
      osc2.start(now + 0.16);
      osc2.stop(now + 0.45);
    } catch {}
  }, []);

  const triggerPWAAlert = useCallback(
    (alertItem: {
      id: string;
      title: string;
      message: string;
      action: 'clockIn' | 'startLunch' | 'endLunch' | 'clockOut';
      actionLabel: string;
      scheduledTime: string;
    }) => {
      setActiveShiftAlert(alertItem);
      playShiftAlertChime();
      try {
        navigator.vibrate?.([200, 100, 200]);
      } catch {}

      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        const notifOptions: NotificationOptions = {
          body: alertItem.message,
          icon: '/favicon.svg',
          badge: '/favicon.svg',
          tag: alertItem.id,
          data: { shiftAction: alertItem.action },
        };
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.ready
            .then(reg => reg.showNotification(alertItem.title, notifOptions))
            .catch(() => {
              try {
                new Notification(alertItem.title, notifOptions);
              } catch {}
            });
        } else {
          try {
            new Notification(alertItem.title, notifOptions);
          } catch {}
        }
      }
    },
    [playShiftAlertChime]
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'TSM_SHIFT_ALERT_ACTION' && event.data?.shiftAction) {
        handleTimeAction(event.data.shiftAction);
        setActiveShiftAlert(null);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [handleTimeAction]);

  useEffect(() => {
    if (!shiftSettings.enabled) {
      setActiveShiftAlert(null);
      return;
    }

    const checkShiftSchedule = () => {
      const now = new Date();
      const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const todayISO = getTodayDate();
      const idx = records.findIndex(r => r.date === todayISO);
      const todayRec = idx >= 0 ? records[idx] : records[0];

      let notifiedMap: Record<string, boolean> = {};
      try {
        notifiedMap = JSON.parse(localStorage.getItem('tsm_notified_shift_events_v1') || '{}');
      } catch {
        notifiedMap = {};
      }

      const scheduleEvents: Array<{
        key: 'clockIn' | 'startLunch' | 'endLunch' | 'clockOut';
        time: string;
        alreadyLogged: boolean;
        title: string;
        message: string;
        actionLabel: string;
      }> = [
        {
          key: 'clockIn',
          time: shiftSettings.startTime,
          alreadyLogged: Boolean(todayRec?.timeIn),
          title: 'Time to Clock In',
          message: `It's ${shiftSettings.startTime} — your scheduled shift is starting. Tap to Clock In now.`,
          actionLabel: 'Clock In Now',
        },
        {
          key: 'startLunch',
          time: shiftSettings.lunchStart,
          alreadyLogged: Boolean(todayRec?.lunchStart),
          title: 'Time to Lunch In (Start Lunch)',
          message: `It's ${shiftSettings.lunchStart} — time for your scheduled lunch break (minimum 30 mins policy).`,
          actionLabel: 'Lunch In Now',
        },
        {
          key: 'endLunch',
          time: shiftSettings.lunchEnd,
          alreadyLogged: Boolean(todayRec?.lunchEnd),
          title: 'Time to Lunch Out (End Lunch)',
          message: `It's ${shiftSettings.lunchEnd} — your scheduled lunch break is ending. Tap to Lunch Out.`,
          actionLabel: 'Lunch Out Now',
        },
        {
          key: 'clockOut',
          time: shiftSettings.endTime,
          alreadyLogged: Boolean(todayRec?.timeOut),
          title: 'Time to Clock Out',
          message: `It's ${shiftSettings.endTime} — your scheduled shift has ended. Tap to Clock Out now.`,
          actionLabel: 'Clock Out Now',
        },
      ];

      for (const ev of scheduleEvents) {
        if (!ev.time || ev.alreadyLogged) continue;
        const eventStorageKey = `${todayISO}_${ev.key}_${ev.time}`;
        if (currentHHMM === ev.time && !notifiedMap[eventStorageKey]) {
          notifiedMap[eventStorageKey] = true;
          try {
            localStorage.setItem('tsm_notified_shift_events_v1', JSON.stringify(notifiedMap));
          } catch {}
          triggerPWAAlert({
            id: eventStorageKey,
            title: ev.title,
            message: ev.message,
            action: ev.key,
            actionLabel: ev.actionLabel,
            scheduledTime: ev.time,
          });
          break;
        }
      }
    };

    checkShiftSchedule();
    const intervalId = window.setInterval(checkShiftSchedule, 10000);
    return () => window.clearInterval(intervalId);
  }, [
    shiftSettings.enabled,
    shiftSettings.startTime,
    shiftSettings.lunchStart,
    shiftSettings.lunchEnd,
    shiftSettings.endTime,
    records,
    triggerPWAAlert,
  ]);

  // Canvas Undo / Redo
  const handleCanvasEnd = () => {
    if (!sigCanvas.current) return;
    const data = sigCanvas.current.toData();
    const newHistory = canvasHistory.slice(0, historyPointer + 1);
    newHistory.push(data);
    setCanvasHistory(newHistory);
    setHistoryPointer(newHistory.length - 1);
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
    if (sigCanvas.current) {
      sigCanvas.current.clear();
    }
    setCanvasHistory([]);
    setHistoryPointer(-1);
    setSignature('');
    setTypedName('');
  };

  const handleTypedNameChange = (val: string) => {
    setTypedName(val);
    if (val.trim()) {
      const rendered = renderTypedSignatureImage(val, isDarkMode);
      setSignature(rendered);
    } else {
      setSignature('');
    }
  };

  const confirmClearTimesheet = () => {
    setName('');
    setEmployeeEmail('');
    const newStart = getInitialPeriodStart();
    setPeriodStart(newStart);
    setRecords(generateRecordsForPeriod(shiftSettings.period, newStart, []));
    setTotalHours('');
    handleClearSignature();
    setDate(getTodayDate());
    setRecipientEmail(DEFAULT_EMAIL);
    setSentLogs([]);
    setShowClearConfirm(false);
  };

  // Check date range warnings
  const isDateOutOfRange = (recordDateStr: string) => {
    if (!recordDateStr || !periodStart) return false;
    const [sy, sm, sd] = periodStart.split('-').map(Number);
    const start = new Date(sy, sm - 1, sd);
    let numDays = 14;
    if (shiftSettings.period === 'Weekly') numDays = 7;
    else if (shiftSettings.period === 'Monthly') {
      numDays = new Date(sy, sm, 0).getDate();
    }
    const end = new Date(sy, sm - 1, sd + numDays - 1);
    const [ry, rm, rd] = recordDateStr.split('-').map(Number);
    const recDate = new Date(ry, rm - 1, rd);
    return recDate < start || recDate > end;
  };

  const getErrors = (record: DailyRecord) => {
    const errs: Partial<Record<keyof DailyRecord, string>> = {};
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    const isValid = (t: string | undefined) => (t ? timeRegex.test(t) : false);

    if (record.timeIn && !isValid(record.timeIn)) errs.timeIn = "Invalid time";
    if (record.lunchStart && !isValid(record.lunchStart)) errs.lunchStart = "Invalid time";
    if (record.lunchEnd && !isValid(record.lunchEnd)) errs.lunchEnd = "Invalid time";
    if (record.timeOut && !isValid(record.timeOut)) errs.timeOut = "Invalid time";
    return errs;
  };

  const getDayValidationWarning = (record: DailyRecord): string | null => {
    const parseMinutes = (t: string) => {
      if (!t) return null;
      const parts = t.split(':').map(Number);
      if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
      return parts[0] * 60 + parts[1];
    };

    const tIn = parseMinutes(record.timeIn);
    const tOut = parseMinutes(record.timeOut);
    const lStart = parseMinutes(record.lunchStart);
    const lEnd = parseMinutes(record.lunchEnd);

    // Completely empty row is valid (day off / unfilled day)
    if (tIn === null && tOut === null && lStart === null && lEnd === null) {
      return null;
    }

    // Time Out entered without Time In
    if (tIn === null && tOut !== null) {
      return 'Time Out entered without Time In';
    }

    // Time Out earlier than Time In
    if (tIn !== null && tOut !== null) {
      if (tOut < tIn) {
        return 'Time Out is earlier than Time In (check 24-hr or AM/PM)';
      }
      if (tOut === tIn) {
        return 'Time Out is identical to Time In (0.00 hrs)';
      }
    }

    // Lunch validations
    if (lStart !== null && lEnd === null) {
      return 'Lunch Start entered without Lunch End';
    }
    if (lStart === null && lEnd !== null) {
      return 'Lunch End entered without Lunch Start';
    }

    if (lStart !== null && lEnd !== null) {
      if (lEnd <= lStart) {
        return 'Lunch End must be after Lunch Start';
      }
      if (tIn !== null && lStart < tIn) {
        return 'Lunch Start is earlier than Time In';
      }
      if (tOut !== null && lEnd > tOut) {
        return 'Lunch End is later than Time Out';
      }
      if (tIn !== null && tOut !== null && (lEnd - lStart) >= (tOut - tIn)) {
        return 'Lunch duration exceeds shift duration';
      }
      const lunchGapMinutes = lEnd - lStart;
      if (lunchGapMinutes < 30) {
        return `Lunch break is ${lunchGapMinutes} min — standard break policy requires at least 30 minutes`;
      }
    }

    return null;
  };

  const handleTimeCellKeyDown = useCallback(
    (
      e: React.KeyboardEvent<HTMLInputElement>,
      rowIndex: number,
      colIndex: number
    ) => {
      const totalRows = records.length;
      const totalCols = 4; // 0: Time In, 1: Lunch Start, 2: Lunch End, 3: Time Out
      if (totalRows === 0) return;

      let targetRow = rowIndex;
      let targetCol = colIndex;

      if (e.key === 'ArrowDown' || (e.key === 'Enter' && !e.shiftKey)) {
        targetRow = (rowIndex + 1) % totalRows;
      } else if (e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey)) {
        targetRow = (rowIndex - 1 + totalRows) % totalRows;
      } else if (e.key === 'ArrowRight') {
        if (colIndex < totalCols - 1) {
          targetCol = colIndex + 1;
        } else {
          targetRow = (rowIndex + 1) % totalRows;
          targetCol = 0;
        }
      } else if (e.key === 'ArrowLeft') {
        if (colIndex > 0) {
          targetCol = colIndex - 1;
        } else {
          targetRow = (rowIndex - 1 + totalRows) % totalRows;
          targetCol = totalCols - 1;
        }
      } else if (e.key === 'Home') {
        targetCol = 0;
      } else if (e.key === 'End') {
        targetCol = totalCols - 1;
      } else {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      const nextInput =
        timeCellRefs.current[`${targetRow}-${targetCol}`] ||
        document.querySelector<HTMLInputElement>(
          `input[data-timesheet-row="${targetRow}"][data-timesheet-col="${targetCol}"]`
        );

      if (nextInput) {
        nextInput.focus();
        nextInput.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        try {
          nextInput.select?.();
        } catch {}
      }
    },
    [records.length]
  );

  const [actionNotice, setActionNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showNotice = (type: 'success' | 'error', text: string) => {
    setActionNotice({ type, text });
    window.setTimeout(() => {
      setActionNotice(prev => (prev?.text === text ? null : prev));
    }, 5000);
  };

  // Vector PDF Generation with standardized filename
  const getPdfFilename = () => {
    const safeName = (name || 'Employee').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    const safePeriod = (periodStart || 'Period').replace(/[^a-zA-Z0-9_-]/g, '_');
    return `Timesheet_${safeName}_${safePeriod}.pdf`;
  };

  const generatePDF = async (): Promise<jsPDF | null> => {
    try {
      const rangeLabel = formatPeriodRange(periodStart, shiftSettings.period) || periodStart;
      const numTotal = parseFloat(totalHours || '0') || 0;
      const otHrs = overtimePeriodHours;
      const regHrs = regularPeriodHours;

      let sigImg = signature;
      if (signatureMode === 'draw' && sigCanvas.current && !sigCanvas.current.isEmpty()) {
        // Ensure dark strokes on light PDF paper even if user drew in dark mode
        sigImg = sigCanvas.current.toDataURL('image/png');
      }

      return generateVectorTimesheetPDF({
        companyName: companyName || 'Royal Transportation',
        periodType: shiftSettings.period,
        periodRangeLabel: rangeLabel,
        periodStart,
        employeeName: name || 'Employee',
        employeeEmail: user?.email || employeeEmail || '',
        managerEmail: recipientEmail || '',
        rows: records.map(r => ({
          day: r.day,
          date: r.date,
          timeIn: r.timeIn,
          lunchStart: r.lunchStart,
          lunchEnd: r.lunchEnd,
          timeOut: r.timeOut,
          totalHours: r.totalHours || '0.00',
          notes: r.notes || '',
        })),
        totalPeriodHours: numTotal,
        regularPeriodHours: regHrs,
        overtimePeriodHours: otHrs,
        signatureDataUrl: sigImg,
        typedSignature: signatureMode === 'type' ? (typedName || name) : '',
        signatureDate: date || getTodayDate(),
      });
    } catch (err) {
      console.error('Error generating vector PDF:', err);
      return null;
    }
  };

  const handleExportPDF = async () => {
    setIsGeneratingPDF(true);
    try {
      const pdf = await generatePDF();
      if (pdf) {
        const filename = getPdfFilename();
        pdf.save(filename);
        showNotice('success', `Exported ${filename}`);
      } else {
        showNotice('error', 'Could not generate PDF file.');
      }
    } catch (error) {
      console.error('Export PDF error:', error);
      showNotice('error', 'Error exporting PDF file.');
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  const handlePrint = async () => {
    setIsGeneratingPDF(true);
    try {
      const pdf = await generatePDF();
      if (pdf) {
        triggerPrintAndDownloadPDF(pdf, getPdfFilename());
        showNotice('success', `Prepared print view & downloaded ${getPdfFilename()}`);
      } else {
        window.print();
      }
    } catch (error) {
      console.error('Print error:', error);
      showNotice('error', 'Error preparing print view.');
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  const handleSendEmailClick = () => {
    if (!name?.trim()) {
      showNotice('error', 'Please enter your Employee Name before sending.');
      return;
    }
    const actualEmployeeEmail = user?.email || employeeEmail?.trim();
    if (!actualEmployeeEmail) {
      showNotice('error', 'Please enter your Employee Email address before sending.');
      return;
    }
    if (!signature && !(signatureMode === 'type' && typedName?.trim())) {
      showNotice('error', 'Please sign or type your signature before sending.');
      return;
    }
    if (!recipientEmail?.trim()) {
      showNotice('error', "Please enter manager's email address.");
      return;
    }
    setShowEmailConfirm(true);
  };

  const confirmSendEmail = async () => {
    setShowEmailConfirm(false);
    setIsSending(true);

    setTimeout(async () => {
      try {
        const pdf = await generatePDF();
        if (pdf) {
          pdf.save(getPdfFilename());
        }

        const rangeLabel = formatPeriodRange(periodStart, shiftSettings.period);
        const subject = encodeURIComponent(`Time Sheet: ${name || 'Employee'} - Period of ${rangeLabel || periodStart}`);

        // Update email history
        const currentEmails = recipientEmail.split(',').map(e => e.trim()).filter(Boolean);
        const newHistory = [...new Set([...currentEmails, ...emailHistory])].slice(0, 20);
        setEmailHistory(newHistory);
        localStorage.setItem(`email_history_${companyName}`, JSON.stringify(newHistory));

        let bodyText = `${companyName || 'Royal Transportation'} Time Sheet\n`;
        bodyText += `====================================\n\n`;
        bodyText += `Employee: ${name}\n`;
        bodyText += `Period: ${rangeLabel || periodStart}\n\n`;
        bodyText += `NOTE: Please attach the downloaded PDF timesheet to this email before hitting send.\n\n`;
        bodyText += `Logged Days Summary:\n`;
        bodyText += `--------------------\n`;
        records.forEach(r => {
          if (r.timeIn || r.timeOut || r.totalHours) {
            bodyText += `${r.day} (${r.date}): In: ${r.timeIn || '-'} | Lunch: ${r.lunchStart || '-'} - ${r.lunchEnd || '-'} | Out: ${r.timeOut || '-'} | Total: ${r.totalHours || '0'} hrs\n`;
            if (r.notes) bodyText += `  Note: ${r.notes}\n`;
          }
        });
        bodyText += `--------------------\n`;
        bodyText += `TOTAL HOURS: ${totalHours || '0.00'}\n\n`;
        bodyText += `Signature: ${signatureMode === 'type' ? `[Electronically Typed: ${typedName || name}]` : '[Electronically Signed]'}\n`;
        bodyText += `Date: ${date}\n`;

        const body = encodeURIComponent(bodyText);
        const actualEmployeeEmail = user?.email || employeeEmail?.trim();
        const ccParam = actualEmployeeEmail ? `cc=${encodeURIComponent(actualEmployeeEmail)}&` : '';
        window.location.href = `mailto:${recipientEmail}?${ccParam}subject=${subject}&body=${body}`;

        setSentLogs(prev => [...prev, { date: new Date().toISOString(), recipient: recipientEmail }]);
      } catch (err) {
        console.error('Error sending timesheet email:', err);
        alert('There was an error generating the PDF for email.');
      } finally {
        setIsSending(false);
      }
    }, 100);
  };

  const switchCompany = (newCompany: string) => {
    const currentData = {
      companyName,
      name,
      employeeEmail,
      weekOf: periodStart,
      periodStart,
      records,
      signature,
      date,
      recipientEmail,
      sentLogs
    };
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${companyName}`, JSON.stringify(currentData));

    const newData = loadSavedData(newCompany);
    setCompanyName(newCompany);
    localStorage.setItem(LAST_COMPANY_KEY, newCompany);

    setName(newData?.name || '');
    setEmployeeEmail(newData?.employeeEmail || '');
    const newStart = newData?.weekOf || newData?.periodStart || getInitialPeriodStart();
    setPeriodStart(newStart);
    setRecords(generateRecordsForPeriod(shiftSettings.period, newStart, newData?.records || []));
    setSignature(newData?.signature || '');
    setDate(newData?.date || getTodayDate());
    setRecipientEmail(newData?.recipientEmail || DEFAULT_EMAIL);
    setSentLogs(newData?.sentLogs || []);

    if (sigCanvas.current) {
      sigCanvas.current.clear();
      if (newData?.signature && newData.signature.startsWith('data:image')) {
        setTimeout(() => sigCanvas.current?.fromDataURL(newData.signature), 50);
      }
    }
  };

  const handleAddCompany = () => {
    const trimmed = newCompanyInput.trim();
    if (trimmed) {
      if (!companies.includes(trimmed)) {
        const nextList = [...companies, trimmed];
        setCompanies(nextList);
        localStorage.setItem('companies_list', JSON.stringify(nextList));
      }
      switchCompany(trimmed);
      setNewCompanyInput('');
      setIsCompanyDropdownOpen(false);
    }
  };

  const openHistory = () => {
    try {
      const historyKey = `${HISTORY_STORAGE_KEY_PREFIX}${companyName}`;
      let historyStr = localStorage.getItem(historyKey);
      if (!historyStr && companyName === 'Royal Transportation') {
        historyStr = localStorage.getItem('employee_timesheet_history');
      }
      setHistoryData(JSON.parse(historyStr || '{}'));
    } catch (e) {
      console.error('Failed to load history', e);
    }
    setIsHistoryOpen(true);
  };

  const loadHistoryItem = (key: string) => {
    const data = historyData[key];
    if (data) {
      setName(data.name || '');
      setEmployeeEmail(data.employeeEmail || '');
      const s = data.weekOf || data.periodStart || '';
      setPeriodStart(s);
      setRecords(data.records || []);
      setSignature(data.signature || '');
      setDate(data.date || getTodayDate());
      setRecipientEmail(data.recipientEmail || DEFAULT_EMAIL);
      setSentLogs(data.sentLogs || []);
      setIsHistoryOpen(false);

      setTimeout(() => {
        if (sigCanvas.current && data.signature && data.signature.startsWith('data:image')) {
          sigCanvas.current.clear();
          sigCanvas.current.fromDataURL(data.signature);
        } else if (sigCanvas.current) {
          sigCanvas.current.clear();
        }
      }, 100);
    }
  };

  const confirmDeleteHistoryItem = () => {
    if (!itemToDelete) return;
    const { week } = itemToDelete;
    setItemToDelete(null);
    const historyKey = `${HISTORY_STORAGE_KEY_PREFIX}${companyName}`;
    const nextHist = { ...historyData };
    delete nextHist[week];
    localStorage.setItem(historyKey, JSON.stringify(nextHist));
    setHistoryData(nextHist);
  };

  const filledDaysCount = useMemo(() => {
    return records.filter(r => r.timeIn || r.timeOut || (r.totalHours && parseFloat(r.totalHours) > 0)).length;
  }, [records]);

  // Calculate overtime (Phase 1 rule: >40h per 7-day workweek) & 40-hour weekly target progress
  const numericTotalHours = useMemo(() => parseFloat(totalHours || '0') || 0, [totalHours]);

  const { regularPeriodHours, overtimePeriodHours } = useMemo(() => {
    const bucketSize = 7;
    let regSum = 0;
    let otSum = 0;

    for (let i = 0; i < records.length; i += bucketSize) {
      const bucketSlice = records.slice(i, i + bucketSize);
      let bucketHours = 0;

      for (const r of bucketSlice) {
        bucketHours += parseFloat(r.totalHours || '0') || 0;
      }

      regSum += Math.min(40, bucketHours);
      otSum += Math.max(0, bucketHours - 40);
    }

    return {
      regularPeriodHours: regSum,
      overtimePeriodHours: otSum,
    };
  }, [records]);

  const isOvertimePeriod = overtimePeriodHours > 0;

  // 40-hour weekly target metrics
  const weeklyTargetHours = 40;
  const targetProgressPercent = useMemo(
    () => Math.min(100, Math.max(0, (numericTotalHours / weeklyTargetHours) * 100)),
    [numericTotalHours]
  );
  const remainingToTargetHours = useMemo(
    () => Math.max(0, weeklyTargetHours - numericTotalHours),
    [numericTotalHours]
  );
  const weekBreakdown = useMemo(() => {
    const sumSlice = (slice: DailyRecord[]) =>
      slice.reduce((acc, r) => acc + (parseFloat(r.totalHours || '0') || 0), 0);
    const w1 = sumSlice(records.slice(0, 7));
    const w2 = records.length > 7 ? sumSlice(records.slice(7, 14)) : null;
    return {
      week1Hours: w1,
      week1Percent: Math.min(100, (w1 / 40) * 100),
      week2Hours: w2,
      week2Percent: w2 !== null ? Math.min(100, (w2 / 40) * 100) : 0,
    };
  }, [records]);

  const periodRangeLabel = useMemo(() => {
    return formatPeriodRange(periodStart, shiftSettings.period);
  }, [periodStart, shiftSettings.period]);

  const totalHistoryCount = Object.keys(historyData).length;

  const highlightMatch = useCallback((text: string, query: string): React.ReactNode => {
    const trimmed = query.trim();
    if (!trimmed || !text) return text;
    const tokens = trimmed
      .split(/\s+/)
      .filter(Boolean)
      .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (tokens.length === 0) return text;
    const pattern = new RegExp(`(${tokens.join('|')})`, 'gi');
    const parts = String(text).split(pattern);
    const lowerTokens = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
    return parts.map((part, idx) =>
      lowerTokens.some(t => part.toLowerCase() === t) ? (
        <mark
          key={idx}
          className="bg-amber-200 dark:bg-amber-500/40 text-gray-900 dark:text-white rounded px-1 py-0.2 font-extrabold"
        >
          {part}
        </mark>
      ) : (
        part
      )
    );
  }, []);

  const filteredHistory = useMemo(() => {
    const rawTerm = historySearchTerm.trim().toLowerCase();
    const tokens = rawTerm.split(/\s+/).filter(Boolean);
    return Object.entries(historyData)
      .filter(([week, data]) => {
        if (tokens.length === 0) return true;
        const periodRaw = String(data.weekOf || data.periodStart || week);
        const formattedRange = formatPeriodRange(periodRaw, shiftSettings.period) || '';
        const totalHrs =
          data.records?.reduce((acc: number, r: any) => acc + (parseFloat(r.totalHours) || 0), 0).toFixed(2) || '0.00';
        const recordText = Array.isArray(data.records)
          ? data.records
              .map((r: any) => `${r.day || ''} ${r.date || ''} ${r.notes || ''} ${r.totalHours || ''}`)
              .join(' ')
          : '';
        const searchableBlob = [
          week,
          periodRaw,
          formattedRange,
          data.name || '',
          data.employeeEmail || '',
          data.date || '',
          `${totalHrs} hrs`,
          recordText,
        ]
          .join(' ')
          .toLowerCase();

        return tokens.every(token => searchableBlob.includes(token));
      })
      .sort((a, b) => b[0].localeCompare(a[0]));
  }, [historyData, historySearchTerm, shiftSettings.period]);

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-[#0b0f19] text-gray-900 dark:text-gray-100 py-3 sm:py-6 px-2.5 sm:px-5 lg:px-8 pb-28 md:pb-12 print:bg-white pdf:bg-white print:p-0 pdf:p-0">
      <div id="timesheet-content" className="max-w-7xl print:max-w-full pdf:max-w-full mx-auto space-y-4 sm:space-y-6">

        {/* PWA Shift Alert Banner (Clock In / Lunch In / Lunch Out / Clock Out) */}
        {activeShiftAlert && (
          <div
            role="alert"
            className="rounded-2xl p-3.5 sm:p-4 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-lg border border-indigo-400/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 print:hidden pdf:hidden animate-fadeIn"
          >
            <div className="flex items-start sm:items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                <Bell className="w-5 h-5 text-amber-300 animate-bounce" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs sm:text-sm font-extrabold tracking-tight">
                    {activeShiftAlert.title}
                  </span>
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-white/20">
                    {activeShiftAlert.scheduledTime}
                  </span>
                </div>
                <p className="text-xs text-indigo-100 mt-0.5 leading-snug">
                  {activeShiftAlert.message}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
              <button
                type="button"
                onClick={() => {
                  handleTimeAction(activeShiftAlert.action);
                  setActiveShiftAlert(null);
                  showNotice('success', `${activeShiftAlert.actionLabel.replace(' Now', '')} recorded at ${getCurrentTime()}`);
                }}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-white text-indigo-700 hover:bg-indigo-50 text-xs font-extrabold shadow-sm active:scale-95 transition-all"
              >
                {activeShiftAlert.actionLabel}
              </button>
              <button
                type="button"
                onClick={() => setActiveShiftAlert(null)}
                className="p-2 rounded-xl text-indigo-100 hover:text-white hover:bg-white/10 transition-colors"
                aria-label="Dismiss shift alert"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* In-App PDF / Validation Notice Banner */}
        {actionNotice && (
          <div
            role="status"
            className={`rounded-2xl px-4 py-3 text-xs sm:text-sm font-semibold flex items-center justify-between gap-3 shadow-sm border print:hidden pdf:hidden ${
              actionNotice.type === 'error'
                ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-800 dark:text-rose-200 border-rose-300 dark:border-rose-800'
                : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-800'
            }`}
          >
            <div className="flex items-center gap-2">
              {actionNotice.type === 'error' ? (
                <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              )}
              <span>{actionNotice.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setActionNotice(null)}
              className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
              aria-label="Dismiss notice"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* =========================================================================
            HEADER - STRICT RULES:
            - Settings gear icon ALL THE WAY to the far right edge of the header, alone.
            - NO dark mode / theme toggle in the header. Theme control lives ONLY inside Settings modal.
            - Demote "Login / Sign Up" so it doesn't compete with Send/Print. Add helper: "Login adds sync + history. Sheet works without it."
            ========================================================================= */}
        <header className="relative z-30 bg-white dark:bg-slate-900 rounded-2xl p-3.5 sm:p-4 lg:p-5 shadow-sm border border-gray-200/80 dark:border-slate-800 print:hidden pdf:hidden flex flex-col md:flex-row md:flex-wrap xl:flex-nowrap md:items-center justify-between gap-3 lg:gap-4">
          
          {/* Left Brand & Company */}
          <div className="flex items-center justify-between gap-3 w-full md:w-auto shrink-0">
            <div className="flex items-center gap-2.5 sm:gap-3">
              <div className="w-10 h-10 sm:w-11 sm:h-11 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-sm flex-shrink-0">
                <Clock className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <div>
                <h1 className="text-base sm:text-lg lg:text-xl font-bold tracking-tight text-gray-900 dark:text-white leading-tight whitespace-nowrap">
                  Time Sheet Manager
                </h1>
                
                {/* Company dropdown trigger */}
                <div className="relative inline-block text-left mt-0.5">
                  <button
                    onClick={() => setIsCompanyDropdownOpen(!isCompanyDropdownOpen)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
                  >
                    <span>{companyName}</span>
                    <ChevronDown className="w-3.5 h-3.5 opacity-70" />
                  </button>

                  {isCompanyDropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setIsCompanyDropdownOpen(false)} />
                      <div className="absolute left-0 mt-2 w-64 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-gray-200 dark:border-slate-700 z-50 overflow-hidden">
                        <div className="p-2 border-b border-gray-100 dark:border-slate-700 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                          Select Company
                        </div>
                        <div className="max-h-48 overflow-y-auto py-1">
                          {companies.map(c => (
                            <button
                              key={c}
                              onClick={() => {
                                switchCompany(c);
                                setIsCompanyDropdownOpen(false);
                              }}
                              className={`w-full text-left px-3.5 py-2 text-sm font-medium flex items-center justify-between hover:bg-gray-50 dark:hover:bg-slate-700 ${
                                companyName === c ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50/60 dark:bg-indigo-900/20' : 'text-gray-800 dark:text-slate-200'
                              }`}
                            >
                              <span>{c}</span>
                              {companyName === c && <Check className="w-4 h-4" />}
                            </button>
                          ))}
                        </div>
                        <div className="p-2 border-t border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60 flex gap-2">
                          <input
                            type="text"
                            placeholder="Add company..."
                            value={newCompanyInput}
                            onChange={e => setNewCompanyInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleAddCompany()}
                            className="flex-1 px-2.5 py-1.5 text-xs border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-white"
                          />
                          <button
                            onClick={handleAddCompany}
                            disabled={!newCompanyInput.trim()}
                            className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                          >
                            Add
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Mobile Settings Icon - pinned to the far right on mobile */}
            <div className="md:hidden">
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="w-11 h-11 flex items-center justify-center text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 rounded-xl transition-all active:scale-95 focus:ring-2 focus:ring-indigo-500"
                aria-label="Settings"
                title="Settings"
              >
                <Settings className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Desktop Controls + Demoted Login + Alone Settings Gear on Far Right */}
          <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2.5 lg:gap-3 w-full md:w-auto md:flex-1">
            
            {/* Last saved indicator - Darker & Prominent */}
            {lastSaved && (
              <div className="text-xs font-medium text-gray-700 dark:text-slate-300 flex items-center gap-1.5 shrink-0">
                <Save className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span className="whitespace-nowrap">
                  Last saved {lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            )}

            {/* Primary Header Business Login entry point */}
            <div className="flex flex-col items-start sm:items-end shrink-0">
              <button
                onClick={onOpenBusinessLogin}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 px-2.5 py-1 rounded-lg bg-indigo-50/70 dark:bg-indigo-950/40 hover:bg-indigo-100/80 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
              >
                <User className="w-3.5 h-3.5 shrink-0" />
                <span>Business Login</span>
              </button>
              <p className="text-[10px] text-gray-400 dark:text-slate-500 text-left sm:text-right leading-tight mt-0.5 whitespace-nowrap">
                Login adds sync + history. Sheet works without it.
              </p>
            </div>

            {/* Desktop Actions: Manager Email, Print, Send */}
            <div className="hidden md:flex items-center gap-2 shrink-0">
              <div className="relative" ref={emailContainerRef}>
                <input
                  type="email"
                  placeholder="Manager's Email(s)"
                  value={recipientEmail}
                  onChange={e => setRecipientEmail(e.target.value)}
                  onFocus={() => setShowEmailHistory(true)}
                  className="w-44 lg:w-56 pl-3 pr-7 py-2 text-xs lg:text-sm border border-gray-300 dark:border-slate-700 rounded-xl bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:bg-white"
                />
                <button
                  type="button"
                  onClick={() => setShowEmailHistory(!showEmailHistory)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>

                {showEmailHistory && (
                  <div className="absolute right-0 top-full mt-1.5 w-64 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-xl z-50 overflow-hidden">
                    <div className="p-2 border-b border-gray-100 dark:border-slate-700 text-xs font-semibold text-gray-500">
                      Saved Emails
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      {emailHistory.length === 0 ? (
                        <div className="p-3 text-xs text-gray-400 text-center">
                          {recipientEmail ? `Current: ${recipientEmail}` : 'No saved emails yet'}
                        </div>
                      ) : (
                        emailHistory.map(email => (
                          <button
                            key={email}
                            type="button"
                            onClick={() => {
                              setRecipientEmail(email);
                              setShowEmailHistory(false);
                            }}
                            className="w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center justify-between"
                          >
                            <span className="truncate">{email}</span>
                            {recipientEmail.includes(email) && <Check className="w-3.5 h-3.5 text-indigo-600" />}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={handleExportPDF}
                disabled={isGeneratingPDF}
                title="Download formatted A4 PDF timesheet"
                className="min-h-[40px] lg:min-h-[44px] px-3 lg:px-3.5 py-2 text-xs lg:text-sm font-semibold text-gray-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl hover:bg-gray-50 dark:hover:bg-slate-700 transition-all flex items-center gap-1.5 active:scale-95 disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                {isGeneratingPDF ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                <span>PDF</span>
              </button>

              <button
                onClick={handlePrint}
                disabled={isGeneratingPDF}
                title="Print timesheet and save PDF copy"
                className="min-h-[40px] lg:min-h-[44px] px-3 lg:px-3.5 py-2 text-xs lg:text-sm font-semibold text-gray-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl hover:bg-gray-50 dark:hover:bg-slate-700 transition-all flex items-center gap-1.5 active:scale-95 disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                {isGeneratingPDF ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
                <span>Print</span>
              </button>

              <button
                onClick={handleSendEmailClick}
                disabled={isSending}
                className="min-h-[40px] lg:min-h-[44px] px-3.5 lg:px-4 py-2 text-xs lg:text-sm font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition-all flex items-center gap-1.5 shadow-sm active:scale-95 disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                <span>Send</span>
              </button>
            </div>

            {/* Desktop Settings Gear - ALL THE WAY to the far right edge, alone! */}
            <div className="hidden md:block pl-2 border-l border-gray-200 dark:border-slate-800 shrink-0">
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="w-10 h-10 lg:w-11 lg:h-11 flex items-center justify-center text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 rounded-xl transition-all active:scale-95 focus:ring-2 focus:ring-indigo-500"
                aria-label="Settings"
                title="Settings"
              >
                <Settings className="w-5 h-5" />
              </button>
            </div>
          </div>
        </header>

        {/* =========================================================================
            MAIN TIMESHEET FORM CARD
            - Solid white card, rounded-2xl, soft shadow.
            ========================================================================= */}
        <div className="bg-white dark:bg-slate-900 shadow-sm rounded-2xl p-4 sm:p-6 lg:p-8 border border-gray-200/80 dark:border-slate-800 print:shadow-none pdf:shadow-none print:border-none pdf:border-none print:p-0 pdf:p-0">
          
          {/* Company Title (Print & Desktop) */}
          <div className="text-center mb-6 sm:mb-8">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">
              {companyName}
            </h2>
            <p className="text-sm font-medium text-gray-500 dark:text-slate-400 mt-1 uppercase tracking-wider">
              Employee Time Sheet • {shiftSettings.period} Period
            </p>

            {/* Quick Clock Actions */}
            <div className="mt-4 print:hidden pdf:hidden flex flex-wrap justify-center gap-2.5">
              {(() => {
                const todayRec = records[todayRecordIndex] || records[0];
                const hasIn = !!todayRec?.timeIn;
                const hasLs = !!todayRec?.lunchStart;
                const hasLe = !!todayRec?.lunchEnd;
                const hasOut = !!todayRec?.timeOut;

                const canClockIn = !hasIn || (hasIn && hasOut);
                const canStartLunch = hasIn && !hasLs && !hasOut;
                const canEndLunch = hasIn && hasLs && !hasLe && !hasOut;
                const canClockOut = hasIn && !hasOut && (!hasLs || hasLe);

                return (
                  <>
                    {canClockIn && (
                      <button
                        onClick={() => handleTimeAction('clockIn')}
                        className="min-h-[44px] px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold shadow-sm transition-all active:scale-95 flex items-center gap-2 focus:ring-2 focus:ring-indigo-500"
                      >
                        <LogIn className="w-4 h-4 text-emerald-300" />
                        Clock In (Now)
                      </button>
                    )}
                    {canStartLunch && (
                      <button
                        onClick={() => handleTimeAction('startLunch')}
                        className="min-h-[44px] px-5 py-2.5 bg-[#FEF9C3] hover:bg-yellow-200 text-amber-900 border border-amber-300 rounded-xl text-sm font-bold shadow-sm transition-all active:scale-95 flex items-center gap-2 focus:ring-2 focus:ring-amber-500"
                      >
                        <Utensils className="w-4 h-4 text-amber-700" />
                        Start Lunch
                      </button>
                    )}
                    {canEndLunch && (
                      <button
                        onClick={() => handleTimeAction('endLunch')}
                        className="min-h-[44px] px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold shadow-sm transition-all active:scale-95 flex items-center gap-2 focus:ring-2 focus:ring-emerald-500"
                      >
                        <Utensils className="w-4 h-4 text-emerald-200" />
                        End Lunch
                      </button>
                    )}
                    {canClockOut && (
                      <button
                        onClick={() => handleTimeAction('clockOut')}
                        className="min-h-[44px] px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-sm font-bold shadow-sm transition-all active:scale-95 flex items-center gap-2 focus:ring-2 focus:ring-rose-500"
                      >
                        <LogOut className="w-4 h-4 text-rose-200" />
                        Clock Out
                      </button>
                    )}
                  </>
                );
              })()}
            </div>
          </div>

          {/* Employee Info Header: Name, CC Email, Period Starting & Full Range */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8 pb-6 border-b border-gray-200/80 dark:border-slate-800">
            {/* Name */}
            <div className="space-y-1">
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-slate-400">
                Employee Name
              </label>
              <input
                type="text"
                value={name}
                onChange={handleNameChange}
                placeholder="Full Name"
                className="w-full min-h-[44px] px-3.5 py-2 text-base font-bold text-gray-900 dark:text-white bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 print:border-none print:p-0 print:text-lg"
              />
            </div>

            {/* Email for CC */}
            <div className="space-y-1">
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-slate-400">
                Your Email (for CC)
              </label>
              <input
                type="email"
                value={user?.email || employeeEmail}
                onChange={e => setEmployeeEmail(e.target.value)}
                disabled={!!user}
                placeholder="you@example.com"
                className="w-full min-h-[44px] px-3.5 py-2 text-base font-medium text-gray-900 dark:text-white bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 disabled:opacity-75 print:border-none print:p-0"
              />
            </div>

            {/* Period Starting date & Full Range */}
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
                onChange={handlePeriodStartChange}
                className="w-full min-h-[44px] px-3.5 py-2 text-base font-bold text-gray-900 dark:text-white bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 print:border-none print:p-0"
              />
            </div>
          </div>

          {/* =========================================================================
              VISUAL 40-HOUR WEEKLY TARGET PROGRESS BAR (MAIN TIMESHEET VIEW)
              ========================================================================= */}
          <div className="mb-6 sm:mb-8 p-4 sm:p-5 rounded-2xl bg-gray-50/90 dark:bg-slate-800/70 border border-gray-200/90 dark:border-slate-700/80 print:hidden pdf:hidden">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs sm:text-sm font-extrabold uppercase tracking-wider text-gray-800 dark:text-slate-100 flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                  <span>40-Hour Weekly Target Progress</span>
                </span>
                {isOvertimePeriod ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-extrabold bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
                    <AlertTriangle className="w-3 h-3 text-rose-600 dark:text-rose-400" />
                    <span>+{overtimePeriodHours.toFixed(2)} hrs over 40h target</span>
                  </span>
                ) : numericTotalHours >= 40 ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-extrabold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                    <span>40h Target Reached!</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800/70">
                    <span>{remainingToTargetHours.toFixed(2)} hrs remaining to 40h</span>
                  </span>
                )}
              </div>

              <div className="flex items-baseline gap-1.5 self-start sm:self-auto">
                <span
                  className={`text-lg sm:text-xl font-black font-mono tabular-nums ${
                    isOvertimePeriod
                      ? 'text-rose-600 dark:text-rose-400'
                      : numericTotalHours >= 40
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-indigo-600 dark:text-indigo-400'
                  }`}
                >
                  {numericTotalHours.toFixed(2)}
                </span>
                <span className="text-xs sm:text-sm font-bold text-gray-500 dark:text-slate-400 font-mono">
                  / 40.00 hrs ({Math.round(targetProgressPercent)}%)
                </span>
              </div>
            </div>

            {/* Progress Track with 10h / 20h / 30h / 40h Milestone Ticks */}
            <div
              className="relative w-full h-3.5 sm:h-4 bg-gray-200/90 dark:bg-slate-700 rounded-full overflow-hidden shadow-inner"
              role="progressbar"
              aria-valuenow={Math.min(40, numericTotalHours)}
              aria-valuemin={0}
              aria-valuemax={40}
              aria-label="Progress toward 40-hour weekly target"
            >
              {/* Milestone dividers at 25% (10h), 50% (20h), 75% (30h) */}
              <div className="absolute inset-0 grid grid-cols-4 pointer-events-none z-10">
                <div className="border-r border-white/50 dark:border-slate-900/40" />
                <div className="border-r border-white/50 dark:border-slate-900/40" />
                <div className="border-r border-white/50 dark:border-slate-900/40" />
                <div />
              </div>

              <div
                className={`h-full rounded-full transition-all duration-500 ease-out ${
                  isOvertimePeriod
                    ? 'bg-gradient-to-r from-indigo-600 via-amber-500 to-rose-600'
                    : numericTotalHours >= 40
                      ? 'bg-emerald-600'
                      : numericTotalHours >= 32
                        ? 'bg-gradient-to-r from-indigo-600 to-emerald-500'
                        : 'bg-indigo-600'
                }`}
                style={{ width: `${targetProgressPercent}%` }}
              />
            </div>

            {/* Scale Labels under Progress Bar */}
            <div className="flex items-center justify-between text-[10px] font-bold font-mono text-gray-400 dark:text-slate-500 mt-1 px-0.5">
              <span>0h</span>
              <span>10h</span>
              <span>20h</span>
              <span>30h</span>
              <span className={isOvertimePeriod ? 'text-rose-600 dark:text-rose-400 font-extrabold' : 'text-gray-600 dark:text-slate-300'}>
                40h Target
              </span>
            </div>

            {/* If Bi-weekly (14 days), show Week 1 and Week 2 individual 40-hr progress bars */}
            {weekBreakdown.week2Hours !== null && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-3 pt-3 border-t border-gray-200/80 dark:border-slate-700/70">
                <div className="bg-white dark:bg-slate-900/80 px-3 py-2 rounded-xl border border-gray-200/80 dark:border-slate-700/70">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-bold text-gray-600 dark:text-slate-300">Week 1 (Days 1–7)</span>
                    <span
                      className={`font-mono font-black ${
                        weekBreakdown.week1Hours > 40
                          ? 'text-rose-600 dark:text-rose-400'
                          : weekBreakdown.week1Hours === 40
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-gray-900 dark:text-white'
                      }`}
                    >
                      {weekBreakdown.week1Hours.toFixed(2)} / 40.00 hrs
                    </span>
                  </div>
                  <div className="w-full h-2 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        weekBreakdown.week1Hours > 40
                          ? 'bg-rose-600'
                          : weekBreakdown.week1Hours >= 40
                            ? 'bg-emerald-600'
                            : 'bg-indigo-600'
                      }`}
                      style={{ width: `${weekBreakdown.week1Percent}%` }}
                    />
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900/80 px-3 py-2 rounded-xl border border-gray-200/80 dark:border-slate-700/70">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-bold text-gray-600 dark:text-slate-300">Week 2 (Days 8–14)</span>
                    <span
                      className={`font-mono font-black ${
                        weekBreakdown.week2Hours > 40
                          ? 'text-rose-600 dark:text-rose-400'
                          : weekBreakdown.week2Hours === 40
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-gray-900 dark:text-white'
                      }`}
                    >
                      {weekBreakdown.week2Hours.toFixed(2)} / 40.00 hrs
                    </span>
                  </div>
                  <div className="w-full h-2 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        weekBreakdown.week2Hours > 40
                          ? 'bg-rose-600'
                          : weekBreakdown.week2Hours >= 40
                            ? 'bg-emerald-600'
                            : 'bg-indigo-600'
                      }`}
                      style={{ width: `${weekBreakdown.week2Percent}%` }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* =========================================================================
              MOBILE ACCORDION VIEW (<768px, md breakpoint)
              - 14 stacked day cards
              - Collapsible accordion. Past/future days collapsed by default.
              - Today expanded + highlighted with indigo border + TODAY badge.
              - "Jump to Today" button + sticky mini-summary: "Total Hours: X" + "X of 14 days filled".
              - 1-line empty-state guide on fresh sheet.
              - STRICT COLORS:
                * TIME IN / OUT: #FFFFFF pure white, large bold black numbers, green/red icons.
                * LUNCH START / END: #FEF9C3 light yellow ONLY + fork/knife icon.
                * TOTAL HRS, DATE, NOTES: #FFFFFF pure white.
              ========================================================================= */}
          <div className="block md:hidden print:hidden pdf:hidden mb-8">
            
            {/* Mobile Top Bar: Mini Summary + Jump to Today + Expand/Collapse All */}
            <div className="sticky top-2 z-20 mb-3 bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-gray-200 dark:border-slate-800 shadow-sm flex items-center justify-between gap-2">
              <div className="text-xs font-bold text-gray-700 dark:text-slate-300 flex items-center flex-wrap gap-1">
                <span>
                  Total:{' '}
                  <strong
                    className={`font-black ${
                      isOvertimePeriod
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-indigo-600 dark:text-indigo-400'
                    }`}
                  >
                    {totalHours || '0.00'}
                  </strong>{' '}
                  hrs
                </span>
                {isOvertimePeriod && (
                  <span
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800 text-[10px] font-extrabold uppercase tracking-tight"
                    title={`${overtimePeriodHours.toFixed(2)} hours over 40 in this period`}
                  >
                    <AlertTriangle className="w-3 h-3 text-rose-600 dark:text-rose-400 shrink-0" />
                    <span>+{overtimePeriodHours.toFixed(2)} OT</span>
                  </span>
                )}
                <span className="mx-1 opacity-40">•</span>
                <span className="text-gray-500 dark:text-slate-400">{filledDaysCount} of {records.length} filled</span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={jumpToToday}
                  className="min-h-[38px] px-2.5 py-1 text-xs font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg border border-indigo-200 dark:border-indigo-800 flex items-center gap-1 active:scale-95"
                >
                  <Calendar className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Today</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (expandedDays.length === records.length) collapseAllDays();
                    else expandAllDays();
                  }}
                  className="min-h-[38px] px-2.5 py-1 text-xs font-semibold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 rounded-lg active:scale-95"
                >
                  {expandedDays.length === records.length ? 'Collapse' : 'Expand All'}
                </button>
              </div>
            </div>

            {/* Empty state guide */}
            {filledDaysCount === 0 && (
              <div className="p-3 mb-3 bg-indigo-50/80 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/50 rounded-xl text-xs text-indigo-800 dark:text-indigo-200 flex items-center gap-2">
                <span className="text-base">👉</span>
                <span>Tap <strong>Today</strong> below to enter your shift times, or use the Clock buttons above.</span>
              </div>
            )}

            {/* Stacked 14 Day Cards */}
            <div className="space-y-3">
              {records.map((record, index) => {
                const isToday = record.date === todayDateStr;
                const isExpanded = expandedDays.includes(index);
                const errors = getErrors(record);
                const outOfRange = isDateOutOfRange(record.date);
                const dayWarning = getDayValidationWarning(record);

                return (
                  <div
                    key={`${record.day}-${index}`}
                    ref={el => {
                      dayCardRefs.current[index] = el;
                    }}
                    className={`bg-white dark:bg-slate-800 rounded-2xl transition-all shadow-sm ${
                      isToday
                        ? 'border-2 border-indigo-600 dark:border-indigo-500 ring-2 ring-indigo-500/20'
                        : dayWarning
                        ? 'border-2 border-amber-300 dark:border-amber-600/80'
                        : 'border border-gray-200/90 dark:border-slate-700/80'
                    }`}
                  >
                    {/* Card Header (Accordion Trigger >= 44px tap target) */}
                    <button
                      type="button"
                      onClick={() => toggleAccordion(index)}
                      className="w-full min-h-[52px] p-3.5 flex items-center justify-between text-left focus:outline-none"
                    >
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-lg sm:text-xl font-black text-gray-900 dark:text-white tracking-tight">
                          {record.day}
                        </span>
                        {(() => {
                          const { monthShort, dayNum, yearSuffix } = getSmartDateParts(record.date);
                          return (
                            <span className="inline-flex items-baseline gap-1 text-gray-700 dark:text-slate-200">
                              {monthShort && (
                                <span className="text-base sm:text-lg font-bold text-gray-600 dark:text-slate-300">
                                  {monthShort}
                                </span>
                              )}
                              <span className="text-xl sm:text-2xl font-black font-mono tabular-nums text-gray-900 dark:text-white">
                                {dayNum}
                              </span>
                              {yearSuffix && (
                                <span className="text-sm font-bold text-gray-500 dark:text-slate-400">
                                  {yearSuffix}
                                </span>
                              )}
                            </span>
                          );
                        })()}
                        {isToday && (
                          <span className="bg-indigo-600 text-white text-[11px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider">
                            Today
                          </span>
                        )}
                        {outOfRange && (
                          <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                            <AlertTriangle className="w-3 h-3" />
                            Out of range
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {dayWarning ? (
                          <span className="text-xs font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 px-2 py-1 rounded-lg flex items-center gap-1" title={dayWarning}>
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                            <span>{record.totalHours && parseFloat(record.totalHours) > 0 ? `${record.totalHours} hrs` : 'Check hrs'}</span>
                          </span>
                        ) : record.totalHours && parseFloat(record.totalHours) > 0 ? (
                          <span className="text-xs font-black bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 px-2 py-1 rounded-lg flex items-center gap-1.5 border border-emerald-200/60 dark:border-emerald-800/60" title="Valid shift entry">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                            <span>{record.totalHours} hrs</span>
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400 dark:text-slate-500 font-medium">
                            0.00 hrs
                          </span>
                        )}
                        <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-slate-700/60 flex items-center justify-center text-gray-500">
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </div>
                      </div>
                    </button>

                    {/* Collapsed Preview row if has times but collapsed */}
                    {!isExpanded && (record.timeIn || record.timeOut) && (
                      <div className="px-3.5 pb-3 text-xs text-gray-600 dark:text-slate-300 flex items-center justify-between border-t border-gray-100 dark:border-slate-700/40 pt-2 flex-wrap gap-2">
                        <div className="flex items-center gap-3">
                          <span>In: <strong className="text-gray-900 dark:text-white">{record.timeIn || '-'}</strong></span>
                          <span>Out: <strong className="text-gray-900 dark:text-white">{record.timeOut || '-'}</strong></span>
                          {record.notes && <span className="truncate italic text-gray-400">"{record.notes}"</span>}
                        </div>
                        {dayWarning && (
                          <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3 text-amber-600 flex-shrink-0" />
                            <span className="truncate max-w-[150px]" title={dayWarning}>{dayWarning}</span>
                          </span>
                        )}
                      </div>
                    )}

                    {/* Expanded Content */}
                    {isExpanded && (
                      <div className="p-3.5 pt-0 space-y-3.5 border-t border-gray-100 dark:border-slate-700/60">
                        {/* Date Picker & Copy Previous Day row */}
                        <div className="pt-2 flex items-center justify-between gap-2 flex-wrap sm:flex-nowrap">
                          <div className="flex items-center gap-2">
                            <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-slate-400">
                              Date
                            </label>
                            <input
                              type="date"
                              value={record.date}
                              onChange={e => handleRecordChange(index, 'date', e.target.value)}
                              className="min-h-[44px] px-2.5 py-1 text-sm font-bold bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded-xl text-gray-900 dark:text-white"
                            />
                          </div>

                          {index > 0 && (
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() =>
                                  setMobileToolMenuDayIndex(prev => (prev === index ? null : index))
                                }
                                className={`min-h-[44px] px-3 py-1 text-xs font-bold rounded-xl transition-all active:scale-95 flex items-center gap-1.5 border shadow-2xs ${
                                  copiedIndex === index
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-700'
                                    : mobileToolMenuDayIndex === index
                                      ? 'bg-indigo-100 text-indigo-800 border-indigo-300 dark:bg-indigo-900/70 dark:text-indigo-200 dark:border-indigo-700'
                                      : 'bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 border-gray-300/80 dark:border-slate-700'
                                }`}
                                title="Day Tools"
                                aria-expanded={mobileToolMenuDayIndex === index}
                              >
                                {copiedIndex === index ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                    <span>Copied ({records[index - 1].day.slice(0, 3)})</span>
                                  </>
                                ) : (
                                  <>
                                    <Wrench className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                                    <span>Tools</span>
                                    <ChevronDown
                                      className={`w-3.5 h-3.5 transition-transform ${
                                        mobileToolMenuDayIndex === index ? 'rotate-180' : ''
                                      }`}
                                    />
                                  </>
                                )}
                              </button>

                              {mobileToolMenuDayIndex === index && (
                                <div className="absolute right-0 mt-1.5 w-56 bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-gray-200 dark:border-slate-700 p-1.5 z-30">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setMobileToolMenuDayIndex(null);
                                      setCopyConfirmDayIndex(index);
                                    }}
                                    className="w-full min-h-[42px] px-3 py-2 text-xs font-bold text-left rounded-xl text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 flex items-center gap-2 transition-colors"
                                  >
                                    <Copy className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                                    <div className="flex flex-col">
                                      <span>Copy Previous Day</span>
                                      <span className="text-[10px] font-medium text-gray-500 dark:text-slate-400">
                                        From {records[index - 1].day} ({records[index - 1].totalHours} hrs)
                                      </span>
                                    </div>
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* TIME IN & TIME OUT: STRICT PURE WHITE BACKGROUND #FFFFFF - HERO TYPOGRAPHY */}
                        <div className="grid grid-cols-2 gap-2 sm:gap-3">
                          {/* TIME IN */}
                          <div className="bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-gray-200 dark:border-slate-700 space-y-1.5">
                            <button
                              type="button"
                              onClick={() => handleQuickTimeButtonTap(index, 'timeIn', 'Time In')}
                              title={
                                record.timeIn
                                  ? `Time In already set (${record.timeIn}) — tap to confirm update`
                                  : 'Tap to set Time In to current time'
                              }
                              className={`w-full min-h-[38px] px-3 py-1.5 rounded-xl border text-xs font-extrabold uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-2xs active:scale-95 transition-all ${
                                record.timeIn
                                  ? 'bg-emerald-50/60 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/60 text-emerald-700/80 dark:text-emerald-400/80'
                                  : 'bg-emerald-50 hover:bg-emerald-100/90 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/60 border-emerald-300 dark:border-emerald-700/80 text-emerald-800 dark:text-emerald-300'
                              }`}
                            >
                              <LogIn className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                              <span>Time In</span>
                              {record.timeIn && (
                                <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                              )}
                            </button>
                            <input
                              type="time"
                              value={record.timeIn}
                              onClick={e => {
                                try {
                                  (e.currentTarget as any).showPicker?.();
                                } catch {}
                              }}
                              onChange={e => handleRecordChange(index, 'timeIn', e.target.value)}
                              className="mobile-time-input time-input-mono w-full min-h-[48px] px-0 text-[22px] min-[390px]:text-[24px] sm:text-[26px] font-black text-gray-900 dark:text-white bg-white dark:bg-slate-900 border-none rounded-lg focus:ring-0 p-0 text-center font-mono tabular-nums cursor-pointer leading-none"
                            />
                            {errors.timeIn && <p className="text-xs text-rose-600">{errors.timeIn}</p>}
                          </div>

                          {/* TIME OUT */}
                          <div className="bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-gray-200 dark:border-slate-700 space-y-1.5">
                            <button
                              type="button"
                              onClick={() => handleQuickTimeButtonTap(index, 'timeOut', 'Time Out')}
                              title={
                                record.timeOut
                                  ? `Time Out already set (${record.timeOut}) — tap to confirm update`
                                  : 'Tap to set Time Out to current time'
                              }
                              className={`w-full min-h-[38px] px-3 py-1.5 rounded-xl border text-xs font-extrabold uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-2xs active:scale-95 transition-all ${
                                record.timeOut
                                  ? 'bg-rose-50/60 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800/60 text-rose-700/80 dark:text-rose-400/80'
                                  : 'bg-rose-50 hover:bg-rose-100/90 dark:bg-rose-950/60 dark:hover:bg-rose-900/60 border-rose-300 dark:border-rose-700/80 text-rose-800 dark:text-rose-300'
                              }`}
                            >
                              <LogOut className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                              <span>Time Out</span>
                              {record.timeOut && (
                                <Check className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
                              )}
                            </button>
                            <input
                              type="time"
                              value={record.timeOut}
                              onClick={e => {
                                try {
                                  (e.currentTarget as any).showPicker?.();
                                } catch {}
                              }}
                              onChange={e => handleRecordChange(index, 'timeOut', e.target.value)}
                              className="mobile-time-input time-input-mono w-full min-h-[48px] px-0 text-[22px] min-[390px]:text-[24px] sm:text-[26px] font-black text-gray-900 dark:text-white bg-white dark:bg-slate-900 border-none rounded-lg focus:ring-0 p-0 text-center font-mono tabular-nums cursor-pointer leading-none"
                            />
                            {errors.timeOut && <p className="text-xs text-rose-600">{errors.timeOut}</p>}
                          </div>
                        </div>

                        {/* LUNCH IN & LUNCH OUT: STRICT LIGHT YELLOW #FEF9C3 ONLY */}
                        <div className="grid grid-cols-2 gap-2 sm:gap-3">
                          {/* LUNCH IN (LUNCH START) */}
                          <div className="bg-[#FEF9C3] dark:bg-amber-950/40 p-2.5 rounded-xl border border-amber-300/80 dark:border-amber-700/60 space-y-1.5">
                            <button
                              type="button"
                              onClick={() => handleQuickTimeButtonTap(index, 'lunchStart', 'Lunch In')}
                              title={
                                record.lunchStart
                                  ? `Lunch In already set (${record.lunchStart}) — tap to confirm update`
                                  : 'Tap to set Lunch In to current time'
                              }
                              className={`w-full min-h-[38px] px-3 py-1.5 rounded-xl border text-xs font-extrabold uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-2xs active:scale-95 transition-all ${
                                record.lunchStart
                                  ? 'bg-amber-200/50 dark:bg-amber-900/40 border-amber-300/80 dark:border-amber-700/60 text-amber-900/80 dark:text-amber-200/80'
                                  : 'bg-amber-200/80 hover:bg-amber-300/80 dark:bg-amber-900/70 dark:hover:bg-amber-800/70 border-amber-400/90 dark:border-amber-600 text-amber-950 dark:text-amber-100'
                              }`}
                            >
                              <Utensils className="w-3.5 h-3.5 text-amber-800 dark:text-amber-300 shrink-0" />
                              <span>Lunch In</span>
                              {record.lunchStart && (
                                <Check className="w-3.5 h-3.5 text-amber-800 dark:text-amber-300 shrink-0" />
                              )}
                            </button>
                            <input
                              type="time"
                              value={record.lunchStart}
                              onClick={e => {
                                try {
                                  (e.currentTarget as any).showPicker?.();
                                } catch {}
                              }}
                              onChange={e => handleRecordChange(index, 'lunchStart', e.target.value)}
                              className="mobile-time-input time-input-mono w-full min-h-[44px] px-0 text-base sm:text-[17px] font-bold text-gray-900 dark:text-amber-100 bg-[#FEF9C3] dark:bg-transparent border-none rounded-lg focus:ring-0 p-0 text-center font-mono tabular-nums cursor-pointer leading-none"
                            />
                            {errors.lunchStart && <p className="text-xs text-rose-600">{errors.lunchStart}</p>}
                          </div>

                          {/* LUNCH OUT (LUNCH END) */}
                          <div className="bg-[#FEF9C3] dark:bg-amber-950/40 p-2.5 rounded-xl border border-amber-300/80 dark:border-amber-700/60 space-y-1.5">
                            <button
                              type="button"
                              onClick={() => handleQuickTimeButtonTap(index, 'lunchEnd', 'Lunch Out')}
                              title={
                                record.lunchEnd
                                  ? `Lunch Out already set (${record.lunchEnd}) — tap to confirm update`
                                  : 'Tap to set Lunch Out to current time'
                              }
                              className={`w-full min-h-[38px] px-3 py-1.5 rounded-xl border text-xs font-extrabold uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-2xs active:scale-95 transition-all ${
                                record.lunchEnd
                                  ? 'bg-amber-200/50 dark:bg-amber-900/40 border-amber-300/80 dark:border-amber-700/60 text-amber-900/80 dark:text-amber-200/80'
                                  : 'bg-amber-200/80 hover:bg-amber-300/80 dark:bg-amber-900/70 dark:hover:bg-amber-800/70 border-amber-400/90 dark:border-amber-600 text-amber-950 dark:text-amber-100'
                              }`}
                            >
                              <Utensils className="w-3.5 h-3.5 text-amber-800 dark:text-amber-300 shrink-0" />
                              <span>Lunch Out</span>
                              {record.lunchEnd && (
                                <Check className="w-3.5 h-3.5 text-amber-800 dark:text-amber-300 shrink-0" />
                              )}
                            </button>
                            <input
                              type="time"
                              value={record.lunchEnd}
                              onClick={e => {
                                try {
                                  (e.currentTarget as any).showPicker?.();
                                } catch {}
                              }}
                              onChange={e => handleRecordChange(index, 'lunchEnd', e.target.value)}
                              className="mobile-time-input time-input-mono w-full min-h-[44px] px-0 text-base sm:text-[17px] font-bold text-gray-900 dark:text-amber-100 bg-[#FEF9C3] dark:bg-transparent border-none rounded-lg focus:ring-0 p-0 text-center font-mono tabular-nums cursor-pointer leading-none"
                            />
                            {errors.lunchEnd && <p className="text-xs text-rose-600">{errors.lunchEnd}</p>}
                          </div>
                        </div>

                        {/* TOTAL HRS & NOTES: STRICT PURE WHITE BACKGROUND #FFFFFF */}
                        <div className="grid grid-cols-3 gap-2 sm:gap-3 pt-1">
                          {/* TOTAL HRS */}
                          <div className={`bg-white dark:bg-slate-900 p-2.5 rounded-xl border ${
                            dayWarning 
                              ? 'border-amber-300 dark:border-amber-600 ring-1 ring-amber-300/40 bg-amber-50/20' 
                              : record.totalHours && parseFloat(record.totalHours) > 0
                              ? 'border-emerald-300 dark:border-emerald-700 ring-1 ring-emerald-400/20'
                              : 'border-gray-200 dark:border-slate-700'
                          } space-y-1 relative`}>
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-slate-400">
                                Total Hrs
                              </span>
                              {dayWarning ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-600 dark:text-amber-400 cursor-help" title={dayWarning}>
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                                  <span className="hidden sm:inline">Invalid</span>
                                </span>
                              ) : record.totalHours && parseFloat(record.totalHours) > 0 ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400" title="Valid shift entry">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                                  <span className="hidden sm:inline">Valid</span>
                                </span>
                              ) : null}
                            </div>
                            <div className="flex items-center justify-center gap-1.5 py-0.5">
                              <span className={`text-2xl font-black font-mono ${
                                dayWarning 
                                  ? 'text-amber-600 dark:text-amber-400' 
                                  : record.totalHours && parseFloat(record.totalHours) > 0
                                  ? 'text-emerald-700 dark:text-emerald-300'
                                  : 'text-gray-900 dark:text-white'
                              }`}>
                                {record.totalHours || '0.00'}
                              </span>
                              {dayWarning ? (
                                <span title={dayWarning} className="flex-shrink-0">
                                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                                </span>
                              ) : record.totalHours && parseFloat(record.totalHours) > 0 ? (
                                <span title="Valid shift entry" className="flex-shrink-0">
                                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                </span>
                              ) : null}
                            </div>
                            {/* Small help text beneath Total Hours */}
                            {dayWarning ? (
                              <p className="text-[11px] leading-tight text-amber-700 dark:text-amber-300 font-semibold text-center flex items-center justify-center gap-0.5 pt-0.5" title={dayWarning}>
                                <AlertTriangle className="w-3 h-3 flex-shrink-0 text-amber-600 inline" />
                                <span className="truncate">Check times</span>
                              </p>
                            ) : record.totalHours && parseFloat(record.totalHours) > 0 ? (
                              <p className="text-[11px] leading-tight text-emerald-600 dark:text-emerald-400 font-medium text-center flex items-center justify-center gap-0.5 pt-0.5">
                                <span>Shift complete</span>
                              </p>
                            ) : null}
                          </div>

                          {/* NOTES */}
                          <div className="col-span-2 bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-gray-200 dark:border-slate-700 space-y-1">
                            <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-slate-400 block">
                              Notes
                            </span>
                            <input
                              type="text"
                              value={record.notes}
                              onChange={e => handleRecordChange(index, 'notes', e.target.value)}
                              placeholder="Overtime / Notes"
                              className="w-full min-h-[44px] px-3 py-1.5 text-base font-medium text-gray-900 dark:text-white bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            />
                          </div>
                        </div>

                        {/* Tooltip / small help text beneath the 'Total Hours' field in each day card */}
                        {dayWarning && (
                          <div className="flex items-start gap-2 p-2.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-xl text-xs text-amber-900 dark:text-amber-200 animate-fadeIn">
                            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                            <div className="leading-snug">
                              <span className="font-bold">
                                {dayWarning.includes('standard break policy')
                                  ? 'Break Policy Notice:'
                                  : 'Invalid time entry:'}
                              </span>{' '}
                              {dayWarning}
                            </div>
                          </div>
                        )}

                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* =========================================================================
              DESKTOP TABLE VIEW (Visible on >=768px Desktop & Print)
              - One 7-column table
              - Strict Color & Typography Rules:
                * TIME IN / TIME OUT: #FFFFFF pure white, large bold numbers 26-28px, green/red icons
                * LUNCH START / LUNCH END: #FEF9C3 light yellow ONLY, 17-18px font, fork/knife icon
                * DATE / TOTAL HRS / NOTES: #FFFFFF pure white
                * TOTAL HRS: extra large bold, pure white background
              ========================================================================= */}
          <div className="hidden md:block print:block pdf:block overflow-x-auto print:overflow-visible pdf:overflow-visible mb-8 border border-gray-200 dark:border-slate-800 rounded-2xl print:border-none print:rounded-none bg-white dark:bg-slate-900">
            <table className="w-full table-fixed divide-y divide-gray-200 dark:divide-slate-800 print:divide-gray-800 pdf:divide-gray-800">
              <thead className="bg-gray-50/80 dark:bg-slate-800/60 print:bg-transparent pdf:bg-transparent">
                <tr>
                  <th scope="col" className="px-2.5 lg:px-3 py-3 text-left text-xs font-bold text-gray-600 dark:text-slate-300 uppercase tracking-wider w-[13%] print:w-[15%]">
                    Date
                  </th>
                  <th scope="col" className="px-2.5 lg:px-3 py-3 text-left text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider w-[16%] print:w-[14%] bg-white dark:bg-slate-900">
                    <span className="flex items-center gap-1">
                      <LogIn className="w-3.5 h-3.5 text-emerald-600 shrink-0 inline" />
                      <span>Time In</span>
                    </span>
                  </th>
                  <th scope="col" className="px-2 lg:px-3 py-3 text-left text-xs font-bold text-amber-900 dark:text-amber-200 uppercase tracking-wider w-[13.5%] print:w-[13%] bg-[#FEF9C3] dark:bg-amber-950/40">
                    <span className="flex items-center gap-1">
                      <Utensils className="w-3.5 h-3.5 text-amber-700 dark:text-amber-300 shrink-0 inline" />
                      <span className="truncate">Lunch Start</span>
                    </span>
                  </th>
                  <th scope="col" className="px-2 lg:px-3 py-3 text-left text-xs font-bold text-amber-900 dark:text-amber-200 uppercase tracking-wider w-[13.5%] print:w-[13%] bg-[#FEF9C3] dark:bg-amber-950/40">
                    <span className="flex items-center gap-1">
                      <Utensils className="w-3.5 h-3.5 text-amber-700 dark:text-amber-300 shrink-0 inline" />
                      <span className="truncate">Lunch End</span>
                    </span>
                  </th>
                  <th scope="col" className="px-2.5 lg:px-3 py-3 text-left text-xs font-bold text-rose-700 dark:text-rose-400 uppercase tracking-wider w-[16%] print:w-[14%] bg-white dark:bg-slate-900">
                    <span className="flex items-center gap-1">
                      <LogOut className="w-3.5 h-3.5 text-rose-600 shrink-0 inline" />
                      <span>Time Out</span>
                    </span>
                  </th>
                  <th scope="col" className="px-2 py-3 text-center text-xs font-extrabold text-gray-900 dark:text-white uppercase tracking-wider w-[10%] print:w-[11%] bg-white dark:bg-slate-900">
                    Total Hrs
                  </th>
                  <th scope="col" className="px-2.5 lg:px-3 py-3 text-left text-xs font-bold text-gray-600 dark:text-slate-300 uppercase tracking-wider w-[18%] bg-white dark:bg-slate-900">
                    Notes
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-800 print:divide-gray-800">
                {records.map((record, index) => {
                  const isToday = record.date === todayDateStr;
                  const outOfRange = isDateOutOfRange(record.date);
                  const dayWarning = getDayValidationWarning(record);
                  const trimmedNote = record.notes ? record.notes.trim() : '';
                  const hasNote = trimmedNote.length > 0;

                  return (
                    <tr
                      key={index}
                      className={`group hover:bg-gray-50/60 dark:hover:bg-slate-800/40 transition-all ${
                        isToday
                          ? 'today-row-glow bg-indigo-50/40 dark:bg-indigo-950/30'
                          : ''
                      }`}
                    >
                      {/* DATE */}
                      <td
                        className={`px-2.5 lg:px-3 py-2.5 align-middle ${
                          isToday
                            ? 'bg-indigo-50/45 dark:bg-indigo-950/35 border-l-4 border-l-indigo-600 dark:border-l-indigo-400 print:bg-white print:border-l-0'
                            : 'bg-white dark:bg-slate-900'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1 flex-wrap">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-lg lg:text-xl xl:text-[22px] font-black text-gray-900 dark:text-white tracking-tight leading-none">
                              {record.day.slice(0, 3)}
                            </span>
                            {isToday && (
                              <span className="text-[10px] font-extrabold bg-indigo-600 text-white px-2 py-0.5 rounded-full uppercase shadow-xs ring-2 ring-indigo-400/50 animate-pulse print:animate-none print:ring-0">
                                Today
                              </span>
                            )}
                            {hasNote && (
                              <span
                                tabIndex={0}
                                aria-label={`Note for ${record.day} (${record.date}): ${trimmedNote}`}
                                aria-describedby={`desktop-date-note-tooltip-${index}`}
                                className="group/date-note relative inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800/70 text-[10px] font-bold cursor-help focus:outline-none focus:ring-2 focus:ring-indigo-500 print:hidden pdf:hidden"
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 dark:bg-indigo-400 shrink-0" aria-hidden="true" />
                                <FileText className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                                <span
                                  id={`desktop-date-note-tooltip-${index}`}
                                  role="tooltip"
                                  className={`pointer-events-none absolute left-0 ${
                                    index === 0 ? 'top-full mt-1.5' : 'bottom-full mb-1.5'
                                  } z-40 w-56 max-w-xs p-2.5 rounded-xl bg-gray-900 dark:bg-slate-800 text-white text-xs font-medium leading-relaxed shadow-xl border border-gray-700 dark:border-slate-600 opacity-0 invisible group-hover/date-note:opacity-100 group-hover/date-note:visible group-focus-within/date-note:opacity-100 group-focus-within/date-note:visible transition-all duration-150 whitespace-normal break-words`}
                                >
                                  <span className="block text-[10px] font-extrabold uppercase tracking-wider text-indigo-300 mb-0.5">
                                    {record.day} Note
                                  </span>
                                  <span>{trimmedNote}</span>
                                </span>
                              </span>
                            )}
                          </div>
                          {index > 0 && (
                            <button
                              type="button"
                              onClick={() => copyPreviousDay(index)}
                              className={`flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 bg-indigo-50/70 hover:bg-indigo-100 dark:bg-indigo-950/50 rounded transition-all active:scale-95 print:hidden pdf:hidden ${
                                copiedIndex === index
                                  ? 'opacity-100'
                                  : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus:opacity-100 focus:pointer-events-auto'
                              }`}
                              title={`Copy time entries from previous day (${records[index - 1].day})`}
                            >
                              {copiedIndex === index ? (
                                <>
                                  <Check className="w-2.5 h-2.5 text-emerald-600" />
                                  <span className="text-emerald-600 font-bold">Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-2.5 h-2.5 text-indigo-500" />
                                  <span>Copy prev</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>
                        <label className="relative block mt-1 cursor-pointer group/date">
                          {(() => {
                            const { monthShort, dayNum, yearSuffix } = getSmartDateParts(record.date);
                            return (
                              <span className="inline-flex items-baseline gap-1 text-gray-800 dark:text-slate-200 group-hover/date:text-indigo-600 dark:group-hover/date:text-indigo-400 transition-colors leading-none">
                                {monthShort && (
                                  <span className="text-base lg:text-lg font-extrabold text-gray-600 dark:text-slate-300 group-hover/date:text-indigo-600 dark:group-hover/date:text-indigo-400">
                                    {monthShort}
                                  </span>
                                )}
                                <span className="text-xl lg:text-2xl xl:text-[25px] font-black font-mono tabular-nums text-gray-900 dark:text-white group-hover/date:text-indigo-600 dark:group-hover/date:text-indigo-400">
                                  {dayNum}
                                </span>
                                {yearSuffix && (
                                  <span className="text-sm lg:text-base font-bold text-gray-500 dark:text-slate-400">
                                    {yearSuffix}
                                  </span>
                                )}
                              </span>
                            );
                          })()}
                          <input
                            type="date"
                            value={record.date}
                            onClick={e => {
                              try {
                                (e.currentTarget as any).showPicker?.();
                              } catch {}
                            }}
                            onChange={e => handleRecordChange(index, 'date', e.target.value)}
                            className="sr-only"
                            aria-label={`Date for ${record.day}`}
                          />
                        </label>
                        {outOfRange && (
                          <div className="text-[10px] text-amber-600 flex items-center gap-0.5 print:hidden pdf:hidden">
                            <AlertTriangle className="w-3 h-3" />
                            Out of range
                          </div>
                        )}
                      </td>

                      {/* TIME IN: STRICT PURE WHITE, LARGE BOLD */}
                      <td className="px-2.5 lg:px-3 py-2 align-middle bg-white dark:bg-slate-900 focus-within:ring-2 focus-within:ring-inset focus-within:ring-indigo-500/60 transition-shadow">
                        <div className="flex flex-col gap-1">
                          <input
                            ref={el => {
                              timeCellRefs.current[`${index}-0`] = el;
                            }}
                            type="time"
                            value={record.timeIn}
                            data-timesheet-row={index}
                            data-timesheet-col={0}
                            aria-label={`${record.day} ${record.date} Time In`}
                            onKeyDownCapture={e => handleTimeCellKeyDown(e, index, 0)}
                            onClick={e => {
                              try {
                                (e.currentTarget as any).showPicker?.();
                              } catch {}
                            }}
                            onChange={e => handleRecordChange(index, 'timeIn', e.target.value)}
                            className="time-input-mono w-full text-[19px] lg:text-[22px] xl:text-[24px] font-black font-mono tracking-tight tabular-nums text-gray-900 dark:text-white bg-white dark:bg-slate-900 border-none p-0 rounded focus:ring-2 focus:ring-indigo-500/40 cursor-pointer print:text-[14px] pdf:text-[14px]"
                          />
                          <div className="flex justify-start print:hidden pdf:hidden opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto transition-opacity duration-150">
                            <button
                              type="button"
                              onClick={() => handleRecordChange(index, 'timeIn', getCurrentTime())}
                              className="px-2 py-0.5 text-[10px] font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/30 rounded hover:bg-indigo-100 active:scale-95 transition-colors"
                            >
                              Now
                            </button>
                          </div>
                        </div>
                      </td>

                      {/* LUNCH START: STRICT LIGHT YELLOW #FEF9C3 ONLY */}
                      <td className="px-2 lg:px-2.5 py-2 align-middle bg-[#FEF9C3] dark:bg-amber-950/40 focus-within:ring-2 focus-within:ring-inset focus-within:ring-amber-500/70 transition-shadow">
                        <div className="flex flex-col gap-1">
                          <input
                            ref={el => {
                              timeCellRefs.current[`${index}-1`] = el;
                            }}
                            type="time"
                            value={record.lunchStart}
                            data-timesheet-row={index}
                            data-timesheet-col={1}
                            aria-label={`${record.day} ${record.date} Lunch Start`}
                            onKeyDownCapture={e => handleTimeCellKeyDown(e, index, 1)}
                            onClick={e => {
                              try {
                                (e.currentTarget as any).showPicker?.();
                              } catch {}
                            }}
                            onChange={e => handleRecordChange(index, 'lunchStart', e.target.value)}
                            className="time-input-mono w-full text-[15px] lg:text-[16px] xl:text-[17px] font-bold font-mono tracking-tight tabular-nums text-gray-900 dark:text-amber-100 bg-transparent border-none p-0 rounded focus:ring-2 focus:ring-amber-500/50 cursor-pointer print:text-[12px] pdf:text-[12px]"
                          />
                          <div className="flex justify-start print:hidden pdf:hidden opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto transition-opacity duration-150">
                            <button
                              type="button"
                              onClick={() => handleRecordChange(index, 'lunchStart', getCurrentTime())}
                              className="px-1.5 py-0.5 text-[10px] font-bold text-amber-900 dark:text-amber-200 bg-amber-200/70 dark:bg-amber-900/50 rounded hover:bg-amber-200 active:scale-95 transition-colors"
                            >
                              Now
                            </button>
                          </div>
                        </div>
                      </td>

                      {/* LUNCH END: STRICT LIGHT YELLOW #FEF9C3 ONLY */}
                      <td className="px-2 lg:px-2.5 py-2 align-middle bg-[#FEF9C3] dark:bg-amber-950/40 focus-within:ring-2 focus-within:ring-inset focus-within:ring-amber-500/70 transition-shadow">
                        <div className="flex flex-col gap-1">
                          <input
                            ref={el => {
                              timeCellRefs.current[`${index}-2`] = el;
                            }}
                            type="time"
                            value={record.lunchEnd}
                            data-timesheet-row={index}
                            data-timesheet-col={2}
                            aria-label={`${record.day} ${record.date} Lunch End`}
                            onKeyDownCapture={e => handleTimeCellKeyDown(e, index, 2)}
                            onClick={e => {
                              try {
                                (e.currentTarget as any).showPicker?.();
                              } catch {}
                            }}
                            onChange={e => handleRecordChange(index, 'lunchEnd', e.target.value)}
                            className="time-input-mono w-full text-[15px] lg:text-[16px] xl:text-[17px] font-bold font-mono tracking-tight tabular-nums text-gray-900 dark:text-amber-100 bg-transparent border-none p-0 rounded focus:ring-2 focus:ring-amber-500/50 cursor-pointer print:text-[12px] pdf:text-[12px]"
                          />
                          <div className="flex justify-start print:hidden pdf:hidden opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto transition-opacity duration-150">
                            <button
                              type="button"
                              onClick={() => handleRecordChange(index, 'lunchEnd', getCurrentTime())}
                              className="px-1.5 py-0.5 text-[10px] font-bold text-amber-900 dark:text-amber-200 bg-amber-200/70 dark:bg-amber-900/50 rounded hover:bg-amber-200 active:scale-95 transition-colors"
                            >
                              Now
                            </button>
                          </div>
                        </div>
                      </td>

                      {/* TIME OUT: STRICT PURE WHITE, LARGE BOLD */}
                      <td className="px-2.5 lg:px-3 py-2 align-middle bg-white dark:bg-slate-900 focus-within:ring-2 focus-within:ring-inset focus-within:ring-indigo-500/60 transition-shadow">
                        <div className="flex flex-col gap-1">
                          <input
                            ref={el => {
                              timeCellRefs.current[`${index}-3`] = el;
                            }}
                            type="time"
                            value={record.timeOut}
                            data-timesheet-row={index}
                            data-timesheet-col={3}
                            aria-label={`${record.day} ${record.date} Time Out`}
                            onKeyDownCapture={e => handleTimeCellKeyDown(e, index, 3)}
                            onClick={e => {
                              try {
                                (e.currentTarget as any).showPicker?.();
                              } catch {}
                            }}
                            onChange={e => handleRecordChange(index, 'timeOut', e.target.value)}
                            className="time-input-mono w-full text-[19px] lg:text-[22px] xl:text-[24px] font-black font-mono tracking-tight tabular-nums text-gray-900 dark:text-white bg-white dark:bg-slate-900 border-none p-0 rounded focus:ring-2 focus:ring-indigo-500/40 cursor-pointer print:text-[14px] pdf:text-[14px]"
                          />
                          <div className="flex justify-start print:hidden pdf:hidden opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto transition-opacity duration-150">
                            <button
                              type="button"
                              onClick={() => handleRecordChange(index, 'timeOut', getCurrentTime())}
                              className="px-2 py-0.5 text-[10px] font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/30 rounded hover:bg-indigo-100 active:scale-95 transition-colors"
                            >
                              Now
                            </button>
                          </div>
                        </div>
                      </td>

                      {/* TOTAL HRS: EXTRA LARGE BOLD, WHITE BACKGROUND */}
                      <td className="px-2 py-2 align-middle text-center bg-white dark:bg-slate-900">
                        <div className="relative group/warning flex flex-col items-center justify-center">
                          <div className="flex items-center justify-center gap-1">
                            <span className={`text-xl lg:text-2xl font-black font-mono print:text-[14px] pdf:text-[14px] ${
                              dayWarning ? 'text-amber-600 dark:text-amber-400' : 'text-gray-900 dark:text-white'
                            }`}>
                              {record.totalHours || '0.00'}
                            </span>
                            {dayWarning ? (
                              <span
                                tabIndex={0}
                                aria-label={dayWarning}
                                className="text-amber-500 cursor-help print:hidden pdf:hidden focus:outline-none"
                                title={dayWarning}
                              >
                                <AlertTriangle className="w-3.5 h-3.5" />
                              </span>
                            ) : record.totalHours && parseFloat(record.totalHours) > 0 ? (
                              <span className="text-emerald-500 print:hidden pdf:hidden" title="Valid shift entry">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              </span>
                            ) : null}
                          </div>
                          {dayWarning && (
                            <>
                              <span
                                className="text-[10px] text-amber-700 dark:text-amber-300 font-semibold leading-tight print:hidden pdf:hidden max-w-[105px] truncate cursor-help"
                                title={dayWarning}
                              >
                                {dayWarning.includes('standard break policy')
                                  ? '< 30m break policy'
                                  : dayWarning}
                              </span>
                              <div
                                role="tooltip"
                                className={`pointer-events-none absolute right-0 ${
                                  index === 0 ? 'top-full mt-1.5' : 'bottom-full mb-1.5'
                                } z-40 w-64 p-2.5 rounded-xl bg-amber-950 text-amber-50 text-xs font-medium leading-snug text-left shadow-xl border border-amber-700 opacity-0 invisible group-hover/warning:opacity-100 group-hover/warning:visible group-focus-within/warning:opacity-100 group-focus-within/warning:visible transition-all duration-150 whitespace-normal print:hidden pdf:hidden`}
                              >
                                <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-amber-300 mb-0.5">
                                  <AlertTriangle className="w-3 h-3 shrink-0" />
                                  <span>
                                    {dayWarning.includes('standard break policy')
                                      ? 'Standard Break Policy'
                                      : 'Validation Warning'}
                                  </span>
                                </div>
                                <div>{dayWarning}</div>
                              </div>
                            </>
                          )}
                          {!dayWarning && record.totalHours && parseFloat(record.totalHours) > 0 && (
                            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium leading-tight print:hidden pdf:hidden flex items-center gap-0.5">
                              <Check className="w-2.5 h-2.5" /> Valid
                            </span>
                          )}
                        </div>
                      </td>

                      {/* NOTES: WHITE BACKGROUND, PLACEHOLDER HIDDEN ON PRINT */}
                      <td className="px-2.5 lg:px-3 py-2 align-middle bg-white dark:bg-slate-900">
                        <div className="relative group/note flex items-center">
                          <input
                            type="text"
                            value={record.notes}
                            onChange={e => handleRecordChange(index, 'notes', e.target.value)}
                            placeholder="e.g., Overtime"
                            aria-label={`Notes for ${record.day}, ${record.date}`}
                            aria-describedby={hasNote ? `desktop-note-tooltip-${index}` : undefined}
                            className={`w-full text-xs lg:text-sm font-medium text-gray-900 dark:text-white bg-white dark:bg-slate-900 border rounded-lg py-1.5 focus:ring-2 focus:ring-indigo-500 print:border-none print:p-0 print:placeholder-transparent pdf:placeholder-transparent transition-colors ${
                              hasNote
                                ? 'pl-2.5 pr-7 border-indigo-300 dark:border-indigo-700/80 bg-indigo-50/15 dark:bg-indigo-950/20'
                                : 'px-2.5 border-gray-200/80 dark:border-slate-700/80'
                            }`}
                          />
                          {hasNote && (
                            <>
                              <span
                                className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-4 h-4 rounded-full bg-indigo-100 dark:bg-indigo-900/70 text-indigo-600 dark:text-indigo-300 pointer-events-none print:hidden pdf:hidden"
                                aria-hidden="true"
                              >
                                <FileText className="w-2.5 h-2.5" />
                              </span>
                              <div
                                id={`desktop-note-tooltip-${index}`}
                                role="tooltip"
                                className={`pointer-events-none absolute right-0 ${
                                  index === 0 ? 'top-full mt-1.5' : 'bottom-full mb-1.5'
                                } z-40 w-60 max-w-xs p-2.5 rounded-xl bg-gray-900 dark:bg-slate-800 text-white text-xs font-medium leading-relaxed shadow-xl border border-gray-700 dark:border-slate-600 opacity-0 invisible group-hover/note:opacity-100 group-hover/note:visible group-focus-within/note:opacity-100 group-focus-within/note:visible transition-all duration-150 whitespace-normal break-words print:hidden pdf:hidden`}
                              >
                                <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-indigo-300 mb-0.5">
                                  <FileText className="w-3 h-3 shrink-0" aria-hidden="true" />
                                  <span>{record.day} Note</span>
                                </div>
                                <div>{trimmedNote}</div>
                              </div>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* =========================================================================
              SIGNATURE BLOCK & TOTALS
              - Large canvas on mobile
              - Tabs: [Draw Signature] vs [Type Name Instead] fallback
              - Canvas Drawing has Undo / Redo / Clear Signature
              - Total Hours hero display (pure white background)
              ========================================================================= */}
          <div className="grid grid-cols-1 md:grid-cols-2 print:grid-cols-2 gap-6 print:gap-4 pt-4 print:pt-2.5 border-t border-gray-200/80 dark:border-slate-800 items-start print:break-inside-avoid">
            
            {/* Signature Section */}
            <div className="space-y-3 print:space-y-1.5 min-w-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-slate-400">
                    Employee Signature
                  </label>
                  <div className="relative group/sig-help inline-flex items-center print:hidden pdf:hidden">
                    <button
                      type="button"
                      aria-label="Draw signature help"
                      aria-describedby="signature-help-tooltip"
                      className="text-gray-400 hover:text-indigo-600 dark:text-slate-500 dark:hover:text-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 rounded-full p-0.5 transition-colors"
                    >
                      <HelpCircle className="w-3.5 h-3.5" />
                    </button>
                    <div
                      id="signature-help-tooltip"
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

                {/* Draw vs Type Mode Selector */}
                <div className="flex items-center gap-1 bg-gray-100 dark:bg-slate-800 p-1 rounded-xl print:hidden pdf:hidden">
                  <button
                    type="button"
                    onClick={() => setSignatureMode('draw')}
                    className={`min-h-[36px] px-3 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                      signatureMode === 'draw'
                        ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm'
                        : 'text-gray-600 dark:text-slate-400'
                    }`}
                  >
                    <PenTool className="w-3.5 h-3.5" />
                    <span>Draw</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSignatureMode('type');
                      if (!typedName && name) {
                        handleTypedNameChange(name);
                      }
                    }}
                    className={`min-h-[36px] px-3 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                      signatureMode === 'type'
                        ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm'
                        : 'text-gray-600 dark:text-slate-400'
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
                      penColor={isDarkMode ? '#ffffff' : '#000000'}
                      clearOnResize={false}
                      canvasProps={{
                        className: 'w-full h-36 sm:h-44 print:h-24 bg-white dark:bg-slate-800 cursor-crosshair'
                      }}
                      onEnd={handleCanvasEnd}
                    />
                    <span className="pointer-events-none select-none absolute bottom-2 right-3 text-[10px] text-gray-400 dark:text-slate-500 print:hidden pdf:hidden">
                      Sign with mouse or finger • or use &apos;Type Name&apos;
                    </span>
                  </div>

                  {/* Canvas Controls: Undo, Redo, Clear Signature */}
                  <div className="flex items-center justify-between mt-2 print:hidden pdf:hidden">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleUndo}
                        disabled={historyPointer < 0}
                        className="min-h-[40px] px-3 py-1 text-xs font-semibold text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700 transition-all flex items-center gap-1 disabled:opacity-40 active:scale-95"
                        title="Undo stroke"
                      >
                        <Undo2 className="w-3.5 h-3.5" />
                        <span>Undo</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleRedo}
                        disabled={historyPointer >= canvasHistory.length - 1}
                        className="min-h-[40px] px-3 py-1 text-xs font-semibold text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700 transition-all flex items-center gap-1 disabled:opacity-40 active:scale-95"
                        title="Redo stroke"
                      >
                        <Redo2 className="w-3.5 h-3.5" />
                        <span>Redo</span>
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={handleClearSignature}
                      className="min-h-[40px] px-3 py-1 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-all active:scale-95"
                    >
                      Clear Signature
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3 print:space-y-1.5">
                  <input
                    type="text"
                    value={typedName}
                    onChange={e => handleTypedNameChange(e.target.value)}
                    placeholder="Type your full name as signature"
                    className="w-full min-h-[48px] px-4 py-2 text-base font-semibold text-gray-900 dark:text-white bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-2xl focus:ring-2 focus:ring-indigo-500 print:hidden"
                  />
                  {typedName && (
                    <div className="p-4 print:p-2.5 border border-indigo-200 dark:border-indigo-900/60 rounded-2xl bg-indigo-50/40 dark:bg-indigo-950/20">
                      <div className="font-signature text-3xl sm:text-4xl print:text-2xl text-gray-900 dark:text-white italic">
                        {typedName}
                      </div>
                      <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-1 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600" />
                        <span>Digitally verified electronic signature for {typedName}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Signature Date */}
              <div className="pt-2 print:pt-1">
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-slate-400 mb-1">
                  Signature Date
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className="min-h-[44px] print:min-h-0 px-3 py-1.5 print:p-1 text-base print:text-xs font-semibold text-gray-900 dark:text-white bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* Total Hours Card (STRICT PURE WHITE BACKGROUND, EXTRA LARGE BOLD) */}
            <div
              className={`bg-white dark:bg-slate-800 p-6 sm:p-8 print:p-3.5 rounded-2xl border min-w-0 overflow-hidden ${
                isOvertimePeriod
                  ? 'border-rose-300 dark:border-rose-700 ring-1 ring-rose-500/20'
                  : 'border-gray-200 dark:border-slate-700'
              } space-y-4 print:space-y-2`}
            >
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-sm print:text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-slate-400">
                  Total Period Hours
                </span>
                <div className="flex items-center gap-2">
                  {isOvertimePeriod && (
                    <span className="inline-flex items-center gap-1 text-xs print:text-[10px] font-extrabold px-2.5 py-1 print:px-1.5 print:py-0.5 bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800 rounded-lg uppercase tracking-wide">
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                      <span>Overtime (&gt;40 hrs)</span>
                    </span>
                  )}
                  <span className="text-xs print:text-[10px] font-semibold px-2.5 py-1 print:px-1.5 print:py-0.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-lg">
                    {shiftSettings.period}
                  </span>
                </div>
              </div>

              <div
                className={`text-4xl sm:text-5xl print:text-2xl font-black font-mono tracking-tight ${
                  isOvertimePeriod
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-gray-900 dark:text-white'
                }`}
              >
                {totalHours || '0.00'}
                <span
                  className={`text-lg sm:text-xl print:text-sm font-bold ml-2 ${
                    isOvertimePeriod
                      ? 'text-rose-500 dark:text-rose-400'
                      : 'text-gray-400 dark:text-slate-500'
                  }`}
                >
                  hrs
                </span>
              </div>

              {/* Compact 40-Hour Target Progress inside Summary Card */}
              <div className="space-y-1.5 print:hidden pdf:hidden">
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="text-gray-500 dark:text-slate-400">40-Hr Weekly Target</span>
                  <span
                    className={
                      isOvertimePeriod
                        ? 'text-rose-600 dark:text-rose-400'
                        : numericTotalHours >= 40
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-indigo-600 dark:text-indigo-400'
                    }
                  >
                    {isOvertimePeriod
                      ? `100% (+${overtimePeriodHours.toFixed(2)}h OT)`
                      : `${Math.round(targetProgressPercent)}% (${remainingToTargetHours.toFixed(2)}h left)`}
                  </span>
                </div>
                <div className="w-full h-2.5 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      isOvertimePeriod
                        ? 'bg-rose-600'
                        : numericTotalHours >= 40
                          ? 'bg-emerald-600'
                          : 'bg-indigo-600'
                    }`}
                    style={{ width: `${targetProgressPercent}%` }}
                  />
                </div>
              </div>

              {/* Visual Overtime Breakdown (Both Mobile & Desktop) */}
              <div className="grid grid-cols-2 gap-3 print:gap-2 pt-1 print:pt-0">
                <div className="p-3 print:p-2 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900/60">
                  <div className="text-[11px] print:text-[9px] font-bold uppercase tracking-wider text-gray-500 dark:text-slate-400">
                    Regular Hours (≤40/wk)
                  </div>
                  <div className="text-lg print:text-sm font-black font-mono text-gray-900 dark:text-white mt-0.5">
                    {regularPeriodHours.toFixed(2)} <span className="text-xs print:text-[10px] font-semibold text-gray-400">hrs</span>
                  </div>
                </div>

                <div
                  className={`p-3 print:p-2 rounded-xl border ${
                    isOvertimePeriod
                      ? 'border-rose-300 dark:border-rose-700 bg-rose-50/70 dark:bg-rose-950/40'
                      : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900/60'
                  }`}
                >
                  <div
                    className={`text-[11px] print:text-[9px] font-bold uppercase tracking-wider flex items-center gap-1 ${
                      isOvertimePeriod
                        ? 'text-rose-700 dark:text-rose-300'
                        : 'text-gray-500 dark:text-slate-400'
                    }`}
                  >
                    {isOvertimePeriod && <AlertTriangle className="w-3 h-3 text-rose-600 dark:text-rose-400 shrink-0" />}
                    <span>
                      Overtime (&gt;40/wk)
                    </span>
                  </div>
                  <div
                    className={`text-lg print:text-sm font-black font-mono mt-0.5 ${
                      isOvertimePeriod
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-gray-400 dark:text-slate-500'
                    }`}
                  >
                    {isOvertimePeriod ? `+${overtimePeriodHours.toFixed(2)}` : '0.00'}{' '}
                    <span className="text-xs print:text-[10px] font-semibold">hrs</span>
                  </div>
                </div>
              </div>

              <p className="text-xs print:text-[10px] text-gray-500 dark:text-slate-400 leading-relaxed print:leading-snug break-words whitespace-normal max-w-full">
                Total hours are automatically calculated based on
                <br className="hidden print:inline" /> Time In, Time Out, and Lunch deduction.
              </p>

              {sentLogs.length > 0 && (
                <div className="pt-3 print:pt-1.5 border-t border-gray-100 dark:border-slate-700 text-xs print:text-[10px] text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 print:w-3 print:h-3 text-emerald-600" />
                  <span>Last sent: {new Date(sentLogs[sentLogs.length - 1].date).toLocaleString()}</span>
                </div>
              )}
            </div>

          </div>
        </div>

        {/* =========================================================================
            MOBILE STICKY BOTTOM ACTION BAR (MOBILE ONLY)
            - Always-visible [Send - primary] + [Print] + live Total Hours
            - Respects safe-area-inset-bottom
            - Buttons >= 44x44px
            ========================================================================= */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-gray-200 dark:border-slate-800 px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-slate-400">
                Total Hours
              </span>
              {isOvertimePeriod && (
                <span className="px-1.5 py-0.2 rounded bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800 text-[10px] font-extrabold uppercase">
                  +{overtimePeriodHours.toFixed(2)} OT
                </span>
              )}
            </div>
            <span
              className={`text-xl font-black font-mono leading-tight ${
                isOvertimePeriod
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-indigo-600 dark:text-indigo-400'
              }`}
            >
              {totalHours || '0.00'}{' '}
              <span className={`text-xs ${isOvertimePeriod ? 'text-rose-500' : 'text-gray-400'}`}>
                hrs
              </span>
            </span>
          </div>

          <div className="flex items-center gap-2 flex-1 justify-end">
            <button
              onClick={handleExportPDF}
              disabled={isGeneratingPDF}
              className="min-h-[44px] min-w-[44px] px-3 py-2 text-sm font-bold text-gray-700 dark:text-slate-200 bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl flex items-center gap-1.5 active:scale-95 disabled:opacity-60"
              aria-label="Export PDF timesheet"
              title="Download PDF"
            >
              {isGeneratingPDF ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              <span className="hidden sm:inline">PDF</span>
            </button>

            <button
              onClick={handlePrint}
              disabled={isGeneratingPDF}
              className="min-h-[44px] min-w-[44px] px-3 py-2 text-sm font-bold text-gray-700 dark:text-slate-200 bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl flex items-center gap-1.5 active:scale-95 disabled:opacity-60"
              aria-label="Print timesheet"
              title="Print"
            >
              {isGeneratingPDF ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              <span className="hidden sm:inline">Print</span>
            </button>

            <button
              onClick={handleSendEmailClick}
              disabled={isSending}
              className="min-h-[44px] px-5 py-2.5 text-sm font-extrabold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 shadow-md active:scale-95 disabled:opacity-60 flex-1 max-w-[210px]"
            >
              {isSending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Sending...</span>
                </>
              ) : (
                <>
                  <Mail className="w-4 h-4" />
                  <span>Send</span>
                </>
              )}
            </button>
          </div>
        </div>

      </div>

      {/* =========================================================================
          SETTINGS MODAL
          - Close via X + Done button + Escape + backdrop tap
          - Shift notifications & times
          - Timesheet Period selector
          - View Timesheet History
          - Theme Switch (THE ONLY PLACE FOR THEME SWITCH!)
          - Clear Timesheet Data (with confirmation)
          ========================================================================= */}
      {isSettingsOpen && (
        <div
          className="fixed inset-0 bg-black/55 dark:bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-3 sm:p-4"
          onClick={() => setIsSettingsOpen(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col border border-gray-200/90 dark:border-slate-800 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4.5 border-b border-gray-100 dark:border-slate-800 bg-gradient-to-r from-indigo-50/70 via-white to-white dark:from-slate-800/80 dark:via-slate-900 dark:to-slate-900">
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-sm shrink-0">
                  <Settings className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white leading-tight">
                    Settings
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                    Workspace access, display preferences &amp; shift defaults
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 sm:p-6 overflow-y-auto space-y-6">

              {/* Prominent Business Login & Workspace Portal Card at Top of Modal */}
              <section
                aria-label="Business Account and Portal"
                className="p-5 rounded-2xl bg-gradient-to-br from-indigo-600/10 via-indigo-50/90 to-white dark:from-indigo-950/80 dark:via-slate-800/90 dark:to-slate-900 border-2 border-indigo-200 dark:border-indigo-800/80 shadow-sm ring-1 ring-indigo-500/10 space-y-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3.5">
                    <div className="w-11 h-11 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-sm shrink-0 mt-0.5">
                      <User className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm sm:text-base font-extrabold text-gray-900 dark:text-white tracking-tight">
                          Business Account &amp; Portal
                        </h4>
                        <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-md bg-indigo-100 dark:bg-indigo-900/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-700/60">
                          Workspace Access
                        </span>
                      </div>
                      <p className="text-xs text-gray-600 dark:text-slate-300 mt-1.5 leading-relaxed">
                        Login adds sync + history. Sheet works without it. Sign in to access the Admin Console, Web Punch Clock, and My Hours.
                      </p>
                    </div>
                  </div>
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsSettingsOpen(false);
                      onOpenBusinessLogin();
                    }}
                    className="w-full min-h-[46px] px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs sm:text-sm font-bold shadow-sm flex items-center justify-between transition-all active:scale-[0.99]"
                  >
                    <span className="flex items-center gap-2.5">
                      <LogIn className="w-4 h-4" />
                      <span>Business Login</span>
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-100">
                      <span>Open Portal</span>
                      <ChevronRight className="w-4 h-4" />
                    </span>
                  </button>
                </div>
              </section>

              {/* Appearance Section - Icon-prefixed Header & Generous Toggle Spacing */}
              <section
                aria-label="Appearance"
                className="p-5 rounded-2xl bg-gray-50/90 dark:bg-slate-800/50 border border-gray-200/90 dark:border-slate-800 space-y-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-amber-100/80 dark:bg-indigo-950/80 text-amber-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                      {isDarkMode ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                    </div>
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-slate-200">
                        Appearance
                      </h4>
                      <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                        Choose your preferred interface theme
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsDarkMode(!isDarkMode)}
                    className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline shrink-0"
                  >
                    Theme: {isDarkMode ? 'Dark Mode' : 'Light Mode'}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3.5 pt-0.5">
                  <button
                    type="button"
                    onClick={() => setIsDarkMode(false)}
                    className={`min-h-[48px] px-4 py-2.5 rounded-xl border text-xs sm:text-sm font-bold flex items-center justify-center gap-2.5 transition-all ${
                      !isDarkMode
                        ? 'bg-white dark:bg-slate-800 border-indigo-600 text-indigo-600 shadow-xs ring-2 ring-indigo-500/20'
                        : 'bg-white/70 dark:bg-slate-900/60 border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-400 hover:bg-white'
                    }`}
                  >
                    <Sun className={`w-4 h-4 ${!isDarkMode ? 'text-amber-500' : 'text-gray-400'}`} />
                    <span>Light Mode</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsDarkMode(true)}
                    className={`min-h-[48px] px-4 py-2.5 rounded-xl border text-xs sm:text-sm font-bold flex items-center justify-center gap-2.5 transition-all ${
                      isDarkMode
                        ? 'bg-slate-900 border-indigo-500 text-indigo-300 shadow-xs ring-2 ring-indigo-500/20'
                        : 'bg-white/70 dark:bg-slate-900/60 border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-400 hover:bg-white'
                    }`}
                  >
                    <Moon className={`w-4 h-4 ${isDarkMode ? 'text-indigo-400' : 'text-gray-400'}`} />
                    <span>Dark Mode</span>
                  </button>
                </div>
              </section>

              {/* Timesheet Period Section - Icon-prefixed Header */}
              <section
                aria-label="Timesheet Period"
                className="p-5 rounded-2xl bg-gray-50/90 dark:bg-slate-800/50 border border-gray-200/90 dark:border-slate-800 space-y-3.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-indigo-100/80 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                      <Calendar className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-slate-200">
                        Timesheet Period
                      </h4>
                      <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                        Configure default pay period length
                      </p>
                    </div>
                  </div>
                  <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
                    {shiftSettings.period}
                  </span>
                </div>
                <select
                  value={shiftSettings.period}
                  onChange={e => {
                    const newPeriod = e.target.value;
                    const next = { ...shiftSettings, period: newPeriod };
                    setShiftSettings(next);
                    localStorage.setItem('shift_settings', JSON.stringify(next));
                    setRecords(generateRecordsForPeriod(newPeriod, periodStart, records));
                  }}
                  className="w-full min-h-[48px] px-3.5 py-2.5 text-sm font-semibold border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="Bi-weekly">Bi-weekly (14 Days - Default)</option>
                  <option value="Weekly">Weekly (7 Days)</option>
                  <option value="Monthly">Monthly</option>
                </select>
              </section>

              {/* Shift Notifications Section - Icon-prefixed Header & Improved Toggle Spacing */}
              <section
                aria-label="Shift Notifications"
                className="p-5 rounded-2xl bg-gray-50/90 dark:bg-slate-800/50 border border-gray-200/90 dark:border-slate-800 space-y-4"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-emerald-100/80 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                      <Clock className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-slate-200">
                        Shift Notifications
                      </h4>
                      <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                        Default shift &amp; lunch schedule for autofill and reminders
                      </p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center gap-2.5 cursor-pointer shrink-0 py-1 pl-2">
                    <span className="text-[11px] font-bold text-gray-500 dark:text-slate-400">
                      {shiftSettings.enabled ? 'On' : 'Off'}
                    </span>
                    <input
                      type="checkbox"
                      checked={shiftSettings.enabled}
                      onChange={e => {
                        const next = { ...shiftSettings, enabled: e.target.checked };
                        setShiftSettings(next);
                        localStorage.setItem('shift_settings', JSON.stringify(next));
                        if (e.target.checked && typeof Notification !== 'undefined' && Notification.permission === 'default') {
                          Notification.requestPermission().then(perm => setNotificationPermission(perm));
                        }
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-300 dark:bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-indigo-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[6px] after:right-[22px] peer-checked:after:right-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                  </label>
                </div>

                <div className={`grid grid-cols-2 gap-3.5 pt-1 transition-opacity ${shiftSettings.enabled ? '' : 'opacity-50 pointer-events-none'}`}>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1.5">Start Time</label>
                    <input
                      type="time"
                      value={shiftSettings.startTime}
                      onChange={e => {
                        const next = { ...shiftSettings, startTime: e.target.value };
                        setShiftSettings(next);
                        localStorage.setItem('shift_settings', JSON.stringify(next));
                      }}
                      className="w-full min-h-[44px] px-3 text-sm font-medium border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1.5">End Time</label>
                    <input
                      type="time"
                      value={shiftSettings.endTime}
                      onChange={e => {
                        const next = { ...shiftSettings, endTime: e.target.value };
                        setShiftSettings(next);
                        localStorage.setItem('shift_settings', JSON.stringify(next));
                      }}
                      className="w-full min-h-[44px] px-3 text-sm font-medium border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1.5">Lunch Start</label>
                    <input
                      type="time"
                      value={shiftSettings.lunchStart}
                      onChange={e => {
                        const next = { ...shiftSettings, lunchStart: e.target.value };
                        setShiftSettings(next);
                        localStorage.setItem('shift_settings', JSON.stringify(next));
                      }}
                      className="w-full min-h-[44px] px-3 text-sm font-medium border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1.5">Lunch End</label>
                    <input
                      type="time"
                      value={shiftSettings.lunchEnd}
                      onChange={e => {
                        const next = { ...shiftSettings, lunchEnd: e.target.value };
                        setShiftSettings(next);
                        localStorage.setItem('shift_settings', JSON.stringify(next));
                      }}
                      className="w-full min-h-[44px] px-3 text-sm font-medium border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                {shiftSettings.enabled && (
                  <div className="pt-2 border-t border-gray-200/70 dark:border-slate-700/70 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[11px] text-gray-500 dark:text-slate-400 flex items-center gap-1.5">
                      <Bell className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <span>
                        {notificationPermission === 'granted'
                          ? 'PWA & in-app shift alerts active'
                          : 'In-app & audio alerts active'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {notificationPermission === 'default' && typeof Notification !== 'undefined' && (
                        <button
                          type="button"
                          onClick={() => {
                            Notification.requestPermission().then(perm => setNotificationPermission(perm));
                          }}
                          className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 transition-colors"
                        >
                          Enable Browser Alerts
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          triggerPWAAlert({
                            id: `test_${Date.now()}`,
                            title: 'Shift Alert Preview',
                            message: `PWA shift alerts are active for Clock In (${shiftSettings.startTime}), Lunch In (${shiftSettings.lunchStart}), Lunch Out (${shiftSettings.lunchEnd}), and Clock Out (${shiftSettings.endTime}).`,
                            action: 'clockIn',
                            actionLabel: 'Clock In Now',
                            scheduledTime: getCurrentTime(),
                          });
                          setIsSettingsOpen(false);
                        }}
                        className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 transition-colors"
                      >
                        Test Alert
                      </button>
                    </div>
                  </div>
                )}
              </section>

              {/* Data & History Section - Icon-prefixed Header */}
              <section
                aria-label="Data and History"
                className="p-5 rounded-2xl bg-gray-50/90 dark:bg-slate-800/50 border border-gray-200/90 dark:border-slate-800 space-y-3"
              >
                <div className="flex items-center gap-2.5 mb-1">
                  <div className="w-8 h-8 rounded-xl bg-indigo-100/80 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                    <History className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-slate-200">
                      Data &amp; History
                    </h4>
                    <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                      Review past saved periods or reset current entries
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setIsSettingsOpen(false);
                    openHistory();
                  }}
                  className="w-full min-h-[48px] px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-gray-800 dark:text-slate-200 flex items-center justify-between hover:bg-indigo-50/40 dark:hover:bg-slate-800 transition-colors"
                >
                  <span className="flex items-center gap-2.5">
                    <History className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    <span>View Timesheet History</span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-gray-400" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsSettingsOpen(false);
                    setShowClearConfirm(true);
                  }}
                  className="w-full min-h-[48px] px-4 py-3 bg-rose-50/80 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 rounded-xl text-sm font-semibold text-rose-700 dark:text-rose-300 flex items-center justify-between hover:bg-rose-100/80 dark:hover:bg-rose-950/50 transition-colors"
                >
                  <span className="flex items-center gap-2.5">
                    <Trash2 className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                    <span>Clear Timesheet Data</span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-rose-400" />
                </button>

                {user && (
                  <button
                    type="button"
                    onClick={async () => {
                      await signOut(auth);
                      setUser(null);
                      setIsSettingsOpen(false);
                    }}
                    className="w-full min-h-[42px] px-4 py-2 text-xs font-bold text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200 flex items-center justify-center gap-1.5"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign Out ({user.email})</span>
                  </button>
                )}
              </section>

            </div>

            {/* Modal Footer with DONE button */}
            <div className="px-6 py-4 bg-gray-50 dark:bg-slate-800/60 border-t border-gray-100 dark:border-slate-800 flex items-center justify-between">
              <span className="text-[11px] text-gray-400 dark:text-slate-500 font-medium">
                Changes save automatically
              </span>
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="min-h-[44px] px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold shadow-sm active:scale-95 transition-all"
              >
                Done
              </button>
            </div>

          </div>
        </div>
      )}

      {/* =========================================================================
          EXPLICIT CONFIRMATION MODAL: Clear Timesheet Data
          ========================================================================= */}
      {showClearConfirm && (
        <div
          className="fixed inset-0 bg-black/50 dark:bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setShowClearConfirm(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl max-w-sm w-full p-6 border border-gray-200 dark:border-slate-800"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-12 h-12 bg-rose-100 dark:bg-rose-950/50 rounded-2xl flex items-center justify-center text-rose-600 mb-4">
              <Trash2 className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
              Clear Timesheet Data?
            </h3>
            <p className="text-sm text-gray-600 dark:text-slate-300 mt-2">
              Are you sure you want to clear all entered work hours and details? This action cannot be undone.
            </p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="min-h-[44px] px-4 py-2 text-sm font-bold text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={confirmClearTimesheet}
                className="min-h-[44px] px-5 py-2 text-sm font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-sm"
              >
                Clear All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          CONFIRM COPY PREVIOUS DAY MODAL (MOBILE WARNING)
          ========================================================================= */}
      {copyConfirmDayIndex !== null && copyConfirmDayIndex > 0 && records[copyConfirmDayIndex] && (
        <div
          className="fixed inset-0 bg-black/50 dark:bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setCopyConfirmDayIndex(null)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl max-w-sm w-full p-6 border border-gray-200 dark:border-slate-800"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-12 h-12 bg-amber-100 dark:bg-amber-950/60 rounded-2xl flex items-center justify-center text-amber-600 dark:text-amber-400 mb-4">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
              Copy Previous Day&apos;s Hours?
            </h3>
            <p className="text-sm text-gray-600 dark:text-slate-300 mt-2">
              This will copy the time entries from{' '}
              <strong className="text-gray-900 dark:text-white">
                {records[copyConfirmDayIndex - 1].day}
              </strong>{' '}
              into{' '}
              <strong className="text-gray-900 dark:text-white">
                {records[copyConfirmDayIndex].day}
              </strong>{' '}
              and overwrite any hours currently entered for {records[copyConfirmDayIndex].day}.
            </p>

            <div className="mt-4 p-3 rounded-2xl bg-gray-50 dark:bg-slate-800/70 border border-gray-200 dark:border-slate-700 text-xs space-y-1.5">
              <div className="font-bold text-gray-700 dark:text-slate-200 uppercase tracking-wider text-[11px]">
                {records[copyConfirmDayIndex - 1].day} Schedule to Copy:
              </div>
              <div className="grid grid-cols-2 gap-2 text-gray-600 dark:text-slate-300 pt-0.5">
                <div>
                  Time In:{' '}
                  <strong className="font-mono text-gray-900 dark:text-white">
                    {records[copyConfirmDayIndex - 1].timeIn || '—'}
                  </strong>
                </div>
                <div>
                  Time Out:{' '}
                  <strong className="font-mono text-gray-900 dark:text-white">
                    {records[copyConfirmDayIndex - 1].timeOut || '—'}
                  </strong>
                </div>
                <div>
                  Lunch:{' '}
                  <strong className="font-mono text-gray-900 dark:text-white">
                    {records[copyConfirmDayIndex - 1].lunchStart &&
                    records[copyConfirmDayIndex - 1].lunchEnd
                      ? `${records[copyConfirmDayIndex - 1].lunchStart}–${records[copyConfirmDayIndex - 1].lunchEnd}`
                      : 'None'}
                  </strong>
                </div>
                <div>
                  Total:{' '}
                  <strong className="font-mono text-indigo-600 dark:text-indigo-400">
                    {records[copyConfirmDayIndex - 1].totalHours} hrs
                  </strong>
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setCopyConfirmDayIndex(null)}
                className="min-h-[44px] px-4 py-2 text-sm font-bold text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  copyPreviousDay(copyConfirmDayIndex);
                  setCopyConfirmDayIndex(null);
                }}
                className="min-h-[44px] px-5 py-2 text-sm font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-sm flex items-center gap-1.5"
              >
                <Copy className="w-4 h-4" />
                <span>Yes, Copy</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          CONFIRM OVERWRITE TIME MODAL (TIME IN/OUT & LUNCH IN/OUT PROTECTION)
          ========================================================================= */}
      {overwriteTimeConfirm && records[overwriteTimeConfirm.dayIndex] && (
        <div
          className="fixed inset-0 bg-black/50 dark:bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setOverwriteTimeConfirm(null)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl max-w-sm w-full p-6 border border-gray-200 dark:border-slate-800"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-12 h-12 bg-amber-100 dark:bg-amber-950/60 rounded-2xl flex items-center justify-center text-amber-600 dark:text-amber-400 mb-4">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
              Replace {overwriteTimeConfirm.label} Time?
            </h3>
            <p className="text-sm text-gray-600 dark:text-slate-300 mt-2">
              <strong className="text-gray-900 dark:text-white">
                {records[overwriteTimeConfirm.dayIndex].day}
              </strong>{' '}
              already has a recorded{' '}
              <strong className="text-gray-900 dark:text-white">
                {overwriteTimeConfirm.label}
              </strong>{' '}
              time. Are you sure you want to overwrite it with the current time?
            </p>

            <div className="mt-4 p-3 rounded-2xl bg-gray-50 dark:bg-slate-800/70 border border-gray-200 dark:border-slate-700 text-xs grid grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-slate-400">
                  Recorded Time
                </div>
                <div className="text-base font-black font-mono text-gray-900 dark:text-white mt-0.5">
                  {overwriteTimeConfirm.existingValue}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                  New Time (Now)
                </div>
                <div className="text-base font-black font-mono text-amber-600 dark:text-amber-400 mt-0.5">
                  {overwriteTimeConfirm.proposedValue}
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setOverwriteTimeConfirm(null)}
                className="min-h-[44px] px-4 py-2 text-sm font-bold text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  handleRecordChange(
                    overwriteTimeConfirm.dayIndex,
                    overwriteTimeConfirm.field,
                    overwriteTimeConfirm.proposedValue
                  );
                  setOverwriteTimeConfirm(null);
                }}
                className="min-h-[44px] px-5 py-2 text-sm font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-sm flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>Yes, Replace</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          CONFIRM SEND EMAIL MODAL
          ========================================================================= */}
      {showEmailConfirm && (
        <div
          className="fixed inset-0 bg-black/50 dark:bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setShowEmailConfirm(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl max-w-sm w-full p-6 border border-gray-200 dark:border-slate-800"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-12 h-12 bg-indigo-100 dark:bg-indigo-950/50 rounded-2xl flex items-center justify-center text-indigo-600 mb-4">
              <Mail className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
              Send Timesheet?
            </h3>
            <p className="text-sm text-gray-600 dark:text-slate-300 mt-2">
              Send this timesheet for <strong>{name}</strong> to <strong>{recipientEmail}</strong>? A PDF copy will be downloaded for email attachment.
            </p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowEmailConfirm(false)}
                className="min-h-[44px] px-4 py-2 text-sm font-bold text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={confirmSendEmail}
                className="min-h-[44px] px-5 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-sm"
              >
                Send Email
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          HISTORY MODAL
          ========================================================================= */}
      {isHistoryOpen && (
        <div
          className="fixed inset-0 bg-black/50 dark:bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setIsHistoryOpen(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col border border-gray-200 dark:border-slate-800 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-slate-800">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <History className="w-5 h-5 text-indigo-600" />
                <span>Timesheet History ({companyName})</span>
              </h3>
              <button
                onClick={() => setIsHistoryOpen(false)}
                className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-xl"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 border-b border-gray-100 dark:border-slate-800 space-y-2">
              <div className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search by period, employee name, date, notes, or hours..."
                  value={historySearchTerm}
                  onChange={e => setHistorySearchTerm(e.target.value)}
                  className="w-full pl-10 pr-9 py-2.5 text-sm border border-gray-300 dark:border-slate-700 rounded-xl bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-slate-900 transition-all"
                />
                {historySearchTerm && (
                  <button
                    type="button"
                    onClick={() => setHistorySearchTerm('')}
                    aria-label="Clear search"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 rounded-lg"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              {totalHistoryCount > 0 && (
                <div className="flex items-center justify-between text-xs text-gray-500 dark:text-slate-400 px-1">
                  <span>
                    Showing <strong className="text-gray-800 dark:text-slate-200">{filteredHistory.length}</strong> of{' '}
                    <strong className="text-gray-800 dark:text-slate-200">{totalHistoryCount}</strong> saved timesheets
                  </span>
                  {historySearchTerm.trim() && (
                    <span className="text-indigo-600 dark:text-indigo-400 font-semibold">
                      Filtering live for &ldquo;{historySearchTerm.trim()}&rdquo;
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="p-4 overflow-y-auto flex-1 space-y-2.5">
              {filteredHistory.length === 0 ? (
                <div className="text-center py-12 text-sm text-gray-500 dark:text-slate-400 space-y-2">
                  {historySearchTerm.trim() && totalHistoryCount > 0 ? (
                    <>
                      <p>
                        No timesheets match <strong className="text-gray-800 dark:text-slate-200">&ldquo;{historySearchTerm.trim()}&rdquo;</strong>.
                      </p>
                      <button
                        type="button"
                        onClick={() => setHistorySearchTerm('')}
                        className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Clear Filter</span>
                      </button>
                    </>
                  ) : (
                    <p>No saved history found for {companyName}.</p>
                  )}
                </div>
              ) : (
                filteredHistory.map(([week, data]) => {
                  const periodLabel = String(data.weekOf || data.periodStart || week);
                  const formattedRange = formatPeriodRange(periodLabel, shiftSettings.period);
                  const totalHrs =
                    data.records?.reduce((acc: number, r: any) => acc + (parseFloat(r.totalHours) || 0), 0).toFixed(2) ||
                    '0.00';
                  const searchTokens = historySearchTerm.trim().toLowerCase().split(/\s+/).filter(Boolean);
                  const matchingNoteRecord =
                    searchTokens.length > 0 &&
                    Array.isArray(data.records) &&
                    data.records.find(
                      (r: any) =>
                        r.notes &&
                        searchTokens.some(tok => String(r.notes).toLowerCase().includes(tok))
                    );

                  return (
                    <div
                      key={week}
                      onClick={() => loadHistoryItem(week)}
                      className="p-3.5 bg-gray-50 dark:bg-slate-800/80 hover:bg-indigo-50/50 dark:hover:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 flex items-center justify-between cursor-pointer transition-all"
                    >
                      <div className="min-w-0 pr-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-sm text-gray-900 dark:text-white">
                            Period: {highlightMatch(periodLabel, historySearchTerm)}
                          </span>
                          {formattedRange && formattedRange !== periodLabel && (
                            <span className="text-xs text-gray-500 dark:text-slate-400 font-medium">
                              ({highlightMatch(formattedRange, historySearchTerm)})
                            </span>
                          )}
                          {data.name && (
                            <span className="text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded-md font-semibold">
                              {highlightMatch(String(data.name), historySearchTerm)}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-slate-400 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span>
                            Total: {highlightMatch(totalHrs, historySearchTerm)} hrs
                          </span>
                          {data.date && (
                            <span>
                              Signed: {highlightMatch(String(data.date), historySearchTerm)}
                            </span>
                          )}
                          {matchingNoteRecord && (
                            <span className="text-[11px] bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 px-2 py-0.5 rounded-md">
                              Note: {highlightMatch(String(matchingNoteRecord.notes), historySearchTerm)}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            setItemToDelete({ week, e });
                          }}
                          className="p-2 text-gray-400 hover:text-rose-600 rounded-lg"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <ChevronRight className="w-4 h-4 text-gray-400" />
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="p-4 border-t border-gray-100 dark:border-slate-800 flex justify-end">
              <button
                onClick={() => setIsHistoryOpen(false)}
                className="min-h-[44px] px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Item from History Confirmation */}
      {itemToDelete && (
        <div
          className="fixed inset-0 bg-black/50 dark:bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setItemToDelete(null)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-sm w-full border border-gray-200 dark:border-slate-800"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-gray-900 dark:text-white">
              Delete Timesheet Record?
            </h3>
            <p className="text-xs text-gray-500 mt-2">
              Are you sure you want to delete the record for {itemToDelete.week}?
            </p>
            <div className="mt-5 flex justify-end gap-2.5">
              <button
                onClick={() => setItemToDelete(null)}
                className="min-h-[44px] px-4 text-xs font-bold bg-gray-100 dark:bg-slate-800 rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteHistoryItem}
                className="min-h-[44px] px-4 text-xs font-bold text-white bg-rose-600 rounded-xl"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          AUTH MODAL
          ========================================================================= */}
      {showAuthModal && (
        <div
          className="fixed inset-0 bg-black/50 dark:bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setShowAuthModal(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl max-w-sm w-full p-6 border border-gray-200 dark:border-slate-800"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-gray-900 dark:text-white">
                Account Sign In
              </h3>
              <button onClick={() => setShowAuthModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-gray-500 mb-4">
              Login is optional. It adds cloud synchronization and multi-device history backup.
            </p>

            {authError && (
              <div className="p-3 mb-4 text-xs text-rose-600 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl">
                {authError}
              </div>
            )}

            <button
              onClick={async () => {
                setIsAuthenticating(true);
                setAuthError('');
                try {
                  await signInWithPopup(auth, googleProvider);
                  setShowAuthModal(false);
                } catch (err: any) {
                  setAuthError(err.message || 'Google sign in failed');
                } finally {
                  setIsAuthenticating(false);
                }
              }}
              disabled={isAuthenticating}
              className="w-full min-h-[46px] flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl shadow-sm disabled:opacity-60"
            >
              {isAuthenticating ? <Loader2 className="w-4 h-4 animate-spin" /> : <User className="w-4 h-4" />}
              <span>Sign in with Google</span>
            </button>

            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200 dark:border-slate-800"></div>
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="px-2 bg-white dark:bg-slate-900 text-gray-400">or email</span>
              </div>
            </div>

            <div className="space-y-3">
              <input
                type="email"
                placeholder="Email address"
                value={authEmail}
                onChange={e => setAuthEmail(e.target.value)}
                className="w-full min-h-[44px] px-3 text-sm border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800"
              />
              <input
                type="password"
                placeholder="Password"
                value={authPassword}
                onChange={e => setAuthPassword(e.target.value)}
                className="w-full min-h-[44px] px-3 text-sm border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800"
              />
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    setIsAuthenticating(true);
                    setAuthError('');
                    try {
                      await signInWithEmailAndPassword(auth, authEmail, authPassword);
                      setShowAuthModal(false);
                    } catch (e: any) {
                      setAuthError(e.message || 'Login failed');
                    } finally {
                      setIsAuthenticating(false);
                    }
                  }}
                  disabled={isAuthenticating}
                  className="flex-1 min-h-[44px] text-xs font-bold text-indigo-700 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800 rounded-xl"
                >
                  Sign In
                </button>
                <button
                  onClick={async () => {
                    setIsAuthenticating(true);
                    setAuthError('');
                    try {
                      await createUserWithEmailAndPassword(auth, authEmail, authPassword);
                      setShowAuthModal(false);
                    } catch (e: any) {
                      setAuthError(e.message || 'Registration failed');
                    } finally {
                      setIsAuthenticating(false);
                    }
                  }}
                  disabled={isAuthenticating}
                  className="flex-1 min-h-[44px] text-xs font-bold text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 rounded-xl"
                >
                  Register
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating Saved Toast Notification */}
      <AnimatePresence>
        {showSavedIndicator && lastSaved && (
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
            className="fixed bottom-20 md:bottom-6 right-4 sm:right-6 z-50 flex items-center gap-2 px-3.5 py-2.5 bg-gray-900 text-white rounded-xl shadow-xl border border-gray-800 text-xs font-bold"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>Changes saved</span>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

export default function App() {
  const [route, setRoute] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return window.location.pathname || '/';
    }
    return '/';
  });

  const [session, setSession] = useState<{ user: AppUser; company: Company } | null>(() =>
    getCurrentSessionUser()
  );

  useEffect(() => {
    const handlePopState = () => {
      setRoute(window.location.pathname || '/');
      setSession(getCurrentSessionUser());
    };
    const handleStoreUpdate = () => {
      setSession(getCurrentSessionUser());
    };
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('tsm-store-updated', handleStoreUpdate);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('tsm-store-updated', handleStoreUpdate);
    };
  }, []);

  const navigate = useCallback((path: string) => {
    if (typeof window !== 'undefined' && window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    setRoute(path);
    setSession(getCurrentSessionUser());
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, []);

  const currentSession = session || getCurrentSessionUser();

  if (route.startsWith('/auth')) {
    return (
      <AuthScreen
        onNavigate={navigate}
        onAuthenticated={(u, c) => setSession({ user: u, company: c })}
      />
    );
  }

  if (route.startsWith('/clock')) {
    if (!currentSession) {
      return (
        <AuthScreen
          onNavigate={navigate}
          onAuthenticated={(u, c) => {
            setSession({ user: u, company: c });
            navigate('/clock');
          }}
        />
      );
    }
    return (
      <PunchClockScreen
        user={currentSession.user}
        company={currentSession.company}
        onNavigate={navigate}
        onSignOut={() => {
          setSession(null);
          navigate('/auth');
        }}
      />
    );
  }

  if (route.startsWith('/my-hours')) {
    if (!currentSession) {
      return (
        <AuthScreen
          onNavigate={navigate}
          onAuthenticated={(u, c) => {
            setSession({ user: u, company: c });
            navigate('/my-hours');
          }}
        />
      );
    }
    return (
      <MyHoursScreen
        user={currentSession.user}
        company={currentSession.company}
        onNavigate={navigate}
        onSignOut={() => {
          setSession(null);
          navigate('/auth');
        }}
      />
    );
  }

  if (route.startsWith('/admin')) {
    if (!currentSession) {
      return (
        <AuthScreen
          onNavigate={navigate}
          onAuthenticated={(u, c) => {
            setSession({ user: u, company: c });
            if (u.role === 'Admin' || u.role === 'Manager') {
              navigate('/admin');
            } else {
              navigate('/my-hours');
            }
          }}
        />
      );
    }
    if (currentSession.user.role === 'Employee') {
      return (
        <MyHoursScreen
          user={currentSession.user}
          company={currentSession.company}
          onNavigate={navigate}
          onSignOut={() => {
            setSession(null);
            navigate('/auth');
          }}
        />
      );
    }
    return (
      <AdminConsole
        user={currentSession.user}
        company={currentSession.company}
        onNavigate={navigate}
        onSignOut={() => {
          setSession(null);
          navigate('/auth');
        }}
      />
    );
  }

  return <LandingTimesheet onOpenBusinessLogin={() => navigate('/auth')} />;
}

