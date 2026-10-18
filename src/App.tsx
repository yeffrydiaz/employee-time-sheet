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
  Copy
} from 'lucide-react';
import SignatureCanvas from 'react-signature-canvas';
import { motion, AnimatePresence } from 'motion/react';
import jsPDF from 'jspdf';
import { toPng } from 'html-to-image';
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

export default function App() {
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
      period: 'Bi-weekly' // Default 14 days
    };
    try {
      const saved = localStorage.getItem('shift_settings');
      if (saved) {
        return { ...defaultSettings, ...JSON.parse(saved) };
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
      total -= (lEnd - lStart);
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

  const handleRecordChange = (index: number, field: keyof DailyRecord, value: string) => {
    const updated = [...records];
    updated[index] = { ...updated[index], [field]: value };
    setRecords(updated);
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

  const handleTimeAction = (action: 'clockIn' | 'startLunch' | 'endLunch' | 'clockOut') => {
    const currentTime = getCurrentTime();
    const idx = todayRecordIndex >= 0 ? todayRecordIndex : 0;
    const todayRecord = records[idx];
    const newRecords = [...records];
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
    setRecords(newRecords);

    // Make sure today's card is open
    if (!expandedDays.includes(idx)) {
      setExpandedDays(prev => [...prev, idx]);
    }
  };

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
    }

    return null;
  };

  // PDF Generation with standardized filename
  const getPdfFilename = () => {
    const safeName = (name || 'Employee').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    const safePeriod = (periodStart || 'Period').replace(/[^a-zA-Z0-9_-]/g, '_');
    return `Timesheet_${safeName}_${safePeriod}.pdf`;
  };

  const generatePDF = async () => {
    const contentElement = document.getElementById('timesheet-content');
    if (!contentElement) return null;

    const elementsToHide = contentElement.querySelectorAll('.print\\:hidden, .pdf\\:hidden');
    elementsToHide.forEach(el => ((el as HTMLElement).style.display = 'none'));

    contentElement.classList.add('pdf-mode');
    if (isDarkMode) {
      contentElement.classList.add('dark');
      Array.from(contentElement.children).forEach(c => c.classList.add('dark'));
    }

    const originalWidth = contentElement.style.width;
    const originalMaxWidth = contentElement.style.maxWidth;
    const originalMargin = contentElement.style.margin;

    contentElement.style.width = '800px';
    contentElement.style.maxWidth = '800px';
    contentElement.style.margin = '0 auto';

    await new Promise(resolve => setTimeout(resolve, 100));

    try {
      const dataUrl = await toPng(contentElement, {
        quality: 1.0,
        pixelRatio: 2,
        backgroundColor: isDarkMode ? '#0f172a' : '#ffffff',
        width: 800,
        style: {
          width: '800px',
          maxWidth: '800px',
          margin: '0 auto',
          transform: 'scale(1)',
          transformOrigin: 'top left'
        }
      });

      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      const margin = 12;
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const availableWidth = pdfWidth - margin * 2;
      const imgProps = pdf.getImageProperties(dataUrl);
      const imgHeight = (imgProps.height * availableWidth) / imgProps.width;

      pdf.addImage(dataUrl, 'PNG', margin, margin, availableWidth, imgHeight);
      return pdf;
    } catch (err) {
      console.error('Error generating PDF:', err);
      return null;
    } finally {
      contentElement.style.width = originalWidth;
      contentElement.style.maxWidth = originalMaxWidth;
      contentElement.style.margin = originalMargin;
      contentElement.classList.remove('pdf-mode');
      if (isDarkMode) {
        contentElement.classList.remove('dark');
        Array.from(contentElement.children).forEach(c => c.classList.remove('dark'));
      }
      elementsToHide.forEach(el => ((el as HTMLElement).style.display = ''));
    }
  };

  const handlePrint = async () => {
    setIsGeneratingPDF(true);
    try {
      const pdf = await generatePDF();
      if (pdf) {
        pdf.autoPrint();
        const blobUrl = URL.createObjectURL(pdf.output('blob'));
        const printWindow = window.open(blobUrl, '_blank');
        if (!printWindow) {
          pdf.save(getPdfFilename());
        }
      }
    } catch (error) {
      console.error('Print error:', error);
      alert('Error generating print file.');
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  const handleSendEmailClick = () => {
    if (!name?.trim()) {
      alert("Please enter your name to send the timesheet.");
      return;
    }
    const actualEmployeeEmail = user?.email || employeeEmail?.trim();
    if (!actualEmployeeEmail) {
      alert("Please enter your email address to send the timesheet.");
      return;
    }
    if (!signature) {
      alert("Please sign or type your signature before sending.");
      return;
    }
    if (!recipientEmail?.trim()) {
      alert("Please enter manager's email address.");
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

  const periodRangeLabel = useMemo(() => {
    return formatPeriodRange(periodStart, shiftSettings.period);
  }, [periodStart, shiftSettings.period]);

  const filteredHistory = Object.entries(historyData)
    .filter(([week, data]) => {
      const term = historySearchTerm.toLowerCase();
      if (!term) return true;
      if (week.toLowerCase().includes(term)) return true;
      if (data.name && data.name.toLowerCase().includes(term)) return true;
      return false;
    })
    .sort((a, b) => b[0].localeCompare(a[0]));

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-[#0b0f19] text-gray-900 dark:text-gray-100 py-3 sm:py-6 px-2.5 sm:px-6 lg:px-8 pb-28 md:pb-12 print:bg-white pdf:bg-white print:p-0 pdf:p-0">
      <div id="timesheet-content" className="max-w-5xl print:max-w-full pdf:max-w-full mx-auto space-y-4 sm:space-y-6">

        {/* =========================================================================
            HEADER - STRICT RULES:
            - Settings gear icon ALL THE WAY to the far right edge of the header, alone.
            - NO dark mode / theme toggle in the header. Theme control lives ONLY inside Settings modal.
            - Demote "Login / Sign Up" so it doesn't compete with Send/Print. Add helper: "Login adds sync + history. Sheet works without it."
            ========================================================================= */}
        <header className="relative z-30 bg-white dark:bg-slate-900 rounded-2xl p-3.5 sm:p-5 shadow-sm border border-gray-200/80 dark:border-slate-800 print:hidden pdf:hidden flex flex-col md:flex-row md:items-center justify-between gap-4">
          
          {/* Left Brand & Company */}
          <div className="flex items-center justify-between gap-3 w-full md:w-auto">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-sm flex-shrink-0">
                <Clock className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-lg sm:text-xl font-bold tracking-tight text-gray-900 dark:text-white leading-tight">
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
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3 w-full md:w-auto">
            
            {/* Last saved indicator - Darker & Prominent */}
            {lastSaved && (
              <div className="text-xs font-medium text-gray-700 dark:text-slate-300 flex items-center gap-1.5 self-start sm:self-center">
                <Save className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Last saved {lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            )}

            {/* Demoted Login / Sign Up */}
            <div className="flex flex-col items-start sm:items-end">
              {!user ? (
                <div>
                  <button
                    onClick={() => setShowAuthModal(true)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 px-2.5 py-1 rounded-md hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    <User className="w-3.5 h-3.5" />
                    <span>Login / Sign Up</span>
                  </button>
                  <p className="hidden xl:block text-[11px] text-gray-400 dark:text-slate-500 text-right">
                    Login adds sync + history. Sheet works without it.
                  </p>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 px-2.5 py-1 rounded-md">
                  <User className="w-3.5 h-3.5 text-indigo-600" />
                  <span className="max-w-[120px] truncate">{user.email}</span>
                </div>
              )}
            </div>

            {/* Desktop Actions: Manager Email, Print, Send */}
            <div className="hidden md:flex items-center gap-2">
              <div className="relative" ref={emailContainerRef}>
                <input
                  type="email"
                  placeholder="Manager's Email(s)"
                  value={recipientEmail}
                  onChange={e => setRecipientEmail(e.target.value)}
                  onFocus={() => setShowEmailHistory(true)}
                  className="w-56 px-3 py-2 text-sm border border-gray-300 dark:border-slate-700 rounded-xl bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:bg-white"
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
                onClick={handlePrint}
                disabled={isGeneratingPDF}
                className="min-h-[44px] px-3.5 py-2 text-sm font-semibold text-gray-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl hover:bg-gray-50 dark:hover:bg-slate-700 transition-all flex items-center gap-1.5 active:scale-95 disabled:opacity-60"
              >
                {isGeneratingPDF ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
                <span>Print</span>
              </button>

              <button
                onClick={handleSendEmailClick}
                disabled={isSending}
                className="min-h-[44px] px-4 py-2 text-sm font-bold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition-all flex items-center gap-2 shadow-sm active:scale-95 disabled:opacity-60"
              >
                {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                <span>Send</span>
              </button>
            </div>

            {/* Desktop Settings Gear - ALL THE WAY to the far right edge, alone! */}
            <div className="hidden md:block pl-2 border-l border-gray-200 dark:border-slate-800">
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
        </header>

        {/* =========================================================================
            MAIN TIMESHEET FORM CARD
            - Solid white card, rounded-2xl, soft shadow.
            ========================================================================= */}
        <div className="bg-white dark:bg-slate-900 shadow-sm rounded-2xl p-4 sm:p-8 md:p-10 border border-gray-200/80 dark:border-slate-800 print:shadow-none pdf:shadow-none print:border-none pdf:border-none print:p-0 pdf:p-0">
          
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
              <div className="text-xs font-bold text-gray-700 dark:text-slate-300">
                <span>Total: <strong className="text-indigo-600 dark:text-indigo-400 font-black">{totalHours || '0.00'}</strong> hrs</span>
                <span className="mx-1.5 opacity-40">•</span>
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
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-base font-bold text-gray-900 dark:text-white">
                          {record.day}
                        </span>
                        <span className="text-xs font-medium text-gray-500 dark:text-slate-400">
                          {record.date ? record.date.slice(5) : ''}
                        </span>
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
                            <button
                              type="button"
                              onClick={() => copyPreviousDay(index)}
                              className={`min-h-[44px] px-3 py-1 text-xs font-bold rounded-xl transition-all active:scale-95 flex items-center gap-1.5 border shadow-2xs ${
                                copiedIndex === index
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-700'
                                  : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/60 dark:text-indigo-300 border-indigo-200/80 dark:border-indigo-800/80'
                              }`}
                              title={`Copy hours from previous day (${records[index - 1].day})`}
                            >
                              {copiedIndex === index ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                  <span>Copied ({records[index - 1].day.slice(0, 3)})</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                                  <span>Copy Previous Day</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>

                        {/* TIME IN & TIME OUT: STRICT PURE WHITE BACKGROUND #FFFFFF - HERO TYPOGRAPHY */}
                        <div className="grid grid-cols-2 gap-2 sm:gap-3">
                          {/* TIME IN */}
                          <div className="bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-gray-200 dark:border-slate-700 space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-extrabold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                                <LogIn className="w-4 h-4 text-emerald-600" />
                                Time In
                              </span>
                              <button
                                type="button"
                                onClick={() => handleRecordChange(index, 'timeIn', getCurrentTime())}
                                className="min-h-[36px] min-w-[44px] px-2 py-0.5 text-xs font-bold text-indigo-700 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg active:scale-95"
                              >
                                Now
                              </button>
                            </div>
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
                          <div className="bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-gray-200 dark:border-slate-700 space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-extrabold uppercase tracking-wider text-rose-700 dark:text-rose-400 flex items-center gap-1">
                                <LogOut className="w-4 h-4 text-rose-600" />
                                Time Out
                              </span>
                              <button
                                type="button"
                                onClick={() => handleRecordChange(index, 'timeOut', getCurrentTime())}
                                className="min-h-[36px] min-w-[44px] px-2 py-0.5 text-xs font-bold text-indigo-700 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg active:scale-95"
                              >
                                Now
                              </button>
                            </div>
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

                        {/* LUNCH START & LUNCH END: STRICT LIGHT YELLOW #FEF9C3 ONLY */}
                        <div className="grid grid-cols-2 gap-2 sm:gap-3">
                          {/* LUNCH START */}
                          <div className="bg-[#FEF9C3] dark:bg-amber-950/40 p-2.5 rounded-xl border border-amber-300/80 dark:border-amber-700/60 space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold uppercase tracking-wider text-amber-900 dark:text-amber-200 flex items-center gap-1">
                                <Utensils className="w-3.5 h-3.5 text-amber-700 dark:text-amber-300" />
                                Lunch Start
                              </span>
                              <button
                                type="button"
                                onClick={() => handleRecordChange(index, 'lunchStart', getCurrentTime())}
                                className="min-h-[36px] min-w-[44px] px-2 py-0.5 text-xs font-bold text-amber-900 bg-amber-100 dark:bg-amber-900/50 rounded-lg active:scale-95"
                              >
                                Now
                              </button>
                            </div>
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

                          {/* LUNCH END */}
                          <div className="bg-[#FEF9C3] dark:bg-amber-950/40 p-2.5 rounded-xl border border-amber-300/80 dark:border-amber-700/60 space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold uppercase tracking-wider text-amber-900 dark:text-amber-200 flex items-center gap-1">
                                <Utensils className="w-3.5 h-3.5 text-amber-700 dark:text-amber-300" />
                                Lunch End
                              </span>
                              <button
                                type="button"
                                onClick={() => handleRecordChange(index, 'lunchEnd', getCurrentTime())}
                                className="min-h-[36px] min-w-[44px] px-2 py-0.5 text-xs font-bold text-amber-900 bg-amber-100 dark:bg-amber-900/50 rounded-lg active:scale-95"
                              >
                                Now
                              </button>
                            </div>
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
                              <span className="font-bold">Invalid time entry:</span> {dayWarning}
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
            <table className="min-w-full print:w-full pdf:w-full print:table-fixed pdf:table-fixed divide-y divide-gray-200 dark:divide-slate-800 print:divide-gray-800 pdf:divide-gray-800">
              <thead className="bg-gray-50/80 dark:bg-slate-800/60 print:bg-transparent pdf:bg-transparent">
                <tr>
                  <th scope="col" className="px-3 py-3.5 text-left text-xs font-bold text-gray-600 dark:text-slate-300 uppercase tracking-wider w-36 print:w-[15%]">
                    Date
                  </th>
                  <th scope="col" className="px-3 py-3.5 text-left text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider w-40 print:w-[14%] bg-white dark:bg-slate-900">
                    <span className="flex items-center gap-1.5">
                      <LogIn className="w-4 h-4 text-emerald-600 inline" />
                      Time In
                    </span>
                  </th>
                  <th scope="col" className="px-3 py-3.5 text-left text-xs font-bold text-amber-900 dark:text-amber-200 uppercase tracking-wider w-36 print:w-[13%] bg-[#FEF9C3] dark:bg-amber-950/40">
                    <span className="flex items-center gap-1.5">
                      <Utensils className="w-3.5 h-3.5 text-amber-700 dark:text-amber-300 inline" />
                      Lunch Start
                    </span>
                  </th>
                  <th scope="col" className="px-3 py-3.5 text-left text-xs font-bold text-amber-900 dark:text-amber-200 uppercase tracking-wider w-36 print:w-[13%] bg-[#FEF9C3] dark:bg-amber-950/40">
                    <span className="flex items-center gap-1.5">
                      <Utensils className="w-3.5 h-3.5 text-amber-700 dark:text-amber-300 inline" />
                      Lunch End
                    </span>
                  </th>
                  <th scope="col" className="px-3 py-3.5 text-left text-xs font-bold text-rose-700 dark:text-rose-400 uppercase tracking-wider w-40 print:w-[14%] bg-white dark:bg-slate-900">
                    <span className="flex items-center gap-1.5">
                      <LogOut className="w-4 h-4 text-rose-600 inline" />
                      Time Out
                    </span>
                  </th>
                  <th scope="col" className="px-2 py-3.5 text-center text-xs font-extrabold text-gray-900 dark:text-white uppercase tracking-wider w-24 print:w-[11%] bg-white dark:bg-slate-900">
                    Total Hrs
                  </th>
                  <th scope="col" className="px-3 py-3.5 text-left text-xs font-bold text-gray-600 dark:text-slate-300 uppercase tracking-wider bg-white dark:bg-slate-900">
                    Notes
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-800 print:divide-gray-800">
                {records.map((record, index) => {
                  const isToday = record.date === todayDateStr;
                  const outOfRange = isDateOutOfRange(record.date);
                  const dayWarning = getDayValidationWarning(record);

                  return (
                    <tr
                      key={index}
                      className={`hover:bg-gray-50/60 dark:hover:bg-slate-800/40 transition-colors ${
                        isToday ? 'bg-indigo-50/30 dark:bg-indigo-950/20' : ''
                      }`}
                    >
                      {/* DATE */}
                      <td className="px-3 py-2.5 align-middle bg-white dark:bg-slate-900">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-bold text-gray-900 dark:text-white">
                            {record.day.slice(0, 3)}
                          </span>
                          {isToday && (
                            <span className="text-[10px] font-bold bg-indigo-600 text-white px-1.5 py-0.2 rounded-full uppercase">
                              Today
                            </span>
                          )}
                        </div>
                        <input
                          type="date"
                          value={record.date}
                          onChange={e => handleRecordChange(index, 'date', e.target.value)}
                          className="mt-0.5 text-xs text-gray-500 dark:text-slate-400 bg-transparent border-none p-0 focus:ring-0"
                        />
                        {index > 0 && (
                          <button
                            type="button"
                            onClick={() => copyPreviousDay(index)}
                            className="mt-1 flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 rounded transition-all active:scale-95 print:hidden pdf:hidden"
                            title={`Copy time entries from previous day (${records[index - 1].day})`}
                          >
                            {copiedIndex === index ? (
                              <>
                                <Check className="w-2.5 h-2.5 text-emerald-600" />
                                <span className="text-emerald-600 font-bold">Copied!</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-2.5 h-2.5 text-indigo-500" />
                                <span>Copy prev</span>
                              </>
                            )}
                          </button>
                        )}
                        {outOfRange && (
                          <div className="text-[10px] text-amber-600 flex items-center gap-0.5 print:hidden pdf:hidden">
                            <AlertTriangle className="w-3 h-3" />
                            Out of range
                          </div>
                        )}
                      </td>

                      {/* TIME IN: STRICT PURE WHITE, LARGE BOLD 26-28px */}
                      <td className="px-3 py-2.5 align-middle bg-white dark:bg-slate-900">
                        <div className="flex items-center gap-2">
                          <input
                            type="time"
                            value={record.timeIn}
                            onChange={e => handleRecordChange(index, 'timeIn', e.target.value)}
                            className="time-input-mono w-full text-[28px] font-black font-mono tracking-tight tabular-nums text-gray-900 dark:text-white bg-white dark:bg-slate-900 border-none p-0 focus:ring-0 print:text-[14px] pdf:text-[14px]"
                          />
                          <button
                            type="button"
                            onClick={() => handleRecordChange(index, 'timeIn', getCurrentTime())}
                            className="min-h-[32px] px-2 py-0.5 text-[11px] font-bold text-indigo-700 bg-indigo-50 dark:bg-indigo-900/30 rounded-md hover:bg-indigo-100 active:scale-95 print:hidden pdf:hidden"
                          >
                            Now
                          </button>
                        </div>
                      </td>

                      {/* LUNCH START: STRICT LIGHT YELLOW #FEF9C3 ONLY, 17-18px */}
                      <td className="px-3 py-2.5 align-middle bg-[#FEF9C3] dark:bg-amber-950/40">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="time"
                            value={record.lunchStart}
                            onChange={e => handleRecordChange(index, 'lunchStart', e.target.value)}
                            className="time-input-mono w-full text-[17px] font-bold font-mono tracking-tight tabular-nums text-gray-900 dark:text-amber-100 bg-transparent border-none p-0 focus:ring-0 print:text-[12px] pdf:text-[12px]"
                          />
                          <button
                            type="button"
                            onClick={() => handleRecordChange(index, 'lunchStart', getCurrentTime())}
                            className="min-h-[30px] px-1.5 py-0.5 text-[10px] font-bold text-amber-900 bg-amber-100/90 dark:bg-amber-900/50 rounded active:scale-95 print:hidden pdf:hidden"
                          >
                            Now
                          </button>
                        </div>
                      </td>

                      {/* LUNCH END: STRICT LIGHT YELLOW #FEF9C3 ONLY, 17-18px */}
                      <td className="px-3 py-2.5 align-middle bg-[#FEF9C3] dark:bg-amber-950/40">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="time"
                            value={record.lunchEnd}
                            onChange={e => handleRecordChange(index, 'lunchEnd', e.target.value)}
                            className="time-input-mono w-full text-[17px] font-bold font-mono tracking-tight tabular-nums text-gray-900 dark:text-amber-100 bg-transparent border-none p-0 focus:ring-0 print:text-[12px] pdf:text-[12px]"
                          />
                          <button
                            type="button"
                            onClick={() => handleRecordChange(index, 'lunchEnd', getCurrentTime())}
                            className="min-h-[30px] px-1.5 py-0.5 text-[10px] font-bold text-amber-900 bg-amber-100/90 dark:bg-amber-900/50 rounded active:scale-95 print:hidden pdf:hidden"
                          >
                            Now
                          </button>
                        </div>
                      </td>

                      {/* TIME OUT: STRICT PURE WHITE, LARGE BOLD 26-28px */}
                      <td className="px-3 py-2.5 align-middle bg-white dark:bg-slate-900">
                        <div className="flex items-center gap-2">
                          <input
                            type="time"
                            value={record.timeOut}
                            onChange={e => handleRecordChange(index, 'timeOut', e.target.value)}
                            className="time-input-mono w-full text-[28px] font-black font-mono tracking-tight tabular-nums text-gray-900 dark:text-white bg-white dark:bg-slate-900 border-none p-0 focus:ring-0 print:text-[14px] pdf:text-[14px]"
                          />
                          <button
                            type="button"
                            onClick={() => handleRecordChange(index, 'timeOut', getCurrentTime())}
                            className="min-h-[32px] px-2 py-0.5 text-[11px] font-bold text-indigo-700 bg-indigo-50 dark:bg-indigo-900/30 rounded-md hover:bg-indigo-100 active:scale-95 print:hidden pdf:hidden"
                          >
                            Now
                          </button>
                        </div>
                      </td>

                      {/* TOTAL HRS: EXTRA LARGE BOLD, WHITE BACKGROUND */}
                      <td className="px-2 py-2.5 align-middle text-center bg-white dark:bg-slate-900">
                        <div className="flex flex-col items-center justify-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <span className={`text-2xl font-black font-mono print:text-[14px] pdf:text-[14px] ${
                              dayWarning ? 'text-amber-600 dark:text-amber-400' : 'text-gray-900 dark:text-white'
                            }`}>
                              {record.totalHours || '0.00'}
                            </span>
                            {dayWarning ? (
                              <span className="text-amber-500 cursor-help print:hidden pdf:hidden" title={dayWarning}>
                                <AlertTriangle className="w-4 h-4" />
                              </span>
                            ) : record.totalHours && parseFloat(record.totalHours) > 0 ? (
                              <span className="text-emerald-500 print:hidden pdf:hidden" title="Valid shift entry">
                                <CheckCircle2 className="w-4 h-4" />
                              </span>
                            ) : null}
                          </div>
                          {dayWarning && (
                            <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium leading-tight print:hidden pdf:hidden max-w-[110px] truncate" title={dayWarning}>
                              {dayWarning}
                            </span>
                          )}
                          {!dayWarning && record.totalHours && parseFloat(record.totalHours) > 0 && (
                            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium leading-tight print:hidden pdf:hidden flex items-center gap-0.5">
                              <Check className="w-2.5 h-2.5" /> Valid
                            </span>
                          )}
                        </div>
                      </td>

                      {/* NOTES: WHITE BACKGROUND, PLACEHOLDER HIDDEN ON PRINT */}
                      <td className="px-3 py-2.5 align-middle bg-white dark:bg-slate-900">
                        <input
                          type="text"
                          value={record.notes}
                          onChange={e => handleRecordChange(index, 'notes', e.target.value)}
                          placeholder="e.g., Overtime"
                          className="w-full text-sm font-medium text-gray-900 dark:text-white bg-transparent border-none p-0 focus:ring-0 print:placeholder-transparent pdf:placeholder-transparent"
                        />
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-gray-200/80 dark:border-slate-800 items-start">
            
            {/* Signature Section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-slate-400">
                  Employee Signature
                </label>

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
                  <div className="border border-gray-300 dark:border-slate-700 rounded-2xl bg-white dark:bg-slate-800 overflow-hidden shadow-inner">
                    <SignatureCanvas
                      ref={sigCanvas}
                      penColor={isDarkMode ? '#ffffff' : '#000000'}
                      clearOnResize={false}
                      canvasProps={{
                        className: 'w-full h-36 sm:h-44 bg-white dark:bg-slate-800 cursor-crosshair'
                      }}
                      onEnd={handleCanvasEnd}
                    />
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
                <div className="space-y-3">
                  <input
                    type="text"
                    value={typedName}
                    onChange={e => handleTypedNameChange(e.target.value)}
                    placeholder="Type your full name as signature"
                    className="w-full min-h-[48px] px-4 py-2 text-base font-semibold text-gray-900 dark:text-white bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-2xl focus:ring-2 focus:ring-indigo-500"
                  />
                  {typedName && (
                    <div className="p-4 border border-indigo-200 dark:border-indigo-900/60 rounded-2xl bg-indigo-50/40 dark:bg-indigo-950/20">
                      <div className="font-signature text-3xl sm:text-4xl text-gray-900 dark:text-white italic">
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
              <div className="pt-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-slate-400 mb-1">
                  Signature Date
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className="min-h-[44px] px-3 py-1.5 text-base font-semibold text-gray-900 dark:text-white bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* Total Hours Card (STRICT PURE WHITE BACKGROUND, EXTRA LARGE BOLD) */}
            <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-2xl border border-gray-200 dark:border-slate-700 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold uppercase tracking-wider text-gray-600 dark:text-slate-400">
                  Total Period Hours
                </span>
                <span className="text-xs font-semibold px-2.5 py-1 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-lg">
                  {shiftSettings.period}
                </span>
              </div>

              <div className="text-4xl sm:text-5xl font-black text-gray-900 dark:text-white font-mono tracking-tight">
                {totalHours || '0.00'}
                <span className="text-lg sm:text-xl font-bold text-gray-400 dark:text-slate-500 ml-2">hrs</span>
              </div>

              <p className="text-xs text-gray-500 dark:text-slate-400 leading-relaxed">
                Total hours are automatically calculated based on Time In, Time Out, and Lunch deduction.
              </p>

              {sentLogs.length > 0 && (
                <div className="pt-3 border-t border-gray-100 dark:border-slate-700 text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
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
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-slate-400">
              Total Hours
            </span>
            <span className="text-xl font-black text-indigo-600 dark:text-indigo-400 font-mono leading-tight">
              {totalHours || '0.00'} <span className="text-xs text-gray-400">hrs</span>
            </span>
          </div>

          <div className="flex items-center gap-2 flex-1 justify-end">
            <button
              onClick={handlePrint}
              disabled={isGeneratingPDF}
              className="min-h-[44px] min-w-[44px] px-3.5 py-2 text-sm font-bold text-gray-700 dark:text-slate-200 bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl flex items-center gap-1.5 active:scale-95 disabled:opacity-60"
              aria-label="Print timesheet"
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
          className="fixed inset-0 bg-black/50 dark:bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setIsSettingsOpen(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl max-w-md w-full max-h-[90vh] flex flex-col border border-gray-200 dark:border-slate-800 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-slate-800">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <Settings className="w-5 h-5 text-indigo-600" />
                <span>Settings</span>
              </h3>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-6">
              
              {/* Theme Switch - THE EXCLUSIVE HOME FOR THEME TOGGLE */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-slate-400 mb-2.5">
                  Appearance
                </h4>
                <button
                  type="button"
                  onClick={() => setIsDarkMode(!isDarkMode)}
                  className="w-full min-h-[48px] px-4 py-3 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl flex items-center justify-between text-sm font-bold text-gray-800 dark:text-slate-100 active:scale-98"
                >
                  <span className="flex items-center gap-2.5">
                    {isDarkMode ? <Moon className="w-4 h-4 text-indigo-400" /> : <Sun className="w-4 h-4 text-amber-500" />}
                    <span>Theme: {isDarkMode ? 'Dark Mode' : 'Light Mode'}</span>
                  </span>
                  <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
                    Switch
                  </span>
                </button>
              </div>

              {/* Period Selector */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-slate-400 mb-2.5">
                  Timesheet Period
                </h4>
                <select
                  value={shiftSettings.period}
                  onChange={e => {
                    const newPeriod = e.target.value;
                    const next = { ...shiftSettings, period: newPeriod };
                    setShiftSettings(next);
                    localStorage.setItem('shift_settings', JSON.stringify(next));
                    setRecords(generateRecordsForPeriod(newPeriod, periodStart, records));
                  }}
                  className="w-full min-h-[48px] px-3.5 py-2.5 text-sm font-semibold border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                >
                  <option value="Bi-weekly">Bi-weekly (14 Days - Default)</option>
                  <option value="Weekly">Weekly (7 Days)</option>
                  <option value="Monthly">Monthly</option>
                </select>
              </div>

              {/* Shift Notifications & Times */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-slate-400">
                    Shift Notifications
                  </h4>
                  <input
                    type="checkbox"
                    checked={shiftSettings.enabled}
                    onChange={e => {
                      const next = { ...shiftSettings, enabled: e.target.checked };
                      setShiftSettings(next);
                      localStorage.setItem('shift_settings', JSON.stringify(next));
                      if (e.target.checked && Notification.permission === 'default') {
                        Notification.requestPermission();
                      }
                    }}
                    className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500"
                  />
                </div>

                <div className={`grid grid-cols-2 gap-3 ${shiftSettings.enabled ? '' : 'opacity-50 pointer-events-none'}`}>
                  <div>
                    <label className="text-xs font-medium text-gray-500">Start Time</label>
                    <input
                      type="time"
                      value={shiftSettings.startTime}
                      onChange={e => {
                        const next = { ...shiftSettings, startTime: e.target.value };
                        setShiftSettings(next);
                        localStorage.setItem('shift_settings', JSON.stringify(next));
                      }}
                      className="w-full min-h-[42px] px-3 text-sm border rounded-xl bg-white dark:bg-slate-800"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500">End Time</label>
                    <input
                      type="time"
                      value={shiftSettings.endTime}
                      onChange={e => {
                        const next = { ...shiftSettings, endTime: e.target.value };
                        setShiftSettings(next);
                        localStorage.setItem('shift_settings', JSON.stringify(next));
                      }}
                      className="w-full min-h-[42px] px-3 text-sm border rounded-xl bg-white dark:bg-slate-800"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500">Lunch Start</label>
                    <input
                      type="time"
                      value={shiftSettings.lunchStart}
                      onChange={e => {
                        const next = { ...shiftSettings, lunchStart: e.target.value };
                        setShiftSettings(next);
                        localStorage.setItem('shift_settings', JSON.stringify(next));
                      }}
                      className="w-full min-h-[42px] px-3 text-sm border rounded-xl bg-white dark:bg-slate-800"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500">Lunch End</label>
                    <input
                      type="time"
                      value={shiftSettings.lunchEnd}
                      onChange={e => {
                        const next = { ...shiftSettings, lunchEnd: e.target.value };
                        setShiftSettings(next);
                        localStorage.setItem('shift_settings', JSON.stringify(next));
                      }}
                      className="w-full min-h-[42px] px-3 text-sm border rounded-xl bg-white dark:bg-slate-800"
                    />
                  </div>
                </div>
              </div>

              {/* General Actions in Settings: History, Clear, Logout */}
              <div className="pt-4 border-t border-gray-100 dark:border-slate-800 space-y-2.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-slate-400 mb-2">
                  Data & History
                </h4>

                <button
                  type="button"
                  onClick={() => {
                    setIsSettingsOpen(false);
                    openHistory();
                  }}
                  className="w-full min-h-[44px] px-4 py-2.5 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-gray-800 dark:text-slate-200 flex items-center justify-center gap-2 hover:bg-gray-100"
                >
                  <History className="w-4 h-4 text-indigo-600" />
                  <span>View Timesheet History</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsSettingsOpen(false);
                    setShowClearConfirm(true);
                  }}
                  className="w-full min-h-[44px] px-4 py-2.5 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 rounded-xl text-sm font-semibold text-rose-700 dark:text-rose-300 flex items-center justify-center gap-2 hover:bg-rose-100"
                >
                  <Trash2 className="w-4 h-4 text-rose-600" />
                  <span>Clear Timesheet Data</span>
                </button>

                {user && (
                  <button
                    type="button"
                    onClick={async () => {
                      await signOut(auth);
                      setUser(null);
                      setIsSettingsOpen(false);
                    }}
                    className="w-full min-h-[44px] px-4 py-2.5 text-xs font-bold text-gray-500 hover:text-gray-700 flex items-center justify-center gap-1.5"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign Out ({user.email})</span>
                  </button>
                )}
              </div>

            </div>

            {/* Modal Footer with DONE button */}
            <div className="p-4 bg-gray-50 dark:bg-slate-800/60 border-t border-gray-100 dark:border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="min-h-[44px] px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold shadow-sm active:scale-95"
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

            <div className="p-4 border-b border-gray-100 dark:border-slate-800">
              <div className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search by period, name, or date..."
                  value={historySearchTerm}
                  onChange={e => setHistorySearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-300 dark:border-slate-700 rounded-xl bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div className="p-4 overflow-y-auto flex-1 space-y-2.5">
              {filteredHistory.length === 0 ? (
                <div className="text-center py-12 text-sm text-gray-500">
                  No saved history found for {companyName}.
                </div>
              ) : (
                filteredHistory.map(([week, data]) => (
                  <div
                    key={week}
                    onClick={() => loadHistoryItem(week)}
                    className="p-3.5 bg-gray-50 dark:bg-slate-800/80 hover:bg-indigo-50/50 dark:hover:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 flex items-center justify-between cursor-pointer transition-all"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-gray-900 dark:text-white">
                          Period: {data.weekOf || data.periodStart || week}
                        </span>
                        {data.name && (
                          <span className="text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded-md font-semibold">
                            {data.name}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Total: {data.records?.reduce((acc: number, r: any) => acc + (parseFloat(r.totalHours) || 0), 0).toFixed(2) || '0.00'} hrs
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
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
                ))
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
