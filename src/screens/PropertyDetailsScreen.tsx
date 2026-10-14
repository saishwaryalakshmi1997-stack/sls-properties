import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  BackHandler,
  Switch,
  FlatList,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Toast } from '../components/Toast';
import {
  Property,
  FlatItem,
  Tenant,
  getFlatsForProperty,
  addOrUpdateTenant,
  removeTenantFromFlat,
  getAllPaymentsForProperty,
  deleteProperty,
  isRentDue,
  getFlatEbNumber,
  saveFlatEbNumber,
} from '../db/database';
import { Colors } from '../theme/colors';
import TenantViewScreen from './TenantViewScreen';
import AppDatePicker, { formatDateDisplay } from '../components/AppDatePicker';
import FloatingLabelInput from '../components/FloatingLabelInput';
import * as Contacts from 'expo-contacts';
import { Contact, ContactField, ContactsSortOrder } from 'expo-contacts';

interface PropertyDetailsScreenProps {
  property: Property;
  onBack: () => void;
  onEditProperty?: () => void;
  onDeleteProperty?: () => void;
}

const getTodayFormatted = () => {
  const d = new Date();
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
};

export default function PropertyDetailsScreen({
  property,
  onBack,
  onEditProperty,
  onDeleteProperty,
}: PropertyDetailsScreenProps) {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  // Property top-right 3-dots dropdown menu state
  const [propertyMenuVisible, setPropertyMenuVisible] = useState(false);

  const handleEdit = () => {
    if (onEditProperty) {
      onEditProperty();
    } else {
      navigation.navigate('Add Property', {
        propertyId: property.id,
        buildingName: property.building_name,
      });
    }
  };

  const handleEditFromMenu = () => {
    setPropertyMenuVisible(false);
    setTimeout(() => {
      handleEdit();
    }, 50);
  };

  const handleReportFromMenu = () => {
    setPropertyMenuVisible(false);
    setTimeout(() => {
      navigation.navigate('Rent Report', { propertyId: property.id });
    }, 50);
  };

  const handleDeleteProperty = () => {
    setPropertyMenuVisible(false);
    Alert.alert(
      'Delete Property',
      `Are you sure you want to delete "${property.building_name}"?\n\nThis will permanently delete this property along with all its flats, tenants, and payment records. This action cannot be undone.`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setLoading(true);
              await deleteProperty(property.id);
              Toast.success(
                'Property Deleted',
                `"${property.building_name}" has been deleted successfully.`
              );
              if (onDeleteProperty) {
                onDeleteProperty();
              } else {
                onBack();
              }
            } catch (err: any) {
              setLoading(false);
              Toast.error('Error', err?.message || 'Could not delete property.');
            }
          },
        },
      ]
    );
  };

  const [flats, setFlats] = useState<FlatItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'occupied' | 'vacant'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isFlatsCollapsed, setIsFlatsCollapsed] = useState(false);
  const [isCurrentStatusExpanded, setIsCurrentStatusExpanded] = useState(false);

  // Tenant View Screen state (Picture 1 & 2)
  const [viewingFlat, setViewingFlat] = useState<FlatItem | null>(null);

  // Three dots menu state
  const [selectedFlat, setSelectedFlat] = useState<FlatItem | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [flatMenuY, setFlatMenuY] = useState<number>(220);

  // Add / Edit Tenant modal state (with 2-step stepper matching screenshot)
  const [tenantModalVisible, setTenantModalVisible] = useState(false);
  const [tenantStep, setTenantStep] = useState<1 | 2>(1);

  // In-app contacts phonebook picker states
  const [contactsModalVisible, setContactsModalVisible] = useState(false);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [allContacts, setAllContacts] = useState<{ id: string; name: string; phone: string }[]>([]);
  const [contactSearchQuery, setContactSearchQuery] = useState('');

  // Step 1: Personal Details
  const [tenantFlatNumber, setTenantFlatNumber] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [tenantPhone, setTenantPhone] = useState('');
  const [tenantIdProofNumber, setTenantIdProofNumber] = useState('');
  const [tenantIsIdVerified, setTenantIsIdVerified] = useState(false);
  const [tenantPhotoAttached, setTenantPhotoAttached] = useState(false);

  // Step 2: Rent Details
  const [tenantRentAmount, setTenantRentAmount] = useState('');
  const [tenantDueDay, setTenantDueDay] = useState('5');
  const [tenantRentStartDate, setTenantRentStartDate] = useState(getTodayFormatted());


  // Security Deposit
  const [securityDepositEnabled, setSecurityDepositEnabled] = useState(false);
  const [securityDepositAmount, setSecurityDepositAmount] = useState('0');
  const [securityDepositDate, setSecurityDepositDate] = useState(getTodayFormatted());

  // EB Number
  const [ebNumber, setEbNumber] = useState('');

  // Active DatePicker target
  const [activeDatePicker, setActiveDatePicker] = useState<
    'rent_start' | 'security_deposit' | null
  >(null);

  const [savingTenant, setSavingTenant] = useState(false);
  const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});
  const [flatPaymentStatusMap, setFlatPaymentStatusMap] = useState<{
    [flatNumber: string]: { status: 'Paid' | 'Partial' | 'Pending'; balance: number; paid: number; total: number; unpaidCount?: number };
  }>({});
  const [totalCollectedRent, setTotalCollectedRent] = useState(0);

  const loadFlats = async () => {
    try {
      setLoading(true);
      const data = await getFlatsForProperty(property.id, property.units);
      setFlats(data);

      const allPayments = await getAllPaymentsForProperty(property.id);
      let collectedSum = 0;
      for (const p of allPayments) {
        collectedSum += p.paid_amount || 0;
      }
      setTotalCollectedRent(collectedSum);

      const statusMap: {
        [flatNumber: string]: { status: 'Paid' | 'Partial' | 'Pending'; balance: number; paid: number; total: number; unpaidCount?: number };
      } = {};

      for (const flat of data) {
        if (flat.is_occupied && flat.tenant) {
          const flatPayments = allPayments.filter((p) => p.flat_number.trim() === flat.flat_number.trim());
          const dueUnpaidList = flatPayments.filter((p) => p.status !== 'Paid' && isRentDue(p.month_year));
          let balance = 0;
          for (const p of flatPayments) {
            if (p.status !== 'Paid' && isRentDue(p.month_year)) {
              const tot = p.total_amount || p.amount || flat.tenant.rent_amount || 5000;
              const pd = p.paid_amount !== undefined ? p.paid_amount : 0;
              balance += Math.max(0, tot - pd);
            }
          }
          const latest = flatPayments[0]; // ordered by id DESC
          const total = latest?.total_amount || latest?.amount || flat.tenant.rent_amount || 5000;
          const paid = latest?.paid_amount !== undefined
            ? latest.paid_amount
            : (latest?.status === 'Paid' ? total : 0);
          const status: 'Paid' | 'Partial' | 'Pending' =
            balance === 0 || dueUnpaidList.length === 0
              ? 'Paid'
              : dueUnpaidList.some((p) => p.status === 'Partial')
                ? 'Partial'
                : 'Pending';
          const unpaidCount = dueUnpaidList.length;
          statusMap[flat.flat_number] = { status, balance, paid, total, unpaidCount };
        }
      }
      setFlatPaymentStatusMap(statusMap);
    } catch (err) {
      console.error('[PropertyDetails] Error loading flats:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFlats();
  }, [property.id, property.units]);

  // Counts
  const totalCount = flats.length;
  const occupiedCount = useMemo(() => flats.filter((f) => f.is_occupied).length, [flats]);
  const vacantCount = useMemo(() => flats.filter((f) => !f.is_occupied).length, [flats]);

  const totalPendingRent = useMemo(() => {
    let sum = 0;
    for (const flat of flats) {
      if (flat.is_occupied && flat.tenant) {
        const pay = flatPaymentStatusMap[flat.flat_number];
        if (pay) {
          sum += pay.balance;
        }
      }
    }
    return sum;
  }, [flats, flatPaymentStatusMap]);

  // Filtered flats
  const filteredFlats = useMemo(() => {
    return flats.filter((f) => {
      // Status filter
      if (statusFilter === 'occupied' && !f.is_occupied) return false;
      if (statusFilter === 'vacant' && f.is_occupied) return false;

      // Search query
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      const flatMatch = f.flat_number.toLowerCase().includes(q);
      const nameMatch = f.tenant?.name.toLowerCase().includes(q);
      const phoneMatch = f.tenant?.phone_number.toLowerCase().includes(q);
      const aadharMatch = f.tenant?.aadhar_id.toLowerCase().includes(q);
      const rentMatch = f.tenant?.rent_amount ? String(f.tenant.rent_amount).includes(q) : false;

      return flatMatch || nameMatch || phoneMatch || aadharMatch || rentMatch;
    });
  }, [flats, statusFilter, searchQuery]);

  // Open 3-dots menu
  const handleOpenMenu = (flat: FlatItem, pageY?: number) => {
    setSelectedFlat(flat);
    if (pageY) {
      const calculatedTop = Math.min(Math.max(pageY - 20, insets.top + 60), 620);
      setFlatMenuY(calculatedTop);
    } else {
      setFlatMenuY(220);
    }
    setMenuVisible(true);
  };

  const resetTenantForm = () => {
    setTenantName('');
    setTenantPhone('');
    setTenantRentAmount('');
    setTenantDueDay('5');
    setTenantRentStartDate(getTodayFormatted());
    setTenantIdProofNumber('');
    setTenantIsIdVerified(false);
    setTenantPhotoAttached(false);

    setSecurityDepositEnabled(false);
    setSecurityDepositAmount('0');
    setSecurityDepositDate(getTodayFormatted());

    setEbNumber('');
  };

  // Open Add / Edit Tenant Modal
  const handleOpenAddTenant = async (flat?: FlatItem) => {
    setMenuVisible(false);
    setFormErrors({});
    setTenantStep(1);

    if (flat) {
      setSelectedFlat(flat);
      setTenantFlatNumber(flat.flat_number);
      if (flat.tenant) {
        setTenantName(flat.tenant.name || '');
        setTenantPhone(flat.tenant.phone_number || '');
        setTenantRentAmount(flat.tenant.rent_amount ? String(flat.tenant.rent_amount) : '');
        setTenantDueDay(flat.tenant.due_day ? String(flat.tenant.due_day) : '5');
        setTenantRentStartDate(flat.tenant.rent_start_date || getTodayFormatted());
        setTenantIdProofNumber(flat.tenant.aadhar_id || '');
        setTenantIsIdVerified(Boolean(flat.tenant.is_id_verified));
        setTenantPhotoAttached(Boolean(flat.tenant.id_photo_uri));

        // Security Deposit
        setSecurityDepositEnabled(Boolean(flat.tenant.security_deposit_enabled));
        setSecurityDepositAmount(flat.tenant.security_deposit_amount !== undefined ? String(flat.tenant.security_deposit_amount) : '0');
        setSecurityDepositDate(flat.tenant.security_deposit_date || getTodayFormatted());

        // EB Number (persisted and fixed per flat)
        const eb = flat.tenant.eb_number || flat.eb_number || (await getFlatEbNumber(property.id, flat.flat_number));
        setEbNumber(eb || '');
      } else {
        resetTenantForm();
        // Prefill preserved EB number for this vacant flat!
        const eb = flat.eb_number || (await getFlatEbNumber(property.id, flat.flat_number));
        if (eb) {
          setEbNumber(eb);
        }
      }
    } else {
      setSelectedFlat(null);
      const firstVacant = flats.find((f) => !f.is_occupied);
      const flatNum = firstVacant ? firstVacant.flat_number : (flats.length > 0 ? flats[0].flat_number : 'Flat 1');
      setTenantFlatNumber(flatNum);
      resetTenantForm();
      const eb = firstVacant?.eb_number || (await getFlatEbNumber(property.id, flatNum));
      if (eb) {
        setEbNumber(eb);
      }
    }

    setTenantModalVisible(true);
  };

  // Remove Tenant
  const handleRemoveTenant = (flatToRemove?: FlatItem, skipConfirm: boolean = false) => {
    const target = flatToRemove || selectedFlat;
    if (!target) return;
    setMenuVisible(false);

    if (!target.is_occupied) {
      Toast.info('Notice', 'This flat is already vacant.');
      return;
    }

    const doRemove = async () => {
      try {
        await removeTenantFromFlat(property.id, target.flat_number);
        setViewingFlat(null);
        loadFlats();
        Toast.success('Tenant Removed', `Tenant removed from ${target.flat_number}.`);
      } catch (err: any) {
        Toast.error('Error', err?.message || 'Could not remove tenant');
      }
    };

    if (skipConfirm) {
      doRemove();
    } else {
      Alert.alert(
        'Remove Tenant',
        `Are you sure you want to remove tenant "${target.tenant?.name}" from ${target.flat_number}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: doRemove,
          },
        ]
      );
    }
  };

  // Toggle Upload Photo / ID Document
  const handleToggleUploadPhoto = () => {
    if (tenantPhotoAttached) {
      Alert.alert('ID / Tenant Photo', 'Manage uploaded document', [
        { text: 'Keep Photo', style: 'cancel' },
        {
          text: 'Remove Photo',
          style: 'destructive',
          onPress: () => {
            setTenantPhotoAttached(false);
            Toast.info('Document Removed', 'Tenant ID / photo has been removed.');
          },
        },
      ]);
    } else {
      Alert.alert(
        'Upload ID / Tenant Photo',
        'Attach government ID proof or tenant photo for verification record.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Attach Photo',
            onPress: () => {
              setTenantPhotoAttached(true);
              Toast.success('Document Attached', 'Tenant ID proof has been attached.');
            },
          },
        ]
      );
    }
  };

  // Open in-app contacts picker directly (bypasses Android system file manager intent)
  const handleOpenContactPicker = async () => {
    try {
      setContactsModalVisible(true);
      setContactsLoading(true);
      setContactSearchQuery('');

      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') {
        setContactsModalVisible(false);
        setContactsLoading(false);
        Toast.warning(
          'Permission Needed',
          'Please allow contact access in device settings to select from your phonebook.'
        );
        return;
      }

      let rawList: any[] = [];
      try {
        rawList = await Contact.getAllDetails(
          [ContactField.FULL_NAME, ContactField.PHONES],
          { sortOrder: ContactsSortOrder.GivenName }
        );
      } catch (err) {
        console.warn('Contact.getAllDetails failed, trying fallback:', err);
        try {
          const legacyRes = await Contacts.getContactsAsync({
            fields: [Contacts.Fields?.PhoneNumbers || 'phoneNumbers'],
          });
          rawList = (legacyRes?.data || []).map((c: any) => ({
            id: c.id,
            fullName: c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim(),
            phones: c.phoneNumbers?.map((p: any) => ({ number: p.number })) || [],
          }));
        } catch (fallbackErr) {
          console.error('All contact queries failed:', fallbackErr);
        }
      }

      const items: { id: string; name: string; phone: string }[] = [];
      for (const c of rawList) {
        if (c.phones && c.phones.length > 0) {
          const mainPhone = c.phones[0].number || '';
          if (mainPhone.trim()) {
            items.push({
              id: String(c.id || Math.random()),
              name: (c.fullName || '').trim() || 'Unknown Contact',
              phone: mainPhone.trim(),
            });
          }
        }
      }

      setAllContacts(items);
    } catch (err: any) {
      console.error('Error fetching contacts:', err);
      Toast.error('Error', 'Unable to retrieve contacts from phonebook.');
    } finally {
      setContactsLoading(false);
    }
  };

  // Select a contact from the in-app list
  const handleSelectContactItem = (contact: { id: string; name: string; phone: string }) => {
    const cleaned = contact.phone.replace(/[^0-9+]/g, '');
    setTenantPhone(cleaned);
    if (formErrors.phone) setFormErrors((p) => ({ ...p, phone: '' }));

    // Auto-fill tenant name if currently empty
    if (!tenantName.trim() && contact.name && contact.name !== 'Unknown Contact') {
      setTenantName(contact.name);
      if (formErrors.name) setFormErrors((p) => ({ ...p, name: '' }));
    }

    setContactsModalVisible(false);
    Toast.success('Contact Selected', `${contact.name} (${cleaned})`);
  };

  // Filtered contacts based on search query
  const filteredContacts = useMemo(() => {
    if (!contactSearchQuery.trim()) return allContacts;
    const q = contactSearchQuery.toLowerCase();
    const qNum = contactSearchQuery.replace(/[^0-9]/g, '');
    return allContacts.filter((c) => {
      const matchName = c.name.toLowerCase().includes(q);
      const matchPhone = qNum ? c.phone.replace(/[^0-9]/g, '').includes(qNum) : false;
      return matchName || matchPhone;
    });
  }, [allContacts, contactSearchQuery]);

  // Validate Step 1 (Personal details)
  const validateStep1 = (): boolean => {
    const errors: { [key: string]: string } = {};
    if (!tenantName.trim()) {
      errors.name = 'Tenant name is required';
    }
    if (!tenantPhone.trim()) {
      errors.phone = 'Phone number is required';
    }
    if (!tenantFlatNumber.trim()) {
      errors.flatNumber = 'Unit / Flat is required';
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Save Tenant
  const handleSaveTenant = async () => {
    if (!validateStep1()) {
      Toast.warning('Incomplete Details', 'Tenant name, phone number, and unit are required.');
      setTenantStep(1);
      return;
    }

    const errors: { [key: string]: string } = {};
    if (!tenantRentAmount.trim() || Number(tenantRentAmount) <= 0) {
      errors.rentAmount = 'Rent amount is required';
    }
    if (tenantDueDay && (Number(tenantDueDay) < 1 || Number(tenantDueDay) > 31)) {
      errors.dueDay = 'Due day must be 1 to 31';
    }
    if (!ebNumber.trim()) {
      errors.ebNumber = 'EB / Consumer number is required';
    }

    setFormErrors((prev) => ({ ...prev, ...errors }));
    if (Object.keys(errors).length > 0) {
      if (errors.ebNumber) {
        Toast.warning('EB Number Required', 'Please enter the EB / Consumer number for this flat.');
      } else {
        Toast.warning('Invalid Details', 'Please verify rent amount and due day.');
      }
      return;
    }

    try {
      setSavingTenant(true);
      await addOrUpdateTenant({
        property_id: property.id,
        flat_number: tenantFlatNumber.trim(),
        name: tenantName.trim(),
        phone_number: tenantPhone.trim(),
        occupation: '',
        rent_amount: Number(tenantRentAmount) || 0,
        due_day: Number(tenantDueDay) || 5,
        rent_start_date: tenantRentStartDate.trim(),

        security_deposit_enabled: securityDepositEnabled ? 1 : 0,
        security_deposit_amount: Number(securityDepositAmount) || 0,
        security_deposit_date: securityDepositDate.trim(),
        eb_number: ebNumber.trim(),
        aadhar_id: tenantIdProofNumber.trim(),
        is_id_verified: tenantIsIdVerified ? 1 : 0,
        id_photo_uri: tenantPhotoAttached ? 'id_proof_attached' : '',
        is_occupied: 1,
      });

      if (ebNumber.trim()) {
        await saveFlatEbNumber(property.id, tenantFlatNumber.trim(), ebNumber.trim());
      }

      setTenantModalVisible(false);
      loadFlats();
      Toast.success('Tenant Saved', `Details for ${tenantName.trim()} saved successfully.`);
    } catch (err: any) {
      Toast.error('Error', err?.message || 'Failed to save tenant');
    } finally {
      setSavingTenant(false);
    }
  };

  // Hardware Back Button Handler
  useEffect(() => {
    const onBackPress = () => {
      if (propertyMenuVisible) {
        setPropertyMenuVisible(false);
        return true;
      }
      if (viewingFlat) {
        setViewingFlat(null);
        return true;
      }
      if (menuVisible) {
        setMenuVisible(false);
        return true;
      }
      if (tenantModalVisible) {
        setTenantModalVisible(false);
        return true;
      }
      onBack();
      return true;
    };

    const backSub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => backSub.remove();
  }, [propertyMenuVisible, viewingFlat, menuVisible, tenantModalVisible, onBack]);

  // If viewing a tenant flat, render TenantViewScreen (Picture 1 & Picture 2)
  if (viewingFlat) {
    return (
      <TenantViewScreen
        flat={viewingFlat}
        property={property}
        onBack={() => {
          setViewingFlat(null);
          loadFlats();
        }}
        onEditTenant={(f) => {
          setViewingFlat(null);
          handleOpenAddTenant(f);
        }}
        onRemoveTenant={(f) => {
          handleRemoveTenant(f, true);
        }}
      />
    );
  }

  return (
    <View style={styles.container}>
      {/* Top Turquoise Header */}
      <View style={[styles.headerContainer, { paddingTop: Math.max(insets.top, 12) + 6 }]}>
        <View style={styles.headerTopRow}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={onBack}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <MaterialCommunityIcons name="arrow-left" size={24} color="#FFFFFF" />
          </TouchableOpacity>

          <Text style={styles.headerTitle} numberOfLines={1}>
            {property.building_name}
          </Text>

          <TouchableOpacity
            style={styles.headerDotsBtn}
            onPress={() => setPropertyMenuVisible((prev) => !prev)}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <MaterialCommunityIcons name="dots-vertical" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Main Content White Container (Overlapping rounded container matching Picture 1) */}
      <View style={styles.whiteContentContainer}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Top Building Address Row */}
          <View style={styles.buildingAddressRow}>
            <View style={styles.buildingAddressIconCircle}>
              <MaterialCommunityIcons
                name="office-building"
                size={20}
                color="#64748B"
              />
            </View>
            <Text style={styles.buildingAddressText} numberOfLines={1}>
              {property.building_address || property.location || 'Building Address'}
            </Text>
          </View>

          {/* Current Status Accordion Header */}
          <TouchableOpacity
            style={styles.currentStatusHeader}
            onPress={() => setIsCurrentStatusExpanded((prev) => !prev)}
            activeOpacity={0.7}
          >
            <Text style={styles.currentStatusTitle}>Current Status</Text>
            <MaterialCommunityIcons
              name={isCurrentStatusExpanded ? 'chevron-up' : 'chevron-down'}
              size={24}
              color={Colors.primaryDeep}
            />
          </TouchableOpacity>

          {/* Flats Status Card (Pictures 1 & 2 matching) */}
          {isCurrentStatusExpanded && (
            <View style={styles.flatsStatusCard}>
              <View style={styles.flatsStatusBanner}>
                <Text style={styles.flatsStatusBannerTitle}>Flats Status</Text>
              </View>
              <View style={styles.flatsStatusBody}>
                <View style={styles.statusStatRow}>
                  <Text style={styles.statusStatLabel}>Total Flats</Text>
                  <Text style={styles.statusStatValBlue}>
                    {String(totalCount).padStart(2, '0')}
                  </Text>
                </View>

                <View style={styles.statusStatRow}>
                  <Text style={styles.statusStatLabel}>Rented</Text>
                  <Text style={styles.statusStatValGreen}>
                    {String(occupiedCount).padStart(2, '0')}
                  </Text>
                </View>

                <View style={styles.statusStatRow}>
                  <Text style={styles.statusStatLabel}>To-Let</Text>
                  <Text style={styles.statusStatValRed}>
                    {String(vacantCount).padStart(2, '0')}
                  </Text>
                </View>

                <View style={styles.flatsStatusDivider} />

                <Text style={styles.rentDetailTitle}>Rent Detail</Text>

                <View style={styles.statusStatRow}>
                  <Text style={styles.statusStatLabel}>Collected</Text>
                  <Text style={styles.collectedRentValGreen}>
                    ₹ {totalCollectedRent.toLocaleString('en-IN')}
                  </Text>
                </View>

                <View style={styles.statusStatRow}>
                  <Text style={styles.statusStatLabel}>Pending</Text>
                  <Text
                    style={
                      totalPendingRent > 0
                        ? styles.pendingRentValRed
                        : styles.pendingRentValClear
                    }
                  >
                    ₹ {totalPendingRent.toLocaleString('en-IN')}
                  </Text>
                </View>
              </View>
            </View>
          )}

          {/* Search Bar matching screenshot */}
          <View style={styles.searchBarRow}>
            <View style={styles.searchInputWrapper}>
              <MaterialCommunityIcons name="magnify" size={20} color="#94A3B8" />
              <TextInput
                style={styles.searchInputField}
                placeholder="Search Tenant Name..."
                placeholderTextColor="#94A3B8"
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {searchQuery ? (
                <TouchableOpacity
                  onPress={() => setSearchQuery('')}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <MaterialCommunityIcons name="close-circle" size={16} color="#94A3B8" />
                </TouchableOpacity>
              ) : null}
            </View>
            <TouchableOpacity
              style={[
                styles.searchFilterBtn,
                statusFilter !== 'all' && styles.searchFilterBtnActive,
              ]}
              onPress={() => {
                setStatusFilter((prev) => (prev === 'all' ? 'occupied' : prev === 'occupied' ? 'vacant' : 'all'));
              }}
              activeOpacity={0.7}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <MaterialCommunityIcons
                name="filter-variant"
                size={22}
                color={statusFilter !== 'all' ? Colors.primaryDark : '#78350F'}
              />
            </TouchableOpacity>
          </View>

          {/* FLATS-(N) Collapsible Section Header Bar */}
          <TouchableOpacity
            style={styles.flatsBarContainer}
            onPress={() => setIsFlatsCollapsed((prev) => !prev)}
            activeOpacity={0.75}
          >
            <View style={styles.flatsBarLeft}>
              <MaterialCommunityIcons name="home-outline" size={20} color={Colors.primaryDeep} />
              <Text style={styles.flatsBarTitle}>FLATS-({flats.length})</Text>
            </View>
            <MaterialCommunityIcons
              name={isFlatsCollapsed ? 'chevron-down' : 'chevron-up'}
              size={24}
              color={Colors.primaryDeep}
            />
          </TouchableOpacity>



          {/* Flats List */}
          {!isFlatsCollapsed && (
            loading ? (
              <View style={styles.centerLoading}>
                <ActivityIndicator size="large" color={Colors.primary} />
              </View>
            ) : (
              <View style={styles.flatsList}>
                {filteredFlats.length === 0 ? (
                  <View style={styles.emptyFlats}>
                    <Text style={styles.emptyFlatsText}>
                      {searchQuery
                        ? `No flats found matching "${searchQuery}"`
                        : 'No flats available'}
                    </Text>
                  </View>
                ) : (
                  filteredFlats.map((flat, index) => {
                    const isOccupied = flat.is_occupied && flat.tenant;
                    const tenant = flat.tenant;
                    const rawNum = flat.flat_number.replace(/^(flat|flats)\s*[-:]?\s*/i, '').trim();

                    if (isOccupied) {
                      const occupiedTitle = rawNum ? `Flat - ${rawNum}` : flat.flat_number;
                      const payInfo = flatPaymentStatusMap[flat.flat_number];
                      const balance = payInfo ? payInfo.balance : 0;
                      const isPaid = payInfo ? (payInfo.status === 'Paid' || balance === 0) : true;

                      return (
                        <TouchableOpacity
                          key={`${flat.flat_number}-${index}`}
                          style={styles.occupiedFlatRow}
                          onPress={() => setViewingFlat(flat)}
                          activeOpacity={0.7}
                        >
                          {/* Left: Avatar Circle */}
                          <View style={styles.occupiedAvatarCircle}>
                            <MaterialCommunityIcons
                              name="account"
                              size={26}
                              color={Colors.primary}
                            />
                          </View>

                          {/* Center: Flat name, Tenant name, ID info */}
                          <View style={styles.occupiedCenterInfo}>
                            <Text style={styles.occupiedFlatName} numberOfLines={1}>
                              {occupiedTitle}
                            </Text>
                            <Text style={styles.occupiedTenantName} numberOfLines={1}>
                              {tenant?.name}
                            </Text>
                            <View style={styles.occupiedIdRow}>
                              <Text style={styles.occupiedIdLabel}>ID - </Text>
                              {tenant?.aadhar_id ? (
                                <Text style={styles.occupiedIdValue}>{tenant.aadhar_id}</Text>
                              ) : (
                                <MaterialCommunityIcons name="cancel" size={13} color="#94A3B8" />
                              )}
                            </View>
                          </View>

                          {/* Right: Payment Status, Rent Amount */}
                          <View style={styles.occupiedRightInfo}>
                            {isPaid ? (
                              <Text style={styles.occupiedPaymentStatusClear}>Clear</Text>
                            ) : (
                              <Text style={styles.occupiedPaymentStatusPending}>
                                {payInfo?.unpaidCount && payInfo.unpaidCount >= 2
                                  ? `Pending (${payInfo.unpaidCount} Mos)`
                                  : 'Pending'}
                              </Text>
                            )}
                            <Text style={styles.occupiedRentAmount}>
                              ₹ {isPaid ? '0' : balance.toLocaleString('en-IN')}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      );
                    }

                    // Vacant Flat ("To-let") -> redirect to Add Tenant on tap
                    const vacantSubtitle = rawNum ? `Flats - ${rawNum}` : flat.flat_number;
                    return (
                      <TouchableOpacity
                        key={`${flat.flat_number}-${index}`}
                        style={styles.vacantFlatRow}
                        onPress={() => handleOpenAddTenant(flat)}
                        activeOpacity={0.7}
                      >
                        {/* Left: Building outline icon */}
                        <View style={styles.vacantBuildingIconWrapper}>
                          <MaterialCommunityIcons
                            name="office-building-outline"
                            size={32}
                            color="#1E293B"
                          />
                        </View>

                        {/* Center: To-let & Flat number */}
                        <View style={styles.vacantCenterInfo}>
                          <Text style={styles.vacantToLetTitle}>To-let</Text>
                          <Text style={styles.vacantFlatSubtitle}>{vacantSubtitle}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>
            )
          )}
        </ScrollView>
      </View>

      {/* ---------------- FLAT 3-DOTS DROPDOWN MENU ---------------- */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <TouchableOpacity
          style={styles.propertyMenuBackdrop}
          activeOpacity={1}
          onPress={() => setMenuVisible(false)}
        >
          <View
            style={[
              styles.propertyMenuCard,
              { top: flatMenuY, width: 220 },
            ]}
          >
            {/* Header info inside dropdown */}
            <View style={styles.propertyMenuHeader}>
              <Text style={styles.propertyMenuBuildingName} numberOfLines={1}>
                {selectedFlat?.flat_number}
              </Text>
              <Text style={styles.propertyMenuUnitsSub} numberOfLines={1}>
                {selectedFlat?.is_occupied
                  ? `Tenant: ${selectedFlat.tenant?.name}`
                  : 'Currently Vacant • To-let'}
              </Text>
            </View>

            <View style={styles.propertyMenuDivider} />

            {/* If Occupied: "View Tenant" */}
            {selectedFlat?.is_occupied && (
              <TouchableOpacity
                style={styles.propertyMenuItem}
                onPress={() => {
                  const target = selectedFlat;
                  setMenuVisible(false);
                  setTimeout(() => {
                    if (target) {
                      setViewingFlat(target);
                    }
                  }, 100);
                }}
                activeOpacity={0.7}
              >
                <View style={styles.propertyMenuIconWrap}>
                  <MaterialCommunityIcons
                    name="eye-outline"
                    size={18}
                    color={Colors.primaryDark}
                  />
                </View>
                <Text style={styles.propertyMenuItemText}>View Tenant</Text>
              </TouchableOpacity>
            )}

            {/* "Edit Tenant Details" (Occupied) / "Add Tenant" (Vacant) */}
            <TouchableOpacity
              style={styles.propertyMenuItem}
              onPress={() => {
                const target = selectedFlat;
                setMenuVisible(false);
                setTimeout(() => {
                  handleOpenAddTenant(target || undefined);
                }, 100);
              }}
              activeOpacity={0.7}
            >
              <View style={styles.propertyMenuIconWrap}>
                <MaterialCommunityIcons
                  name={selectedFlat?.is_occupied ? 'account-edit-outline' : 'account-plus-outline'}
                  size={18}
                  color={Colors.primaryDark}
                />
              </View>
              <Text style={styles.propertyMenuItemText}>
                {selectedFlat?.is_occupied ? 'Edit Tenant Details' : 'Add Tenant'}
              </Text>
            </TouchableOpacity>

            {/* If Occupied: "Remove Tenant" */}
            {selectedFlat?.is_occupied && (
              <>
                <View style={styles.propertyMenuDivider} />
                <TouchableOpacity
                  style={styles.propertyMenuItemDestructive}
                  onPress={() => {
                    const target = selectedFlat;
                    setMenuVisible(false);
                    setTimeout(() => {
                      handleRemoveTenant(target || undefined);
                    }, 100);
                  }}
                  activeOpacity={0.7}
                >
                  <View style={styles.propertyMenuIconWrapDestructive}>
                    <MaterialCommunityIcons
                      name="account-remove-outline"
                      size={18}
                      color={Colors.danger}
                    />
                  </View>
                  <Text style={styles.propertyMenuItemTextDestructive}>Remove Tenant</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ---------------- PROPERTY 3-DOTS TOP-RIGHT DROPDOWN MENU ---------------- */}
      <Modal
        visible={propertyMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPropertyMenuVisible(false)}
      >
        <TouchableOpacity
          style={styles.propertyMenuBackdrop}
          activeOpacity={1}
          onPress={() => setPropertyMenuVisible(false)}
        >
          <View
            style={[
              styles.propertyMenuCard,
              { top: Math.max(insets.top, 12) + 48 },
            ]}
          >
            {/* Header info inside dropdown */}
            <View style={styles.propertyMenuHeader}>
              <Text style={styles.propertyMenuBuildingName} numberOfLines={1}>
                {property.building_name}
              </Text>
              <Text style={styles.propertyMenuUnitsSub} numberOfLines={1}>
                {property.units || 1} {property.units === 1 ? 'Unit' : 'Units'}
                {property.location ? ` • ${property.location}` : ''}
              </Text>
            </View>

            <View style={styles.propertyMenuDivider} />

            {/* Edit Property */}
            <TouchableOpacity
              style={styles.propertyMenuItem}
              onPress={handleEditFromMenu}
              activeOpacity={0.7}
            >
              <View style={styles.propertyMenuIconWrap}>
                <MaterialCommunityIcons
                  name="pencil-outline"
                  size={18}
                  color={Colors.primaryDark}
                />
              </View>
              <Text style={styles.propertyMenuItemText}>Edit Property</Text>
            </TouchableOpacity>

            {/* Rent Report */}
            <TouchableOpacity
              style={styles.propertyMenuItem}
              onPress={handleReportFromMenu}
              activeOpacity={0.7}
            >
              <View style={styles.propertyMenuIconWrap}>
                <MaterialCommunityIcons
                  name="table-large"
                  size={18}
                  color={Colors.primaryDark}
                />
              </View>
              <Text style={styles.propertyMenuItemText}>Rent Report</Text>
            </TouchableOpacity>

            <View style={styles.propertyMenuDivider} />

            {/* Delete Property */}
            <TouchableOpacity
              style={styles.propertyMenuItemDestructive}
              onPress={handleDeleteProperty}
              activeOpacity={0.7}
            >
              <View style={styles.propertyMenuIconWrapDestructive}>
                <MaterialCommunityIcons
                  name="trash-can-outline"
                  size={18}
                  color={Colors.danger}
                />
              </View>
              <Text style={styles.propertyMenuItemTextDestructive}>Delete Property</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ---------------- ADD / EDIT TENANT MODAL ---------------- */}
      <Modal
        visible={tenantModalVisible}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setTenantModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.addTenantModalContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Header matching screenshot and turquoise theme */}
          <View style={[styles.modalHeader, { paddingTop: Math.max(insets.top, 16) + 8 }]}>
            <TouchableOpacity
              onPress={() => setTenantModalVisible(false)}
              style={styles.modalCloseBtn}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <MaterialCommunityIcons name="arrow-left" size={24} color="#FFFFFF" />
            </TouchableOpacity>
            <Text style={styles.modalHeaderTitle}>
              {selectedFlat?.is_occupied ? 'Edit Tenant' : 'Add Tenant'}
            </Text>
            <View style={{ width: 24 }} />
          </View>

          {/* White Card Container with curved top border */}
          <View style={styles.modalWhiteBody}>
            {/* Stepper (Picture 1 & Picture 2) */}
            <View style={styles.stepperContainer}>
              <TouchableOpacity
                style={styles.stepItem}
                onPress={() => setTenantStep(1)}
                activeOpacity={0.8}
              >
                <View
                  style={[
                    styles.stepCircle,
                    tenantStep === 1 ? styles.stepCircleActive : styles.stepCircleDone,
                  ]}
                >
                  <Text
                    style={[
                      styles.stepNumber,
                      tenantStep === 1 ? styles.stepNumberActive : styles.stepNumberDone,
                    ]}
                  >
                    1
                  </Text>
                </View>
                <View style={styles.stepLabelCol}>
                  <Text style={[styles.stepLabelText, tenantStep === 1 && styles.stepLabelTextActive]}>
                    Tenant Personal
                  </Text>
                  <Text style={[styles.stepLabelText, tenantStep === 1 && styles.stepLabelTextActive]}>
                    Details
                  </Text>
                </View>
              </TouchableOpacity>

              <View style={styles.stepConnectorLine} />

              <TouchableOpacity
                style={styles.stepItem}
                onPress={() => {
                  if (validateStep1()) setTenantStep(2);
                }}
                activeOpacity={0.8}
              >
                <View
                  style={[
                    styles.stepCircle,
                    tenantStep === 2 ? styles.stepCircleActive : styles.stepCircleInactive,
                  ]}
                >
                  <Text
                    style={[
                      styles.stepNumber,
                      tenantStep === 2 ? styles.stepNumberActive : styles.stepNumberInactive,
                    ]}
                  >
                    2
                  </Text>
                </View>
                <View style={styles.stepLabelCol}>
                  <Text style={[styles.stepLabelText, tenantStep === 2 && styles.stepLabelTextActive]}>
                    Rent
                  </Text>
                  <Text style={[styles.stepLabelText, tenantStep === 2 && styles.stepLabelTextActive]}>
                    Details
                  </Text>
                </View>
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.modalBody}
              contentContainerStyle={styles.modalBodyContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {tenantStep === 1 ? (
                /* ================= STEP 1: PERSONAL DETAILS ================= */
                <View>
                  {/* Flat Number Badge on top */}
                  <View style={styles.flatBadgeHeaderRow}>
                    <View style={styles.flatBadgePill}>
                      <MaterialCommunityIcons name="door-open" size={16} color={Colors.primary} />
                      <Text style={styles.flatBadgePillText}>Flat {tenantFlatNumber}</Text>
                    </View>
                    <Text style={styles.flatBadgePropertySub}>{property.building_name}</Text>
                  </View>

                  {/* Upload Tenant Photo (Matching Screenshot) */}
                  <View style={styles.photoUploadSection}>
                    <Text style={styles.photoUploadHeaderTitle}>Upload Tenant Photo</Text>
                    <View style={styles.photoUploadCardsRow}>
                      <TouchableOpacity
                        style={styles.photoUploadCard}
                        onPress={handleToggleUploadPhoto}
                        activeOpacity={0.8}
                      >
                        <MaterialCommunityIcons name="cloud-upload-outline" size={36} color="#94A3B8" />
                        <Text style={styles.photoUploadCardText}>Select An Image</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.photoPreviewCard}
                        onPress={handleToggleUploadPhoto}
                        activeOpacity={0.8}
                      >
                        {tenantPhotoAttached ? (
                          <View style={styles.photoAttachedWrap}>
                            <MaterialCommunityIcons name="check-circle" size={28} color={Colors.primary} />
                            <Text style={styles.photoAttachedText}>Photo Attached</Text>
                          </View>
                        ) : (
                          <Text style={styles.noImageText}>No Image Selected</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Tenant Name - Animated Floating Label */}
                  <FloatingLabelInput
                    label="Tenant Name"
                    required
                    value={tenantName}
                    onChangeText={(t) => {
                      setTenantName(t);
                      if (formErrors.name) setFormErrors((p) => ({ ...p, name: '' }));
                    }}
                    error={formErrors.name}
                  />

                  {/* Phone number - Animated Floating Label with contact icon */}
                  <FloatingLabelInput
                    label="Phone number"
                    required
                    value={tenantPhone}
                    onChangeText={(t) => {
                      setTenantPhone(t);
                      if (formErrors.phone) setFormErrors((p) => ({ ...p, phone: '' }));
                    }}
                    keyboardType="phone-pad"
                    error={formErrors.phone}
                    rightIcon={
                      <MaterialCommunityIcons name="card-account-phone-outline" size={22} color={Colors.primary} />
                    }
                    onRightIconPress={handleOpenContactPicker}
                  />

                  {/* ID Proof Number - Animated Floating Label */}
                  <FloatingLabelInput
                    label="ID Proof Number"
                    value={tenantIdProofNumber}
                    onChangeText={setTenantIdProofNumber}
                  />

                  {/* Mark ID as verified */}
                  <TouchableOpacity
                    style={styles.checkboxRow}
                    onPress={() => setTenantIsIdVerified(!tenantIsIdVerified)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.checkboxLabel}>Mark ID as verified</Text>
                    <MaterialCommunityIcons
                      name={tenantIsIdVerified ? 'checkbox-marked' : 'checkbox-blank-outline'}
                      size={24}
                      color={tenantIsIdVerified ? Colors.primary : '#94A3B8'}
                    />
                  </TouchableOpacity>

                  {/* Step 1 Actions */}
                  <View style={styles.stepOneButtonsRow}>
                    <TouchableOpacity
                      style={styles.stepOneCancelBtn}
                      onPress={() => setTenantModalVisible(false)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.stepOneCancelBtnText}>Cancel</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.stepOneNextBtn}
                      onPress={() => {
                        if (validateStep1()) {
                          setTenantStep(2);
                        }
                      }}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.stepOneNextBtnText}>Next: Rent Details</Text>
                      <MaterialCommunityIcons name="arrow-right" size={18} color="#FFFFFF" />
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                /* ================= STEP 2: RENT DETAILS ================= */
                <View>
                  {/* Flat Number Badge on top */}
                  <View style={styles.flatBadgeHeaderRow}>
                    <View style={styles.flatBadgePill}>
                      <MaterialCommunityIcons name="door-open" size={16} color={Colors.primary} />
                      <Text style={styles.flatBadgePillText}>Flat {tenantFlatNumber}</Text>
                    </View>
                    <Text style={styles.flatBadgePropertySub}>{property.building_name}</Text>
                  </View>

                  {/* Rent Amount - Animated Floating Label */}
                  <FloatingLabelInput
                    label="Rent Amount"
                    required
                    value={tenantRentAmount}
                    onChangeText={(val) => {
                      setTenantRentAmount(val);
                      if (formErrors.rentAmount) {
                        setFormErrors((prev) => ({ ...prev, rentAmount: '' }));
                      }
                    }}
                    keyboardType="numeric"
                    prefix="₹ "
                    error={formErrors.rentAmount}
                  />

                  {/* Rent Due Day (1-31) - Animated Floating Label */}
                  <FloatingLabelInput
                    label="Rent Due Day (1-31)"
                    required
                    value={tenantDueDay}
                    onChangeText={(val) => {
                      setTenantDueDay(val);
                      if (formErrors.dueDay) {
                        setFormErrors((prev) => ({ ...prev, dueDay: '' }));
                      }
                    }}
                    keyboardType="numeric"
                    maxLength={2}
                    error={formErrors.dueDay}
                  />

                  {/* Rent Start Date* */}
                  <View style={styles.sectionFieldGroup}>
                    <Text style={styles.plainFieldLabel}>Rent Start Date*</Text>
                    <TouchableOpacity
                      style={styles.datePickerPressableBox}
                      onPress={() => setActiveDatePicker('rent_start')}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.datePickerValueText}>
                        {formatDateDisplay(tenantRentStartDate)}
                      </Text>
                      <MaterialCommunityIcons
                        name="calendar-month-outline"
                        size={22}
                        color="#64748B"
                      />
                    </TouchableOpacity>
                  </View>

                  {/* Security Deposit Card */}
                  <View style={styles.toggleCard}>
                    <View style={styles.toggleCardHeader}>
                      <Text style={styles.toggleTitleBold}>Security Deposit</Text>
                      <Switch
                        value={securityDepositEnabled}
                        onValueChange={setSecurityDepositEnabled}
                        trackColor={{ false: '#CBD5E1', true: Colors.primary }}
                        thumbColor={securityDepositEnabled ? Colors.primaryDark : '#FFFFFF'}
                      />
                    </View>
                    {securityDepositEnabled && (
                      <View style={{ marginTop: 14 }}>
                        <FloatingLabelInput
                          label="Deposit Amount"
                          required
                          value={securityDepositAmount}
                          onChangeText={setSecurityDepositAmount}
                          keyboardType="numeric"
                          prefix="₹ "
                        />

                        <View style={[styles.sectionFieldGroup, { marginTop: 4 }]}>
                          <Text style={styles.plainFieldLabel}>Security Deposit Date</Text>
                          <TouchableOpacity
                            style={styles.datePickerPressableBox}
                            onPress={() => setActiveDatePicker('security_deposit')}
                            activeOpacity={0.8}
                          >
                            <Text
                              style={[
                                styles.datePickerValueText,
                                !securityDepositDate && { color: '#94A3B8' },
                              ]}
                            >
                              {securityDepositDate
                                ? formatDateDisplay(securityDepositDate)
                                : 'DD-MM-YYYY'}
                            </Text>
                            <MaterialCommunityIcons
                              name="calendar-month-outline"
                              size={22}
                              color="#64748B"
                            />
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}
                  </View>

                  {/* EB (Electricity Board) Number Card */}
                  <View style={styles.utilityCardContainer}>
                    <View style={styles.utilityPillBadge}>
                      <Text style={styles.utilityPillText}>EB Details*</Text>
                    </View>
                    <View style={styles.utilityCardBody}>
                      <FloatingLabelInput
                        label="EB / Consumer Number"
                        required
                        value={ebNumber}
                        onChangeText={(t) => {
                          setEbNumber(t);
                          if (formErrors.ebNumber) {
                            setFormErrors((prev) => ({ ...prev, ebNumber: '' }));
                          }
                        }}
                        error={formErrors.ebNumber}
                      />
                      <Text style={styles.ebFixedCaption}>
                        ⚡ Fixed for this flat. Required for electricity billing and records.
                      </Text>
                    </View>
                  </View>

                  {/* Step 2 Bottom Buttons (Matching Picture 2: BACK & UPDATE) */}
                  <View style={styles.stepTwoButtonsRow}>
                    <TouchableOpacity
                      style={styles.stepTwoBackBtn}
                      onPress={() => setTenantStep(1)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.stepTwoBackBtnText}>BACK</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.stepTwoUpdateBtn}
                      onPress={handleSaveTenant}
                      disabled={savingTenant}
                      activeOpacity={0.85}
                    >
                      {savingTenant ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Text style={styles.stepTwoUpdateBtnText}>
                          {selectedFlat?.is_occupied ? 'UPDATE' : 'SAVE TENANT'}
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </ScrollView>
          </View>



          {/* SHARED APP DATE PICKER */}
          <AppDatePicker
            visible={activeDatePicker !== null}
            value={
              activeDatePicker === 'rent_start'
                ? tenantRentStartDate
                : activeDatePicker === 'security_deposit'
                  ? securityDepositDate
                  : getTodayFormatted()
            }
            onChange={(newDate) => {
              if (activeDatePicker === 'rent_start') setTenantRentStartDate(newDate);
              else if (activeDatePicker === 'security_deposit') setSecurityDepositDate(newDate);
              setActiveDatePicker(null);
            }}
            onClose={() => setActiveDatePicker(null)}
          />

          {/* IN-APP CONTACTS PHONEBOOK PICKER MODAL */}
          <Modal
            visible={contactsModalVisible}
            animationType="slide"
            transparent={true}
            onRequestClose={() => setContactsModalVisible(false)}
          >
            <View style={styles.contactsModalOverlay}>
              <View style={[styles.contactsModalCard, { paddingBottom: Math.max(insets.bottom, 16) }]}>
                {/* Drag indicator / Handle */}
                <View style={styles.contactsModalHandle} />

                {/* Header */}
                <View style={styles.contactsModalHeader}>
                  <View style={styles.contactsModalTitleCol}>
                    <Text style={styles.contactsModalTitle}>Select from Contacts</Text>
                    <Text style={styles.contactsModalSubtitle}>
                      Choose a contact to import their phone number
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => setContactsModalVisible(false)}
                    style={styles.contactsModalCloseBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <MaterialCommunityIcons name="close" size={22} color="#64748B" />
                  </TouchableOpacity>
                </View>

                {/* Search Input */}
                <View style={styles.contactsSearchRow}>
                  <MaterialCommunityIcons name="magnify" size={20} color="#94A3B8" />
                  <TextInput
                    style={styles.contactsSearchInput}
                    placeholder="Search by name or number..."
                    placeholderTextColor="#94A3B8"
                    value={contactSearchQuery}
                    onChangeText={setContactSearchQuery}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {contactSearchQuery.length > 0 && (
                    <TouchableOpacity onPress={() => setContactSearchQuery('')}>
                      <MaterialCommunityIcons name="close-circle" size={18} color="#94A3B8" />
                    </TouchableOpacity>
                  )}
                </View>

                {/* Contacts List or Loading */}
                {contactsLoading ? (
                  <View style={styles.contactsLoadingWrap}>
                    <ActivityIndicator size="large" color={Colors.primary} />
                    <Text style={styles.contactsLoadingText}>Loading contacts from phonebook...</Text>
                  </View>
                ) : filteredContacts.length === 0 ? (
                  <View style={styles.contactsEmptyWrap}>
                    <MaterialCommunityIcons name="account-search-outline" size={48} color="#CBD5E1" />
                    <Text style={styles.contactsEmptyTitle}>No Contacts Found</Text>
                    <Text style={styles.contactsEmptySub}>
                      {contactSearchQuery.trim()
                        ? 'No contacts match your search.'
                        : 'No contacts with phone numbers found on this phone.'}
                    </Text>
                  </View>
                ) : (
                  <FlatList
                    data={filteredContacts}
                    keyExtractor={(item, idx) => `${item.id}-${idx}`}
                    keyboardShouldPersistTaps="handled"
                    initialNumToRender={20}
                    maxToRenderPerBatch={25}
                    windowSize={10}
                    ItemSeparatorComponent={() => <View style={styles.contactItemSeparator} />}
                    renderItem={({ item }) => {
                      const initials = item.name
                        .split(' ')
                        .map((w) => w[0])
                        .filter(Boolean)
                        .slice(0, 2)
                        .join('')
                        .toUpperCase() || '#';

                      return (
                        <TouchableOpacity
                          style={styles.contactItemRow}
                          onPress={() => handleSelectContactItem(item)}
                          activeOpacity={0.7}
                        >
                          <View style={styles.contactAvatarCircle}>
                            <Text style={styles.contactAvatarText}>{initials}</Text>
                          </View>
                          <View style={styles.contactInfoCol}>
                            <Text style={styles.contactNameText} numberOfLines={1}>
                              {item.name}
                            </Text>
                            <Text style={styles.contactPhoneText} numberOfLines={1}>
                              {item.phone}
                            </Text>
                          </View>
                          <MaterialCommunityIcons name="chevron-right" size={20} color="#CBD5E1" />
                        </TouchableOpacity>
                      );
                    }}
                  />
                )}
              </View>
            </View>
          </Modal>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.primaryDeep,
  },
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
  backButton: {
    padding: 6,
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    marginLeft: 8,
    marginRight: 8,
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerReportBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  headerDotsBtn: {
    padding: 6,
  },
  headerEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.28)',
  },
  headerEditBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  whiteContentContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 0,
    paddingTop: 4,
    paddingBottom: 40,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  buildingIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.primaryBorder,
  },
  addressText: {
    flex: 1,
    fontSize: 14,
    color: '#475569',
    lineHeight: 20,
  },
  statusSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  currentStatusTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.primaryDark,
  },
  statusButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  statusBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBtnActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  statusBtnActiveOccupied: {
    backgroundColor: '#059669',
    borderColor: '#059669',
  },
  statusBtnActiveVacant: {
    backgroundColor: '#D97706',
    borderColor: '#D97706',
  },
  statusBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  statusBtnTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  statusBtnTextActiveOccupied: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  statusBtnTextActiveVacant: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  searchContainer: {
    marginBottom: 16,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.primaryBorder,
    borderRadius: 25,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 14,
    color: '#0F172A',
    paddingVertical: 2,
  },
  flatsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.primaryTint,
    borderWidth: 1,
    borderColor: Colors.primaryBorder,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  flatsBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  flatsBannerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.primaryDark,
    letterSpacing: 0.5,
  },
  addTenantActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
    paddingLeft: 4,
  },
  circlePlusBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 2,
  },
  addTenantLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.primaryDark,
  },
  centerLoading: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  flatsList: {
    gap: 12,
  },
  emptyFlats: {
    paddingVertical: 30,
    alignItems: 'center',
  },
  emptyFlatsText: {
    color: '#94A3B8',
    fontSize: 14,
  },
  flatItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primaryBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarCircleVacant: {
    backgroundColor: '#F1F5F9',
  },
  flatMiddleArea: {
    flex: 1,
  },
  flatHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
    paddingRight: 6,
  },
  flatNameText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  rentBadge: {
    backgroundColor: Colors.primaryTint,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.primaryBorder,
  },
  rentBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primaryDark,
  },
  tenantNameText: {
    fontSize: 13,
    color: '#334155',
    marginBottom: 4,
    fontWeight: '500',
  },
  idStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  verifiedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.primaryTint,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 4,
    borderWidth: 0.5,
    borderColor: Colors.primaryBorder,
  },
  verifiedTagText: {
    fontSize: 11,
    color: Colors.primaryDark,
    fontWeight: '700',
  },
  idLabel: {
    fontSize: 12,
    color: '#64748B',
  },
  idUnverifiedText: {
    fontSize: 12,
    color: '#94A3B8',
  },
  dueDayText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  startDateText: {
    fontSize: 12,
    color: '#64748B',
  },
  vacantSubtext: {
    fontSize: 13,
    color: '#94A3B8',
    fontStyle: 'italic',
  },
  flatRightArea: {
    alignItems: 'flex-end',
    gap: 6,
  },
  statusBadgeOccupied: {
    backgroundColor: Colors.primaryTint,
    borderWidth: 1,
    borderColor: Colors.primaryBorder,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusBadgeOccupiedText: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '600',
  },
  statusBadgeVacant: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusBadgeVacantText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '500',
  },
  threeDotsBtn: {
    padding: 4,
  },

  // Modal Overlay
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  actionSheetCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    gap: 12,
  },
  sheetHeader: {
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },
  sheetSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
  },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  sheetOptionText: {
    fontSize: 16,
    color: '#0F172A',
    fontWeight: '600',
  },
  sheetOptionDestructive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  sheetOptionTextDestructive: {
    fontSize: 16,
    color: Colors.danger,
    fontWeight: '600',
  },
  sheetCancelBtn: {
    marginTop: 8,
    backgroundColor: '#F1F5F9',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  sheetCancelBtnText: {
    color: '#475569',
    fontSize: 15,
    fontWeight: '700',
  },

  // Add / Edit Tenant Full Modal
  addTenantModalContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  modalHeader: {
    backgroundColor: Colors.primaryDeep,
    paddingHorizontal: 16,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalCloseBtn: {
    padding: 4,
  },
  modalHeaderTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalBody: {
    flex: 1,
  },
  modalBodyContent: {
    padding: 20,
    paddingBottom: 40,
  },
  formGroup: {
    marginBottom: 16,
  },
  formLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0F172A',
    marginBottom: 6,
  },
  optionalBadge: {
    fontSize: 12,
    fontWeight: '400',
    color: '#64748B',
  },
  formInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
  },
  inputErrorBorder: {
    borderColor: Colors.danger,
    backgroundColor: '#FEF2F2',
  },
  formInput: {
    flex: 1,
    fontSize: 14,
    color: '#0F172A',
    paddingVertical: 12,
  },
  fieldErrorText: {
    color: Colors.danger,
    fontSize: 12,
    marginTop: 4,
  },
  dropdownBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  dropdownSelectedText: {
    fontSize: 14,
    color: '#0F172A',
    fontWeight: '500',
  },
  twoColumnRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  twoColumnLeft: {
    flex: 1.2,
  },
  twoColumnRight: {
    flex: 0.8,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    marginBottom: 16,
  },
  checkboxLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  uploadDashedBox: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#CBD5E1',
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 22,
    paddingHorizontal: 16,
    marginBottom: 24,
    gap: 8,
  },
  uploadDashedBoxAttached: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryTint,
  },
  uploadDashedText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
  },
  uploadDashedTextAttached: {
    color: Colors.primaryDeep,
    fontWeight: '700',
  },
  saveTenantBtn: {
    backgroundColor: Colors.primary,
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
    marginBottom: 24,
  },
  saveTenantBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  // Dropdown Picker Modal
  dropdownModalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36,
    maxHeight: 450,
  },
  dropdownModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  dropdownModalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  dropdownOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  dropdownOptionRowSelected: {
    backgroundColor: Colors.primaryTint,
  },
  flatOptionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dropdownOptionText: {
    fontSize: 14,
    color: '#334155',
  },
  dropdownOptionTextSelected: {
    color: Colors.primaryDark,
    fontWeight: '700',
  },
  flatOptionBadge: {
    fontSize: 12,
    color: '#64748B',
  },

  // Modal White Body & Stepper
  modalWhiteBody: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    backgroundColor: '#FFFFFF',
  },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepCircleActive: {
    backgroundColor: Colors.primaryDark,
  },
  stepCircleDone: {
    backgroundColor: '#94A3B8',
  },
  stepCircleInactive: {
    backgroundColor: '#CBD5E1',
  },
  stepNumber: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  stepNumberActive: {
    color: '#FFFFFF',
  },
  stepNumberDone: {
    color: '#FFFFFF',
  },
  stepNumberInactive: {
    color: '#64748B',
  },
  stepLabelCol: {
    justifyContent: 'center',
  },
  stepLabelText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748B',
    lineHeight: 15,
  },
  stepLabelTextActive: {
    color: '#0F172A',
    fontWeight: '700',
  },
  stepConnectorLine: {
    flex: 1,
    height: 1.5,
    backgroundColor: '#CBD5E1',
    marginHorizontal: 10,
  },

  // Step 1 Buttons
  stepOneButtonsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
    marginBottom: 36,
  },
  stepOneCancelBtn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepOneCancelBtnText: {
    color: '#475569',
    fontSize: 15,
    fontWeight: '700',
  },
  stepOneNextBtn: {
    flex: 1.4,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.primaryDark,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    shadowColor: Colors.primaryDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  stepOneNextBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },

  // Floating Input Box (matching picture)
  floatingInputCard: {
    position: 'relative',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    marginTop: 14,
    marginBottom: 12,
  },
  floatingInputLabel: {
    position: 'absolute',
    top: -9,
    left: 14,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 6,
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  floatingTextInput: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0F172A',
    padding: 0,
    height: 24,
  },



  // Plain field & Date Picker box
  sectionFieldGroup: {
    marginBottom: 14,
  },
  plainFieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
  },
  datePickerPressableBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    height: 48,
  },
  datePickerValueText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#0F172A',
  },

  // Toggle Card (Maintenance & Security Deposit)
  toggleCard: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    padding: 16,
    marginBottom: 14,
  },
  toggleCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleTitleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  toggleTitleBold: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  toggleTitleSub: {
    fontSize: 13,
    fontWeight: '400',
    color: '#64748B',
  },

  // Utility Card with Pill Badge (Water Bill & Electricity Bill)
  utilityCardContainer: {
    marginTop: 14,
    marginBottom: 18,
    position: 'relative',
  },
  utilityPillBadge: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.primaryDark,
    paddingHorizontal: 18,
    paddingVertical: 6,
    borderRadius: 18,
    marginLeft: 14,
    marginBottom: -12,
    zIndex: 2,
    elevation: 3,
    shadowColor: Colors.primaryDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  utilityPillText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  utilityCardBody: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    padding: 16,
    paddingTop: 20,
  },
  utilityTypeDropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    height: 46,
    marginTop: 4,
  },
  utilityTypeDropdownText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },

  // Step 2 Bottom Buttons (Matching Picture 2)
  stepTwoButtonsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
    marginBottom: 36,
  },
  stepTwoBackBtn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.primaryDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepTwoBackBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  stepTwoUpdateBtn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primaryDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  stepTwoUpdateBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // Flat badge banner on top
  flatBadgeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
  },
  flatBadgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  flatBadgePillText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginLeft: 6,
  },
  flatBadgePropertySub: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748B',
  },

  // Photo Upload cards (matching screenshot)
  photoUploadSection: {
    marginBottom: 16,
  },
  photoUploadHeaderTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
    marginBottom: 10,
  },
  photoUploadCardsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  photoUploadCard: {
    flex: 1,
    height: 90,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  photoUploadCardText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748B',
    marginTop: 6,
  },
  photoPreviewCard: {
    flex: 1,
    height: 90,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  noImageText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748B',
    textAlign: 'center',
  },
  photoAttachedWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoAttachedText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.primaryDark,
    marginTop: 4,
  },

  // EB fixed note
  ebFixedCaption: {
    fontSize: 11,
    color: '#64748B',
    marginTop: -4,
    marginBottom: 6,
    paddingHorizontal: 4,
    fontStyle: 'italic',
  },

  // Header Dots Button
  headerDotsBtn: {
    padding: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Top Building Address Row
  buildingAddressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  buildingAddressIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buildingAddressText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
    flex: 1,
  },

  // Current Status Accordion Header
  currentStatusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 4,
  },
  currentStatusTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.primaryDeep,
  },

  // Flats Status Card (Pictures 1 & 2 matching)
  flatsStatusCard: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
  },
  flatsStatusBanner: {
    backgroundColor: Colors.primaryDark,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flatsStatusBannerTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  flatsStatusBody: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  statusStatRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  statusStatLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#334155',
  },
  statusStatValBlue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E3A8A',
  },
  statusStatValGreen: {
    fontSize: 15,
    fontWeight: '700',
    color: '#16A34A',
  },
  statusStatValRed: {
    fontSize: 15,
    fontWeight: '700',
    color: '#DC2626',
  },
  flatsStatusDivider: {
    height: 1,
    backgroundColor: '#CBD5E1',
    marginVertical: 10,
  },
  rentDetailTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E293B',
    textAlign: 'center',
    marginBottom: 8,
  },
  collectedRentValGreen: {
    fontSize: 15,
    fontWeight: '800',
    color: '#15803D',
  },
  pendingRentValRed: {
    fontSize: 15,
    fontWeight: '800',
    color: '#991B1B',
  },
  pendingRentValClear: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },

  // Search Bar matching screenshot
  searchBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    marginTop: 8,
    marginBottom: 12,
  },
  searchInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    height: 42,
    gap: 8,
  },
  searchInputField: {
    flex: 1,
    fontSize: 13,
    color: '#0F172A',
    paddingVertical: 0,
  },
  searchFilterBtn: {
    padding: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchFilterBtnActive: {
    backgroundColor: Colors.primaryTint,
    borderRadius: 8,
  },

  // FLATS-(N) Collapsible Section Header Bar
  flatsBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.primaryTint,
    marginHorizontal: 16,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.primaryBorder,
  },
  flatsBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  flatsBarTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.primaryDeep,
    letterSpacing: 0.5,
  },

  circlePlusRow: {
    paddingHorizontal: 16,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  circlePlusBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.primaryDeep,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primaryDeep,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 2,
  },

  // Occupied Flat Row (Picture 1 matching)
  occupiedFlatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E2E8F0',
  },
  occupiedAvatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primaryTint,
    borderWidth: 1,
    borderColor: Colors.primaryBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  occupiedCenterInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  occupiedFlatName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  occupiedTenantName: {
    fontSize: 13,
    fontWeight: '500',
    color: '#334155',
    marginTop: 2,
  },
  occupiedIdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    gap: 2,
  },
  occupiedIdLabel: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '500',
  },
  occupiedIdValue: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  occupiedRightInfo: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginLeft: 8,
  },
  occupiedPaymentStatusPending: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.danger,
  },
  occupiedPaymentStatusClear: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primaryDark,
  },
  occupiedPaymentStatusPartial: {
    fontSize: 13,
    fontWeight: '700',
    color: '#D97706',
  },
  occupiedPaymentStatusPaid: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primaryDark,
  },
  occupiedRentAmount: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },
  occupiedThreeDotsBtn: {
    paddingLeft: 6,
    paddingRight: 0,
    paddingVertical: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Vacant flat ("To-let" matching Picture 1)
  vacantFlatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E2E8F0',
  },
  vacantBuildingIconWrapper: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  vacantCenterInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  vacantToLetTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  vacantFlatSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '500',
  },
  vacantThreeDotsBtn: {
    padding: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Property 3-Dots Dropdown Menu
  propertyMenuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
  },
  propertyMenuCard: {
    position: 'absolute',
    right: 14,
    width: 210,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  propertyMenuHeader: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 6,
  },
  propertyMenuBuildingName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  propertyMenuUnitsSub: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
    marginTop: 1,
  },
  propertyMenuDivider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 4,
  },
  propertyMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  propertyMenuIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: Colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  propertyMenuItemText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1E293B',
  },
  propertyMenuItemDestructive: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  propertyMenuIconWrapDestructive: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  propertyMenuItemTextDestructive: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.danger,
  },
  contactsModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  contactsModalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: '82%',
    paddingTop: 10,
    paddingHorizontal: 16,
  },
  contactsModalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E2E8F0',
    alignSelf: 'center',
    marginBottom: 10,
  },
  contactsModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  contactsModalTitleCol: {
    flex: 1,
  },
  contactsModalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  contactsModalSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748B',
    marginTop: 2,
  },
  contactsModalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactsSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 6,
    gap: 8,
    marginBottom: 12,
  },
  contactsSearchInput: {
    flex: 1,
    fontSize: 14,
    color: '#0F172A',
    padding: 0,
  },
  contactsLoadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  contactsLoadingText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#64748B',
  },
  contactsEmptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 50,
    gap: 8,
  },
  contactsEmptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#475569',
  },
  contactsEmptySub: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
    maxWidth: 240,
  },
  contactItemSeparator: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginLeft: 54,
  },
  contactItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  contactAvatarCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.primaryBorder,
  },
  contactAvatarText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.primary,
  },
  contactInfoCol: {
    flex: 1,
  },
  contactNameText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 2,
  },
  contactPhoneText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#64748B',
  },
});
