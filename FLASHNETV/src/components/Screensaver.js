/**
 * Screensaver — Solo activo en Android TV
 * Se activa tras 5 minutos de inactividad en el Home.
 * Muestra el logo animado + "Toca para continuar".
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Animated, TouchableWithoutFeedback, Easing, TVEventHandler,
} from 'react-native';
import { isTV } from '../utils/tv';
import BrandLogo from './BrandLogo';

const IDLE_TIME = 5 * 60 * 1000; // 5 minutos

export default function Screensaver({ posters = [], onDismiss }) {
  const opacity  = useRef(new Animated.Value(0)).current;
  const posX     = useRef(new Animated.Value(0)).current;
  const posY     = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Fade in
    Animated.timing(opacity, { toValue: 1, duration: 1000, useNativeDriver: true }).start();

    // Logo flotante (bouncing DVD-style)
    const animate = () => {
      Animated.sequence([
        Animated.parallel([
          Animated.timing(posX, { toValue: 100,  duration: 8000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(posY, { toValue: 60,   duration: 6000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(posX, { toValue: -80,  duration: 7000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(posY, { toValue: -40,  duration: 9000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(posX, { toValue: 50,   duration: 9000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(posY, { toValue: 80,   duration: 7000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
      ]).start(animate);
    };
    animate();

    return () => {
      posX.stopAnimation();
      posY.stopAnimation();
    };
  }, []);

  useEffect(() => {
    if (!isTV || !TVEventHandler?.addListener) return undefined;
    const sub = TVEventHandler.addListener(() => {
      onDismiss?.();
    });
    return () => {
      try { sub?.remove?.(); } catch (_) {}
    };
  }, [onDismiss]);

  return (
    <TouchableWithoutFeedback onPress={onDismiss}>
      <Animated.View style={[styles.container, { opacity }]}>
        <Animated.View style={[styles.logoWrap, { transform: [{ translateX: posX }, { translateY: posY }] }]}>
          <BrandLogo variant="screensaver" centered />
          <Text style={styles.hint}>Presiona cualquier botón para continuar</Text>
        </Animated.View>
      </Animated.View>
    </TouchableWithoutFeedback>
  );
}

export function useScreensaver() {
  const [active, setActive] = useState(false);
  const timerRef = useRef(null);

  const resetTimer = () => {
    if (!isTV) return; // solo en TV
    clearTimeout(timerRef.current);
    if (active) setActive(false);
    timerRef.current = setTimeout(() => setActive(true), IDLE_TIME);
  };

  useEffect(() => {
    resetTimer();
    return () => clearTimeout(timerRef.current);
  }, []);

  return { screensaverActive: active, resetScreensaverTimer: resetTimer, dismissScreensaver: () => setActive(false) };
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  logoWrap: { alignItems: 'center', gap: 20 },
  hint: { color: 'rgba(255,255,255,0.3)', fontSize: 18, letterSpacing: 1 },
});
