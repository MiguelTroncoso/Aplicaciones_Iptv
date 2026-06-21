import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Alert, Text, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, RefreshControl, Image, FlatList,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { useLibrary } from '../context/LibraryContext';
import { useDownloads } from '../context/DownloadsContext';
import { colors } from '../theme';
import { checkForUpdates } from '../services/updater';
import { checkForNewContent, areNotificationsEnabled } from '../services/notifications';
import { getLiveStreams, getVodStreams, getSeries, getStreamUrl } from '../services/xtream';
import { getCache, saveCache, pickHomeHighlights } from '../services/contentCache';
import HeroCarousel from '../components/HeroCarousel';
import ContentRow from '../components/ContentRow';
import FocusableButton from '../components/FocusableButton';
import BrandLogo from '../components/BrandLogo';
import Screensaver, { useScreensaver } from '../components/Screensaver';
import { isTV, isTablet, layout } from '../utils/tv';
import versionInfo from '../../version.json';
import logger from '../utils/logger';
import { getRecentlyAdded } from '../utils/contentFilters';
import { getResumePositionMillis, promptResumePlayback, shouldAskResume } from '../utils/resumePlayback';
import { loadLastLiveChannel, mergeLastLiveChannel, sortChannelsForTV } from '../utils/liveHistory';

const CURRENT_YEAR = new Date().getFullYear();

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

const formatClockTime = () =>
  new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

const getPreviewContentType = (url = '') => {
  const value = String(url).toLowerCase();
  if (value.includes('.m3u8')) return 'hls';
  if (value.includes('.mpd')) return 'dash';
  return 'auto';
};

const TV_HOME_MENU = [
  { label: 'TV', screen: 'LiveTV', icon: '▣' },
  { label: 'DESTACADOS', screen: 'Home', icon: '◆' },
  { label: 'PELICULA', screen: 'Movies', icon: '●' },
  { label: 'SERIES', screen: 'Series', icon: '▤' },
  { label: 'KIDS', screen: 'Search', icon: '☻' },
  { label: 'ANIME', screen: 'Search', icon: '♣' },
  { label: 'EXPLORAR', screen: 'Search', icon: '⌕' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * isNewRelease — detecta contenido reciente.
 * Xtream no incluye `year` en el stream list, pero SÍ incluye
 * `added` (timestamp Unix). Lo usamos como fallback principal.
 */
const isNewRelease = (item) => {
  const raw = item?.raw || item || {};
  // 1. Campo year explícito (algunos servidores lo incluyen)
  const year = parseInt(raw.year || raw.releaseDate?.split('-')[0] || '0');
  if (year >= CURRENT_YEAR - 1 && year > 2000) return true;
  // 2. Campo `added` — timestamp Unix que Xtream siempre incluye en VOD
  const added = parseInt(raw.added || '0');
  if (added > 0) return (Date.now() - added * 1000) < ONE_YEAR_MS;
  return false;
};

const byRating = (a, b) => {
  const ra = parseFloat((a.raw || a).rating || 0);
  const rb = parseFloat((b.raw || b).rating || 0);
  return rb - ra;
};

const getTVContentRaw = (item) => item?.raw || item || {};

const getTVContentTitle = (item) => {
  const raw = getTVContentRaw(item);
  return raw.name || raw.title || raw.series_name || 'Contenido';
};

const getTVContentImage = (item) => {
  const raw = getTVContentRaw(item);
  return raw.stream_icon || raw.cover || raw.cover_big || raw.movie_image || raw.poster || raw.image || raw.backdrop_path || null;
};

const getTVContentType = (item) => {
  const raw = getTVContentRaw(item);
  if (item?.type) return item.type;
  if (raw.series_id && !raw.stream_id) return 'series';
  return 'movie';
};

// ─── Componente ───────────────────────────────────────────────────────────────

export default function HomeScreen({ navigation }) {
  const { user, server, signOut, checkSession } = useAuth();
  const { favorites, continueWatching, watchStats, isFavorite, toggleFavorite, getContinueWatchingItem } = useLibrary();
  const { downloads } = useDownloads();

  const [loading, setLoading]       = useState(true);
  const { screensaverActive, resetScreensaverTimer, dismissScreensaver } = useScreensaver();
  const [refreshing, setRefreshing] = useState(false);
  const [usingCache, setUsingCache] = useState(false);
  const [liveChannels, setLiveChannels] = useState([]);
  const [allLiveChannels, setAllLiveChannels] = useState([]);
  const [lastLiveChannel, setLastLiveChannel] = useState(null);
  const [movies, setMovies]         = useState([]);
  const [series, setSeries]         = useState([]);
  const [tvFocusedSection, setTvFocusedSection] = useState('TV');
  const [tvFocusedChannel, setTvFocusedChannel] = useState(null);
  const [tvFocusedContent, setTvFocusedContent] = useState(null);
  const [clockText, setClockText] = useState(formatClockTime());
  const tvPreviewPlayer = useVideoPlayer(null, (player) => {
    player.muted = false;
    player.volume = 1;
  });

  useEffect(() => {
    loadContent();
    loadLastLiveChannel().then(setLastLiveChannel).catch(() => {});
    const t = setTimeout(() => checkForUpdates(true), 4000);
    // Verificar sesión cada vez que el home se monta
    // Pedir permiso de notificaciones suavemente (solo si no fue pedido antes)
    const notifTimer = setTimeout(async () => {
      const enabled = await areNotificationsEnabled();
      if (!enabled) {
        // No preguntar automáticamente — el usuario puede activarlo en Ajustes
        // solo pedimos permiso del sistema si el usuario lo activa explícitamente
      }
    }, 5000);
    const s = setTimeout(async () => {
      const result = await checkSession?.();
      if (result?.expired) {
        Alert.alert('Sesión expirada', result.message || 'Tu sesión ha expirado.');
      }
    }, 3000);
    return () => { clearTimeout(t); clearTimeout(s); clearTimeout(notifTimer); };
  }, []);

  useFocusEffect(useCallback(() => {
    if (isTV) loadLastLiveChannel().then(setLastLiveChannel).catch(() => {});
  }, []));

  useEffect(() => {
    if (!isTV) return undefined;
    const timer = setInterval(() => setClockText(formatClockTime()), 30000);
    return () => clearInterval(timer);
  }, []);

  // ─── Secciones derivadas ──────────────────────────────────────────────────

  // Estrenos del año actual (movies + series)
  const movieEstrenos = useMemo(() =>
    movies.filter(isNewRelease).slice(0, 20),
    [movies]
  );
  const seriesEstrenos = useMemo(() =>
    series.filter(isNewRelease).slice(0, 20),
    [series]
  );

  // Mejor calificadas
  const topRatedMovies = useMemo(() =>
    [...movies].sort(byRating).filter(m => parseFloat((m.raw || m).rating || 0) >= 6).slice(0, 20),
    [movies]
  );

  const recentlyAddedMovies = useMemo(() => getRecentlyAdded(movies, 18, 14), [movies]);

  // Motor de recomendaciones: basado en géneros/categorías del historial
  const recommendedMovies = useMemo(() => {
    if (watchStats.length === 0 || movies.length === 0) return [];
    // Obtener categorías más vistas
    const catCount = {};
    watchStats.slice(0, 30).forEach(w => {
      const raw = w.raw || w;
      const cat = raw.category_id || raw.category_name;
      if (cat) catCount[cat] = (catCount[cat] || 0) + 1;
    });
    const topCats = Object.entries(catCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([cat]) => cat);
    if (topCats.length === 0) return [];
    // Filtrar películas de esas categorías que no están en continueWatching
    const cwIds = new Set(continueWatching.map(i => (i.raw || i).stream_id || (i.raw || i).name));
    return movies
      .filter(m => {
        const raw = m.raw || m;
        return topCats.some(cat => String(raw.category_id) === String(cat) || raw.category_name === cat)
               && !cwIds.has(raw.stream_id || raw.name);
      })
      .slice(0, 20);
  }, [watchStats, movies, continueWatching]);
  const recentlyAddedSeries = useMemo(() => getRecentlyAdded(series, 18, 14), [series]);

  // Recomendaciones "Porque viste X..."
  // Toma el último visto y busca contenido de la misma categoría
  const lastWatched = continueWatching?.[0];
  const becauseYouWatched = useMemo(() => {
    if (!lastWatched) return [];
    const raw = lastWatched.raw || lastWatched;
    const cat = raw.category_name || raw.category_id;
    if (!cat) return [];
    const pool = [...movies, ...series];
    return pool
      .filter(i => {
        const r = i.raw || i;
        return (r.category_name === cat || r.category_id === cat) &&
               r.name !== raw.name;
      })
      .slice(0, 15);
  }, [lastWatched, movies, series]);

  // Items para el carrusel hero — siempre 6-8 items
  const heroItems = useMemo(() => {
    const used = new Set();
    const add = (arr, limit) => {
      const result = [];
      for (const item of arr) {
        if (result.length >= limit) break;
        const id = (item?.raw || item)?.stream_id || (item?.raw || item)?.series_id || (item?.raw || item)?.name;
        if (!id || used.has(id)) continue;
        used.add(id);
        result.push(item);
      }
      return result;
    };

    const pool = [
      ...add(movieEstrenos, 4),
      ...add(seriesEstrenos, 2),
      ...add(topRatedMovies, 3),
    ];

    // Si no llegamos a 6, completar con cualquier película disponible
    if (pool.length < 6 && movies.length > 0) {
      pool.push(...add(movies, 8 - pool.length));
    }
    // Si no llegamos a 6 con series tampoco, completar con series
    if (pool.length < 6 && series.length > 0) {
      pool.push(...add(series, 8 - pool.length));
    }

    return pool.slice(0, 8);
  }, [movieEstrenos, seriesEstrenos, topRatedMovies, movies, series]);

  const heroTypes = useMemo(() =>
    heroItems.map(item =>
      movies.includes(item) || movieEstrenos.includes(item) ? 'movie' : 'series'
    ),
    [heroItems, movies, movieEstrenos]
  );

  // ─── Carga de datos ───────────────────────────────────────────────────────

  const applyHomeData = (live = [], vod = [], ser = [], fromCache = false) => {
    setAllLiveChannels(live || []);
    setLiveChannels(pickHomeHighlights(live || [], 'live', isTV ? 40 : 25));
    setMovies(pickHomeHighlights(vod || [], 'movie', isTV ? 60 : 40));
    setSeries(pickHomeHighlights(ser || [], 'series', isTV ? 60 : 40));
    setUsingCache(fromCache);
  };

  const loadCachedContent = async () => {
    const [liveCache, movieCache, seriesCache] = await Promise.all([
      getCache(server.url, user.username, 'home_live'),
      getCache(server.url, user.username, 'home_movies'),
      getCache(server.url, user.username, 'home_series'),
    ]);
    const hasCache = liveCache?.data?.length || movieCache?.data?.length || seriesCache?.data?.length;
    if (hasCache) {
      applyHomeData(liveCache?.data || [], movieCache?.data || [], seriesCache?.data || [], true);
      setLoading(false);
      return liveCache?.isFresh && movieCache?.isFresh && seriesCache?.isFresh;
    }
    return false;
  };

  const loadContent = async (forceRefresh = false) => {
    try {
      if (!forceRefresh) {
        const cacheFresh = await loadCachedContent();
        if (cacheFresh) return;
      } else {
        setRefreshing(true);
      }

      const hasContent = liveChannels.length || movies.length || series.length;
      if (!hasContent) setLoading(true);

      const fetchLive = getLiveStreams(server.url, user.username, user.password)
        .then(data => {
          setAllLiveChannels(data || []);
          const compact = pickHomeHighlights(data || [], 'live', 60);
          setLiveChannels(compact);
          setLoading(false);
          saveCache(server.url, user.username, 'home_live', 'all', compact);
          return compact;
        }).catch(e => { logger.log('Error live:', e); return []; });

      const fetchMovies = getVodStreams(server.url, user.username, user.password)
        .then(data => {
          const compact = pickHomeHighlights(data || [], 'movie', 80);
          setMovies(compact);
          setLoading(false);
          saveCache(server.url, user.username, 'home_movies', 'all', compact);
          return compact;
        }).catch(e => { logger.log('Error movies:', e); return []; });

      const fetchSeries = getSeries(server.url, user.username, user.password)
        .then(data => {
          const compact = pickHomeHighlights(data || [], 'series', 80);
          setSeries(compact);
          setLoading(false);
          saveCache(server.url, user.username, 'home_series', 'all', compact);
          return compact;
        }).catch(e => { logger.log('Error series:', e); return []; });

      const [, movieData, seriesData] = await Promise.all([fetchLive, fetchMovies, fetchSeries]);
      setUsingCache(false);
      // Verificar nuevo contenido con los datos recién descargados, no con el state viejo.
      checkForNewContent(movieData, seriesData).catch(() => {});
    } catch (e) {
      logger.log('Error cargando contenido:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const playWithResumePrompt = useCallback((stream, type = 'movie', options = {}) => {
    const { resumeItem: forcedResumeItem, ...playerOptions } = options;
    if (type === 'live') {
      navigation.navigate('Player', { stream, type, returnRoute: 'LiveTV', ...playerOptions });
      return;
    }

    const resumeItem = forcedResumeItem || getContinueWatchingItem(stream, type);
    const offlineUri = playerOptions.offlineUri || resumeItem?.fileUri || resumeItem?.offlineUri || null;
    const title = stream?.name || stream?.title || resumeItem?.name || 'este contenido';

    const openPlayer = (resumePosition = 0) => {
      navigation.navigate('Player', {
        stream,
        type,
        resumePosition,
        offlineUri,
        offlineMode: Boolean(offlineUri),
        returnRoute: 'MainTabs',
        ...playerOptions,
      });
    };

    if (shouldAskResume(resumeItem)) {
      promptResumePlayback({
        resumeItem,
        title,
        onContinue: () => openPlayer(getResumePositionMillis(resumeItem)),
        onRestart: () => openPlayer(0),
      });
      return;
    }

    openPlayer(0);
  }, [getContinueWatchingItem, navigation]);

  const goToLibraryItem = useCallback((raw, libraryItem) => {
    const item = libraryItem || raw;
    const type = item.type || 'movie';
    const stream = item.raw || raw;
    if (type === 'series' && stream.series_id && !stream.stream_id) {
      navigation.navigate('SeriesDetail', { serie: stream });
      return;
    }
    if (item.positionMillis > 0 || item.fileUri || item.offlineUri) {
      playWithResumePrompt(stream, type, {
        resumeItem: item,
        offlineUri: item.fileUri || item.offlineUri || null,
      });
    } else if (type === 'movie') {
      navigation.navigate('MovieDetail', { stream, type });
    } else {
      playWithResumePrompt(stream, type);
    }
  }, [navigation, playWithResumePrompt]);

  const handleHeroPlay = useCallback((item, type) => {
    if (type === 'series') navigation.navigate('SeriesDetail', { serie: item });
    else playWithResumePrompt(item, type || 'movie');
  }, [navigation, playWithResumePrompt]);

  const handleHeroInfo = useCallback((item, type) => {
    if (type === 'series') navigation.navigate('SeriesDetail', { serie: item });
    else if (type === 'movie') navigation.navigate('MovieDetail', { stream: item, type });
    else navigation.navigate('Player', { stream: item, type, returnRoute: 'MainTabs' });
  }, [navigation]);

  const expirationDate = user?.expiration_date
    ? new Date(parseInt(user.expiration_date) * 1000).toLocaleDateString('es-ES')
    : 'Sin fecha';

  const tvSortedChannels = useMemo(() => {
    const pool = allLiveChannels.length ? allLiveChannels : liveChannels;
    return sortChannelsForTV(pool);
  }, [allLiveChannels, liveChannels]);

  const tvPreviewChannel = useMemo(
    () => mergeLastLiveChannel(lastLiveChannel, tvSortedChannels),
    [lastLiveChannel, tvSortedChannels]
  );
  const tvIsLiveSection = tvFocusedSection === 'TV';
  const tvSectionItems = useMemo(() => {
    if (tvFocusedSection === 'TV') return tvSortedChannels;
    if (tvFocusedSection === 'DESTACADOS') {
      const highlights = [
        ...heroItems,
        ...recentlyAddedMovies,
        ...recentlyAddedSeries,
        ...movieEstrenos,
        ...seriesEstrenos,
      ];
      return highlights.length ? highlights : [...movies, ...series];
    }
    if (tvFocusedSection === 'PELICULA') return movies;
    if (tvFocusedSection === 'SERIES') return series;
    if (tvFocusedSection === 'KIDS') {
      const kidsItems = [...movies, ...series].filter(item => {
        const raw = getTVContentRaw(item);
        const text = `${raw.name || ''} ${raw.title || ''} ${raw.category_name || ''}`.toLowerCase();
        return text.includes('kids') || text.includes('infantil') || text.includes('niños') || text.includes('ninos');
      });
      return kidsItems.length ? kidsItems : [...movies, ...series];
    }
    if (tvFocusedSection === 'ANIME') {
      const animeItems = [...movies, ...series].filter(item => {
        const raw = getTVContentRaw(item);
        const text = `${raw.name || ''} ${raw.title || ''} ${raw.category_name || ''}`.toLowerCase();
        return text.includes('anime');
      });
      return animeItems.length ? animeItems : [...movies, ...series];
    }
    return [...movies, ...series];
  }, [heroItems, movieEstrenos, movies, recentlyAddedMovies, recentlyAddedSeries, series, seriesEstrenos, tvFocusedSection, tvSortedChannels]);

  const tvDisplayChannel = tvIsLiveSection ? (tvFocusedChannel || tvPreviewChannel) : null;
  const tvDisplayContent = tvIsLiveSection ? null : (tvFocusedContent || tvSectionItems[0]);
  const tvPreviewImage = tvDisplayContent ? getTVContentImage(tvDisplayContent) : null;
  const tvPreviewTitle = tvIsLiveSection
    ? tvDisplayChannel?.name || 'TV en vivo'
    : getTVContentTitle(tvDisplayContent) || tvFocusedSection;

  const tvPreviewUrl = useMemo(() => {
    const streamId = tvDisplayChannel?.stream_id || tvDisplayChannel?.id;
    if (!isTV || !tvIsLiveSection || !streamId || !server?.url || !user?.username || !user?.password) return null;
    return getStreamUrl(server.url, user.username, user.password, streamId, 'live', 'ts');
  }, [server?.url, tvDisplayChannel, tvIsLiveSection, user?.password, user?.username]);

  useEffect(() => {
    if (!isTV) return undefined;

    if (!tvPreviewUrl) {
      try { tvPreviewPlayer.replace(null); } catch (_) {}
      return undefined;
    }

    const source = { uri: tvPreviewUrl, contentType: getPreviewContentType(tvPreviewUrl) };
    try {
      tvPreviewPlayer.muted = false;
      tvPreviewPlayer.volume = 1;
      if (typeof tvPreviewPlayer.replaceAsync === 'function') {
        tvPreviewPlayer.replaceAsync(source).then(() => tvPreviewPlayer.play()).catch(() => {});
      } else {
        tvPreviewPlayer.replace(source);
        tvPreviewPlayer.play();
      }
    } catch (_) {}

    return undefined;
  }, [tvPreviewPlayer, tvPreviewUrl]);

  useFocusEffect(useCallback(() => {
    if (!isTV || !tvPreviewUrl) return undefined;
    try { tvPreviewPlayer.play(); } catch (_) {}
    return () => {
      try { tvPreviewPlayer.pause(); } catch (_) {}
    };
  }, [tvPreviewPlayer, tvPreviewUrl]));

  const openLiveFromHome = useCallback((channel = tvDisplayChannel) => {
    if (channel) {
      navigation.navigate('Player', { stream: channel, type: 'live', returnRoute: 'LiveTV' });
      return;
    }
    navigation.navigate('LiveTV');
  }, [navigation, tvDisplayChannel]);

  const openTVSectionItem = useCallback((item) => {
    if (tvFocusedSection === 'TV') {
      openLiveFromHome(item);
      return;
    }
    const raw = getTVContentRaw(item || tvDisplayContent);
    if (!raw?.stream_id && !raw?.series_id) {
      navigation.navigate(TV_HOME_MENU.find(menu => menu.label === tvFocusedSection)?.screen || 'Search');
      return;
    }
    const type = getTVContentType(item || tvDisplayContent);
    if (type === 'series') {
      navigation.navigate('SeriesDetail', { serie: raw });
      return;
    }
    navigation.navigate('MovieDetail', { stream: raw, type: 'movie' });
  }, [navigation, openLiveFromHome, tvDisplayContent, tvFocusedSection]);

  const renderTVHomeMenu = () => {
    if (!isTV) return null;
    return (
      <View style={styles.tvMenuBand}>
        <View style={styles.tvMenuHeader}>
          <BrandLogo variant="nav" />
        </View>
        <View style={styles.tvMenuGrid}>
          {TV_HOME_MENU.map((item, index) => {
            const active = tvFocusedSection === item.label;
            return (
              <FocusableButton
                key={`${item.screen}-${item.label}`}
                style={[styles.tvMenuButton, active && styles.tvMenuButtonActive, !active && index > 1 && styles.tvMenuButtonMuted]}
                focusedStyle={styles.tvMenuButtonFocused}
                onFocus={() => {
                  setTvFocusedSection(item.label);
                  setTvFocusedContent(null);
                  if (item.screen === 'LiveTV') setTvFocusedChannel(tvPreviewChannel);
                  else setTvFocusedChannel(null);
                }}
                onPress={() => {
                  if (item.screen === 'LiveTV') openLiveFromHome();
                  else if (tvSectionItems.length) openTVSectionItem(tvSectionItems[0]);
                  else navigation.navigate(item.screen);
                }}
              >
                <Text style={[styles.tvMenuButtonIcon, active && styles.tvMenuButtonIconActive]}>{item.icon}</Text>
                <Text style={[styles.tvMenuButtonText, active && styles.tvMenuButtonTextActive]} numberOfLines={1}>{item.label}</Text>
              </FocusableButton>
            );
          })}
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.loadingText}>Cargando FLASHNETV...</Text>
        <Text style={styles.loadingSubText}>Preparando canales y contenido</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={isTV ? styles.tvScrollContent : undefined}
        scrollEnabled={!isTV}
        showsVerticalScrollIndicator={false}
        refreshControl={!isTV ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadContent(true)}
            tintColor={colors.accent}
          />
        ) : undefined}
      >
        {/* ── HEADER ── */}
        {!isTV && (
        <View style={styles.header}>
          <BrandLogo variant="nav" style={styles.logo} />
          <View style={styles.headerRight}>
            <FocusableButton style={styles.searchBtn} onPress={() => navigation.navigate('Search')}>
              <Text style={styles.searchBtnText}>Buscar</Text>
            </FocusableButton>

            <FocusableButton style={styles.searchBtn} onPress={() => navigation.navigate('Favorites')}>
              <Text style={styles.searchBtnText}>Fav</Text>
            </FocusableButton>

            <FocusableButton onPress={signOut} style={styles.logoutBtn}>
              <Text style={styles.logoutText}>Salir</Text>
            </FocusableButton>
          </View>
        </View>
        )}

        {/* ── HERO CARRUSEL ── */}
        {isTV ? (
          <View style={styles.tvDashboard}>
            <View style={styles.tvStatusBar}>
              <FocusableButton style={styles.tvStatusAction} focusedStyle={styles.tvStatusActionFocused} onPress={() => navigation.navigate('Search')}>
                <Text style={styles.tvStatusText}>⌕</Text>
              </FocusableButton>
              <FocusableButton style={styles.tvStatusAction} focusedStyle={styles.tvStatusActionFocused} onPress={() => navigation.navigate('LiveTV')}>
                <Text style={styles.tvStatusText}>▾</Text>
              </FocusableButton>
              <FocusableButton style={styles.tvStatusAction} focusedStyle={styles.tvStatusActionFocused} onPress={() => openLiveFromHome()}>
                <Text style={styles.tvStatusText}>◷</Text>
              </FocusableButton>
              <FocusableButton style={styles.tvStatusAction} focusedStyle={styles.tvStatusActionFocused} onPress={() => navigation.navigate('Account')}>
                <Text style={styles.tvStatusText}>●</Text>
              </FocusableButton>
              <Text style={styles.tvStatusIcon}>●</Text>
              <Text style={styles.tvStatusDivider}>|</Text>
              <Text style={styles.tvStatusIcon}>≋</Text>
              <Text style={styles.tvClockText}>{clockText}</Text>
            </View>
            {renderTVHomeMenu()}

            <FocusableButton
              style={styles.tvLivePreview}
              focusedStyle={styles.tvLivePreviewFocused}
              hasTVPreferredFocus={isTV}
              onPress={() => {
                if (tvIsLiveSection) openLiveFromHome();
                else openTVSectionItem(tvDisplayContent);
              }}
            >
              <View style={styles.tvLivePreviewImage}>
                {tvPreviewUrl ? (
                  <VideoView
                    player={tvPreviewPlayer}
                    style={StyleSheet.absoluteFillObject}
                    contentFit="cover"
                    nativeControls={false}
                    allowsFullscreen={false}
                    allowsPictureInPicture={false}
                  />
                ) : tvPreviewImage ? (
                  <Image source={{ uri: tvPreviewImage }} style={tvIsLiveSection ? styles.tvLiveLogo : styles.tvContentPoster} resizeMode={tvIsLiveSection ? 'contain' : 'cover'} />
                ) : tvDisplayChannel?.stream_icon ? (
                  <Image source={{ uri: tvDisplayChannel.stream_icon }} style={styles.tvLiveLogo} resizeMode="contain" />
                ) : (
                  <Text style={styles.tvLiveFallback}>{tvIsLiveSection ? 'TV' : tvFocusedSection}</Text>
                )}
                <View style={styles.tvLiveShade} />
                <Text style={styles.tvLiveName} numberOfLines={1}>{tvPreviewTitle}</Text>
                <Text style={styles.tvLiveExpand}>⛶</Text>
              </View>
            </FocusableButton>

            <View style={styles.tvChannelRail}>
              <Text style={styles.tvRailArrow}>⌃</Text>
              <FlatList
                style={styles.tvRailList}
                data={tvSectionItems}
                keyExtractor={(item, index) => {
                  const raw = getTVContentRaw(item);
                  return `tv-home-${tvFocusedSection}-${raw.stream_id || raw.series_id || raw.name || index}`;
                }}
                showsVerticalScrollIndicator={false}
                initialNumToRender={12}
                maxToRenderPerBatch={12}
                windowSize={7}
                removeClippedSubviews={false}
                renderItem={({ item }) => {
                  const raw = getTVContentRaw(item);
                  const image = tvIsLiveSection ? raw.stream_icon : getTVContentImage(item);
                  const title = tvIsLiveSection ? raw.name : getTVContentTitle(item);
                  return (
                    <FocusableButton
                      style={styles.tvRailChannel}
                      focusedStyle={styles.tvRailChannelFocused}
                      onFocus={() => {
                        if (tvIsLiveSection) setTvFocusedChannel(raw);
                        else setTvFocusedContent(item);
                      }}
                      onPress={() => {
                        if (tvIsLiveSection) openLiveFromHome(raw);
                        else openTVSectionItem(item);
                      }}
                    >
                      {image ? (
                        <Image source={{ uri: image }} style={styles.tvRailLogo} resizeMode={tvIsLiveSection ? 'contain' : 'cover'} />
                      ) : (
                        <View style={styles.tvRailLogoFallback}>
                          <Text style={styles.tvRailLogoText}>{String(title || '?').charAt(0)}</Text>
                        </View>
                      )}
                      <Text style={styles.tvRailName} numberOfLines={1}>{title}</Text>
                    </FocusableButton>
                  );
                }}
                ListEmptyComponent={(
                  <View style={styles.tvRailEmpty}>
                    <Text style={styles.tvRailEmptyText}>Sin contenido</Text>
                  </View>
                )}
              />
              <Text style={styles.tvRailArrow}>v</Text>
            </View>
          </View>
        ) : heroItems.length > 0 ? (
          <HeroCarousel
            items={heroItems}
            types={heroTypes}
            onPlay={handleHeroPlay}
            onInfo={handleHeroInfo}
          />
        ) : movies.length > 0 ? (
          <HeroCarousel
            items={movies.slice(0, 6)}
            types={movies.slice(0, 6).map(() => 'movie')}
            onPlay={handleHeroPlay}
            onInfo={handleHeroInfo}
          />
        ) : null}

        {/* ── ACCESOS RÁPIDOS (complementan los tabs) ── */}
        {!isTV && (
        <View style={styles.navTabs}>
          {[
            { label: '🔥 Eventos',  icon: '🏆', screen: 'Events' },
            { label: '🔖 Ver después', icon: '🔖', screen: 'Watchlist' },
            { label: '🔍 Buscar',   icon: '🔍', screen: 'Search' },
            { label: '📅 EPG',      icon: '📅', screen: 'EPG' },
          ].map((tab, idx) => (
            <FocusableButton
              key={tab.screen}
              style={styles.navTab}
              onPress={() => navigation.navigate(tab.screen)}
            >
              <Text style={styles.navTabIcon}>{tab.icon}</Text>
              <Text style={styles.navTabText} numberOfLines={1}>{tab.label}</Text>
            </FocusableButton>
          ))}
        </View>
        )}

        {/* ── TV EN VIVO RÁPIDO ── */}
        {!isTV && (
        <ContentRow
          title="📺 TV en vivo"
          subtitle="Canales destacados para entrar rápido"
          data={liveChannels}
          type="live"
          showFavoriteButton
          isFavorite={isFavorite}
          onFavoritePress={toggleFavorite}
          onPress={(item) => navigation.navigate('Player', { stream: item, type: 'live', returnRoute: 'LiveTV' })}
          onSeeAll={() => navigation.navigate('LiveTV')}
        />
        )}

        {/* ── RECOMENDACIONES ── */}
        {!isTV && recommendedMovies.length > 0 && (
          <ContentRow
            title="⭐ Recomendado para ti"
            subtitle="Basado en lo que ves"
            data={recommendedMovies}
            type="movie"
            showEstrenoBadge
            onPress={(item) => navigation.navigate('MovieDetail', { stream: item, type: 'movie' })}
          />
        )}

        {/* ── RECIÉN AGREGADOS ── */}
        {!isTV && recentlyAddedMovies.length > 0 && (
          <ContentRow
            title="🆕 Recién agregadas"
            subtitle="Lo último subido al servidor"
            data={recentlyAddedMovies}
            type="movie"
            showEstrenoBadge
            showFavoriteButton
            isFavorite={isFavorite}
            onFavoritePress={toggleFavorite}
            onPress={(item) => navigation.navigate('MovieDetail', { stream: item, type: 'movie' })}
            onSeeAll={() => navigation.navigate('Movies')}
          />
        )}

        {!isTV && recentlyAddedSeries.length > 0 && (
          <ContentRow
            title="🆕 Series recién agregadas"
            subtitle="Nuevas cargas del servidor"
            data={recentlyAddedSeries}
            type="series"
            showEstrenoBadge
            showFavoriteButton
            isFavorite={isFavorite}
            onFavoritePress={toggleFavorite}
            onPress={(item) => navigation.navigate('SeriesDetail', { serie: item })}
            onSeeAll={() => navigation.navigate('Series')}
          />
        )}

        {/* ── CONTINUAR VIENDO ── */}
        <ContentRow
          title="▶ Continuar viendo"
          data={!isTV ? continueWatching : []}
          type="movie"
          showProgress
          onSeeAll={() => navigation.navigate('ContinueWatching')}
          onPress={goToLibraryItem}
        />

        {false && (
          <ContentRow
            title="📺 TV en vivo"
            subtitle="Canales destacados"
            data={liveChannels.slice(0, 18)}
            type="live"
            showFavoriteButton
            isFavorite={isFavorite}
            onFavoritePress={toggleFavorite}
            onPress={(item) => navigation.navigate('Player', { stream: item, type: 'live', returnRoute: 'LiveTV' })}
            onSeeAll={() => navigation.navigate('LiveTV')}
          />
        )}

        {/* ── ESTRENOS PELÍCULAS ── */}
        {!isTV && movieEstrenos.length > 0 && (
          <ContentRow
            title={`🎬 Estrenos ${CURRENT_YEAR}`}
            subtitle="Películas de este año"
            data={movieEstrenos}
            type="movie"
            showEstrenoBadge
            showFavoriteButton
            isFavorite={isFavorite}
            onFavoritePress={toggleFavorite}
            onPress={(item) => navigation.navigate('MovieDetail', { stream: item, type: 'movie' })}
            onSeeAll={() => navigation.navigate('Movies')}
          />
        )}

        {/* ── ESTRENOS SERIES ── */}
        {!isTV && seriesEstrenos.length > 0 && (
          <ContentRow
            title={`📡 Series ${CURRENT_YEAR}`}
            subtitle="Series estrenadas este año"
            data={seriesEstrenos}
            type="series"
            showEstrenoBadge
            showFavoriteButton
            isFavorite={isFavorite}
            onFavoritePress={toggleFavorite}
            onPress={(item) => navigation.navigate('SeriesDetail', { serie: item })}
            onSeeAll={() => navigation.navigate('Series')}
          />
        )}

        {/* ── MEJOR CALIFICADAS ── */}
        {!isTV && topRatedMovies.length > 0 && (
          <ContentRow
            title="⭐ Las mejor calificadas"
            subtitle="Top valoradas por audiencia"
            data={topRatedMovies}
            type="movie"
            showFavoriteButton
            isFavorite={isFavorite}
            onFavoritePress={toggleFavorite}
            onPress={(item) => navigation.navigate('MovieDetail', { stream: item, type: 'movie' })}
            onSeeAll={() => navigation.navigate('Movies')}
          />
        )}

        {/* ── PORQUE VISTE X ── */}
        {!isTV && becauseYouWatched.length > 0 && lastWatched && (
          <ContentRow
            title={`Porque viste ${(lastWatched.raw || lastWatched).name || ''}`}
            subtitle="Contenido similar"
            data={becauseYouWatched}
            type="movie"
            showFavoriteButton
            isFavorite={isFavorite}
            onFavoritePress={toggleFavorite}
            onPress={(item) => {
              const raw = item.raw || item;
              if (raw.series_id && !raw.stream_id) navigation.navigate('SeriesDetail', { serie: raw });
              else navigation.navigate('MovieDetail', { stream: raw, type: 'movie' });
            }}
          />
        )}

        {/* ── DESCARGAS OFFLINE ── */}
        <ContentRow
          title="⬇ Descargas offline"
          data={!isTV ? downloads.slice(0, 20) : []}
          type="movie"
          onSeeAll={() => navigation.navigate('Downloads')}
          onPress={goToLibraryItem}
        />

        {/* ── FAVORITOS ── */}
        <ContentRow
          title="❤️ Mis favoritos"
          data={!isTV ? favorites.slice(0, 20) : []}
          type="movie"
          onSeeAll={() => navigation.navigate('Favorites')}
          onPress={goToLibraryItem}
        />

        {/* ── TODAS LAS PELÍCULAS ── */}
        <ContentRow
          title="🎬 Películas destacadas"
          data={!isTV ? movies : []}
          type="movie"
          showFavoriteButton
          isFavorite={isFavorite}
          onFavoritePress={toggleFavorite}
          onPress={(item) => navigation.navigate('MovieDetail', { stream: item, type: 'movie' })}
          onSeeAll={() => navigation.navigate('Movies')}
        />

        {/* ── TODAS LAS SERIES ── */}
        <ContentRow
          title="📡 Series populares"
          data={!isTV ? series : []}
          type="series"
          showFavoriteButton
          isFavorite={isFavorite}
          onFavoritePress={toggleFavorite}
          onPress={(item) => navigation.navigate('SeriesDetail', { serie: item })}
          onSeeAll={() => navigation.navigate('Series')}
        />

        {/* ── INFO CUENTA ── */}
        <View style={styles.userCard}>
          <Text style={styles.userCardTitle}>Cuenta activa</Text>
          <View style={styles.infoRow}>
            <View style={styles.infoBadge}>
              <Text style={styles.infoBadgeLabel}>Usuario</Text>
              <Text style={styles.infoBadgeValue}>{user?.username}</Text>
            </View>
            <View style={styles.infoBadge}>
              <Text style={styles.infoBadgeLabel}>Vence</Text>
              <Text style={styles.infoBadgeValue}>{expirationDate}</Text>
            </View>
          </View>
        </View>

        <FocusableButton style={styles.updateBtn} disabled={isTV} onPress={() => checkForUpdates(false)}>
          <Text style={styles.updateBtnText}>🔄 Buscar actualizaciones</Text>
        </FocusableButton>

        <Text style={styles.versionText}>
          FLASHNETV v{versionInfo.version} - {isTV ? 'Modo TV' : 'Modo movil'}
        </Text>
      </ScrollView>
      {screensaverActive && (
        <Screensaver onDismiss={() => { dismissScreensaver(); resetScreensaverTimer(); }} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  tvScrollContent: { flexGrow: 1 },
  loadingContainer: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', gap: 16 },
  loadingText: { color: colors.white, fontSize: isTV ? 24 : 14, fontWeight: 'bold' },
  loadingSubText: { color: colors.textSecondary, fontSize: isTV ? 16 : 12 },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: layout.horizontalPadding,
    paddingTop: isTV ? 26 : 10, paddingBottom: isTV ? 22 : 14,
    gap: isTV ? 16 : 8,
  },
  logo: { flexShrink: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: isTV ? 16 : 7, flexShrink: 0, maxWidth: isTV ? '62%' : '60%' },
  searchBtn: { paddingHorizontal: isTV ? 16 : 9, paddingVertical: isTV ? 11 : 7, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', backgroundColor: 'rgba(31,125,255,0.14)' },
  searchBtnText: { color: colors.white, fontSize: isTV ? 16 : 11, fontWeight: '900' },
  logoutBtn: { borderWidth: 1, borderColor: colors.accentWarm || colors.primary, paddingHorizontal: isTV ? 20 : 10, paddingVertical: isTV ? 10 : 5, borderRadius: 8 },
  logoutText: { color: colors.textSecondary, fontSize: isTV ? 17 : 11, fontWeight: '800' },

  tvDashboard: {
    flexDirection: 'row',
    position: 'relative',
    flex: 1,
    paddingHorizontal: isTV ? 42 : layout.horizontalPadding,
    paddingTop: isTV ? 92 : 18,
    paddingBottom: isTV ? 22 : 8,
    gap: isTV ? 10 : 16,
    backgroundColor: '#020202',
    minHeight: isTV ? 690 : undefined,
    alignItems: 'center',
  },
  tvStatusBar: {
    position: 'absolute',
    top: 24,
    right: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    zIndex: 20,
  },
  tvStatusAction: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tvStatusActionFocused: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(31,125,255,0.18)',
  },
  tvStatusText: { color: 'rgba(255,255,255,0.82)', fontSize: 30, fontWeight: '900', lineHeight: 34 },
  tvStatusIcon: { color: 'rgba(255,255,255,0.72)', fontSize: 24, fontWeight: '900' },
  tvStatusDivider: { color: 'rgba(255,255,255,0.64)', fontSize: 18, fontWeight: '300' },
  tvClockText: { color: colors.white, fontSize: 18, fontWeight: '800' },
  tvMenuBand: {
    width: 168,
    flexShrink: 0,
    alignSelf: 'stretch',
    paddingTop: 6,
    paddingBottom: 8,
    paddingHorizontal: 0,
    backgroundColor: 'transparent',
    gap: 34,
  },
  tvMenuHeader: {
    alignItems: 'center',
    gap: 8,
  },
  tvMenuTitle: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  tvMenuGrid: {
    gap: 16,
  },
  tvMenuButton: {
    minHeight: 54,
    paddingHorizontal: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 11,
    opacity: 0.58,
  },
  tvMenuButtonActive: {
    opacity: 1,
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  tvMenuButtonMuted: {
    opacity: 0.42,
  },
  tvMenuButtonFocused: {
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: 'rgba(31,125,255,0.12)',
  },
  tvMenuButtonIcon: {
    width: 22,
    color: 'rgba(255,255,255,0.72)',
    fontSize: 17,
    fontWeight: '900',
    textAlign: 'center',
  },
  tvMenuButtonIconActive: {
    color: colors.primary,
  },
  tvMenuButtonText: {
    flex: 1,
    color: 'rgba(255,255,255,0.76)',
    fontSize: 18,
    fontWeight: '600',
  },
  tvMenuButtonTextActive: {
    color: colors.white,
  },
  tvLivePreview: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    backgroundColor: '#090909',
  },
  tvLivePreviewFocused: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(31,125,255,0.10)',
  },
  tvLivePreviewImage: {
    flex: 1,
    minHeight: 500,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: '#101010',
  },
  tvLiveLogo: { width: '52%', height: '44%', opacity: 0.52 },
  tvContentPoster: {
    width: '100%',
    height: '100%',
  },
  tvLiveFallback: { color: colors.white, fontSize: 96, fontWeight: '900', opacity: 0.16 },
  tvLiveShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.22)' },
  tvLiveName: {
    position: 'absolute',
    right: 24,
    bottom: 18,
    color: colors.white,
    fontSize: 22,
    fontWeight: '700',
  },
  tvLiveExpand: {
    position: 'absolute',
    right: 18,
    bottom: 48,
    color: colors.white,
    fontSize: 24,
  },
  tvChannelRail: {
    width: 300,
    alignSelf: 'stretch',
    paddingTop: 0,
    gap: 10,
  },
  tvRailList: {
    flex: 1,
  },
  tvRailArrow: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 32,
    textAlign: 'center',
    marginBottom: 2,
  },
  tvRailChannel: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: 8,
  },
  tvRailChannelFocused: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(31,125,255,0.18)',
  },
  tvRailLogo: {
    width: 72,
    height: 62,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  tvRailLogoFallback: {
    width: 72,
    height: 62,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tvRailLogoText: { color: colors.white, fontSize: 24, fontWeight: '900' },
  tvRailName: {
    flex: 1,
    color: colors.white,
    fontSize: 18,
    fontWeight: '600',
  },
  tvRailEmpty: {
    paddingVertical: 28,
    alignItems: 'center',
  },
  tvRailEmptyText: {
    color: colors.textSecondary,
    fontSize: 16,
    fontWeight: '700',
  },

  navTabs: {
    flexDirection: 'row',
    paddingHorizontal: layout.horizontalPadding,
    gap: isTV ? 10 : 8,
    marginTop: isTV ? 12 : 14,
    marginBottom: isTV ? 22 : 20,
  },
  navTab: { flex: 1, backgroundColor: colors.surfaceElevated || colors.card, borderRadius: 12, paddingVertical: isTV ? 10 : 13, alignItems: 'center', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.08)', gap: 4 },
  navTabIcon: { fontSize: isTV ? 18 : isTablet ? 22 : 18 },
  navTabText: { color: colors.white, fontSize: isTV ? 11 : isTablet ? 12 : 10, fontWeight: '900' },

  userCard: { marginHorizontal: layout.horizontalPadding, marginVertical: 16, backgroundColor: colors.card, borderRadius: 16, padding: isTV ? 22 : 16, borderWidth: 1, borderColor: '#2a2a3a' },
  userCardTitle: { color: colors.white, fontSize: isTV ? 20 : 14, fontWeight: 'bold', marginBottom: 12 },
  infoRow: { flexDirection: 'row', gap: 8 },
  infoBadge: { flex: 1, backgroundColor: '#0f0f14', borderRadius: 10, padding: isTV ? 15 : 10, alignItems: 'center', borderWidth: 1, borderColor: '#2a2a3a' },
  infoBadgeLabel: { color: colors.accent, fontSize: isTV ? 12 : 9, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 },
  infoBadgeValue: { color: colors.white, fontSize: isTV ? 16 : 11, fontWeight: '600' },

  updateBtn: { marginHorizontal: layout.horizontalPadding, marginTop: 4, backgroundColor: colors.card, borderRadius: 12, padding: isTV ? 18 : 14, alignItems: 'center', borderWidth: 1, borderColor: colors.accentWarm || colors.primary },
  updateBtnText: { color: colors.primary, fontWeight: '600', fontSize: isTV ? 17 : 13 },
  versionText: { color: 'rgba(255,255,255,0.18)', textAlign: 'center', marginTop: 12, marginBottom: 30, fontSize: isTV ? 14 : 12 },
});
