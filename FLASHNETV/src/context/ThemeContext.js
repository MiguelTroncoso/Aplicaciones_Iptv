import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const THEME_KEY = 'flashnetv_theme';

export const THEMES = {
  dark: {
    name: 'Oscuro',
    icon: 'N',
    background: '#05070B',
    backgroundDeep: '#081326',
    card: '#101620',
    primary: '#1F7DFF',
    primaryLight: '#4DA3FF',
    accent: '#38BDF8',
    accentWarm: '#FFFFFF',
    success: '#22C55E',
    danger: '#EF4444',
    surface: '#0A0F17',
    surfaceElevated: '#141C28',
    white: '#FFFFFF',
    textSecondary: '#9FB1CC',
    black: '#05070B',
    tabBar: '#08101A',
    border: '#22304A',
    inputBg: '#0A0F17',
  },
  amoled: {
    name: 'AMOLED',
    icon: 'A',
    background: '#000000',
    backgroundDeep: '#000000',
    card: '#070A0F',
    primary: '#1F7DFF',
    primaryLight: '#4DA3FF',
    accent: '#38BDF8',
    accentWarm: '#FFFFFF',
    success: '#22C55E',
    danger: '#EF4444',
    surface: '#000000',
    surfaceElevated: '#090D14',
    white: '#FFFFFF',
    textSecondary: '#94A3B8',
    black: '#000000',
    tabBar: '#000000',
    border: '#172033',
    inputBg: '#05080D',
  },
  light: {
    name: 'Claro',
    icon: 'C',
    background: '#F4F7FB',
    backgroundDeep: '#EAF1FC',
    card: '#FFFFFF',
    primary: '#1F7DFF',
    primaryLight: '#4DA3FF',
    accent: '#0369A1',
    accentWarm: '#0F172A',
    success: '#15803D',
    danger: '#DC2626',
    surface: '#FFFFFF',
    surfaceElevated: '#EEF4FC',
    white: '#0F172A',
    textSecondary: '#475569',
    black: '#F4F7FB',
    tabBar: '#FFFFFF',
    border: '#D7E1F0',
    inputBg: '#EEF4FC',
  },
};

const ThemeContext = createContext({ theme: THEMES.dark, themeName: 'dark', setTheme: () => {} });

export const ThemeProvider = ({ children }) => {
  const [themeName, setThemeName] = useState('dark');

  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY).then(saved => {
      if (saved && THEMES[saved]) setThemeName(saved);
    }).catch(() => {});
  }, []);

  const setTheme = async (name) => {
    setThemeName(name);
    await AsyncStorage.setItem(THEME_KEY, name).catch(() => {});
  };

  return (
    <ThemeContext.Provider value={{ theme: THEMES[themeName], themeName, setTheme, THEMES }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
export const colors = THEMES.dark;
