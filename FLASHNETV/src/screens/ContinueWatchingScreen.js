import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  FlatList, Image, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLibrary } from '../context/LibraryContext';
import { useDownloads } from '../context/DownloadsContext';
import { colors } from '../theme';
import { safeBack, useSafeHardwareBack } from '../utils/navigation';
import { getResumePositionMillis, promptResumePlayback, shouldAskResume } from '../utils/resumePlayback';

const cleanName = (raw = '') => {
  const s = String(raw);
  if ((s.match(/\./) || []).length >= 3) {
    const cut = s.search(/[\.\s](?:19|20)\d{2}[\.\s]|[\.\s](720p|1080p|2160p|4K|BRRip|BluRay|WEBRip|HDTV|DVDRip)/i);
    const title = cut > 0 ? s.substring(0, cut) : s;
    return title.replace(/\./g, ' ').replace(/_/g, ' ').trim();
  }
  return s.trim();
};

export default function ContinueWatchingScreen({ navigation }) {
  useSafeHardwareBack(navigation, 'Home');
  const { continueWatching, removeFromContinueWatching, clearContinueWatching } = useLibrary();
  const { getDownloadedItem } = useDownloads();

  const openItem = (item) => {
    const raw = item.raw || item;
    const type = item.type || 'movie';
    const downloaded = getDownloadedItem(raw, type);

    const openPlayer = (resumePosition = 0) => {
      navigation.navigate('Player', {
        stream: raw,
        type,
        resumePosition,
        offlineUri: downloaded?.fileUri || null,
        offlineMode: Boolean(downloaded?.fileUri),
        returnRoute: 'ContinueWatching',
      });
    };

    if (shouldAskResume(item)) {
      promptResumePlayback({
        resumeItem: item,
        title: cleanName(item.name || raw.name || raw.title || 'este contenido'),
        onContinue: () => openPlayer(getResumePositionMillis(item)),
        onRestart: () => openPlayer(0),
      });
      return;
    }

    openPlayer(0);
  };

  const confirmRemove = (item) => {
    Alert.alert(
      'Quitar de continuar viendo',
      `¿Quieres quitar "${item.name}"?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Quitar', style: 'destructive', onPress: () => removeFromContinueWatching(item.raw || item, item.type) },
      ]
    );
  };

  const confirmClear = () => {
    Alert.alert(
      'Limpiar historial',
      '¿Quieres borrar toda la lista de continuar viendo?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Limpiar', style: 'destructive', onPress: clearContinueWatching },
      ]
    );
  };

  const renderItem = ({ item }) => {
    const image = item.stream_icon || item.cover || item.raw?.stream_icon || item.raw?.cover || item.raw?.info?.movie_image;
    const progress = Math.round((item.progress || 0) * 100);

    return (
      <TouchableOpacity style={styles.row} onPress={() => openItem(item)} activeOpacity={0.85}>
        {image ? (
          <Image source={{ uri: image }} style={styles.poster} resizeMode="cover" />
        ) : (
          <View style={styles.posterPlaceholder}>
            <Text style={styles.posterIcon}>{item.type === 'series' ? '📡' : '🎬'}</Text>
          </View>
        )}
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={2}>{cleanName(item.name || '')}</Text>
          <Text style={styles.meta}>{item.type === 'series' ? 'Serie' : 'Película'} · {progress}% visto</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressBar, { width: `${Math.min(progress, 100)}%` }]} />
          </View>
        </View>
        <TouchableOpacity style={styles.removeBtn} onPress={() => confirmRemove(item)}>
          <Text style={styles.removeText}>×</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => safeBack(navigation, 'Home')} style={styles.backBtn}>
          <Text style={styles.backText}>← Volver</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Continuar viendo</Text>
        {continueWatching.length > 0 ? (
          <TouchableOpacity onPress={confirmClear}>
            <Text style={styles.clearText}>Limpiar</Text>
          </TouchableOpacity>
        ) : <Text style={styles.count}>0</Text>}
      </View>

      {continueWatching.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>▶</Text>
          <Text style={styles.emptyTitle}>Nada pendiente</Text>
          <Text style={styles.emptyText}>Cuando veas películas o episodios, aparecerán aquí para continuar después.</Text>
        </View>
      ) : (
        <FlatList
          data={continueWatching}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    paddingTop: 8,
  },
  backBtn: { padding: 4 },
  backText: { color: colors.accent, fontSize: 14 },
  title: { color: colors.white, fontSize: 18, fontWeight: 'bold' },
  count: { color: colors.textSecondary, fontSize: 12 },
  clearText: { color: colors.accent, fontSize: 12, fontWeight: '600' },
  list: { padding: 16, gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: '#2a2a3a',
    gap: 12,
  },
  poster: { width: 74, height: 98, borderRadius: 9, backgroundColor: '#0f0f14' },
  posterPlaceholder: {
    width: 74,
    height: 98,
    borderRadius: 9,
    backgroundColor: '#0f0f14',
    justifyContent: 'center',
    alignItems: 'center',
  },
  posterIcon: { fontSize: 30 },
  info: { flex: 1, gap: 8 },
  name: { color: colors.white, fontSize: 14, fontWeight: '700' },
  meta: { color: colors.textSecondary, fontSize: 12 },
  progressTrack: { height: 5, backgroundColor: '#333', borderRadius: 4, overflow: 'hidden' },
  progressBar: { height: 5, backgroundColor: colors.primary },
  removeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#0f0f14',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2a2a3a',
  },
  removeText: { color: colors.textSecondary, fontSize: 26, marginTop: -2 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },
  emptyIcon: { fontSize: 50, marginBottom: 14 },
  emptyTitle: { color: colors.white, fontSize: 20, fontWeight: 'bold', marginBottom: 8 },
  emptyText: { color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
});
