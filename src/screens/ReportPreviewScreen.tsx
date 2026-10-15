import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  BackHandler,
  Platform,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { Toast } from '../components/Toast';
import { Colors } from '../theme/colors';
import {
  Property,
  RentReportResult,
  ConsolidatedRentReportResult,
  getPropertyById,
  getRentReportForProperty,
  getAllBuildingsRentReport,
} from '../db/database';
import { buildReportHtml, buildConsolidatedReportHtml } from '../utils/reportHtmlBuilder';

export default function ReportPreviewScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();

  const propertyId: number | undefined = route.params?.propertyId;
  const isAllBuildings: boolean = Boolean(route.params?.isAllBuildings || !propertyId);
  const year: number = route.params?.year || new Date().getFullYear();

  const [loading, setLoading] = useState(true);
  const [property, setProperty] = useState<Property | null>(null);
  const [reportData, setReportData] = useState<RentReportResult | null>(null);
  const [consolidatedData, setConsolidatedData] = useState<ConsolidatedRentReportResult | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [savedPdfUri, setSavedPdfUri] = useState<string | null>(null);

  // Force Landscape Orientation reliably on this screen
  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      const lockLandscape = async () => {
        try {
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
        } catch (e) {
          console.warn('[ReportPreview] Orientation lock error:', e);
        }
      };

      // Lock landscape immediately and reinforce after navigation transition completes
      lockLandscape();
      const timer = setTimeout(() => {
        if (isMounted) {
          lockLandscape();
        }
      }, 150);

      return () => {
        isMounted = false;
        clearTimeout(timer);
      };
    }, [])
  );

  const handleGoBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate('Rent Report');
    }
  }, [navigation]);

  // Handle hardware back button on Android
  useEffect(() => {
    const onBackPress = () => {
      handleGoBack();
      return true;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [handleGoBack]);

  // Load report data once
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      if (isAllBuildings) {
        const data = await getAllBuildingsRentReport(year);
        setConsolidatedData(data);
      } else if (propertyId) {
        const [prop, report] = await Promise.all([
          getPropertyById(propertyId),
          getRentReportForProperty(propertyId, year),
        ]);
        setProperty(prop || report.property || null);
        setReportData(report);
      } else {
        setLoading(false);
      }
    } catch (err: any) {
      console.error('[ReportPreview] Error loading report data:', err);
      Toast.error('Load Error', err?.message || 'Could not load rent report.');
    } finally {
      setLoading(false);
    }
  }, [isAllBuildings, propertyId, year]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Build the preview HTML (with sticky Name column)
  const previewHtml = useMemo(() => {
    if (isAllBuildings) {
      if (!consolidatedData || consolidatedData.buildings.length === 0) return '';
      return buildConsolidatedReportHtml(year, consolidatedData, 'preview');
    }
    if (!property || !reportData || reportData.rows.length === 0) return '';
    return buildReportHtml(property, year, reportData, 'preview');
  }, [isAllBuildings, consolidatedData, property, year, reportData]);

  // Build the PDF HTML (for printing and download, with static print positioning)
  const pdfHtml = useMemo(() => {
    if (isAllBuildings) {
      if (!consolidatedData || consolidatedData.buildings.length === 0) return '';
      return buildConsolidatedReportHtml(year, consolidatedData, 'pdf');
    }
    if (!property || !reportData || reportData.rows.length === 0) return '';
    return buildReportHtml(property, year, reportData, 'pdf');
  }, [isAllBuildings, consolidatedData, property, year, reportData]);

  // Download PDF Handler
  const handleDownloadPdf = async () => {
    const hasData = isAllBuildings
      ? consolidatedData && consolidatedData.buildings.length > 0
      : property && reportData && reportData.rows.length > 0;

    if (!hasData || !pdfHtml) {
      Toast.info('No Data', 'No report content available to download.');
      return;
    }

    try {
      setIsExporting(true);

      const printResult = await Print.printToFileAsync({
        html: pdfHtml,
        width: 842,
        height: 595,
        base64: true,
      });

      const safeProp = property
        ? (property.building_name || 'Property').trim().replace(/[^a-zA-Z0-9_-]/g, '_')
        : 'Property';
      const fileName = isAllBuildings
        ? `Rent-Report_All_Buildings_${year}.pdf`
        : `Rent-Report_${safeProp}_${year}.pdf`;
      const base64 = printResult.base64;
      let savedToDocuments = false;
      const localDocUri = `${FileSystem.documentDirectory}${fileName}`;

      // 1. Save locally to app documents directory
      try {
        if (base64 && FileSystem?.writeAsStringAsync) {
          await FileSystem.writeAsStringAsync(localDocUri, base64, {
            encoding: FileSystem.EncodingType.Base64,
          });
        } else if (FileSystem?.copyAsync) {
          await FileSystem.copyAsync({
            from: printResult.uri,
            to: localDocUri,
          });
        }
      } catch (saveLocalErr) {
        console.warn('[ReportPreview] Local document save warning:', saveLocalErr);
      }

      // 2. On Android, save directly to device Documents folder via StorageAccessFramework
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
              `Rent-Report_${safeProp}_${year}`,
              'application/pdf'
            );
            await FileSystem.writeAsStringAsync(safFileUri, base64, {
              encoding: FileSystem.EncodingType.Base64,
            });
            savedToDocuments = true;
          }
        } catch (safErr) {
          console.warn('[ReportPreview] StorageAccessFramework error/cancel:', safErr);
        }
      }

      // Store local shareable file:// URI only
      setSavedPdfUri(localDocUri);

      Toast.show({
        type: 'success',
        title: 'PDF Downloaded',
        message: savedToDocuments
          ? `Saved to Documents: ${fileName}`
          : fileName,
        duration: 4000,
      });
    } catch (err: any) {
      console.error('[ReportPreview] Export error:', err);
      Toast.error('Export Error', err?.message || 'Could not download PDF.');
    } finally {
      setIsExporting(false);
    }
  };

  // Share PDF button handler — generates and shares directly without requiring downloading first
  const handleSharePdf = async () => {
    const hasData = isAllBuildings
      ? consolidatedData && consolidatedData.buildings.length > 0
      : property && reportData && reportData.rows.length > 0;

    if (!hasData || !pdfHtml) {
      Toast.info('No Data', 'No report content available to share.');
      return;
    }

    try {
      setIsExporting(true);

      const safeProp = property
        ? (property.building_name || 'Property').trim().replace(/[^a-zA-Z0-9_-]/g, '_')
        : 'Property';
      const fileName = isAllBuildings
        ? `Rent-Report_All_Buildings_${year}.pdf`
        : `Rent-Report_${safeProp}_${year}.pdf`;

      const targetDocUri = `${FileSystem.documentDirectory}${fileName}`;

      // Check if file is already saved at targetDocUri
      const fileInfo = await FileSystem.getInfoAsync(targetDocUri).catch(() => null);

      if (!fileInfo?.exists) {
        const printResult = await Print.printToFileAsync({
          html: pdfHtml,
          width: 842,
          height: 595,
          base64: true,
        });

        if (printResult.base64 && FileSystem?.writeAsStringAsync) {
          await FileSystem.writeAsStringAsync(targetDocUri, printResult.base64, {
            encoding: FileSystem.EncodingType.Base64,
          });
        } else if (FileSystem?.copyAsync) {
          await FileSystem.copyAsync({
            from: printResult.uri,
            to: targetDocUri,
          });
        }
      }

      setSavedPdfUri(targetDocUri);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(targetDocUri, {
          mimeType: 'application/pdf',
          dialogTitle: fileName,
          UTI: 'com.adobe.pdf',
        });
      } else {
        Toast.info('Sharing Unavailable', 'Sharing is not supported on this device.');
      }
    } catch (err: any) {
      console.error('[ReportPreview] Share error:', err);
      Toast.error('Share Error', err?.message || 'Could not share PDF.');
    } finally {
      setIsExporting(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.centeredContainer, { backgroundColor: '#F8FAFC' }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingTitle}>Loading report data...</Text>
      </View>
    );
  }

  const hasData = isAllBuildings
    ? consolidatedData && consolidatedData.buildings.length > 0
    : property && reportData && reportData.rows.length > 0;

  if (!hasData) {
    return (
      <View style={[styles.centeredContainer, { backgroundColor: '#F8FAFC' }]}>
        <MaterialCommunityIcons name="file-alert-outline" size={48} color="#94A3B8" />
        <Text style={styles.emptyTitle}>
          {isAllBuildings ? 'No Properties in Report' : 'No Tenants in Report'}
        </Text>
        <Text style={styles.emptySubtitle}>
          {isAllBuildings
            ? `There are no registered properties or rent records for ${year}.`
            : `There are no occupied tenants or rent records for ${property?.building_name || 'this property'} in ${year}.`}
        </Text>
        <TouchableOpacity style={styles.emptyBackBtn} onPress={handleGoBack} activeOpacity={0.8}>
          <MaterialCommunityIcons name="arrow-left" size={18} color="#FFFFFF" />
          <Text style={styles.emptyBackBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: Math.max(insets.top, 0),
          paddingLeft: Math.max(insets.left, 0),
          paddingRight: Math.max(insets.right, 0),
          paddingBottom: Math.max(insets.bottom, 0),
        },
      ]}
    >
      {/* 1. Burgundy App Bar */}
      <View style={styles.appBar}>
        <View style={styles.appBarLeft}>
          <TouchableOpacity
            style={styles.appBarBtn}
            onPress={handleGoBack}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialCommunityIcons name="arrow-left" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.appBarTitle}>Report preview</Text>
        </View>

        <View style={styles.appBarActionsRight}>
          <TouchableOpacity
            style={[styles.shareHeaderBtn, isExporting && { opacity: 0.7 }]}
            onPress={handleSharePdf}
            disabled={isExporting}
            activeOpacity={0.8}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialCommunityIcons name="share-variant-outline" size={17} color="#FFFFFF" />
            <Text style={styles.shareHeaderBtnText}>Share</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.downloadHeaderBtn, isExporting && { opacity: 0.7 }]}
            onPress={handleDownloadPdf}
            disabled={isExporting}
            activeOpacity={0.8}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {isExporting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <MaterialCommunityIcons name="file-download-outline" size={17} color="#FFFFFF" />
                <Text style={styles.downloadHeaderBtnText}>Download PDF</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* 2. Info Strip */}
      <View style={styles.infoStrip}>
        <View style={styles.infoLeft}>
          <MaterialCommunityIcons name="office-building" size={14} color="#6B2D3A" />
          <Text style={styles.infoPropertyText}>
            {isAllBuildings
              ? `All Buildings (${consolidatedData?.buildings.length || 0} Properties) — ${year}`
              : `${property?.building_name} — ${year}`}
          </Text>
        </View>
      </View>

      {/* 3. Paper Preview Card with WebView */}
      <View style={styles.paperCard}>
        <WebView
          originWhitelist={['*']}
          source={{ html: previewHtml }}
          startInLoadingState
          renderLoading={() => (
            <View style={styles.webViewLoading}>
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={styles.loadingText}>Rendering preview...</Text>
            </View>
          )}
          style={styles.webView}
          scalesPageToFit={false}
          showsHorizontalScrollIndicator={true}
          showsVerticalScrollIndicator={true}
          javaScriptEnabled={true}
          domStorageEnabled={true}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F1F5F9', // Crisp light gray background
  },
  centeredContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingTitle: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
  },
  emptyTitle: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: '700',
    color: '#1E293B',
  },
  emptySubtitle: {
    marginTop: 6,
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    maxWidth: 380,
  },
  emptyBackBtn: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 8,
  },
  emptyBackBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  // 1. App Bar
  appBar: {
    height: 48,
    backgroundColor: '#6B2D3A', // Burgundy
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    elevation: 3,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1.5 },
    shadowOpacity: 0.15,
    shadowRadius: 2.5,
  },
  appBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  appBarBtn: {
    padding: 6,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  appBarTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  appBarActionsRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  shareHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 6,
  },
  shareHeaderBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  downloadHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.38)',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 6,
  },
  downloadHeaderBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },

  // 2. Info Strip
  infoStrip: {
    height: 28,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  infoLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  infoPropertyText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E293B',
  },

  // 3. Paper Card & WebView
  paperCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    elevation: 3,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    overflow: 'hidden',
  },
  webView: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  webViewLoading: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 8,
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
});
