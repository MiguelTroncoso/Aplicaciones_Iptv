import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  FlatList, Image, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLibrary } from '../context/LibraryContext';
import { colors } from '../theme';
import { safeBack, useSafeHardwareBack } from '../utils/navigation';
import { getResumePositionMillis, promptResumePlayback, shouldAskResume } from '../utils/resumePlayback';

export default function FavoritesScreen({ navigation }) {
  useSafeHardwareBack(navigation, 'Home');
  const { favorites, toggleFavorite, getContinueWatchingItem } = useLibrary();

  const openItem = (item) => {
    const raw = item.raw || item;
    const type = item.type || 'movie';

    // Serie completa (no episodio): va a detalle
    if (type === 'series' && raw.series_id && !raw.stream_id) {
      navigation.navigate('SeriesDetail', { serie: raw });
      return;
    }

    // Película → pantalla de detalle; episodio → directo al player con confirmación si hay progreso.
    if (type === 'movie') {
      navigation.navigate('MovieDetail', { stream: raw, type });
      return;
    }

    const resumeItem = getContinueWatchingItem(raw, type);
    const openPlayer = (resumePosition = 0) => {
      navigation.navigate('Player', {
        stream: raw,
        type,
        resumePosition,
        returnRoute: 'Favorites',
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
  };

  const removeFavorite = async (item) => {
    await toggleFavorite(item.raw || item, item.type || 'movie');
  };

  const confirmRemove = (item) => {
    Alert.alert(
      'Quitar favorito',
      `¿Quieres quitar "${item.name}" de favoritos?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Quitar', style: 'destructive', onPress: () => removeFavorite(item) },
      ]
    );
  };

  const renderItem = ({ item }) => {
    const image = item.stream_icon || item.cover || item.raw?.stream_icon || item.raw?.cover;
    const icon = item.type === 'live' ? '📺' : item.type === 'series' ? '📡' : '🎬';

    return (
      <TouchableOpacity style={styles.row} onPress={() => openItem(item)} activeOpacity={0.85}>
        {image ? (
          <Image source={{ uri: image }} style={styles.poster} resizeMode="cover" />
        ) : (
          <View style={styles.posterPlaceholder}>
            <Text style={styles.posterIcon}>{icon}</Text>
          </View>
        )}
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
          <Text style={styles.type}>{labelByType(item.type)}</Text>
          {item.rating && item.rating !== '0' && (
            <Text style={styles.rating}>⭐ {parseFloat(item.rating).toFixed(1)}</Text>
          )}
        </View>
        <TouchableOpacity style={styles.removeBtn} onPress={() => confirmRemove(item)}>
          <Text style={styles.removeText}>★</Text>
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
        <Text style={styles.title}>Mis favoritos</Text>
        <Text style={styles.count}>{favorites.length}</Text>
      </View>

      {favorites.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>⭐</Text>
          <Text style={styles.emptyTitle}>Aún no tienes favoritos</Text>
          <Text style={styles.emptyText}>Presiona la estrella en canales, películas o series para guardarlos aquí.</Text>
        </View>
      ) : (
        <FlatList
          data={favorites}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const labelByType = (type) => {
  if (type === 'live') return 'TV en vivo';
  if (type === 'series') return 'Serie / episodio';
  return 'Película';
};

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
  poster: { width: 64, height: 88, borderRadius: 9, backgroundColor: '#0f0f14' },
  posterPlaceholder: {
    width: 64,
    height: 88,
    borderRadius: 9,
    backgroundColor: '#0f0f14',
    justifyContent: 'center',
    alignItems: 'center',
  },
  posterIcon: { fontSize: 30 },
  info: { flex: 1, gap: 4 },
  name: { color: colors.white, fontSize: 14, fontWeight: '700' },
  type: { color: colors.textSecondary, fontSize: 12 },
  rating: { color: '#FFD700', fontSize: 11 },
  removeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#0f0f14',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2a2a3a',
  },
  removeText: { color: '#FFD700', fontSize: 22 },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  emptyIcon: { fontSize: 50, marginBottom: 14 },
  emptyTitle: { color: colors.white, fontSize: 20, fontWeight: 'bold', marginBottom: 8 },
  emptyText: { color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
});
