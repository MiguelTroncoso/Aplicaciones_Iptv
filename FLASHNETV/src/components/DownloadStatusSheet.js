import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDownloads } from '../context/DownloadsContext';
import FocusableButton from './FocusableButton';
import { colors } from '../theme';
import { isTV } from '../utils/tv';

const formatBytes = (bytes = 0) => {
  if (!bytes) return '';
  const mb = bytes / 1024 / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
};

const statusLabel = (status) => {
  switch (status) {
    case 'queued': return 'PREPARANDO';
    case 'paused': return 'PAUSADA';
    case 'retrying': return 'REINTENTANDO';
    case 'completed': return 'DESCARGA LISTA';
    case 'error': return 'ERROR DE DESCARGA';
    case 'cancelled': return 'CANCELADA';
    default: return 'DESCARGANDO';
  }
};

export default function DownloadStatusSheet({ navigationRef, currentRouteName }) {
  const insets = useSafeAreaInsets();
  const { activeDownloads, pauseDownload, resumeDownload, cancelDownload } = useDownloads();
  const jobs = useMemo(() => Object.values(activeDownloads || {}), [activeDownloads]);
  const [minimized, setMinimized] = useState(false);

  if (!jobs.length) return null;

  // En Player no mostramos paneles para no tapar controles ni video.
  // La descarga sigue corriendo y puede verse desde Mis descargas.
  if (currentRouteName === 'Player') return null;

  const job = jobs[0];
  const pct = Math.max(0, Math.min(100, Math.round((job.progress || 0) * 100)));
  const isPaused = job.status === 'paused';
  const isDone = job.status === 'completed';
  const isError = job.status === 'error' || job.status === 'cancelled';
  const hasTotal = Number(job.total || 0) > 0;
  const sizeText = hasTotal
    ? `${formatBytes(job.written)} / ${formatBytes(job.total)}`
    : formatBytes(job.written);
  const progressText = hasTotal
    ? `${pct}%${sizeText ? ` · ${sizeText}` : ''}`
    : (sizeText ? `${sizeText} descargados` : 'Descargando...');

  const goDownloads = () => {
    try { navigationRef?.current?.navigate('Downloads'); } catch (_) {}
  };

  if (minimized && !isError && !isDone) {
    return (
      <FocusableButton style={[styles.mini, { bottom: insets.bottom + 88 }]} onPress={() => setMinimized(false)}>
        <Text style={styles.miniText}>{hasTotal ? `⬇ ${pct}%` : '⬇ ...'}</Text>
        {jobs.length > 1 && <Text style={styles.miniCount}>+{jobs.length - 1}</Text>}
      </FocusableButton>
    );
  }

  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 14 }, isTV && styles.sheetTV]}>
        <View style={styles.handle} />
        <View style={styles.rowTop}>
          {job.poster ? <Image source={{ uri: job.poster }} style={styles.poster} /> : <View style={styles.posterPlaceholder}><Text>⬇</Text></View>}
          <View style={styles.info}>
            <Text style={[styles.status, isError && styles.statusError, isDone && styles.statusDone]}>{statusLabel(job.status)}</Text>
            <Text style={styles.title} numberOfLines={2}>{job.name || 'Descargando contenido'}</Text>
            {job.error ? <Text style={styles.error} numberOfLines={2}>{job.error}</Text> : <Text style={styles.meta}>{progressText}</Text>}
          </View>
          <FocusableButton style={styles.closeBtn} onPress={() => isDone || isError ? cancelDownload(job.key) : setMinimized(true)}>
            <Text style={styles.closeText}>{isDone || isError ? '×' : '—'}</Text>
          </FocusableButton>
        </View>

        <View style={styles.track}>
          <View style={[styles.bar, { width: `${pct}%` }, isError && styles.barError, isDone && styles.barDone]} />
        </View>

        <View style={styles.actions}>
          {!isDone && !isError && (
            <FocusableButton style={[styles.actionBtn, styles.cancelBtn]} onPress={() => cancelDownload(job.key)}>
              <Text style={[styles.actionText, styles.cancelText]}>Cancelar</Text>
            </FocusableButton>
          )}
          {!isDone && !isError && (
            <FocusableButton style={styles.actionBtn} onPress={() => isPaused ? resumeDownload(job.key) : pauseDownload(job.key)}>
              <Text style={styles.actionText}>{isPaused ? 'Reanudar' : 'Pausar'}</Text>
            </FocusableButton>
          )}
          <FocusableButton style={[styles.actionBtn, styles.downloadsBtn]} onPress={goDownloads}>
            <Text style={styles.downloadsText}>{isDone ? 'Abrir descargas' : 'Mis descargas'}</Text>
          </FocusableButton>
        </View>

        {jobs.length > 1 && <Text style={styles.queueText}>Hay {jobs.length - 1} descarga(s) adicional(es) en cola/progreso.</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
    elevation: 9999,
  },
  sheet: {
    marginHorizontal: 0,
    backgroundColor: '#1b1b20',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 28,
  },
  sheetTV: { maxWidth: 760, alignSelf: 'center', borderRadius: 22, marginBottom: 28 },
  handle: { alignSelf: 'center', width: 42, height: 5, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.25)', marginBottom: 12 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  poster: { width: 46, height: 66, borderRadius: 8, backgroundColor: '#111' },
  posterPlaceholder: { width: 46, height: 66, borderRadius: 8, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, minWidth: 0 },
  status: { color: '#E0C24F', fontSize: 12, letterSpacing: 3, fontWeight: '900', marginBottom: 6 },
  statusError: { color: '#ff6b6b' },
  statusDone: { color: '#68d391' },
  title: { color: colors.white, fontSize: 18, fontWeight: '900' },
  meta: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
  error: { color: '#ffb3b3', fontSize: 12, marginTop: 4 },
  closeBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  closeText: { color: colors.white, fontSize: 24, fontWeight: '800' },
  track: { height: 8, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden', marginTop: 14 },
  bar: { height: '100%', backgroundColor: '#E0C24F', borderRadius: 8 },
  barError: { backgroundColor: '#ff6b6b' },
  barDone: { backgroundColor: '#68d391' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  actionBtn: { flex: 1, height: 48, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  actionText: { color: colors.white, fontSize: 15, fontWeight: '900' },
  cancelBtn: { borderColor: 'rgba(255,107,107,0.55)' },
  cancelText: { color: '#ff8c8c' },
  downloadsBtn: { backgroundColor: '#E0C24F', borderColor: '#E0C24F' },
  downloadsText: { color: '#121212', fontSize: 15, fontWeight: '900' },
  queueText: { color: colors.textSecondary, fontSize: 12, textAlign: 'center', marginTop: 10 },
  mini: { position: 'absolute', right: 18, width: 86, height: 48, borderRadius: 24, backgroundColor: '#E0C24F', alignItems: 'center', justifyContent: 'center', elevation: 30 },
  miniText: { color: '#121212', fontWeight: '900' },
  miniCount: { position: 'absolute', top: -6, right: -4, backgroundColor: '#ff6b6b', color: '#fff', borderRadius: 9, paddingHorizontal: 6, fontSize: 11, overflow: 'hidden' },
});
