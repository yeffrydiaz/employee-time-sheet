import React, { useState, useEffect, useRef } from 'react';
import { Mail, Printer, Calculator, RefreshCw, Save, Loader2, History, Search, X, ChevronRight, Trash2, CheckCircle2, ChevronDown, User, LogOut, Moon, Sun, Clock, Settings, Check, Calendar } from 'lucide-react';
import SignatureCanvas from 'react-signature-canvas';
import { motion, AnimatePresence } from 'motion/react';
import jsPDF from 'jspdf';
import { toPng } from 'html-to-image';
import { auth, db, googleProvider } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User as FirebaseUser, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { collection, doc, setDoc, getDocs, deleteDoc, serverTimestamp, query, where, onSnapshot } from 'firebase/firestore';

interface DailyRecord {
  day: string;
  date: string;
  timeIn: string;
  lunchStart: string;
  lunchEnd: string;
  timeOut: string;
  totalHours: string;
  notes: string;
}

const initialRecords: DailyRecord[] = [
  { day: 'Sunday', date: '', timeIn: '', lunchStart: '', lunchEnd: '', timeOut: '', totalHours: '', notes: '' },
  { day: 'Monday', date: '', timeIn: '', lunchStart: '', lunchEnd: '', timeOut: '', totalHours: '', notes: '' },
  { day: 'Tuesday', date: '', timeIn: '', lunchStart: '', lunchEnd: '', timeOut: '', totalHours: '', notes: '' },
  { day: 'Wednesday', date: '', timeIn: '', lunchStart: '', lunchEnd: '', timeOut: '', totalHours: '', notes: '' },
  { day: 'Thursday', date: '', timeIn: '', lunchStart: '', lunchEnd: '', timeOut: '', totalHours: '', notes: '' },
  { day: 'Friday', date: '', timeIn: '', lunchStart: '', lunchEnd: '', timeOut: '', totalHours: '', notes: '' },
  { day: 'Saturday', date: '', timeIn: '', lunchStart: '', lunchEnd: '', timeOut: '', totalHours: '', notes: '' },
];

const STORAGE_KEY_PREFIX = 'employee_timesheet_data_';
const HISTORY_STORAGE_KEY_PREFIX = 'employee_timesheet_history_';
const LAST_COMPANY_KEY = 'last_active_company';
const DEFAULT_EMAIL = 'TIMESHEETS@ROYAL-TRANS.COM';

const getInitialWeekOf = () => {
  const today = new Date();
  const diff = today.getDay(); // 0 is Sunday
  const sunday = new Date(today);
  sunday.setDate(today.getDate() - diff);
  return sunday.toISOString().split('T')[0];
};

const getTodayDate = () => {
  return new Date().toISOString().split('T')[0];
};

const generateRecordsForPeriod = (period: string, weekOfStr: string, existingRecords: DailyRecord[]) => {
  let startDateStr = weekOfStr || getInitialWeekOf();
  const [year, month, day] = startDateStr.split('-').map(Number);
  const selectedDate = new Date(year, month - 1, day);
  const diff = selectedDate.getDay();
  let startDate = new Date(year, month - 1, day - diff);
  
  let numDays = 14; // Default Bi-weekly
  if (period === 'Weekly') numDays = 7;
  else if (period === 'Monthly') {
    // Start from the 1st of the month based on the selected weekOf
    const daysInMonth = new Date(year, month, 0).getDate();
    numDays = daysInMonth;
    startDate = new Date(year, month - 1, 1);
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
    
    // Copy existing record if available
    const existing = existingRecords.find(r => r.date === dateStr);
    if (existing) {
      newRecords.push({ ...existing, day: dayName });
    } else if (existingRecords[i] && existingRecords[i].day === dayName && !existingRecords[i].date) {
      newRecords.push({ ...existingRecords[i], date: dateStr, day: dayName });
    } else {
      newRecords.push({ day: dayName, date: dateStr, timeIn: '', lunchStart: '', lunchEnd: '', timeOut: '', totalHours: '', notes: '' });
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
      saved = localStorage.getItem('employee_timesheet_data'); // Migration from old key
    }
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error('Failed to load timesheet data from local storage', e);
  }
  return null;
};

export default function App() {
  const initialCompany = getInitialCompany();
  const savedData = loadSavedData(initialCompany);

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
  // History and Modal states
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [shiftSettings, setShiftSettings] = useState(() => {
    const defaultSettings = { startTime: '09:00', lunchStart: '12:00', lunchEnd: '13:00', endTime: '17:00', enabled: true, period: 'Bi-weekly' };
    try {
      const saved = localStorage.getItem('shift_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        return { ...defaultSettings, ...parsed };
      }
      return defaultSettings;
    } catch (e) {
      return defaultSettings;
    }
  });

  const [name, setName] = useState(savedData?.name || '');
  const [employeeEmail, setEmployeeEmail] = useState(savedData?.employeeEmail || '');
  const [weekOf, setWeekOf] = useState(savedData?.weekOf || getInitialWeekOf());
  const [records, setRecords] = useState<DailyRecord[]>(() => {
    const initialWeek = savedData?.weekOf || getInitialWeekOf();
    const loadedRecords = savedData?.records || initialRecords;
    return generateRecordsForPeriod(shiftSettings.period, initialWeek, loadedRecords);
  });
  const [totalHours, setTotalHours] = useState('');
  const [signature, setSignature] = useState(savedData?.signature || '');
  const [date, setDate] = useState(savedData?.date || getTodayDate());
  const [recipientEmail, setRecipientEmail] = useState(savedData?.recipientEmail || DEFAULT_EMAIL);
  const [sentLogs, setSentLogs] = useState<{date: string, recipient: string}[]>(savedData?.sentLogs || []);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [historySearchTerm, setHistorySearchTerm] = useState('');
  const [historyData, setHistoryData] = useState<Record<string, any>>({});
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showEmailConfirm, setShowEmailConfirm] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<{week: string, e?: React.MouseEvent} | null>(null);
  const [showSavedIndicator, setShowSavedIndicator] = useState(false);
  const [isCompanyDropdownOpen, setIsCompanyDropdownOpen] = useState(false);
  const [newCompanyInput, setNewCompanyInput] = useState('');
  const [emailHistory, setEmailHistory] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(`email_history_${initialCompany}`);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  // Load company-specific email history when company changes
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`email_history_${companyName}`);
      setEmailHistory(saved ? JSON.parse(saved) : []);
    } catch (e) {
      setEmailHistory([]);
    }
  }, [companyName]);
  const [showEmailHistory, setShowEmailHistory] = useState(false);

  // Auth states
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authError, setAuthError] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  
  // Dark mode state
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme');
      if (saved) return saved === 'dark';
      // Default to light theme if no preference is saved
      return false;
    }
    return false;
  });

  const sigCanvas = useRef<SignatureCanvas>(null);
  const emailContainerRef = useRef<HTMLDivElement>(null);

  // Apply dark mode class to html element
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  // Handle clicks outside email dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (emailContainerRef.current && !emailContainerRef.current.contains(event.target as Node)) {
        setShowEmailHistory(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Listen for Firebase Auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Load history from Firestore
        const q = query(collection(db, 'users', currentUser.uid, 'timesheets'), where('companyName', '==', companyName));
        getDocs(q).then((querySnapshot) => {
          const history: Record<string, any> = {};
          querySnapshot.forEach((doc) => {
            const data = doc.data();
            if (data.data) {
              history[data.weekOf] = JSON.parse(data.data);
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

  const verifyRecaptcha = async (action: string) => {
    if (typeof window !== 'undefined' && 'grecaptcha' in window) {
      try {
        const token = await new Promise<string>((resolve, reject) => {
          (window as any).grecaptcha.enterprise.ready(async () => {
            try {
              const result = await (window as any).grecaptcha.enterprise.execute(import.meta.env.VITE_RECAPTCHA_SITE_KEY, {action});
              resolve(result);
            } catch (e) {
              reject(e);
            }
          });
        });

        const requestBody = {
          event: {
            token,
            expectedAction: action || "LOGIN",
            siteKey: import.meta.env.VITE_RECAPTCHA_SITE_KEY
          }
        };

        const projectId = import.meta.env.VITE_GOOGLE_CLOUD_PROJECT_ID || 'webnow10101';
        const apiKey = import.meta.env.VITE_RECAPTCHA_API_KEY;

        const response = await fetch(`https://recaptchaenterprise.googleapis.com/v1/projects/${projectId}/assessments?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          console.error("reCAPTCHA API Error:", errorData);
          // throw new Error('reCAPTCHA verification failed'); // Soft fail instead of blocking the user
        } else {
          const data = await response.json();
          console.log("reCAPTCHA Assessment Success:", data);
        }
      } catch (e) {
        console.error('reCAPTCHA error', e);
        // Do not throw here so user can still login even if reCAPTCHA settings are wrong
      }
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAuthenticating(true);
    setAuthError('');
    
    try {
      await verifyRecaptcha('LOGIN');
      await signInWithPopup(auth, googleProvider);
      setShowAuthModal(false);
    } catch (err: any) {
      console.error("Google Auth Error details:", err);
      if (err.code === 'auth/unauthorized-domain') {
        setAuthError('Domain not authorized in Firebase. If you just added it, it might take a few minutes to propagate.');
      } else if (err.code === 'auth/popup-closed-by-user') {
        setAuthError('Sign-in popup was closed before completion. Please try again.');
      } else {
        setAuthError(`Google Sign-In Error: ${err.message}`);
      }
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authEmail || !authPassword) {
      setAuthError('Please enter both email and password.');
      return;
    }
    setIsAuthenticating(true);
    setAuthError('');
    try {
      await verifyRecaptcha('LOGIN');
      await signInWithEmailAndPassword(auth, authEmail, authPassword);
      setShowAuthModal(false);
      setAuthEmail('');
      setAuthPassword('');
    } catch (err: any) {
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        setAuthError('Invalid email or password.');
      } else {
        setAuthError(err.message);
      }
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authEmail || !authPassword) {
      setAuthError('Please enter both email and password.');
      return;
    }
    setIsAuthenticating(true);
    setAuthError('');
    try {
      await verifyRecaptcha('SIGNUP');
      await createUserWithEmailAndPassword(auth, authEmail, authPassword);
      setShowAuthModal(false);
      setAuthEmail('');
      setAuthPassword('');
    } catch (err: any) {
      if (err.code === 'auth/email-already-in-use') {
        setAuthError('An account with this email already exists. Please sign in instead.');
      } else if (err.code === 'auth/weak-password') {
        setAuthError('Password should be at least 6 characters.');
      } else {
        setAuthError(err.message);
      }
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setUser(null);
    } catch (error) {
      console.error("Error signing out", error);
    }
  };

  const getCurrentTime = () => {
    const now = new Date();
    return now.toTimeString().slice(0, 5);
  };

  const handleTimeAction = (action: 'clockIn' | 'startLunch' | 'endLunch' | 'clockOut') => {
    const todayIndex = new Date().getDay();
    const todayRecord = records[todayIndex];
    const currentTime = getCurrentTime();
    
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
        const today = new Date();
        updatedRecord.date = `${(today.getMonth() + 1).toString().padStart(2, '0')}/${today.getDate().toString().padStart(2, '0')}`;
      }
    } else if (action === 'startLunch') {
      updatedRecord.lunchStart = currentTime;
    } else if (action === 'endLunch') {
      updatedRecord.lunchEnd = currentTime;
    } else if (action === 'clockOut') {
      updatedRecord.timeOut = currentTime;
    }
    
    newRecords[todayIndex] = updatedRecord;
    setRecords(newRecords);
  };

  // Web Notifications for Shift
  useEffect(() => {
    if (!shiftSettings.enabled) return;

    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }

    const checkShiftTimes = () => {
      if (Notification.permission !== 'granted') return;

      const now = new Date();
      const currentTimeStr = now.toTimeString().slice(0, 5);
      const todayIndex = now.getDay();
      const todayRecord = records[todayIndex];
      const todayDateStr = now.toISOString().split('T')[0];

      // Check Clock In
      if (currentTimeStr === shiftSettings.startTime && !todayRecord.timeIn) {
        const notifKey = `notif_in_${todayDateStr}`;
        if (!localStorage.getItem(notifKey)) {
          new Notification('Time to Clock In!', { body: `Your shift starts at ${shiftSettings.startTime}.` });
          localStorage.setItem(notifKey, 'true');
        }
      }

      // Check Lunch Start
      if (currentTimeStr === shiftSettings.lunchStart && todayRecord.timeIn && !todayRecord.lunchStart) {
        const notifKey = `notif_lunch_start_${todayDateStr}`;
        if (!localStorage.getItem(notifKey)) {
          new Notification('Time for Lunch!', { body: `Your lunch starts at ${shiftSettings.lunchStart}.` });
          localStorage.setItem(notifKey, 'true');
        }
      }

      // Check Lunch End
      if (currentTimeStr === shiftSettings.lunchEnd && todayRecord.lunchStart && !todayRecord.lunchEnd) {
        const notifKey = `notif_lunch_end_${todayDateStr}`;
        if (!localStorage.getItem(notifKey)) {
          new Notification('Lunch is over!', { body: `Time to clock back in from lunch at ${shiftSettings.lunchEnd}.` });
          localStorage.setItem(notifKey, 'true');
        }
      }

      // Check Clock Out
      if (currentTimeStr === shiftSettings.endTime && todayRecord.timeIn && !todayRecord.timeOut) {
        const notifKey = `notif_out_${todayDateStr}`;
        if (!localStorage.getItem(notifKey)) {
          new Notification('Time to Clock Out!', { body: `Your shift ends at ${shiftSettings.endTime}.` });
          localStorage.setItem(notifKey, 'true');
        }
      }
    };

    const interval = setInterval(checkShiftTimes, 30000); // Check every 30s
    return () => clearInterval(interval);
  }, [shiftSettings, records]);

  // Load signature into canvas on mount if it's a data URL
  useEffect(() => {
    if (sigCanvas.current && signature && signature.startsWith('data:image')) {
      sigCanvas.current.fromDataURL(signature);
    }
  }, []);

  // Save to local storage whenever data changes
  useEffect(() => {
    const dataToSave = { companyName, name, employeeEmail, weekOf, records, signature, date, recipientEmail, sentLogs };
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${companyName}`, JSON.stringify(dataToSave));
    setLastSaved(new Date());
    
    setShowSavedIndicator(true);
    const timer = setTimeout(() => {
      setShowSavedIndicator(false);
    }, 2000);

    // Also save to history if weekOf is set
    if (weekOf) {
      try {
        const historyKey = `${HISTORY_STORAGE_KEY_PREFIX}${companyName}`;
        let historyStr = localStorage.getItem(historyKey);
        if (!historyStr && companyName === 'Royal Transportation') {
          historyStr = localStorage.getItem('employee_timesheet_history');
        }
        const history = JSON.parse(historyStr || '{}');
        history[weekOf] = { ...dataToSave, lastModified: new Date().toISOString() };
        localStorage.setItem(historyKey, JSON.stringify(history));
        
        // Sync to cloud if logged in
        if (user) {
          const timesheetRef = doc(db, 'users', user.uid, 'timesheets', `${companyName}_${weekOf}`);
          setDoc(timesheetRef, {
            userId: user.uid,
            companyName,
            weekOf,
            data: JSON.stringify(history[weekOf]),
            updatedAt: serverTimestamp()
          }).catch(e => console.error('Failed to save to Firestore', e));
        }
      } catch (e) {
        console.error('Failed to save to history', e);
      }
    }
    
    return () => clearTimeout(timer);
  }, [companyName, name, employeeEmail, weekOf, records, signature, date, recipientEmail, sentLogs]);

  // Auto-calculate total hours when records change
  useEffect(() => {
    let weeklyTotal = 0;
    const updatedRecords = records.map(record => {
      const calculatedHours = calculateRowHours(record);
      if (calculatedHours) {
        weeklyTotal += parseFloat(calculatedHours);
      }
      return { ...record, totalHours: calculatedHours };
    });

    // Only update if there's an actual change to prevent infinite loops
    const hasChanges = updatedRecords.some((r, i) => r.totalHours !== records[i].totalHours);
    if (hasChanges) {
      setRecords(updatedRecords);
    }
    
    setTotalHours(weeklyTotal > 0 ? weeklyTotal.toFixed(2) : '');
  }, [records]);

  // Update document title for printing to set a good default filename
  useEffect(() => {
    const originalTitle = document.title;
    const setPrintTitle = () => {
      document.title = `Timesheet_${name || 'Employee'}_${weekOf || 'Week'}`.replace(/\s+/g, '_');
    };
    const restoreTitle = () => {
      document.title = originalTitle;
    };

    window.addEventListener('beforeprint', setPrintTitle);
    window.addEventListener('afterprint', restoreTitle);

    return () => {
      window.removeEventListener('beforeprint', setPrintTitle);
      window.removeEventListener('afterprint', restoreTitle);
    };
  }, [name, weekOf]);

  const calculateRowHours = (record: DailyRecord) => {
    if (!record.timeIn || !record.timeOut) return record.totalHours; // Keep manual entry if times are missing

    const parseTime = (timeStr: string) => {
      if (!timeStr) return 0;
      const [hours, minutes] = timeStr.split(':').map(Number);
      return hours + minutes / 60;
    };

    const inTime = parseTime(record.timeIn);
    let outTime = parseTime(record.timeOut);
    
    // Handle overnight shifts
    if (outTime < inTime) {
      outTime += 24;
    }

    let total = outTime - inTime;

    if (record.lunchStart && record.lunchEnd) {
      const lStart = parseTime(record.lunchStart);
      let lEnd = parseTime(record.lunchEnd);
      if (lEnd < lStart) {
        lEnd += 24;
      }
      total -= (lEnd - lStart);
    }

    return total > 0 ? total.toFixed(2) : '';
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    const capitalized = val.replace(/\b\w/g, (c) => c.toUpperCase());
    setName(capitalized);
  };

  const handleWeekOfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newWeekOf = e.target.value;
    setWeekOf(newWeekOf);
    
    if (newWeekOf) {
      const newRecords = generateRecordsForPeriod(shiftSettings.period, newWeekOf, records);
      setRecords(newRecords);
    }
  };

  const getErrors = (record: DailyRecord) => {
    const errs: Partial<Record<keyof DailyRecord, string>> = {};
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    
    const isValidTime = (t: string | undefined) => t ? timeRegex.test(t) : false;

    if (record.timeIn && !isValidTime(record.timeIn)) errs.timeIn = "Invalid format (HH:MM)";
    if (record.lunchStart && !isValidTime(record.lunchStart)) errs.lunchStart = "Invalid format (HH:MM)";
    if (record.lunchEnd && !isValidTime(record.lunchEnd)) errs.lunchEnd = "Invalid format (HH:MM)";
    if (record.timeOut && !isValidTime(record.timeOut)) errs.timeOut = "Invalid format (HH:MM)";
    if (record.totalHours && isNaN(Number(record.totalHours))) errs.totalHours = "Must be a number";
    
    if (isValidTime(record.timeIn) && isValidTime(record.timeOut)) {
      const parseTime = (timeStr: string) => {
        const [hours, minutes] = timeStr.split(':').map(Number);
        return hours + minutes / 60;
      };

      const inTime = parseTime(record.timeIn!);
      let outTime = parseTime(record.timeOut!);
      if (outTime < inTime) outTime += 24;

      let lStart = isValidTime(record.lunchStart) ? parseTime(record.lunchStart!) : null;
      let lEnd = isValidTime(record.lunchEnd) ? parseTime(record.lunchEnd!) : null;

      if (lStart !== null) {
        if (lStart < inTime) lStart += 24;
        if (lStart > outTime) errs.lunchStart = "Must be within work hours";
      }

      if (lEnd !== null) {
        if (lStart !== null) {
          if (lEnd < lStart) {
            // If the lunch break appears to be over 12 hours after adjusting for midnight,
            // it's highly likely the user entered an end time that is before the start time.
            if ((lEnd + 24) - lStart > 12) {
              errs.lunchEnd = "Must be after Lunch Start";
            } else {
              lEnd += 24;
            }
          }
        } else if (lEnd < inTime) {
          lEnd += 24;
        }
        
        if (!errs.lunchEnd && lEnd > outTime) {
          errs.lunchEnd = "Must be within work hours";
        }
      }
    }
    
    return errs;
  };

  const handleRecordChange = (index: number, field: keyof DailyRecord, value: string) => {
    const newRecords = [...records];
    newRecords[index] = { ...newRecords[index], [field]: value };
    setRecords(newRecords);
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
      alert("Please sign the timesheet to send it.");
      return;
    }

    if (!recipientEmail?.trim()) {
      alert("Please enter the manager's email address.");
      return;
    }

    setShowEmailConfirm(true);
  };

  const generatePDF = async () => {
    const contentElement = document.getElementById('timesheet-content');
    if (!contentElement) return null;

    // Temporarily hide elements we don't want in the PDF
    const elementsToHide = contentElement.querySelectorAll('.print\\:hidden, .pdf\\:hidden');
    elementsToHide.forEach(el => (el as HTMLElement).style.display = 'none');
    
    // Add pdf-mode class to trigger print-like styles
    contentElement.classList.add('pdf-mode');
    if (isDarkMode) {
      contentElement.classList.add('dark');
      // Also add to children to ensure SVG rendering engine catches the class
      Array.from(contentElement.children).forEach(child => child.classList.add('dark'));
    }
    
    // FORCE the element to be 800px wide for accurate layout calculation on mobile
    const originalWidth = contentElement.style.width;
    const originalMaxWidth = contentElement.style.maxWidth;
    const originalMargin = contentElement.style.margin;
    
    contentElement.style.width = '800px';
    contentElement.style.maxWidth = '800px';
    contentElement.style.margin = '0';
    
    // Wait for browser to recalculate layout
    await new Promise(resolve => setTimeout(resolve, 100));
    
    try {
      const dataUrl = await toPng(contentElement, {
        quality: 1.0,
        pixelRatio: 2,
        // Ensure the background color matches the current theme
        backgroundColor: isDarkMode ? '#0f172a' : '#ffffff',
        width: 800,
        style: {
          width: '800px',
          maxWidth: '800px',
          margin: '0',
          transform: 'scale(1)',
          transformOrigin: 'top left'
        }
      });
      
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });
      
      const margin = 15; // 15mm margin on all sides
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const availableWidth = pdfWidth - (margin * 2);
      
      const imgProps = pdf.getImageProperties(dataUrl);
      const imgHeight = (imgProps.height * availableWidth) / imgProps.width;
      
      pdf.addImage(dataUrl, 'PNG', margin, margin, availableWidth, imgHeight);
      return pdf;
    } catch (error) {
      console.error('Error generating PDF:', error);
      return null;
    } finally {
      // Restore original styles
      contentElement.style.width = originalWidth;
      contentElement.style.maxWidth = originalMaxWidth;
      contentElement.style.margin = originalMargin;
      
      // Restore hidden elements and remove pdf-mode
      contentElement.classList.remove('pdf-mode');
      if (isDarkMode) {
        contentElement.classList.remove('dark');
        Array.from(contentElement.children).forEach(child => child.classList.remove('dark'));
      }
      elementsToHide.forEach(el => (el as HTMLElement).style.display = '');
    }
  };

  const confirmSendEmail = async () => {
    setShowEmailConfirm(false);
    setIsSending(true);
    
    // Wait for React to re-render and remove the modal from the DOM
    setTimeout(async () => {
      try {
        // 1. Generate PDF
        const pdf = await generatePDF();
        if (pdf) {
          // Download the PDF
          const fileName = `Timesheet_${name || 'Employee'}_${weekOf || 'Week'}.pdf`.replace(/\s+/g, '_');
          pdf.save(fileName);
        }

        // 2. Open Email Client
        const subject = encodeURIComponent(`Time Sheet: ${name || 'Employee'} - Week of ${weekOf || 'Unknown'}`);
        
        // Add to email history
        const currentEmails = recipientEmail.split(',').map(e => e.trim()).filter(Boolean);
        const newHistory = [...new Set([...currentEmails, ...emailHistory])].slice(0, 20); // Keep last 20
        setEmailHistory(newHistory);
        localStorage.setItem(`email_history_${companyName}`, JSON.stringify(newHistory));

        let bodyText = `${companyName || 'Employee'} Time Sheet\n`;
        bodyText += `===================\n\n`;
        bodyText += `Name: ${name}\n`;
        bodyText += `Week of: ${weekOf}\n\n`;
        bodyText += `IMPORTANT: Please attach the downloaded PDF timesheet to this email before sending.\n\n`;
        
        bodyText += `Daily Records:\n`;
        bodyText += `--------------\n`;
        records.forEach(r => {
          if (r.date || r.timeIn || r.timeOut || r.totalHours) {
            bodyText += `${r.day} (${r.date || 'No Date'}):\n`;
            bodyText += `  Time In: ${r.timeIn || '-'}\n`;
            bodyText += `  Lunch: ${r.lunchStart || '-'} to ${r.lunchEnd || '-'}\n`;
            bodyText += `  Time Out: ${r.timeOut || '-'}\n`;
            bodyText += `  Total Hours: ${r.totalHours || '0'}\n`;
            if (r.notes) bodyText += `  Notes: ${r.notes}\n`;
            bodyText += `\n`;
          }
        });
        
        bodyText += `--------------\n`;
        bodyText += `Total Weekly Hours: ${totalHours}\n\n`;
        
        bodyText += `Employee Signature: ${signature ? '[Electronically Signed]' : 'Not Signed'}\n`;
        bodyText += `Date: ${date}\n`;
        
        const body = encodeURIComponent(bodyText);
        const actualEmployeeEmail = user?.email || employeeEmail?.trim();
        const ccParam = actualEmployeeEmail ? `cc=${encodeURIComponent(actualEmployeeEmail)}&` : '';
        window.location.href = `mailto:${recipientEmail}?${ccParam}subject=${subject}&body=${body}`;
        
        // Record the sent email
        setSentLogs(prev => [...prev, { date: new Date().toISOString(), recipient: recipientEmail }]);
        
      } catch (error) {
        console.error('Error generating PDF or sending email:', error);
        alert('There was an error generating the PDF. Please try again.');
      } finally {
        setIsSending(false);
      }
    }, 100);
  };

  const handlePrint = async () => {
    setIsGeneratingPDF(true);
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write('Generating PDF for printing... Please wait.');
    }
    
    try {
      const pdf = await generatePDF();
      if (pdf) {
        pdf.autoPrint();
        const url = URL.createObjectURL(pdf.output('blob'));
        if (printWindow) {
          printWindow.location.href = url;
        } else {
          // Fallback if popup blocked
          const fileName = `Timesheet_${name || 'Employee'}_${weekOf || 'Week'}.pdf`.replace(/\s+/g, '_');
          pdf.save(fileName);
        }
      }
    } catch (error) {
      console.error('Error generating PDF for print:', error);
      if (printWindow) printWindow.close();
      alert('There was an error generating the print view. Please try again.');
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  const handleClear = () => {
    setShowClearConfirm(true);
  };

  const confirmClear = () => {
    setName('');
    setEmployeeEmail('');
    const newWeekOf = getInitialWeekOf();
    setWeekOf(newWeekOf);
    setRecords(generateRecordsForPeriod(shiftSettings.period, newWeekOf, []));
    setTotalHours('');
    setSignature('');
    sigCanvas.current?.clear();
    setDate(getTodayDate());
    setRecipientEmail(DEFAULT_EMAIL);
    setSentLogs([]);
    setShowClearConfirm(false);
  };

  const switchCompany = (newCompany: string) => {
    // Save current state before switching
    const currentData = { companyName, name, employeeEmail, weekOf, records, signature, date, recipientEmail, sentLogs };
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${companyName}`, JSON.stringify(currentData));

    // Load new company data
    const newData = loadSavedData(newCompany);
    
    setCompanyName(newCompany);
    localStorage.setItem(LAST_COMPANY_KEY, newCompany);
    
    setName(newData?.name || '');
    setEmployeeEmail(newData?.employeeEmail || '');
    const newWeekOf = newData?.weekOf || getInitialWeekOf();
    setWeekOf(newWeekOf);
    setRecords(generateRecordsForPeriod(shiftSettings.period, newWeekOf, newData?.records || []));
    setSignature(newData?.signature || '');
    setDate(newData?.date || getTodayDate());
    setRecipientEmail(newData?.recipientEmail || DEFAULT_EMAIL);
    setSentLogs(newData?.sentLogs || []);
    
    if (sigCanvas.current) {
      sigCanvas.current.clear();
      if (newData?.signature && newData.signature.startsWith('data:image')) {
        setTimeout(() => {
          sigCanvas.current?.fromDataURL(newData.signature);
        }, 50);
      }
    }
  };

  const handleAddCompany = () => {
    const trimmed = newCompanyInput.trim();
    if (trimmed) {
      if (!companies.includes(trimmed)) {
        const newCompanies = [...companies, trimmed];
        setCompanies(newCompanies);
        localStorage.setItem('companies_list', JSON.stringify(newCompanies));
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

  const loadHistoryItem = (week: string) => {
    const data = historyData[week];
    if (data) {
      setName(data.name || '');
      setEmployeeEmail(data.employeeEmail || '');
      setWeekOf(data.weekOf || '');
      setRecords(data.records || initialRecords);
      setSignature(data.signature || '');
      setDate(data.date || '');
      setRecipientEmail(data.recipientEmail || DEFAULT_EMAIL);
      setSentLogs(data.sentLogs || []);
      setIsHistoryOpen(false);
      
      // Update signature canvas
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

  const confirmDeleteHistoryItem = async () => {
    if (!itemToDelete) return;
    const { week } = itemToDelete;
    // hide modal
    setItemToDelete(null);

    try {
      const token = user ? await auth.currentUser?.getIdToken() : null;
      const historyKey = `${HISTORY_STORAGE_KEY_PREFIX}${companyName}`;
      let historyStr = localStorage.getItem(historyKey);
      if (!historyStr && companyName === 'Royal Transportation') {
        historyStr = localStorage.getItem('employee_timesheet_history');
      }
      const history = JSON.parse(historyStr || '{}');
      delete history[week];
      localStorage.setItem(historyKey, JSON.stringify(history));
      setHistoryData(history);
      
      if (token) {
        fetch(`/api/timesheets/${week}?company=${encodeURIComponent(companyName)}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        }).catch(err => console.error('Failed to delete from cloud', err));
      }
    } catch (err) {
      console.error('Failed to delete history item', err);
    }
  };

  const attemptDeleteHistoryItem = (week: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setItemToDelete({ week, e });
  };

  const filteredHistory = Object.entries(historyData)
    .filter(([week, data]) => {
      const term = historySearchTerm.toLowerCase();
      if (!term) return true;
      if (week.toLowerCase().includes(term)) return true;
      if (data.name && data.name.toLowerCase().includes(term)) return true;
      // Search by day or date in records
      if (data.records && data.records.some((r: any) => 
        (r.day && r.day.toLowerCase().includes(term)) || 
        (r.date && r.date.toLowerCase().includes(term)) ||
        (r.notes && r.notes.toLowerCase().includes(term))
      )) return true;
      return false;
    })
    .sort((a, b) => b[0].localeCompare(a[0])); // Sort by week descending

  const totalWeeklyHoursNum = parseFloat(totalHours) || 0;

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-slate-900 py-4 sm:py-8 px-2 sm:px-6 lg:px-8 print:bg-white pdf:bg-white print:py-0 pdf:py-0 print:px-0 pdf:px-0">
      <div id="timesheet-content" className="max-w-5xl print:max-w-full pdf:max-w-full mx-auto space-y-4 sm:space-y-6">
        
        {/* Header Actions - Hidden when printing */}
        <header className="relative z-50 flex flex-col md:flex-row justify-between items-start gap-4 bg-white/40 dark:bg-slate-800/40 backdrop-blur-md p-4 rounded-xl shadow-sm border border-white/50 dark:border-slate-700/50 print:hidden pdf:hidden">
          <div className="flex items-center gap-3 text-indigo-600 dark:text-indigo-400">
            <div className="bg-indigo-100 dark:bg-indigo-900/50 p-2 rounded-lg">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900 dark:text-white leading-tight">Time Sheet Manager</h1>
            </div>
          </div>
          
          <div className="flex flex-col w-full md:w-auto items-stretch md:items-end gap-3">
            <div className="flex flex-col sm:flex-row items-center justify-between md:justify-end gap-3 w-full">
              {lastSaved && (
                <div className="text-xs text-gray-400 dark:text-slate-500 flex items-center gap-1">
                  <Save className="w-3 h-3" />
                  Last saved {lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
              <div className="flex flex-wrap justify-end gap-2 w-full sm:w-auto">
                {!user && (
                  <button
                    onClick={() => setShowAuthModal(true)}
                    className="flex-1 sm:flex-none flex justify-center items-center gap-2 px-3 py-1.5 text-sm font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800/50 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors"
                  >
                    <User className="w-4 h-4" />
                    Login / Sign Up
                  </button>
                )}
                <button
                  onClick={() => setIsSettingsOpen(true)}
                  className="flex-1 sm:flex-none flex justify-center items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                >
                  <Settings className="w-4 h-4" />
                  Settings
                </button>
                <button
                  onClick={openHistory}
                  className="flex-1 sm:flex-none flex justify-center items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                >
                  <History className="w-4 h-4" />
                  History
                </button>
                <button
                  onClick={handlePrint}
                  disabled={isGeneratingPDF}
                  className="flex-1 sm:flex-none flex justify-center items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-70 disabled:cursor-not-allowed min-w-[90px]"
                >
                  {isGeneratingPDF ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Wait...
                    </>
                  ) : (
                    <>
                      <Printer className="w-4 h-4" />
                      Print
                    </>
                  )}
                </button>
              </div>
            </div>
            
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
              <div className="relative w-full sm:w-72" ref={emailContainerRef}>
                <input
                  type="text"
                  placeholder="Manager's Email(s)"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  onFocus={() => setShowEmailHistory(true)}
                  className="px-3 py-2 text-sm sm:text-base border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 w-full pr-8 bg-white/50 dark:bg-slate-800/50 text-gray-900 dark:text-white"
                />
                <button 
                  onClick={() => setShowEmailHistory(!showEmailHistory)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
                
                {showEmailHistory && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg z-50 max-h-64 flex flex-col overflow-hidden">
                    <div className="p-2 border-b border-gray-100 dark:border-slate-700">
                      <input
                        type="email"
                        placeholder="Add new email & press Enter..."
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded focus:ring-2 focus:ring-indigo-500 bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-white"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const newEmail = e.currentTarget.value.trim();
                            if (newEmail && newEmail.includes('@')) {
                              if (!emailHistory.includes(newEmail)) {
                                const newHistory = [newEmail, ...emailHistory].slice(0, 20);
                                setEmailHistory(newHistory);
                                localStorage.setItem(`email_history_${companyName}`, JSON.stringify(newHistory));
                              }
                              
                              const currentEmails = recipientEmail.split(',').map(e => e.trim()).filter(Boolean);
                              if (!currentEmails.includes(newEmail)) {
                                setRecipientEmail(currentEmails.length > 0 ? `${recipientEmail}, ${newEmail}` : newEmail);
                              }
                              e.currentTarget.value = '';
                            }
                          }
                        }}
                      />
                    </div>
                    <div className="overflow-y-auto">
                      {emailHistory.length === 0 ? (
                        <div className="px-3 py-4 text-sm text-center text-gray-500 dark:text-slate-400">
                          No saved emails
                        </div>
                      ) : (
                        emailHistory.map(email => {
                          const isSelected = recipientEmail.split(',').map(e => e.trim()).includes(email);
                          return (
                            <div 
                              key={email}
                              className="px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-slate-700 cursor-pointer flex justify-between items-center text-gray-900 dark:text-white"
                              onClick={() => {
                                const currentEmails = recipientEmail.split(',').map(e => e.trim()).filter(Boolean);
                                if (isSelected) {
                                  setRecipientEmail(currentEmails.filter(e => e !== email).join(', '));
                                } else {
                                  setRecipientEmail(currentEmails.length > 0 ? `${currentEmails.join(', ')}, ${email}` : email);
                                }
                              }}
                            >
                              <div className="flex items-center gap-2 truncate">
                                <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${isSelected ? 'bg-indigo-500 border-indigo-500' : 'border-gray-300 dark:border-slate-600'}`}>
                                  {isSelected && <Check className="w-3 h-3 text-white" />}
                                </div>
                                <span className="truncate">{email}</span>
                              </div>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const newHistory = emailHistory.filter(e => e !== email);
                                  setEmailHistory(newHistory);
                                  localStorage.setItem(`email_history_${companyName}`, JSON.stringify(newHistory));
                                  
                                  if (isSelected) {
                                    const currentEmails = recipientEmail.split(',').map(e => e.trim()).filter(Boolean);
                                    setRecipientEmail(currentEmails.filter(e => e !== email).join(', '));
                                  }
                                }}
                                className="text-gray-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 ml-2 flex-shrink-0"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
              <button
                onClick={handleSendEmailClick}
                disabled={isSending}
                className="flex justify-center items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-70 disabled:cursor-not-allowed min-w-[100px]"
              >
                {isSending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Mail className="w-4 h-4" />
                    Send
                  </>
                )}
              </button>
            </div>
            
            {sentLogs.length > 0 && (
              <div className="text-xs text-gray-500 flex items-center justify-end gap-1 mt-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                Last sent: {new Date(sentLogs[sentLogs.length - 1].date).toLocaleString()} to {sentLogs[sentLogs.length - 1].recipient}
              </div>
            )}
          </div>
        </header>

        {/* Main Form Document */}
        <div className="bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl shadow-xl rounded-2xl overflow-hidden border border-white/50 dark:border-slate-700/50 print:shadow-none pdf:shadow-none print:border-none pdf:border-none print:rounded-none pdf:rounded-none print:bg-white pdf:bg-white">
          <div className="p-4 sm:p-8 md:p-12 print:p-0 pdf:p-0">
            
            {/* Document Header */}
            <div className="text-center mb-8 sm:mb-10 print:mb-4 pdf:mb-4 relative z-20">
              <div className="relative inline-block text-left w-full max-w-md mx-auto">
                <button
                  onClick={() => setIsCompanyDropdownOpen(!isCompanyDropdownOpen)}
                  className="text-2xl sm:text-3xl print:text-xl pdf:text-xl font-bold text-gray-900 dark:text-white tracking-tight flex items-center justify-center w-full gap-2 hover:opacity-80 transition-opacity print:pointer-events-none pdf:pointer-events-none"
                >
                  {companyName || 'Select Company'}
                  <ChevronDown className="w-6 h-6 opacity-50 print:hidden pdf:hidden" />
                </button>
                
                {isCompanyDropdownOpen && (
                  <>
                    <div 
                      className="fixed inset-0 z-10" 
                      onClick={() => setIsCompanyDropdownOpen(false)}
                    />
                    <div className="absolute left-1/2 -translate-x-1/2 mt-2 w-full max-w-sm bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-gray-200 dark:border-slate-700 overflow-hidden z-20">
                      <div className="max-h-60 overflow-y-auto py-2">
                        {companies.map(c => (
                          <button
                            key={c}
                            onClick={() => {
                              switchCompany(c);
                              setIsCompanyDropdownOpen(false);
                            }}
                            className={`w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-slate-700 text-gray-900 dark:text-white font-medium flex items-center justify-between ${companyName === c ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400' : ''}`}
                          >
                            {c}
                            {companyName === c && <CheckCircle2 className="w-4 h-4" />}
                          </button>
                        ))}
                      </div>
                      <div className="p-2 border-t border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50 flex gap-2">
                        <input
                          type="text"
                          placeholder="Add new company..."
                          value={newCompanyInput}
                          onChange={e => setNewCompanyInput(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleAddCompany();
                          }}
                          className="flex-1 px-3 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-900 text-gray-900 dark:text-white"
                        />
                        <button
                          onClick={handleAddCompany}
                          disabled={!newCompanyInput.trim()}
                          className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
              
              {/* Clock In/Out Buttons */}
              <div className="mt-4 print:hidden pdf:hidden flex flex-wrap justify-center gap-3">
                {(() => {
                  const todayRecord = records[new Date().getDay()];
                  const hasTimeIn = !!todayRecord.timeIn;
                  const hasLunchStart = !!todayRecord.lunchStart;
                  const hasLunchEnd = !!todayRecord.lunchEnd;
                  const hasTimeOut = !!todayRecord.timeOut;

                  const canClockIn = !hasTimeIn || (hasTimeIn && hasTimeOut);
                  const canStartLunch = hasTimeIn && !hasLunchStart && !hasTimeOut;
                  const canEndLunch = hasTimeIn && hasLunchStart && !hasLunchEnd && !hasTimeOut;
                  const canClockOut = hasTimeIn && !hasTimeOut && (!hasLunchStart || hasLunchEnd);

                  return (
                    <>
                      {canClockIn && (
                        <button
                          onClick={() => handleTimeAction('clockIn')}
                          className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full font-medium shadow-md hover:shadow-lg transition-all active:scale-95"
                        >
                          <Clock className="w-5 h-5" />
                          Clock In
                        </button>
                      )}
                      
                      {canStartLunch && (
                        <button
                          onClick={() => handleTimeAction('startLunch')}
                          className="flex items-center gap-2 px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-full font-medium shadow-md hover:shadow-lg transition-all active:scale-95"
                        >
                          <Clock className="w-5 h-5" />
                          Start Lunch
                        </button>
                      )}

                      {canEndLunch && (
                        <button
                          onClick={() => handleTimeAction('endLunch')}
                          className="flex items-center gap-2 px-6 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full font-medium shadow-md hover:shadow-lg transition-all active:scale-95"
                        >
                          <Clock className="w-5 h-5" />
                          End Lunch
                        </button>
                      )}

                      {canClockOut && (
                        <button
                          onClick={() => handleTimeAction('clockOut')}
                          className="flex items-center gap-2 px-6 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-full font-medium shadow-md hover:shadow-lg transition-all active:scale-95"
                        >
                          <Clock className="w-5 h-5" />
                          Clock Out
                        </button>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>

            {/* Employee Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 print:grid-cols-2 pdf:grid-cols-2 gap-4 sm:gap-6 mb-8 sm:mb-10 print:mb-4 pdf:mb-4">
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Name</label>
                  <input
                    type="text"
                    value={name || ''}
                    onChange={handleNameChange}
                    className="block w-full border-0 border-b-2 border-gray-200 dark:border-slate-700 focus:border-indigo-600 dark:focus:border-indigo-400 focus:ring-0 px-0 py-0.5 text-xl sm:text-2xl print:text-lg pdf:text-lg print:border-none pdf:border-none print:p-0 pdf:p-0 font-bold transition-colors bg-transparent text-gray-900 dark:text-white placeholder-gray-300 dark:placeholder-slate-600"
                    placeholder="John Doe"
                  />
                </div>
                {!user && (
                  <div className="space-y-1 print:hidden pdf:hidden">
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Your Email (for CC)</label>
                    <input
                      type="email"
                      value={employeeEmail || ''}
                      onChange={(e) => setEmployeeEmail(e.target.value)}
                      className="block w-full border-0 border-b-2 border-gray-200 dark:border-slate-700 focus:border-indigo-600 dark:focus:border-indigo-400 focus:ring-0 px-0 py-0.5 text-lg sm:text-xl font-bold transition-colors bg-transparent text-gray-900 dark:text-white placeholder-gray-300 dark:placeholder-slate-600"
                      placeholder="john@example.com"
                    />
                  </div>
                )}
              </div>
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Week Of</label>
                <input
                  type="date"
                  value={weekOf || ''}
                  onChange={handleWeekOfChange}
                  className="block w-full border-0 border-b-2 border-gray-200 dark:border-slate-700 focus:border-indigo-600 dark:focus:border-indigo-400 focus:ring-0 px-0 py-0.5 text-xl sm:text-2xl print:text-lg pdf:text-lg print:border-none pdf:border-none print:p-0 pdf:p-0 font-bold transition-colors bg-transparent text-gray-900 dark:text-white"
                />
              </div>
            </div>

            {/* Mobile Cards View (Hidden on Desktop & Print) */}
            <div className="block md:hidden print:hidden pdf:hidden space-y-4 mb-8">
              {records.map((record, index) => {
                const errors = getErrors(record);
                return (
                <div key={index} className="bg-white/40 dark:bg-slate-800/40 backdrop-blur-md p-3.5 rounded-xl border border-white/50 dark:border-slate-700/50 shadow-sm flex flex-col gap-3">
                  {/* Header: Day and Date */}
                  <div className="flex justify-between items-center border-b border-gray-100 dark:border-slate-700/50 pb-2">
                    <h3 className="font-semibold text-gray-900 dark:text-white">{record.day}</h3>
                    <div className="relative">
                      <input
                        type="date"
                        value={record.date || ''}
                        onChange={(e) => handleRecordChange(index, 'date', e.target.value)}
                        className="text-sm border border-gray-300 dark:border-slate-600 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 py-1 pl-8 min-h-[32px] pr-2 bg-white dark:bg-slate-800 text-gray-900 dark:text-white w-36"
                      />
                      <Calendar className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  </div>
                  
                  {/* Times Grid */}
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                    {/* Time In */}
                    <div className="flex flex-col">
                      <div className="flex justify-between items-center mb-0.5">
                        <label className="text-[10px] font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">In</label>
                        <div className="flex items-center gap-1">
                          {!record.timeIn && (
                            <button onClick={() => handleRecordChange(index, 'timeIn', getCurrentTime())} className="text-[9px] font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 uppercase bg-indigo-50 dark:bg-indigo-900/30 px-1 py-0.5 rounded">Now</button>
                          )}
                          {record.timeIn && (
                            <button onClick={() => handleRecordChange(index, 'timeIn', '')} className="text-gray-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400">
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                      <input
                        type="time"
                        value={record.timeIn || ''}
                        onChange={(e) => handleRecordChange(index, 'timeIn', e.target.value)}
                        className={`text-sm rounded-md shadow-sm border py-1.5 px-2 bg-white dark:bg-slate-800 text-gray-900 dark:text-white ${errors.timeIn ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 dark:border-slate-600 focus:ring-indigo-500'}`}
                      />
                      {errors.timeIn && <p className="text-[10px] text-red-500 mt-0.5">{errors.timeIn}</p>}
                    </div>
                    {/* Time Out */}
                    <div className="flex flex-col">
                      <div className="flex justify-between items-center mb-0.5">
                        <label className="text-[10px] font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">Out</label>
                        <div className="flex items-center gap-1">
                          {!record.timeOut && (
                            <button onClick={() => handleRecordChange(index, 'timeOut', getCurrentTime())} className="text-[9px] font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 uppercase bg-indigo-50 dark:bg-indigo-900/30 px-1 py-0.5 rounded">Now</button>
                          )}
                          {record.timeOut && (
                            <button onClick={() => handleRecordChange(index, 'timeOut', '')} className="text-gray-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400">
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                      <input
                        type="time"
                        value={record.timeOut || ''}
                        onChange={(e) => handleRecordChange(index, 'timeOut', e.target.value)}
                        className={`text-sm rounded-md shadow-sm border py-1.5 px-2 bg-white dark:bg-slate-800 text-gray-900 dark:text-white ${errors.timeOut ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 dark:border-slate-600 focus:ring-indigo-500'}`}
                      />
                      {errors.timeOut && <p className="text-[10px] text-red-500 mt-0.5">{errors.timeOut}</p>}
                    </div>
                    {/* Lunch Start */}
                    <div className="flex flex-col">
                      <div className="flex justify-between items-center mb-0.5">
                        <label className="text-[10px] font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">Lunch Start</label>
                        <div className="flex items-center gap-1">
                          {!record.lunchStart && (
                            <button onClick={() => handleRecordChange(index, 'lunchStart', getCurrentTime())} className="text-[9px] font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 uppercase bg-indigo-50 dark:bg-indigo-900/30 px-1 py-0.5 rounded">Now</button>
                          )}
                          {record.lunchStart && (
                            <button onClick={() => handleRecordChange(index, 'lunchStart', '')} className="text-gray-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400">
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                      <input
                        type="time"
                        value={record.lunchStart || ''}
                        onChange={(e) => handleRecordChange(index, 'lunchStart', e.target.value)}
                        className={`text-sm rounded-md shadow-sm border py-1.5 px-2 bg-white dark:bg-slate-800 text-gray-900 dark:text-white ${errors.lunchStart ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 dark:border-slate-600 focus:ring-indigo-500'}`}
                      />
                      {errors.lunchStart && <p className="text-[10px] text-red-500 mt-0.5">{errors.lunchStart}</p>}
                    </div>
                    {/* Lunch End */}
                    <div className="flex flex-col">
                      <div className="flex justify-between items-center mb-0.5">
                        <label className="text-[10px] font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">Lunch End</label>
                        <div className="flex items-center gap-1">
                          {!record.lunchEnd && (
                            <button onClick={() => handleRecordChange(index, 'lunchEnd', getCurrentTime())} className="text-[9px] font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 uppercase bg-indigo-50 dark:bg-indigo-900/30 px-1 py-0.5 rounded">Now</button>
                          )}
                          {record.lunchEnd && (
                            <button onClick={() => handleRecordChange(index, 'lunchEnd', '')} className="text-gray-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400">
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                      <input
                        type="time"
                        value={record.lunchEnd || ''}
                        onChange={(e) => handleRecordChange(index, 'lunchEnd', e.target.value)}
                        className={`text-sm rounded-md shadow-sm border py-1.5 px-2 bg-white dark:bg-slate-800 text-gray-900 dark:text-white ${errors.lunchEnd ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 dark:border-slate-600 focus:ring-indigo-500'}`}
                      />
                      {errors.lunchEnd && <p className="text-[10px] text-red-500 mt-0.5">{errors.lunchEnd}</p>}
                    </div>
                  </div>
                  
                  {/* Footer: Total Hrs & Notes */}
                  <div className="flex gap-3 pt-1">
                    <div className="w-20 flex flex-col">
                      <label className="text-[10px] font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-0.5">Total Hrs</label>
                      <input
                        type="text"
                        value={record.totalHours || ''}
                        onChange={(e) => handleRecordChange(index, 'totalHours', e.target.value)}
                        className={`w-full text-center text-sm font-bold rounded-md shadow-sm py-1.5 px-1 bg-indigo-50/50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 ${errors.totalHours ? 'border-red-500 focus:ring-red-500' : 'border-indigo-200 dark:border-indigo-800/50 focus:ring-indigo-500 dark:focus:ring-indigo-400'}`}
                        placeholder="0.00"
                      />
                      {errors.totalHours && <p className="text-[10px] text-red-500 mt-0.5">{errors.totalHours}</p>}
                    </div>
                    <div className="flex-1 flex flex-col">
                      <label className="text-[10px] font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-0.5">Notes</label>
                      <input
                        type="text"
                        value={record.notes || ''}
                        onChange={(e) => handleRecordChange(index, 'notes', e.target.value)}
                        className="w-full text-sm rounded-md shadow-sm border-gray-300 dark:border-slate-600 focus:ring-indigo-500 focus:border-indigo-500 py-1.5 px-2 bg-gray-50/50 dark:bg-slate-800/30 text-gray-900 dark:text-white"
                        placeholder="Add notes..."
                      />
                    </div>
                  </div>
                </div>
              )})}
            </div>

            {/* Desktop Table View (Visible on Desktop & Print) */}
            <div className="hidden md:block print:block pdf:block overflow-x-auto print:overflow-visible pdf:overflow-visible mb-10 print:mb-4 pdf:mb-4 border border-gray-200 dark:border-slate-700/50 print:border-none pdf:border-none rounded-xl print:rounded-none pdf:rounded-none bg-white/40 dark:bg-slate-800/40 backdrop-blur-md shadow-sm">
              <table className="min-w-full print:w-full pdf:w-full print:table-fixed pdf:table-fixed divide-y divide-gray-200 dark:divide-slate-700/50 print:divide-gray-800 pdf:divide-gray-800 print:border-t pdf:border-t print:border-b pdf:border-b print:border-gray-800 pdf:border-gray-800">
                <thead className="bg-gray-50/50 dark:bg-slate-800/50 print:bg-transparent pdf:bg-transparent">
                  <tr>
                    <th scope="col" className="px-2 py-3 print:px-1 pdf:px-1 print:py-1 pdf:py-1 text-left text-sm print:text-[10px] pdf:text-[10px] font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wider w-40 print:w-[14%] pdf:w-[14%]">Date</th>
                    <th scope="col" className="px-1 py-3 print:px-1 pdf:px-1 print:py-1 pdf:py-1 text-left text-sm print:text-[10px] pdf:text-[10px] font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wider w-[5.5rem] print:w-[12%] pdf:w-[12%]">Time In</th>
                    <th scope="col" className="px-1 py-3 print:px-1 pdf:px-1 print:py-1 pdf:py-1 text-left text-sm print:text-[10px] pdf:text-[10px] font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wider w-[5.5rem] print:w-[12%] pdf:w-[12%]">Lunch Start</th>
                    <th scope="col" className="px-1 py-3 print:px-1 pdf:px-1 print:py-1 pdf:py-1 text-left text-sm print:text-[10px] pdf:text-[10px] font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wider w-[5.5rem] print:w-[12%] pdf:w-[12%]">Lunch End</th>
                    <th scope="col" className="px-1 py-3 print:px-1 pdf:px-1 print:py-1 pdf:py-1 text-left text-sm print:text-[10px] pdf:text-[10px] font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wider w-[5.5rem] print:w-[12%] pdf:w-[12%]">Time Out</th>
                    <th scope="col" className="px-0 py-3 print:px-0 pdf:px-0 print:py-1 pdf:py-1 text-center text-sm print:text-[10px] pdf:text-[10px] font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wider w-20 print:w-[10%] pdf:w-[10%]">Total Hrs</th>
                    <th scope="col" className="px-1 py-3 print:px-1 pdf:px-1 print:py-1 pdf:py-1 text-left text-sm print:text-[10px] pdf:text-[10px] font-semibold text-gray-600 dark:text-slate-300 uppercase tracking-wider print:w-[28%] pdf:w-[28%] w-full">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-slate-700/50 print:divide-gray-800 pdf:divide-gray-800">
                  {records.map((record, index) => {
                    const errors = getErrors(record);
                    return (
                    <tr key={index} className="hover:bg-gray-100/50 dark:hover:bg-slate-800/50 transition-colors group">
                      <td className="px-2 py-2 print:px-1 pdf:px-1 print:py-1 pdf:py-1 align-top bg-gray-50/50 dark:bg-slate-800/30 print:bg-transparent pdf:bg-transparent">
                        <div className="text-sm print:text-[10px] pdf:text-[10px] font-medium text-gray-900 dark:text-white mb-1 ml-1 print:mb-0 pdf:mb-0 print:ml-0 pdf:ml-0">{record.day}</div>
                        <input
                          type="text"
                          value={record.date ? record.date.split('-')[2] : ''}
                          onChange={(e) => {
                            const day = e.target.value;
                            if (record.date) {
                              const parts = record.date.split('-');
                              handleRecordChange(index, 'date', `${parts[0]}-${parts[1]}-${day.padStart(2, '0')}`);
                            } else {
                              const today = new Date();
                              handleRecordChange(index, 'date', `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${day.padStart(2, '0')}`);
                            }
                          }}
                          className="w-16 border-gray-300 dark:border-slate-600 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-xl print:text-[10px] pdf:text-[10px] print:border-none pdf:border-none print:bg-transparent pdf:bg-transparent print:shadow-none pdf:shadow-none print:p-0 pdf:p-0 print:min-w-0 pdf:min-w-0 font-bold py-0 px-2 bg-transparent text-gray-900 dark:text-white text-center"
                        />
                      </td>
                      <td className="px-1 py-2 print:px-1 pdf:px-1 print:py-1 pdf:py-1 align-top">
                        <div className="h-6 print:hidden pdf:hidden flex justify-end items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity focus-within:opacity-100">
                          {!record.timeIn && (
                            <button onClick={() => handleRecordChange(index, 'timeIn', getCurrentTime())} className="text-[9px] font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 uppercase tracking-wider bg-indigo-50 dark:bg-indigo-900/30 px-1 py-0.5 rounded" title="Set to current time">Now</button>
                          )}
                          {record.timeIn && (
                            <button onClick={() => handleRecordChange(index, 'timeIn', '')} className="text-gray-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400" title="Clear">
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                        <input
                          type="time"
                          value={record.timeIn || ''}
                          onChange={(e) => handleRecordChange(index, 'timeIn', e.target.value)}
                          className={`w-full rounded-md shadow-sm text-lg print:text-[11px] pdf:text-[11px] print:border-none pdf:border-none print:bg-transparent pdf:bg-transparent print:shadow-none pdf:shadow-none print:p-0 pdf:p-0 print:min-w-0 pdf:min-w-0 font-bold py-0 px-0 bg-transparent text-gray-900 dark:text-white ${errors.timeIn ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 dark:border-slate-600 focus:ring-indigo-500 focus:border-indigo-500'}`}
                        />
                        {errors.timeIn && <div className="text-[10px] text-red-500 mt-1 print:hidden pdf:hidden">{errors.timeIn}</div>}
                      </td>
                      <td className="px-1 py-2 print:px-1 pdf:px-1 print:py-1 pdf:py-1 align-top">
                        <div className="h-6 print:hidden pdf:hidden flex justify-end items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity focus-within:opacity-100">
                          {!record.lunchStart && (
                            <button onClick={() => handleRecordChange(index, 'lunchStart', getCurrentTime())} className="text-[9px] font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 uppercase tracking-wider bg-indigo-50 dark:bg-indigo-900/30 px-1 py-0.5 rounded" title="Set to current time">Now</button>
                          )}
                          {record.lunchStart && (
                            <button onClick={() => handleRecordChange(index, 'lunchStart', '')} className="text-gray-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400" title="Clear">
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                        <input
                          type="time"
                          value={record.lunchStart || ''}
                          onChange={(e) => handleRecordChange(index, 'lunchStart', e.target.value)}
                          className={`w-full rounded-md shadow-sm text-lg print:text-[11px] pdf:text-[11px] print:border-none pdf:border-none print:bg-transparent pdf:bg-transparent print:shadow-none pdf:shadow-none print:p-0 pdf:p-0 print:min-w-0 pdf:min-w-0 font-bold py-0 px-0 bg-transparent text-gray-900 dark:text-white ${errors.lunchStart ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 dark:border-slate-600 focus:ring-indigo-500 focus:border-indigo-500'}`}
                        />
                        {errors.lunchStart && <div className="text-[10px] text-red-500 mt-1 print:hidden pdf:hidden">{errors.lunchStart}</div>}
                      </td>
                      <td className="px-1 py-2 print:px-1 pdf:px-1 print:py-1 pdf:py-1 align-top">
                        <div className="h-6 print:hidden pdf:hidden flex justify-end items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity focus-within:opacity-100">
                          {!record.lunchEnd && (
                            <button onClick={() => handleRecordChange(index, 'lunchEnd', getCurrentTime())} className="text-[9px] font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 uppercase tracking-wider bg-indigo-50 dark:bg-indigo-900/30 px-1 py-0.5 rounded" title="Set to current time">Now</button>
                          )}
                          {record.lunchEnd && (
                            <button onClick={() => handleRecordChange(index, 'lunchEnd', '')} className="text-gray-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400" title="Clear">
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                        <input
                          type="time"
                          value={record.lunchEnd || ''}
                          onChange={(e) => handleRecordChange(index, 'lunchEnd', e.target.value)}
                          className={`w-full rounded-md shadow-sm text-lg print:text-[11px] pdf:text-[11px] print:border-none pdf:border-none print:bg-transparent pdf:bg-transparent print:shadow-none pdf:shadow-none print:p-0 pdf:p-0 print:min-w-0 pdf:min-w-0 font-bold py-0 px-0 bg-transparent text-gray-900 dark:text-white ${errors.lunchEnd ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 dark:border-slate-600 focus:ring-indigo-500 focus:border-indigo-500'}`}
                        />
                        {errors.lunchEnd && <div className="text-[10px] text-red-500 mt-1 print:hidden pdf:hidden">{errors.lunchEnd}</div>}
                      </td>
                      <td className="px-1 py-2 print:px-1 pdf:px-1 print:py-1 pdf:py-1 align-top">
                        <div className="h-6 print:hidden pdf:hidden flex justify-end items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity focus-within:opacity-100">
                          {!record.timeOut && (
                            <button onClick={() => handleRecordChange(index, 'timeOut', getCurrentTime())} className="text-[9px] font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 uppercase tracking-wider bg-indigo-50 dark:bg-indigo-900/30 px-1 py-0.5 rounded" title="Set to current time">Now</button>
                          )}
                          {record.timeOut && (
                            <button onClick={() => handleRecordChange(index, 'timeOut', '')} className="text-gray-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400" title="Clear">
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                        <input
                          type="time"
                          value={record.timeOut || ''}
                          onChange={(e) => handleRecordChange(index, 'timeOut', e.target.value)}
                          className={`w-full rounded-md shadow-sm text-lg print:text-[11px] pdf:text-[11px] print:border-none pdf:border-none print:bg-transparent pdf:bg-transparent print:shadow-none pdf:shadow-none print:p-0 pdf:p-0 print:min-w-0 pdf:min-w-0 font-bold py-0 px-0 bg-transparent text-gray-900 dark:text-white ${errors.timeOut ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 dark:border-slate-600 focus:ring-indigo-500 focus:border-indigo-500'}`}
                        />
                        {errors.timeOut && <div className="text-[10px] text-red-500 mt-1 print:hidden pdf:hidden">{errors.timeOut}</div>}
                      </td>
                      <td className="px-0 py-2 print:px-0 pdf:px-0 print:py-1 pdf:py-1 text-center align-top">
                        <div className="h-6 print:hidden pdf:hidden"></div>
                        <input
                          type="text"
                          value={record.totalHours || ''}
                          onChange={(e) => handleRecordChange(index, 'totalHours', e.target.value)}
                          className={`w-16 print:w-full pdf:w-full rounded-md shadow-sm text-2xl print:text-[11px] pdf:text-[11px] print:border-none pdf:border-none print:bg-transparent pdf:bg-transparent print:shadow-none pdf:shadow-none print:p-0 pdf:p-0 print:min-w-0 pdf:min-w-0 font-extrabold py-0 px-0 font-mono bg-indigo-50/50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 print:text-gray-900 pdf:text-gray-900 text-center ${errors.totalHours ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 dark:border-slate-600 focus:ring-indigo-500 focus:border-indigo-500'}`}
                          placeholder="0.00"
                        />
                        {errors.totalHours && <div className="text-[10px] text-red-500 mt-1 print:hidden pdf:hidden">{errors.totalHours}</div>}
                      </td>
                      <td className="px-1 py-2 print:px-1 pdf:px-1 print:py-1 pdf:py-1 align-top">
                        <div className="h-6 print:hidden pdf:hidden"></div>
                        <input
                          type="text"
                          value={record.notes || ''}
                          onChange={(e) => handleRecordChange(index, 'notes', e.target.value)}
                          className="w-full border-gray-300 dark:border-slate-600 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-lg print:text-[10px] pdf:text-[10px] print:border-none pdf:border-none print:bg-transparent pdf:bg-transparent print:shadow-none pdf:shadow-none print:p-0 pdf:p-0 print:min-w-0 pdf:min-w-0 font-bold py-0 px-0 bg-transparent text-gray-900 dark:text-white"
                          placeholder="..."
                        />
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>

            {/* Footer Section */}
            <div className="flex flex-col md:flex-row print:flex-row pdf:flex-row justify-between items-end print:items-end pdf:items-end gap-4 print:gap-8 pdf:gap-8">
              <div className="w-full md:w-1/2 print:w-1/2 pdf:w-1/2 space-y-6 print:space-y-4 pdf:space-y-4">
                <div className="space-y-1">
                  <div className="flex justify-between items-end mb-1">
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Employee Signature</label>
                    <button 
                      onClick={() => { sigCanvas.current?.clear(); setSignature(''); }} 
                      className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium print:hidden pdf:hidden"
                    >
                      Clear Signature
                    </button>
                  </div>
                  <div className="border border-gray-300 dark:border-slate-600 print:border-b-2 pdf:border-b-2 print:border-x-0 pdf:border-x-0 print:border-t-0 pdf:border-t-0 print:border-gray-800 pdf:border-gray-800 print:rounded-none pdf:rounded-none rounded-lg bg-white dark:bg-slate-800 overflow-hidden shadow-sm print:shadow-none pdf:shadow-none">
                    <SignatureCanvas 
                      ref={sigCanvas}
                      penColor={isDarkMode ? "white" : "black"}
                      clearOnResize={false}
                      canvasProps={{className: 'w-full h-24 sm:h-32 print:h-16 pdf:h-16 bg-white dark:bg-slate-800'}}
                      onEnd={() => setSignature(sigCanvas.current?.toDataURL() || '')}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Date</label>
                  <input
                    type="date"
                    value={date || ''}
                    onChange={(e) => setDate(e.target.value)}
                    className="block w-full border-0 border-b-2 border-gray-200 dark:border-slate-700 print:border-gray-800 pdf:border-gray-800 focus:border-indigo-600 dark:focus:border-indigo-400 focus:ring-0 px-0 py-2 print:py-0 pdf:py-0 text-base sm:text-lg print:text-sm pdf:text-sm transition-colors bg-transparent text-gray-900 dark:text-white"
                  />
                </div>
              </div>
              
              <div className="w-full md:w-1/3 print:w-1/3 pdf:w-1/3 bg-gray-50/50 dark:bg-slate-800/30 print:bg-transparent pdf:bg-transparent p-4 sm:p-6 print:p-0 pdf:p-0 rounded-xl border border-gray-200 dark:border-slate-700/50 print:border-none pdf:border-none">
                <div className="flex justify-between items-center mb-4 print:mb-2 pdf:mb-2">
                  <span className="text-base sm:text-lg print:text-sm pdf:text-sm font-medium text-gray-700 dark:text-slate-300">Total Hours:</span>
                  <input
                    type="text"
                    value={totalHours || ''}
                    onChange={(e) => setTotalHours(e.target.value)}
                    className={`w-24 sm:w-32 print:w-24 pdf:w-24 text-right text-xl sm:text-2xl print:text-base pdf:text-base font-bold text-indigo-600 dark:text-indigo-400 print:text-gray-900 pdf:text-gray-900 bg-transparent border-b-2 focus:ring-0 px-0 py-1 print:py-0 pdf:py-0 ${totalHours && isNaN(Number(totalHours)) ? 'border-red-500 focus:border-red-500' : 'border-indigo-200 dark:border-indigo-800/50 print:border-gray-800 pdf:border-gray-800 focus:border-indigo-600 dark:focus:border-indigo-400'}`}
                    placeholder="0.00"
                  />
                  {totalHours && isNaN(Number(totalHours)) && (
                    <div className="text-red-500 text-xs mt-1 text-right print:hidden pdf:hidden">Invalid number</div>
                  )}
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Modals */}
        {showClearConfirm && (
          <div className="fixed inset-0 bg-black/50 dark:bg-slate-900/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-xl rounded-2xl shadow-2xl max-w-sm w-full p-6 border border-white/20 dark:border-slate-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Clear Timesheet?</h3>
              <p className="text-gray-600 dark:text-slate-300 mb-6">Are you sure you want to clear all fields? This action cannot be undone.</p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-200 bg-gray-100 dark:bg-slate-700 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmClear}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
                >
                  Clear All
                </button>
              </div>
            </div>
          </div>
        )}

        {showEmailConfirm && (
          <div className="fixed inset-0 bg-black/50 dark:bg-slate-900/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-xl rounded-2xl shadow-2xl max-w-sm w-full p-6 border border-white/20 dark:border-slate-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Send Timesheet?</h3>
              <p className="text-gray-600 dark:text-slate-300 mb-6">Are you sure you want to send this timesheet to {recipientEmail}?</p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowEmailConfirm(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-200 bg-gray-100 dark:bg-slate-700 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmSendEmail}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  Send Email
                </button>
              </div>
            </div>
          </div>
        )}

        {itemToDelete !== null && (
          <div className="fixed inset-0 bg-black/50 dark:bg-slate-900/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-xl rounded-2xl shadow-2xl max-w-sm w-full p-6 border border-white/20 dark:border-slate-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Delete Timesheet?</h3>
              <p className="text-gray-600 dark:text-slate-300 mb-6">Are you sure you want to delete the timesheet for the week of {itemToDelete.week}? This action cannot be undone.</p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setItemToDelete(null)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-200 bg-gray-100 dark:bg-slate-700 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDeleteHistoryItem}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}

        {isSettingsOpen && (
          <div className="fixed inset-0 bg-black/50 dark:bg-slate-900/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-xl rounded-2xl shadow-2xl max-w-md w-full flex flex-col border border-white/20 dark:border-slate-700">
              <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-100 dark:border-slate-700/50">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <Settings className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                  Settings
                </h3>
                <button
                  onClick={() => setIsSettingsOpen(false)}
                  className="p-2 text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-4 sm:p-6 space-y-6">
                <div>
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-4">Shift Configuration</h4>
                  <div className="space-y-4">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <div className="relative">
                        <input 
                          type="checkbox" 
                          className="sr-only" 
                          checked={shiftSettings.enabled}
                          onChange={(e) => {
                            const newSettings = { ...shiftSettings, enabled: e.target.checked };
                            setShiftSettings(newSettings);
                            localStorage.setItem('shift_settings', JSON.stringify(newSettings));
                            if (e.target.checked && Notification.permission === 'default') {
                              Notification.requestPermission();
                            }
                          }}
                        />
                        <div className={`block w-10 h-6 rounded-full transition-colors ${shiftSettings.enabled ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-slate-600'}`}></div>
                        <div className={`absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${shiftSettings.enabled ? 'translate-x-4' : ''}`}></div>
                      </div>
                      <span className="text-sm font-medium text-gray-700 dark:text-slate-300">Enable Shift Notifications</span>
                    </label>
                    
                    <div className={`grid grid-cols-2 gap-4 transition-opacity ${shiftSettings.enabled ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">Start Time</label>
                        <input 
                          type="time" 
                          value={shiftSettings.startTime || ''}
                          onChange={(e) => {
                            const newSettings = { ...shiftSettings, startTime: e.target.value };
                            setShiftSettings(newSettings);
                            localStorage.setItem('shift_settings', JSON.stringify(newSettings));
                          }}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-900 text-gray-900 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">Lunch Start</label>
                        <input 
                          type="time" 
                          value={shiftSettings.lunchStart || ''}
                          onChange={(e) => {
                            const newSettings = { ...shiftSettings, lunchStart: e.target.value };
                            setShiftSettings(newSettings);
                            localStorage.setItem('shift_settings', JSON.stringify(newSettings));
                          }}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-900 text-gray-900 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">Lunch End</label>
                        <input 
                          type="time" 
                          value={shiftSettings.lunchEnd || ''}
                          onChange={(e) => {
                            const newSettings = { ...shiftSettings, lunchEnd: e.target.value };
                            setShiftSettings(newSettings);
                            localStorage.setItem('shift_settings', JSON.stringify(newSettings));
                          }}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-900 text-gray-900 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">End Time</label>
                        <input 
                          type="time" 
                          value={shiftSettings.endTime || ''}
                          onChange={(e) => {
                            const newSettings = { ...shiftSettings, endTime: e.target.value };
                            setShiftSettings(newSettings);
                            localStorage.setItem('shift_settings', JSON.stringify(newSettings));
                          }}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-900 text-gray-900 dark:text-white"
                        />
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="pt-6 border-t border-gray-100 dark:border-slate-700/50">
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-4">Timesheet Period</h4>
                  <div className="flex flex-col gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">Select Period (Default: Bi-weekly)</label>
                      <select
                        value={shiftSettings.period}
                        onChange={(e) => {
                          const newSettings = { ...shiftSettings, period: e.target.value };
                          setShiftSettings(newSettings);
                          localStorage.setItem('shift_settings', JSON.stringify(newSettings));
                          setRecords(generateRecordsForPeriod(e.target.value, weekOf, records));
                        }}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-900 text-gray-900 dark:text-white"
                      >
                        <option value="Weekly">Weekly (7 Days)</option>
                        <option value="Bi-weekly">Bi-weekly (14 Days)</option>
                        <option value="Monthly">Monthly</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="pt-6 border-t border-gray-100 dark:border-slate-700/50">
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-4">General Actions</h4>
                  <div className="flex flex-col gap-3">
                    {user && (
                      <button
                        onClick={() => {
                          setIsSettingsOpen(false);
                          handleLogout();
                        }}
                        className="flex justify-center items-center gap-2 px-4 py-2 text-sm font-medium text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors w-full"
                      >
                        <LogOut className="w-4 h-4" />
                        Logout ({user.email})
                      </button>
                    )}
                    <button
                      onClick={() => setIsDarkMode(!isDarkMode)}
                      className="flex justify-center items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors w-full"
                    >
                      {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                      {isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                    </button>
                    <button
                      onClick={() => {
                        setIsSettingsOpen(false);
                        handleClear();
                      }}
                      className="flex justify-center items-center gap-2 px-4 py-2 text-sm font-medium text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors w-full"
                    >
                      <RefreshCw className="w-4 h-4" />
                      Clear Timesheet Data
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {isHistoryOpen && (
          <div className="fixed inset-0 bg-black/50 dark:bg-slate-900/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-xl rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col border border-white/20 dark:border-slate-700">
              <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-100 dark:border-slate-700/50">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <History className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                  Timesheet History
                </h3>
                <button
                  onClick={() => setIsHistoryOpen(false)}
                  className="p-2 text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-4 sm:p-6 border-b border-gray-100 dark:border-slate-700/50 bg-gray-50/50 dark:bg-slate-800/30">
                <div className="relative">
                  <Search className="w-5 h-5 text-gray-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search by week, name, or day..."
                    value={historySearchTerm}
                    onChange={(e) => setHistorySearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 sm:p-6">
                {filteredHistory.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 dark:text-slate-400">
                    No history found matching your search.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredHistory.map(([week, data]) => (
                      <div
                        key={week}
                        onClick={() => loadHistoryItem(week)}
                        className="group flex items-center justify-between p-4 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl hover:border-indigo-300 dark:hover:border-indigo-500 hover:shadow-sm cursor-pointer transition-all"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-1">
                            <span className="font-medium text-gray-900 dark:text-white">Week of {week}</span>
                            {data.name && (
                              <span className="px-2 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/30 rounded-full">
                                {data.name}
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-gray-500 dark:text-slate-400 flex flex-wrap items-center gap-x-4 gap-y-1">
                            <span>{data.records?.filter((r: any) => r.totalHours).length || 0} days logged</span>
                            <span>Total: {data.records?.reduce((acc: number, r: any) => acc + (parseFloat(r.totalHours) || 0), 0).toFixed(2) || '0.00'} hrs</span>
                            {data.lastModified && (
                              <span className="hidden sm:inline">Last edited: {new Date(data.lastModified).toLocaleDateString()}</span>
                            )}
                          </div>
                          {data.sentLogs && data.sentLogs.length > 0 && (
                            <div className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              Sent {data.sentLogs.length} time{data.sentLogs.length !== 1 ? 's' : ''} (Last: {new Date(data.sentLogs[data.sentLogs.length - 1].date).toLocaleDateString()})
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => attemptDeleteHistoryItem(week, e)}
                            className="p-2 text-gray-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                            title="Delete from history"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <ChevronRight className="w-5 h-5 text-gray-400 dark:text-slate-500 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Auth Modal */}
        {showAuthModal && (
          <div className="fixed inset-0 bg-black/50 dark:bg-slate-900/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-xl rounded-2xl shadow-2xl max-w-sm w-full p-6 border border-white/20 dark:border-slate-700">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Sign In / Register
                </h3>
                <button onClick={() => setShowAuthModal(false)} className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="space-y-4">
                {authError && (
                  <div className="p-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-100 dark:border-red-900/50">
                    {authError}
                  </div>
                )}
                
                <p className="text-sm text-gray-600 dark:text-slate-300">
                  Sign in to save your timesheets securely to the cloud and access them from anywhere.
                </p>
                
                <button
                  onClick={handleAuth}
                  disabled={isAuthenticating}
                  className="w-full flex justify-center items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-70"
                >
                  {isAuthenticating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Sign in with Google
                </button>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-200 dark:border-slate-700"></div>
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-2 text-gray-500 bg-white/90 dark:bg-slate-800/90 backdrop-blur-xl">Or continue with email</span>
                  </div>
                </div>

                <div className="space-y-3">
                  <input
                    type="email"
                    placeholder="Email address"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-900 text-gray-900 dark:text-white placeholder-gray-400"
                  />
                  <input
                    type="password"
                    placeholder="Password"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-900 text-gray-900 dark:text-white placeholder-gray-400"
                  />
                  
                  <div className="flex gap-2">
                    <button
                      onClick={handleEmailSignIn}
                      disabled={isAuthenticating}
                      className="flex-1 flex justify-center items-center px-4 py-2 text-sm font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800/50 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors disabled:opacity-70"
                    >
                      Sign In
                    </button>
                    <button
                      onClick={handleEmailSignUp}
                      disabled={isAuthenticating}
                      className="flex-1 flex justify-center items-center px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-70"
                    >
                      Sign Up
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Toast Notification */}
        <AnimatePresence>
          {showSavedIndicator && lastSaved && (
            <motion.div
              initial={{ opacity: 0, y: 50, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
              className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 bg-gray-900 text-white rounded-lg shadow-xl"
            >
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <span className="text-sm font-medium">Changes saved</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}
