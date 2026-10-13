import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  BackHandler,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRoute, useNavigation, useFocusEffect, RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Colors } from '../theme/colors';
import {
  insertProperty,
  updateProperty,
  getPropertyById,
  PropertyInput,
} from '../db/database';
import FloatingLabelInput from '../components/FloatingLabelInput';
import { Toast } from '../components/Toast';
import { RootTabParamList } from '../navigation/AppNavigator';

type AddPropertyScreenRouteProp = RouteProp<RootTabParamList, 'Add Property'>;

export default function AddPropertyScreen() {
  const route = useRoute<AddPropertyScreenRouteProp>();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  useFocusEffect(
    useCallback(() => {
      // Ensure Add Property screen stays portrait
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    }, [])
  );

  const propertyId = route.params?.propertyId;
  const initialBuildingName = route.params?.buildingName;
  const isEditing = typeof propertyId === 'number';

  const [buildingName, setBuildingName] = useState(initialBuildingName || '');
  const [buildingAddress, setBuildingAddress] = useState('');
  const [location, setLocation] = useState('');
  const [units, setUnits] = useState('1');
  const [landlordName, setLandlordName] = useState('');
  const [notes, setNotes] = useState('');

  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  useEffect(() => {
    if (isEditing) {
      loadPropertyData(propertyId);
    } else {
      resetForm();
    }
  }, [propertyId]);

  const resetForm = () => {
    setBuildingName('');
    setBuildingAddress('');
    setLocation('');
    setUnits('1');
    setLandlordName('');
    setNotes('');
    setErrors({});
  };

  const loadPropertyData = async (id: number) => {
    try {
      setFetching(true);
      const data = await getPropertyById(id);
      if (data) {
        setBuildingName(data.building_name || '');
        setBuildingAddress(data.building_address || '');
        setLocation(data.location || '');
        setUnits(data.units ? data.units.toString() : '1');
        setLandlordName(data.landlord_name || '');
        setNotes(data.notes || '');
      } else {
        Toast.error('Error', 'Property not found.');
        navigation.navigate('Dashboard');
      }
    } catch (err: any) {
      Toast.error('Error', err?.message || 'Could not load property');
    } finally {
      setFetching(false);
    }
  };

  const validate = (): boolean => {
    const newErrors: { [key: string]: string } = {};

    if (!buildingName.trim()) {
      newErrors.buildingName = 'Building name is required';
    }
    if (!buildingAddress.trim()) {
      newErrors.buildingAddress = 'Building address is required';
    }
    if (!location.trim()) {
      newErrors.location = 'Location is required';
    }
    if (units.trim() && (isNaN(Number(units)) || Number(units) < 1)) {
      newErrors.units = 'Units must be at least 1';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) {
      Toast.warning('Incomplete Details', 'Please fill in all required fields.');
      return;
    }

    try {
      setLoading(true);

      const propertyData: PropertyInput = {
        building_name: buildingName.trim(),
        building_address: buildingAddress.trim(),
        location: location.trim(),
        units: Math.max(1, parseInt(units, 10) || 1),
        landlord_name: landlordName.trim(),
        notes: notes.trim(),
      };

      if (isEditing) {
        await updateProperty(propertyId, propertyData);
        Toast.success(
          'Property Updated',
          `"${buildingName}" has been successfully updated.`
        );
        navigation.navigate('Dashboard');
      } else {
        await insertProperty(propertyData);
        Toast.success(
          'Property Created',
          `"${buildingName}" has been added to your portfolio.`
        );
        resetForm();
        navigation.navigate('Dashboard');
      }
    } catch (err: any) {
      Toast.error(
        'Save Failed',
        err?.message || 'An error occurred while saving the property.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    resetForm();
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate('Dashboard');
    }
  };

  useEffect(() => {
    const onBackPress = () => {
      handleCancel();
      return true;
    };
    const backSub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => backSub.remove();
  }, []);

  if (fetching) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Loading property details...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.keyboardContainer}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.container}>
        {/* Top Turquoise Header */}
        <View style={[styles.headerContainer, { paddingTop: Math.max(insets.top, 12) + 6 }]}>
          <View style={styles.headerTopRow}>
            <TouchableOpacity
              style={styles.headerBackBtn}
              onPress={handleCancel}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <MaterialCommunityIcons name="arrow-left" size={24} color="#FFFFFF" />
            </TouchableOpacity>

            <View style={styles.headerTitleArea}>
              <Text style={styles.title} numberOfLines={1}>
                {isEditing ? (buildingName || initialBuildingName || 'Edit Property') : 'Add Property'}
              </Text>
              <Text style={styles.subtitle}>
                {isEditing ? 'Edit Property Details' : 'Register New Building'}
              </Text>
            </View>

            <TouchableOpacity
              style={styles.headerCancelPill}
              onPress={handleCancel}
              activeOpacity={0.7}
            >
              <Text style={styles.headerCancelPillText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Main Content Rounded Container */}
        <View style={styles.whiteContentContainer}>
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Building Name */}
            <FloatingLabelInput
              label="Building Name"
              required
              value={buildingName}
              onChangeText={(text) => {
                setBuildingName(text);
                if (errors.buildingName) {
                  setErrors((prev) => ({ ...prev, buildingName: '' }));
                }
              }}
              error={errors.buildingName}
              rightIcon={
                <MaterialCommunityIcons
                  name="office-building"
                  size={20}
                  color={errors.buildingName ? Colors.danger : Colors.textSecondary}
                />
              }
            />

            {/* Building Address */}
            <FloatingLabelInput
              label="Building Address"
              required
              value={buildingAddress}
              onChangeText={(text) => {
                setBuildingAddress(text);
                if (errors.buildingAddress) {
                  setErrors((prev) => ({ ...prev, buildingAddress: '' }));
                }
              }}
              error={errors.buildingAddress}
              rightIcon={
                <MaterialCommunityIcons
                  name="home-map-marker"
                  size={20}
                  color={errors.buildingAddress ? Colors.danger : Colors.textSecondary}
                />
              }
            />

            {/* Location */}
            <FloatingLabelInput
              label="Location"
              required
              value={location}
              onChangeText={(text) => {
                setLocation(text);
                if (errors.location) {
                  setErrors((prev) => ({ ...prev, location: '' }));
                }
              }}
              error={errors.location}
              rightIcon={
                <MaterialCommunityIcons
                  name="map-marker-radius-outline"
                  size={20}
                  color={errors.location ? Colors.danger : Colors.textSecondary}
                />
              }
            />

            {/* Row: Units & Landlord */}
            <View style={styles.rowFields}>
              <FloatingLabelInput
                label="Units"
                value={units}
                onChangeText={(text) => {
                  setUnits(text);
                  if (errors.units) {
                    setErrors((prev) => ({ ...prev, units: '' }));
                  }
                }}
                keyboardType="number-pad"
                error={errors.units}
                containerStyle={{ flex: 0.8, marginRight: 10 }}
                rightIcon={
                  <MaterialCommunityIcons
                    name="domain"
                    size={20}
                    color={errors.units ? Colors.danger : Colors.textSecondary}
                  />
                }
              />

              <FloatingLabelInput
                label="Landlord / Contact"
                value={landlordName}
                onChangeText={setLandlordName}
                containerStyle={{ flex: 1.2 }}
                rightIcon={
                  <MaterialCommunityIcons
                    name="account-tie-outline"
                    size={20}
                    color={Colors.textSecondary}
                  />
                }
              />
            </View>

            {/* Notes / Description */}
            <FloatingLabelInput
              label="Notes & Special Features"
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
            />

          {/* Action Buttons */}
          <View style={styles.buttonRow}>
            {isEditing && (
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={handleCancel}
                disabled={loading}
                activeOpacity={0.8}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[
                styles.submitButton,
                isEditing ? styles.submitButtonEdit : null,
                isEditing ? { flex: 1 } : { width: '100%' },
              ]}
              onPress={handleSave}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <MaterialCommunityIcons
                    name={isEditing ? 'content-save-edit-outline' : 'plus-circle'}
                    size={20}
                    color="#FFFFFF"
                  />
                  <Text style={styles.submitButtonText}>
                    {isEditing ? 'Update Property' : 'Save Property'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </View>
  </KeyboardAvoidingView>
);
}

const styles = StyleSheet.create({
  keyboardContainer: {
    flex: 1,
    backgroundColor: Colors.primaryDeep,
  },
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
  headerBackBtn: {
    padding: 6,
    marginRight: 6,
  },
  headerTitleArea: {
    flex: 1,
  },
  headerCancelPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  headerCancelPillText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
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
  content: {
    padding: 16,
    paddingTop: 16,
    paddingBottom: 40,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  subtitle: {
    fontSize: 12,
    color: '#FCE7EA',
    marginTop: 1,
    lineHeight: 16,
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  fieldGroup: {
    marginBottom: 16,
  },
  rowFields: {
    flexDirection: 'row',
    gap: 12,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 6,
  },
  required: {
    color: Colors.danger,
    fontWeight: '700',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  inputError: {
    borderColor: Colors.danger,
    backgroundColor: '#FEF2F2',
  },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 14,
    color: Colors.textPrimary,
    paddingVertical: 12,
  },
  multilineWrapper: {
    alignItems: 'flex-start',
    paddingVertical: 8,
  },
  multilineInput: {
    minHeight: 70,
    paddingVertical: 4,
  },
  errorText: {
    color: Colors.danger,
    fontSize: 12,
    marginTop: 4,
    marginLeft: 2,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
  },
  cancelButton: {
    flex: 0.8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.primaryBorder,
    backgroundColor: Colors.primaryTint,
  },
  cancelButtonText: {
    color: Colors.primaryDark,
    fontWeight: '700',
    fontSize: 15,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: 10,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  submitButtonEdit: {
    backgroundColor: Colors.primaryDark,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
});
