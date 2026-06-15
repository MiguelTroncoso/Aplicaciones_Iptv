import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Alert, Text, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { useLibrary } from '../context/LibraryContext';
import { useDownloads } from '../context/DownloadsContext';
import { colors } from '../theme';
import { checkForUpdates } from '../services/updater';
import { checkForNewContent, areNotificationsEnabled } from '../services/notifications';
import { getLiveStreams, getVodStreams, getSeries } from '../services/xtream';
import { getCache, saveCache, pickHomeHighlights } from '../services/contentCache';
import HeroCarousel from '../components/HeroCarousel';
import ContentRow from '../components/ContentRow';
import SportsRow from '../components/SportsRow';
import FocusableButton from '../components/FocusableButton';
import TVTopNav from '../components/TVTopNav';
import BrandLogo from '../components/BrandLogo';
import Screensaver, { useScreensaver } from '../components/Screensaver';
import { isTV, isTablet, layout } from '../utils/tv';
import versionInfo from '../../version.json';
import logger from '../utils/logger';
import { getRecentlyAdded } from '../utils/contentFilters';
import { getResumePositionMillis, promptResumePlayback, shouldAskResume } from '../utils/resumePlayback';

const CURRENT_YEAR = new Date().getFullYear();

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

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
  const [movies, setMovies]         = useState([]);
  const [series, setSeries]         = useState([]);

  useEffect(() => {
    loadContent();
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
      navigation.navigate('Player', { stream, type, returnRoute: 'MainTabs', ...playerOptions });
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
      <TVTopNav navigation={navigation} current="Home" />
      <ScrollView
        style={styles.container}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadContent(true)}
            tintColor={colors.accent}
          />
        }
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
        {heroItems.length > 0 ? (
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

        {/* ── DEPORTES ── */}
        {!isTV && <SportsRow navigation={navigation} liveChannels={liveChannels} />}

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
          onPress={(item) => navigation.navigate('Player', { stream: item, type: 'live', returnRoute: 'MainTabs' })}
          onSeeAll={() => navigation.navigate('LiveTV')}
        />
        )}

        {/* ── RECOMENDACIONES ── */}
        {recommendedMovies.length > 0 && (
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
        {recentlyAddedMovies.length > 0 && (
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

        {recentlyAddedSeries.length > 0 && (
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
          data={continueWatching}
          type="movie"
          showProgress
          onSeeAll={() => navigation.navigate('ContinueWatching')}
          onPress={goToLibraryItem}
        />

        {isTV && (
          <ContentRow
            title="📺 TV en vivo"
            subtitle="Canales destacados"
            data={liveChannels.slice(0, 18)}
            type="live"
            showFavoriteButton
            isFavorite={isFavorite}
            onFavoritePress={toggleFavorite}
            onPress={(item) => navigation.navigate('Player', { stream: item, type: 'live', returnRoute: 'MainTabs' })}
            onSeeAll={() => navigation.navigate('LiveTV')}
          />
        )}

        {isTV && <SportsRow navigation={navigation} liveChannels={liveChannels} />}

        {/* ── ESTRENOS PELÍCULAS ── */}
        {movieEstrenos.length > 0 && (
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
        {seriesEstrenos.length > 0 && (
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
        {topRatedMovies.length > 0 && (
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
        {becauseYouWatched.length > 0 && lastWatched && (
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
          data={downloads.slice(0, isTV ? 30 : 20)}
          type="movie"
          onSeeAll={() => navigation.navigate('Downloads')}
          onPress={goToLibraryItem}
        />

        {/* ── FAVORITOS ── */}
        <ContentRow
          title="❤️ Mis favoritos"
          data={favorites.slice(0, isTV ? 30 : 20)}
          type="movie"
          onSeeAll={() => navigation.navigate('Favorites')}
          onPress={goToLibraryItem}
        />

        {/* ── TODAS LAS PELÍCULAS ── */}
        <ContentRow
          title="🎬 Películas destacadas"
          data={movies}
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
          data={series}
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

        <FocusableButton style={styles.updateBtn} onPress={() => checkForUpdates(false)}>
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
