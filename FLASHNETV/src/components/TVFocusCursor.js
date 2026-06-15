import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTVFocus } from '../context/TVFocusContext';
import { isTV } from '../utils/tv';

/**
 * Cursor visual limpio para Android TV.
 *
 * Antes se usaban esquinas, doble borde, relleno fuerte y etiqueta "FOCO".
 * En pantalla real se veía demasiado recargado. Ahora dejamos un único
 * selector sobrio: borde celeste, línea interior cálida muy suave y sin texto.
 */
export default function TVFocusCursor() {
  const tvFocus = useTVFocus();
  const rect = tvFocus?.cursorRect;

  if (!isTV || !rect) return null;

  const radius = Math.min(18, Math.max(10, rect.height / 5));

  return (
    <View
      pointerEvents="none"
      style={[
        styles.cursor,
        {
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
          borderRadius: radius,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  cursor: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#32C5FF',
    backgroundColor: 'transparent',
    zIndex: 999999,
    elevation: 999999,
    shadowColor: '#32C5FF',
    shadowOpacity: 0.28,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
});
