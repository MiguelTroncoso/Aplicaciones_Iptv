/**
 * SearchScreen — Búsqueda global con historial
 * Busca simultáneamente en canales en vivo, películas y series.
 * Guarda las últimas 10 búsquedas en AsyncStorage.
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, FlatList, StyleSheet,
  TouchableOpacity, Image, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../context/AuthContext';
import { getLiveStreams, getVodStreams, getSeries } from '../services/xtream';
import { getCache } from '../services/contentCache';
import { colors } from '../theme';
import FocusableButton from '../components/FocusableButton';
import { isTV, layout } from '../utils/tv';
import logger from '../utils/logger';
import { safeBack, useSafeHardwareBack } from '../utils/navigation';

const HISTORY_KEY = 'flashnetv_search_history';
const MAX_HISTORY = 10;

export default function SearchScreen({ route, navigation }) {
  useSafeHardwareBack(navigation, 'Home');
  const { user, server } = useAuth();
  const [query, setQuery]         = useState('');
  const [results, setResults]     = useState({ live: [], movies: [], series: [] });
  const [loading, setLoading]     = useState(false);
  const [history, setHistory]     = useState([]);
  const [searched, setSearched]   = useState(false);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);
  const appliedInitialQueryRef = useRef(null);

  useEffect(() => {
    loadHistory();
    if (!isTV) setTimeout(() => inputRef.current?.focus(), 300);
  }, []);

  const loadHistory = async () => {
    try {
      const raw = await AsyncStorage.getItem(HISTORY_KEY);
      if (raw) setHistory(JSON.parse(raw));
    } catch (_) {}
  };

  const saveToHistory = async (q) => {
    if (!q.trim()) return;
    try {
      const updated = [q.trim(), ...(history.filter(h => h !== q.trim()))].slice(0, MAX_HISTORY);
      setHistory(updated);
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
    } catch (_) {}
  };

  const clearHistory = async () => {
    setHistory([]);
    await AsyncStorage.removeItem(HISTORY_KEY);
  };

  // Busca en caché primero, luego en servidor si hace falta
  const searchAll = useCallback(async (q) => {
    const clean = q.trim().toLowerCase();
    if (!clean || clean.length < 2) {
      setResults({ live: [], movies: [], series: [] });
      setSearched(false);
      return;
    }

    setLoading(true);
    setSearched(true);

    const filter = (items) =>
      (items || []).filter(i =>
        (i.name || i.title || '').toLowerCase().includes(clean)
      ).slice(0, 20);

    try {
      // Intentar desde caché primero (más rápido)
      const [liveCache, moviesCache, seriesCache] = await Promise.all([
        getCache(server.url, user.username, 'home_live'),
        getCache(server.url, user.username, 'movies', 'all'),
        getCache(server.url, user.username, 'series', 'all'),
      ]);

      const liveResults   = filter(liveCache?.data);
      const movieResults  = filter(moviesCache?.data);
      const seriesResults = filter(seriesCache?.data);

      setResults({ live: liveResults, movies: movieResults, series: seriesResults });

      // Si algún caché estaba vacío, buscar en servidor
      const fetches = [];
      if (!liveCache?.data)   fetches.push(getLiveStreams(server.url, user.username, user.password).then(d => ({ live: filter(d) })));
      if (!moviesCache?.data) fetches.push(getVodStreams(server.url, user.username, user.password).then(d => ({ movies: filter(d) })));
      if (!seriesCache?.data) fetches.push(getSeries(server.url, user.username, user.password).then(d => ({ series: filter(d) })));

      if (fetches.length > 0) {
        const fresh = await Promise.allSettled(fetches);
        const merged = { ...{ live: liveResults, movies: movieResults, series: seriesResults } };
        fresh.forEach(r => {
          if (r.status === 'fulfilled') Object.assign(merged, r.value);
        });
        setResults(merged);
      }
    } catch (e) {
      logger.log('Search error:', e);
    } finally {
      setLoading(false);
    }
  }, [user, server]);

  const handleChangeText = (text) => {
    setQuery(text);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchAll(text), 400);
  };

  const handleSubmit = () => {
    if (query.trim()) {
      saveToHistory(query.trim());
      searchAll(query.trim());
    }
  };

  const handleHistoryItem = (item) => {
    setQuery(item);
    saveToHistory(item);
    searchAll(item);
  };

  useEffect(() => {
    const initialQuery = route?.params?.initialQuery;
    if (initialQuery && appliedInitialQueryRef.current !== initialQuery) {
      appliedInitialQueryRef.current = initialQuery;
      setQuery(initialQuery);
      searchAll(initialQuery);
    }
  }, [route?.params?.initialQuery, searchAll]);

  const totalResults = results.live.length + results.movies.length + results.series.length;

  const renderResult = useCallback(({ item, type }) => {
    const image = item.stream_icon || item.cover || item.poster;
    const name  = item.name || item.title || '';
    const isLive = type === 'live';
    return (
      <FocusableButton
        style={styles.resultRow}
        focusedStyle={styles.resultRowFocused}
        onPress={() => {
          saveToHistory(query || name);
          if (type === 'series') {
            navigation.navigate('SeriesDetail', {
              serie: item,
              returnRoute: 'Search',
              returnParams: { initialQuery: query || name },
            });
          } else if (type === 'movie') {
            navigation.navigate('MovieDetail', {
              stream: item,
              type: 'movie',
              returnRoute: 'Search',
              returnParams: { initialQuery: query || name },
            });
          } else navigation.navigate('Player', { stream: item, type: 'live', returnRoute: 'Search', returnParams: { initialQuery: query || name } });
        }}
      >
        {image ? (
          <Image source={{ uri: image }} style={styles.thumb} resizeMode="cover" />
        ) : (
          <View style={styles.thumbPlaceholder}>
            <Text style={styles.thumbIcon}>{isLive ? '📺' : type === 'series' ? '📡' : '🎬'}</Text>
          </View>
        )}
        <View style={styles.resultInfo}>
          <Text style={styles.resultName} numberOfLines={2}>{name}</Text>
          <View style={[styles.typeBadge, { backgroundColor: isLive ? '#ff3b3b22' : type === 'series' ? '#7b61ff22' : '#32c5ff22' }]}>
            <Text style={[styles.typeText, { color: isLive ? '#ff5555' : type === 'series' ? '#7b61ff' : colors.accent }]}>
              {isLive ? '● EN VIVO' : type === 'series' ? 'SERIE' : 'PELÍCULA'}
            </Text>
          </View>
          {item.rating && item.rating !== '0' && (
            <Text style={styles.rating}>⭐ {parseFloat(item.rating).toFixed(1)}</Text>
          )}
        </View>
        <Text style={styles.arrowIcon}>›</Text>
      </FocusableButton>
    );
  }, [query, navigation]);

  const allResults = [
    ...results.live.map(i => ({ ...i, _type: 'live' })),
    ...results.movies.map(i => ({ ...i, _type: 'movie' })),
    ...results.series.map(i => ({ ...i, _type: 'series' })),
  ];

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <FocusableButton onPress={() => safeBack(navigation, 'Home')} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </FocusableButton>
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            ref={inputRef}
            style={styles.searchInput}
            placeholder="Buscar películas, series, canales..."
            placeholderTextColor="#444"
            value={query}
            onChangeText={handleChangeText}
            onSubmitEditing={handleSubmit}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => { setQuery(''); setResults({ live:[], movies:[], series:[] }); setSearched(false); }}>
              <Text style={styles.clearBtn}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Historial */}
      {!searched && history.length > 0 && (
        <View style={styles.historySection}>
          <View style={styles.historyHeader}>
            <Text style={styles.sectionTitle}>Búsquedas recientes</Text>
            <TouchableOpacity onPress={clearHistory}>
              <Text style={styles.clearHistoryText}>Borrar</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={history}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item, i) => `h-${i}`}
            contentContainerStyle={styles.historyList}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.historyChip} onPress={() => handleHistoryItem(item)}>
                <Text style={styles.historyText}>🕐 {item}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}

      {/* Estado de carga */}
      {loading && (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colors.accent} size="small" />
          <Text style={styles.loadingText}>Buscando...</Text>
        </View>
      )}

      {/* Resultados */}
      {searched && !loading && totalResults === 0 && (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>🔍</Text>
          <Text style={styles.emptyText}>Sin resultados para "{query}"</Text>
          <Text style={styles.emptySubText}>Intenta con otro término</Text>
        </View>
      )}

      {totalResults > 0 && (
        <>
          <View style={styles.resultsHeader}>
            <Text style={styles.sectionTitle}>{totalResults} resultado{totalResults !== 1 ? 's' : ''}</Text>
            <Text style={styles.resultsBreakdown}>
              {results.live.length > 0 ? `${results.live.length} canales  ` : ''}
              {results.movies.length > 0 ? `${results.movies.length} películas  ` : ''}
              {results.series.length > 0 ? `${results.series.length} series` : ''}
            </Text>
          </View>
          <FlatList
            data={allResults}
            keyExtractor={(item, i) => `r-${item.stream_id || item.series_id || i}`}
            renderItem={({ item }) => renderResult({ item, type: item._type })}
            contentContainerStyle={styles.resultsList}
            showsVerticalScrollIndicator={false}
            initialNumToRender={12}
          />
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: layout.horizontalPadding, paddingVertical: 12, gap: 10 },
  backBtn: { padding: 8 },
  backText: { color: colors.accent, fontSize: isTV ? 26 : 20, fontWeight: 'bold' },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 14, paddingHorizontal: 12, borderWidth: 1, borderColor: '#2a2a3a', gap: 8 },
  searchIcon: { fontSize: 16 },
  searchInput: { flex: 1, color: colors.white, fontSize: isTV ? 18 : 15, paddingVertical: isTV ? 14 : 12 },
  clearBtn: { color: colors.textSecondary, fontSize: 16, padding: 4 },

  historySection: { paddingHorizontal: layout.horizontalPadding, marginBottom: 8 },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sectionTitle: { color: colors.white, fontSize: isTV ? 17 : 14, fontWeight: 'bold' },
  clearHistoryText: { color: colors.accent, fontSize: isTV ? 14 : 12 },
  historyList: { gap: 8, paddingBottom: 4 },
  historyChip: { backgroundColor: colors.card, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: '#2a2a3a' },
  historyText: { color: colors.textSecondary, fontSize: isTV ? 14 : 12 },

  loadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16 },
  loadingText: { color: colors.textSecondary, fontSize: 13 },

  resultsHeader: { paddingHorizontal: layout.horizontalPadding, marginBottom: 10, gap: 2 },
  resultsBreakdown: { color: colors.textSecondary, fontSize: isTV ? 13 : 11 },
  resultsList: { paddingHorizontal: layout.horizontalPadding, paddingBottom: 30, gap: 8 },

  resultRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, padding: 10, gap: 12, borderWidth: 2, borderColor: '#2a2a3a' },
  resultRowFocused: { borderColor: colors.accent },
  thumb: { width: isTV ? 80 : 60, height: isTV ? 56 : 42, borderRadius: 8, backgroundColor: '#0f0f14' },
  thumbPlaceholder: { width: isTV ? 80 : 60, height: isTV ? 56 : 42, borderRadius: 8, backgroundColor: '#0f0f14', justifyContent: 'center', alignItems: 'center' },
  thumbIcon: { fontSize: isTV ? 24 : 18 },
  resultInfo: { flex: 1, gap: 4 },
  resultName: { color: colors.white, fontSize: isTV ? 17 : 13, fontWeight: '600' },
  typeBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  typeText: { fontSize: isTV ? 11 : 9, fontWeight: '700', letterSpacing: 0.5 },
  rating: { color: '#FFD700', fontSize: isTV ? 12 : 10 },
  arrowIcon: { color: colors.textSecondary, fontSize: isTV ? 22 : 18 },

  emptyContainer: { flex: 1, alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyIcon: { fontSize: 48 },
  emptyText: { color: colors.white, fontSize: isTV ? 20 : 16, fontWeight: 'bold', textAlign: 'center' },
  emptySubText: { color: colors.textSecondary, fontSize: isTV ? 15 : 13 },
});
