import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
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
import BrandLogo from '../components/BrandLogo';
import { isTV, layout } from '../utils/tv';
import logger from '../utils/logger';
import { safeBack, useFilterAwareHardwareBack } from '../utils/navigation';
import { cleanCategoryName, compactCategoryName } from '../utils/labels';
import { loadLastLiveChannel, mergeLastLiveChannel } from '../utils/liveHistory';

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
  const [mobileTab, setMobileTab] = useState('category');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [usingCache, setUsingCache] = useState(false);
  const [pinnedIds, setPinnedIds]     = useState([]);
  const autoplayAttemptedRef = useRef(false);

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

  useEffect(() => {
    if (isTV || loading || autoplayAttemptedRef.current || !channels.length) return;
    autoplayAttemptedRef.current = true;
    loadLastLiveChannel()
      .then((lastChannel) => {
        const target = mergeLastLiveChannel(lastChannel, channels);
        if (target) navigation.navigate('Player', { stream: target, type: 'live', returnRoute: 'LiveTV' });
      })
      .catch(() => {});
  }, [channels, loading, navigation]);

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
    setMobileTab('category');
    setSelectedCategory(catId);
    setSearch('');
    setFiltered(filterChannelsByCategory(channels, catId));
  };

  const showFavoritesOnly = () => {
    setMobileTab('favorites');
    setSelectedCategory(null);
    setSearch('');
    setFiltered(channels.filter(channel => isFavorite(channel, 'live')));
  };

  const filterBySearch = (text) => {
    setMobileTab('category');
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

  const previewChannel = selectedChannel || sortedChannels[0] || channels[0] || null;

  const listHeader = (
    <View>
      <TVTopNav navigation={navigation} current="LiveTV" />
      <View style={styles.header}>
        <FocusableButton onPress={handleBackPress} style={styles.backBtn}><Text style={styles.backText}>← Volver</Text></FocusableButton>
        <Text style={styles.title}>TV en vivo</Text>
        <FocusableButton onPress={() => navigation.navigate('EPG')} style={styles.epgBtn}><Text style={styles.epgBtnText}>📅 EPG</Text></FocusableButton>
      </View>

      {!isTV && (
        <>
          <View style={styles.mobileTopBar}>
            <BrandLogo variant="nav" style={styles.mobileLogo} />
            <FocusableButton style={styles.mobileSearchBtn} onPress={() => navigation.navigate('Search')}>
              <Text style={styles.mobileSearchText}>⌕</Text>
            </FocusableButton>
          </View>

          <FocusableButton
            style={styles.mobilePreview}
            onPress={() => {
              if (previewChannel) navigation.navigate('Player', { stream: previewChannel, type: 'live', returnRoute: 'LiveTV' });
            }}
          >
            {previewChannel?.stream_icon ? (
              <Image source={{ uri: previewChannel.stream_icon }} style={styles.mobilePreviewLogo} resizeMode="contain" />
            ) : (
              <Text style={styles.mobilePreviewFallback}>TV</Text>
            )}
            <View style={styles.mobilePreviewShade} />
            <Text style={styles.mobilePreviewName} numberOfLines={1}>{previewChannel?.name || 'TV en vivo'}</Text>
            <Text style={styles.mobilePreviewPlay}>▶</Text>
            <Text style={styles.mobilePreviewSound}>◔</Text>
            <Text style={styles.mobilePreviewExpand}>⛶</Text>
          </FocusableButton>

          <View style={styles.mobileModeTabs}>
            <FocusableButton style={[styles.mobileModeTab, mobileTab === 'category' && styles.mobileModeTabActive]} onPress={() => filterByCategory(selectedCategory)}>
              <Text style={[styles.mobileModeText, mobileTab === 'category' && styles.mobileModeTextActive]}>Categoria</Text>
            </FocusableButton>
            <FocusableButton style={[styles.mobileModeTab, mobileTab === 'favorites' && styles.mobileModeTabActive]} onPress={showFavoritesOnly}>
              <Text style={[styles.mobileModeText, mobileTab === 'favorites' && styles.mobileModeTextActive]}>Favoritos</Text>
            </FocusableButton>
          </View>
        </>
      )}

      <View style={styles.searchWrapper}>
        <TextInput style={styles.searchInput} placeholder="Buscar canal..." placeholderTextColor="#444" value={search} onChangeText={filterBySearch} />
      </View>

      <FlatList
        data={[{ category_id: null, category_name: isTV ? 'Todos' : 'ChannelList' }, ...categories]}
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
      <FocusableButton style={[styles.catBtn, selectedCategory === item.category_id && styles.catBtnActive]} onPress={() => filterByCategory(item.category_id)} hasTVPreferredFocus={false}>
        <Text numberOfLines={1} style={[styles.catText, selectedCategory === item.category_id && styles.catTextActive]}>
          {label} <Text style={{ opacity: 0.55 }}>({count})</Text>
        </Text>
      </FocusableButton>
    );
  }

  const renderChannel = ({ item, index }) => {
    const fav    = isFavorite(item, 'live');
    const pinned = isPinned(item);
    if (!isTV) {
      return (
        <FocusableButton
          style={styles.mobileChannelRow}
          onPress={() => { navigation.navigate('Player', { stream: item, type: 'live', returnRoute: 'LiveTV' }); }}
          onLongPress={() => toggleFavorite(item, 'live')}
          onFocus={() => setSelectedChannel(item)}
        >
          {item.stream_icon ? (
            <Image source={{ uri: item.stream_icon }} style={styles.mobileChannelLogo} resizeMode="contain" />
          ) : (
            <View style={styles.mobileChannelLogoFallback}>
              <Text style={styles.mobileChannelLogoText}>{item.name?.charAt(0)}</Text>
            </View>
          )}
          <View style={styles.mobileChannelInfo}>
            <Text style={[styles.mobileChannelName, index === 0 && styles.mobileChannelNameActive]} numberOfLines={1}>
              {item.num || index + 1}  {item.name}
            </Text>
            <Text style={styles.mobileChannelMeta} numberOfLines={1}>
              {fav ? 'Favorito' : 'Recibiendo la programacion'}
            </Text>
          </View>
          <Text style={styles.mobileChannelArrow}>›</Text>
        </FocusableButton>
      );
    }
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
  container: { flex: 1, backgroundColor: isTV ? colors.background : '#171720' },
  loadingContainer: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', gap: 16 },
  loadingText: { color: colors.textSecondary, fontSize: isTV ? 16 : 14 },
  header: isTV
    ? { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: layout.horizontalPadding, paddingTop: 10, paddingBottom: 10 }
    : { display: 'none' },
  backBtn: { padding: isTV ? 5 : 8, borderWidth: 1, borderColor: 'transparent', borderRadius: 8 },
  backText: { color: colors.accent, fontSize: isTV ? 13 : 14 },
  title: { color: colors.white, fontSize: isTV ? 25 : 28, fontWeight: '900', letterSpacing: 0.4 },
  count: { color: colors.textSecondary, fontSize: isTV ? 15 : 12 },
  epgBtn: { paddingHorizontal: isTV ? 12 : 14, paddingVertical: isTV ? 7 : 9, borderRadius: 999, borderWidth: 1.5, borderColor: colors.accentWarm || colors.primary, backgroundColor: 'rgba(246,182,63,0.08)' },
  epgBtnText: { color: colors.accentWarm || colors.primary, fontSize: isTV ? 12 : 13, fontWeight: '900' },
  mobileTopBar: {
    height: 64,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1b1b24',
  },
  mobileLogo: { maxWidth: 120 },
  mobileSearchBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  mobileSearchText: { color: colors.white, fontSize: 38, fontWeight: '300' },
  mobilePreview: {
    height: 322,
    backgroundColor: '#101019',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  mobilePreviewLogo: { width: '64%', height: '54%', opacity: 0.62 },
  mobilePreviewFallback: { color: colors.white, fontSize: 72, fontWeight: '900', opacity: 0.18 },
  mobilePreviewShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.28)' },
  mobilePreviewName: {
    position: 'absolute',
    top: 18,
    right: 18,
    left: 130,
    color: 'rgba(255,255,255,0.32)',
    fontSize: 12,
    textAlign: 'right',
  },
  mobilePreviewPlay: { position: 'absolute', alignSelf: 'center', color: colors.white, fontSize: 62, opacity: 0.92 },
  mobilePreviewSound: { position: 'absolute', left: 22, bottom: 24, color: colors.white, fontSize: 36 },
  mobilePreviewExpand: { position: 'absolute', right: 22, bottom: 24, color: colors.white, fontSize: 30 },
  mobileModeTabs: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#171720',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  mobileModeTab: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center' },
  mobileModeTabActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
  mobileModeText: { color: colors.white, fontSize: 24, fontWeight: '400' },
  mobileModeTextActive: { color: colors.primary },
  searchWrapper: isTV
    ? { marginHorizontal: layout.horizontalPadding, marginBottom: 8, backgroundColor: colors.surfaceElevated || colors.card, borderRadius: 12, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.08)' }
    : { display: 'none' },
  searchInput: { color: colors.white, padding: isTV ? 10 : 12, fontSize: isTV ? 13 : 14 },
  cacheText: { color: colors.accent, fontSize: isTV ? 13 : 11, textAlign: 'center', marginBottom: 8 },
  catList: { marginBottom: isTV ? 6 : 0, height: isTV ? 50 : 56, flexGrow: 0, backgroundColor: isTV ? 'transparent' : '#171720' },
  catContent: { paddingHorizontal: isTV ? layout.horizontalPadding : 8, paddingVertical: isTV ? 5 : 9, gap: isTV ? 6 : 10, alignItems: 'center' },
  catBtn: { minHeight: isTV ? 34 : 36, justifyContent: 'center', paddingHorizontal: isTV ? 10 : 12, paddingVertical: isTV ? 6 : 6, borderRadius: isTV ? 999 : 8, backgroundColor: colors.surfaceElevated || colors.card, borderWidth: isTV ? 2 : 1, borderColor: 'rgba(255,255,255,0.08)' },
  catBtnActive: { backgroundColor: isTV ? (colors.accentWarm || colors.primary) : colors.primary, borderColor: isTV ? (colors.accentWarm || colors.primary) : colors.primary },
  catText: { color: colors.white, fontSize: isTV ? 11 : 16, fontWeight: isTV ? '900' : '600', zIndex: 2 },
  catTextActive: { color: isTV ? '#111' : colors.white, fontWeight: '900', zIndex: 2 },
  channelList: { paddingHorizontal: isTV ? layout.horizontalPadding : 0, paddingVertical: isTV ? 8 : 0, gap: isTV ? 10 : 0, paddingBottom: isTV ? 8 : 96 },
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
  mobileChannelRow: {
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 16,
    backgroundColor: '#1d1d27',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.045)',
  },
  mobileChannelLogo: { width: 54, height: 44, backgroundColor: 'rgba(0,0,0,0.18)' },
  mobileChannelLogoFallback: {
    width: 54,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mobileChannelLogoText: { color: colors.white, fontSize: 20, fontWeight: '900' },
  mobileChannelInfo: { flex: 1 },
  mobileChannelName: { color: colors.white, fontSize: 22, fontWeight: '500' },
  mobileChannelNameActive: { color: colors.primary },
  mobileChannelMeta: { color: '#9fa7bd', fontSize: 14, marginTop: 3, fontWeight: '500' },
  mobileChannelArrow: { color: '#c9ced8', fontSize: 42, fontWeight: '200' },
});
