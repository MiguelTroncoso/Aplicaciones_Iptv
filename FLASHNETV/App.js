import React, { useRef, useEffect, useState } from 'react';
import { ActivityIndicator, View, BackHandler, Alert, Text, Platform } from 'react-native';
import { NavigationContainer, CommonActions, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { LibraryProvider } from './src/context/LibraryContext';
import { DownloadsProvider } from './src/context/DownloadsContext';

import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import LiveTVScreen from './src/screens/LiveTVScreen';
import MoviesScreen from './src/screens/MoviesScreen';
import SeriesScreen from './src/screens/SeriesScreen';
import SearchScreen from './src/screens/SearchScreen';
import SeriesDetailScreen from './src/screens/SeriesDetailScreen';
import PlayerScreen from './src/screens/PlayerScreen';
import FavoritesScreen from './src/screens/FavoritesScreen';
import WatchlistScreen from './src/screens/WatchlistScreen';
import ContinueWatchingScreen from './src/screens/ContinueWatchingScreen';
import DownloadsScreen from './src/screens/DownloadsScreen';
import MovieDetailScreen from './src/screens/MovieDetailScreen';
import EventsScreen from './src/screens/EventsScreen';
import EPGScreen from './src/screens/EPGScreen';
import StatsScreen from './src/screens/StatsScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import { colors } from './src/theme';
import DownloadStatusSheet from './src/components/DownloadStatusSheet';
import FocusableButton from './src/components/FocusableButton';
import { TVFocusProvider } from './src/context/TVFocusContext';
import { isTV } from './src/utils/tv';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const TabIcon = ({ label, focused }) => (
  <View style={{ alignItems: 'center', justifyContent: 'center' }}>
    <Text style={{ fontSize: isTV ? 18 : 14, fontWeight: '900', color: focused ? '#FFFFFF' : '#8EA0C0' }}>
      {label}
    </Text>
  </View>
);

const IPTVTabButton = ({ children, onPress, accessibilityState, style }) => {
  const selected = accessibilityState?.selected;
  return (
    <FocusableButton
      onPress={onPress}
      style={[
        style,
        {
          marginHorizontal: isTV ? 8 : 2,
          marginVertical: isTV ? 7 : 3,
          borderRadius: isTV ? 12 : 8,
          borderWidth: isTV ? 2 : 1,
          borderColor: selected ? '#1F7DFF' : 'transparent',
          backgroundColor: selected ? 'rgba(31,125,255,0.18)' : 'transparent',
          overflow: 'visible',
        },
      ]}
      focusedStyle={{
        borderColor: '#FFFFFF',
        backgroundColor: 'rgba(31,125,255,0.32)',
      }}
    >
      {children}
    </FocusableButton>
  );
};

const createTabOptions = (label, iconLabel) => ({
  tabBarLabel: label,
  tabBarIcon: ({ focused }) => <TabIcon label={iconLabel} focused={focused} />,
  tabBarButton: (props) => <IPTVTabButton {...props} />,
});

function MainTabs() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const safeBottom = Math.max(insets.bottom || 0, Platform.OS === 'android' && !isTV ? 42 : 0);
  const tabBarHeight = (isTV ? 96 : 84) + safeBottom;

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: isTV ? { display: 'none' } : {
          backgroundColor: theme.tabBar,
          borderTopColor: 'rgba(31,125,255,0.22)',
          borderTopWidth: 1,
          height: tabBarHeight,
          paddingBottom: safeBottom + 14,
          paddingTop: 9,
          overflow: 'visible',
        },
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarLabelStyle: { fontSize: isTV ? 16 : 11, fontWeight: '800', letterSpacing: 0, marginTop: 2 },
        tabBarItemStyle: { paddingVertical: isTV ? 5 : 3, overflow: 'visible' },
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={createTabOptions('Inicio', 'IN')} />
      <Tab.Screen name="LiveTV" component={LiveTVScreen} options={createTabOptions('TV en vivo', 'TV')} />
      <Tab.Screen name="Movies" component={MoviesScreen} options={createTabOptions('Peliculas', 'PE')} />
      <Tab.Screen name="Series" component={SeriesScreen} options={createTabOptions('Series', 'SE')} />
      <Tab.Screen name="Search" component={SearchScreen} options={createTabOptions('Buscar', 'BU')} />
    </Tab.Navigator>
  );
}

function LoadingScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator color={colors.accent} size="large" />
    </View>
  );
}

const PLAYER_SCREENS = new Set(['Player']);
const EXIT_SCREENS = new Set(['Login']);
const TAB_ROOT_SCREENS = new Set(['Home', 'LiveTV', 'Movies', 'Series', 'Search', 'MainTabs']);

function AppNavigator() {
  const { theme: appTheme } = useTheme();
  const navTheme = {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      background: appTheme.background,
      card: appTheme.tabBar,
      text: appTheme.white,
      border: appTheme.border || '#1D2740',
      notification: appTheme.accent,
    },
  };
  const { user, loading: authLoading } = useAuth();
  const navigationRef = useRef(null);
  const isReadyRef = useRef(false);
  const [currentRouteName, setCurrentRouteName] = useState(null);

  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!isReadyRef.current || !navigationRef.current) return false;

      const route = navigationRef.current.getCurrentRoute();
      const name = route?.name;

      if (PLAYER_SCREENS.has(name)) return false;
      if (EXIT_SCREENS.has(name)) return false;

      if (TAB_ROOT_SCREENS.has(name)) {
        Alert.alert(
          'Salir de FLASHNETV',
          'Quieres cerrar la aplicacion?',
          [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Salir', style: 'destructive', onPress: () => BackHandler.exitApp() },
          ],
          { cancelable: true }
        );
        return true;
      }

      try {
        if (navigationRef.current.canGoBack?.()) {
          navigationRef.current.goBack();
          return true;
        }
      } catch (_) {}

      try {
        navigationRef.current.dispatch(
          CommonActions.reset({ index: 0, routes: [{ name: 'MainTabs' }] })
        );
      } catch (_) {
        try { navigationRef.current.navigate('MainTabs'); } catch (__) {}
      }
      return true;
    });

    return () => handler.remove();
  }, []);

  if (authLoading) return <LoadingScreen />;

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navTheme}
      onReady={() => {
        isReadyRef.current = true;
        setCurrentRouteName(navigationRef.current?.getCurrentRoute?.()?.name || null);
      }}
      onStateChange={() => {
        setCurrentRouteName(navigationRef.current?.getCurrentRoute?.()?.name || null);
      }}
    >
      <View style={{ flex: 1 }}>
        <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
          {!user ? (
            <Stack.Screen name="Login" component={LoginScreen} />
          ) : (
            <>
              <Stack.Screen name="MainTabs" component={MainTabs} options={{ animation: 'none' }} />
              <Stack.Screen name="SeriesDetail" component={SeriesDetailScreen} />
              <Stack.Screen
                name="Player"
                component={PlayerScreen}
                options={{ animation: 'none', gestureEnabled: false }}
              />
              <Stack.Screen name="Favorites" component={FavoritesScreen} />
              <Stack.Screen name="Watchlist" component={WatchlistScreen} />
              <Stack.Screen name="ContinueWatching" component={ContinueWatchingScreen} />
              <Stack.Screen name="Downloads" component={DownloadsScreen} />
              <Stack.Screen name="MovieDetail" component={MovieDetailScreen} />
              <Stack.Screen name="Events" component={EventsScreen} />
              <Stack.Screen name="Search" component={SearchScreen} />
              <Stack.Screen name="EPG" component={EPGScreen} />
              <Stack.Screen name="Stats" component={StatsScreen} />
              <Stack.Screen name="History" component={HistoryScreen} />
            </>
          )}
        </Stack.Navigator>
        <DownloadStatusSheet navigationRef={navigationRef} currentRouteName={currentRouteName} />
      </View>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <SafeAreaProvider>
        <AuthProvider>
          <LibraryProvider>
            <DownloadsProvider>
              <TVFocusProvider>
                <AppNavigator />
              </TVFocusProvider>
            </DownloadsProvider>
          </LibraryProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}
