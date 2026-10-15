import {
  Property,
  RentReportResult,
  RentReportMonthData,
  MONTH_SHORT,
  ConsolidatedRentReportResult,
  formatFlatNumber,
} from '../db/database';

export function formatIndianCurrency(num: number): string {
  if (isNaN(num)) return '0';
  try {
    return Math.round(num).toLocaleString('en-IN');
  } catch {
    const s = Math.round(num).toString();
    const lastThree = s.substring(s.length - 3);
    const otherNumbers = s.substring(0, s.length - 3);
    if (otherNumbers !== '') {
      return otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + lastThree;
    }
    return lastThree;
  }
}

export function formatReportPaymentDate(rawDate?: string): string {
  if (!rawDate || !rawDate.trim()) return '';
  const clean = rawDate.trim().replace(/^Paid\s+/i, '').trim();
  if (!clean) return '';

  // 1. Check DD-MM-YYYY or DD/MM/YYYY
  const dmy = clean.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (dmy) {
    const day = parseInt(dmy[1], 10);
    const mIdx = parseInt(dmy[2], 10) - 1;
    const mName = MONTH_SHORT[mIdx] || '';
    return `${day} ${mName}`;
  }

  // 2. Check YYYY-MM-DD
  const ymd = clean.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (ymd) {
    const day = parseInt(ymd[3], 10);
    const mIdx = parseInt(ymd[2], 10) - 1;
    const mName = MONTH_SHORT[mIdx] || '';
    return `${day} ${mName}`;
  }

  // 3. Check "13 Oct 2026" or "13 Oct"
  const wordMatch = clean.match(/^(\d{1,2})\s+([A-Za-z]{3,})/);
  if (wordMatch) {
    return `${wordMatch[1]} ${wordMatch[2].slice(0, 3)}`;
  }

  // 4. Fallback Date parsing
  try {
    const d = new Date(clean);
    if (!isNaN(d.getTime())) {
      const day = d.getDate();
      const mName = MONTH_SHORT[d.getMonth()] || '';
      return `${day} ${mName}`;
    }
  } catch {}

  return clean;
}

export function getMonthPaymentDate(monthData?: RentReportMonthData): string {
  if (!monthData?.record) return '';
  const rec = monthData.record;
  if (rec.transactions && rec.transactions.length > 0) {
    const lastTx = rec.transactions[rec.transactions.length - 1];
    if (lastTx?.date_paid) {
      return formatReportPaymentDate(lastTx.date_paid);
    }
  }
  if (rec.date_paid) {
    return formatReportPaymentDate(rec.date_paid);
  }
  return '';
}

export interface BuildReportHtmlOptions {
  mode?: 'preview' | 'pdf';
}

/**
 * Builds the complete standalone HTML for Rent Report.
 * - In 'preview' mode: Name column has sticky CSS (position: sticky; left: 0) while
 *   Flat, Jan-Dec, Paid, and Pending scroll horizontally. Includes pinch-to-zoom viewport.
 * - In 'pdf' mode: Name column has position: static for reliable PDF rendering and print pagination.
 * - Includes cell statuses, payment amounts, and paid date with reduced font size.
 */
export function buildReportHtml(
  property: Property,
  year: number,
  report: RentReportResult,
  modeOrOptions: 'preview' | 'pdf' | BuildReportHtmlOptions = 'preview'
): string {
  const mode = typeof modeOrOptions === 'string' ? modeOrOptions : (modeOrOptions.mode || 'preview');
  const isPreview = mode === 'preview';

  const generatedDate = new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const monthlyCollected: number[] = new Array(12).fill(0);
  const monthlyDue: number[] = new Array(12).fill(0);
  let overallTotalPaid = 0;
  let overallTotalPending = 0;

  const rowsHtml = report.rows
    .map((row, idx) => {
      let tenantPaidTotal = 0;
      let tenantPendingTotal = 0;

      const monthCells = MONTH_SHORT.map((_, mIdx) => {
        const monthData = row.months[mIdx];
        const status = monthData?.status || 'upcoming';
        const rent = row.tenant.rent_amount || 0;
        const totalAmount = monthData?.record?.total_amount ?? monthData?.record?.amount ?? rent;

        let paid = 0;
        let due = 0;
        let cellText = '—';
        let cellClass = 'cell-upcoming';
        let dateText = '';

        if (status === 'paid') {
          paid = monthData?.record?.paid_amount ?? (totalAmount > 0 ? totalAmount : rent);
          cellText = `₹${formatIndianCurrency(paid)}`;
          cellClass = 'cell-paid';
          dateText = getMonthPaymentDate(monthData);
        } else if (status === 'not_paid') {
          due = totalAmount;
          cellText = 'Due';
          cellClass = 'cell-due';
        } else if (status === 'partial') {
          paid = monthData?.record?.paid_amount ?? 0;
          due = Math.max(0, totalAmount - paid);
          cellText = `₹${formatIndianCurrency(paid)}`;
          cellClass = 'cell-partial';
          dateText = getMonthPaymentDate(monthData);
        }

        tenantPaidTotal += paid;
        tenantPendingTotal += due;
        monthlyCollected[mIdx] += paid;
        monthlyDue[mIdx] += due;

        const dateHtml = dateText ? `<div class="cell-date">${dateText}</div>` : '';
        return `
          <td class="data-cell ${cellClass}">
            <div class="cell-status">${cellText}</div>
            ${dateHtml}
          </td>
        `;
      }).join('');

      overallTotalPaid += tenantPaidTotal;
      overallTotalPending += tenantPendingTotal;

      const rowBg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';

      return `
        <tr style="background-color: ${rowBg};">
          <td class="name-col" title="${row.tenant.name || 'Tenant'}">${row.tenant.name || 'Tenant'}</td>
          <td class="flat-col">${row.displayFlat}</td>
          ${monthCells}
          <td class="total-paid-col">₹${formatIndianCurrency(tenantPaidTotal)}</td>
          <td class="total-pending-col ${tenantPendingTotal > 0 ? 'pending-alert' : ''}">${tenantPendingTotal > 0 ? `₹${formatIndianCurrency(tenantPendingTotal)}` : '—'}</td>
        </tr>
      `;
    })
    .join('');

  const monthlyTotalsCells = MONTH_SHORT.map((_, mIdx) => {
    const colAmt = monthlyCollected[mIdx];
    return `<td class="totals-col">${colAmt > 0 ? `₹${formatIndianCurrency(colAmt)}` : '—'}</td>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Rent Report: ${property.building_name} (${year})</title>
  ${
    isPreview
      ? '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=3.0, minimum-scale=0.5, user-scalable=yes">'
      : '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
  }
  <style>
    @page {
      size: A4 landscape;
      margin: 10mm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: #0f172a;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      font-size: 10px;
      -webkit-text-size-adjust: 100%;
    }
    body {
      padding: ${isPreview ? '12px' : '0'};
    }
    .header-box {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      border-bottom: 2px solid #6B2D3A;
      padding-bottom: 8px;
      margin-bottom: 12px;
    }
    .brand-title {
      font-size: 17px;
      font-weight: 800;
      color: #6B2D3A;
      margin: 0 0 4px 0;
      letter-spacing: -0.3px;
    }
    .sub-line {
      font-size: 9.5px;
      color: #64748b;
      margin: 0;
    }
    .summary-strip {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .summary-pill {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 4px 8px;
      font-size: 9px;
      color: #475569;
    }
    .summary-pill strong {
      color: #0f172a;
    }
    .summary-pill strong.green {
      color: #166534;
    }
    .summary-pill strong.red {
      color: #991b1b;
    }

    /* Scroll wrapper for table */
    .scroll-wrapper {
      ${
        isPreview
          ? `
      overflow-x: auto;
      overflow-y: visible;
      -webkit-overflow-scrolling: touch;
      width: 100%;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
      margin-bottom: 12px;
      `
          : `
      width: 100%;
      margin-bottom: 12px;
      `
      }
    }

    table {
      border-collapse: separate;
      border-spacing: 0;
      width: 100%;
      ${isPreview ? 'min-width: 940px;' : 'table-layout: fixed;'}
      font-size: 9px;
      background: #ffffff;
    }

    thead {
      display: table-header-group;
    }
    tfoot {
      display: table-footer-group;
    }
    tr {
      page-break-inside: avoid;
    }

    th, td {
      border-right: 1px solid #cbd5e1;
      border-bottom: 1px solid #cbd5e1;
      padding: 4px 2px;
      text-align: center;
      vertical-align: middle;
    }

    th {
      background-color: #6B2D3A;
      color: #ffffff;
      font-weight: 700;
      font-size: 8.5px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      padding: 6px 3px;
      border-top: 1px solid #6B2D3A;
      border-bottom: 1px solid #58242F;
    }

    /* FIXED / STICKY NAME COLUMN */
    ${
      isPreview
        ? `
    th.name-col, td.name-col {
      position: sticky;
      left: 0;
      z-index: 10;
      border-right: 2px solid #94a3b8 !important;
      box-shadow: 2px 0 5px rgba(0, 0, 0, 0.08);
      width: 120px;
      min-width: 120px;
      max-width: 120px;
    }
    th.name-col {
      background-color: #58242F !important;
      color: #ffffff !important;
      z-index: 20;
    }
    td.name-col {
      background-color: #ffffff;
      text-align: left;
      padding-left: 8px;
      font-weight: 600;
      color: #0f172a;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    tr:nth-child(even) td.name-col {
      background-color: #f8fafc;
    }
    tr.totals-row td.name-col {
      background-color: #f1f5f9;
      font-weight: 700;
      z-index: 15;
    }
    `
        : `
    th.name-col, td.name-col {
      position: static;
      text-align: left;
      padding-left: 8px;
      width: 110px;
    }
    th.name-col {
      background-color: #6B2D3A;
      color: #ffffff;
    }
    td.name-col {
      font-weight: 600;
      color: #0f172a;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    `
    }

    /* FLAT COLUMN (scrolls with table) */
    .flat-col {
      width: 65px;
      min-width: 65px;
      font-weight: 600;
      color: #475569;
    }

    /* MONTH COLUMNS */
    th.month-head {
      width: 48px;
      min-width: 48px;
    }
    .data-cell {
      height: 28px;
      padding: 2px 1px;
    }

    /* SUMMARY COLUMNS */
    .total-paid-col {
      width: 75px;
      min-width: 75px;
      text-align: right;
      padding-right: 6px;
      font-weight: 700;
      color: #166534;
    }
    .total-pending-col {
      width: 75px;
      min-width: 75px;
      text-align: right;
      padding-right: 6px;
      font-weight: 600;
      color: #64748b;
    }
    .total-pending-col.pending-alert {
      color: #991b1b;
      font-weight: 700;
    }

    /* CELL STATUS & DATE */
    .cell-status {
      font-weight: 700;
      font-size: 8px;
      line-height: 1.1;
      white-space: nowrap;
    }
    .cell-date {
      font-size: 6.5px;
      font-weight: 600;
      margin-top: 1px;
      line-height: 1;
      letter-spacing: -0.2px;
      opacity: 0.9;
      white-space: nowrap;
    }

    /* COLOR THEMES FOR CELLS */
    .cell-paid {
      background-color: #dcfce7 !important;
      color: #166534;
      font-weight: 700;
    }
    .cell-paid .cell-date {
      color: #15803d;
    }
    .cell-due {
      background-color: #fee2e2 !important;
      color: #991b1b;
      font-weight: 700;
    }
    .cell-partial {
      background-color: #fef3c7 !important;
      color: #92400e;
      font-weight: 700;
      font-size: 8px;
    }
    .cell-partial .cell-date {
      color: #b45309;
    }
    .cell-upcoming {
      background-color: #f8fafc !important;
      color: #94a3b8;
    }

    /* TOTALS ROW */
    tr.totals-row td {
      background-color: #f1f5f9;
      font-weight: 700;
      border-top: 2px solid #cbd5e1;
      border-bottom: 2px solid #cbd5e1;
    }
    .totals-col {
      font-size: 8px;
      font-weight: 700;
      color: #166534;
    }

    /* LEGEND & FOOTER */
    .legend-strip {
      display: flex;
      gap: 14px;
      align-items: center;
      margin-top: 8px;
      font-size: 8.5px;
      color: #475569;
      flex-wrap: wrap;
    }
    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .legend-chip {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 3px;
      font-weight: 700;
      font-size: 7.5px;
      border: 1px solid transparent;
    }
    .chip-paid {
      background-color: #dcfce7;
      color: #166534;
      border-color: #86efac;
    }
    .chip-due {
      background-color: #fee2e2;
      color: #991b1b;
      border-color: #fca5a5;
    }
    .chip-partial {
      background-color: #fef3c7;
      color: #92400e;
      border-color: #fcd34d;
    }
    .chip-upcoming {
      background-color: #f1f5f9;
      color: #64748b;
      border-color: #cbd5e1;
    }

    .footer-note {
      display: flex;
      justify-content: space-between;
      margin-top: 10px;
      font-size: 8px;
      color: #64748b;
      border-top: 1px solid #e2e8f0;
      padding-top: 6px;
    }

    @media print {
      body {
        padding: 0;
      }
      .scroll-wrapper {
        border: none;
        box-shadow: none;
        overflow: visible;
      }
      th.name-col, td.name-col {
        position: static !important;
        box-shadow: none !important;
        border-right: 1px solid #cbd5e1 !important;
      }
      th.name-col {
        background-color: #6B2D3A !important;
        color: #ffffff !important;
      }
    }
  </style>
</head>
<body>
  <div class="header-box">
    <div>
      <h1 class="brand-title">Rent Report: ${property.building_name} (${year})</h1>
      <p class="sub-line">SRM Properties • Generated on ${generatedDate}${property.building_address ? ` • ${property.building_address}` : ''}</p>
    </div>
    <div class="summary-strip">
      <div class="summary-pill">Tenants: <strong>${report.rows.length}</strong></div>
      <div class="summary-pill">Total Collected: <strong class="green">₹${formatIndianCurrency(overallTotalPaid)}</strong></div>
      <div class="summary-pill">Total Pending: <strong class="red">₹${formatIndianCurrency(overallTotalPending)}</strong></div>
    </div>
  </div>

  <div class="scroll-wrapper">
    <table>
      <thead>
        <tr>
          <th class="name-col">NAME</th>
          <th class="flat-col">FLAT</th>
          ${MONTH_SHORT.map((m) => `<th class="month-head">${m.toUpperCase()}</th>`).join('')}
          <th class="total-paid-col" style="color: #ffffff; text-align: right; padding-right: 6px;">PAID</th>
          <th class="total-pending-col" style="color: #ffffff; text-align: right; padding-right: 6px;">PENDING</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
      <tfoot>
        <tr class="totals-row">
          <td class="name-col" style="font-weight: 700; color: #0f172a;">TOTAL</td>
          <td class="flat-col">—</td>
          ${monthlyTotalsCells}
          <td class="total-paid-col" style="font-weight: 700;">₹${formatIndianCurrency(overallTotalPaid)}</td>
          <td class="total-pending-col" style="font-weight: 700; ${overallTotalPending > 0 ? 'color: #991b1b;' : ''}">${overallTotalPending > 0 ? `₹${formatIndianCurrency(overallTotalPending)}` : '—'}</td>
        </tr>
      </tfoot>
    </table>
  </div>

  <div class="legend-strip">
    <span class="legend-item"><span class="legend-chip chip-paid">₹ Amt</span> Paid</span>
    <span class="legend-item"><span class="legend-chip chip-due">Due</span> Unpaid / Due</span>
    <span class="legend-item"><span class="legend-chip chip-partial">₹ Part</span> Partial Payment</span>
    <span class="legend-item"><span class="legend-chip chip-upcoming">—</span> Not Started / Upcoming</span>
  </div>

  <div class="footer-note">
    <span>Confidential • ${property.building_name} Annual Rent Statement (${year})</span>
    <span>Generated via SRM Properties App</span>
  </div>
</body>
</html>
`;
}

/**
 * Builds the complete standalone HTML for All Buildings Portfolio Consolidated Report.
 * - In 'preview' mode: Paper-style preview card with sticky Tenant Name column and pinch-to-zoom.
 * - In 'pdf' mode: Static placement optimized for system print dialog & A4 landscape PDF download.
 */
export function buildConsolidatedReportHtml(
  year: number,
  consolidated: ConsolidatedRentReportResult,
  modeOrOptions: 'preview' | 'pdf' | BuildReportHtmlOptions = 'preview'
): string {
  const mode = typeof modeOrOptions === 'string' ? modeOrOptions : (modeOrOptions.mode || 'preview');
  const isPreview = mode === 'preview';

  const generatedDate = new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  // 1. Executive Summary Table Rows for each building
  const overviewRowsHtml = consolidated.buildings
    .map((b, idx) => {
      const p = b.property;
      const rowBg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
      return `
        <tr style="background-color: ${rowBg};">
          <td style="text-align: center; font-weight: 700;">${idx + 1}</td>
          <td class="left-align bldg-col" style="font-weight: 700; color: #701A24;">${p.building_name}</td>
          <td class="left-align" style="color: #64748b;">${p.location || p.building_address || '—'}</td>
          <td style="text-align: center; font-weight: 600;">${p.units || '—'}</td>
          <td style="text-align: center; font-weight: 600;">${b.report.rows.length}</td>
          <td class="right-align total-paid-col">₹${formatIndianCurrency(b.totalPaid)}</td>
          <td class="right-align total-pending-col ${b.totalPending > 0 ? 'pending-alert' : ''}">${b.totalPending > 0 ? `₹${formatIndianCurrency(b.totalPending)}` : '—'}</td>
        </tr>
      `;
    })
    .join('');

  // 2. Month-by-month portfolio totals cells
  const portfolioMonthlyCells = MONTH_SHORT.map((_, mIdx) => {
    const colAmt = consolidated.monthlyCollected[mIdx];
    return `<td class="totals-col">${colAmt > 0 ? `₹${formatIndianCurrency(colAmt)}` : '—'}</td>`;
  }).join('');

  // 3. Detailed sections for each building
  const buildingSectionsHtml = consolidated.buildings
    .map((b, bIdx) => {
      const p = b.property;
      const tenantRowsHtml =
        b.report.rows.length === 0
          ? `<tr><td colspan="16" style="text-align: center; color: #94a3b8; padding: 12px; font-style: italic;">No active tenants registered in ${p.building_name} for ${year}</td></tr>`
          : b.report.rows
            .map((row, idx) => {
              let tenantPaidTotal = 0;
              let tenantPendingTotal = 0;

              const monthCells = MONTH_SHORT.map((_, mIdx) => {
                const monthData = row.months[mIdx];
                const status = monthData?.status || 'upcoming';
                const rent = row.tenant.rent_amount || 0;
                const totalAmount =
                  monthData?.record?.total_amount ?? monthData?.record?.amount ?? rent;

                let paid = 0;
                let due = 0;
                let cellText = '—';
                let cellClass = 'cell-upcoming';
                let dateText = '';

                if (status === 'paid') {
                  paid = monthData?.record?.paid_amount ?? (totalAmount > 0 ? totalAmount : rent);
                  cellText = `₹${formatIndianCurrency(paid)}`;
                  cellClass = 'cell-paid';
                  dateText = getMonthPaymentDate(monthData);
                } else if (status === 'not_paid') {
                  due = totalAmount;
                  cellText = 'Due';
                  cellClass = 'cell-due';
                } else if (status === 'partial') {
                  paid = monthData?.record?.paid_amount ?? 0;
                  due = Math.max(0, totalAmount - paid);
                  cellText = `₹${formatIndianCurrency(paid)}`;
                  cellClass = 'cell-partial';
                  dateText = getMonthPaymentDate(monthData);
                }

                tenantPaidTotal += paid;
                tenantPendingTotal += due;

                const dateHtml = dateText ? `<div class="cell-date">${dateText}</div>` : '';
                return `<td class="data-cell ${cellClass}"><div class="cell-status">${cellText}</div>${dateHtml}</td>`;
              }).join('');

              const rowBg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
              const cleanFlat = formatFlatNumber(row.tenant.flat_number) || row.displayFlat || '—';
              return `
                  <tr style="background-color: ${rowBg};">
                    <td class="left-align tenant-name" title="${row.tenant.name || 'Tenant'}">${row.tenant.name || 'Tenant'}</td>
                    <td class="flat-num">${cleanFlat}</td>
                    ${monthCells}
                    <td class="right-align total-paid-col">₹${formatIndianCurrency(tenantPaidTotal)}</td>
                    <td class="right-align total-pending-col ${tenantPendingTotal > 0 ? 'pending-alert' : ''}">${tenantPendingTotal > 0 ? `₹${formatIndianCurrency(tenantPendingTotal)}` : '—'}</td>
                  </tr>
                `;
            })
            .join('');

      const buildingMonthlyCells = MONTH_SHORT.map((_, mIdx) => {
        const amt = b.monthlyCollected[mIdx];
        return `<td class="totals-col">${amt > 0 ? `₹${formatIndianCurrency(amt)}` : '—'}</td>`;
      }).join('');

      return `
        <div class="building-section">
          <div class="building-section-header">
            <div class="building-section-title">
              <span class="building-idx">#${bIdx + 1}</span>
              <span class="building-name">${p.building_name}</span>
              ${p.location || p.building_address ? `<span class="building-loc">• ${p.location || p.building_address}</span>` : ''}
              <span class="building-units-pill">${p.units || 1} Units • ${b.report.rows.length} Active Tenants</span>
            </div>
            <div class="building-subtotals-pill">
              <span>Collected: <strong class="green">₹${formatIndianCurrency(b.totalPaid)}</strong></span>
              <span style="margin: 0 4px; color: #cbd5e1;">|</span>
              <span>Pending: <strong class="${b.totalPending > 0 ? 'red' : ''}">${b.totalPending > 0 ? `₹${formatIndianCurrency(b.totalPending)}` : '₹0'}</strong></span>
            </div>
          </div>

          <div class="scroll-wrapper">
            <table>
              <thead>
                <tr>
                  <th class="left-align tenant-head" style="width: 14%;">Tenant Name</th>
                  <th class="flat-head" style="width: 7%;">Flat</th>
                  ${MONTH_SHORT.map((m) => `<th class="month-head" style="width: 4.8%;">${m}</th>`).join('')}
                  <th class="right-align total-paid-col" style="width: 10.7%;">Total Paid</th>
                  <th class="right-align total-pending-col" style="width: 10.7%;">Pending</th>
                </tr>
              </thead>
              <tbody>
                ${tenantRowsHtml}
              </tbody>
              <tfoot>
                <tr class="totals-row">
                  <td class="left-align tenant-name" style="font-weight: 800;">Building Subtotal</td>
                  <td style="color: #64748b;">—</td>
                  ${buildingMonthlyCells}
                  <td class="right-align total-paid-col" style="color: #166534; font-weight: 800;">₹${formatIndianCurrency(b.totalPaid)}</td>
                  <td class="right-align total-pending-col" style="color: ${b.totalPending > 0 ? '#991b1b' : '#64748b'}; font-weight: 800;">${b.totalPending > 0 ? `₹${formatIndianCurrency(b.totalPending)}` : '—'}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      `;
    })
    .join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes">
  <title>SRM Properties - All Buildings Rent Report (${year})</title>
  <style>
    @page {
      size: A4 landscape;
      margin: 8mm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      margin: 0;
      padding: ${isPreview ? '12px' : '0'};
      font-size: 9px;
    }
    .header-box {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      border-bottom: 2.5px solid #701A24;
      padding-bottom: 8px;
      margin-bottom: 12px;
    }
    .brand-title {
      font-size: 16px;
      font-weight: 800;
      color: #701A24;
      margin: 0 0 2px 0;
      letter-spacing: -0.3px;
    }
    .sub-line {
      font-size: 9px;
      color: #64748b;
      margin: 0;
    }
    .summary-strip {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .summary-pill {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 3px 6px;
      font-size: 8.5px;
      color: #475569;
    }
    .summary-pill strong {
      color: #0f172a;
    }
    .summary-pill strong.green {
      color: #166534;
    }
    .summary-pill strong.red {
      color: #991b1b;
    }

    .executive-card {
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 8px 10px;
      margin-bottom: 14px;
      page-break-inside: avoid;
    }
    .executive-title {
      font-size: 10px;
      font-weight: 800;
      color: #1e293b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .building-section {
      margin-bottom: 14px;
      page-break-inside: avoid;
    }
    .building-section-header {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-bottom: none;
      border-top-left-radius: 6px;
      border-top-right-radius: 6px;
      padding: 5px 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .building-section-title {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .building-idx {
      background: #701A24;
      color: #ffffff;
      font-weight: 800;
      font-size: 8px;
      padding: 2px 4px;
      border-radius: 3px;
    }
    .building-name {
      font-size: 10.5px;
      font-weight: 800;
      color: #0f172a;
    }
    .building-loc {
      font-size: 8.5px;
      color: #64748b;
    }
    .building-units-pill {
      background: #e2e8f0;
      color: #334155;
      font-size: 8px;
      font-weight: 700;
      padding: 2px 5px;
      border-radius: 3px;
      margin-left: 4px;
    }
    .building-subtotals-pill {
      font-size: 8.5px;
      color: #475569;
    }

    .scroll-wrapper {
      ${
        isPreview
          ? `
      overflow-x: auto;
      overflow-y: visible;
      -webkit-overflow-scrolling: touch;
      width: 100%;
      border: 1px solid #cbd5e1;
      border-radius: 0 0 6px 6px;
      `
          : `
      width: 100%;
      border: 1px solid #cbd5e1;
      border-radius: 0 0 6px 6px;
      `
      }
    }

    table {
      border-collapse: separate;
      border-spacing: 0;
      width: 100%;
      ${isPreview ? 'min-width: 920px;' : 'table-layout: fixed;'}
      font-size: 8.5px;
      background: #ffffff;
    }
    thead {
      display: table-header-group;
    }
    tfoot {
      display: table-footer-group;
    }
    tr {
      page-break-inside: avoid;
    }
    th {
      background-color: #6B2D3A;
      color: #ffffff;
      font-weight: 700;
      font-size: 8px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      border-right: 1px solid #58242F;
      border-bottom: 1px solid #58242F;
      padding: 5px 2px;
      text-align: center;
    }
    th.left-align {
      text-align: left;
      padding-left: 6px;
    }
    th.right-align {
      text-align: right;
      padding-right: 6px;
    }
    td {
      border-right: 1px solid #cbd5e1;
      border-bottom: 1px solid #cbd5e1;
      padding: 3px 2px;
      text-align: center;
      vertical-align: middle;
      font-size: 8.5px;
    }
    td.left-align {
      text-align: left;
      padding-left: 6px;
    }
    td.right-align {
      text-align: right;
      padding-right: 6px;
    }

    /* FIXED / STICKY TENANT COLUMN IN PREVIEW */
    ${
      isPreview
        ? `
    th.tenant-head, td.tenant-name {
      position: sticky;
      left: 0;
      z-index: 2;
      background-color: #ffffff;
      box-shadow: 2px 0 4px rgba(0,0,0,0.06);
    }
    th.tenant-head {
      background-color: #6B2D3A !important;
      color: #ffffff !important;
      z-index: 3;
    }
    `
        : `
    th.tenant-head, td.tenant-name {
      position: static;
    }
    `
    }

    .tenant-name {
      font-weight: 700;
      color: #0f172a;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 120px;
    }
    .flat-num {
      font-weight: 600;
      color: #475569;
    }

    .data-cell {
      height: 26px;
      padding: 2px 1px;
    }
    .cell-status {
      font-weight: 700;
      font-size: 7.5px;
      line-height: 1.1;
      white-space: nowrap;
    }
    .cell-date {
      font-size: 6px;
      font-weight: 600;
      margin-top: 1px;
      line-height: 1;
      letter-spacing: -0.2px;
      white-space: nowrap;
    }
    .cell-paid {
      background-color: #dcfce7 !important;
      color: #166534;
      font-weight: 700;
    }
    .cell-paid .cell-date {
      color: #15803d;
    }
    .cell-due {
      background-color: #fee2e2 !important;
      color: #991b1b;
      font-weight: 700;
    }
    .cell-partial {
      background-color: #fef3c7 !important;
      color: #92400e;
      font-weight: 700;
      font-size: 7.5px;
    }
    .cell-partial .cell-date {
      color: #b45309;
    }
    .cell-upcoming {
      background-color: #f8fafc;
      color: #94a3b8;
    }

    .total-paid-col {
      font-weight: 700;
      color: #166534;
    }
    .total-pending-col {
      font-weight: 600;
      color: #64748b;
    }
    .total-pending-col.pending-alert {
      color: #991b1b;
      font-weight: 700;
    }
    .totals-row td {
      background-color: #f1f5f9 !important;
      font-weight: 800;
      color: #0f172a;
      border-top: 2px solid #94a3b8;
      border-bottom: 2px solid #94a3b8;
      font-size: 8.5px;
    }
    .totals-col {
      font-size: 7.5px;
      font-weight: 700;
    }

    .grand-totals-card {
      background: #faf5ff;
      border: 2px solid #701A24;
      border-radius: 8px;
      padding: 8px 12px;
      margin-top: 16px;
      page-break-inside: avoid;
    }
    .grand-totals-header {
      font-size: 11px;
      font-weight: 800;
      color: #701A24;
      margin-bottom: 6px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .legend-box {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 12px;
      padding: 5px 10px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      font-size: 8px;
      color: #475569;
      page-break-inside: avoid;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .legend-chip {
      display: inline-block;
      padding: 2px 5px;
      border-radius: 3px;
      font-size: 7.5px;
      font-weight: 700;
    }
    .chip-paid {
      background: #dcfce7;
      color: #166534;
      border: 1px solid #bbf7d0;
    }
    .chip-due {
      background: #fee2e2;
      color: #991b1b;
      border: 1px solid #fecaca;
    }
    .chip-partial {
      background: #fef3c7;
      color: #92400e;
      border: 1px solid #fde68a;
    }
    .chip-upcoming {
      background: #f8fafc;
      color: #94a3b8;
      border: 1px solid #e2e8f0;
    }

    .footer {
      display: flex;
      justify-content: space-between;
      margin-top: 10px;
      padding-top: 5px;
      border-top: 1px solid #e2e8f0;
      font-size: 7.5px;
      color: #94a3b8;
    }

    @media print {
      body {
        padding: 0;
      }
      .scroll-wrapper {
        border: none;
        overflow: visible;
      }
      th.tenant-head, td.tenant-name {
        position: static !important;
        box-shadow: none !important;
      }
      th.tenant-head {
        background-color: #6B2D3A !important;
        color: #ffffff !important;
      }
    }
  </style>
</head>
<body>
  <div class="header-box">
    <div>
      <h1 class="brand-title">SRM Properties — Portfolio Consolidated Rent Report (${year})</h1>
      <p class="sub-line">Generated on ${generatedDate} • Complete Multi-Property Annual Statement</p>
    </div>
    <div class="summary-strip">
      <div class="summary-pill">Total Buildings: <strong>${consolidated.buildings.length}</strong></div>
      <div class="summary-pill">Total Units: <strong>${consolidated.totalUnits}</strong></div>
      <div class="summary-pill">Total Tenants: <strong>${consolidated.totalTenants}</strong></div>
      <div class="summary-pill">Portfolio Collected: <strong class="green">₹${formatIndianCurrency(consolidated.totalPaid)}</strong></div>
      <div class="summary-pill">Portfolio Pending: <strong class="red">₹${formatIndianCurrency(consolidated.totalPending)}</strong></div>
    </div>
  </div>

  <!-- Executive Summary Overview Table -->
  <div class="executive-card">
    <div class="executive-title">
      <span>Property Portfolio Summary</span>
      <span style="font-size: 9px; color: #64748b; font-weight: 500;">Year ${year}</span>
    </div>
    <div class="scroll-wrapper">
      <table>
        <thead>
          <tr>
            <th style="width: 5%;">#</th>
            <th class="left-align" style="width: 25%;">Property Name</th>
            <th class="left-align" style="width: 28%;">Location / Address</th>
            <th style="width: 8%;">Units</th>
            <th style="width: 8%;">Tenants</th>
            <th class="right-align" style="width: 13%;">Total Collected</th>
            <th class="right-align" style="width: 13%;">Pending Dues</th>
          </tr>
        </thead>
        <tbody>
          ${overviewRowsHtml}
        </tbody>
        <tfoot>
          <tr class="totals-row">
            <td colspan="3" class="left-align" style="font-weight: 800;">PORTFOLIO TOTAL (${consolidated.buildings.length} PROPERTIES)</td>
            <td style="font-weight: 800; text-align: center;">${consolidated.totalUnits}</td>
            <td style="font-weight: 800; text-align: center;">${consolidated.totalTenants}</td>
            <td class="right-align" style="color: #166534; font-weight: 800;">₹${formatIndianCurrency(consolidated.totalPaid)}</td>
            <td class="right-align" style="color: ${consolidated.totalPending > 0 ? '#991b1b' : '#64748b'}; font-weight: 800;">${consolidated.totalPending > 0 ? `₹${formatIndianCurrency(consolidated.totalPending)}` : '—'}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>

  <!-- Detailed Property Statements -->
  ${buildingSectionsHtml}

  <!-- Grand Portfolio Monthly Summary Row -->
  <div class="grand-totals-card">
    <div class="grand-totals-header">
      <span>PORTFOLIO MONTHLY TOTALS (ALL BUILDINGS COMBINED)</span>
      <span>Annual Total: ₹${formatIndianCurrency(consolidated.totalPaid)}</span>
    </div>
    <div class="scroll-wrapper">
      <table>
        <thead>
          <tr>
            <th class="left-align" style="width: 21%;">Metric</th>
            ${MONTH_SHORT.map((m) => `<th style="width: 4.8%;">${m}</th>`).join('')}
            <th class="right-align" style="width: 10.7%;">Total Paid</th>
            <th class="right-align" style="width: 10.7%;">Total Pending</th>
          </tr>
        </thead>
        <tbody>
          <tr class="totals-row">
            <td class="left-align" style="font-weight: 800; color: #701A24;">Monthly Collections</td>
            ${portfolioMonthlyCells}
            <td class="right-align" style="color: #166534; font-weight: 800;">₹${formatIndianCurrency(consolidated.totalPaid)}</td>
            <td class="right-align" style="color: ${consolidated.totalPending > 0 ? '#991b1b' : '#64748b'}; font-weight: 800;">${consolidated.totalPending > 0 ? `₹${formatIndianCurrency(consolidated.totalPending)}` : '—'}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <div class="legend-box">
    <strong>Legend:</strong>
    <span class="legend-item"><span class="legend-chip chip-paid">Paid</span> Paid in Full</span>
    <span class="legend-item"><span class="legend-chip chip-due">Due</span> Unpaid / Overdue</span>
    <span class="legend-item"><span class="legend-chip chip-partial">₹ Amt</span> Partial Payment</span>
    <span class="legend-item"><span class="legend-chip chip-upcoming">-</span> Not Started / Upcoming</span>
  </div>

  <div class="footer">
    <span>Confidential • SRM Properties Complete Portfolio Rent Statement (${year})</span>
    <span>Generated via SRM Properties App</span>
  </div>
</body>
</html>
  `;
}

