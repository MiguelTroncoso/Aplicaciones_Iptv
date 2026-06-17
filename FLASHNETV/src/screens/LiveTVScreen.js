import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, TextInput, Image } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { useLibrary } from '../context/LibraryContext';
import { getLiveCategories, getLiveStreams, getShortEPG } from '../services/xtream';
import { deriveCategoriesFromItems, getCache, mergeCategories, saveCache, withCategoryNames } from '../services/contentCache';
import { colors, shadows } from '../theme';
import FocusableButton from '../components/FocusableButton';
import TVTopNav from '../components/TVTopNav';
import { isTV, layout } from '../utils/tv';
import logger from '../utils/logger';
import { safeBack, useFilterAwareHardwareBack } from '../utils/navigation';
import { cleanCategoryName, compactCategoryName } from '../utils/labels';

const PRIORITY_LIVE_CATEGORY_GROUPS = [
  ['mundial 2026', 'world cup 2026', 'fifa world cup 2026', 'copa mundial 2026'],
  ['eventos exclusivos', 'exclusive events'],
  ['eventos', 'events'],
  ['deportes', 'sports'],
  ['futbol', 'football', 'soccer'],
];

const normalizeCategorySearch = (value = '') =>
  String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const getCategoryPriority = (category) => {
  const name = normalizeCategorySearch(category?.category_name || category?.name || '');
  const groupIndex = PRIORITY_LIVE_CATEGORY_GROUPS.findIndex(group =>
    group.some(term => name.includes(term))
  );
  return groupIndex === -1 ? PRIORITY_LIVE_CATEGORY_GROUPS.length : groupIndex;
};

const sortLiveCategories = (items = []) =>
  [...items].sort((a, b) => {
    const priorityDiff = getCategoryPriority(a) - getCategoryPriority(b);
    if (priorityDiff !== 0) return priorityDiff;
    return String(a?.category_name || '').localeCompare(String(b?.category_name || ''), 'es', { sensitivity: 'base' });
  });

const getPreferredLiveCategoryId = (items = [], channels = []) => {
  const preferred = items.find(item =>
    channels.some(channel => String(channel.category_id) === String(item?.category_id))
  );
  return preferred?.category_id ?? null;
};

const filterChannelsByCategory = (items = [], categoryId = null) => {
  if (categoryId === null || categoryId === undefined) return items;
  return items.filter(channel => String(channel.category_id) === String(categoryId));
};

export default function LiveTVScreen({ navigation }) {
  const { user, server } = useAuth();
  const { isFavorite, toggleFavorite } = useLibrary();
  const [categories, setCategories] = useState([]);
  const [channels, setChannels] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [epg, setEpg] = useState([]);
  const [epgLoading, setEpgLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [usingCache, setUsingCache] = useState(false);
  const [pinnedIds, setPinnedIds]     = useState([]);

  const clearFilters = useCallback(() => {
    setSearch('');
    setSelectedCategory(null);
    setFiltered(channels);
  }, [channels]);
  const hasActiveFilter = Boolean(search.trim() || selectedCategory !== null);
  const handleBackPress = useCallback(() => {
    if (hasActiveFilter) {
      clearFilters();
      return;
    }
    safeBack(navigation, 'Home');
  }, [clearFilters, hasActiveFilter, navigation]);

  useFilterAwareHardwareBack(navigation, hasActiveFilter, clearFilters, 'Home');

  useEffect(() => { loadData(); }, []);

  const sanitize = (items = [], cats = categories) => {
    return withCategoryNames(items, cats);
  };

  const applyLiveChannelState = (items = [], cats = [], preferredCategoryId) => {
    const sortedCats = sortLiveCategories(cats);
    const data = sanitize(items, sortedCats);
    const nextSelectedCategory = preferredCategoryId !== undefined
      ? preferredCategoryId
      : getPreferredLiveCategoryId(sortedCats, data);

    setCategories(sortedCats);
    setChannels(data);
    setSelectedCategory(nextSelectedCategory);
    setFiltered(filterChannelsByCategory(data, nextSelectedCategory));
    return data;
  };

  const loadData = async () => {
    try {
      setLoading(true);

      // Mostrar caché mientras actualiza en segundo plano
      const cached = await getCache(server.url, user.username, 'live', 'all');
      let cachedData = null;
      let knownCategories = [];
      if (cached?.data?.length) {
        cachedData = cached.data;
        knownCategories = deriveCategoriesFromItems(cachedData);
        const data = applyLiveChannelState(cachedData, knownCategories);
        setUsingCache(true);
        setLoading(false);
        if (cached.isFresh) {
          getLiveCategories(server.url, user.username, user.password)
            .then((cats) => {
              const mergedCats = mergeCategories(cats, knownCategories);
              if (!mergedCats.length) return;
              applyLiveChannelState(cachedData, mergedCats);
            })
            .catch(() => {});
          return;
        }
      }

      // Cargar categorías y canales en paralelo (antes era en serie)
      const [catsResult, streamsResult] = await Promise.allSettled([
        getLiveCategories(server.url, user.username, user.password),
        getLiveStreams(server.url, user.username, user.password),
      ]);

      const cats = catsResult.status === 'fulfilled' && Array.isArray(catsResult.value) ? catsResult.value : [];
      const all = streamsResult.status === 'fulfilled' && Array.isArray(streamsResult.value)
        ? streamsResult.value
        : (cachedData || []);

      const mergedCats = mergeCategories(cats, deriveCategoriesFromItems(all));
      const data = applyLiveChannelState(all, mergedCats);

      setUsingCache(Boolean(cachedData && !(streamsResult.status === 'fulfilled' && streamsResult.value?.length)));
      if (data.length) await saveCache(server.url, user.username, 'live', 'all', data);
    } catch (e) {
      logger.log('Error cargando canales:', e);
    } finally {
      setLoading(false);
    }
  };

  const filterByCategory = (catId) => {
    setSelectedCategory(catId);
    setSearch('');
    setFiltered(filterChannelsByCategory(channels, catId));
  };

  const filterBySearch = (text) => {
    setSearch(text);
    setSelectedCategory(null);
    if (!text) setFiltered(channels);
    else {
      const q = text.toLowerCase();
      setFiltered(channels.filter(c => (c.name || '').toLowerCase().includes(q)));
    }
  };

  useEffect(() => {
    AsyncStorage.getItem('flashnetv_pinned_channels')
      .then(raw => { if (raw) setPinnedIds(JSON.parse(raw)); })
      .catch(() => {});
  }, []);

  const togglePin = async (channel) => {
    const id = String(channel.stream_id || channel.name);
    const next = pinnedIds.includes(id)
      ? pinnedIds.filter(i => i !== id)
      : [id, ...pinnedIds].slice(0, 30);
    setPinnedIds(next);
    await AsyncStorage.setItem('flashnetv_pinned_channels', JSON.stringify(next)).catch(() => {});
  };

  const isPinned = (ch) => pinnedIds.includes(String(ch.stream_id || ch.name));

  const sortedChannels = useMemo(() => {
    const pinned = filtered.filter(c => isPinned(c));
    const rest   = filtered.filter(c => !isPinned(c));
    return [...pinned, ...rest];
  }, [filtered, pinnedIds]);

  const listHeader = (
    <View>
      <TVTopNav navigation={navigation} current="LiveTV" />
      <View style={styles.header}>
        <FocusableButton onPress={handleBackPress} style={styles.backBtn}><Text style={styles.backText}>← Volver</Text></FocusableButton>
        <Text style={styles.title}>TV en vivo</Text>
        <FocusableButton onPress={() => navigation.navigate('EPG')} style={styles.epgBtn}><Text style={styles.epgBtnText}>📅 EPG</Text></FocusableButton>
      </View>

      <View style={styles.searchWrapper}>
        <TextInput style={styles.searchInput} placeholder="Buscar canal..." placeholderTextColor="#444" value={search} onChangeText={filterBySearch} />
      </View>

      <FlatList
        data={[{ category_id: null, category_name: 'Todos' }, ...categories]}
        renderItem={renderCategory}
        keyExtractor={(item, index) => index.toString()}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.catList}
        contentContainerStyle={styles.catContent}
      />
    </View>
  );

  function renderCategory({ item, index }) {
    const count = !item.category_id
      ? channels.length
      : channels.filter(c => String(c.category_id) === String(item.category_id)).length;
    const label = item.category_id
      ? compactCategoryName(item.category_name, isTV ? 30 : 18)
      : cleanCategoryName(item.category_name || 'Todos');
    return (
      <FocusableButton style={[styles.catBtn, selectedCategory === item.category_id && styles.catBtnActive]} onPress={() => filterByCategory(item.category_id)} hasTVPreferredFocus={isTV && selectedCategory === item.category_id}>
        <Text numberOfLines={1} style={[styles.catText, selectedCategory === item.category_id && styles.catTextActive]}>
          {label} <Text style={{ opacity: 0.55 }}>({count})</Text>
        </Text>
      </FocusableButton>
    );
  }

  const renderChannel = ({ item }) => {
    const fav    = isFavorite(item, 'live');
    const pinned = isPinned(item);
    return (
      <FocusableButton style={styles.channelRow}
        onPress={() => { navigation.navigate('Player', { stream: item, type: 'live', returnRoute: 'LiveTV' }); }}
        onLongPress={() => { togglePin(item); }}
      >
        {item.stream_icon ? <Image source={{ uri: item.stream_icon }} style={styles.channelLogo} resizeMode="contain" /> : (
          <View style={styles.channelLogoPlaceholder}><Text style={styles.channelLogoText}>{item.name?.charAt(0)}</Text></View>
        )}
        <View style={styles.channelInfo}>
          <Text style={styles.channelName} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.channelCat} numberOfLines={1}>{cleanCategoryName(item.category_name || 'Sin categoría')}</Text>
        </View>
        <FocusableButton style={styles.favoriteBtn} onPress={() => toggleFavorite(item, 'live')}>
          <Text style={styles.favoriteIcon}>{fav ? '★' : '☆'}</Text>
        </FocusableButton>
        <View style={styles.liveBadge}><Text style={styles.liveText}>EN VIVO</Text></View>
        {pinned && <Text style={styles.pinIcon}>📌</Text>}
      </FocusableButton>
    );
  };

  if (loading) return <View style={styles.loadingContainer}><ActivityIndicator color={colors.accent} size="large" /><Text style={styles.loadingText}>Cargando canales...</Text></View>;

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={sortedChannels}
        renderItem={renderChannel}
        keyExtractor={(item, index) => `${item.stream_id || item.name || ''}-${index}`}
        ListHeaderComponent={listHeader}
        contentContainerStyle={styles.channelList}
        showsVerticalScrollIndicator={false}
        initialNumToRender={isTV ? 18 : 12}
        maxToRenderPerBatch={isTV ? 24 : 14}
        windowSize={8}
        removeClippedSubviews={true}
      />
    </SafeAreaView>
  );
}

const logoSize = isTV ? 34 : 48;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loadingContainer: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', gap: 16 },
  loadingText: { color: colors.textSecondary, fontSize: isTV ? 16 : 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: layout.horizontalPadding, paddingTop: isTV ? 10 : 8, paddingBottom: isTV ? 10 : 18 },
  backBtn: { padding: isTV ? 5 : 8, borderWidth: 1, borderColor: 'transparent', borderRadius: 8 },
  backText: { color: colors.accent, fontSize: isTV ? 13 : 14 },
  title: { color: colors.white, fontSize: isTV ? 25 : 28, fontWeight: '900', letterSpacing: 0.4 },
  count: { color: colors.textSecondary, fontSize: isTV ? 15 : 12 },
  epgBtn: { paddingHorizontal: isTV ? 12 : 14, paddingVertical: isTV ? 7 : 9, borderRadius: 999, borderWidth: 1.5, borderColor: colors.accentWarm || colors.primary, backgroundColor: 'rgba(246,182,63,0.08)' },
  epgBtnText: { color: colors.accentWarm || colors.primary, fontSize: isTV ? 12 : 13, fontWeight: '900' },
  searchWrapper: { marginHorizontal: layout.horizontalPadding, marginBottom: isTV ? 8 : 14, backgroundColor: colors.surfaceElevated || colors.card, borderRadius: isTV ? 12 : 18, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.08)' },
  searchInput: { color: colors.white, padding: isTV ? 10 : 12, fontSize: isTV ? 13 : 14 },
  cacheText: { color: colors.accent, fontSize: isTV ? 13 : 11, textAlign: 'center', marginBottom: 8 },
  catList: { marginBottom: isTV ? 6 : 10, height: isTV ? 50 : 64, flexGrow: 0 },
  catContent: { paddingHorizontal: layout.horizontalPadding, paddingVertical: isTV ? 5 : 8, gap: isTV ? 6 : 8, alignItems: 'center' },
  catBtn: { minHeight: isTV ? 34 : 46, justifyContent: 'center', paddingHorizontal: isTV ? 10 : 14, paddingVertical: isTV ? 6 : 9, borderRadius: 999, backgroundColor: colors.surfaceElevated || colors.card, borderWidth: 2, borderColor: 'rgba(255,255,255,0.08)' },
  catBtnActive: { backgroundColor: colors.accentWarm || colors.primary, borderColor: colors.accentWarm || colors.primary },
  catText: { color: colors.white, fontSize: isTV ? 11 : 13, fontWeight: '900', zIndex: 2 },
  catTextActive: { color: '#111', fontWeight: '900', zIndex: 2 },
  channelList: { paddingHorizontal: layout.horizontalPadding, paddingVertical: isTV ? 8 : 16, gap: 10 },
  channelRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceElevated || colors.card, borderRadius: isTV ? 10 : 18, padding: isTV ? 8 : 14, borderWidth: 2, borderColor: 'rgba(255,255,255,0.08)', gap: isTV ? 10 : 12, marginBottom: isTV ? 8 : 12 },
  channelLogo: { width: logoSize, height: logoSize, borderRadius: 8, backgroundColor: '#0f0f14' },
  channelLogoPlaceholder: { width: logoSize, height: logoSize, borderRadius: 8, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' },
  channelLogoText: { color: colors.white, fontSize: isTV ? 15 : 20, fontWeight: 'bold' },
  channelInfo: { flex: 1 },
  channelName: { color: colors.white, fontSize: isTV ? 13 : 16, lineHeight: isTV ? 17 : 21, fontWeight: '900', marginBottom: 2 },
  channelCat: { color: colors.textSecondary, fontSize: isTV ? 10 : 12 },
  favoriteBtn: { width: isTV ? 28 : 34, height: isTV ? 28 : 34, borderRadius: isTV ? 14 : 22, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  favoriteIcon: { color: colors.accentWarm || '#FFD700', fontSize: isTV ? 16 : 20, fontWeight: 'bold' },
  liveBadge: { backgroundColor: '#ff3b3b22', borderRadius: 5, paddingHorizontal: isTV ? 6 : 8, paddingVertical: isTV ? 3 : 4, borderWidth: 1, borderColor: '#ff3b3b55' },
  liveText: { color: '#ff5555', fontSize: isTV ? 9 : 10, fontWeight: 'bold', letterSpacing: 0.5 },
  pinIcon: { color: colors.accentWarm || '#FFD700', fontSize: isTV ? 14 : 16 },
});
