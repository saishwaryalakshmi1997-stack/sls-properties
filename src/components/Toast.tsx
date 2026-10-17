import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Dimensions,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../theme/colors';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
  label: string;
  onPress: () => void;
}

export interface ToastOptions {
  type?: ToastType;
  title: string;
  message?: string;
  duration?: number;
  action?: ToastAction;
}

type ToastListener = (options: ToastOptions) => void;
let activeListener: ToastListener | null = null;

export const Toast = {
  show: (options: ToastOptions) => {
    if (activeListener) {
      activeListener(options);
    }
  },
  success: (title: string, message?: string, duration: number = 3000, action?: ToastAction) => {
    Toast.show({ type: 'success', title, message, duration, action });
  },
  error: (title: string, message?: string, duration: number = 3500, action?: ToastAction) => {
    Toast.show({ type: 'error', title, message, duration, action });
  },
  warning: (title: string, message?: string, duration: number = 3200, action?: ToastAction) => {
    Toast.show({ type: 'warning', title, message, duration, action });
  },
  info: (title: string, message?: string, duration: number = 3000, action?: ToastAction) => {
    Toast.show({ type: 'info', title, message, duration, action });
  },
  hide: () => {
    if (activeListener) {
      activeListener({ type: 'info', title: '', duration: 0 });
    }
  },
};

export const showToast = (
  title: string,
  message?: string,
  type: ToastType = 'info',
  duration?: number
) => {
  Toast.show({ type, title, message, duration });
};

interface ToastConfig {
  iconName: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  bgColor: string;
  borderColor: string;
}

const TOAST_THEMES: Record<ToastType, ToastConfig> = {
  success: {
    iconName: 'checkmark-circle',
    iconColor: '#059669', // Emerald 600
    bgColor: '#ECFDF5',   // Emerald 50
    borderColor: '#A7F3D0',
  },
  error: {
    iconName: 'alert-circle',
    iconColor: '#DC2626', // Red 600
    bgColor: '#FEF2F2',   // Red 50
    borderColor: '#FECACA',
  },
  warning: {
    iconName: 'warning',
    iconColor: '#D97706', // Amber 600
    bgColor: '#FFFBEB',   // Amber 50
    borderColor: '#FDE68A',
  },
  info: {
    iconName: 'information-circle',
    iconColor: Colors.primary, // Brand Burgundy Maroon
    bgColor: Colors.primaryTint, // Soft Warm Rose
    borderColor: Colors.primaryBorder,
  },
};

export const ToastContainer: React.FC = () => {
  const insets = useSafeAreaInsets();
  const [currentToast, setCurrentToast] = useState<ToastOptions | null>(null);
  const animValue = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hideToast = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    Animated.parallel([
      Animated.timing(animValue, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setCurrentToast(null);
    });
  }, [animValue]);

  useEffect(() => {
    activeListener = (options: ToastOptions) => {
      if (!options.title && options.duration === 0) {
        hideToast();
        return;
      }

      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      setCurrentToast(options);

      animValue.setValue(0);
      Animated.parallel([
        Animated.spring(animValue, {
          toValue: 1,
          tension: 70,
          friction: 9,
          useNativeDriver: true,
        }),
      ]).start();

      const duration = options.duration ?? 3200;
      if (duration > 0) {
        timerRef.current = setTimeout(() => {
          hideToast();
        }, duration);
      }
    };

    return () => {
      activeListener = null;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [animValue, hideToast]);

  if (!currentToast) {
    return null;
  }

  const type = currentToast.type || 'info';
  const theme = TOAST_THEMES[type];

  const translateY = animValue.interpolate({
    inputRange: [0, 1],
    outputRange: [30, 0],
  });

  const opacity = animValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  const scale = animValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0.92, 1],
  });

  // Calculate bottom offset to float gracefully above bottom tabs
  const bottomPosition = Math.max(insets.bottom, 12) + 72;

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.overlay,
        {
          bottom: bottomPosition,
        },
      ]}
    >
      <Animated.View
        style={[
          styles.animatedCard,
          {
            opacity,
            transform: [{ translateY }, { scale }],
          },
        ]}
      >
        <View style={styles.cardContent}>
          {/* Status Icon Badge */}
          <View
            style={[
              styles.iconCircle,
              {
                backgroundColor: theme.bgColor,
                borderColor: theme.borderColor,
              },
            ]}
          >
            <Ionicons name={theme.iconName} size={20} color={theme.iconColor} />
          </View>

          {/* Text Container */}
          <View style={styles.textContainer}>
            <Text style={styles.titleText} numberOfLines={2}>
              {currentToast.title}
            </Text>
            {!!currentToast.message && (
              <Text style={styles.messageText} numberOfLines={2}>
                {currentToast.message}
              </Text>
            )}
          </View>

          {/* Optional Action Button (e.g. "View") */}
          {!!currentToast.action && (
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => {
                const actionFn = currentToast.action?.onPress;
                hideToast();
                if (actionFn) {
                  actionFn();
                }
              }}
              style={styles.actionButton}
            >
              <Text style={styles.actionButtonText}>
                {currentToast.action.label}
              </Text>
              <Ionicons name="eye-outline" size={14} color="#FFFFFF" style={{ marginLeft: 4 }} />
            </TouchableOpacity>
          )}

          {/* Close Action */}
          <TouchableOpacity
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={hideToast}
            style={styles.closeButton}
          >
            <Ionicons name="close" size={16} color="#94A3B8" />
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
};

const screenWidth = Dimensions.get('window').width;

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 999999,
    elevation: 999999,
  },
  animatedCard: {
    width: Math.min(screenWidth - 32, 420),
    maxWidth: '92%',
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...Platform.select({
      ios: {
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.16,
        shadowRadius: 14,
      },
      android: {
        elevation: 8,
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 10,
      },
    }),
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  titleText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  messageText: {
    fontSize: 12.5,
    fontWeight: '500',
    color: '#64748B',
    marginTop: 2,
    lineHeight: 17,
  },
  actionButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
    marginLeft: 8,
    elevation: 2,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  closeButton: {
    padding: 4,
    marginLeft: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
