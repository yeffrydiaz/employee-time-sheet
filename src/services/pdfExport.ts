import jsPDF from 'jspdf';

export interface TimesheetPdfRow {
  day: string;
  date: string;
  timeIn: string;
  lunchStart: string;
  lunchEnd: string;
  timeOut: string;
  totalHours: string;
  notes: string;
  isToday?: boolean;
}

export interface TimesheetPdfOptions {
  companyName: string;
  periodType: string;
  periodStart: string;
  periodRangeLabel: string;
  employeeName: string;
  employeeEmail: string;
  recipientEmail?: string;
  managerEmail?: string;
  rows: TimesheetPdfRow[];
  totalHours?: number;
  totalPeriodHours?: number;
  regularHours?: number;
  regularPeriodHours?: number;
  overtimeHours?: number;
  overtimePeriodHours?: number;
  signatureDataUrl?: string;
  typedSignatureName?: string;
  typedSignature?: string;
  signatureDate: string;
  extraSummaryText?: string;
  filename?: string;
}

function format12HourTime(hhmm: string): string {
  if (!hhmm || !hhmm.includes(':')) return '—';
  const [hStr, mStr] = hhmm.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m)) return hhmm;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
}

export function generateVectorTimesheetPDF(opts: TimesheetPdfOptions): jsPDF {
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = pdf.internal.pageSize.getWidth(); // 210mm
  const pageHeight = pdf.internal.pageSize.getHeight(); // 297mm
  const margin = 12;
  const contentWidth = pageWidth - margin * 2; // 186mm

  let y = margin;

  // =========================================================================
  // 1. HEADER BLOCK
  // =========================================================================
  pdf.setFillColor(15, 23, 42); // Slate-900 header bar
  pdf.roundedRect(margin, y, contentWidth, 18, 2.5, 2.5, 'F');

  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(15);
  pdf.text(opts.companyName || 'Royal Transportation', margin + 5, y + 8);

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.setTextColor(203, 213, 225);
  pdf.text(
    `EMPLOYEE TIME SHEET  •  ${(opts.periodType || 'BI-WEEKLY').toUpperCase()} PERIOD`,
    margin + 5,
    y + 14
  );

  // Right-aligned period badge in header
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.setTextColor(255, 255, 255);
  const rangeText = opts.periodRangeLabel || opts.periodStart || '';
  if (rangeText) {
    pdf.text(`Period: ${rangeText}`, pageWidth - margin - 5, y + 11, { align: 'right' });
  }

  y += 22;

  // =========================================================================
  // 2. EMPLOYEE METADATA BOX
  // =========================================================================
  pdf.setDrawColor(226, 232, 240);
  pdf.setFillColor(248, 250, 252);
  pdf.roundedRect(margin, y, contentWidth, 16, 2, 2, 'FD');

  const col1X = margin + 4;
  const col2X = margin + contentWidth * 0.36;
  const col3X = margin + contentWidth * 0.7;

  // Employee Name
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7);
  pdf.setTextColor(100, 116, 139);
  pdf.text('EMPLOYEE NAME', col1X, y + 5.5);
  pdf.setFontSize(9.5);
  pdf.setTextColor(15, 23, 42);
  pdf.text(opts.employeeName || '—', col1X, y + 12);

  // Employee Email
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7);
  pdf.setTextColor(100, 116, 139);
  pdf.text('EMPLOYEE EMAIL', col2X, y + 5.5);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.setTextColor(15, 23, 42);
  pdf.text(opts.employeeEmail || '—', col2X, y + 12);

  // Period Starting
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7);
  pdf.setTextColor(100, 116, 139);
  pdf.text('PERIOD STARTING', col3X, y + 5.5);
  pdf.setFontSize(9);
  pdf.setTextColor(79, 70, 229);
  pdf.text(
    `${opts.periodStart || ''}${opts.periodRangeLabel ? ` (${opts.periodRangeLabel})` : ''}`,
    col3X,
    y + 12
  );

  y += 20;

  // =========================================================================
  // 3. 7-COLUMN TIMESHEET TABLE
  //    Columns: DATE | TIME IN | LUNCH START | LUNCH END | TIME OUT | TOTAL HRS | NOTES
  //    Rule A5: Soft yellow #FEF9C3 on Lunch Start & Lunch End ONLY; pure white on all others.
  // =========================================================================
  const cols = [
    { key: 'date', label: 'DATE', width: 29, align: 'left' as const, isLunch: false },
    { key: 'timeIn', label: 'TIME IN', width: 25, align: 'center' as const, isLunch: false },
    { key: 'lunchStart', label: 'LUNCH START', width: 24, align: 'center' as const, isLunch: true },
    { key: 'lunchEnd', label: 'LUNCH END', width: 24, align: 'center' as const, isLunch: true },
    { key: 'timeOut', label: 'TIME OUT', width: 25, align: 'center' as const, isLunch: false },
    { key: 'totalHours', label: 'TOTAL HRS', width: 21, align: 'center' as const, isLunch: false },
    { key: 'notes', label: 'NOTES', width: 38, align: 'left' as const, isLunch: false },
  ];

  const rowCount = opts.rows.length || 14;
  // Dynamically size row height so 14-day sheet + signature + summary card always fit on 1 page
  const rowHeight = rowCount <= 14 ? 9.8 : 8.2;
  const headerHeight = 8.5;

  const drawTableHeader = (startY: number) => {
    let curX = margin;
    for (const col of cols) {
      if (col.isLunch) {
        pdf.setFillColor(254, 249, 195); // #FEF9C3
      } else {
        pdf.setFillColor(241, 245, 249); // Slate-100
      }
      pdf.setDrawColor(203, 213, 225);
      pdf.rect(curX, startY, col.width, headerHeight, 'FD');

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7.2);
      if (col.key === 'timeIn') {
        pdf.setTextColor(4, 120, 87); // Emerald-700
      } else if (col.isLunch) {
        pdf.setTextColor(146, 64, 14); // Amber-800
      } else if (col.key === 'timeOut') {
        pdf.setTextColor(190, 18, 60); // Rose-700
      } else {
        pdf.setTextColor(51, 65, 85);
      }

      if (col.align === 'center') {
        pdf.text(col.label, curX + col.width / 2, startY + 5.6, { align: 'center' });
      } else {
        pdf.text(col.label, curX + 2.2, startY + 5.6);
      }
      curX += col.width;
    }
    return startY + headerHeight;
  };

  y = drawTableHeader(y);

  for (let i = 0; i < opts.rows.length; i++) {
    const r = opts.rows[i];

    // Paginate cleanly if monthly (> 16 rows) and approaching bottom of page
    if (y + rowHeight > pageHeight - 54 && i < opts.rows.length - 1 && opts.rows.length > 16) {
      pdf.addPage();
      y = margin;
      y = drawTableHeader(y);
    }

    let curX = margin;
    for (const col of cols) {
      if (col.isLunch) {
        // Strict #FEF9C3 soft yellow on Lunch Start / Lunch End ONLY
        pdf.setFillColor(254, 249, 195);
      } else {
        // Pure white #FFFFFF on all other cells
        pdf.setFillColor(255, 255, 255);
      }
      pdf.setDrawColor(226, 232, 240);
      pdf.rect(curX, y, col.width, rowHeight, 'FD');

      const midY = y + rowHeight * 0.63;

      if (col.key === 'date') {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8.8);
        pdf.setTextColor(15, 23, 42);
        const dayShort = (r.day || '').slice(0, 3);
        let dateLabel = r.date || '';
        if (dateLabel && dateLabel.includes('-')) {
          const [ry, rm, rd] = dateLabel.split('-').map(Number);
          const currentYr = new Date().getFullYear();
          const dt = new Date(ry, rm - 1, rd);
          const mShort = dt.toLocaleDateString('en-US', { month: 'short' });
          dateLabel = ry !== currentYr ? `${mShort} ${rd}, '${String(ry).slice(-2)}` : `${mShort} ${rd}`;
        }
        pdf.text(`${dayShort} ${dateLabel}`, curX + 2, midY);
      } else if (col.key === 'timeIn') {
        pdf.setFont('courier', 'bold');
        pdf.setFontSize(8.8);
        pdf.setTextColor(15, 23, 42);
        pdf.text(r.timeIn ? format12HourTime(r.timeIn) : '—', curX + col.width / 2, midY, {
          align: 'center',
        });
      } else if (col.key === 'lunchStart') {
        pdf.setFont('courier', 'bold');
        pdf.setFontSize(8);
        pdf.setTextColor(120, 53, 15);
        pdf.text(
          r.lunchStart ? format12HourTime(r.lunchStart) : '—',
          curX + col.width / 2,
          midY,
          { align: 'center' }
        );
      } else if (col.key === 'lunchEnd') {
        pdf.setFont('courier', 'bold');
        pdf.setFontSize(8);
        pdf.setTextColor(120, 53, 15);
        pdf.text(r.lunchEnd ? format12HourTime(r.lunchEnd) : '—', curX + col.width / 2, midY, {
          align: 'center',
        });
      } else if (col.key === 'timeOut') {
        pdf.setFont('courier', 'bold');
        pdf.setFontSize(8.8);
        pdf.setTextColor(15, 23, 42);
        pdf.text(r.timeOut ? format12HourTime(r.timeOut) : '—', curX + col.width / 2, midY, {
          align: 'center',
        });
      } else if (col.key === 'totalHours') {
        const hrsNum = parseFloat(r.totalHours || '0') || 0;
        pdf.setFont('courier', 'bold');
        pdf.setFontSize(9.5);
        if (hrsNum > 0) {
          pdf.setTextColor(15, 23, 42);
        } else {
          pdf.setTextColor(148, 163, 184);
        }
        pdf.text(r.totalHours || '0.00', curX + col.width / 2, midY, { align: 'center' });
      } else if (col.key === 'notes') {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7.5);
        pdf.setTextColor(51, 65, 85);
        const rawNote = (r.notes || '').trim();
        if (rawNote) {
          const clipped = pdf.splitTextToSize(rawNote, col.width - 4);
          pdf.text(clipped[0] || '', curX + 2, midY);
        }
      }

      curX += col.width;
    }

    y += rowHeight;
  }

  y += 5;

  // Ensure bottom summary & signature section fits on current page
  const summaryBoxHeight = 44;
  if (y + summaryBoxHeight > pageHeight - margin) {
    pdf.addPage();
    y = margin + 4;
  }

  // =========================================================================
  // 4. SIGNATURE BLOCK (LEFT) & TOTAL PERIOD HOURS SUMMARY (RIGHT)
  // =========================================================================
  const halfWidth = (contentWidth - 6) / 2; // 90mm each
  const leftX = margin;
  const rightX = margin + halfWidth + 6;

  // Left: Employee Signature Card
  pdf.setDrawColor(203, 213, 225);
  pdf.setFillColor(255, 255, 255);
  pdf.roundedRect(leftX, y, halfWidth, summaryBoxHeight, 2, 2, 'FD');

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.5);
  pdf.setTextColor(100, 116, 139);
  pdf.text('EMPLOYEE SIGNATURE', leftX + 4, y + 6);

  const resolvedTypedSig = opts.typedSignature || opts.typedSignatureName || '';
  const totalPeriodHours = Number(opts.totalPeriodHours ?? opts.totalHours ?? 0) || 0;
  const regularPeriodHours = Number(opts.regularPeriodHours ?? opts.regularHours ?? Math.min(40, totalPeriodHours)) || 0;
  const overtimePeriodHours = Number(opts.overtimePeriodHours ?? opts.overtimeHours ?? Math.max(0, totalPeriodHours - 40)) || 0;

  if (opts.signatureDataUrl && opts.signatureDataUrl.startsWith('data:image')) {
    try {
      pdf.addImage(opts.signatureDataUrl, 'PNG', leftX + 4, y + 8, halfWidth - 8, 22);
    } catch {
      if (resolvedTypedSig) {
        pdf.setFont('times', 'italic');
        pdf.setFontSize(16);
        pdf.setTextColor(15, 23, 42);
        pdf.text(resolvedTypedSig, leftX + 6, y + 22);
      }
    }
  } else if (resolvedTypedSig) {
    pdf.setFont('times', 'italic');
    pdf.setFontSize(16);
    pdf.setTextColor(15, 23, 42);
    pdf.text(resolvedTypedSig, leftX + 6, y + 22);
  } else {
    pdf.setFont('helvetica', 'italic');
    pdf.setFontSize(8.5);
    pdf.setTextColor(148, 163, 184);
    pdf.text('Sign here: ____________________________', leftX + 4, y + 22);
  }

  // Signature line & date
  pdf.setDrawColor(226, 232, 240);
  pdf.line(leftX + 4, y + 33, leftX + halfWidth - 4, y + 33);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.5);
  pdf.setTextColor(71, 85, 105);
  pdf.text(`SIGNATURE DATE: ${opts.signatureDate || '—'}`, leftX + 4, y + 39.5);

  // Right: Total Period Hours Card (with Red Overtime >40h indicator)
  const isOvertime = overtimePeriodHours > 0;
  if (isOvertime) {
    pdf.setDrawColor(244, 63, 94); // Rose-500 border when overtime > 40
  } else {
    pdf.setDrawColor(203, 213, 225);
  }
  pdf.setFillColor(255, 255, 255);
  pdf.roundedRect(rightX, y, halfWidth, summaryBoxHeight, 2, 2, 'FD');

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7.5);
  pdf.setTextColor(100, 116, 139);
  pdf.text('TOTAL PERIOD HOURS', rightX + 4, y + 6);

  if (isOvertime) {
    // Red Overtime Status pill
    pdf.setFillColor(254, 226, 226);
    pdf.setDrawColor(252, 165, 165);
    pdf.roundedRect(rightX + halfWidth - 36, y + 2.2, 32, 5.5, 1.2, 1.2, 'FD');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(6.5);
    pdf.setTextColor(185, 28, 28);
    pdf.text('OVERTIME (>40H)', rightX + halfWidth - 20, y + 6, { align: 'center' });
  }

  // Hero Total Hours number
  pdf.setFont('courier', 'bold');
  pdf.setFontSize(19);
  if (isOvertime) {
    pdf.setTextColor(220, 38, 38); // Red-600
  } else {
    pdf.setTextColor(15, 23, 42);
  }
  pdf.text(`${totalPeriodHours.toFixed(2)} hrs`, rightX + 4, y + 15.5);

  // Regular (<=40) vs Overtime (>40) Sub-boxes
  const subBoxW = (halfWidth - 11) / 2;
  const subBoxY = y + 19;
  const subBoxH = 12.5;

  // Regular Box
  pdf.setDrawColor(226, 232, 240);
  pdf.setFillColor(248, 250, 252);
  pdf.roundedRect(rightX + 4, subBoxY, subBoxW, subBoxH, 1.5, 1.5, 'FD');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(6.5);
  pdf.setTextColor(100, 116, 139);
  pdf.text('REGULAR (<=40 HRS)', rightX + 6, subBoxY + 4.3);
  pdf.setFont('courier', 'bold');
  pdf.setFontSize(9.2);
  pdf.setTextColor(15, 23, 42);
  pdf.text(`${regularPeriodHours.toFixed(2)} hrs`, rightX + 6, subBoxY + 10);

  // Overtime Box
  const otBoxX = rightX + 4 + subBoxW + 3;
  if (isOvertime) {
    pdf.setDrawColor(252, 165, 165);
    pdf.setFillColor(254, 242, 242);
  } else {
    pdf.setDrawColor(226, 232, 240);
    pdf.setFillColor(248, 250, 252);
  }
  pdf.roundedRect(otBoxX, subBoxY, subBoxW, subBoxH, 1.5, 1.5, 'FD');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(6.5);
  if (isOvertime) {
    pdf.setTextColor(185, 28, 28);
  } else {
    pdf.setTextColor(100, 116, 139);
  }
  pdf.text('OVERTIME (>40 HRS)', otBoxX + 2, subBoxY + 4.3);
  pdf.setFont('courier', 'bold');
  pdf.setFontSize(9.2);
  if (isOvertime) {
    pdf.setTextColor(220, 38, 38);
  } else {
    pdf.setTextColor(148, 163, 184);
  }
  pdf.text(
    `${isOvertime ? '+' : ''}${overtimePeriodHours.toFixed(2)} hrs`,
    otBoxX + 2,
    subBoxY + 10
  );

  // Wrapped caption lines inside the 90mm summary card so text never overflows the box or page
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(6.5);
  pdf.setTextColor(100, 116, 139);
  const captionText =
    opts.extraSummaryText ||
    'Total hours are automatically calculated based on Time In, Time Out, and Lunch deduction.';
  const wrappedCaptionLines = pdf.splitTextToSize(captionText, halfWidth - 8);
  pdf.text(wrappedCaptionLines.slice(0, 2), rightX + 4, y + 36.2, {
    lineHeightFactor: 1.25,
  });

  return pdf;
}

/**
 * Triggers a clean print dialog without using window.open (which is blocked in iframes)
 * and saves the vector PDF so the user always gets the file immediately.
 */
export function triggerPrintAndDownloadPDF(pdf: jsPDF, filename: string): void {
  // Always save the crisp vector PDF
  pdf.save(filename);

  // Also trigger native browser print if supported
  try {
    window.print();
  } catch (e) {
    console.warn('Native print dialog could not be opened:', e);
  }
}

export interface AdminReportPdfOptions {
  companyName: string;
  reportTitle: string;
  fromDate: string;
  toDate: string;
  headers: string[];
  rows: string[][];
  footerRow?: string[];
  footerTotalRow?: string[];
  footerRows?: string[][];
  filename: string;
}

/**
 * Generates a formatted multi-column vector table PDF for Admin Reports.
 */
export function exportAdminReportVectorPDF(opts: AdminReportPdfOptions): void {
  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = pdf.internal.pageSize.getWidth(); // 297mm
  const pageHeight = pdf.internal.pageSize.getHeight(); // 210mm
  const margin = 12;
  const contentWidth = pageWidth - margin * 2; // 273mm

  let y = margin;

  const drawReportPageHeader = (pageNum: number) => {
    pdf.setFillColor(15, 23, 42);
    pdf.roundedRect(margin, margin, contentWidth, 16, 2, 2, 'F');

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(13);
    pdf.setTextColor(255, 255, 255);
    pdf.text(`${opts.companyName} — ${opts.reportTitle}`, margin + 4, margin + 7);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
    pdf.setTextColor(203, 213, 225);
    pdf.text(
      `Period: ${opts.fromDate} to ${opts.toDate}   •   Generated: ${new Date().toLocaleDateString()}`,
      margin + 4,
      margin + 13
    );

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.setTextColor(255, 255, 255);
    pdf.text(`Page ${pageNum}`, pageWidth - margin - 4, margin + 10, { align: 'right' });

    return margin + 20;
  };

  let pageNumber = 1;
  y = drawReportPageHeader(pageNumber);

  const colCount = Math.max(1, opts.headers.length);
  // Give the first column (Employee / Date) slightly more width
  const firstColWeight = 1.6;
  const totalWeight = firstColWeight + (colCount - 1);
  const colWidths = opts.headers.map((_, idx) =>
    idx === 0 ? (contentWidth * firstColWeight) / totalWeight : contentWidth / totalWeight
  );

  const drawTableHeaders = (startY: number) => {
    let curX = margin;
    const h = 8.5;
    opts.headers.forEach((headerText, idx) => {
      const w = colWidths[idx];
      pdf.setFillColor(241, 245, 249);
      pdf.setDrawColor(203, 213, 225);
      pdf.rect(curX, startY, w, h, 'FD');

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7.5);
      pdf.setTextColor(51, 65, 85);
      pdf.text(String(headerText).toUpperCase(), curX + 2.5, startY + 5.6);
      curX += w;
    });
    return startY + h;
  };

  y = drawTableHeaders(y);

  const rowH = 7.5;
  opts.rows.forEach((row, rIdx) => {
    if (y + rowH > pageHeight - 18) {
      pdf.addPage();
      pageNumber += 1;
      y = drawReportPageHeader(pageNumber);
      y = drawTableHeaders(y);
    }

    let curX = margin;
    row.forEach((cellVal, cIdx) => {
      const w = colWidths[cIdx];
      if (rIdx % 2 === 1) {
        pdf.setFillColor(248, 250, 252);
      } else {
        pdf.setFillColor(255, 255, 255);
      }
      pdf.setDrawColor(226, 232, 240);
      pdf.rect(curX, y, w, rowH, 'FD');

      const headerName = (opts.headers[cIdx] || '').toLowerCase();
      const isOtCol = headerName === 'ot' || headerName.includes('overtime');
      const numericVal = parseFloat(String(cellVal).replace(/[^0-9.-]/g, ''));

      if (isOtCol && !isNaN(numericVal) && numericVal > 0) {
        pdf.setFont('courier', 'bold');
        pdf.setTextColor(220, 38, 38); // Highlight OT in red
      } else if (cIdx === 0) {
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(15, 23, 42);
      } else {
        pdf.setFont('courier', 'normal');
        pdf.setTextColor(30, 41, 59);
      }
      pdf.setFontSize(8);

      const clipped = pdf.splitTextToSize(String(cellVal ?? ''), w - 4);
      pdf.text(clipped[0] || '', curX + 2.5, y + 5.1);
      curX += w;
    });
    y += rowH;
  });

  const resolvedFooterRows: string[][] =
    opts.footerRows && opts.footerRows.length > 0
      ? opts.footerRows
      : opts.footerTotalRow || opts.footerRow
      ? [opts.footerTotalRow || opts.footerRow!]
      : [];

  resolvedFooterRows.forEach(fRow => {
    if (!fRow || fRow.length !== opts.headers.length) return;
    if (y + 8.5 > pageHeight - 14) {
      pdf.addPage();
      pageNumber += 1;
      y = drawReportPageHeader(pageNumber);
    }
    const isSubtotal = String(fRow[0] || '').toLowerCase().includes('subtotal');
    let curX = margin;
    fRow.forEach((cellVal, cIdx) => {
      const w = colWidths[cIdx];
      if (isSubtotal) {
        pdf.setFillColor(241, 245, 249);
        pdf.setDrawColor(203, 213, 225);
        pdf.rect(curX, y, w, 8, 'FD');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8);
        pdf.setTextColor(15, 23, 42);
        pdf.text(String(cellVal ?? ''), curX + 2.5, y + 5.3);
      } else {
        pdf.setFillColor(15, 23, 42);
        pdf.setDrawColor(15, 23, 42);
        pdf.rect(curX, y, w, 8.5, 'FD');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8);
        pdf.setTextColor(255, 255, 255);
        pdf.text(String(cellVal ?? ''), curX + 2.5, y + 5.6);
      }
      curX += w;
    });
    y += isSubtotal ? 8 : 8.5;
  });

  pdf.save(opts.filename);
}
