/**
 * notifications.js — Notificaciones locales de nuevos estrenos
 *
 * Importante:
 * - En Expo Go, expo-notifications muestra un warning rojo para push/remotas desde SDK 53+.
 * - Por eso NO importamos expo-notifications de forma estática.
 * - En Expo Go todas las funciones quedan en modo no-op seguro.
 * - En APK preview/producción sí se carga expo-notifications y funcionan las locales.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import logger from '../utils/logger';

const NOTIF_KEY = 'flashnetv_last_content_snapshot';
const PERM_KEY = 'flashnetv_notif_enabled';

const isExpoGo = Constants?.appOwnership === 'expo';
let notificationModule = null;
let notificationHandlerConfigured = false;

const getNotifications = () => {
  if (isExpoGo) return null;
  if (notificationModule) return notificationModule;
  try {
    // Lazy require: evita el warning de Expo Go al cargar la app.
    // eslint-disable-next-line global-require
    notificationModule = require('expo-notifications');
    if (!notificationHandlerConfigured && notificationModule?.setNotificationHandler) {
      notificationModule.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
        }),
      });
      notificationHandlerConfigured = true;
    }
    return notificationModule;
  } catch (error) {
    logger.log('expo-notifications no disponible:', error?.message || error);
    return null;
  }
};

// ─── Permisos ─────────────────────────────────────────────────────────────────

export const requestPermissions = async () => {
  const Notifications = getNotifications();
  if (!Notifications) return false;
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === 'granted') return true;
    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  } catch (error) {
    logger.log('requestPermissions notification error:', error?.message || error);
    return false;
  }
};

export const areNotificationsEnabled = async () => {
  try {
    if (isExpoGo) return false;
    const stored = await AsyncStorage.getItem(PERM_KEY);
    return stored === 'true';
  } catch (error) {
    logger.log('areNotificationsEnabled error:', error?.message || error);
    return false;
  }
};

export const setNotificationsEnabled = async (enabled) => {
  const finalValue = enabled && !isExpoGo;
  await AsyncStorage.setItem(PERM_KEY, finalValue ? 'true' : 'false');
  if (finalValue) await requestPermissions();
  return finalValue;
};

// ─── Notificación inmediata ───────────────────────────────────────────────────

export const sendLocalNotification = async (title, body, data = {}) => {
  const Notifications = getNotifications();
  if (!Notifications) return;
  try {
    const enabled = await areNotificationsEnabled();
    if (!enabled) return;
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data, sound: false },
      trigger: null,
    });
  } catch (error) {
    logger.log('Notification error:', error?.message || error);
  }
};

// ─── Detección de nuevo contenido ────────────────────────────────────────────

export const checkForNewContent = async (movies = [], series = []) => {
  try {
    const enabled = await areNotificationsEnabled();
    if (!enabled) return;

    const raw = await AsyncStorage.getItem(NOTIF_KEY);
    const snapshot = raw ? JSON.parse(raw) : null;

    const currentMovieIds = new Set(movies.map(m => m.stream_id || m.num).filter(Boolean));
    const currentSeriesIds = new Set(series.map(s => s.series_id || s.num).filter(Boolean));

    if (snapshot) {
      const prevMovieIds = new Set(snapshot.movieIds || []);
      const prevSeriesIds = new Set(snapshot.seriesIds || []);

      const newMovies = [...currentMovieIds].filter(id => !prevMovieIds.has(id));
      const newSeries = [...currentSeriesIds].filter(id => !prevSeriesIds.has(id));
      const totalNew = newMovies.length + newSeries.length;

      if (totalNew > 0) {
        const parts = [];
        if (newMovies.length > 0) parts.push(`${newMovies.length} película${newMovies.length > 1 ? 's' : ''}`);
        if (newSeries.length > 0) parts.push(`${newSeries.length} serie${newSeries.length > 1 ? 's' : ''}`);
        await sendLocalNotification(
          'Nuevo contenido en FLASHNETV',
          `Se agregaron ${parts.join(' y ')} nuevas. ¡Entra a verlas!`
        );
      }
    }

    await AsyncStorage.setItem(NOTIF_KEY, JSON.stringify({
      movieIds: [...currentMovieIds],
      seriesIds: [...currentSeriesIds],
      checkedAt: new Date().toISOString(),
    }));
  } catch (error) {
    logger.log('checkForNewContent error:', error?.message || error);
  }
};

export const notifyDownloadComplete = async (name) => {
  await sendLocalNotification(
    '✅ Descarga lista',
    `"${name}" está disponible para ver sin conexión.`
  );
};

export const cancelAllNotifications = async () => {
  const Notifications = getNotifications();
  if (!Notifications) return;
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (error) {
    logger.log('cancelAllNotifications error:', error?.message || error);
  }
};

export const notificationsAvailable = () => !isExpoGo && !!getNotifications();
