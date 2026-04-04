import React, { useState, useEffect, useRef } from 'react';
import { Mail, Printer, Calculator, RefreshCw, Save, Loader2, History, Search, X, ChevronRight, Trash2, CheckCircle2 } from 'lucide-react';
import SignatureCanvas from 'react-signature-canvas';
import { motion, AnimatePresence } from 'motion/react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

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

const STORAGE_KEY = 'employee_timesheet_data';
const HISTORY_STORAGE_KEY = 'employee_timesheet_history';
const DEFAULT_EMAIL = 'TIMESHEETS@ROYAL-TRANS.COM';

const loadSavedData = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error('Failed to load timesheet data from local storage', e);
  }
  return null;
};

export default function App() {
  const savedData = loadSavedData();
  
  const [companyName, setCompanyName] = useState(savedData?.companyName || 'Royal Transportation');
  const [name, setName] = useState(savedData?.name || '');
  const [weekOf, setWeekOf] = useState(savedData?.weekOf || '');
  const [records, setRecords] = useState<DailyRecord[]>(savedData?.records || initialRecords);
  const [totalHours, setTotalHours] = useState('');
  const [hourlyRate, setHourlyRate] = useState(savedData?.hourlyRate || '');
  const [signature, setSignature] = useState(savedData?.signature || '');
  const [date, setDate] = useState(savedData?.date || '');
  const [recipientEmail, setRecipientEmail] = useState(savedData?.recipientEmail || DEFAULT_EMAIL);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isSending, setIsSending] = useState(false);
  
  // History and Modal states
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historySearchTerm, setHistorySearchTerm] = useState('');
  const [historyData, setHistoryData] = useState<Record<string, any>>({});
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showEmailConfirm, setShowEmailConfirm] = useState(false);
  const [showSavedIndicator, setShowSavedIndicator] = useState(false);

  const sigCanvas = useRef<SignatureCanvas>(null);

  // Load signature into canvas on mount if it's a data URL
  useEffect(() => {
    if (sigCanvas.current && signature && signature.startsWith('data:image')) {
      sigCanvas.current.fromDataURL(signature);
    }
  }, []);

  // Save to local storage whenever data changes
  useEffect(() => {
    const dataToSave = { companyName, name, weekOf, records, signature, date, recipientEmail, hourlyRate };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
    setLastSaved(new Date());
    
    setShowSavedIndicator(true);
    const timer = setTimeout(() => {
      setShowSavedIndicator(false);
    }, 2000);

    // Also save to history if weekOf is set
    if (weekOf) {
      try {
        const historyStr = localStorage.getItem(HISTORY_STORAGE_KEY) || '{}';
        const history = JSON.parse(historyStr);
        history[weekOf] = { ...dataToSave, lastModified: new Date().toISOString() };
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
      } catch (e) {
        console.error('Failed to save to history', e);
      }
    }
    
    return () => clearTimeout(timer);
  }, [companyName, name, weekOf, records, signature, date, recipientEmail, hourlyRate]);

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
      const [year, month, day] = newWeekOf.split('-').map(Number);
      const selectedDate = new Date(year, month - 1, day);
      const dayOfWeek = selectedDate.getDay();
      const sundayDate = new Date(year, month - 1, day - dayOfWeek);
      
      const newRecords = records.map((record, index) => {
        const recordDate = new Date(sundayDate.getFullYear(), sundayDate.getMonth(), sundayDate.getDate() + index);
        const yyyy = recordDate.getFullYear();
        const mm = String(recordDate.getMonth() + 1).padStart(2, '0');
        const dd = String(recordDate.getDate()).padStart(2, '0');
        return { ...record, date: `${yyyy}-${mm}-${dd}` };
      });
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
    setShowEmailConfirm(true);
  };

  const confirmSendEmail = async () => {
    setShowEmailConfirm(false);
    setIsSending(true);
    
    // Wait for React to re-render and remove the modal from the DOM
    setTimeout(async () => {
      try {
        // 1. Generate PDF
        const contentElement = document.getElementById('timesheet-content');
        if (contentElement) {
          // Temporarily hide elements we don't want in the PDF
          const elementsToHide = contentElement.querySelectorAll('.print\\:hidden, .pdf\\:hidden');
          elementsToHide.forEach(el => (el as HTMLElement).style.display = 'none');
          
          // Add pdf-mode class to trigger print-like styles
          contentElement.classList.add('pdf-mode');
          
          const canvas = await html2canvas(contentElement, {
            scale: 2,
            useCORS: true,
            logging: false,
            windowWidth: 800 // Force a specific width to ensure consistent layout
          });
          
          // Restore hidden elements and remove pdf-mode
          contentElement.classList.remove('pdf-mode');
          elementsToHide.forEach(el => (el as HTMLElement).style.display = '');

          const imgData = canvas.toDataURL('image/png');
          const pdf = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4'
          });
          
          const pdfWidth = pdf.internal.pageSize.getWidth();
          const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
          
          pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
          
          // Download the PDF
          const fileName = `Timesheet_${name || 'Employee'}_${weekOf || 'Week'}.pdf`.replace(/\s+/g, '_');
          pdf.save(fileName);
        }

        // 2. Open Email Client
        const subject = encodeURIComponent(`Time Sheet: ${name || 'Employee'} - Week of ${weekOf || 'Unknown'}`);
        
        let bodyText = `Employee Time Sheet\n`;
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
        bodyText += `Total Weekly Hours: ${totalHours}\n`;
        
        const totalWeeklyHoursNum = parseFloat(totalHours) || 0;
        const rate = parseFloat(hourlyRate) || 0;
        if (rate > 0 && totalWeeklyHoursNum > 0) {
          const regularHours = Math.min(totalWeeklyHoursNum, 40);
          const overtimeHours = Math.max(0, totalWeeklyHoursNum - 40);
          const regularPay = regularHours * rate;
          const overtimePay = overtimeHours * (rate * 1.5);
          const totalPay = regularPay + overtimePay;
          
          bodyText += `Hourly Rate: $${rate.toFixed(2)}\n`;
          bodyText += `Regular Hours: ${regularHours.toFixed(2)}h ($${regularPay.toFixed(2)})\n`;
          if (overtimeHours > 0) {
            bodyText += `Overtime Hours: ${overtimeHours.toFixed(2)}h ($${overtimePay.toFixed(2)})\n`;
          }
          bodyText += `Total Pay: $${totalPay.toFixed(2)}\n`;
        }
        bodyText += `\n`;
        
        bodyText += `Employee Signature: ${signature ? '[Electronically Signed]' : 'Not Signed'}\n`;
        bodyText += `Date: ${date}\n`;
        
        const body = encodeURIComponent(bodyText);
        window.location.href = `mailto:${recipientEmail}?subject=${subject}&body=${body}`;
        
      } catch (error) {
        console.error('Error generating PDF or sending email:', error);
        alert('There was an error generating the PDF. Please try again.');
      } finally {
        setIsSending(false);
      }
    }, 100);
  };

  const handlePrint = () => {
    window.print();
  };

  const handleClear = () => {
    setShowClearConfirm(true);
  };

  const confirmClear = () => {
    setName('');
    setWeekOf('');
    setRecords(initialRecords);
    setTotalHours('');
    setHourlyRate('');
    setSignature('');
    sigCanvas.current?.clear();
    setDate('');
    setRecipientEmail(DEFAULT_EMAIL);
    setShowClearConfirm(false);
  };

  const openHistory = () => {
    try {
      const historyStr = localStorage.getItem(HISTORY_STORAGE_KEY) || '{}';
      setHistoryData(JSON.parse(historyStr));
    } catch (e) {
      console.error('Failed to load history', e);
    }
    setIsHistoryOpen(true);
  };

  const loadHistoryItem = (week: string) => {
    const data = historyData[week];
    if (data) {
      setName(data.name || '');
      setWeekOf(data.weekOf || '');
      setRecords(data.records || initialRecords);
      setSignature(data.signature || '');
      setDate(data.date || '');
      setRecipientEmail(data.recipientEmail || DEFAULT_EMAIL);
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

  const deleteHistoryItem = (week: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const historyStr = localStorage.getItem(HISTORY_STORAGE_KEY) || '{}';
      const history = JSON.parse(historyStr);
      delete history[week];
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
      setHistoryData(history);
    } catch (err) {
      console.error('Failed to delete history item', err);
    }
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
  const regularHours = Math.min(totalWeeklyHoursNum, 40);
  const overtimeHours = Math.max(0, totalWeeklyHoursNum - 40);
  const rate = parseFloat(hourlyRate) || 0;
  const regularPay = regularHours * rate;
  const overtimePay = overtimeHours * (rate * 1.5);
  const totalPay = regularPay + overtimePay;

  return (
    <div className="min-h-screen bg-gray-50 py-4 sm:py-8 px-2 sm:px-6 lg:px-8 print:bg-white pdf:bg-white print:py-0 pdf:py-0 print:px-0 pdf:px-0">
      <div id="timesheet-content" className="max-w-5xl print:max-w-full pdf:max-w-full mx-auto space-y-4 sm:space-y-6">
        
        {/* Header Actions - Hidden when printing */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-4 rounded-xl shadow-sm border border-gray-100 print:hidden pdf:hidden">
          <div className="flex items-center gap-3 text-indigo-600">
            <div className="bg-indigo-100 p-2 rounded-lg">
              <Calculator className="w-6 h-6" />
            </div>
            <div>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="text-sm sm:text-base font-bold text-indigo-600 uppercase tracking-wider bg-transparent border-0 border-b border-transparent hover:border-indigo-200 focus:border-indigo-600 focus:ring-0 p-0 m-0 w-full sm:w-64"
                placeholder="Company Name"
              />
              <h1 className="text-xl font-semibold text-gray-900 leading-tight">Time Sheet Manager</h1>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row w-full md:w-auto items-stretch sm:items-center gap-3">
            {lastSaved && (
              <div className="text-xs text-gray-400 flex items-center justify-center sm:justify-start gap-1 sm:mr-2">
                <Save className="w-3 h-3" />
                Last saved {lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
            <div className="flex flex-wrap gap-2 w-full sm:w-auto">
              <button
                onClick={openHistory}
                className="flex-1 sm:flex-none flex justify-center items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <History className="w-4 h-4" />
                History
              </button>
              <button
                onClick={handleClear}
                className="flex-1 sm:flex-none flex justify-center items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Clear
              </button>
              <button
                onClick={handlePrint}
                className="flex-1 sm:flex-none flex justify-center items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <Printer className="w-4 h-4" />
                Print
              </button>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <input
                type="email"
                placeholder="Manager's Email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                className="px-0 py-0.5 text-xl font-bold border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 w-full sm:w-56"
              />
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
          </div>
        </div>

        {/* Main Form Document */}
        <div className="bg-white shadow-xl rounded-2xl overflow-hidden border border-gray-200 print:shadow-none pdf:shadow-none print:border-none pdf:border-none print:rounded-none pdf:rounded-none">
          <div className="p-4 sm:p-8 md:p-12 print:p-0 pdf:p-0">
            
            {/* Document Header */}
            <div className="text-center mb-8 sm:mb-10 print:mb-4 pdf:mb-4">
              <h2 className="text-2xl sm:text-3xl print:text-xl pdf:text-xl font-bold text-gray-900 tracking-tight">Employee Time Sheet</h2>
            </div>

            {/* Employee Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 print:grid-cols-2 pdf:grid-cols-2 gap-4 sm:gap-6 mb-8 sm:mb-10 print:mb-4 pdf:mb-4">
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={handleNameChange}
                  className="block w-full border-0 border-b-2 border-gray-200 focus:border-indigo-600 focus:ring-0 px-0 py-0.5 text-xl sm:text-2xl print:text-lg pdf:text-lg print:border-none pdf:border-none print:p-0 pdf:p-0 font-bold transition-colors bg-transparent"
                  placeholder="John Doe"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">Week of</label>
                <input
                  type="date"
                  value={weekOf}
                  onChange={handleWeekOfChange}
                  className="block w-full border-0 border-b-2 border-gray-200 focus:border-indigo-600 focus:ring-0 px-0 py-0.5 text-xl sm:text-2xl print:text-lg pdf:text-lg print:border-none pdf:border-none print:p-0 pdf:p-0 font-bold transition-colors bg-transparent"
                />
              </div>
            </div>

            {/* Mobile Cards View (Hidden on Desktop & Print) */}
            <div className="block md:hidden print:hidden pdf:hidden space-y-6 mb-8">
              {records.map((record, index) => {
                const errors = getErrors(record);
                return (
                <div key={record.day} className="bg-gray-50 p-4 rounded-xl border border-gray-200 shadow-sm space-y-4">
                  <h3 className="font-bold text-lg text-gray-900 border-b border-gray-200 pb-2">{record.day}</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="col-span-1 sm:col-span-2">
                      <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
                      <input
                        type="date"
                        value={record.date}
                        onChange={(e) => handleRecordChange(index, 'date', e.target.value)}
                        className="w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-xl font-bold py-0.5 px-0 bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Time In</label>
                      <input
                        type="time"
                        value={record.timeIn}
                        onChange={(e) => handleRecordChange(index, 'timeIn', e.target.value)}
                        className={`w-full rounded-md shadow-sm text-xl font-bold py-0.5 px-0 bg-white ${errors.timeIn ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'}`}
                      />
                      {errors.timeIn && <p className="text-[10px] text-red-500 mt-1">{errors.timeIn}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Time Out</label>
                      <input
                        type="time"
                        value={record.timeOut}
                        onChange={(e) => handleRecordChange(index, 'timeOut', e.target.value)}
                        className={`w-full rounded-md shadow-sm text-xl font-bold py-0.5 px-0 bg-white ${errors.timeOut ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'}`}
                      />
                      {errors.timeOut && <p className="text-[10px] text-red-500 mt-1">{errors.timeOut}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Lunch Start</label>
                      <input
                        type="time"
                        value={record.lunchStart}
                        onChange={(e) => handleRecordChange(index, 'lunchStart', e.target.value)}
                        className={`w-full rounded-md shadow-sm text-xl font-bold py-0.5 px-0 bg-white ${errors.lunchStart ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'}`}
                      />
                      {errors.lunchStart && <p className="text-[10px] text-red-500 mt-1">{errors.lunchStart}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Lunch End</label>
                      <input
                        type="time"
                        value={record.lunchEnd}
                        onChange={(e) => handleRecordChange(index, 'lunchEnd', e.target.value)}
                        className={`w-full rounded-md shadow-sm text-xl font-bold py-0.5 px-0 bg-white ${errors.lunchEnd ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'}`}
                      />
                      {errors.lunchEnd && <p className="text-[10px] text-red-500 mt-1">{errors.lunchEnd}</p>}
                    </div>
                    <div className="col-span-1 sm:col-span-2 flex flex-col sm:flex-row gap-2">
                      <div className="w-full sm:w-fit">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Total Hrs</label>
                        <input
                          type="text"
                          value={record.totalHours}
                          onChange={(e) => handleRecordChange(index, 'totalHours', e.target.value)}
                          className={`w-full sm:w-16 text-center rounded-md shadow-sm text-xl font-bold py-0.5 px-0 font-mono bg-gray-100 ${errors.totalHours ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'}`}
                          placeholder="0.00"
                        />
                        {errors.totalHours && <p className="text-[10px] text-red-500 mt-1">{errors.totalHours}</p>}
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
                        <input
                          type="text"
                          value={record.notes}
                          onChange={(e) => handleRecordChange(index, 'notes', e.target.value)}
                          className="w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-xl font-bold py-0.5 px-0 bg-white"
                          placeholder="..."
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )})}
            </div>

            {/* Desktop Table View (Visible on Desktop & Print) */}
            <div className="hidden md:block print:block pdf:block overflow-x-auto print:overflow-visible pdf:overflow-visible mb-10 print:mb-4 pdf:mb-4 border border-gray-200 print:border-none pdf:border-none rounded-xl print:rounded-none pdf:rounded-none">
              <table className="min-w-full print:w-full pdf:w-full print:table-fixed pdf:table-fixed divide-y divide-gray-200 print:divide-gray-800 pdf:divide-gray-800 print:border-t pdf:border-t print:border-b pdf:border-b print:border-gray-800 pdf:border-gray-800">
                <thead className="bg-gray-50 print:bg-transparent pdf:bg-transparent">
                  <tr>
                    <th scope="col" className="px-2 py-3 print:px-1 pdf:px-1 print:py-1 pdf:py-1 text-left text-sm print:text-[10px] pdf:text-[10px] font-semibold text-gray-600 uppercase tracking-wider w-40 print:w-[14%] pdf:w-[14%]">Date</th>
                    <th scope="col" className="px-2 py-3 print:px-1 pdf:px-1 print:py-1 pdf:py-1 text-left text-sm print:text-[10px] pdf:text-[10px] font-semibold text-gray-600 uppercase tracking-wider w-24 print:w-[12%] pdf:w-[12%]">Time In</th>
                    <th scope="col" className="px-2 py-3 print:px-1 pdf:px-1 print:py-1 pdf:py-1 text-left text-sm print:text-[10px] pdf:text-[10px] font-semibold text-gray-600 uppercase tracking-wider w-24 print:w-[12%] pdf:w-[12%]">Lunch Start</th>
                    <th scope="col" className="px-2 py-3 print:px-1 pdf:px-1 print:py-1 pdf:py-1 text-left text-sm print:text-[10px] pdf:text-[10px] font-semibold text-gray-600 uppercase tracking-wider w-24 print:w-[12%] pdf:w-[12%]">Lunch End</th>
                    <th scope="col" className="px-2 py-3 print:px-1 pdf:px-1 print:py-1 pdf:py-1 text-left text-sm print:text-[10px] pdf:text-[10px] font-semibold text-gray-600 uppercase tracking-wider w-24 print:w-[12%] pdf:w-[12%]">Time Out</th>
                    <th scope="col" className="px-0 py-3 print:px-0 pdf:px-0 print:py-1 pdf:py-1 text-center text-sm print:text-[10px] pdf:text-[10px] font-semibold text-gray-600 uppercase tracking-wider w-20 print:w-[10%] pdf:w-[10%]">Total Hrs</th>
                    <th scope="col" className="px-2 py-3 print:px-1 pdf:px-1 print:py-1 pdf:py-1 text-left text-sm print:text-[10px] pdf:text-[10px] font-semibold text-gray-600 uppercase tracking-wider print:w-[28%] pdf:w-[28%]">Notes</th>
                  </tr>
                </thead>
                <tbody className="bg-white print:bg-transparent pdf:bg-transparent divide-y divide-gray-200 print:divide-gray-800 pdf:divide-gray-800">
                  {records.map((record, index) => {
                    const errors = getErrors(record);
                    return (
                    <tr key={record.day} className="hover:bg-gray-100 transition-colors">
                      <td className="px-2 py-2 print:px-1 pdf:px-1 print:py-1 pdf:py-1 align-top bg-gray-50 print:bg-transparent pdf:bg-transparent">
                        <div className="text-sm print:text-[10px] pdf:text-[10px] font-medium text-gray-900 mb-1 ml-1 print:mb-0 pdf:mb-0 print:ml-0 pdf:ml-0">{record.day}</div>
                        <input
                          type="date"
                          value={record.date}
                          onChange={(e) => handleRecordChange(index, 'date', e.target.value)}
                          className="w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-xl print:text-[10px] pdf:text-[10px] print:border-none pdf:border-none print:bg-transparent pdf:bg-transparent print:shadow-none pdf:shadow-none print:p-0 pdf:p-0 print:min-w-0 pdf:min-w-0 font-bold py-0 px-0"
                        />
                      </td>
                      <td className="px-2 py-2 print:px-1 pdf:px-1 print:py-1 pdf:py-1 align-top">
                        <div className="h-6 print:hidden pdf:hidden"></div>
                        <input
                          type="time"
                          value={record.timeIn}
                          onChange={(e) => handleRecordChange(index, 'timeIn', e.target.value)}
                          className={`w-full rounded-md shadow-sm text-xl print:text-[11px] pdf:text-[11px] print:border-none pdf:border-none print:bg-transparent pdf:bg-transparent print:shadow-none pdf:shadow-none print:p-0 pdf:p-0 print:min-w-0 pdf:min-w-0 font-bold py-0 px-0 ${errors.timeIn ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'}`}
                        />
                        {errors.timeIn && <div className="text-[10px] text-red-500 mt-1 print:hidden pdf:hidden">{errors.timeIn}</div>}
                      </td>
                      <td className="px-2 py-2 print:px-1 pdf:px-1 print:py-1 pdf:py-1 align-top">
                        <div className="h-6 print:hidden pdf:hidden"></div>
                        <input
                          type="time"
                          value={record.lunchStart}
                          onChange={(e) => handleRecordChange(index, 'lunchStart', e.target.value)}
                          className={`w-full rounded-md shadow-sm text-xl print:text-[11px] pdf:text-[11px] print:border-none pdf:border-none print:bg-transparent pdf:bg-transparent print:shadow-none pdf:shadow-none print:p-0 pdf:p-0 print:min-w-0 pdf:min-w-0 font-bold py-0 px-0 ${errors.lunchStart ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'}`}
                        />
                        {errors.lunchStart && <div className="text-[10px] text-red-500 mt-1 print:hidden pdf:hidden">{errors.lunchStart}</div>}
                      </td>
                      <td className="px-2 py-2 print:px-1 pdf:px-1 print:py-1 pdf:py-1 align-top">
                        <div className="h-6 print:hidden pdf:hidden"></div>
                        <input
                          type="time"
                          value={record.lunchEnd}
                          onChange={(e) => handleRecordChange(index, 'lunchEnd', e.target.value)}
                          className={`w-full rounded-md shadow-sm text-xl print:text-[11px] pdf:text-[11px] print:border-none pdf:border-none print:bg-transparent pdf:bg-transparent print:shadow-none pdf:shadow-none print:p-0 pdf:p-0 print:min-w-0 pdf:min-w-0 font-bold py-0 px-0 ${errors.lunchEnd ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'}`}
                        />
                        {errors.lunchEnd && <div className="text-[10px] text-red-500 mt-1 print:hidden pdf:hidden">{errors.lunchEnd}</div>}
                      </td>
                      <td className="px-2 py-2 print:px-1 pdf:px-1 print:py-1 pdf:py-1 align-top">
                        <div className="h-6 print:hidden pdf:hidden"></div>
                        <input
                          type="time"
                          value={record.timeOut}
                          onChange={(e) => handleRecordChange(index, 'timeOut', e.target.value)}
                          className={`w-full rounded-md shadow-sm text-xl print:text-[11px] pdf:text-[11px] print:border-none pdf:border-none print:bg-transparent pdf:bg-transparent print:shadow-none pdf:shadow-none print:p-0 pdf:p-0 print:min-w-0 pdf:min-w-0 font-bold py-0 px-0 ${errors.timeOut ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'}`}
                        />
                        {errors.timeOut && <div className="text-[10px] text-red-500 mt-1 print:hidden pdf:hidden">{errors.timeOut}</div>}
                      </td>
                      <td className="px-0 py-2 print:px-0 pdf:px-0 print:py-1 pdf:py-1 text-center align-top">
                        <div className="h-6 print:hidden pdf:hidden"></div>
                        <input
                          type="text"
                          value={record.totalHours}
                          onChange={(e) => handleRecordChange(index, 'totalHours', e.target.value)}
                          className={`w-16 print:w-full pdf:w-full rounded-md shadow-sm text-2xl print:text-[11px] pdf:text-[11px] print:border-none pdf:border-none print:bg-transparent pdf:bg-transparent print:shadow-none pdf:shadow-none print:p-0 pdf:p-0 print:min-w-0 pdf:min-w-0 font-extrabold py-0 px-0 font-mono bg-indigo-50 text-indigo-700 print:text-gray-900 pdf:text-gray-900 text-center ${errors.totalHours ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'}`}
                          placeholder="0.00"
                        />
                        {errors.totalHours && <div className="text-[10px] text-red-500 mt-1 print:hidden pdf:hidden">{errors.totalHours}</div>}
                      </td>
                      <td className="px-2 py-2 print:px-1 pdf:px-1 print:py-1 pdf:py-1 align-top">
                        <div className="h-6 print:hidden pdf:hidden"></div>
                        <input
                          type="text"
                          value={record.notes}
                          onChange={(e) => handleRecordChange(index, 'notes', e.target.value)}
                          className="w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-xl print:text-[10px] pdf:text-[10px] print:border-none pdf:border-none print:bg-transparent pdf:bg-transparent print:shadow-none pdf:shadow-none print:p-0 pdf:p-0 print:min-w-0 pdf:min-w-0 font-bold py-0 px-0"
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
                    <label className="block text-sm font-medium text-gray-700">Employee Signature</label>
                    <button 
                      onClick={() => { sigCanvas.current?.clear(); setSignature(''); }} 
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-medium print:hidden pdf:hidden"
                    >
                      Clear Signature
                    </button>
                  </div>
                  <div className="border border-gray-300 print:border-b-2 pdf:border-b-2 print:border-x-0 pdf:border-x-0 print:border-t-0 pdf:border-t-0 print:border-gray-800 pdf:border-gray-800 print:rounded-none pdf:rounded-none rounded-lg bg-white overflow-hidden shadow-sm print:shadow-none pdf:shadow-none">
                    <SignatureCanvas 
                      ref={sigCanvas}
                      penColor="black"
                      clearOnResize={false}
                      canvasProps={{className: 'w-full h-24 sm:h-32 print:h-16 pdf:h-16 bg-white'}}
                      onEnd={() => setSignature(sigCanvas.current?.toDataURL() || '')}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="block text-sm font-medium text-gray-700">Date</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="block w-full border-0 border-b-2 border-gray-200 print:border-gray-800 pdf:border-gray-800 focus:border-indigo-600 focus:ring-0 px-0 py-2 print:py-0 pdf:py-0 text-base sm:text-lg print:text-sm pdf:text-sm transition-colors bg-transparent"
                  />
                </div>
              </div>
              
              <div className="w-full md:w-1/3 print:w-1/3 pdf:w-1/3 bg-gray-50 print:bg-transparent pdf:bg-transparent p-4 sm:p-6 print:p-0 pdf:p-0 rounded-xl border border-gray-200 print:border-none pdf:border-none">
                <div className="flex justify-between items-center mb-4 print:mb-2 pdf:mb-2">
                  <span className="text-base sm:text-lg print:text-sm pdf:text-sm font-medium text-gray-700">Hourly Rate:</span>
                  <div className="relative">
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 text-gray-500 font-bold print:text-sm pdf:text-sm">$</span>
                    <input
                      type="number"
                      value={hourlyRate}
                      onChange={(e) => setHourlyRate(e.target.value)}
                      className="w-24 sm:w-32 print:w-24 pdf:w-24 text-right text-lg sm:text-xl print:text-sm pdf:text-sm font-bold text-gray-800 bg-transparent border-b-2 border-gray-300 print:border-gray-800 pdf:border-gray-800 focus:border-indigo-600 focus:ring-0 px-0 py-1 print:py-0 pdf:py-0 pl-4"
                      placeholder="0.00"
                      min="0"
                      step="0.01"
                    />
                  </div>
                </div>
                <div className="flex justify-between items-center mb-4 print:mb-2 pdf:mb-2">
                  <span className="text-base sm:text-lg print:text-sm pdf:text-sm font-medium text-gray-700">Total Hours:</span>
                  <input
                    type="text"
                    value={totalHours}
                    onChange={(e) => setTotalHours(e.target.value)}
                    className={`w-24 sm:w-32 print:w-24 pdf:w-24 text-right text-xl sm:text-2xl print:text-base pdf:text-base font-bold text-indigo-600 print:text-gray-900 pdf:text-gray-900 bg-transparent border-b-2 focus:ring-0 px-0 py-1 print:py-0 pdf:py-0 ${totalHours && isNaN(Number(totalHours)) ? 'border-red-500 focus:border-red-500' : 'border-indigo-200 print:border-gray-800 pdf:border-gray-800 focus:border-indigo-600'}`}
                    placeholder="0.00"
                  />
                  {totalHours && isNaN(Number(totalHours)) && (
                    <div className="text-red-500 text-xs mt-1 text-right print:hidden pdf:hidden">Invalid number</div>
                  )}
                </div>
                
                {hourlyRate && !isNaN(Number(hourlyRate)) && totalWeeklyHoursNum > 0 && (
                  <div className="mt-4 pt-4 border-t border-gray-200 print:border-gray-800 pdf:border-gray-800 space-y-2 print:space-y-1 pdf:space-y-1">
                    <div className="flex justify-between items-center text-sm print:text-xs pdf:text-xs text-gray-600 print:text-gray-800 pdf:text-gray-800">
                      <span>Regular ({regularHours.toFixed(2)}h):</span>
                      <span>${regularPay.toFixed(2)}</span>
                    </div>
                    {overtimeHours > 0 && (
                      <div className="flex justify-between items-center text-sm print:text-xs pdf:text-xs text-amber-600 print:text-gray-800 pdf:text-gray-800 font-medium">
                        <span>Overtime ({overtimeHours.toFixed(2)}h @ 1.5x):</span>
                        <span>${overtimePay.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center text-lg print:text-base pdf:text-base font-bold text-gray-900 pt-2 border-t border-gray-200 print:border-gray-800 pdf:border-gray-800">
                      <span>Total Pay:</span>
                      <span>${totalPay.toFixed(2)}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>

        {/* Modals */}
        {showClearConfirm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Clear Timesheet?</h3>
              <p className="text-gray-600 mb-6">Are you sure you want to clear all fields? This action cannot be undone.</p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
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
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Send Timesheet?</h3>
              <p className="text-gray-600 mb-6">Are you sure you want to send this timesheet to {recipientEmail}?</p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowEmailConfirm(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
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

        {isHistoryOpen && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-100">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <History className="w-5 h-5 text-indigo-600" />
                  Timesheet History
                </h3>
                <button
                  onClick={() => setIsHistoryOpen(false)}
                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-4 sm:p-6 border-b border-gray-100 bg-gray-50">
                <div className="relative">
                  <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search by week, name, or day..."
                    value={historySearchTerm}
                    onChange={(e) => setHistorySearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 sm:p-6">
                {filteredHistory.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    No history found matching your search.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredHistory.map(([week, data]) => (
                      <div
                        key={week}
                        onClick={() => loadHistoryItem(week)}
                        className="group flex items-center justify-between p-4 bg-white border border-gray-200 rounded-xl hover:border-indigo-300 hover:shadow-sm cursor-pointer transition-all"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-1">
                            <span className="font-medium text-gray-900">Week of {week}</span>
                            {data.name && (
                              <span className="px-2 py-0.5 text-xs font-medium text-indigo-700 bg-indigo-50 rounded-full">
                                {data.name}
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-gray-500 flex items-center gap-4">
                            <span>{data.records?.filter((r: any) => r.totalHours).length || 0} days logged</span>
                            <span>Total: {data.records?.reduce((acc: number, r: any) => acc + (parseFloat(r.totalHours) || 0), 0).toFixed(2) || '0.00'} hrs</span>
                            {data.lastModified && (
                              <span className="hidden sm:inline">Last edited: {new Date(data.lastModified).toLocaleDateString()}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => deleteHistoryItem(week, e)}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                            title="Delete from history"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-indigo-600 transition-colors" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
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
    </div>
  );
}
