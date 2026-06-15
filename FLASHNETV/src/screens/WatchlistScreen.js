/**
 * WatchlistScreen — "Ver después"
 * Lista de películas y series que el usuario quiere ver en algún momento.
 */
import React, { useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, Image,
  TouchableOpacity, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLibrary } from '../context/LibraryContext';
import { colors } from '../theme';
import FocusableButton from '../components/FocusableButton';
import { safeBack, useSafeHardwareBack } from '../utils/navigation';
import { isTV, layout } from '../utils/tv';

export default function WatchlistScreen({ navigation }) {
  useSafeHardwareBack(navigation, 'MainTabs');
  const { watchlist, toggleWatchlist } = useLibrary();

  const openItem = useCallback((item) => {
    const raw = item.raw || item;
    if (item.type === 'series') {
      navigation.navigate('SeriesDetail', { serie: raw });
    } else {
      navigation.navigate('MovieDetail', { stream: raw, type: item.type || 'movie' });
    }
  }, [navigation]);

  const removeItem = (item) => {
    Alert.alert(
      'Quitar de Ver después',
      `¿Quitar "${item.name}" de "Ver después"?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Quitar', style: 'destructive', onPress: () => toggleWatchlist(item.raw || item, item.type) },
      ]
    );
  };

  const renderItem = useCallback(({ item }) => (
    <FocusableButton
      style={styles.card}
      focusedStyle={styles.cardFocused}
      onPress={() => openItem(item)}
    >
      {item.poster ? (
        <Image source={{ uri: item.poster }} style={styles.poster} resizeMode="cover" />
      ) : (
        <View style={styles.posterPlaceholder}>
          <Text style={styles.posterIcon}>{item.type === 'series' ? '📡' : '🎬'}</Text>
        </View>
      )}
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
        <Text style={styles.type}>{item.type === 'series' ? '📡 Serie' : '🎬 Película'}</Text>
        <Text style={styles.date}>
          Guardada el {new Date(item.addedAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
        </Text>
      </View>
      <TouchableOpacity onPress={() => removeItem(item)} style={styles.removeBtn}>
        <Text style={styles.removeText}>✕</Text>
      </TouchableOpacity>
    </FocusableButton>
  ), [openItem]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <FocusableButton onPress={() => safeBack(navigation, 'MainTabs')} style={styles.backBtn}>
          <Text style={styles.backText}>← Volver</Text>
        </FocusableButton>
        <Text style={styles.title}>🔖 Ver después</Text>
        <Text style={styles.count}>{watchlist.length}</Text>
      </View>

      <FlatList
        data={watchlist}
        renderItem={renderItem}
        keyExtractor={(item, i) => `wl-${item.id || i}`}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🔖</Text>
            <Text style={styles.emptyTitle}>Tu lista Ver después está vacía</Text>
            <Text style={styles.emptyText}>
              Toca el botón + Ver después en cualquier película o serie para guardarla aquí.
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: layout.horizontalPadding, paddingTop: isTV ? 16 : 8, paddingBottom: 14 },
  backBtn: { padding: 8, borderWidth: 1, borderColor: 'transparent', borderRadius: 8 },
  backText: { color: colors.accent, fontSize: isTV ? 17 : 14 },
  title: { color: colors.white, fontSize: isTV ? 24 : 18, fontWeight: 'bold' },
  count: { color: colors.textSecondary, fontSize: isTV ? 15 : 12 },
  list: { paddingHorizontal: layout.horizontalPadding, paddingBottom: 30, gap: 10 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 14, overflow: 'hidden', borderWidth: 2, borderColor: '#2a2a3a' },
  cardFocused: { borderColor: colors.accent },
  poster: { width: isTV ? 100 : 72, height: isTV ? 140 : 104 },
  posterPlaceholder: { width: isTV ? 100 : 72, height: isTV ? 140 : 104, backgroundColor: '#0f0f14', justifyContent: 'center', alignItems: 'center' },
  posterIcon: { fontSize: isTV ? 36 : 28 },
  info: { flex: 1, padding: isTV ? 16 : 12, gap: 4 },
  name: { color: colors.white, fontSize: isTV ? 17 : 14, fontWeight: '600' },
  type: { color: colors.textSecondary, fontSize: isTV ? 13 : 11 },
  date: { color: '#555', fontSize: isTV ? 12 : 10, marginTop: 4 },
  removeBtn: { padding: 16 },
  removeText: { color: '#ff7777', fontSize: isTV ? 20 : 16 },
  empty: { flex: 1, alignItems: 'center', paddingTop: 80, gap: 12, paddingHorizontal: 30 },
  emptyIcon: { fontSize: 52 },
  emptyTitle: { color: colors.white, fontSize: isTV ? 22 : 18, fontWeight: 'bold', textAlign: 'center' },
  emptyText: { color: colors.textSecondary, fontSize: isTV ? 15 : 13, textAlign: 'center', lineHeight: 22 },
});
