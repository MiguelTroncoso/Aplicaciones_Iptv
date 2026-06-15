import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { useAuth } from './AuthContext';
import { getStreamUrl } from '../services/xtream';
import logger from '../utils/logger';

const DownloadsContext = createContext();

const STORAGE_PREFIX = 'flashnetv_private_downloads_v1';
const MIN_VALID_BYTES = 50 * 1024;

const getVaultDir = () => `${FileSystem.documentDirectory}.flashnetv_vault/`;
const safeValue = (value = '') => String(value).replace(/[^a-zA-Z0-9_-]/g, '_');

const normalizeType = (type) => {
  if (type === 'series') return 'series';
  if (type === 'movie') return 'movie';
  return type;
};

const getRaw = (item = {}) => item.raw || item;

const getItemKey = (item, type = 'movie') => {
  const raw = getRaw(item);
  const id = raw.stream_id || raw.series_id || raw.id || raw.name || raw.title || Date.now();
  return `${normalizeType(type)}-${id}`;
};

const getPoster = (item = {}) => {
  const raw = getRaw(item);
  return raw.stream_icon || raw.cover || raw.info?.movie_image || raw.movie_image || null;
};

const getName = (item = {}) => {
  const raw = getRaw(item);
  return raw.name || raw.title || 'Contenido descargado';
};

const getExtension = (item = {}, type = 'movie') => {
  const raw = getRaw(item);
  if (type === 'live') return 'ts';
  const ext = raw.container_extension || raw.info?.container_extension || raw.extension || 'mp4';
  const cleaned = String(ext).replace('.', '').trim().toLowerCase();
  if (cleaned === 'm3u8' || cleaned === 'hls') return 'mp4';
  return cleaned || 'mp4';
};

const createJobFromItem = (item, type, overrides = {}) => {
  const raw = getRaw(item);
  return {
    key: getItemKey(raw, type),
    type: normalizeType(type),
    name: getName(raw),
    poster: getPoster(raw),
    progress: 0,
    written: 0,
    total: 0,
    status: 'queued',
    error: null,
    startedAt: new Date().toISOString(),
    raw,
    ...overrides,
  };
};

const formatDownloadError = (error) => String(error?.message || error || 'Error desconocido');

const validateDownloadedFile = async (uri, expectedBytes = 0) => {
  if (!uri) throw new Error('El servidor no devolvió un archivo.');
  const info = await FileSystem.getInfoAsync(uri, { size: true });
  if (!info.exists) throw new Error('El archivo no existe en el dispositivo.');
  const expected = Number(expectedBytes || 0);
  if (expected > MIN_VALID_BYTES && (info.size || 0) < expected * 0.98) {
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    throw new Error('Descarga incompleta. Reintenta la descarga.');
  }
  if ((info.size || 0) < MIN_VALID_BYTES) {
    try {
      const head = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.UTF8,
        length: 200,
        position: 0,
      });
      if (head.trim().startsWith('<') || head.toLowerCase().includes('<!doctype')) {
        await FileSystem.deleteAsync(uri, { idempotent: true });
        throw new Error('El servidor devolvió HTML. No permite descarga directa para este contenido.');
      }
    } catch (readErr) {
      if (String(readErr?.message || '').includes('HTML')) throw readErr;
    }
    await FileSystem.deleteAsync(uri, { idempotent: true });
    throw new Error('Archivo demasiado pequeño. El servidor puede no permitir descarga directa.');
  }
  return info;
};

const checkUrlAccessible = async (url) => {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        Accept: '*/*',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    });
    if (res.status === 401) throw new Error('Sesión expirada. Vuelve a iniciar sesión.');
    if (res.status === 403) throw new Error('El servidor no permite descarga directa de este contenido.');
    if (res.status === 404) throw new Error('El contenido no fue encontrado en el servidor.');
    if (!res.ok) throw new Error(`El servidor respondió con error ${res.status}.`);
    return true;
  } catch (e) {
    if (String(e?.message || '').includes('Network request failed')) return true;
    throw e;
  }
};

export const DownloadsProvider = ({ children }) => {
  const { user, server } = useAuth();
  const [downloads, setDownloads] = useState([]);
  const [progressMap, setProgressMap] = useState({});
  const [activeDownloads, setActiveDownloads] = useState({});
  const [loading, setLoading] = useState(true);
  const [autoCleanDays, setAutoCleanDaysState] = useState(0);

  const downloadsRef = useRef(downloads);
  const activeDownloadsRef = useRef(activeDownloads);
  const activeTasksRef = useRef({});
  const canceledRef = useRef({});
  const pauseRequestedRef = useRef({});
  const resumePromisesRef = useRef({});

  useEffect(() => { downloadsRef.current = downloads; }, [downloads]);
  useEffect(() => { activeDownloadsRef.current = activeDownloads; }, [activeDownloads]);

  const storageKey = useMemo(() => {
    const username = safeValue(user?.username || 'guest');
    return `${STORAGE_PREFIX}_${username}`;
  }, [user?.username]);

  const autoCleanStorageKey = useMemo(() => `${storageKey}_auto_clean_days`, [storageKey]);

  const updateJob = (key, patch) => {
    const current = activeDownloadsRef.current[key];
    if (!current && patch === null) return;
    const next = { ...activeDownloadsRef.current };
    if (patch === null) {
      delete next[key];
    } else {
      next[key] = { ...(current || {}), ...patch };
    }
    activeDownloadsRef.current = next;
    setActiveDownloads(next);
  };

  const ensureVault = async () => {
    const info = await FileSystem.getInfoAsync(getVaultDir());
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(getVaultDir(), { intermediates: true });
    }
  };

  const saveDownloads = async (items) => {
    setDownloads(items);
    downloadsRef.current = items;
    await AsyncStorage.setItem(storageKey, JSON.stringify(items));
  };

  const loadDownloads = async () => {
    try {
      setLoading(true);
      const stored = await AsyncStorage.getItem(storageKey);
      const parsed = stored ? JSON.parse(stored) : [];
      const valid = [];
      for (const item of parsed) {
        if (!item?.fileUri) continue;
        const fileInfo = await FileSystem.getInfoAsync(item.fileUri);
        if (fileInfo.exists) valid.push(item);
      }
      setDownloads(valid);
      downloadsRef.current = valid;
      if (valid.length !== parsed.length) await AsyncStorage.setItem(storageKey, JSON.stringify(valid));
    } catch (e) {
      logger.log('Error cargando descargas privadas:', e?.message || e);
      setDownloads([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadDownloads(); }, [storageKey]);

  useEffect(() => {
    AsyncStorage.getItem(autoCleanStorageKey)
      .then(value => setAutoCleanDaysState(Number(value || 0)))
      .catch(() => setAutoCleanDaysState(0));
  }, [autoCleanStorageKey]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') loadDownloads();
    });
    return () => sub.remove();
  }, [storageKey]);

  const setAutoCleanDays = async (days) => {
    const safeDays = Number(days || 0);
    setAutoCleanDaysState(safeDays);
    await AsyncStorage.setItem(autoCleanStorageKey, String(safeDays));
    if (safeDays > 0) runAutoClean(safeDays, true);
  };

  const runAutoClean = async (days = autoCleanDays, silent = false) => {
    const safeDays = Number(days || 0);
    if (safeDays <= 0) return { removed: 0 };
    const cutoff = Date.now() - safeDays * 24 * 60 * 60 * 1000;
    const keep = [];
    const remove = [];
    for (const item of downloadsRef.current) {
      const ts = item.downloadedAt ? new Date(item.downloadedAt).getTime() : Date.now();
      if (ts < cutoff) remove.push(item);
      else keep.push(item);
    }
    for (const item of remove) {
      if (item?.fileUri) await FileSystem.deleteAsync(item.fileUri, { idempotent: true }).catch(() => {});
    }
    if (remove.length) await saveDownloads(keep);
    if (!silent) Alert.alert('Limpieza terminada', remove.length ? `Se eliminaron ${remove.length} descarga(s) antigua(s).` : 'No había descargas antiguas para eliminar.');
    return { removed: remove.length };
  };

  const isDownloaded = (item, type = 'movie') => {
    const key = getItemKey(item, type);
    return downloadsRef.current.some(d => d.key === key);
  };

  const getDownloadedItem = (item, type = 'movie') => {
    const key = getItemKey(item, type);
    return downloadsRef.current.find(d => d.key === key) || null;
  };

  const getProgress = (item, type = 'movie') => {
    const key = getItemKey(item, type);
    return progressMap[key] || activeDownloadsRef.current[key]?.progress || 0;
  };

  const isDownloading = (item, type = 'movie') => {
    const key = getItemKey(item, type);
    const job = activeDownloadsRef.current[key];
    return Boolean(job && ['queued', 'downloading', 'paused'].includes(job.status));
  };

  const buildDownloadUrl = (item, type) => {
    if (!server?.url || !user?.username || !user?.password) {
      throw new Error('Sesión no disponible. Vuelve a iniciar sesión.');
    }
    const raw = getRaw(item);
    const streamId = raw.stream_id || raw.id;
    if (!streamId) throw new Error('No se encontró el ID del contenido.');
    const ext = getExtension(raw, type);
    return getStreamUrl(server.url, user.username, user.password, streamId, normalizeType(type), ext);
  };

  const cancelDownload = async (item, type = 'movie') => {
    const key = typeof item === 'string' ? item : (item?.key || getItemKey(item, type));
    canceledRef.current[key] = true;
    pauseRequestedRef.current[key] = false;
    delete resumePromisesRef.current[key];
    const task = activeTasksRef.current[key];
    if (task) {
      try { await task.pauseAsync(); } catch (_) {}
      delete activeTasksRef.current[key];
    }
    const job = activeDownloadsRef.current[key];
    if (job?.fileUri) FileSystem.deleteAsync(job.fileUri, { idempotent: true }).catch(() => {});
    setProgressMap(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    updateJob(key, { status: 'cancelled', error: 'Cancelada por el usuario' });
    setTimeout(() => updateJob(key, null), 1000);
  };

  const pauseDownload = async (item, type = 'movie') => {
    const key = typeof item === 'string' ? item : (item?.key || getItemKey(item, type));
    const task = activeTasksRef.current[key];
    if (!task) return false;
    try {
      pauseRequestedRef.current[key] = true;
      updateJob(key, { status: 'paused' });
      const snapshot = await task.pauseAsync();
      updateJob(key, { status: 'paused', resumeData: snapshot?.resumeData || null });
      return true;
    } catch (e) {
      pauseRequestedRef.current[key] = false;
      logger.log('No se pudo pausar descarga:', e?.message || e);
      updateJob(key, { status: 'downloading' });
      return false;
    }
  };

  const resumeDownload = async (item, type = 'movie') => {
    const key = typeof item === 'string' ? item : (item?.key || getItemKey(item, type));
    const task = activeTasksRef.current[key];
    if (!task) return false;
    try {
      pauseRequestedRef.current[key] = false;
      updateJob(key, { status: 'downloading' });
      const resumePromise = task.resumeAsync();
      resumePromisesRef.current[key] = resumePromise;
      await resumePromise;
      return true;
    } catch (e) {
      delete resumePromisesRef.current[key];
      logger.log('No se pudo reanudar descarga:', e?.message || e);
      updateJob(key, { status: 'paused', error: 'No se pudo reanudar. Intenta cancelar y descargar otra vez.' });
      return false;
    }
  };

  const downloadItem = async (item, type = 'movie') => {
    if (type === 'live') {
      Alert.alert('No disponible', 'Los canales en vivo no se pueden descargar.');
      return { success: false };
    }

    const key = getItemKey(item, type);
    const already = downloadsRef.current.find(d => d.key === key);
    if (already) {
      Alert.alert('Ya descargado', 'Este contenido ya está guardado para ver offline.');
      return { success: true, item: already };
    }

    if (activeDownloadsRef.current[key]) {
      Alert.alert('En progreso', 'Este contenido ya se está descargando.');
      return { success: false, alreadyActive: true };
    }

    let fileUri = null;
    const raw = getRaw(item);
    canceledRef.current[key] = false;
    pauseRequestedRef.current[key] = false;
    delete resumePromisesRef.current[key];
    updateJob(key, createJobFromItem(raw, type, { progress: 0.01, status: 'queued' }));
    setProgressMap(prev => ({ ...prev, [key]: 0.01 }));

    try {
      await ensureVault();
      const url = buildDownloadUrl(raw, type);
      await checkUrlAccessible(url);

      let privateName = null;
      let result = null;
      let lastError = null;
      const MAX_RETRIES = 3;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
        if (canceledRef.current[key]) throw new Error('Descarga cancelada.');
        privateName = `${safeValue(type)}_${Date.now()}_${Math.random().toString(36).slice(2)}.lpdata`;
        fileUri = `${getVaultDir()}${privateName}`;
        updateJob(key, {
          status: 'downloading',
          attempt,
          fileUri,
          privateFileName: privateName,
          progress: attempt === 1 ? 0.01 : Math.min(0.15 * attempt, 0.45),
        });

        const task = FileSystem.createDownloadResumable(
          url,
          fileUri,
          {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 Chrome/120 Safari/537.36',
              Accept: '*/*',
              Connection: 'close',
              'Cache-Control': 'no-cache',
              Pragma: 'no-cache',
            },
          },
          (progress) => {
            const total = progress.totalBytesExpectedToWrite || 0;
            const written = progress.totalBytesWritten || 0;
            const percent = total > 0 ? written / total : Math.min(0.08 * attempt, 0.35);
            const safePercent = Math.min(Math.max(percent, 0.01), 0.99);
            setProgressMap(prev => ({ ...prev, [key]: safePercent }));
            updateJob(key, { progress: safePercent, written, total, status: activeDownloadsRef.current[key]?.status === 'paused' ? 'paused' : 'downloading' });
          }
        );

        activeTasksRef.current[key] = task;
        try {
          result = await task.downloadAsync();
          const jobAfterDownload = activeDownloadsRef.current[key];
          const expected = Number(jobAfterDownload?.total || 0);
          const written = Number(jobAfterDownload?.written || 0);
          const looksIncomplete = expected > MIN_VALID_BYTES && written > 0 && written < expected * 0.98;
          if ((jobAfterDownload?.status === 'paused' || pauseRequestedRef.current[key] || looksIncomplete) && !canceledRef.current[key]) {
            while (activeDownloadsRef.current[key]?.status === 'paused' && !canceledRef.current[key]) {
              await new Promise(resolve => setTimeout(resolve, 500));
            }
            if (canceledRef.current[key]) throw new Error('Descarga cancelada.');
            const resumePromise = resumePromisesRef.current[key];
            if (resumePromise) {
              result = await resumePromise;
              delete resumePromisesRef.current[key];
            }
          }
          lastError = null;
          break;
        } catch (downloadError) {
          if (canceledRef.current[key]) throw new Error('Descarga cancelada.');
          const isPaused = activeDownloadsRef.current[key]?.status === 'paused';
          if (isPaused) {
            // Esperar a que resumeAsync continúe o hasta que se cancele.
            while (activeDownloadsRef.current[key]?.status === 'paused' && !canceledRef.current[key]) {
              await new Promise(resolve => setTimeout(resolve, 500));
            }
            if (canceledRef.current[key]) throw new Error('Descarga cancelada.');
          }
          lastError = downloadError;
          logger.log(`Descarga falló intento ${attempt}/${MAX_RETRIES}:`, downloadError?.message || downloadError);
          delete activeTasksRef.current[key];
          await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});
          if (attempt < MAX_RETRIES) {
            updateJob(key, { status: 'retrying', error: `Reintentando descarga (${attempt + 1}/${MAX_RETRIES})...` });
            await new Promise(resolve => setTimeout(resolve, 1200 * attempt));
          }
        }
      }

      delete activeTasksRef.current[key];
      if (!result && lastError) throw lastError;

      const completedJob = activeDownloadsRef.current[key] || {};
      const info = await validateDownloadedFile(result?.uri || fileUri, completedJob.total);
      const record = {
        key,
        type: normalizeType(type),
        name: getName(raw),
        poster: getPoster(raw),
        fileUri: result?.uri || fileUri,
        privateFileName: privateName,
        size: info.size || 0,
        downloadedAt: new Date().toISOString(),
        raw,
      };

      const next = [record, ...downloadsRef.current.filter(d => d.key !== key)];
      await saveDownloads(next);
      setProgressMap(prev => ({ ...prev, [key]: 1 }));
      updateJob(key, { ...record, status: 'completed', progress: 1, written: info.size || 0, total: info.size || 0 });
      setTimeout(() => updateJob(key, null), 6000);
      return { success: true, item: record };
    } catch (e) {
      delete activeTasksRef.current[key];
      const msg = formatDownloadError(e);
      logger.log('Error descargando contenido:', msg);
      setProgressMap(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      if (fileUri) FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});
      updateJob(key, { status: msg.includes('cancelada') ? 'cancelled' : 'error', error: msg });
      if (!msg.includes('cancelada')) {
        Alert.alert('❌ Error de descarga', msg.includes('HTML') || msg.includes('directa')
          ? 'Este servidor no permite descargar este contenido directamente.'
          : `No se pudo descargar este contenido.\n\n${msg}`);
      }
      setTimeout(() => updateJob(key, null), 9000);
      return { success: false, error: msg };
    } finally {
      canceledRef.current[key] = false;
      pauseRequestedRef.current[key] = false;
      delete resumePromisesRef.current[key];
    }
  };


  const clearFailedDownloads = async () => {
    const failedKeys = Object.entries(activeDownloadsRef.current || {})
      .filter(([, job]) => ['error', 'cancelled'].includes(job?.status))
      .map(([key]) => key);

    for (const key of failedKeys) {
      const job = activeDownloadsRef.current[key];
      if (job?.fileUri) {
        await FileSystem.deleteAsync(job.fileUri, { idempotent: true }).catch(() => {});
      }
      delete activeTasksRef.current[key];
      delete canceledRef.current[key];
    }

    if (failedKeys.length) {
      setActiveDownloads(prev => {
        const next = { ...prev };
        failedKeys.forEach(key => delete next[key]);
        return next;
      });
      setProgressMap(prev => {
        const next = { ...prev };
        failedKeys.forEach(key => delete next[key]);
        return next;
      });
    }

    return { removed: failedKeys.length };
  };

  const deleteDownload = async (download) => {
    try {
      if (download?.fileUri) {
        await FileSystem.deleteAsync(download.fileUri, { idempotent: true }).catch(() => {});
      }
      const next = downloadsRef.current.filter(d => d.key !== download.key);
      await saveDownloads(next);
    } catch (e) {
      logger.log('Error eliminando descarga:', e?.message || e);
      Alert.alert('Error', 'No se pudo eliminar la descarga.');
    }
  };

  const clearAllDownloads = async () => {
    try {
      for (const item of downloadsRef.current) {
        if (item?.fileUri) await FileSystem.deleteAsync(item.fileUri, { idempotent: true }).catch(() => {});
      }
      await saveDownloads([]);
    } catch (e) {
      logger.log('Error limpiando descargas:', e?.message || e);
    }
  };

  return (
    <DownloadsContext.Provider value={{
      downloads,
      loading,
      progressMap,
      activeDownloads,
      downloadItem,
      cancelDownload,
      pauseDownload,
      resumeDownload,
      deleteDownload,
      clearAllDownloads,
      clearFailedDownloads,
      isDownloaded,
      isDownloading,
      getDownloadedItem,
      getProgress,
      reloadDownloads: loadDownloads,
      autoCleanDays,
      setAutoCleanDays,
      runAutoClean,
    }}>
      {children}
    </DownloadsContext.Provider>
  );
};

export const useDownloads = () => useContext(DownloadsContext);
