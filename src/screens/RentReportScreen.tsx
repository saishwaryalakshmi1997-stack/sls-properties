import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  BackHandler,
  RefreshControl,
  Platform,
  Modal,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { Toast } from '../components/Toast';
import {
  PropertyWithCounts,
  RentReportResult,
  RentReportMonthStatus,
  RentReportMonthData,
  MONTH_SHORT,
  getPropertiesWithCounts,
  getRentReportForProperty,
} from '../db/database';
import { Colors } from '../theme/colors';

const ROW_HEIGHT = 44;
const HEADER_HEIGHT = 40;
const NAME_COL_WIDTH = 110;
const FLAT_COL_WIDTH = 75;
const MONTH_COL_WIDTH = 52;

function formatReportPaymentDate(rawDate?: string): string {
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
  } catch { }

  return clean;
}

function getMonthPaymentDate(monthData?: RentReportMonthData): string {
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

function buildReportHtml(
  property: PropertyWithCounts,
  year: number,
  report: RentReportResult
): string {
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
          paid = monthData?.record?.paid_amount ?? totalAmount;
          cellText = paid > 0 && paid !== rent ? `₹${paid.toLocaleString('en-IN')}` : 'Paid';
          cellClass = 'cell-paid';
          dateText = getMonthPaymentDate(monthData);
        } else if (status === 'not_paid') {
          due = totalAmount;
          cellText = 'Due';
          cellClass = 'cell-due';
        } else if (status === 'partial') {
          paid = monthData?.record?.paid_amount ?? 0;
          due = Math.max(0, totalAmount - paid);
          cellText = paid > 0 ? `₹${paid.toLocaleString('en-IN')}` : 'Part';
          cellClass = 'cell-partial';
          dateText = getMonthPaymentDate(monthData);
        }

        tenantPaidTotal += paid;
        tenantPendingTotal += due;
        monthlyCollected[mIdx] += paid;
        monthlyDue[mIdx] += due;

        const dateHtml = dateText ? `<div class="cell-date">${dateText}</div>` : '';
        return `<td class="${cellClass}"><div class="cell-status">${cellText}</div>${dateHtml}</td>`;
      }).join('');

      overallTotalPaid += tenantPaidTotal;
      overallTotalPending += tenantPendingTotal;

      const rowBg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';

      return `
        <tr style="background-color: ${rowBg};">
          <td class="left-align tenant-name" title="${row.tenant.name || 'Tenant'}">${row.tenant.name || 'Tenant'}</td>
          <td class="flat-num">${row.displayFlat}</td>
          ${monthCells}
          <td class="right-align total-paid-col">₹${tenantPaidTotal.toLocaleString('en-IN')}</td>
          <td class="right-align total-pending-col ${tenantPendingTotal > 0 ? 'pending-alert' : ''}">${tenantPendingTotal > 0 ? `₹${tenantPendingTotal.toLocaleString('en-IN')}` : '—'}</td>
        </tr>
      `;
    })
    .join('');

  const monthlyTotalsCells = MONTH_SHORT.map((_, mIdx) => {
    const colAmt = monthlyCollected[mIdx];
    return `<td class="totals-col">${colAmt > 0 ? `₹${colAmt.toLocaleString('en-IN')}` : '—'}</td>`;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Rent Report: ${property.building_name} (${year})</title>
  <style>
    @page {
      size: A4 landscape;
      margin: 12mm;
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
      padding: 0;
      font-size: 9.5px;
    }
    .header-box {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      border-bottom: 2px solid #701A24;
      padding-bottom: 10px;
      margin-bottom: 12px;
    }
    .brand-title {
      font-size: 18px;
      font-weight: 800;
      color: #701A24;
      margin: 0 0 4px 0;
      letter-spacing: -0.3px;
    }
    .sub-line {
      font-size: 10px;
      color: #64748b;
      margin: 0;
    }
    .summary-strip {
      display: flex;
      gap: 12px;
    }
    .summary-pill {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 4px 10px;
      font-size: 9.5px;
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
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 9px;
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
      background-color: #f1f5f9;
      color: #334155;
      font-weight: 700;
      font-size: 8.5px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      border: 1px solid #cbd5e1;
      padding: 6px 3px;
      text-align: center;
    }
    th.left-align {
      text-align: left;
      padding-left: 8px;
    }
    th.right-align {
      text-align: right;
      padding-right: 8px;
    }
    td {
      border: 1px solid #e2e8f0;
      padding: 3px 2px;
      text-align: center;
      vertical-align: middle;
      height: 28px;
      font-size: 9px;
    }
    td.left-align {
      text-align: left;
      padding-left: 8px;
    }
    td.right-align {
      text-align: right;
      padding-right: 8px;
    }
    .tenant-name {
      font-weight: 600;
      color: #0f172a;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 110px;
    }
    .flat-num {
      font-weight: 600;
      color: #475569;
    }
    .cell-status {
      font-weight: 700;
      line-height: 1.1;
    }
    .cell-date {
      font-size: 6.5px;
      font-weight: 600;
      margin-top: 1.5px;
      line-height: 1;
      letter-spacing: -0.2px;
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
      font-size: 8.5px;
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
      font-size: 9px;
    }
    .totals-col {
      font-size: 8.5px;
      font-weight: 700;
    }
    .legend-box {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-top: 12px;
      padding: 6px 12px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      font-size: 9px;
      color: #475569;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .legend-chip {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 8.5px;
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
      padding-top: 6px;
      border-top: 1px solid #e2e8f0;
      font-size: 8.5px;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <div class="header-box">
    <div>
      <h1 class="brand-title">Rent Report: ${property.building_name} (${year})</h1>
      <p class="sub-line">Generated on ${generatedDate}${property.building_address ? ` • ${property.building_address}` : ''}</p>
    </div>
    <div class="summary-strip">
      <div class="summary-pill">Active Tenants: <strong>${report.rows.length}</strong></div>
      <div class="summary-pill">Total Collected: <strong class="green">₹${overallTotalPaid.toLocaleString('en-IN')}</strong></div>
      <div class="summary-pill">Pending Dues: <strong class="red">₹${overallTotalPending.toLocaleString('en-IN')}</strong></div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th class="left-align" style="width: 14%;">Name</th>
        <th style="width: 7%;">Flat</th>
        ${MONTH_SHORT.map((m) => `<th style="width: 4.8%;">${m}</th>`).join('')}
        <th class="right-align" style="width: 10.7%;">Total Paid</th>
        <th class="right-align" style="width: 10.7%;">Pending</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
    <tfoot>
      <tr class="totals-row">
        <td class="left-align" style="font-weight: 800;">Monthly Total</td>
        <td style="color: #64748b;">—</td>
        ${monthlyTotalsCells}
        <td class="right-align" style="color: #166534; font-weight: 800;">₹${overallTotalPaid.toLocaleString('en-IN')}</td>
        <td class="right-align" style="color: ${overallTotalPending > 0 ? '#991b1b' : '#64748b'}; font-weight: 800;">${overallTotalPending > 0 ? `₹${overallTotalPending.toLocaleString('en-IN')}` : '—'}</td>
      </tr>
    </tfoot>
  </table>

  <div class="legend-box">
    <strong>Legend:</strong>
    <span class="legend-item"><span class="legend-chip chip-paid">Paid</span> Paid in Full</span>
    <span class="legend-item"><span class="legend-chip chip-due">Due</span> Unpaid / Overdue</span>
    <span class="legend-item"><span class="legend-chip chip-partial">₹ Amt</span> Partial Payment</span>
    <span class="legend-item"><span class="legend-chip chip-upcoming">-</span> Not Started / Upcoming</span>
  </div>

  <div class="footer">
    <span>Confidential • ${property.building_name} Annual Rent Statement</span>
    <span>Generated via SLS Rent App</span>
  </div>
</body>
</html>
  `;
}

// Backward compatibility alias
const generateReportHtml = buildReportHtml;

export default function RentReportScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();

  const [loadingProperties, setLoadingProperties] = useState(true);
  const [properties, setProperties] = useState<PropertyWithCounts[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // Selected property & year
  const [selectedProperty, setSelectedProperty] = useState<PropertyWithCounts | null>(null);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());

  // Report data
  const [loadingReport, setLoadingReport] = useState(false);
  const [reportData, setReportData] = useState<RentReportResult | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  // In-App PDF Document Viewer states
  const [isPdfViewerOpen, setIsPdfViewerOpen] = useState(false);
  const [viewerZoom, setViewerZoom] = useState(1);
  const [downloadedFileName, setDownloadedFileName] = useState('');
  const [downloadedFileUri, setDownloadedFileUri] = useState<string | null>(null);

  // Computed summary totals for the Document Viewer
  const viewerTotals = React.useMemo(() => {
    if (!reportData) return { collected: new Array(12).fill(0), due: new Array(12).fill(0), totalPaid: 0, totalDue: 0 };
    const collected = new Array(12).fill(0);
    const due = new Array(12).fill(0);
    let totalPaid = 0;
    let totalDue = 0;

    reportData.rows.forEach((row) => {
      const rent = row.tenant.rent_amount || 0;
      for (let idx = 0; idx < 12; idx++) {
        const m = row.months[idx];
        if (!m) continue;
        const totalAmount = m.record?.total_amount ?? m.record?.amount ?? rent;
        if (m.status === 'paid') {
          const paidAmt = m.record?.paid_amount ?? totalAmount;
          collected[idx] += paidAmt;
          totalPaid += paidAmt;
        } else if (m.status === 'not_paid') {
          due[idx] += totalAmount;
          totalDue += totalAmount;
        } else if (m.status === 'partial') {
          const amt = m.record?.paid_amount ?? 0;
          const dueAmt = Math.max(0, totalAmount - amt);
          collected[idx] += amt;
          due[idx] += dueAmt;
          totalPaid += amt;
          totalDue += dueAmt;
        }
      }
    });

    return { collected, due, totalPaid, totalDue };
  }, [reportData]);

  // Download PDF handler
  const handleDownloadPdf = async () => {
    if (!selectedProperty || !reportData) {
      Toast.info('No Data', 'No report data available to download.');
      return;
    }
    if (reportData.rows.length === 0) {
      Toast.info('Empty Report', 'There are no active tenants to generate a report for.');
      return;
    }
    try {
      setIsExportingPdf(true);
      const html = buildReportHtml(selectedProperty, selectedYear, reportData);

      // Generate PDF in A4 landscape format (842 x 595 points) with base64 data
      const printResult = await Print.printToFileAsync({
        html,
        width: 842,
        height: 595,
        base64: true,
      });

      // Target filename
      const safeProp = (selectedProperty.building_name || 'Property')
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '_');
      const fileName = `Rent-Report_${safeProp}_${selectedYear}.pdf`;
      const base64 = printResult.base64;

      let savedToDocuments = false;
      let finalFileUri = printResult.uri;

      // 1. Save locally to app documents directory if FileSystem available
      try {
        if (FileSystem?.documentDirectory && FileSystem?.writeAsStringAsync && base64) {
          const localUri = `${FileSystem.documentDirectory}${fileName}`;
          await FileSystem.writeAsStringAsync(localUri, base64, {
            encoding: FileSystem.EncodingType.Base64,
          });
          finalFileUri = localUri;
        }
      } catch (saveLocalErr) {
        console.warn('[RentReport] Local document save warning:', saveLocalErr);
      }

      // 2. On Android, save directly into the device's public Documents/Downloads folder via StorageAccessFramework
      if (
        Platform.OS === 'android' &&
        base64 &&
        FileSystem?.StorageAccessFramework?.requestDirectoryPermissionsAsync &&
        FileSystem?.StorageAccessFramework?.createFileAsync
      ) {
        try {
          const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
          if (permissions.granted) {
            const safFileUri = await FileSystem.StorageAccessFramework.createFileAsync(
              permissions.directoryUri,
              `Rent-Report_${safeProp}_${selectedYear}`,
              'application/pdf'
            );
            await FileSystem.writeAsStringAsync(safFileUri, base64, {
              encoding: FileSystem.EncodingType.Base64,
            });
            savedToDocuments = true;
          }
        } catch (safErr) {
          console.warn('[RentReport] StorageAccessFramework save error/cancel:', safErr);
        }
      }

      // Store downloaded document info for in-app viewer
      setDownloadedFileName(fileName);
      setDownloadedFileUri(finalFileUri);

      // 3. Show toast with "View" action button (opens the in-app document viewer directly)
      Toast.show({
        type: 'success',
        title: 'PDF Downloaded',
        message: savedToDocuments
          ? `Saved to Documents: ${fileName}`
          : fileName,
        duration: 9000,
        action: {
          label: 'View',
          onPress: () => {
            setIsPdfViewerOpen(true);
          },
        },
      });
    } catch (err: any) {
      console.error('[RentReport] PDF Export error:', err);
      Toast.error('PDF Export Error', err?.message || 'Could not generate PDF.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  // Return back to buildings list and lock back to portrait
  const handleBackToBuildings = useCallback(async () => {
    setSelectedProperty(null);
    if (route.params?.propertyId) {
      navigation.setParams({ propertyId: undefined });
    }
    try {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    } catch (e) {
      console.warn('[RentReport] Error locking to portrait:', e);
    }
  }, [navigation, route.params?.propertyId]);

  // Load properties list
  const loadProperties = async () => {
    try {
      setLoadingProperties(true);
      const list = await getPropertiesWithCounts();
      setProperties(list);

      // If a propertyId was passed in route params, auto-select it
      if (route.params?.propertyId) {
        const matched = list.find((p) => p.id === route.params.propertyId);
        if (matched) {
          setSelectedProperty(matched);
        }
      }
    } catch (err) {
      console.error('[RentReport] Error loading properties:', err);
    } finally {
      setLoadingProperties(false);
      setRefreshing(false);
    }
  };

  // Load report data for selected property & year
  const loadReport = useCallback(async (propertyId: number, year: number) => {
    try {
      setLoadingReport(true);
      const data = await getRentReportForProperty(propertyId, year);
      setReportData(data);
    } catch (err) {
      console.error('[RentReport] Error loading report:', err);
    } finally {
      setLoadingReport(false);
    }
  }, []);

  // Lock orientation when selectedProperty changes
  useEffect(() => {
    let active = true;

    const syncOrientation = async () => {
      try {
        if (selectedProperty) {
          // Lock just the Report screen to landscape
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
          if (active) {
            navigation.setOptions({
              tabBarStyle: { display: 'none' },
            });
          }
        } else {
          // Rest of the app stays portrait
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
          if (active) {
            navigation.setOptions({
              tabBarStyle: undefined,
            });
          }
        }
      } catch (err) {
        console.warn('[RentReport] Orientation lock error:', err);
      }
    };

    syncOrientation();

    return () => {
      active = false;
    };
  }, [selectedProperty, navigation]);

  // Keep screen orientation & tab bar consistent with focus/blur
  useFocusEffect(
    useCallback(() => {
      loadProperties();

      if (selectedProperty) {
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => { });
        navigation.setOptions({
          tabBarStyle: { display: 'none' },
        });
      } else {
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => { });
        navigation.setOptions({
          tabBarStyle: undefined,
        });
      }

      return () => {
        // When leaving the screen / navigating to another tab, always restore portrait orientation
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => { });
        navigation.setOptions({
          tabBarStyle: undefined,
        });
      };
    }, [selectedProperty, navigation])
  );

  // Reload report when selectedProperty or selectedYear changes
  useEffect(() => {
    if (selectedProperty) {
      loadReport(selectedProperty.id, selectedYear);
    } else {
      setReportData(null);
    }
  }, [selectedProperty, selectedYear, loadReport]);

  // Handle hardware back button on Android
  useEffect(() => {
    const onBackPress = () => {
      if (selectedProperty) {
        handleBackToBuildings();
        return true;
      }
      return false;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => backHandler.remove();
  }, [selectedProperty, handleBackToBuildings]);

  const handleRefresh = () => {
    setRefreshing(true);
    if (selectedProperty) {
      loadReport(selectedProperty.id, selectedYear).then(() => setRefreshing(false));
    } else {
      loadProperties();
    }
  };

  const handlePrevYear = () => {
    setSelectedYear((prev) => prev - 1);
  };

  const handleNextYear = () => {
    setSelectedYear((prev) => prev + 1);
  };

  // Render individual month status cell
  const renderStatusCell = (status: RentReportMonthStatus) => {
    switch (status) {
      case 'paid':
        return (
          <MaterialCommunityIcons
            name="check"
            size={18}
            color="#16A34A"
          />
        );
      case 'not_paid':
        return (
          <MaterialCommunityIcons
            name="close"
            size={16}
            color="#DC2626"
          />
        );
      case 'partial':
        return <Text style={styles.partialText}>Part</Text>;
      case 'upcoming':
      default:
        return <Text style={styles.upcomingText}>—</Text>;
    }
  };

  // -------------------------------------------------------------
  // VIEW 1: REPORT VIEW (When a building is selected) - LIGHT MODE
  // -------------------------------------------------------------
  if (selectedProperty) {
    return (
      <View
        style={[
          styles.container,
          styles.reportContainer,
          {
            paddingTop: Math.max(insets.top, 8),
            paddingLeft: Math.max(insets.left, 16),
            paddingRight: Math.max(insets.right, 16),
            paddingBottom: Math.max(insets.bottom, 6),
          },
        ]}
      >
        {/* Top Back Navigation & Action Bar */}
        <View style={styles.reportNavRow}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={handleBackToBuildings}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="arrow-left" size={18} color="#334155" />
            <Text style={styles.backButtonText}>Buildings</Text>
          </TouchableOpacity>

          <View style={styles.landscapeBadge}>
            <MaterialCommunityIcons name="screen-rotation" size={14} color="#15803D" />
            <Text style={styles.landscapeBadgeText}>Landscape</Text>
          </View>
        </View>

        <ScrollView
          style={styles.flex1}
          contentContainerStyle={[styles.reportScrollContent, { paddingBottom: 24 }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={Colors.primary}
              colors={[Colors.primary]}
            />
          }
        >
          {/* Main Clean Light Card Container */}
          <View style={styles.reportCard}>
            {/* Header section with integrated Year Selector */}
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderTitles}>
                <Text style={styles.cardMainTitle}>Rent Report</Text>
                <Text style={styles.cardSubTitle}>{selectedProperty.building_name}</Text>
              </View>

              <View style={styles.cardHeaderRight}>
                {/* Year Selector */}
                <View style={styles.yearSelectorPill}>
                  <TouchableOpacity
                    onPress={handlePrevYear}
                    style={styles.yearArrowBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <MaterialCommunityIcons name="chevron-left" size={20} color="#334155" />
                  </TouchableOpacity>

                  <Text style={styles.yearText}>{selectedYear}</Text>

                  <TouchableOpacity
                    onPress={handleNextYear}
                    style={styles.yearArrowBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <MaterialCommunityIcons name="chevron-right" size={20} color="#334155" />
                  </TouchableOpacity>
                </View>

                {/* PDF quick action button in header */}
                <TouchableOpacity
                  style={[styles.cardPdfBtn, isExportingPdf && { opacity: 0.7 }]}
                  onPress={handleDownloadPdf}
                  disabled={isExportingPdf || !reportData || reportData.rows.length === 0}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  activeOpacity={0.8}
                >
                  {isExportingPdf ? (
                    <ActivityIndicator size="small" color={Colors.primary} />
                  ) : (
                    <MaterialCommunityIcons name="file-pdf-box" size={20} color={Colors.primary} />
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.cardCloseBtn}
                  onPress={handleBackToBuildings}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <MaterialCommunityIcons name="close" size={18} color="#64748B" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Report Table */}
            {loadingReport ? (
              <View style={styles.tableLoadingBox}>
                <ActivityIndicator size="small" color={Colors.primary} />
                <Text style={styles.loadingText}>Loading {selectedYear} report...</Text>
              </View>
            ) : !reportData || reportData.rows.length === 0 ? (
              <View style={styles.emptyTableBox}>
                <MaterialCommunityIcons name="account-group-outline" size={36} color="#94A3B8" />
                <Text style={styles.emptyTableTitle}>No active tenants found</Text>
                <Text style={styles.emptyTableSubtitle}>
                  Add tenants to {selectedProperty.building_name} to view the monthly report.
                </Text>
              </View>
            ) : (
              <View style={styles.tableOuterWrapper}>
                <View style={styles.tableContainer}>
                  {/* Left Fixed Columns: Name & Flat */}
                  <View style={styles.fixedColumnsWrapper}>
                    {/* Fixed Header */}
                    <View style={styles.tableHeaderRow}>
                      <View style={[styles.headerCell, { width: NAME_COL_WIDTH }]}>
                        <Text style={styles.headerCellText}>NAME</Text>
                      </View>
                      <View style={[styles.headerCell, { width: FLAT_COL_WIDTH }]}>
                        <Text style={styles.headerCellText}>FLAT</Text>
                      </View>
                    </View>

                    {/* Fixed Rows */}
                    {reportData.rows.map((row) => (
                      <View key={`fixed-${row.tenant.id}`} style={styles.tableDataRow}>
                        <View style={[styles.dataCell, { width: NAME_COL_WIDTH }]}>
                          <Text style={styles.nameCellText} numberOfLines={1} ellipsizeMode="tail">
                            {row.tenant.name}
                          </Text>
                        </View>
                        <View style={[styles.dataCell, { width: FLAT_COL_WIDTH }]}>
                          <Text style={styles.flatCellText} numberOfLines={1} ellipsizeMode="tail">
                            {row.displayFlat}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>

                  {/* Right Horizontally Scrollable Month Columns */}
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={true}
                    nestedScrollEnabled={true}
                    contentContainerStyle={styles.monthsScrollContent}
                  >
                    <View>
                      {/* Months Header Row */}
                      <View style={styles.tableHeaderRow}>
                        {MONTH_SHORT.map((m) => (
                          <View
                            key={`month-hdr-${m}`}
                            style={[styles.headerCell, styles.monthCell, { width: MONTH_COL_WIDTH }]}
                          >
                            <Text style={styles.headerCellText}>{m}</Text>
                          </View>
                        ))}
                      </View>

                      {/* Months Data Rows */}
                      {reportData.rows.map((row) => (
                        <View key={`months-${row.tenant.id}`} style={styles.tableDataRow}>
                          {MONTH_SHORT.map((_, mIdx) => {
                            const monthData = row.months[mIdx];
                            const status = monthData?.status || 'upcoming';
                            return (
                              <View
                                key={`cell-${row.tenant.id}-${mIdx}`}
                                style={[styles.dataCell, styles.monthCell, { width: MONTH_COL_WIDTH }]}
                              >
                                {renderStatusCell(status)}
                              </View>
                            );
                          })}
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                </View>

                {/* Table Footer Legend */}
                <View style={styles.legendContainer}>
                  <View style={styles.legendItem}>
                    <MaterialCommunityIcons name="check" size={16} color="#16A34A" />
                    <Text style={styles.legendText}>Paid</Text>
                  </View>

                  <View style={styles.legendItem}>
                    <MaterialCommunityIcons name="close" size={14} color="#DC2626" />
                    <Text style={styles.legendText}>Not paid</Text>
                  </View>

                  <View style={styles.legendItem}>
                    <Text style={styles.upcomingLegendSymbol}>—</Text>
                    <Text style={styles.legendText}>Upcoming</Text>
                  </View>

                  <View style={styles.legendItem}>
                    <Text style={styles.partialLegendSymbol}>Part</Text>
                    <Text style={styles.legendText}>Partial</Text>
                  </View>
                </View>
              </View>
            )}
          </View>
        </ScrollView>

        {/* Full-Screen In-App PDF Document Viewer Modal */}
        <Modal
          visible={isPdfViewerOpen}
          animationType="fade"
          onRequestClose={() => setIsPdfViewerOpen(false)}
          supportedOrientations={['landscape', 'portrait']}
        >
          <View style={styles.viewerModalContainer}>
            {/* Top Toolbar */}
            <View style={styles.viewerToolbar}>
              <TouchableOpacity
                style={styles.viewerCloseBtn}
                onPress={() => setIsPdfViewerOpen(false)}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons name="arrow-left" size={20} color="#FFFFFF" />
                <Text style={styles.viewerCloseText}>Close</Text>
              </TouchableOpacity>

              <View style={styles.viewerTitleBox}>
                <Text style={styles.viewerTitle} numberOfLines={1}>
                  {downloadedFileName || `Rent-Report_${selectedProperty.building_name}_${selectedYear}.pdf`}
                </Text>
                <Text style={styles.viewerSubtitle}>
                  A4 Landscape Document • Saved to Documents
                </Text>
              </View>

              <View style={styles.viewerActionsRight}>
                {/* Zoom Controls */}
                <View style={styles.zoomControls}>
                  <TouchableOpacity
                    style={styles.zoomBtn}
                    onPress={() => setViewerZoom((z) => Math.max(0.75, +(z - 0.15).toFixed(2)))}
                    disabled={viewerZoom <= 0.75}
                  >
                    <MaterialCommunityIcons name="magnify-minus-outline" size={18} color="#FFFFFF" />
                  </TouchableOpacity>
                  <Text style={styles.zoomLabel}>{Math.round(viewerZoom * 100)}%</Text>
                  <TouchableOpacity
                    style={styles.zoomBtn}
                    onPress={() => setViewerZoom((z) => Math.min(1.6, +(z + 0.15).toFixed(2)))}
                    disabled={viewerZoom >= 1.6}
                  >
                    <MaterialCommunityIcons name="magnify-plus-outline" size={18} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>

                {/* Share Button */}
                {!!downloadedFileUri && (
                  <TouchableOpacity
                    style={styles.viewerShareBtn}
                    onPress={async () => {
                      try {
                        if (await Sharing.isAvailableAsync()) {
                          await Sharing.shareAsync(downloadedFileUri, {
                            mimeType: 'application/pdf',
                            dialogTitle: downloadedFileName,
                            UTI: 'com.adobe.pdf',
                          });
                        }
                      } catch (err) {
                        console.error('[RentReport] Viewer share error:', err);
                      }
                    }}
                    activeOpacity={0.7}
                  >
                    <MaterialCommunityIcons name="share-variant-outline" size={16} color="#FFFFFF" />
                    <Text style={styles.viewerShareBtnText}>Share</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Document Preview Canvas */}
            <ScrollView
              style={styles.viewerCanvasScroll}
              contentContainerStyle={styles.viewerCanvasContent}
            >
              <ScrollView
                horizontal
                contentContainerStyle={styles.viewerHorizontalContent}
                showsHorizontalScrollIndicator={true}
              >
                <View
                  style={[
                    styles.pdfSheetPaper,
                    {
                      transform: [{ scale: viewerZoom }],
                    },
                  ]}
                >
                  {/* Sheet Header */}
                  <View style={styles.sheetHeader}>
                    <View style={styles.sheetHeaderLeft}>
                      <Text style={styles.sheetBrandTitle}>SLS PROPERTIES</Text>
                      <Text style={styles.sheetDocTitle}>
                        RENT REPORT — {(selectedProperty.building_name || '').toUpperCase()} ({selectedYear})
                      </Text>
                      <Text style={styles.sheetDocAddress}>
                        {selectedProperty.building_address || selectedProperty.location || 'Property Management Statement'}
                      </Text>
                    </View>
                    <View style={styles.sheetHeaderRight}>
                      <View style={styles.sheetBadge}>
                        <Text style={styles.sheetBadgeText}>ANNUAL STATEMENT</Text>
                      </View>
                      <Text style={styles.sheetDateText}>
                        Generated: {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </Text>
                    </View>
                  </View>

                  {/* Summary Metric Strip */}
                  <View style={styles.sheetKpiStrip}>
                    <View style={[styles.sheetKpiCard, { borderColor: '#86EFAC', backgroundColor: '#F0FDF4' }]}>
                      <Text style={[styles.sheetKpiLabel, { color: '#166534' }]}>TOTAL COLLECTED</Text>
                      <Text style={[styles.sheetKpiValue, { color: '#15803D' }]}>
                        ₹{viewerTotals.totalPaid.toLocaleString('en-IN')}
                      </Text>
                    </View>

                    <View style={[styles.sheetKpiCard, { borderColor: '#FECACA', backgroundColor: '#FEF2F2' }]}>
                      <Text style={[styles.sheetKpiLabel, { color: '#991B1B' }]}>TOTAL PENDING</Text>
                      <Text style={[styles.sheetKpiValue, { color: '#B91C1C' }]}>
                        ₹{viewerTotals.totalDue.toLocaleString('en-IN')}
                      </Text>
                    </View>

                    <View style={[styles.sheetKpiCard, { borderColor: '#E2E8F0', backgroundColor: '#F8FAFC' }]}>
                      <Text style={[styles.sheetKpiLabel, { color: '#475569' }]}>TOTAL TENANTS</Text>
                      <Text style={[styles.sheetKpiValue, { color: '#0F172A' }]}>
                        {reportData?.rows.length || 0}
                      </Text>
                    </View>
                  </View>

                  {/* Document Table */}
                  <View style={styles.sheetTable}>
                    {/* Table Header */}
                    <View style={styles.sheetTableHeaderRow}>
                      <Text style={[styles.sheetTh, { width: 60 }]}>Flat</Text>
                      <Text style={[styles.sheetTh, { width: 120 }]}>Tenant</Text>
                      {MONTH_SHORT.map((m) => (
                        <Text key={m} style={[styles.sheetTh, styles.sheetThMonth, { width: 52 }]}>
                          {m}
                        </Text>
                      ))}
                      <Text style={[styles.sheetTh, styles.sheetThNumber, { width: 90 }]}>Total Paid</Text>
                      <Text style={[styles.sheetTh, styles.sheetThNumber, { width: 90 }]}>Pending</Text>
                    </View>

                    {/* Table Rows */}
                    {reportData?.rows.map((row, idx) => {
                      let rowPaid = 0;
                      let rowDue = 0;
                      const rent = row.tenant.rent_amount || 0;

                      for (let mIdx = 0; mIdx < 12; mIdx++) {
                        const m = row.months[mIdx];
                        if (!m) continue;
                        const totalAmount = m.record?.total_amount ?? m.record?.amount ?? rent;
                        if (m.status === 'paid') {
                          rowPaid += (m.record?.paid_amount ?? totalAmount);
                        } else if (m.status === 'not_paid') {
                          rowDue += totalAmount;
                        } else if (m.status === 'partial') {
                          const p = m.record?.paid_amount ?? 0;
                          rowPaid += p;
                          rowDue += Math.max(0, totalAmount - p);
                        }
                      }

                      return (
                        <View
                          key={row.tenant.id}
                          style={[
                            styles.sheetTableRow,
                            idx % 2 === 1 && styles.sheetTableRowAlt,
                          ]}
                        >
                          <Text style={[styles.sheetTd, { width: 60, fontWeight: '700' }]}>
                            {row.tenant.flat_number || '—'}
                          </Text>
                          <Text style={[styles.sheetTd, { width: 120, fontWeight: '600' }]} numberOfLines={1}>
                            {row.tenant.name}
                          </Text>
                          {MONTH_SHORT.map((_, mIdx) => {
                            const mData = row.months[mIdx];
                            const status = mData?.status || 'upcoming';
                            const payDate = getMonthPaymentDate(mData);
                            const pAmt = mData?.record?.paid_amount ?? 0;
                            return (
                              <View key={mIdx} style={[styles.sheetTd, styles.sheetTdMonth, { width: 52 }]}>
                                {status === 'paid' ? (
                                  <View style={styles.sheetChipPaid}>
                                    <Text style={styles.sheetChipPaidText}>✓ Paid</Text>
                                    {payDate ? <Text style={styles.sheetChipPaidDate}>{payDate}</Text> : null}
                                  </View>
                                ) : status === 'not_paid' ? (
                                  <View style={styles.sheetChipDue}>
                                    <Text style={styles.sheetChipDueText}>✕ Due</Text>
                                  </View>
                                ) : status === 'partial' ? (
                                  <View style={styles.sheetChipPart}>
                                    <Text style={styles.sheetChipPartText}>
                                      {pAmt > 0 ? `₹${pAmt.toLocaleString('en-IN')}` : 'Part'}
                                    </Text>
                                    {payDate ? <Text style={styles.sheetChipPartDate}>{payDate}</Text> : null}
                                  </View>
                                ) : (
                                  <Text style={styles.sheetChipUpcomingText}>—</Text>
                                )}
                              </View>
                            );
                          })}
                          <Text style={[styles.sheetTd, styles.sheetTdNumber, { width: 90, color: '#16A34A', fontWeight: '700' }]}>
                            ₹{rowPaid.toLocaleString('en-IN')}
                          </Text>
                          <Text style={[styles.sheetTd, styles.sheetTdNumber, { width: 90, color: rowDue > 0 ? '#DC2626' : '#64748B', fontWeight: '700' }]}>
                            {rowDue > 0 ? `₹${rowDue.toLocaleString('en-IN')}` : '—'}
                          </Text>
                        </View>
                      );
                    })}

                    {/* Table Footer Totals */}
                    <View style={styles.sheetTableFooterRow}>
                      <Text style={[styles.sheetTf, { width: 180, fontWeight: '800' }]}>MONTHLY TOTALS</Text>
                      {MONTH_SHORT.map((_, mIdx) => (
                        <View key={mIdx} style={[styles.sheetTf, styles.sheetTdMonth, { width: 52 }]}>
                          <Text style={styles.sheetTfMonthText}>
                            {viewerTotals.collected[mIdx] > 0
                              ? `₹${viewerTotals.collected[mIdx] >= 1000 ? `${Math.round(viewerTotals.collected[mIdx] / 1000)}k` : viewerTotals.collected[mIdx]}`
                              : '—'}
                          </Text>
                        </View>
                      ))}
                      <Text style={[styles.sheetTf, styles.sheetTdNumber, { width: 90, color: '#15803D', fontWeight: '800' }]}>
                        ₹{viewerTotals.totalPaid.toLocaleString('en-IN')}
                      </Text>
                      <Text style={[styles.sheetTf, styles.sheetTdNumber, { width: 90, color: '#B91C1C', fontWeight: '800' }]}>
                        ₹{viewerTotals.totalDue.toLocaleString('en-IN')}
                      </Text>
                    </View>
                  </View>

                  {/* Sheet Legend & Footer */}
                  <View style={styles.sheetLegendRow}>
                    <View style={styles.sheetLegendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#16A34A' }]} />
                      <Text style={styles.sheetLegendLabel}>Paid in Full</Text>
                    </View>
                    <View style={styles.sheetLegendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#DC2626' }]} />
                      <Text style={styles.sheetLegendLabel}>Due / Pending</Text>
                    </View>
                    <View style={styles.sheetLegendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#D97706' }]} />
                      <Text style={styles.sheetLegendLabel}>Partial Payment</Text>
                    </View>
                    <View style={styles.sheetLegendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#94A3B8' }]} />
                      <Text style={styles.sheetLegendLabel}>Upcoming</Text>
                    </View>
                  </View>

                  <View style={styles.sheetFooterNote}>
                    <Text style={styles.sheetFooterNoteText}>
                      Confidential • Official Statement generated by SLS Rent Management • Saved in Documents
                    </Text>
                  </View>
                </View>
              </ScrollView>
            </ScrollView>
          </View>
        </Modal>
      </View>
    );
  }

  // -------------------------------------------------------------
  // VIEW 2: BUILDINGS LIST VIEW (When no building is selected)
  // -------------------------------------------------------------
  return (
    <View style={styles.buildingsContainer}>
      {/* Top Burgundy Header */}
      <View style={[styles.buildingHeaderContainer, { paddingTop: Math.max(insets.top, 12) + 6 }]}>
        <View style={styles.headerTopRow}>
          <View style={styles.headerTitleArea}>
            <Text style={styles.buildingHeaderTitle}>Rent Reports</Text>
          </View>

          <TouchableOpacity
            style={styles.refreshHeaderBtn}
            onPress={handleRefresh}
            disabled={refreshing || loadingProperties}
            activeOpacity={0.7}
          >
            {refreshing || loadingProperties ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <MaterialCommunityIcons name="refresh" size={20} color="#FFFFFF" />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Main Content Rounded Container */}
      <View style={styles.whiteContentContainer}>
        {loadingProperties ? (
          <View style={styles.centeredLoading}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.loadingPropertiesText}>Loading buildings...</Text>
          </View>
        ) : (
          <ScrollView
            style={styles.flex1}
            contentContainerStyle={[styles.buildingsListContent, { paddingBottom: insets.bottom + 24 }]}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={Colors.primary}
                colors={[Colors.primary]}
              />
            }
          >
            {properties.length === 0 ? (
              <View style={styles.emptyBuildingsBox}>
                <View style={styles.emptyIconCircle}>
                  <MaterialCommunityIcons
                    name="office-building-outline"
                    size={40}
                    color={Colors.primary}
                  />
                </View>
                <Text style={styles.emptyBuildingsTitle}>No buildings found</Text>
                <Text style={styles.emptyBuildingsSubtitle}>
                  Add a property first to track rent and view spreadsheets.
                </Text>
                <TouchableOpacity
                  style={styles.addPropertyBtn}
                  onPress={() => navigation.navigate('Add Property')}
                  activeOpacity={0.85}
                >
                  <MaterialCommunityIcons name="plus-circle" size={18} color="#FFFFFF" />
                  <Text style={styles.addPropertyBtnText}>Add Property</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.buildingsGrid}>
                <Text style={styles.sectionHeading}>
                  All Buildings ({properties.length})
                </Text>

                {properties.map((prop) => (
                  <TouchableOpacity
                    key={`prop-${prop.id}`}
                    style={styles.buildingCard}
                    onPress={() => setSelectedProperty(prop)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.buildingCardLeft}>
                      <View style={styles.buildingIconCircle}>
                        <MaterialCommunityIcons
                          name="office-building"
                          size={24}
                          color={Colors.primaryDark}
                        />
                      </View>
                      <View style={styles.buildingCardTexts}>
                        <Text style={styles.buildingNameText}>{prop.building_name}</Text>
                        {prop.location ? (
                          <View style={styles.buildingLocationRow}>
                            <MaterialCommunityIcons
                              name="map-marker-outline"
                              size={14}
                              color={Colors.textSecondary}
                            />
                            <Text style={styles.buildingLocationText} numberOfLines={1}>
                              {prop.location}
                            </Text>
                          </View>
                        ) : prop.building_address ? (
                          <Text style={styles.buildingLocationText} numberOfLines={1}>
                            {prop.building_address}
                          </Text>
                        ) : null}

                        {/* Badges */}
                        <View style={styles.badgesRow}>
                          <View style={styles.unitsBadge}>
                            <Text style={styles.unitsBadgeText}>
                              {prop.units} {prop.units === 1 ? 'Unit' : 'Units'}
                            </Text>
                          </View>
                          <View style={styles.occupiedBadge}>
                            <Text style={styles.occupiedBadgeText}>
                              {prop.occupiedCount} Occupied
                            </Text>
                          </View>
                        </View>
                      </View>
                    </View>

                    <View style={styles.buildingCardRight}>
                      <MaterialCommunityIcons
                        name="chevron-right"
                        size={20}
                        color="#94A3B8"
                      />
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex1: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  reportContainer: {
    backgroundColor: '#F8FAFC',
  },

  // ---------------- BUILDINGS LIST STYLES ---------------- //
  buildingsContainer: {
    flex: 1,
    backgroundColor: Colors.primaryDeep,
  },
  buildingHeaderContainer: {
    backgroundColor: Colors.primaryDeep,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitleArea: {
    flex: 1,
  },
  buildingHeaderTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  buildingHeaderSubtitle: {
    fontSize: 12,
    color: '#FCE7EA',
    marginTop: 1,
    fontWeight: '500',
  },
  refreshHeaderBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  whiteContentContainer: {
    flex: 1,
    backgroundColor: Colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  centeredLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingPropertiesText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  buildingsListContent: {
    padding: 16,
  },
  sectionHeading: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  buildingsGrid: {
    gap: 12,
  },
  buildingCard: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  buildingCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
    marginRight: 8,
  },
  buildingIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.primaryTint,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buildingCardTexts: {
    flex: 1,
    gap: 4,
  },
  buildingNameText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  buildingLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  buildingLocationText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  badgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  unitsBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  unitsBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  occupiedBadge: {
    backgroundColor: Colors.primaryTint,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  occupiedBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.primaryDark,
  },
  buildingCardRight: {
    justifyContent: 'center',
  },
  viewReportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: Colors.primaryTint,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  viewReportBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
  },
  emptyBuildingsBox: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 24,
    gap: 12,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.primaryTint,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  emptyBuildingsTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  emptyBuildingsSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
  addPropertyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 8,
  },
  addPropertyBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },

  // ---------------- REPORT VIEW STYLES (CLEAN LIGHT THEME) ---------------- //
  reportNavRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 8,
    gap: 8,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  backButtonText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '600',
  },
  landscapeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#86EFAC',
  },
  landscapeBadgeText: {
    color: '#15803D',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  downloadPdfBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: Colors.primaryDark,
    shadowColor: Colors.primaryDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  downloadPdfBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  switchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  switchButtonText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '600',
  },
  reportScrollContent: {
    paddingHorizontal: 4,
    paddingTop: 2,
  },
  reportCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    gap: 12,
  },
  cardHeaderTitles: {
    gap: 2,
    flexShrink: 1,
  },
  cardMainTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  cardSubTitle: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '600',
  },
  cardHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardPdfBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: Colors.primaryTint,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cardCloseBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },

  // Year Selector Pill
  yearSelectorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 6,
  },
  yearArrowBtn: {
    padding: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  yearText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    minWidth: 44,
    textAlign: 'center',
  },

  // Table Loading / Empty states
  tableLoadingBox: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    color: '#64748B',
    fontSize: 13,
  },
  emptyTableBox: {
    paddingVertical: 36,
    alignItems: 'center',
    gap: 8,
  },
  emptyTableTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E293B',
  },
  emptyTableSubtitle: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    maxWidth: 240,
  },

  // Table Structure
  tableOuterWrapper: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  tableContainer: {
    flexDirection: 'row',
  },
  fixedColumnsWrapper: {
    borderRightWidth: 1,
    borderRightColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    zIndex: 2,
  },
  monthsScrollContent: {
    backgroundColor: '#FFFFFF',
  },
  tableHeaderRow: {
    flexDirection: 'row',
    height: HEADER_HEIGHT,
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  tableDataRow: {
    flexDirection: 'row',
    height: ROW_HEIGHT,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  headerCell: {
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  headerCellText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  dataCell: {
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  monthCell: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
    borderLeftWidth: 1,
    borderLeftColor: '#F1F5F9',
  },
  nameCellText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0F172A',
  },
  flatCellText: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
  },

  // Cell Content Types
  partialText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#D97706',
  },
  upcomingText: {
    fontSize: 14,
    color: '#CBD5E1',
    fontWeight: '700',
  },

  // Legend
  legendContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#F8FAFC',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  upcomingLegendSymbol: {
    fontSize: 14,
    color: '#94A3B8',
    fontWeight: '700',
  },
  partialLegendSymbol: {
    fontSize: 11,
    color: '#D97706',
    fontWeight: '800',
  },

  // ---------------- DOCUMENT VIEWER STYLES ---------------- //
  viewPdfHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FDF0F2',
    borderWidth: 1,
    borderColor: '#F8D3D8',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  viewPdfHeaderBtnText: {
    color: '#701A24',
    fontSize: 13,
    fontWeight: '700',
  },
  viewerModalContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  viewerToolbar: {
    height: 52,
    backgroundColor: '#0F172A',
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    justifyContent: 'space-between',
  },
  viewerCloseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  viewerCloseText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  viewerTitleBox: {
    flex: 1,
    marginHorizontal: 12,
  },
  viewerTitle: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
  },
  viewerSubtitle: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '500',
  },
  viewerActionsRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  zoomControls: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#334155',
  },
  zoomBtn: {
    padding: 4,
  },
  zoomLabel: {
    color: '#F1F5F9',
    fontSize: 11,
    fontWeight: '700',
    minWidth: 38,
    textAlign: 'center',
  },
  viewerShareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#701A24',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  viewerShareBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  viewerCanvasScroll: {
    flex: 1,
    backgroundColor: '#1E293B',
  },
  viewerCanvasContent: {
    padding: 20,
    alignItems: 'center',
  },
  viewerHorizontalContent: {
    paddingBottom: 20,
  },
  pdfSheetPaper: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 24,
    minWidth: 920,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 10,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 2,
    borderBottomColor: '#701A24',
    paddingBottom: 12,
    marginBottom: 16,
  },
  sheetHeaderLeft: {
    flex: 1,
  },
  sheetBrandTitle: {
    color: '#701A24',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  sheetDocTitle: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '800',
    marginTop: 2,
    letterSpacing: -0.3,
  },
  sheetDocAddress: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  sheetHeaderRight: {
    alignItems: 'flex-end',
  },
  sheetBadge: {
    backgroundColor: '#FDF0F2',
    borderWidth: 1,
    borderColor: '#F8D3D8',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  sheetBadgeText: {
    color: '#701A24',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  sheetDateText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 6,
  },
  sheetKpiStrip: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  sheetKpiCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  sheetKpiLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  sheetKpiValue: {
    fontSize: 16,
    fontWeight: '800',
    marginTop: 2,
  },
  sheetTable: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: 16,
  },
  sheetTableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#701A24',
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  sheetTh: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 4,
  },
  sheetThMonth: {
    textAlign: 'center',
  },
  sheetThNumber: {
    textAlign: 'right',
  },
  sheetTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    backgroundColor: '#FFFFFF',
  },
  sheetTableRowAlt: {
    backgroundColor: '#F8FAFC',
  },
  sheetTd: {
    color: '#1E293B',
    fontSize: 11,
    paddingHorizontal: 4,
  },
  sheetTdMonth: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetTdNumber: {
    textAlign: 'right',
  },
  sheetChipPaid: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 3,
    alignItems: 'center',
  },
  sheetChipPaidText: {
    color: '#15803D',
    fontSize: 8.5,
    fontWeight: '800',
  },
  sheetChipPaidDate: {
    color: '#15803D',
    fontSize: 6.5,
    fontWeight: '700',
    marginTop: 1,
  },
  sheetChipDue: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 3,
    alignItems: 'center',
  },
  sheetChipDueText: {
    color: '#B91C1C',
    fontSize: 8.5,
    fontWeight: '800',
  },
  sheetChipPart: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 3,
    alignItems: 'center',
  },
  sheetChipPartText: {
    color: '#B45309',
    fontSize: 8.5,
    fontWeight: '800',
  },
  sheetChipPartDate: {
    color: '#B45309',
    fontSize: 6.5,
    fontWeight: '700',
    marginTop: 1,
  },
  sheetChipUpcomingText: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '700',
  },
  sheetTableFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 6,
    backgroundColor: '#F1F5F9',
    borderTopWidth: 2,
    borderTopColor: '#CBD5E1',
  },
  sheetTf: {
    color: '#0F172A',
    fontSize: 11,
    paddingHorizontal: 4,
  },
  sheetTfMonthText: {
    color: '#15803D',
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
  },
  sheetLegendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  sheetLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  sheetLegendLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '600',
  },
  sheetFooterNote: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    alignItems: 'center',
  },
  sheetFooterNoteText: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '500',
    fontStyle: 'italic',
  },
});
