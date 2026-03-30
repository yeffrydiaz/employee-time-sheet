import React, { useState, useEffect, useRef } from 'react';
import { Mail, Printer, Calculator, RefreshCw, Save, Loader2 } from 'lucide-react';
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
    if (window.confirm('Are you sure you want to clear all fields?')) {
      setName('');
      setWeekOf('');
      setRecords(initialRecords);
      setTotalHours('');
      setSignature('');
      sigCanvas.current?.clear();
      setDate('');
      setRecipientEmail(DEFAULT_EMAIL);
    }
  };

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
            <div className="flex gap-2">
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
                className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 w-full sm:w-56"
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8 mb-8 sm:mb-10">
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={handleNameChange}
                  className="block w-full border-0 border-b-2 border-gray-200 focus:border-indigo-600 focus:ring-0 px-0 py-2 text-base sm:text-lg transition-colors bg-transparent"
                  placeholder="John Doe"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">Week of</label>
                <input
                  type="date"
                  value={weekOf}
                  onChange={(e) => setWeekOf(e.target.value)}
                  className="block w-full border-0 border-b-2 border-gray-200 focus:border-indigo-600 focus:ring-0 px-0 py-2 text-base sm:text-lg transition-colors bg-transparent"
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
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
                      <input
                        type="date"
                        value={record.date}
                        onChange={(e) => handleRecordChange(index, 'date', e.target.value)}
                        className="w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm py-2 px-3 bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Time In</label>
                      <input
                        type="time"
                        value={record.timeIn}
                        onChange={(e) => handleRecordChange(index, 'timeIn', e.target.value)}
                        className={`w-full rounded-md shadow-sm text-sm py-2 px-3 bg-white ${errors.timeIn ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'}`}
                      />
                      {errors.timeIn && <p className="text-[10px] text-red-500 mt-1">{errors.timeIn}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Time Out</label>
                      <input
                        type="time"
                        value={record.timeOut}
                        onChange={(e) => handleRecordChange(index, 'timeOut', e.target.value)}
                        className={`w-full rounded-md shadow-sm text-sm py-2 px-3 bg-white ${errors.timeOut ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'}`}
                      />
                      {errors.timeOut && <p className="text-[10px] text-red-500 mt-1">{errors.timeOut}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Lunch Start</label>
                      <input
                        type="time"
                        value={record.lunchStart}
                        onChange={(e) => handleRecordChange(index, 'lunchStart', e.target.value)}
                        className={`w-full rounded-md shadow-sm text-sm py-2 px-3 bg-white ${errors.lunchStart ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'}`}
                      />
                      {errors.lunchStart && <p className="text-[10px] text-red-500 mt-1">{errors.lunchStart}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Lunch End</label>
                      <input
                        type="time"
                        value={record.lunchEnd}
                        onChange={(e) => handleRecordChange(index, 'lunchEnd', e.target.value)}
                        className={`w-full rounded-md shadow-sm text-sm py-2 px-3 bg-white ${errors.lunchEnd ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'}`}
                      />
                      {errors.lunchEnd && <p className="text-[10px] text-red-500 mt-1">{errors.lunchEnd}</p>}
                    </div>
                    <div className="col-span-2 flex gap-4">
                      <div className="w-fit">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Total Hrs</label>
                        <input
                          type="text"
                          value={record.totalHours}
                          onChange={(e) => handleRecordChange(index, 'totalHours', e.target.value)}
                          className={`w-[fit-content] rounded-md shadow-sm text-sm py-2 px-3 font-mono bg-gray-100 ${errors.totalHours ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'}`}
                          placeholder="0.00"
                          size={5}
                        />
                        {errors.totalHours && <p className="text-[10px] text-red-500 mt-1">{errors.totalHours}</p>}
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
                        <input
                          type="text"
                          value={record.notes}
                          onChange={(e) => handleRecordChange(index, 'notes', e.target.value)}
                          className="w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm py-2 px-3 bg-white"
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
                    <th scope="col" className="px-2 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-24">Day</th>
                    <th scope="col" className="px-2 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-32">Date</th>
                    <th scope="col" className="px-2 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-24">Time In</th>
                    <th scope="col" className="px-2 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-24">Lunch Start</th>
                    <th scope="col" className="px-2 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-24">Lunch End</th>
                    <th scope="col" className="px-2 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-24">Time Out</th>
                    <th scope="col" className="px-2 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider w-24">Total Hrs</th>
                    <th scope="col" className="px-2 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Notes</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {records.map((record, index) => {
                    const errors = getErrors(record);
                    return (
                    <tr key={record.day} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-2 py-3 text-sm font-medium text-gray-900 bg-gray-50/30 align-top">
                        {record.day}
                      </td>
                      <td className="px-2 py-2 align-top">
                        <input
                          type="date"
                          value={record.date}
                          onChange={(e) => handleRecordChange(index, 'date', e.target.value)}
                          className="w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm py-1.5 px-2"
                        />
                      </td>
                      <td className="px-2 py-2 align-top">
                        <input
                          type="time"
                          value={record.timeIn}
                          onChange={(e) => handleRecordChange(index, 'timeIn', e.target.value)}
                          className={`w-full rounded-md shadow-sm text-xs sm:text-sm py-1.5 px-1 ${errors.timeIn ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'}`}
                        />
                        {errors.timeIn && <div className="text-[10px] text-red-500 mt-1">{errors.timeIn}</div>}
                      </td>
                      <td className="px-2 py-2 align-top">
                        <input
                          type="time"
                          value={record.lunchStart}
                          onChange={(e) => handleRecordChange(index, 'lunchStart', e.target.value)}
                          className={`w-full rounded-md shadow-sm text-xs sm:text-sm py-1.5 px-1 ${errors.lunchStart ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'}`}
                        />
                        {errors.lunchStart && <div className="text-[10px] text-red-500 mt-1">{errors.lunchStart}</div>}
                      </td>
                      <td className="px-2 py-2 align-top">
                        <input
                          type="time"
                          value={record.lunchEnd}
                          onChange={(e) => handleRecordChange(index, 'lunchEnd', e.target.value)}
                          className={`w-full rounded-md shadow-sm text-xs sm:text-sm py-1.5 px-1 ${errors.lunchEnd ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'}`}
                        />
                        {errors.lunchEnd && <div className="text-[10px] text-red-500 mt-1">{errors.lunchEnd}</div>}
                      </td>
                      <td className="px-2 py-2 align-top">
                        <input
                          type="time"
                          value={record.timeOut}
                          onChange={(e) => handleRecordChange(index, 'timeOut', e.target.value)}
                          className={`w-full rounded-md shadow-sm text-xs sm:text-sm py-1.5 px-1 ${errors.timeOut ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'}`}
                        />
                        {errors.timeOut && <div className="text-[10px] text-red-500 mt-1">{errors.timeOut}</div>}
                      </td>
                      <td className="px-2 py-2 text-center align-top">
                        <input
                          type="text"
                          value={record.totalHours}
                          onChange={(e) => handleRecordChange(index, 'totalHours', e.target.value)}
                          className={`w-[fit-content] rounded-md shadow-sm text-base font-bold py-2 px-2 font-mono bg-indigo-50 text-indigo-700 text-center mx-auto ${errors.totalHours ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'}`}
                          placeholder="0.00"
                          size={4}
                        />
                        {errors.totalHours && <div className="text-[10px] text-red-500 mt-1">{errors.totalHours}</div>}
                      </td>
                      <td className="px-2 py-2 align-top">
                        <input
                          type="text"
                          value={record.notes}
                          onChange={(e) => handleRecordChange(index, 'notes', e.target.value)}
                          className="w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm py-1.5 px-2"
                          placeholder="..."
                        />
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>

            {/* Footer Section */}
            <div className="flex flex-col md:flex-row justify-between items-end gap-8">
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
      </div>
    </div>
  );
}
