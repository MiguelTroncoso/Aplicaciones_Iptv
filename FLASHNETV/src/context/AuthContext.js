import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { login as xtreamLogin, checkSessionValid } from '../services/xtream';
import logger from '../utils/logger';

const AuthContext = createContext();

export const BASE_SERVER_URL = 'http://superflash.ovh:80';

const SESSION_KEY  = 'flashnetv_session_v1';
const CREDS_KEY    = 'flashnetv_credentials';
const CREDS_BACKUP = 'flashnetv_creds_backup'; // fallback si SecureStore falla

const utf8ToBase64 = (value = '') => {
  const utf8 = encodeURIComponent(String(value || '')).replace(/%([0-9A-F]{2})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  if (typeof btoa === 'function') return btoa(utf8);
  return utf8;
};

const base64ToUtf8 = (value = '') => {
  if (!value) return '';
  const decoded = typeof atob === 'function' ? atob(value) : value;
  try {
    return decodeURIComponent(Array.from(decoded).map(ch =>
      `%${ch.charCodeAt(0).toString(16).padStart(2, '0')}`
    ).join(''));
  } catch (_) {
    return value;
  }
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [server, setServer] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadStoredSession(); }, []);

  const loadStoredSession = async () => {
    try {
      const stored = await AsyncStorage.getItem(SESSION_KEY);
      if (stored) {
        const session = JSON.parse(stored);
        let password = '';

        // 1. Intentar SecureStore (más seguro)
        try {
          const securePromise  = SecureStore.getItemAsync(CREDS_KEY);
          const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(''), 3000));
          password = await Promise.race([securePromise, timeoutPromise]) || '';
        } catch (_) {}

        // 2. Si SecureStore devuelve vacío, usar fallback de AsyncStorage
        if (!password) {
          try {
            const raw = await AsyncStorage.getItem(CREDS_BACKUP);
            if (raw) {
              try {
                password = base64ToUtf8(raw);
              } catch (_) {
                password = raw; // guardado plano
              }
            }
          } catch (_) {}
        }

        setUser({ ...session.user, password });
        setServer({ ...(session.server || {}), url: BASE_SERVER_URL });
        return;
      }

    } catch (e) {
      logger.log('Error cargando sesión guardada:', e?.message || e);
    } finally {
      setLoading(false);
    }
  };

  const _persistSession = async (userInfo, serverInfo, password) => {
    // Guardar sesión sin password sensible en AsyncStorage
    const sessionData = {
      user: { ...userInfo, password: undefined },
      server: serverInfo,
    };
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));

    // Intentar guardar en SecureStore (más seguro)
    let secureOk = false;
    try {
      await SecureStore.setItemAsync(CREDS_KEY, password || '');
      secureOk = true;
    } catch (e) {
      logger.log('SecureStore no disponible, usando fallback AsyncStorage:', e);
    }

    // Fallback: siempre guardar en AsyncStorage también (ofuscado básico)
    // Nota: menos seguro que SecureStore, pero garantiza que el login funcione
    if (true) { // siempre doble guarda por si acaso: compatibilidad entre dispositivos
      try {
        await AsyncStorage.setItem(CREDS_BACKUP, utf8ToBase64(password || ''));
      } catch (_) {
        // base64 puede no estar disponible — guardar plano como último recurso
        try { await AsyncStorage.setItem(CREDS_BACKUP, password || ''); } catch (__) {}
      }
    }
  };

  const signIn = async (usernameOrServer, passwordOrUsername, maybePassword) => {
    const username = maybePassword === undefined ? usernameOrServer : passwordOrUsername;
    const password = maybePassword === undefined ? passwordOrUsername : maybePassword;
    const serverUrl = BASE_SERVER_URL;
    const result = await xtreamLogin(serverUrl, username, password);
    if (result.success) {
      const userInfo = { ...result.userInfo, username, password };
      const serverInfo = { url: serverUrl, info: result.serverInfo };
      await _persistSession(userInfo, serverInfo, password);
      setUser(userInfo);
      setServer(serverInfo);
    }
    return result;
  };

  // ─── Verificar sesión periódicamente ─────────────────────────────────────
  const checkSession = async () => {
    if (!user || !server) return;
    const result = await checkSessionValid(server.url, user.username, user.password);
    if (result.expired) {
      const msg = result.expiredAt
        ? `Tu suscripción venció el ${result.expiredAt.toLocaleDateString('es-ES')}.`
        : 'Tu sesión ha expirado. Vuelve a iniciar sesión.';
      await signOut();
      // El Alert se maneja en el componente que consume AuthContext
      return { expired: true, message: msg };
    }
    return { expired: false };
  };

  const signOut = async () => {
    await AsyncStorage.removeItem(SESSION_KEY);
    await AsyncStorage.removeItem(CREDS_BACKUP);       // limpia backup de password
    try { await SecureStore.deleteItemAsync(CREDS_KEY); } catch (_) {}
    setUser(null);
    setServer(null);
  };

  return (
    <AuthContext.Provider value={{ user, server, loading, signIn, signOut, checkSession }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
