import React, { useState, useEffect, useRef } from 'react';
import { Mail, Printer, Calculator, RefreshCw, Save, Loader2, History, Search, X, ChevronRight, Trash2 } from 'lucide-react';
import SignatureCanvas from 'react-signature-canvas';

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
  
  const [name, setName] = useState(savedData?.name || '');
  const [weekOf, setWeekOf] = useState(savedData?.weekOf || '');
  const [records, setRecords] = useState<DailyRecord[]>(savedData?.records || initialRecords);
  const [totalHours, setTotalHours] = useState('');
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

  const sigCanvas = useRef<SignatureCanvas>(null);

  // Load signature into canvas on mount if it's a data URL
  useEffect(() => {
    if (sigCanvas.current && signature && signature.startsWith('data:image')) {
      sigCanvas.current.fromDataURL(signature);
    }
  }, []);

  // Save to local storage whenever data changes
  useEffect(() => {
    const dataToSave = { name, weekOf, records, signature, date, recipientEmail };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
    setLastSaved(new Date());

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
  }, [name, weekOf, records, signature, date, recipientEmail]);

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
    
    if (record.timeIn && !timeRegex.test(record.timeIn)) errs.timeIn = "Invalid format (HH:MM)";
    if (record.lunchStart && !timeRegex.test(record.lunchStart)) errs.lunchStart = "Invalid format (HH:MM)";
    if (record.lunchEnd && !timeRegex.test(record.lunchEnd)) errs.lunchEnd = "Invalid format (HH:MM)";
    if (record.timeOut && !timeRegex.test(record.timeOut)) errs.timeOut = "Invalid format (HH:MM)";
    if (record.totalHours && isNaN(Number(record.totalHours))) errs.totalHours = "Must be a number";
    
    return errs;
  };

  const handleRecordChange = (index: number, field: keyof DailyRecord, value: string) => {
    const newRecords = [...records];
    newRecords[index] = { ...newRecords[index], [field]: value };
    setRecords(newRecords);
  };

  const handleSendEmail = () => {
    setIsSending(true);
    
    // Simulate a brief loading state for visual feedback
    setTimeout(() => {
      const subject = encodeURIComponent(`Time Sheet: ${name || 'Employee'} - Week of ${weekOf || 'Unknown'}`);
      
      let bodyText = `Employee Time Sheet\n`;
      bodyText += `===================\n\n`;
      bodyText += `Name: ${name}\n`;
      bodyText += `Week of: ${weekOf}\n\n`;
      
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
      
      window.location.href = `mailto:${recipientEmail}?subject=${subject}&body=${body}`;
      setIsSending(false);
    }, 800);
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

  return (
    <div className="min-h-screen bg-gray-50 py-4 sm:py-8 px-2 sm:px-6 lg:px-8 print:bg-white print:py-0 print:px-0">
      <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6">
        
        {/* Header Actions - Hidden when printing */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-4 rounded-xl shadow-sm border border-gray-100 print:hidden">
          <div className="flex items-center gap-3 text-indigo-600">
            <div className="bg-indigo-100 p-2 rounded-lg">
              <Calculator className="w-6 h-6" />
            </div>
            <div>
              <div className="text-sm sm:text-base font-bold text-indigo-600 uppercase tracking-wider">Royal Transportation</div>
              <h1 className="text-xl font-semibold text-gray-900 leading-tight">Time Sheet Manager</h1>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row w-full md:w-auto items-stretch sm:items-center gap-3">
            {lastSaved && (
              <div className="text-xs text-gray-500 flex items-center justify-center sm:justify-start gap-1 sm:mr-2">
                <Save className="w-3 h-3" />
                Saved {lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
                onClick={handleSendEmail}
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
        <div className="bg-white shadow-xl rounded-2xl overflow-hidden border border-gray-200 print:shadow-none print:border-none print:rounded-none">
          <div className="p-4 sm:p-8 md:p-12">
            
            {/* Document Header */}
            <div className="text-center mb-8 sm:mb-10">
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">Employee Time Sheet</h2>
            </div>

            {/* Employee Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 mb-8 sm:mb-10">
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={handleNameChange}
                  className="block w-full border-0 border-b-2 border-gray-200 focus:border-indigo-600 focus:ring-0 px-0 py-0.5 text-xl sm:text-2xl font-bold transition-colors bg-transparent"
                  placeholder="John Doe"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">Week of</label>
                <input
                  type="date"
                  value={weekOf}
                  onChange={handleWeekOfChange}
                  className="block w-full border-0 border-b-2 border-gray-200 focus:border-indigo-600 focus:ring-0 px-0 py-0.5 text-xl sm:text-2xl font-bold transition-colors bg-transparent"
                />
              </div>
            </div>

            {/* Mobile Cards View (Hidden on Desktop & Print) */}
            <div className="block md:hidden print:hidden space-y-6 mb-8">
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
            <div className="hidden md:block print:block overflow-x-auto mb-10 border border-gray-200 rounded-xl">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-2 py-3 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider w-40">Date</th>
                    <th scope="col" className="px-2 py-3 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider w-24">Time In</th>
                    <th scope="col" className="px-2 py-3 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider w-24">Lunch Start</th>
                    <th scope="col" className="px-2 py-3 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider w-24">Lunch End</th>
                    <th scope="col" className="px-2 py-3 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider w-24">Time Out</th>
                    <th scope="col" className="px-0 py-3 text-center text-sm font-semibold text-gray-600 uppercase tracking-wider w-20">Total Hrs</th>
                    <th scope="col" className="px-2 py-3 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">Notes</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {records.map((record, index) => {
                    const errors = getErrors(record);
                    return (
                    <tr key={record.day} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-2 py-2 align-top bg-gray-50/30">
                        <div className="text-sm font-medium text-gray-900 mb-1 ml-1">{record.day}</div>
                        <input
                          type="date"
                          value={record.date}
                          onChange={(e) => handleRecordChange(index, 'date', e.target.value)}
                          className="w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-xl font-bold py-0 px-0"
                        />
                      </td>
                      <td className="px-2 py-2 align-top">
                        <div className="h-6"></div>
                        <input
                          type="time"
                          value={record.timeIn}
                          onChange={(e) => handleRecordChange(index, 'timeIn', e.target.value)}
                          className={`w-full rounded-md shadow-sm text-xl font-bold py-0 px-0 ${errors.timeIn ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'}`}
                        />
                        {errors.timeIn && <div className="text-[10px] text-red-500 mt-1">{errors.timeIn}</div>}
                      </td>
                      <td className="px-2 py-2 align-top">
                        <div className="h-6"></div>
                        <input
                          type="time"
                          value={record.lunchStart}
                          onChange={(e) => handleRecordChange(index, 'lunchStart', e.target.value)}
                          className={`w-full rounded-md shadow-sm text-xl font-bold py-0 px-0 ${errors.lunchStart ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'}`}
                        />
                        {errors.lunchStart && <div className="text-[10px] text-red-500 mt-1">{errors.lunchStart}</div>}
                      </td>
                      <td className="px-2 py-2 align-top">
                        <div className="h-6"></div>
                        <input
                          type="time"
                          value={record.lunchEnd}
                          onChange={(e) => handleRecordChange(index, 'lunchEnd', e.target.value)}
                          className={`w-full rounded-md shadow-sm text-xl font-bold py-0 px-0 ${errors.lunchEnd ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'}`}
                        />
                        {errors.lunchEnd && <div className="text-[10px] text-red-500 mt-1">{errors.lunchEnd}</div>}
                      </td>
                      <td className="px-2 py-2 align-top">
                        <div className="h-6"></div>
                        <input
                          type="time"
                          value={record.timeOut}
                          onChange={(e) => handleRecordChange(index, 'timeOut', e.target.value)}
                          className={`w-full rounded-md shadow-sm text-xl font-bold py-0 px-0 ${errors.timeOut ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'}`}
                        />
                        {errors.timeOut && <div className="text-[10px] text-red-500 mt-1">{errors.timeOut}</div>}
                      </td>
                      <td className="px-0 py-2 text-center align-top">
                        <div className="h-6"></div>
                        <input
                          type="text"
                          value={record.totalHours}
                          onChange={(e) => handleRecordChange(index, 'totalHours', e.target.value)}
                          className={`w-16 rounded-md shadow-sm text-2xl font-extrabold py-0 px-0 font-mono bg-indigo-50 text-indigo-700 text-center ${errors.totalHours ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'}`}
                          placeholder="0.00"
                        />
                        {errors.totalHours && <div className="text-[10px] text-red-500 mt-1">{errors.totalHours}</div>}
                      </td>
                      <td className="px-2 py-2 align-top">
                        <div className="h-6"></div>
                        <input
                          type="text"
                          value={record.notes}
                          onChange={(e) => handleRecordChange(index, 'notes', e.target.value)}
                          className="w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-xl font-bold py-0 px-0"
                          placeholder="..."
                        />
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>

            {/* Footer Section */}
            <div className="flex flex-col md:flex-row justify-between items-end gap-4">
              <div className="w-full md:w-1/2 space-y-6">
                <div className="space-y-1">
                  <div className="flex justify-between items-end mb-1">
                    <label className="block text-sm font-medium text-gray-700">Employee Signature</label>
                    <button 
                      onClick={() => { sigCanvas.current?.clear(); setSignature(''); }} 
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-medium print:hidden"
                    >
                      Clear Signature
                    </button>
                  </div>
                  <div className="border border-gray-300 rounded-lg bg-white overflow-hidden shadow-sm">
                    <SignatureCanvas 
                      ref={sigCanvas}
                      penColor="black"
                      clearOnResize={false}
                      canvasProps={{className: 'w-full h-24 sm:h-32 bg-white'}}
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
                    className="block w-full border-0 border-b-2 border-gray-200 focus:border-indigo-600 focus:ring-0 px-0 py-2 text-base sm:text-lg transition-colors bg-transparent"
                  />
                </div>
              </div>
              
              <div className="w-full md:w-1/3 bg-gray-50 p-4 sm:p-6 rounded-xl border border-gray-200">
                <div className="flex justify-between items-center">
                  <span className="text-base sm:text-lg font-medium text-gray-700">Total Hours:</span>
                  <input
                    type="text"
                    value={totalHours}
                    onChange={(e) => setTotalHours(e.target.value)}
                    className={`w-24 sm:w-32 text-right text-xl sm:text-2xl font-bold text-indigo-600 bg-transparent border-b-2 focus:ring-0 px-0 py-1 ${totalHours && isNaN(Number(totalHours)) ? 'border-red-500 focus:border-red-500' : 'border-indigo-200 focus:border-indigo-600'}`}
                    placeholder="0.00"
                  />
                  {totalHours && isNaN(Number(totalHours)) && (
                    <div className="text-red-500 text-xs mt-1 text-right">Invalid number</div>
                  )}
                </div>
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
      </div>
    </div>
  );
}
