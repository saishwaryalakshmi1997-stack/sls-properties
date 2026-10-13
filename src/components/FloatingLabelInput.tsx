import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  TextInput,
  Text,
  StyleSheet,
  Animated,
  TextInputProps,
  TouchableOpacity,
  StyleProp,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { Colors } from '../theme/colors';

export interface FloatingLabelInputProps extends Omit<TextInputProps, 'placeholder'> {
  label: string; // The placeholder that floats to top
  value?: string;
  onChangeText?: (text: string) => void;
  error?: string;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  rightIcon?: React.ReactNode;
  onRightIconPress?: () => void;
  prefix?: string;
  bgColor?: string;
  required?: boolean;
}

export default function FloatingLabelInput({
  label,
  value = '',
  onChangeText,
  error,
  containerStyle,
  inputStyle,
  rightIcon,
  onRightIconPress,
  prefix,
  bgColor = '#FFFFFF',
  required = false,
  onFocus,
  onBlur,
  style,
  multiline,
  numberOfLines,
  ...rest
}: FloatingLabelInputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const hasValue = value !== undefined && value !== null && value.toString().length > 0;
  const isFloating = isFocused || hasValue;

  const animatedValue = useRef(new Animated.Value(hasValue ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(animatedValue, {
      toValue: isFloating ? 1 : 0,
      duration: 150,
      useNativeDriver: false,
    }).start();
  }, [isFloating]);

  const labelTop = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [multiline ? 12 : 14, -9],
  });

  const labelFontSize = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [14, 11],
  });

  const labelColor = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [
      '#94A3B8',
      error ? Colors.danger : isFocused ? Colors.primary : '#64748B',
    ],
  });

  const handleFocus = (e: any) => {
    setIsFocused(true);
    if (onFocus) onFocus(e);
  };

  const handleBlur = (e: any) => {
    setIsFocused(false);
    if (onBlur) onBlur(e);
  };

  const isMultiline = Boolean(multiline);

  return (
    <View style={[styles.wrapper, containerStyle]}>
      <TouchableOpacity
        activeOpacity={1}
        onPress={() => inputRef.current?.focus()}
        style={[
          styles.container,
          isMultiline && styles.containerMultiline,
          {
            borderColor: error
              ? Colors.danger
              : isFocused
              ? Colors.primary
              : '#CBD5E1',
            borderWidth: isFocused ? 1.5 : 1,
            backgroundColor: bgColor,
          },
        ]}
      >
        {/* Floating Label with cutout background */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.labelContainer,
            {
              top: labelTop,
              backgroundColor: bgColor,
            },
          ]}
        >
          <Animated.Text
            style={[
              styles.labelText,
              {
                fontSize: labelFontSize,
                color: labelColor,
                fontWeight: isFloating ? '600' : '400',
              },
            ]}
            numberOfLines={1}
          >
            {label}
            {required ? '*' : ''}
          </Animated.Text>
        </Animated.View>

        {/* Input Content Row */}
        <View style={[styles.inputRow, isMultiline && styles.inputRowMultiline]}>
          {prefix && isFloating ? (
            <Text style={styles.prefixText}>{prefix}</Text>
          ) : null}

          <TextInput
            ref={inputRef}
            style={[
              styles.input,
              isMultiline && styles.inputMultiline,
              inputStyle,
              style,
            ]}
            value={value}
            onChangeText={onChangeText}
            onFocus={handleFocus}
            onBlur={handleBlur}
            multiline={multiline}
            numberOfLines={numberOfLines}
            placeholderTextColor="transparent"
            {...rest}
          />

          {rightIcon && (
            <TouchableOpacity
              onPress={onRightIconPress}
              disabled={!onRightIconPress}
              style={styles.rightIconWrap}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {rightIcon}
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 16,
  },
  container: {
    height: 50,
    borderRadius: 8,
    justifyContent: 'center',
    position: 'relative',
  },
  containerMultiline: {
    height: 84,
    justifyContent: 'flex-start',
  },
  labelContainer: {
    position: 'absolute',
    left: 10,
    paddingHorizontal: 4,
    zIndex: 10,
  },
  labelText: {
    letterSpacing: 0.1,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    flex: 1,
  },
  inputRowMultiline: {
    alignItems: 'flex-start',
    paddingTop: 10,
  },
  prefixText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginRight: 4,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: Colors.textPrimary,
    paddingVertical: 0,
    height: '100%',
  },
  inputMultiline: {
    textAlignVertical: 'top',
    height: 64,
  },
  rightIconWrap: {
    marginLeft: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 11,
    color: Colors.danger,
    marginTop: 4,
    marginLeft: 4,
    fontWeight: '600',
  },
});
