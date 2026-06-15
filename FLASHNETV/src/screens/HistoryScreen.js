/**
 * HistoryScreen — Historial completo de reproducción
 * Muestra todo el contenido visto, filtrable por tipo y fecha.
 */
import React, { useState, useMemo } from 'react';
import {
  View, Text, FlatList, StyleSheet, Image, TouchableOpacity, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLibrary } from '../context/LibraryContext';
import { colors } from '../theme';
import FocusableButton from '../components/FocusableButton';
import { safeBack, useSafeHardwareBack } from '../utils/navigation';
import { isTV, layout } from '../utils/tv';

const TYPE_FILTERS = [
  { key: 'all',    label: '✦ Todo' },
  { key: 'movie',  label: '🎬 Películas' },
  { key: 'series', label: '📡 Series' },
  { key: 'live',   label: '📺 En vivo' },
];

const formatDate = (iso) => {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const today = new Date();
    const diff = Math.floor((today - d) / 86400000);
    if (diff === 0) return 'Hoy';
    if (diff === 1) return 'Ayer';
    if (diff < 7)  return `Hace ${diff} días`;
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
  } catch (_) { return ''; }
};

const formatDuration = (secs) => {
  if (!secs || secs < 60) return '';
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

export default function HistoryScreen({ navigation }) {
  useSafeHardwareBack(navigation, 'Home');
  const { watchStats } = useLibrary();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    let pool = watchStats || [];
    if (filter !== 'all') pool = pool.filter(i => i.type === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      pool = pool.filter(i => (i.name || '').toLowerCase().includes(q));
    }
    return pool;
  }, [watchStats, filter, search]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <FocusableButton onPress={() => safeBack(navigation, 'Home')} style={styles.backBtn}>
          <Text style={styles.backText}>← Volver</Text>
        </FocusableButton>
        <Text style={styles.title}>🕐 Historial</Text>
        <Text style={styles.count}>{filtered.length}</Text>
      </View>

      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar en historial..."
          placeholderTextColor="#444"
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <FlatList
        data={TYPE_FILTERS}
        horizontal showsHorizontalScrollIndicator={false}
        keyExtractor={i => i.key}
        style={styles.filterList}
        contentContainerStyle={styles.filterContent}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.filterBtn, filter === item.key && styles.filterBtnActive]}
            onPress={() => setFilter(item.key)}
          >
            <Text style={[styles.filterText, filter === item.key && styles.filterTextActive]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        )}
      />

      <FlatList
        data={filtered}
        keyExtractor={(item, i) => `hist-${i}`}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🕐</Text>
            <Text style={styles.emptyText}>Sin historial todavía</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            {item.poster ? (
              <Image source={{ uri: item.poster }} style={styles.poster} resizeMode="cover" />
            ) : (
              <View style={[styles.poster, styles.posterFallback]}>
                <Text style={{ fontSize: 22 }}>
                  {item.type === 'series' ? '📡' : item.type === 'live' ? '📺' : '🎬'}
                </Text>
              </View>
            )}
            <View style={styles.info}>
              <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
              <Text style={styles.meta}>
                {formatDate(item.watchedAt)}
                {item.seconds > 0 ? `  ·  ${formatDuration(item.seconds)}` : ''}
              </Text>
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: layout.horizontalPadding, paddingTop: isTV ? 16 : 8, paddingBottom: 12 },
  backBtn: { padding: 8, borderWidth: 1, borderColor: 'transparent', borderRadius: 8 },
  backText: { color: colors.accent, fontSize: isTV ? 17 : 14 },
  title: { color: colors.white, fontSize: isTV ? 24 : 18, fontWeight: 'bold' },
  count: { color: colors.textSecondary, fontSize: 12 },
  searchRow: { marginHorizontal: layout.horizontalPadding, marginBottom: 10, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: '#2a2a3a' },
  searchInput: { color: colors.white, padding: 12, fontSize: 14 },
  filterList: { flexGrow: 0, height: 48, marginBottom: 8 },
  filterContent: { paddingHorizontal: layout.horizontalPadding, gap: 8, paddingVertical: 4 },
  filterBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.card, borderWidth: 1, borderColor: '#2a2a3a' },
  filterBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterText: { color: colors.textSecondary, fontSize: 12 },
  filterTextActive: { color: '#fff', fontWeight: '700' },
  list: { paddingHorizontal: layout.horizontalPadding, paddingBottom: 30, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, overflow: 'hidden', gap: 12, borderWidth: 1, borderColor: '#2a2a3a' },
  poster: { width: 60, height: 44 },
  posterFallback: { backgroundColor: '#0f0f14', justifyContent: 'center', alignItems: 'center' },
  info: { flex: 1, paddingVertical: 10, paddingRight: 12 },
  name: { color: colors.white, fontSize: isTV ? 16 : 13, fontWeight: '600' },
  meta: { color: colors.textSecondary, fontSize: isTV ? 12 : 10, marginTop: 3 },
  empty: { flex: 1, alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyIcon: { fontSize: 48 },
  emptyText: { color: colors.textSecondary, fontSize: 16 },
});
