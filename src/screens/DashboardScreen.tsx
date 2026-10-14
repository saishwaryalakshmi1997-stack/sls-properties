import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  BackHandler,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  initDatabaseAndTest,
  DbTestResult,
  getPropertyStats,
  getAllProperties,
  PropertyStats,
  Property,
} from '../db/database';
import { syncAll } from '../db/sync';
import { Colors } from '../theme/colors';
import * as ScreenOrientation from 'expo-screen-orientation';
import PropertyDetailsScreen from './PropertyDetailsScreen';

export default function DashboardScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();

  const [dbStatus, setDbStatus] = useState<DbTestResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<PropertyStats>({
    totalProperties: 0,
    totalUnits: 0,
  });
  const [recentProperties, setRecentProperties] = useState<Property[]>([]);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);

  const runTestAndLoad = async () => {
    try {
      setLoading(true);
      const result = await initDatabaseAndTest();
      setDbStatus(result);
      await syncAll().catch(() => {});
      await loadStats();
    } catch (err) {
      console.error('[Dashboard] Error in runTestAndLoad:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const currentStats = await getPropertyStats();
      setStats(currentStats);
      const all = await getAllProperties();
      setRecentProperties(all);
      setSelectedProperty((prev) => {
        if (!prev) return null;
        return all.find((p) => p.id === prev.id) || null;
      });
    } catch (e) {
      console.error('[Dashboard] Error loading stats:', e);
    }
  };

  useEffect(() => {
    runTestAndLoad();
  }, []);

  useEffect(() => {
    if (route.params?.propertyId && recentProperties.length > 0) {
      const found = recentProperties.find((p) => p.id === route.params.propertyId);
      if (found) {
        setSelectedProperty(found);
      }
    }
  }, [route.params?.propertyId, recentProperties]);

  useEffect(() => {
    const onBackPress = () => {
      if (selectedProperty) {
        setSelectedProperty(null);
        return true;
      }
      if (navigation.canGoBack()) {
        navigation.goBack();
        return true;
      }
      return false;
    };
    const backSub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => backSub.remove();
  }, [selectedProperty, navigation]);

  useFocusEffect(
    useCallback(() => {
      // Ensure Dashboard is always portrait
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
      // Refresh stats when returning to screen
      loadStats();
      syncAll().then(() => loadStats()).catch(() => {});
    }, [])
  );

  // If a property is selected, render PropertyDetailsScreen
  if (selectedProperty) {
    return (
      <PropertyDetailsScreen
        property={selectedProperty}
        onBack={() => {
          setSelectedProperty(null);
          loadStats();
        }}
        onEditProperty={() => {
          const propId = selectedProperty.id;
          const propName = selectedProperty.building_name;
          setSelectedProperty(null);
          navigation.navigate('Add Property', {
            propertyId: propId,
            buildingName: propName,
          });
        }}
        onDeleteProperty={() => {
          setSelectedProperty(null);
          if (route.params?.propertyId) {
            navigation.setParams({ propertyId: undefined });
          }
          loadStats();
        }}
      />
    );
  }

  return (
    <View style={styles.container}>
      {/* Top Turquoise Header */}
      <View style={[styles.headerContainer, { paddingTop: Math.max(insets.top, 12) + 6 }]}>
        <View style={styles.headerTopRow}>
          <View style={styles.headerTitleArea}>
            <Text style={styles.title}>Dashboard</Text>
            <Text style={styles.subtitle}>SLS Properties</Text>
          </View>

          <TouchableOpacity
            style={styles.refreshHeaderBtn}
            onPress={runTestAndLoad}
            disabled={loading}
            activeOpacity={0.7}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <MaterialCommunityIcons name="refresh" size={20} color="#FFFFFF" />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Main Content Rounded White Container */}
      <View style={styles.whiteContentContainer}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Content begins immediately */}

          {/* Properties Section */}
          {recentProperties.length > 0 && (
            <View style={styles.recentSection}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>
                  Properties {recentProperties.length > 0 ? `(${recentProperties.length})` : ''}
                </Text>
              </View>

              {recentProperties.map((prop) => (
                <TouchableOpacity
                  key={prop.id}
                  style={styles.recentCard}
                  onPress={() => setSelectedProperty(prop)}
                  activeOpacity={0.8}
                >
                  <View style={styles.recentIconCircle}>
                    <MaterialCommunityIcons
                      name="office-building"
                      size={22}
                      color={Colors.primaryDark}
                    />
                  </View>
                  <View style={styles.recentInfo}>
                    <Text style={styles.recentName} numberOfLines={1}>
                      {prop.building_name}
                    </Text>
                    <Text style={styles.recentAddress} numberOfLines={1}>
                      {prop.building_address}
                      {prop.location ? ` • ${prop.location}` : ''}
                    </Text>
                    <View style={styles.unitsPillRow}>
                      <View style={styles.unitsBadge}>
                        <MaterialCommunityIcons name="domain" size={13} color={Colors.primaryDark} />
                        <Text style={styles.unitsBadgeText}>
                          {prop.units || 1} {prop.units === 1 ? 'Unit' : 'Units'}
                        </Text>
                      </View>
                      {prop.landlord_name ? (
                        <Text style={styles.recentLandlord} numberOfLines={1}>
                          • {prop.landlord_name}
                        </Text>
                      ) : null}
                    </View>
                  </View>

                  <MaterialCommunityIcons
                    name="chevron-right"
                    size={22}
                    color="#94A3B8"
                  />
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Quick Actions */}
          <View style={styles.quickActionRow}>
            <TouchableOpacity
              style={styles.actionBtnPrimary}
              onPress={() => navigation.navigate('Add Property')}
              activeOpacity={0.85}
            >
              <MaterialCommunityIcons name="plus-circle" size={18} color="#FFFFFF" />
              <Text style={styles.actionBtnPrimaryText}>Add New Property</Text>
            </TouchableOpacity>
          </View>


          {/* SQLite Status Card */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderLeft}>
                <MaterialCommunityIcons
                  name="database-check"
                  size={22}
                  color={dbStatus?.success ? Colors.primaryDark : Colors.danger}
                />
                <Text style={styles.cardTitle}>Local Storage (SQLite)</Text>
              </View>
              <TouchableOpacity
                style={styles.refreshButton}
                onPress={runTestAndLoad}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator size="small" color={Colors.primary} />
                ) : (
                  <MaterialCommunityIcons
                    name="refresh"
                    size={18}
                    color={Colors.primaryDark}
                  />
                )}
              </TouchableOpacity>
            </View>

            {loading ? (
              <Text style={styles.statusDescription}>
                Testing database read/write...
              </Text>
            ) : dbStatus?.success ? (
              <View>
                <View style={styles.statusPillSuccess}>
                  <MaterialCommunityIcons
                    name="check-circle"
                    size={16}
                    color="#059669"
                  />
                  <Text style={styles.statusPillTextSuccess}>
                    SQLite Connected & Active
                  </Text>
                </View>
                <Text style={styles.dbDetails}>
                  Database: <Text style={styles.boldText}>sls_properties.db</Text>
                </Text>
                <Text style={styles.dbDetails}>
                  Table: <Text style={styles.boldText}>properties</Text> ({stats.totalProperties} items stored)
                </Text>
              </View>
            ) : (
              <View style={styles.statusPillDanger}>
                <MaterialCommunityIcons
                  name="alert-circle"
                  size={16}
                  color="#DC2626"
                />
                <Text style={styles.statusPillTextDanger}>
                  Error: {dbStatus?.error || 'Database test failed'}
                </Text>
              </View>
            )}
          </View>
        </ScrollView>
      </View>
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
  headerTitleArea: {
    flex: 1,
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingTop: 16,
    paddingBottom: 40,
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
    fontWeight: '500',
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  seeAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primaryDark,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.primaryBorder,
    alignItems: 'center',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  statIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  statIconCircleAccent: {
    backgroundColor: Colors.primaryTint,
  },
  statNumber: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
    fontWeight: '600',
  },
  quickActionRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 22,
  },
  actionBtnPrimary: {
    flex: 1.2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    borderRadius: 10,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  actionBtnPrimaryText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  actionBtnSecondary: {
    flex: 0.8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.primaryTint,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.primaryBorder,
  },
  actionBtnSecondaryText: {
    color: Colors.primaryDark,
    fontWeight: '700',
    fontSize: 14,
  },
  recentSection: {
    marginBottom: 22,
  },
  recentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  recentIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: Colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  recentInfo: {
    flex: 1,
  },
  recentName: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  recentAddress: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  unitsPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  unitsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primaryTint,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  unitsBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.primaryDark,
  },
  recentLandlord: {
    fontSize: 11,
    color: Colors.textSecondary,
    flex: 1,
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 20,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  refreshButton: {
    padding: 4,
  },
  statusDescription: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  statusPillSuccess: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginBottom: 10,
  },
  statusPillTextSuccess: {
    color: '#065F46',
    fontWeight: '600',
    fontSize: 13,
  },
  statusPillDanger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  statusPillTextDanger: {
    color: '#991B1B',
    fontWeight: '600',
    fontSize: 13,
  },
  dbDetails: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  boldText: {
    fontWeight: '600',
    color: Colors.textPrimary,
  },
});
