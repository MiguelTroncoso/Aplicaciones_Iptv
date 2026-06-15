import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import FocusableButton from './FocusableButton';
import BrandLogo from './BrandLogo';
import { colors } from '../theme';
import { isTV, layout } from '../utils/tv';

const NAV_ITEMS = [
  { route: 'Home', label: 'Inicio', icon: 'IN' },
  { route: 'LiveTV', label: 'TV en vivo', icon: 'TV' },
  { route: 'Movies', label: 'Peliculas', icon: 'PE' },
  { route: 'Series', label: 'Series', icon: 'SE' },
  { route: 'Search', label: 'Buscar', icon: 'BU' },
];

export default function TVTopNav({ navigation, current = 'Home' }) {
  if (!isTV) return null;

  const go = (route) => {
    if (!navigation || route === current) return;
    navigation.navigate(route);
  };

  return (
    <View style={styles.wrapper}>
      <View style={styles.brandBox}>
        <BrandLogo variant="nav" />
      </View>
      <View style={styles.nav}>
        {NAV_ITEMS.map((item, index) => {
          const active = item.route === current;
          return (
            <FocusableButton
              key={item.route}
              hasTVPreferredFocus={index === 0 && current === 'Home'}
              style={[styles.navBtn, active && styles.navBtnActive]}
              focusedStyle={styles.navBtnFocused}
              onPress={() => go(item.route)}
            >
              <Text style={[styles.navIcon, active && styles.navIconActive]}>{item.icon}</Text>
              <Text style={[styles.navText, active && styles.navTextActive]} numberOfLines={1}>{item.label}</Text>
            </FocusableButton>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: layout.horizontalPadding,
    paddingTop: isTV ? 8 : 10,
    paddingBottom: isTV ? 6 : 8,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(31,125,255,0.26)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: isTV ? 10 : 14,
  },
  brandBox: { minWidth: isTV ? 170 : 190 },
  nav: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  navBtn: {
    minHeight: isTV ? 38 : 48,
    paddingHorizontal: isTV ? 9 : 12,
    borderRadius: 8,
    backgroundColor: colors.surfaceElevated || colors.card,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: isTV ? 6 : 8,
    flex: 1,
  },
  navBtnActive: {
    backgroundColor: 'rgba(31,125,255,0.18)',
    borderColor: 'rgba(31,125,255,0.80)',
  },
  navBtnFocused: {
    borderColor: '#FFFFFF',
    backgroundColor: 'rgba(31,125,255,0.30)',
  },
  navIcon: { color: colors.accent, fontSize: isTV ? 10 : 12, fontWeight: '900' },
  navIconActive: { color: colors.white },
  navText: { color: colors.textSecondary, fontSize: isTV ? 12 : 14, fontWeight: '900' },
  navTextActive: { color: colors.white },
});
