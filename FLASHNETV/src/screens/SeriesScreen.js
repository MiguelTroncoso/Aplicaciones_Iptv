/**
 * SeriesScreen — filas horizontales por categoría (igual que Home y MoviesScreen)
 */
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator,
  TextInput, ScrollView, TouchableOpacity, FlatList, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { useLibrary } from '../context/LibraryContext';
import { getSeriesCategories, getSeries } from '../services/xtream';
import { deriveCategoriesFromItems, getCache, mergeCategories, saveCache, withCategoryNames } from '../services/contentCache';
import { colors } from '../theme';
import ContentRow from '../components/ContentRow';
import FocusableButton from '../components/FocusableButton';
import TVTopNav from '../components/TVTopNav';
import { isTV, isTablet, layout } from '../utils/tv';
import logger from '../utils/logger';
import { safeBack, useFilterAwareHardwareBack } from '../utils/navigation';
import { SORT_OPTIONS, sortContent } from '../utils/contentFilters';
import { cleanCategoryName, compactCategoryName, cleanContentTitle } from '../utils/labels';

const ROW_LIMIT = isTV ? 40 : 25;

export default function SeriesScreen({ navigation }) {
  const { user, server } = useAuth();
  const { isFavorite, toggleFavorite } = useLibrary();

  const [categories, setCategories]   = useState([]);
  const [allSeries, setAllSeries]     = useState([]);
  const [selectedCat, setSelectedCat] = useState(null);
  const [search, setSearch]           = useState('');
  const [loading, setLoading]         = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [usingCache, setUsingCache]   = useState(false);
  const [sortMode, setSortMode]     = useState('server');

  const clearFilters = useCallback(() => {
    setSearch('');
    setSelectedCat(null);
  }, []);
  const hasActiveFilter = Boolean(search.trim() || selectedCat !== null);
  const handleBackPress = useCallback(() => {
    if (hasActiveFilter) {
      clearFilters();
      return;
    }
    safeBack(navigation, 'Home');
  }, [clearFilters, hasActiveFilter, navigation]);

  useFilterAwareHardwareBack(navigation, hasActiveFilter, clearFilters, 'Home');

  useEffect(() => { load(); }, []);

  const sanitize = useCallback((items = [], cats = []) => {
    return withCategoryNames(items, cats);
  }, []);

  const load = async (force = false) => {
    try {
      setLoading(true);
      const [catsResult, cached] = await Promise.all([
        getSeriesCategories(server.url, user.username, user.password).catch(() => []),
        force ? Promise.resolve(null) : getCache(server.url, user.username, 'series', 'all'),
      ]);
      const cats = Array.isArray(catsResult) ? catsResult : [];
      let knownCategories = cats;

      if (cached?.data?.length) {
        knownCategories = mergeCategories(cats, deriveCategoriesFromItems(cached.data));
        setCategories(knownCategories);
        setAllSeries(sanitize(cached.data, knownCategories));
        setUsingCache(true);
        setLoading(false);
        if (cached.isFresh) return;
      }
      setCategories(knownCategories);

      setLoadingMore(true);
      const data = await getSeries(server.url, user.username, user.password, '').catch(() => []);
      if (!data.length && cached?.data?.length) {
        setUsingCache(true);
        return;
      }
      const finalCategories = mergeCategories(knownCategories, deriveCategoriesFromItems(data));
      const clean = sanitize(data, finalCategories);
      setCategories(finalCategories);
      if (clean.length) await saveCache(server.url, user.username, 'series', 'all', clean);
      setAllSeries(clean);
      setUsingCache(false);
    } catch (e) {
      logger.log('SeriesScreen error:', e);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const filteredSeries = useMemo(() => {
    let pool = allSeries;
    if (selectedCat) pool = pool.filter(s => String(s.category_id) === String(selectedCat));
    if (search.trim()) {
      const q = search.toLowerCase();
      pool = pool.filter(s => (s.name || '').toLowerCase().includes(q));
    }
    return sortContent(pool, sortMode);
  }, [allSeries, selectedCat, search, sortMode]);

  const categoryRows = useMemo(() => {
    if (selectedCat || search.trim()) return null;
    const map = new Map();
    for (const serie of sortContent(allSeries, sortMode)) {
      const catId   = String(serie.category_id || 'sin-cat');
      const catName = cleanCategoryName(serie.category_name || 'Otros');
      if (!map.has(catId)) map.set(catId, { id: catId, name: catName, items: [] });
      if (map.get(catId).items.length < ROW_LIMIT) map.get(catId).items.push(serie);
    }
    return Array.from(map.values()).filter(c => c.items.length > 0);
  }, [allSeries, selectedCat, search, sortMode]);

  const goToSerie = useCallback((item) => {
    navigation.navigate('SeriesDetail', { serie: item });
  }, [navigation]);

  // Fila por categoría (modo Home). Debe declararse ANTES de cualquier return
  // condicional para no romper el orden de hooks.
  const renderCategoryRow = useCallback(({ item: cat }) => (
    <ContentRow
      key={cat.id}
      title={cat.name}
      data={cat.items}
      type="series"
      showEstrenoBadge
      showFavoriteButton
      isFavorite={isFavorite}
      onFavoritePress={toggleFavorite}
      onSeeAll={() => setSelectedCat(cat.id)}
      onPress={goToSerie}
    />
  ), [goToSerie, isFavorite, toggleFavorite]);

  const renderCatTab = ({ item }) => {
    const active = selectedCat === item.category_id;
    return (
      <FocusableButton
        style={[styles.catBtn, active && styles.catBtnActive]}
        focusedStyle={styles.catBtnFocused}
        hasTVPreferredFocus={isTV && item.category_id === null}
        onPress={() => { setSelectedCat(active ? null : item.category_id); setSearch(''); }}
      >
        <Text style={[styles.catText, active && styles.catTextActive]} numberOfLines={1}>
          {item.category_id ? compactCategoryName(item.category_name, isTV ? 30 : 18) : item.category_name}
        </Text>
      </FocusableButton>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.loadingText}>Cargando series...</Text>
      </View>
    );
  }

  const showingRows = !selectedCat && !search.trim() && categoryRows;
  const showingSearch = !!search.trim();
  const showingCat = !!selectedCat && !search.trim();
  const gridColumns = isTV ? layout.gridColumns : isTablet ? 4 : 3;

  const libraryHeader = (
    <View>
      <TVTopNav navigation={navigation} current="Series" />
      <View style={styles.header}>
        <FocusableButton onPress={handleBackPress} style={styles.backBtn}>
          <Text style={styles.backText}>← Volver</Text>
        </FocusableButton>
        <Text style={styles.title}>Series</Text>
        <Text style={styles.count}>
          {showingRows ? `${allSeries.length} títulos` : `${filteredSeries.length} resultados`}
        </Text>
      </View>

      <View style={styles.searchWrapper}>
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar serie..."
          placeholderTextColor="#444"
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} style={styles.clearBtn}>
            <Text style={styles.clearText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {loadingMore && <Text style={styles.cacheText}>Actualizando contenido...</Text>}

      <FlatList
        data={[{ category_id: null, category_name: '✦ Todas' }, ...categories]}
        renderItem={renderCatTab}
        keyExtractor={(item, i) => `cat-${item.category_id || 'all'}-${i}`}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.catList}
        contentContainerStyle={styles.catContent}
      />

      <FlatList
        data={SORT_OPTIONS}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => `sort-${item.key}`}
        style={styles.sortList}
        contentContainerStyle={styles.sortContent}
        renderItem={({ item }) => {
          const active = sortMode === item.key;
          return (
            <FocusableButton
              style={[styles.sortBtn, active && styles.sortBtnActive]}
              focusedStyle={styles.catBtnFocused}
              onPress={() => setSortMode(item.key)}
            >
              <Text style={[styles.sortText, active && styles.sortTextActive]}>{item.label}</Text>
            </FocusableButton>
          );
        }}
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      {showingRows ? (
        <FlatList
          data={categoryRows}
          keyExtractor={(item) => `row-${item.id}`}
          renderItem={renderCategoryRow}
          ListHeaderComponent={libraryHeader}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.rowsContent}
          initialNumToRender={isTV ? 4 : 3}
          maxToRenderPerBatch={isTV ? 4 : 3}
          windowSize={5}
          removeClippedSubviews={true}
        />
      ) : (
        <FlatList
          data={filteredSeries}
          keyExtractor={(item, i) => `sr-${item.series_id || item.num || i}`}
          numColumns={gridColumns}
          key={gridColumns}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.gridContent}
          showsVerticalScrollIndicator={false}
          initialNumToRender={15}
          maxToRenderPerBatch={20}
          windowSize={7}
          removeClippedSubviews={true}
          ListHeaderComponent={
            <>
              {libraryHeader}
              {showingCat ? (
                <View style={styles.catHeader}>
                  <Text style={styles.catHeaderText}>
                    {cleanCategoryName(categories.find(c => String(c.category_id) === String(selectedCat))?.category_name || '')}
                  </Text>
                  <TouchableOpacity onPress={() => setSelectedCat(null)}>
                    <Text style={styles.catHeaderClear}>✕ Quitar filtro</Text>
                  </TouchableOpacity>
                </View>
              ) : showingSearch ? (
                <Text style={styles.catHeaderText}>
                  {filteredSeries.length} resultado{filteredSeries.length !== 1 ? 's' : ''} para "{search}"
                </Text>
              ) : null}
            </>
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>📡</Text>
              <Text style={styles.emptyText}>No se encontraron series</Text>
            </View>
          }
          renderItem={({ item }) => {
            const fav = isFavorite(item, 'series');
            const ph  = isTV ? layout.posterHeight : isTablet ? 160 : 130;
            return (
              <FocusableButton
                style={styles.gridCard}
                focusedStyle={styles.gridCardFocused}
                onPress={() => goToSerie(item)}
                onLongPress={() => toggleFavorite(item, 'series')}
              >
                <View style={[styles.gridPosterWrap, { height: ph }]}>
                  {item.cover ? (
                    <Image source={{ uri: item.cover }} style={[styles.gridPosterImg, { height: ph }]} resizeMode="cover" />
                  ) : (
                    <View style={[styles.gridPosterImg, { height: ph, justifyContent: 'center', alignItems: 'center' }]}>
                      <Text style={{ fontSize: 28 }}>📡</Text>
                    </View>
                  )}
                  {item.rating && item.rating !== '0' && (
                    <View style={styles.ratingBadge}>
                      <Text style={styles.ratingText}>★ {parseFloat(item.rating).toFixed(1)}</Text>
                    </View>
                  )}
                  {(!isTV || fav) && <TouchableOpacity style={styles.favBtn} onPress={() => toggleFavorite(item, 'series')}>
                    <Text style={styles.favIcon}>{fav ? '★' : '☆'}</Text>
                  </TouchableOpacity>}
                </View>
                <Text style={styles.gridName} numberOfLines={3}>{cleanContentTitle(item.name)}</Text>
              </FocusableButton>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loadingContainer: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', gap: 16 },
  loadingText: { color: colors.textSecondary, fontSize: isTV ? 18 : 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: layout.horizontalPadding, paddingTop: isTV ? 16 : 8, paddingBottom: 14 },
  backBtn: { padding: 8, borderWidth: 1, borderColor: 'transparent', borderRadius: 8 },
  backText: { color: colors.accent, fontSize: isTV ? 17 : 14 },
  title: { color: colors.white, fontSize: isTV ? 28 : 28, fontWeight: '900', letterSpacing: 0.4 },
  count: { color: colors.accentWarm || colors.textSecondary, fontSize: isTV ? 15 : 13, fontWeight: '800' },
  searchWrapper: { marginHorizontal: layout.horizontalPadding, marginBottom: 10, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: '#2a2a3a', flexDirection: 'row', alignItems: 'center' },
  searchInput: { flex: 1, color: colors.white, padding: isTV ? 12 : 12, fontSize: isTV ? 15 : 14 },
  clearBtn: { paddingHorizontal: 14 },
  clearText: { color: colors.textSecondary, fontSize: 16 },
  cacheText: { color: colors.accent, fontSize: isTV ? 13 : 10, textAlign: 'center', marginBottom: 6 },
  catList: { flexGrow: 0, height: isTV ? 62 : 64, marginBottom: 6 },
  catContent: { paddingHorizontal: layout.horizontalPadding, paddingVertical: 6, gap: isTV ? 8 : 10, alignItems: 'center' },
  catBtn: { minWidth: isTV ? 110 : 76, maxWidth: isTV ? 220 : 150, minHeight: isTV ? 42 : 40, justifyContent: 'center', paddingHorizontal: isTV ? 14 : 14, paddingVertical: isTV ? 8 : 9, borderRadius: 20, backgroundColor: colors.card, borderWidth: 2, borderColor: '#2a2a3a', alignItems: 'center' },
  catBtnActive: { backgroundColor: colors.accentWarm || colors.primary, borderColor: colors.accentWarm || colors.primary },
  catBtnFocused: { borderColor: colors.accentWarm || colors.accent, backgroundColor: 'rgba(246,182,63,0.18)' },
  catText: { color: colors.white, fontSize: isTV ? 13 : 13, fontWeight: '900', zIndex: 2 },
  catTextActive: { color: '#111', fontWeight: '900', zIndex: 2 },
  sortList: { flexGrow: 0, height: isTV ? 52 : 54, marginBottom: 8 },
  sortContent: { paddingHorizontal: layout.horizontalPadding, paddingVertical: 6, gap: isTV ? 8 : 8, alignItems: 'center' },
  sortBtn: { minHeight: isTV ? 34 : 34, justifyContent: 'center', paddingHorizontal: isTV ? 12 : 12, paddingVertical: isTV ? 6 : 7, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1.5, borderColor: '#2a2a3a' },
  sortBtnActive: { backgroundColor: 'rgba(246,182,63,0.18)', borderColor: colors.accentWarm || colors.accent },
  sortText: { color: colors.white, fontSize: isTV ? 12 : 11, fontWeight: '800', zIndex: 2 },
  sortTextActive: { color: colors.white },
  catHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: layout.horizontalPadding, paddingVertical: 10 },
  catHeaderText: { color: colors.white, fontSize: isTV ? 20 : 15, fontWeight: 'bold' },
  catHeaderClear: { color: colors.accent, fontSize: isTV ? 14 : 12 },
  rowsContent: { paddingBottom: 40 },
  gridContent: { paddingHorizontal: layout.horizontalPadding, paddingBottom: 40 },
  gridRow: { gap: isTV ? layout.cardGap : 12, marginBottom: isTV ? 16 : 18, justifyContent: isTV ? 'space-between' : 'flex-start' },
  gridCard: { width: isTV ? layout.posterWidth : undefined, flex: isTV ? 0 : 1, borderWidth: 2, borderColor: 'transparent', borderRadius: 10, overflow: 'visible' },
  gridCardFocused: { borderColor: colors.accentWarm || colors.accent, backgroundColor: 'rgba(246,182,63,0.08)' },
  gridPosterWrap: { borderRadius: 10, overflow: 'hidden', backgroundColor: colors.card, position: 'relative', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  gridPosterImg: { width: '100%', backgroundColor: colors.card },
  ratingBadge: { position: 'absolute', bottom: 6, left: 6, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 },
  ratingText: { color: '#FFD700', fontSize: isTV ? 11 : 9, fontWeight: '700' },
  favBtn: { position: 'absolute', top: 6, right: 6, width: isTV ? 26 : 26, height: isTV ? 26 : 26, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', alignItems: 'center' },
  favIcon: { color: '#FFD700', fontSize: isTV ? 15 : 14, fontWeight: 'bold' },
  gridName: { color: colors.white, fontSize: isTV ? 11 : 13, marginTop: 6, lineHeight: isTV ? 14 : 18, fontWeight: '700', minHeight: isTV ? 44 : 60, zIndex: 2 },


  emptyContainer: { flex: 1, alignItems: 'center', paddingTop: 80, gap: 12 },
  emptyIcon: { fontSize: 48 },
  emptyText: { color: colors.textSecondary, fontSize: isTV ? 18 : 14 },
});
