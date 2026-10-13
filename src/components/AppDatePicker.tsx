import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import DateTimePicker, {
  DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { Colors } from '../theme/colors';

interface AppDatePickerProps {
  visible: boolean;
  value: string; // DD-MM-YYYY
  onChange: (dateStr: string) => void;
  onClose: () => void;
  maximumDate?: Date;
  minimumDate?: Date;
}

const MONTH_MAP: { [key: string]: number } = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

export const parseDateString = (dateStr?: string): Date => {
  if (!dateStr) return new Date();
  const parts = dateStr.trim().split('-');
  if (parts.length === 3) {
    const day = parseInt(parts[0], 10);
    const mStr = parts[1].toLowerCase().slice(0, 3);
    let month = MONTH_MAP[mStr];
    if (month === undefined) {
      month = parseInt(parts[1], 10) - 1;
    }
    const year = parseInt(parts[2], 10);
    if (!isNaN(day) && month !== undefined && !isNaN(month) && !isNaN(year)) {
      const parsed = new Date(year, month, day);
      if (!isNaN(parsed.getTime())) return parsed;
    }
  }
  const fallback = new Date(dateStr);
  return isNaN(fallback.getTime()) ? new Date() : fallback;
};

export const formatDateToString = (d: Date): string => {
  const day = String(d.getDate()).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day}-${months[d.getMonth()]}-${d.getFullYear()}`;
};

export const formatDateDisplay = (dateStr?: string): string => {
  if (!dateStr) return '';
  const d = parseDateString(dateStr);
  return formatDateToString(d);
};

export default function AppDatePicker({
  visible,
  value,
  onChange,
  onClose,
  maximumDate,
  minimumDate,
}: AppDatePickerProps) {
  const [tempDate, setTempDate] = useState<Date>(() => parseDateString(value));

  useEffect(() => {
    if (visible) {
      setTempDate(parseDateString(value));
    }
  }, [visible, value]);

  if (!visible) return null;

  if (Platform.OS === 'android') {
    return (
      <DateTimePicker
        value={tempDate}
        mode="date"
        display="default"
        maximumDate={maximumDate}
        minimumDate={minimumDate}
        onValueChange={(_event: any, date?: Date) => {
          onClose();
          if (date) {
            const finalDate = maximumDate && date > maximumDate ? maximumDate : date;
            onChange(formatDateToString(finalDate));
          }
        }}
        onDismiss={onClose}
      />
    );
  }

  // iOS & Web presentation overlay (avoids nested Modal issues on iOS)
  return (
    <View style={styles.overlay}>
      <TouchableOpacity
        style={StyleSheet.absoluteFillObject}
        activeOpacity={1}
        onPress={onClose}
      />
      <View style={styles.modalCard}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.actionBtn}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Select Date</Text>
          <TouchableOpacity
            onPress={() => {
              const finalDate = maximumDate && tempDate > maximumDate ? maximumDate : tempDate;
              onChange(formatDateToString(finalDate));
              onClose();
            }}
            style={styles.actionBtn}
          >
            <Text style={styles.doneText}>Done</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.pickerContainer}>
          <DateTimePicker
            value={tempDate}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            maximumDate={maximumDate}
            minimumDate={minimumDate}
            onValueChange={(_event: any, date?: Date) => {
              if (date) {
                const finalDate = maximumDate && date > maximumDate ? maximumDate : date;
                setTempDate(finalDate);
                if (Platform.OS === 'web') {
                  onChange(formatDateToString(finalDate));
                  onClose();
                }
              }
            }}
            onDismiss={onClose}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'flex-end',
    zIndex: 99999,
    elevation: 99999,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  actionBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#64748B',
  },
  doneText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.primaryDark,
  },
  pickerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
});
