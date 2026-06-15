import React, { useCallback, useMemo } from 'react';
import { View, Text, FlatList, StyleSheet, Image, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDownloads } from '../context/DownloadsContext';
import { useLibrary } from '../context/LibraryContext';
import { colors } from '../theme';
import { safeBack, useSafeHardwareBack } from '../utils/navigation';
import FocusableButton from '../components/FocusableButton';
import { isTV } from '../utils/tv';
import { getResumePositionMillis, promptResumePlayback, shouldAskResume } from '../utils/resumePlayback';

const formatSize = (bytes = 0) => {
  if (!bytes) return 'Tamaño desconocido';
  const mb = bytes / 1024 / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
};

const formatDate = (isoString) => {
  if (!isoString) return '';
  try {
    return new Date(isoString).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch (_) {
    return '';
  }
};

const statusLabel = (status) => {
  switch (status) {
    case 'queued': return 'Preparando';
    case 'paused': return 'Pausada';
    case 'retrying': return 'Reintentando';
    case 'completed': return 'Completada';
    case 'error': return 'Error';
    case 'cancelled': return 'Cancelada';
    default: return 'Descargando';
  }
};

export default function DownloadsScreen({ navigation }) {
  useSafeHardwareBack(navigation, 'Home');
  const {
    downloads = [],
    activeDownloads = {},
    deleteDownload,
    clearAllDownloads,
    clearFailedDownloads,
    cancelDownload,
    pauseDownload,
    resumeDownload,
    autoCleanDays,
    setAutoCleanDays,
    runAutoClean,
  } = useDownloads();
  const { getContinueWatchingItem } = useLibrary();

  const activeJobs = useMemo(() => Object.values(activeDownloads), [activeDownloads]);
  const failedJobs = useMemo(
    () => activeJobs.filter(job => ['error', 'cancelled'].includes(job?.status)),
    [activeJobs]
  );
  const totalSize = useMemo(() => downloads.reduce((sum, d) => sum + (d.size || 0), 0), [downloads]);

  const handleDelete = useCallback((item) => {
    Alert.alert('Eliminar descarga', `¿Eliminar "${item.name}" de este dispositivo?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: () => deleteDownload(item) },
    ]);
  }, [deleteDownload]);

  const handleClearAll = useCallback(() => {
    if (!downloads.length) return;
    Alert.alert('Eliminar todas', '¿Quieres eliminar todas las descargas offline guardadas?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar todo', style: 'destructive', onPress: clearAllDownloads },
    ]);
  }, [downloads.length, clearAllDownloads]);

  const handleClearFailed = useCallback(() => {
    if (!failedJobs.length) return;
    Alert.alert('Limpiar errores', 'Eliminar las descargas fallidas o canceladas?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Limpiar', style: 'destructive', onPress: clearFailedDownloads },
    ]);
  }, [failedJobs.length, clearFailedDownloads]);

  const openDownload = useCallback((item) => {
    const raw = item.raw || item;
    const type = item.type || 'movie';
    const resumeItem = getContinueWatchingItem(raw, type);

    const openPlayer = (resumePosition = 0) => {
      navigation.navigate('Player', {
        stream: raw,
        type,
        resumePosition,
        offlineUri: item.fileUri,
        offlineMode: true,
        returnRoute: 'Downloads',
      });
    };

    if (shouldAskResume(resumeItem)) {
      promptResumePlayback({
        resumeItem,
        title: item.name || raw.name || raw.title || 'este contenido',
        onContinue: () => openPlayer(getResumePositionMillis(resumeItem)),
        onRestart: () => openPlayer(0),
      });
      return;
    }

    openPlayer(0);
  }, [getContinueWatchingItem, navigation]);

  const renderActiveJob = (job) => {
    const pct = Math.max(0, Math.min(100, Math.round((job.progress || 0) * 100)));
    const isPaused = job.status === 'paused';
    const isError = job.status === 'error' || job.status === 'cancelled';
    const hasTotal = Number(job.total || 0) > 0;
    const sizeText = hasTotal ? `${formatSize(job.written)} / ${formatSize(job.total)}` : formatSize(job.written);
    const progressText = hasTotal ? `${pct}%${sizeText ? ` · ${sizeText}` : ''}` : (sizeText ? `${sizeText} descargados` : 'Descargando...');

    return (
      <View key={job.key} style={styles.activeCard}>
        {job.poster ? <Image source={{ uri: job.poster }} style={styles.activePoster} /> : <View style={styles.activePosterPlaceholder}><Text style={styles.posterIcon}>⬇</Text></View>}
        <View style={styles.activeInfo}>
          <Text style={[styles.activeStatus, isError && styles.activeStatusError]}>{statusLabel(job.status).toUpperCase()}</Text>
          <Text style={styles.activeName} numberOfLines={2}>{job.name}</Text>
          <View style={styles.progressTrack}><View style={[styles.progressBar, { width: `${pct}%` }, isError && styles.progressError]} /></View>
          <Text style={styles.activeMeta}>{progressText}</Text>
          {job.error ? <Text style={styles.errorText} numberOfLines={2}>{job.error}</Text> : null}
          {!isError && job.status !== 'completed' ? (
            <View style={styles.activeActions}>
              <FocusableButton style={[styles.smallBtn, styles.cancelBtn]} onPress={() => cancelDownload(job.key)}>
                <Text style={[styles.smallBtnText, styles.cancelText]}>Cancelar</Text>
              </FocusableButton>
              <FocusableButton style={styles.smallBtn} onPress={() => isPaused ? resumeDownload(job.key) : pauseDownload(job.key)}>
                <Text style={styles.smallBtnText}>{isPaused ? 'Reanudar' : 'Pausar'}</Text>
              </FocusableButton>
            </View>
          ) : null}
        </View>
      </View>
    );
  };

  const renderItem = useCallback(({ item }) => (
    <FocusableButton
      style={styles.row}
      focusedStyle={styles.rowFocused}
      onPress={() => openDownload(item)}
      onLongPress={() => handleDelete(item)}
    >
      {item.poster ? <Image source={{ uri: item.poster }} style={styles.poster} resizeMode="cover" /> : <View style={styles.posterPlaceholder}><Text style={styles.posterIcon}>{item.type === 'series' ? '📡' : '🎬'}</Text></View>}
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
        <Text style={styles.meta}>{item.type === 'series' ? 'Episodio descargado' : 'Película descargada'} · {formatSize(item.size)}</Text>
        {item.downloadedAt ? <Text style={styles.meta}>📅 {formatDate(item.downloadedAt)}</Text> : null}
        <Text style={styles.privateText}>Disponible sin conexión dentro de FLASHNETV</Text>
      </View>
      <View style={styles.actions}>
        <Text style={styles.play}>▶</Text>
        <FocusableButton
          style={styles.deleteBtn}
          onPress={(event) => {
            event?.stopPropagation?.();
            handleDelete(item);
          }}
        >
          <Text style={styles.deleteText}>Eliminar</Text>
        </FocusableButton>
      </View>
    </FocusableButton>
  ), [openDownload, handleDelete]);

  const Header = () => (
    <>
      <View style={styles.notice}>
        <Text style={styles.noticeTitle}>⬇ Centro de descargas</Text>
        <Text style={styles.noticeText}>Controla tus descargas, pausa, cancela y reproduce contenido sin conexión.</Text>
        <Text style={styles.noticeStats}>{downloads.length} archivo{downloads.length !== 1 ? 's' : ''}{activeJobs.length ? ` · ${activeJobs.length} en progreso` : ''}{totalSize ? ` · ${formatSize(totalSize)} usados` : ''}</Text>
        <View style={styles.autoCleanBox}>
          <Text style={styles.autoCleanTitle}>Auto-limpieza</Text>
          <View style={styles.autoCleanButtons}>
            {[0, 30, 60, 90].map(days => (
              <FocusableButton key={days} style={[styles.autoCleanBtn, autoCleanDays === days && styles.autoCleanBtnActive]} onPress={() => setAutoCleanDays(days)}>
                <Text style={[styles.autoCleanBtnText, autoCleanDays === days && styles.autoCleanBtnTextActive]}>{days === 0 ? 'Off' : `${days}d`}</Text>
              </FocusableButton>
            ))}
            <FocusableButton style={styles.autoCleanRunBtn} onPress={() => runAutoClean(autoCleanDays || 30)}>
              <Text style={styles.autoCleanRunText}>Limpiar ahora</Text>
            </FocusableButton>
            <FocusableButton style={[styles.autoCleanRunBtn, failedJobs.length > 0 && styles.failedCleanBtn]} onPress={handleClearFailed}>
              <Text style={styles.autoCleanRunText}>Limpiar errores</Text>
            </FocusableButton>
          </View>
        </View>
      </View>

      {activeJobs.length > 0 && (
        <View style={styles.activeSection}>
          <Text style={styles.sectionLabel}>Descargando ahora</Text>
          {activeJobs.map(renderActiveJob)}
        </View>
      )}

      {downloads.length > 0 && <Text style={styles.sectionLabel}>Completadas</Text>}
    </>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <FocusableButton onPress={() => safeBack(navigation, 'Home')} style={styles.backBtn}>
          <Text style={styles.backText}>← Volver</Text>
        </FocusableButton>
        <Text style={styles.title}>Descargas</Text>
        <FocusableButton onPress={handleClearAll} style={styles.clearBtn}>
          <Text style={styles.clearText}>Limpiar</Text>
        </FocusableButton>
      </View>

      <FlatList
        data={downloads}
        renderItem={renderItem}
        keyExtractor={(item, index) => `${item.key}-${index}`}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={<Header />}
        ListEmptyComponent={activeJobs.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>⬇️</Text>
            <Text style={styles.emptyTitle}>No hay descargas todavía</Text>
            <Text style={styles.emptyText}>Descarga películas o episodios para verlos sin conexión dentro de FLASHNETV.</Text>
          </View>
        ) : null}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: isTV ? 36 : 16, paddingVertical: isTV ? 22 : 14 },
  backBtn: { paddingVertical: 8, paddingHorizontal: 8 },
  backText: { color: colors.accent, fontSize: isTV ? 17 : 14, fontWeight: '700' },
  title: { color: colors.white, fontSize: isTV ? 26 : 22, fontWeight: '900' },
  clearBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)' },
  clearText: { color: colors.danger || '#ff6b6b', fontSize: 12, fontWeight: '700' },
  list: { paddingHorizontal: isTV ? 36 : 16, paddingBottom: 120 },
  notice: { backgroundColor: colors.card, borderRadius: 18, padding: isTV ? 22 : 16, marginBottom: 18, borderWidth: 1, borderColor: '#2a2a3a' },
  noticeTitle: { color: colors.white, fontSize: isTV ? 20 : 16, fontWeight: '900', marginBottom: 8 },
  noticeText: { color: colors.textSecondary, fontSize: isTV ? 15 : 12, lineHeight: isTV ? 22 : 18 },
  noticeStats: { color: colors.accent, fontSize: isTV ? 14 : 12, fontWeight: '700', marginTop: 10 },
  autoCleanBox: { marginTop: 14, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)', paddingTop: 12 },
  autoCleanTitle: { color: colors.white, fontSize: 13, fontWeight: '800', marginBottom: 10 },
  autoCleanButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  autoCleanBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  autoCleanBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  autoCleanBtnText: { color: colors.textSecondary, fontWeight: '800', fontSize: 12 },
  autoCleanBtnTextActive: { color: colors.white },
  autoCleanRunBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(50,197,255,0.12)', borderWidth: 1, borderColor: 'rgba(50,197,255,0.35)' },
  autoCleanRunText: { color: colors.accent, fontSize: 12, fontWeight: '800' },
  failedCleanBtn: { borderColor: 'rgba(255,107,107,0.55)', backgroundColor: 'rgba(255,107,107,0.08)' },
  activeSection: { marginBottom: 20 },
  sectionLabel: { color: colors.white, fontSize: isTV ? 20 : 16, fontWeight: '900', marginBottom: 12, marginTop: 4 },
  activeCard: { flexDirection: 'row', backgroundColor: '#1b1b20', borderRadius: 18, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(224,194,79,0.35)', gap: 12 },
  activePoster: { width: isTV ? 70 : 54, height: isTV ? 96 : 76, borderRadius: 10, backgroundColor: '#111' },
  activePosterPlaceholder: { width: isTV ? 70 : 54, height: isTV ? 96 : 76, borderRadius: 10, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  posterIcon: { fontSize: 22 },
  activeInfo: { flex: 1, minWidth: 0 },
  activeStatus: { color: '#E0C24F', fontSize: 11, letterSpacing: 2, fontWeight: '900' },
  activeStatusError: { color: '#ff6b6b' },
  activeName: { color: colors.white, fontSize: isTV ? 19 : 16, fontWeight: '900', marginTop: 4 },
  progressTrack: { height: 8, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 8, overflow: 'hidden', marginTop: 10 },
  progressBar: { height: '100%', backgroundColor: '#E0C24F', borderRadius: 8 },
  progressError: { backgroundColor: '#ff6b6b' },
  activeMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 6 },
  errorText: { color: '#ffaaaa', fontSize: 12, marginTop: 6 },
  activeActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  smallBtn: { flex: 1, borderRadius: 10, paddingVertical: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', alignItems: 'center' },
  smallBtnText: { color: colors.white, fontWeight: '900', fontSize: 13 },
  cancelBtn: { borderColor: 'rgba(255,107,107,0.5)' },
  cancelText: { color: '#ff8c8c' },
  row: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 14, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#2a2a3a', alignItems: 'center' },
  rowFocused: { borderColor: colors.accent, backgroundColor: 'rgba(50,197,255,0.12)' },
  poster: { width: isTV ? 78 : 58, height: isTV ? 112 : 86, borderRadius: 8, backgroundColor: '#111' },
  posterPlaceholder: { width: isTV ? 78 : 58, height: isTV ? 112 : 86, borderRadius: 8, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, marginLeft: 12, gap: 4 },
  name: { color: colors.white, fontSize: isTV ? 17 : 14, fontWeight: '800' },
  meta: { color: colors.textSecondary, fontSize: isTV ? 13 : 11 },
  privateText: { color: colors.accent, fontSize: isTV ? 12 : 10, fontWeight: '700' },
  actions: { alignItems: 'center', gap: 8, marginLeft: 10 },
  play: { color: colors.primary, fontSize: 22 },
  deleteBtn: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: 'rgba(255,0,0,0.12)' },
  deleteText: { color: '#ff8c8c', fontSize: 10, fontWeight: '800' },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 90, gap: 12 },
  emptyIcon: { fontSize: 54 },
  emptyTitle: { color: colors.white, fontSize: 18, fontWeight: '900' },
  emptyText: { color: colors.textSecondary, textAlign: 'center', lineHeight: 20, maxWidth: 330 },
});
