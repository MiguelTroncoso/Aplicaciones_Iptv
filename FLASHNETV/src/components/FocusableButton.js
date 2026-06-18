import React, { useRef, useState } from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { isTV } from '../utils/tv';

/**
 * FocusableButton
 *
 * En Android TV / Fire TV dejamos que react-native-tvos maneje el D-pad de forma
 * nativa. El foco evita transform/sombras pesadas para responder rapido en TV Box.
 */
export default function FocusableButton({
  children,
  style,
  focusedStyle,
  onPress,
  activeOpacity = 0.85,
  hasTVPreferredFocus = false,
  // Props legacy aceptadas para no romper llamadas existentes:
  showFocusLabel, // eslint-disable-line no-unused-vars
  focusLabel,     // eslint-disable-line no-unused-vars
  focusId,        // eslint-disable-line no-unused-vars
  disabled = false,
  ...props
}) {
  const [focused, setFocused] = useState(false);
  const ref = useRef(null);
  const visuallyFocused = focused;

  const handlePress = (...args) => {
    if (disabled) return;
    onPress?.(...args);
  };

  return (
    <TouchableOpacity
      {...props}
      ref={ref}
      focusable={!disabled}
      isTVSelectable={!disabled}
      tvParallaxProperties={{ enabled: false }}
      hasTVPreferredFocus={hasTVPreferredFocus}
      activeOpacity={activeOpacity}
      collapsable={false}
      disabled={disabled}
      onFocus={(event) => {
        setFocused(true);
        props.onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        props.onBlur?.(event);
      }}
      onPress={handlePress}
      style={[
        styles.base,
        style,
        visuallyFocused && (isTV ? styles.tvFocused : styles.focusedBase),
        visuallyFocused && focusedStyle,
      ]}
    >
      {children}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    position: 'relative',
    overflow: 'visible',
  },
  focusedBase: {
    borderColor: '#32C5FF',
    backgroundColor: 'rgba(50, 197, 255, 0.08)',
  },
  tvFocused: {
    borderColor: '#38BDF8',
    backgroundColor: 'rgba(31, 125, 255, 0.18)',
    zIndex: 10,
  },
});
