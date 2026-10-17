import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  BackHandler,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Toast } from '../components/Toast';
import {
  Property,
  FlatItem,
  PaymentRecord,
  PaymentTransaction,
  Tenant,
  getTenantForFlat,
  getPaymentsForFlat,
  markPaymentAsPaid,
  updatePaymentRecord,
  deletePaymentTransaction,
  deleteFullPayment,
  MONTH_SHORT,
  parseMonthYear,
  getNextMonthYear,
  compareMonthYear,
  parseDateSafe,
  isRentDue,
  formatFlatNumber,
} from '../db/database';
import { Colors } from '../theme/colors';
import AppDatePicker from '../components/AppDatePicker';
import FloatingLabelInput from '../components/FloatingLabelInput';

interface TenantViewScreenProps {
  flat: FlatItem;
  property: Property;
  onBack: () => void;
  onEditTenant?: (flat: FlatItem) => void;
  onRemoveTenant?: (flat: FlatItem) => void;
}

const getTodayFormatted = () => {
  const d = new Date();
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
};

const formatReadableDate = (dateStr?: string) => {
  if (!dateStr || !dateStr.trim()) return 'None';
  try {
    const d = parseDateSafe(dateStr);
    const day = String(d.getDate()).padStart(2, '0');
    const month = MONTH_SHORT[d.getMonth()] || '';
    const year = d.getFullYear();
    return `${day} ${month} ${year}`;
  } catch {
    return dateStr;
  }
};

export default function TenantViewScreen({
  flat,
  property,
  onBack,
  onEditTenant,
  onRemoveTenant,
}: TenantViewScreenProps) {
  const insets = useSafeAreaInsets();
  const [currentTenant, setCurrentTenant] = useState<Tenant | undefined>(flat.tenant);
  const tenant = currentTenant || flat.tenant;

  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Tenant Info card collapse state (toggle on tapping chevron/header - initially closed)
  const [isTenantInfoCollapsed, setIsTenantInfoCollapsed] = useState(true);

  // 3-dots Action Sheet menu state
  const [menuModalVisible, setMenuModalVisible] = useState(false);

  // Payment Sheet Modal state
  const [bottomModalVisible, setBottomModalVisible] = useState(false);
  const [amountPaid, setAmountPaid] = useState(
    tenant?.rent_amount ? String(tenant.rent_amount) : '5000'
  );
  const [datePaid, setDatePaid] = useState(getTodayFormatted());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [notes, setNotes] = useState('');
  const [targetMonth, setTargetMonth] = useState('');
  const [submittingPayment, setSubmittingPayment] = useState(false);



  // Bill Receipt Modal state
  const [receiptModalVisible, setReceiptModalVisible] = useState(false);

  // Payment Breakdown / Split Details Modal state
  const [detailsModalVisible, setDetailsModalVisible] = useState(false);
  const [selectedHistoryPayment, setSelectedHistoryPayment] = useState<PaymentRecord | null>(null);

  // Edit Payment Modal state
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editTransactionId, setEditTransactionId] = useState<number | undefined>(undefined);
  const [editAmount, setEditAmount] = useState('');
  const [editDatePaid, setEditDatePaid] = useState(getTodayFormatted());
  const [editNotes, setEditNotes] = useState('');
  const [showEditDatePicker, setShowEditDatePicker] = useState(false);
  const [selectedSplitIndex, setSelectedSplitIndex] = useState(0);

  const loadPaymentData = async () => {
    if (!property?.id || !flat?.flat_number) return;
    try {
      setLoading(true);

      // Always load the latest tenant directly from SQLite to guarantee edited dates/amounts are live
      const freshTenant = await getTenantForFlat(property.id, flat.flat_number);
      if (freshTenant) {
        setCurrentTenant(freshTenant);
      }
      const activeTenant = freshTenant || tenant;

      const data = await getPaymentsForFlat(
        property.id,
        flat.flat_number,
        activeTenant?.rent_amount || 5000,
        activeTenant?.due_day || 5,
        activeTenant?.rent_start_date
      );
      setPayments(data);

      const active =
        data.find((p) => (p.status === 'Partial' || p.status === 'Pending') && isRentDue(p.month_year)) ||
        data.find((p) => p.status === 'Partial') ||
        data.find((p) => p.status === 'Pending') ||
        data[0];
      if (active) {
        setTargetMonth(active.month_year);
        const total = active.total_amount || active.amount || (activeTenant?.rent_amount || 5000);
        const paid = active.paid_amount || 0;
        setAmountPaid(String(Math.max(0, total - paid)));
      }
    } catch (err) {
      console.error('[TenantView] Error loading payments:', err);
    } finally {
      setLoading(false);
    }
  };

  // Sync state if props change (e.g. after editing tenant details)
  useEffect(() => {
    if (flat.tenant) {
      setCurrentTenant(flat.tenant);
    }
  }, [flat.tenant]);

  useEffect(() => {
    if (property?.id && flat?.flat_number) {
      loadPaymentData();
    }
    const today = getTodayFormatted();
    setDatePaid(today);
  }, [property?.id, flat?.flat_number, flat.tenant?.rent_start_date, flat.tenant?.rent_amount]);

  // Hardware Back Button Handler
  useEffect(() => {
    const onBackPress = () => {
      if (showEditDatePicker) {
        setShowEditDatePicker(false);
        return true;
      }
      if (showDatePicker) {
        setShowDatePicker(false);
        return true;
      }
      if (editModalVisible) {
        setEditModalVisible(false);
        return true;
      }
      if (detailsModalVisible) {
        setDetailsModalVisible(false);
        return true;
      }
      if (receiptModalVisible) {
        setReceiptModalVisible(false);
        return true;
      }
      if (menuModalVisible) {
        setMenuModalVisible(false);
        return true;
      }
      if (bottomModalVisible) {
        setBottomModalVisible(false);
        return true;
      }
      onBack();
      return true;
    };

    const backSub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => backSub.remove();
  }, [showEditDatePicker, showDatePicker, editModalVisible, detailsModalVisible, receiptModalVisible, menuModalVisible, bottomModalVisible, onBack]);

  // Chronologically sorted unpaid records (Partial or Pending)
  const sortedUnpaidPayments = [...payments]
    .filter((p) => p.status === 'Partial' || p.status === 'Pending')
    .sort((a, b) => compareMonthYear(a.month_year, b.month_year));

  // The earliest due unpaid payment (target month to redeem first)
  const oldestDueUnpaidPayment = sortedUnpaidPayments.find((p) => isRentDue(p.month_year)) || null;

  // Active unpaid payment (oldest due unpaid month, or earliest unpaid in general, or latest in history)
  const activeUnpaidPayment = oldestDueUnpaidPayment || sortedUnpaidPayments[0] || payments[0] || null;

  // All due unpaid months (Partial or Pending)
  const dueUnpaidPayments = sortedUnpaidPayments.filter((p) => isRentDue(p.month_year));
  const unpaidMonthsCount = dueUnpaidPayments.length;
  const hasMultipleUnpaidMonths = unpaidMonthsCount >= 2;

  // Total outstanding balance across all due unpaid months (only calculated starting from the 1st of the following month)
  const totalPendingBalance = payments.reduce((sum, p) => {
    if (p.status === 'Paid') return sum;
    if (!isRentDue(p.month_year)) return sum;
    const total = p.total_amount || p.amount || (tenant?.rent_amount || 5000);
    const paid = p.paid_amount !== undefined ? p.paid_amount : 0;
    return sum + Math.max(0, total - paid);
  }, 0);

  const currentBalance = totalPendingBalance;

  // Total rent paid by the tenant across all recorded payments/transactions
  const totalRentPaid = payments.reduce((sum, p) => {
    const total = p.total_amount || p.amount || (tenant?.rent_amount || 5000);
    const txSum = (p.transactions || []).reduce((s, tx) => s + (Number(tx.amount) || 0), 0);
    const rawPaid = p.paid_amount !== undefined ? Number(p.paid_amount) || 0 : (p.status === 'Paid' ? total : 0);
    const paid = Math.max(rawPaid, txSum);
    return sum + paid;
  }, 0);

  // Header Title format: "{flatDisplay}, {tenantShortName}"
  const flatDisplay = formatFlatNumber(flat.flat_number);
  const tenantShortName = tenant?.name ? tenant.name.split(' ')[0] : 'Tenant';
  const headerTitle = `${flatDisplay}, ${tenantShortName}`;

  // Rent & Bill calculations
  const monthlyRent = Number(tenant?.rent_amount || 5000);
  const subTotal = monthlyRent;
  const pendingAmount = currentBalance;
  const totalBillAmount = pendingAmount;

  // Billing Period: clearly accounts for overdue period when multiple months are unpaid
  let billPeriodString = '';
  if (dueUnpaidPayments.length > 0) {
    const firstP = dueUnpaidPayments[0];
    const lastP = dueUnpaidPayments[dueUnpaidPayments.length - 1];
    const pStart = parseMonthYear(firstP.month_year);
    const pEnd = parseMonthYear(lastP.month_year);
    if (pStart && pEnd) {
      let sDay = '01';
      if (tenant?.rent_start_date) {
        const startD = parseDateSafe(tenant.rent_start_date);
        if (startD.getMonth() === pStart.monthIndex && startD.getFullYear() === pStart.year) {
          sDay = String(startD.getDate()).padStart(2, '0');
        }
      }
      const sMonth = MONTH_SHORT[pStart.monthIndex];
      const sYear = pStart.year;
      const eLastDay = new Date(pEnd.year, pEnd.monthIndex + 1, 0).getDate();
      const eMonth = MONTH_SHORT[pEnd.monthIndex];
      const eYear = pEnd.year;
      billPeriodString = `${sDay} ${sMonth} ${sYear} to ${eLastDay} ${eMonth} ${eYear}${hasMultipleUnpaidMonths ? ` (${unpaidMonthsCount} Months Overdue)` : ''}`;
    }
  }
  if (!billPeriodString) {
    const billStartDate = tenant?.rent_start_date ? formatReadableDate(tenant.rent_start_date) : `01 ${MONTH_SHORT[new Date().getMonth()]} ${new Date().getFullYear()}`;
    const now = new Date();
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const billEndDate = `${lastDayOfMonth} ${MONTH_SHORT[now.getMonth()]} ${now.getFullYear()}`;
    billPeriodString = `${billStartDate} to ${billEndDate}`;
  }
  const billIssuedDate = formatReadableDate(tenant?.rent_start_date || getTodayFormatted());

  // Phone Call Action
  const handleCallTenant = () => {
    const phone = tenant?.phone_number?.replace(/[^0-9]/g, '');
    if (!phone) {
      Toast.warning('No Phone Number', 'Please add a phone number for this tenant first.');
      return;
    }
    Linking.openURL(`tel:${phone}`).catch(() => {
      Toast.error('Error', 'Unable to initiate phone call.');
    });
  };

  // WhatsApp Reminder Action
  const handleRemindWhatsApp = () => {
    const phone = tenant?.phone_number?.replace(/[^0-9]/g, '');
    if (!phone) {
      Toast.warning('No Phone Number', 'Please add a phone number for this tenant first.');
      return;
    }
    const cleanPhone = phone.length === 10 ? `91${phone}` : phone;
    let dueDetailsText = '';
    if (hasMultipleUnpaidMonths) {
      const monthList = dueUnpaidPayments
        .map((p) => {
          const bal = Math.max(0, (p.total_amount || p.amount || monthlyRent) - (p.paid_amount || 0));
          return `  • ${p.month_year}: ₹${bal.toLocaleString('en-IN')}`;
        })
        .join('\n');
      dueDetailsText = `\nOverdue for ${unpaidMonthsCount} months:\n${monthList}\n`;
    }
    const msg = `Dear ${tenant?.name},\nThis is a friendly rent reminder for ${flatDisplay}, ${property.building_name}.\nPending Amount: ₹${currentBalance.toLocaleString('en-IN')}.${dueDetailsText}\nPlease clear the pending dues. Thank you!`;
    const appUrl = `whatsapp://send?phone=${cleanPhone}&text=${encodeURIComponent(msg)}`;
    const webUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;

    Linking.openURL(appUrl).catch(() => {
      Linking.openURL(webUrl).catch(() => {
        Toast.error('Error', 'Unable to open WhatsApp.');
      });
    });
  };

  // SMS Reminder Action
  const handleSendSMS = () => {
    const phone = tenant?.phone_number?.replace(/[^0-9]/g, '');
    if (!phone) {
      Toast.warning('No Phone Number', 'Please add a phone number for this tenant first.');
      return;
    }
    const monthsSummary = hasMultipleUnpaidMonths
      ? ` (${unpaidMonthsCount} months: ${dueUnpaidPayments.map((p) => p.month_year).join(', ')})`
      : '';
    const msg = `Dear ${tenant?.name}, rent reminder of ₹${currentBalance.toLocaleString('en-IN')}${monthsSummary} for ${flatDisplay}, ${property.building_name}. Please clear the balance. Thank you!`;
    const url = Platform.OS === 'ios' ? `sms:${phone}&body=${encodeURIComponent(msg)}` : `sms:${phone}?body=${encodeURIComponent(msg)}`;
    Linking.openURL(url).catch(() => {
      Toast.error('Error', 'Unable to open SMS app.');
    });
  };

  // Payment History: Only show paid month badges, sorted recent month to previous months
  const paidHistoryPayments = [...payments]
    .filter((p) => p.status === 'Paid' || (p.paid_amount !== undefined && p.paid_amount > 0))
    .sort((a, b) => compareMonthYear(b.month_year, a.month_year));

  const handleOpenPaymentDetails = (payment: PaymentRecord) => {
    setSelectedHistoryPayment(payment);
    setDetailsModalVisible(true);
  };

  // Open Edit Payment modal
  const handleOpenEditPayment = () => {
    if (!selectedHistoryPayment) return;
    const txs = selectedHistoryPayment.transactions || [];
    if (txs.length > 0) {
      const firstTx = txs[0];
      setEditTransactionId(firstTx.id);
      setEditAmount(String(firstTx.amount || selectedHistoryPayment.paid_amount || ''));
      setEditDatePaid(firstTx.date_paid?.replace(/^Paid\s+/i, '').trim() || getTodayFormatted());
      setEditNotes(firstTx.notes || '');
      setSelectedSplitIndex(0);
    } else {
      setEditTransactionId(undefined);
      setEditAmount(String(selectedHistoryPayment.paid_amount || selectedHistoryPayment.amount || ''));
      setEditDatePaid(selectedHistoryPayment.date_paid?.replace(/^Paid\s+/i, '').trim() || getTodayFormatted());
      setEditNotes(selectedHistoryPayment.notes || '');
      setSelectedSplitIndex(0);
    }
    setEditModalVisible(true);
  };

  const handleOpenEditSpecificTransaction = (tx: PaymentTransaction, idx: number) => {
    setEditTransactionId(tx.id);
    setEditAmount(String(tx.amount || ''));
    setEditDatePaid(tx.date_paid?.replace(/^Paid\s+/i, '').trim() || getTodayFormatted());
    setEditNotes(tx.notes || '');
    setSelectedSplitIndex(idx);
    setEditModalVisible(true);
  };

  const handleSavePaymentEdit = async () => {
    if (!selectedHistoryPayment) return;
    const numAmt = Number(editAmount) || 0;
    if (numAmt <= 0) {
      Toast.warning('Invalid Amount', 'Please enter a valid amount greater than 0.');
      return;
    }

    try {
      await updatePaymentRecord(
        property.id,
        flat.flat_number,
        selectedHistoryPayment.month_year,
        numAmt,
        editDatePaid.trim() || getTodayFormatted(),
        editNotes.trim(),
        editTransactionId
      );

      await loadPaymentData();

      // Refresh currently selected payment in details modal
      const updatedPayments = await getPaymentsForFlat(
        property.id,
        flat.flat_number,
        tenant?.rent_amount || 5000,
        tenant?.due_day || 5,
        tenant?.rent_start_date
      );
      const updatedCurrent = updatedPayments.find(
        (p) => p.month_year.trim().toLowerCase() === selectedHistoryPayment.month_year.trim().toLowerCase()
      );
      if (updatedCurrent) {
        setSelectedHistoryPayment(updatedCurrent);
      }

      setEditModalVisible(false);
      Toast.success('Success', 'Payment record updated successfully!');
    } catch (err) {
      console.error('[TenantView] Error updating payment:', err);
      Toast.error('Error', 'Failed to update payment record.');
    }
  };

  const handleDeleteSplit = () => {
    if (!editTransactionId || !selectedHistoryPayment) return;
    Alert.alert(
      'Delete Split Payment',
      `Are you sure you want to delete this split payment of ₹${Number(editAmount).toLocaleString('en-IN')}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deletePaymentTransaction(
                editTransactionId,
                property.id,
                flat.flat_number,
                selectedHistoryPayment.month_year
              );
              await loadPaymentData();
              const updatedPayments = await getPaymentsForFlat(
                property.id,
                flat.flat_number,
                tenant?.rent_amount || 5000,
                tenant?.due_day || 5,
                tenant?.rent_start_date
              );
              const updatedCurrent = updatedPayments.find(
                (p) => p.month_year.trim().toLowerCase() === selectedHistoryPayment.month_year.trim().toLowerCase()
              );
              if (updatedCurrent) {
                setSelectedHistoryPayment(updatedCurrent);
              } else {
                setDetailsModalVisible(false);
              }
              setEditModalVisible(false);
              Toast.success('Success', 'Split payment deleted.');
            } catch (e) {
              console.error('Delete split error:', e);
              Toast.error('Error', 'Failed to delete split payment.');
            }
          },
        },
      ]
    );
  };

  const handleDeleteFullPayment = () => {
    if (!selectedHistoryPayment) return;
    const month = selectedHistoryPayment.month_year;
    Alert.alert(
      'Delete Payment',
      `Are you sure you want to delete payment records for ${month}? This will reset the payment status to pending.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteFullPayment(
                property.id,
                flat.flat_number,
                month
              );
              await loadPaymentData();
              setDetailsModalVisible(false);
              Toast.success('Payment Deleted', `Payment for ${month} has been deleted.`);
            } catch (err) {
              console.error('[TenantView] Error deleting payment:', err);
              Toast.error('Error', 'Failed to delete payment record.');
            }
          },
        },
      ]
    );
  };

  // Open Payment Sheet
  const pendingMonth = oldestDueUnpaidPayment
    ? oldestDueUnpaidPayment.month_year
    : (sortedUnpaidPayments[0]?.month_year || payments[0]?.month_year || '');
  const handleOpenPaymentSheet = (monthToMark?: string) => {
    const target = monthToMark || pendingMonth;
    const targetRec = payments.find((p) => p.month_year === target);
    const targetTotal = targetRec?.total_amount || targetRec?.amount || (tenant?.rent_amount || 5000);
    const targetPaid = targetRec?.paid_amount !== undefined
      ? targetRec.paid_amount
      : (targetRec?.status === 'Paid' ? targetTotal : 0);
    const targetBal = Math.max(0, targetTotal - targetPaid);

    setTargetMonth(target);
    setAmountPaid(currentBalance > 0 ? String(currentBalance) : (targetBal > 0 ? String(targetBal) : String(targetTotal)));
    setDatePaid(getTodayFormatted());
    setNotes('');
    setBottomModalVisible(true);
  };

  // Confirm Payment
  const handleConfirmPayment = async () => {
    if (submittingPayment) return;
    const payingNow = Number(amountPaid) || 0;
    if (payingNow <= 0) {
      Toast.warning('Invalid Amount', 'Please enter an amount greater than 0.');
      return;
    }

    try {
      setSubmittingPayment(true);
      const result = await markPaymentAsPaid(
        property.id,
        flat.flat_number,
        targetMonth,
        payingNow,
        datePaid.trim() || getTodayFormatted(),
        notes.trim(),
        tenant?.rent_amount || 5000
      );
      setBottomModalVisible(false);
      await loadPaymentData();

      if (result.affectedMonths && result.affectedMonths.length > 1) {
        const breakdown = result.affectedMonths
          .map((m) => `• ₹${m.amountApplied.toLocaleString('en-IN')} for ${m.month} (${m.status})`)
          .join('\n');
        Toast.success(
          'Payment Distributed',
          `Payment of ₹${payingNow.toLocaleString('en-IN')} successfully applied:\n${breakdown}`
        );
      } else {
        Toast.success('Payment Recorded', `Payment of ₹${payingNow.toLocaleString('en-IN')} recorded for ${targetMonth}.`);
      }
    } catch (err) {
      console.error('[TenantView] Error confirming payment:', err);
      Toast.error('Error', 'Failed to save payment record.');
    } finally {
      setSubmittingPayment(false);
    }
  };



  return (
    <View style={styles.container}>
      {/* ---------------- 1. HEADER (App Teal Theme with Call & Menu) ---------------- */}
      <View style={[styles.headerContainer, { paddingTop: Math.max(insets.top, 12) + 6 }]}>
        <View style={styles.headerTopRow}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={onBack}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <MaterialCommunityIcons name="arrow-left" size={24} color="#FFFFFF" />
          </TouchableOpacity>

          <View style={styles.headerTitleGroup}>
            <Text style={styles.headerSingleTitle} numberOfLines={1}>
              {headerTitle}
            </Text>
          </View>

          {/* Top Right Action Icons: Phone Call + 3-Dots Menu */}
          <View style={styles.headerRightActions}>
            <TouchableOpacity
              style={styles.headerActionBtn}
              onPress={handleCallTenant}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <MaterialCommunityIcons name="phone" size={22} color="#FFFFFF" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.headerActionBtn}
              onPress={() => setMenuModalVisible(true)}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <MaterialCommunityIcons name="dots-vertical" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* ---------------- MAIN SCROLLABLE CONTENT ---------------- */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ---------------- 2. TENANT INFO CARD ---------------- */}
        <View style={styles.tenantInfoCard}>
          {/* Top row: Avatar + ID Verified + Property & Address (Tap to collapse/expand) */}
          <TouchableOpacity
            style={styles.tenantCardTopRow}
            onPress={() => setIsTenantInfoCollapsed((prev) => !prev)}
            activeOpacity={0.7}
          >
            <View style={styles.avatarCircle}>
              <MaterialCommunityIcons name="account" size={26} color="#FFFFFF" />
            </View>

            <View style={styles.tenantIdentityBlock}>
              <Text
                style={[
                  styles.idVerifiedText,
                  tenant?.is_id_verified === 1 ? styles.idVerifiedGreen : styles.idNotVerifiedRed,
                ]}
              >
                ID: {tenant?.is_id_verified === 1 ? 'Verified' : 'Not-Verified'}
              </Text>
              <Text style={styles.propertyAddressText} numberOfLines={1}>
                {property.building_name} {property.building_address || property.location || ''}
              </Text>
            </View>

            <View style={styles.chevronIndicator}>
              <MaterialCommunityIcons
                name={isTenantInfoCollapsed ? 'chevron-down' : 'chevron-up'}
                size={22}
                color="#64748B"
              />
            </View>
          </TouchableOpacity>

          {/* 2x2 Field Grid (collapsible) */}
          {!isTenantInfoCollapsed && (
            <>
              <View style={styles.fieldsGrid}>
                {/* Row 1 */}
                <View style={styles.gridRow}>
                  <View style={styles.gridCol}>
                    <Text style={styles.gridLabel}>Monthly Rent:</Text>
                    <Text style={styles.gridValue}>
                      ₹ {Number(tenant?.rent_amount || 5000).toLocaleString('en-IN')}
                    </Text>
                  </View>
                  <View style={styles.gridCol}>
                    <Text style={styles.gridLabel}>Rent Start Date:</Text>
                    <Text style={styles.gridValue}>
                      {formatReadableDate(tenant?.rent_start_date)}
                    </Text>
                  </View>
                </View>

                {/* Row 2 */}
                <View style={styles.gridRow}>
                  <View style={styles.gridCol}>
                    <Text style={styles.gridLabel}>Security:</Text>
                    <Text style={styles.gridValue}>
                      ₹ {Number(tenant?.security_deposit_amount || 0).toLocaleString('en-IN')}
                    </Text>
                  </View>
                  <View style={styles.gridCol}>
                    <Text style={styles.gridLabel}>Due Day:</Text>
                    <Text style={styles.gridValue}>
                      Day {tenant?.due_day || 1} of month
                    </Text>
                  </View>
                </View>

                {/* Row 3 - EB Number & Phone */}
                <View style={styles.gridRow}>
                  <View style={styles.gridCol}>
                    <Text style={styles.gridLabel}>EB Number:</Text>
                    <Text style={styles.gridValue}>
                      {flat.eb_number || tenant?.eb_number || 'None'}
                    </Text>
                  </View>
                  <View style={styles.gridCol}>
                    <Text style={styles.gridLabel}>Phone:</Text>
                    <Text style={styles.gridValue}>
                      {tenant?.phone_number || 'None'}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.cardDivider} />
            </>
          )}

          {/* ---------------- 3. BALANCE SUMMARY ROW (3-Part Layout) ---------------- */}
          <View style={styles.balanceSummaryRow}>
            <View style={styles.balanceSummaryColLeft}>
              <Text style={styles.balanceSummaryAmount}>
                ₹ {totalRentPaid.toLocaleString('en-IN')}
              </Text>
              <Text style={styles.balanceSummarySub}>Total Rent Paid</Text>
            </View>


            <View style={styles.balanceSummaryColRight}>
              <Text style={styles.balanceSummaryAmount}>
                ₹ {currentBalance.toLocaleString('en-IN')}
              </Text>
              <Text style={styles.balanceSummarySub}>Pending</Text>
            </View>
          </View>
        </View>

        {/* ---------------- 4. QUICK ACTION BUTTONS ---------------- */}
        <View style={styles.quickActionsContainer}>
          {/* Row 1: Remind (WhatsApp) & Send SMS (light gray bar) */}
          <View style={styles.remindBarRow}>
            <TouchableOpacity
              style={styles.remindBarBtn}
              onPress={handleRemindWhatsApp}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="whatsapp" size={20} color="#25D366" />
              <Text style={styles.remindBtnText}>Remind</Text>
            </TouchableOpacity>

            <View style={styles.remindBarDivider} />

            <TouchableOpacity
              style={styles.remindBarBtn}
              onPress={handleSendSMS}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="alarm" size={20} color="#16A34A" />
              <Text style={styles.sendSmsBtnText}>Send SMS</Text>
            </TouchableOpacity>
          </View>

          {/* Row 2: Receive Payment & Generate New Bill (outlined buttons) */}
          <View style={styles.actionBtnRow}>
            <TouchableOpacity
              style={styles.receivePaymentBtn}
              onPress={() => handleOpenPaymentSheet()}
              activeOpacity={0.8}
            >
              <Text style={styles.receivePaymentBtnText}>Receive Payment ₹</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.generateBillBtn}
              onPress={() => setReceiptModalVisible(true)}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons
                name="receipt-text-outline"
                size={18}
                color={Colors.primary}
              />
              <Text style={styles.generateBillBtnText}>Bill Receipt</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ---------------- 6. BILL BREAKDOWN CARD (Reference Layout) ---------------- */}
        <View style={styles.billCard}>
          {/* Period Header Row */}
          <View style={styles.billHeaderRow}>
            <Text style={styles.billPeriodText}>{billPeriodString}</Text>
            <TouchableOpacity
              onPress={() => setMenuModalVisible(true)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialCommunityIcons name="dots-vertical" size={20} color="#64748B" />
            </TouchableOpacity>
          </View>

          {/* Monthly Rent */}
          <View style={styles.billRow}>
            <Text style={styles.billRowLabel}>Monthly Rent</Text>
            <Text style={styles.billRowValue}>
              ₹ {monthlyRent.toLocaleString('en-IN')}
            </Text>
          </View>

          <View style={styles.billDivider} />

          {/* Sub-Total */}
          <View style={styles.summaryLineRow}>
            <Text style={styles.summaryLineLabel}>Sub-Total</Text>
            <Text style={styles.summaryLineValue}>
              ₹ {subTotal.toLocaleString('en-IN')}
            </Text>
          </View>

          {/* Pending */}
          <View style={styles.summaryLineRow}>
            <Text style={styles.summaryLineLabel}>
              {hasMultipleUnpaidMonths ? `Pending (${unpaidMonthsCount} Months Due)` : 'Pending'}
            </Text>
            <Text style={[styles.summaryLineValue, { color: pendingAmount > 0 ? Colors.danger : Colors.textPrimary }]}>
              + ₹ {pendingAmount.toLocaleString('en-IN')}
            </Text>
          </View>

          {/* If 2 or more months unpaid, display clear itemized breakdown */}
          {hasMultipleUnpaidMonths && (
            <View style={styles.unpaidMonthsBreakdownBox}>
              <View style={styles.unpaidBreakdownHeaderRow}>
                <MaterialCommunityIcons name="alert-circle-outline" size={15} color={Colors.danger} />
                <Text style={styles.unpaidBreakdownHeaderTitle}>
                  Unpaid Months Breakdown ({unpaidMonthsCount} Months):
                </Text>
              </View>
              {dueUnpaidPayments.map((p, idx) => {
                const pTot = p.total_amount || p.amount || monthlyRent;
                const pPaid = p.paid_amount || 0;
                const pBal = Math.max(0, pTot - pPaid);
                return (
                  <TouchableOpacity
                    key={`due-${p.id || idx}`}
                    style={styles.unpaidBreakdownItemRow}
                    onPress={() => handleOpenPaymentSheet(p.month_year)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.unpaidBreakdownLeft}>
                      <Text style={styles.unpaidBreakdownMonth}>{p.month_year}</Text>
                      {p.status === 'Partial' ? (
                        <Text style={styles.unpaidBreakdownPartialSub}>
                          ₹{pPaid.toLocaleString('en-IN')} paid of ₹{pTot.toLocaleString('en-IN')}
                        </Text>
                      ) : (
                        <Text style={styles.unpaidBreakdownStatusBadge}>Pending</Text>
                      )}
                    </View>
                    <View style={styles.unpaidBreakdownRight}>
                      <Text style={styles.unpaidBreakdownAmount}>
                        ₹ {pBal.toLocaleString('en-IN')}
                      </Text>
                      <MaterialCommunityIcons name="chevron-right" size={14} color="#94A3B8" />
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Total Amount Highlight Banner */}
          <View style={styles.totalAmountBanner}>
            <Text style={styles.totalAmountLabel}>Total Amount Due</Text>
            <Text style={styles.totalAmountValue}>
              + ₹ {totalBillAmount.toLocaleString('en-IN')}
            </Text>
          </View>



          {/* Overdue Unpaid Months (Chips row) */}
          {dueUnpaidPayments.length > 0 && (
            <View style={styles.unpaidChipsSection}>
              <View style={styles.unpaidChipsHeaderRow}>
                <MaterialCommunityIcons name="clock-alert-outline" size={15} color={Colors.danger} />
                <Text style={styles.unpaidChipsHeaderLabel}>
                  {hasMultipleUnpaidMonths
                    ? `Overdue Months (${unpaidMonthsCount}):`
                    : 'Overdue Month:'}
                </Text>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.historyChipsScroll}
              >
                {dueUnpaidPayments.map((p) => {
                  const pTot = p.total_amount || p.amount || monthlyRent;
                  const pPaid = p.paid_amount || 0;
                  const pBal = Math.max(0, pTot - pPaid);
                  return (
                    <TouchableOpacity
                      key={`unpaid-chip-${p.id}`}
                      style={[styles.historyChip, styles.historyChipPending]}
                      onPress={() => handleOpenPaymentSheet(p.month_year)}
                      activeOpacity={0.75}
                    >
                      <View style={styles.historyChipTopRow}>
                        <MaterialCommunityIcons
                          name="alert-circle"
                          size={12}
                          color={Colors.danger}
                        />
                        <Text style={[styles.historyChipAmount, styles.historyChipAmountPending]}>
                          ₹ {pBal.toLocaleString('en-IN')}
                        </Text>
                      </View>
                      <Text style={styles.historyChipDate}>
                        {p.month_year}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* Payment History Row (horizontal chips showing ONLY paid months) */}
          <View style={styles.paymentHistoryRow}>
            <Text style={styles.paymentHistoryLabel}>Paid History:</Text>
            {paidHistoryPayments.length === 0 ? (
              <Text style={styles.noHistoryText}>No payments recorded yet</Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.historyChipsScroll}>
                {paidHistoryPayments.map((p) => {
                  const isPaid = p.status === 'Paid';
                  const isPartial = p.status === 'Partial';
                  const amt = p.paid_amount || p.total_amount || p.amount;
                  return (
                    <TouchableOpacity
                      key={`hist-${p.id}`}
                      style={[
                        styles.historyChip,
                        isPaid ? styles.historyChipPaid : isPartial ? styles.historyChipPartial : styles.historyChipPending,
                      ]}
                      onPress={() => handleOpenPaymentDetails(p)}
                      activeOpacity={0.75}
                    >
                      <View style={styles.historyChipTopRow}>
                        <MaterialCommunityIcons
                          name={isPaid ? 'check-circle' : 'clock-outline'}
                          size={12}
                          color={isPaid ? '#16A34A' : '#D97706'}
                        />
                        <Text
                          style={[
                            styles.historyChipAmount,
                            isPaid ? styles.historyChipAmountPaid : styles.historyChipAmountPartial,
                          ]}
                        >
                          ₹ {amt.toLocaleString('en-IN')}
                        </Text>
                      </View>
                      <Text style={styles.historyChipDate}>
                        {p.month_year}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>

          {/* Bill Receipt Button */}
          <TouchableOpacity
            style={styles.billReceiptBtn}
            onPress={() => setReceiptModalVisible(true)}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons name="file-document-outline" size={18} color={Colors.primary} />
            <Text style={styles.billReceiptBtnText}>Bill Receipt</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* ---------------- MODAL 1: RECEIVE PAYMENT BOTTOM SHEET ---------------- */}
      <Modal
        visible={bottomModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setBottomModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setBottomModalVisible(false)}
          />
          <View style={[styles.bottomSheet, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
            <View style={styles.dragHandle} />

            <Text style={styles.modalTitle}>Receive Payment</Text>
            <Text style={styles.modalSubtitle}>
              {flatDisplay} · {tenant?.name || 'Tenant'} · {targetMonth}
            </Text>

            <View style={styles.modalSummaryBox}>
              <View style={styles.modalSummaryRow}>
                <Text style={styles.modalSummaryLabel}>Pending Balance:</Text>
                <Text style={styles.modalSummaryValue}>₹{currentBalance.toLocaleString('en-IN')}</Text>
              </View>
              {Number(amountPaid) > (monthlyRent || 5000) ? (
                <View style={[styles.modalSummaryRow, { marginTop: 4 }]}>
                  <Text style={[styles.modalSummaryLabel, { color: Colors.primaryDeep, fontSize: 11 }]}>
                    Excess payment will automatically advance to next month
                  </Text>
                </View>
              ) : null}
            </View>

            {/* Quick Month Selector if 2 or more months are due */}
            {hasMultipleUnpaidMonths && (
              <View style={styles.modalMonthSelectorBox}>
                <Text style={styles.modalMonthSelectorTitle}>Select Month to Clear / Pay:</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modalMonthChipsRow}>
                  {dueUnpaidPayments.map((p) => {
                    const pTot = p.total_amount || p.amount || monthlyRent;
                    const pPaid = p.paid_amount || 0;
                    const pBal = Math.max(0, pTot - pPaid);
                    const isSelected = targetMonth === p.month_year;
                    return (
                      <TouchableOpacity
                        key={`sel-${p.id}`}
                        style={[styles.modalMonthChip, isSelected && styles.modalMonthChipActive]}
                        onPress={() => {
                          setTargetMonth(p.month_year);
                          setAmountPaid(String(pBal));
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.modalMonthChipText, isSelected && styles.modalMonthChipTextActive]}>
                          {p.month_year} (₹{pBal.toLocaleString('en-IN')})
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                  <TouchableOpacity
                    style={[styles.modalMonthChip, targetMonth === dueUnpaidPayments[0]?.month_year && Number(amountPaid) === currentBalance && styles.modalMonthChipActive]}
                    onPress={() => {
                      setTargetMonth(dueUnpaidPayments[0]?.month_year || '');
                      setAmountPaid(String(currentBalance));
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.modalMonthChipText, targetMonth === dueUnpaidPayments[0]?.month_year && Number(amountPaid) === currentBalance && styles.modalMonthChipTextActive]}>
                      All Dues (₹{currentBalance.toLocaleString('en-IN')})
                    </Text>
                  </TouchableOpacity>
                </ScrollView>
              </View>
            )}

            <FloatingLabelInput
              label="Amount to Pay"
              prefix="₹ "
              keyboardType="numeric"
              value={amountPaid}
              onChangeText={setAmountPaid}
            />

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Date of Payment</Text>
              <TouchableOpacity
                style={styles.dateInputTouchable}
                onPress={() => setShowDatePicker(true)}
                activeOpacity={0.8}
              >
                <Text style={styles.dateInputText}>{datePaid}</Text>
                <MaterialCommunityIcons name="calendar-month-outline" size={20} color={Colors.primary} />
              </TouchableOpacity>
            </View>

            <FloatingLabelInput
              label="Notes / Mode of Payment"
              value={notes}
              onChangeText={setNotes}
            />

            <TouchableOpacity
              style={[styles.confirmPaymentBtn, submittingPayment && { opacity: 0.6 }]}
              onPress={handleConfirmPayment}
              disabled={submittingPayment}
              activeOpacity={0.85}
            >
              {submittingPayment ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <MaterialCommunityIcons name="check-circle-outline" size={20} color="#FFFFFF" />
                  <Text style={styles.confirmPaymentBtnText}>Confirm Payment</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Date Picker (Disabled dates after current date) */}
      <AppDatePicker
        visible={showDatePicker}
        value={datePaid}
        onChange={(newDate) => {
          setDatePaid(newDate);
          setShowDatePicker(false);
        }}
        onClose={() => setShowDatePicker(false)}
        maximumDate={new Date()}
      />



      {/* ---------------- MODAL 3: BILL RECEIPT MODAL ---------------- */}
      <Modal
        visible={receiptModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setReceiptModalVisible(false)}
      >
        <View style={styles.receiptOverlay}>
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setReceiptModalVisible(false)}
          />
          <View style={styles.receiptCard}>
            <View style={styles.receiptHeader}>
              <View style={styles.receiptIconBadge}>
                <MaterialCommunityIcons name="receipt" size={28} color={Colors.primary} />
              </View>
              <Text style={styles.receiptBuildingTitle}>{property.building_name}</Text>
              <Text style={styles.receiptSubTitle}>RENT BILL & RECEIPT</Text>
            </View>

            <View style={styles.receiptDivider} />

            <View style={styles.receiptMetaRow}>
              <Text style={styles.receiptMetaLabel}>Tenant Name:</Text>
              <Text style={styles.receiptMetaValue}>{tenant?.name || 'Tenant'}</Text>
            </View>
            <View style={styles.receiptMetaRow}>
              <Text style={styles.receiptMetaLabel}>Flat:</Text>
              <Text style={styles.receiptMetaValue}>{flatDisplay}</Text>
            </View>
            <View style={styles.receiptMetaRow}>
              <Text style={styles.receiptMetaLabel}>Period:</Text>
              <Text style={styles.receiptMetaValue}>{billPeriodString}</Text>
            </View>
            <View style={styles.receiptMetaRow}>
              <Text style={styles.receiptMetaLabel}>Issued Date:</Text>
              <Text style={styles.receiptMetaValue}>{billIssuedDate}</Text>
            </View>

            {tenant?.eb_number ? (
              <View style={styles.receiptMetaRow}>
                <Text style={styles.receiptMetaLabel}>EB Number:</Text>
                <Text style={styles.receiptMetaValue}>{tenant.eb_number}</Text>
              </View>
            ) : null}

            <View style={styles.receiptDivider} />

            <View style={styles.receiptLineRow}>
              <Text style={styles.receiptLineLabel}>Monthly Rent</Text>
              <Text style={styles.receiptLineValue}>₹{monthlyRent.toLocaleString('en-IN')}</Text>
            </View>

            <View style={styles.receiptLineRow}>
              <Text style={styles.receiptLineLabel}>
                {hasMultipleUnpaidMonths ? `Pending Balance (${unpaidMonthsCount} Months)` : 'Pending Balance'}
              </Text>
              <Text style={[styles.receiptLineValue, { color: pendingAmount > 0 ? Colors.danger : Colors.textPrimary }]}>
                ₹{pendingAmount.toLocaleString('en-IN')}
              </Text>
            </View>

            {hasMultipleUnpaidMonths && (
              <View style={styles.receiptBreakdownList}>
                {dueUnpaidPayments.map((p, idx) => {
                  const pTot = p.total_amount || p.amount || monthlyRent;
                  const pPaid = p.paid_amount || 0;
                  const pBal = Math.max(0, pTot - pPaid);
                  return (
                    <View key={`rcpt-${p.id || idx}`} style={styles.receiptBreakdownRow}>
                      <Text style={styles.receiptBreakdownMonth}>• {p.month_year}:</Text>
                      <Text style={styles.receiptBreakdownAmount}>₹{pBal.toLocaleString('en-IN')}</Text>
                    </View>
                  );
                })}
              </View>
            )}

            <View style={styles.receiptDivider} />

            <View style={styles.receiptTotalRow}>
              <Text style={styles.receiptTotalLabel}>Total Amount Due</Text>
              <Text style={styles.receiptTotalValue}>₹{totalBillAmount.toLocaleString('en-IN')}</Text>
            </View>

            <TouchableOpacity
              style={styles.closeReceiptBtn}
              onPress={() => setReceiptModalVisible(false)}
            >
              <Text style={styles.closeReceiptBtnText}>Close Receipt</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ---------------- MODAL 4: 3-DOTS MENU MODAL ---------------- */}
      <Modal
        visible={menuModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.menuModalOverlay}
          activeOpacity={1}
          onPress={() => setMenuModalVisible(false)}
        >
          <View style={styles.menuSheetCard}>
            <TouchableOpacity
              style={styles.menuOption}
              onPress={() => {
                setMenuModalVisible(false);
                if (onEditTenant) onEditTenant(flat);
              }}
            >
              <MaterialCommunityIcons name="account-edit-outline" size={20} color={Colors.textPrimary} />
              <Text style={styles.menuOptionText}>Edit Tenant Details</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuOption}
              onPress={() => {
                setMenuModalVisible(false);
                if (onRemoveTenant) onRemoveTenant(flat);
              }}
            >
              <MaterialCommunityIcons name="account-remove-outline" size={20} color="#DC2626" />
              <Text style={[styles.menuOptionText, { color: '#DC2626' }]}>Remove / Vacate Tenant</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ---------------- MODAL 5: PAYMENT BREAKDOWN / SPLIT DETAILS MODAL ---------------- */}
      <Modal
        visible={detailsModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDetailsModalVisible(false)}
      >
        <View style={styles.detailsOverlay}>
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setDetailsModalVisible(false)}
          />
          <View style={styles.detailsCard}>
            {/* Header */}
            <View style={styles.detailsHeader}>
              <View style={styles.detailsHeaderLeft}>
                <View style={styles.detailsIconCircle}>
                  <MaterialCommunityIcons name="history" size={24} color={Colors.primary} />
                </View>
                <View style={styles.detailsHeaderTitleBox}>
                  <Text style={styles.detailsTitle}>Payment History</Text>
                  <Text style={styles.detailsSubtitle} numberOfLines={1}>
                    {selectedHistoryPayment?.month_year} · {flatDisplay}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => setDetailsModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={styles.detailsCloseBtn}
              >
                <MaterialCommunityIcons name="close" size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            <View style={styles.detailsDivider} />

            {/* Total Rent & Status Banner */}
            <View style={styles.detailsSummaryBanner}>
              <View>
                <Text style={styles.detailsSummaryLabel}>Rent Amount</Text>
                <Text style={styles.detailsSummaryValue}>
                  ₹ {(selectedHistoryPayment?.total_amount || selectedHistoryPayment?.amount || tenant?.rent_amount || 0).toLocaleString('en-IN')}
                </Text>
              </View>
              <View
                style={[
                  styles.detailsStatusPill,
                  selectedHistoryPayment?.status === 'Paid'
                    ? styles.detailsStatusPillPaid
                    : styles.detailsStatusPillPartial,
                ]}
              >
                <MaterialCommunityIcons
                  name={selectedHistoryPayment?.status === 'Paid' ? 'check-circle' : 'clock-outline'}
                  size={14}
                  color={selectedHistoryPayment?.status === 'Paid' ? '#16A34A' : '#D97706'}
                />
                <Text
                  style={[
                    styles.detailsStatusText,
                    selectedHistoryPayment?.status === 'Paid'
                      ? styles.detailsStatusTextPaid
                      : styles.detailsStatusTextPartial,
                  ]}
                >
                  {selectedHistoryPayment?.status === 'Paid' ? 'Paid' : 'Partial'}
                </Text>
              </View>
            </View>

            {/* Installments Breakdown Section Title */}
            <View style={styles.detailsSectionHeader}>
              <Text style={styles.detailsSectionTitle}>Paid Rent Details</Text>
              {selectedHistoryPayment?.transactions && selectedHistoryPayment.transactions.length > 1 ? (
                <View style={styles.splitsBadge}>
                  <Text style={styles.splitsBadgeText}>
                    {selectedHistoryPayment.transactions.length} Split Payments
                  </Text>
                </View>
              ) : null}
            </View>

            {/* List of payments / splits */}
            <ScrollView
              style={styles.detailsTransactionsScroll}
              contentContainerStyle={styles.detailsTransactionsContent}
              showsVerticalScrollIndicator={false}
            >
              {selectedHistoryPayment?.transactions && selectedHistoryPayment.transactions.length > 0 ? (
                selectedHistoryPayment.transactions.map((tx, idx) => (
                  <View key={`tx-${tx.id || idx}`} style={styles.txRowCard}>
                    <View style={styles.txRowLeft}>
                      <View style={styles.txIndexBadge}>
                        <Text style={styles.txIndexBadgeText}>#{idx + 1}</Text>
                      </View>
                      <View style={styles.txInfoCol}>
                        <View style={styles.txDateRow}>
                          <MaterialCommunityIcons name="calendar-check" size={14} color={Colors.primary} />
                          <Text style={styles.txDateText}>
                            {formatReadableDate(tx.date_paid)}
                          </Text>
                        </View>
                        {tx.notes ? (
                          <Text style={styles.txNotesText} numberOfLines={2}>
                            {tx.notes}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                    <View style={styles.txRowRightGroup}>
                      <Text style={styles.txAmountText}>
                        ₹ {Number(tx.amount || 0).toLocaleString('en-IN')}
                      </Text>
                      <TouchableOpacity
                        style={styles.txEditIconBtn}
                        onPress={() => handleOpenEditSpecificTransaction(tx, idx)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <MaterialCommunityIcons name="pencil-outline" size={15} color={Colors.primary} />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              ) : (
                <View style={styles.txRowCard}>
                  <View style={styles.txRowLeft}>
                    <View style={styles.txIndexBadge}>
                      <Text style={styles.txIndexBadgeText}>#1</Text>
                    </View>
                    <View style={styles.txInfoCol}>
                      <View style={styles.txDateRow}>
                        <MaterialCommunityIcons name="calendar-check" size={14} color={Colors.primary} />
                        <Text style={styles.txDateText}>
                          {formatReadableDate(selectedHistoryPayment?.date_paid)}
                        </Text>
                      </View>
                      {selectedHistoryPayment?.notes ? (
                        <Text style={styles.txNotesText}>
                          {selectedHistoryPayment.notes}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                  <View style={styles.txRowRightGroup}>
                    <Text style={styles.txAmountText}>
                      ₹ {Number(selectedHistoryPayment?.paid_amount || selectedHistoryPayment?.amount || 0).toLocaleString('en-IN')}
                    </Text>
                    <TouchableOpacity
                      style={styles.txEditIconBtn}
                      onPress={handleOpenEditPayment}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <MaterialCommunityIcons name="pencil-outline" size={15} color={Colors.primary} />
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </ScrollView>

            {/* Total Paid & Remaining Balance Summary */}
            <View style={styles.detailsFooterBox}>
              <View style={styles.detailsFooterRow}>
                <Text style={styles.detailsFooterLabel}>Total Paid:</Text>
                <Text style={styles.detailsFooterPaidValue}>
                  ₹ {Number(selectedHistoryPayment?.paid_amount || selectedHistoryPayment?.amount || 0).toLocaleString('en-IN')}
                </Text>
              </View>
              {selectedHistoryPayment && selectedHistoryPayment.status !== 'Paid' ? (
                <View style={[styles.detailsFooterRow, { marginTop: 4 }]}>
                  <Text style={styles.detailsFooterLabel}>Pending Balance:</Text>
                  <Text style={styles.detailsFooterBalValue}>
                    ₹ {Math.max(0, (selectedHistoryPayment.total_amount || selectedHistoryPayment.amount) - (selectedHistoryPayment.paid_amount || 0)).toLocaleString('en-IN')}
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={styles.detailsActionRow}>
              <TouchableOpacity
                style={styles.deletePaymentBtn}
                onPress={handleDeleteFullPayment}
                activeOpacity={0.8}
              >
                <MaterialCommunityIcons name="trash-can-outline" size={16} color={Colors.danger} />
                <Text style={styles.deletePaymentBtnText}>Delete Payment</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.editPaymentBtn}
                onPress={handleOpenEditPayment}
                activeOpacity={0.8}
              >
                <MaterialCommunityIcons name="square-edit-outline" size={16} color="#FFFFFF" />
                <Text style={styles.editPaymentBtnText}>Edit Payment</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ---------------- MODAL 6: EDIT PAYMENT MODAL ---------------- */}
      <Modal
        visible={editModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setEditModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setEditModalVisible(false)}
          />
          <View style={[styles.bottomSheet, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
            <View style={styles.dragHandle} />

            <View style={styles.editHeaderRow}>
              <View>
                <Text style={styles.modalTitle}>Edit Payment</Text>
                <Text style={styles.modalSubtitle}>
                  {selectedHistoryPayment?.month_year} · {flatDisplay}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setEditModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={styles.detailsCloseBtn}
              >
                <MaterialCommunityIcons name="close" size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            {/* Split installment tabs selector if multiple splits */}
            {selectedHistoryPayment?.transactions && selectedHistoryPayment.transactions.length > 1 ? (
              <View style={styles.editSplitTabsContainer}>
                <Text style={styles.editSplitTabsLabel}>Select installment to edit:</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.editSplitTabsScroll}>
                  {selectedHistoryPayment.transactions.map((tx, idx) => {
                    const isSelected = selectedSplitIndex === idx;
                    return (
                      <TouchableOpacity
                        key={`tab-${tx.id || idx}`}
                        style={[
                          styles.editSplitTab,
                          isSelected && styles.editSplitTabSelected,
                        ]}
                        onPress={() => {
                          setSelectedSplitIndex(idx);
                          setEditTransactionId(tx.id);
                          setEditAmount(String(tx.amount || ''));
                          setEditDatePaid(tx.date_paid?.replace(/^Paid\s+/i, '').trim() || getTodayFormatted());
                          setEditNotes(tx.notes || '');
                        }}
                      >
                        <Text
                          style={[
                            styles.editSplitTabText,
                            isSelected && styles.editSplitTabTextSelected,
                          ]}
                        >
                          Payment #{idx + 1} (₹{Number(tx.amount || 0).toLocaleString('en-IN')})
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}

            <FloatingLabelInput
              label="Paid Amount"
              prefix="₹ "
              keyboardType="numeric"
              value={editAmount}
              onChangeText={setEditAmount}
            />

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Date of Payment</Text>
              <TouchableOpacity
                style={styles.dateInputTouchable}
                onPress={() => setShowEditDatePicker(true)}
                activeOpacity={0.8}
              >
                <Text style={styles.dateInputText}>{editDatePaid}</Text>
                <MaterialCommunityIcons name="calendar-month-outline" size={20} color={Colors.primary} />
              </TouchableOpacity>
            </View>

            <FloatingLabelInput
              label="Notes / Mode of Payment"
              value={editNotes}
              onChangeText={setEditNotes}
            />

            {/* If multiple splits, option to delete this split */}
            {selectedHistoryPayment?.transactions && selectedHistoryPayment.transactions.length > 1 && editTransactionId ? (
              <TouchableOpacity
                style={styles.editDeleteSplitBtn}
                onPress={handleDeleteSplit}
                activeOpacity={0.8}
              >
                <MaterialCommunityIcons name="trash-can-outline" size={16} color="#DC2626" />
                <Text style={styles.editDeleteSplitBtnText}>Delete this installment</Text>
              </TouchableOpacity>
            ) : null}

            <View style={styles.editModalActionRow}>
              <TouchableOpacity
                style={styles.editCancelBtn}
                onPress={() => setEditModalVisible(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.editCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.editSaveBtn}
                onPress={handleSavePaymentEdit}
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons name="check" size={18} color="#FFFFFF" />
                <Text style={styles.editSaveBtnText}>Save Changes</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit Payment Date Picker (Disabled dates after current date) */}
      <AppDatePicker
        visible={showEditDatePicker}
        value={editDatePaid}
        onChange={(newDate) => {
          setEditDatePaid(newDate);
          setShowEditDatePicker(false);
        }}
        onClose={() => setShowEditDatePicker(false)}
        maximumDate={new Date()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },

  // ---------------- 1. HEADER STYLES ---------------- //
  headerContainer: {
    backgroundColor: Colors.primaryDeep,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtn: {
    padding: 6,
    marginLeft: -6,
  },
  headerTitleGroup: {
    flex: 1,
    marginHorizontal: 12,
  },
  headerSingleTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerActionBtn: {
    padding: 6,
  },

  // Scroll View
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingTop: 12,
  },

  // ---------------- 2. TENANT INFO CARD STYLES ---------------- //
  tenantInfoCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
    marginBottom: 12,
  },
  tenantCardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  tenantIdentityBlock: {
    flex: 1,
  },
  idVerifiedText: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  idVerifiedGreen: {
    color: '#16A34A',
  },
  idNotVerifiedRed: {
    color: '#DC2626',
  },
  propertyAddressText: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
  },
  chevronIndicator: {
    padding: 4,
  },

  // 2x2 Grid
  fieldsGrid: {
    gap: 8,
  },
  gridRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  gridCol: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingRight: 8,
  },
  gridLabel: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  gridValue: {
    fontSize: 12,
    color: '#0F172A',
    fontWeight: '700',
  },
  cardDivider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 14,
  },

  // ---------------- 3. BALANCE SUMMARY ROW STYLES ---------------- //
  balanceSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 2,
  },
  balanceSummaryColLeft: {
    flex: 1,
  },
  balanceSummaryDate: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  balanceSummarySub: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '500',
    marginTop: 2,
  },
  balanceSummaryColCenter: {
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  balanceSummaryCenterLabel: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '600',
    lineHeight: 14,
  },
  balanceSummaryColRight: {
    flex: 1,
    alignItems: 'flex-end',
  },
  balanceSummaryAmount: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },

  // ---------------- 4. QUICK ACTION BUTTONS STYLES ---------------- //
  quickActionsContainer: {
    gap: 10,
    marginBottom: 14,
  },
  remindBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    paddingVertical: 10,
  },
  remindBarBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  remindBtnText: {
    color: '#16A34A',
    fontSize: 13,
    fontWeight: '700',
  },
  remindBarDivider: {
    width: 1,
    height: 20,
    backgroundColor: '#E2E8F0',
  },
  sendSmsBtnText: {
    color: '#16A34A',
    fontSize: 13,
    fontWeight: '700',
  },
  actionBtnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  receivePaymentBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: '#16A34A',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  receivePaymentBtnText: {
    color: '#16A34A',
    fontWeight: '700',
    fontSize: 13,
  },
  generateBillBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
  },
  generateBillBtnText: {
    color: Colors.primary,
    fontWeight: '700',
    fontSize: 13,
  },

  // ---------------- 6. BILL BREAKDOWN CARD STYLES ---------------- //
  billCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
    marginBottom: 20,
  },
  billHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  billPeriodText: {
    color: Colors.primaryDark,
    fontSize: 13,
    fontWeight: '600',
  },
  billRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  billRowLabel: {
    fontSize: 13,
    color: '#1E293B',
    fontWeight: '600',
  },
  billRowValue: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  billDivider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 10,
  },


  summaryLineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  summaryLineLabel: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
  },
  summaryLineValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  totalAmountBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.dangerLight,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 8,
    marginBottom: 6,
  },
  totalAmountLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  totalAmountValue: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.danger,
  },
  billIssuedCaption: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 4,
    marginBottom: 14,
  },

  // Payment History Chips
  paymentHistoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    gap: 8,
  },
  paymentHistoryLabel: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  historyChipsScroll: {
    gap: 8,
  },
  historyChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  historyChipPaid: {
    backgroundColor: '#DCFCE7',
    borderColor: '#BBF7D0',
  },
  historyChipPartial: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
  },
  historyChipPending: {
    backgroundColor: Colors.dangerLight,
    borderColor: Colors.primaryBorder,
  },
  historyChipTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  historyChipAmount: {
    fontSize: 11,
    fontWeight: '800',
  },
  historyChipAmountPaid: {
    color: '#16A34A',
  },
  historyChipAmountPartial: {
    color: '#D97706',
  },
  historyChipAmountPending: {
    color: Colors.danger,
  },
  historyChipDate: {
    fontSize: 9,
    color: '#64748B',
    fontWeight: '600',
    marginTop: 2,
  },
  noHistoryText: {
    fontSize: 12,
    color: '#94A3B8',
    fontStyle: 'italic',
  },

  // Unpaid Months Breakdown Box
  unpaidMonthsBreakdownBox: {
    backgroundColor: Colors.dangerLight,
    borderWidth: 1,
    borderColor: Colors.primaryBorder,
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
    marginBottom: 6,
    gap: 6,
  },
  unpaidBreakdownHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  unpaidBreakdownHeaderTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.danger,
  },
  unpaidBreakdownItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.primaryBorder,
  },
  unpaidBreakdownLeft: {
    flex: 1,
  },
  unpaidBreakdownMonth: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
  },
  unpaidBreakdownPartialSub: {
    fontSize: 11,
    color: '#D97706',
    fontWeight: '600',
    marginTop: 1,
  },
  unpaidBreakdownStatusBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.danger,
    backgroundColor: Colors.primaryBorder,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  unpaidBreakdownRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  unpaidBreakdownAmount: {
    fontSize: 13,
    fontWeight: '800',
    color: Colors.danger,
  },

  // Unpaid Chips Section
  unpaidChipsSection: {
    marginTop: 14,
    marginBottom: 2,
  },
  unpaidChipsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  unpaidChipsHeaderLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.danger,
  },

  // Modal Month Selector
  modalMonthSelectorBox: {
    marginTop: 10,
    marginBottom: 8,
  },
  modalMonthSelectorTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 6,
  },
  modalMonthChipsRow: {
    gap: 8,
    paddingVertical: 2,
  },
  modalMonthChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  modalMonthChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  modalMonthChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  modalMonthChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },

  // Receipt Modal Breakdown
  receiptBreakdownList: {
    backgroundColor: Colors.dangerLight,
    borderRadius: 8,
    padding: 8,
    marginVertical: 4,
    gap: 4,
  },
  receiptBreakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  receiptBreakdownMonth: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.danger,
  },
  receiptBreakdownAmount: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.danger,
  },

  // Bill Receipt Button
  billReceiptBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: Colors.primaryTint,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  billReceiptBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primary,
  },

  // ---------------- MODAL STYLES ---------------- //
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
  },
  bottomSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    maxHeight: '88%',
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
    marginBottom: 16,
  },
  modalSummaryBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  modalSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  modalSummaryLabel: {
    fontSize: 13,
    color: '#64748B',
  },
  modalSummaryValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 6,
  },
  textInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0F172A',
  },
  dateInputTouchable: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dateInputText: {
    fontSize: 14,
    color: '#0F172A',
    fontWeight: '600',
  },
  confirmPaymentBtn: {
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 10,
    marginTop: 8,
  },
  confirmPaymentBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },

  // Receipt Modal
  receiptOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  receiptCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 380,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 6,
  },
  receiptHeader: {
    alignItems: 'center',
    gap: 4,
  },
  receiptIconBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.primaryTint,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  receiptBuildingTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  receiptSubTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primary,
    letterSpacing: 1,
  },
  receiptDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 12,
  },
  receiptMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  receiptMetaLabel: {
    fontSize: 12,
    color: '#64748B',
  },
  receiptMetaValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0F172A',
  },
  receiptLineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  receiptLineLabel: {
    fontSize: 13,
    color: '#475569',
  },
  receiptLineValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  receiptTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  receiptTotalLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  receiptTotalValue: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.primaryDark,
  },
  closeReceiptBtn: {
    backgroundColor: '#F1F5F9',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 14,
  },
  closeReceiptBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },

  // 3-dots Menu Sheet
  menuModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 60,
    paddingRight: 16,
  },
  menuSheetCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 6,
    width: 210,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  menuOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  menuOptionText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0F172A',
  },

  // ---------------- DETAILS MODAL STYLES ---------------- //
  detailsOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  detailsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 380,
    maxHeight: '85%',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 6,
  },
  detailsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailsHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  detailsIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primaryTint,
    justifyContent: 'center',
    alignItems: 'center',
  },
  detailsHeaderTitleBox: {
    flex: 1,
  },
  detailsTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  detailsSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  detailsCloseBtn: {
    padding: 4,
  },
  detailsDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 14,
  },
  detailsSummaryBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 14,
  },
  detailsSummaryLabel: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  detailsSummaryValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },
  detailsStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  detailsStatusPillPaid: {
    backgroundColor: '#DCFCE7',
  },
  detailsStatusPillPartial: {
    backgroundColor: '#FEF3C7',
  },
  detailsStatusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  detailsStatusTextPaid: {
    color: '#16A34A',
  },
  detailsStatusTextPartial: {
    color: '#D97706',
  },
  detailsSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  detailsSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  splitsBadge: {
    backgroundColor: Colors.primaryTint,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  splitsBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.primary,
  },
  detailsTransactionsScroll: {
    maxHeight: 180,
  },
  detailsTransactionsContent: {
    gap: 8,
  },
  txRowCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  txRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  txIndexBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  txIndexBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
  },
  txInfoCol: {
    flex: 1,
  },
  txDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  txDateText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  txNotesText: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  txAmountText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#16A34A',
    marginLeft: 8,
  },
  detailsFooterBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  detailsFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailsFooterLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  detailsFooterPaidValue: {
    fontSize: 15,
    fontWeight: '800',
    color: '#16A34A',
  },
  detailsFooterBalValue: {
    fontSize: 14,
    fontWeight: '800',
    color: '#DC2626',
  },
  detailsActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  deletePaymentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.dangerLight,
    borderWidth: 1,
    borderColor: Colors.primaryBorder,
    paddingVertical: 11,
    borderRadius: 8,
  },
  deletePaymentBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.danger,
  },
  detailsReceiptBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.primaryTint,
    paddingVertical: 11,
    borderRadius: 8,
  },
  detailsReceiptBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
  },
  closeDetailsBtn: {
    flex: 1,
    backgroundColor: '#F1F5F9',
    paddingVertical: 11,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeDetailsBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  editPaymentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    paddingVertical: 11,
    borderRadius: 8,
  },
  editPaymentBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  txRowRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  txEditIconBtn: {
    padding: 5,
    borderRadius: 6,
    backgroundColor: Colors.primaryTint,
  },
  editHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  editSplitTabsContainer: {
    marginBottom: 12,
  },
  editSplitTabsLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
    marginBottom: 6,
  },
  editSplitTabsScroll: {
    gap: 8,
  },
  editSplitTab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  editSplitTabSelected: {
    backgroundColor: Colors.primaryTint,
    borderColor: Colors.primary,
  },
  editSplitTabText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  editSplitTabTextSelected: {
    color: Colors.primaryDeep,
    fontWeight: '700',
  },
  editDeleteSplitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 6,
    marginBottom: 8,
  },
  editDeleteSplitBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.danger,
  },
  editModalActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  editCancelBtn: {
    flex: 1,
    backgroundColor: '#F1F5F9',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editCancelBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
  },
  editSaveBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    borderRadius: 8,
  },
  editSaveBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
