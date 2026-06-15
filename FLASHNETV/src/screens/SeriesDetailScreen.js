import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity,
  StyleSheet, ActivityIndicator, Image, ScrollView, useWindowDimensions, Share, Alert,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useDownloads } from '../context/DownloadsContext';
import { useLibrary } from '../context/LibraryContext';
import { getSeriesInfo } from '../services/xtream';
import { getCache, saveCache } from '../services/contentCache';
import { colors, shadows } from '../theme';
import { isTV } from '../utils/tv';
import FocusableButton from '../components/FocusableButton';
import { safeBack, useSafeHardwareBack } from '../utils/navigation';
import logger from '../utils/logger';
import { getResumePositionMillis, promptResumePlayback, shouldAskResume } from '../utils/resumePlayback';

export default function SeriesDetailScreen({ route, navigation }) {
  const { user, server } = useAuth();
  const { width, height } = useWindowDimensions();
  const { downloadItem, isDownloaded, cancelDownload, deleteDownload, getDownloadedItem, getProgress } = useDownloads();
  const { isEpisodeWatched, toggleEpisodeWatched, isInWatchlist, toggleWatchlist, getContinueWatchingItem } = useLibrary();
  const { serie, returnRoute = 'Home', returnParams } = route.params;
  const [info, setInfo] = useState(null);
  const [selectedSeason, setSelectedSeason] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [watchlisted, setWatchlisted] = useState(false);

  useSafeHardwareBack(navigation, returnRoute, returnParams);

  useEffect(() => { loadInfo(); }, []);
  useEffect(() => { setWatchlisted(isInWatchlist(serie, 'series')); }, [serie, isInWatchlist]);

  const loadInfo = async () => {
    try {
      setLoading(true);
      setError(false);

      const cacheKey = `series_info_${serie.series_id}`;
      const cached = await getCache(server.url, user.username, cacheKey);
      if (cached?.data) {
        setInfo(cached.data);
        const firstSeason = Object.keys(cached.data.episodes || {})[0];
        setSelectedSeason(firstSeason);
        setLoading(false);
        if (cached.isFresh) return;
      }

      const data = await getSeriesInfo(server.url, user.username, user.password, serie.series_id);
      if (!data) throw new Error('Sin datos del servidor');

      await saveCache(server.url, user.username, cacheKey, 'detail', data);
      setInfo(data);
      const firstSeason = Object.keys(data.episodes || {})[0];
      setSelectedSeason(firstSeason);
    } catch (e) {
      logger.log('Error cargando serie:', e);
      if (!info) setError(true);
    } finally {
      setLoading(false);
    }
  };

  const heroHeight = isTV ? Math.min(420, Math.max(280, Math.round(height * 0.42))) : 320;
  const episodes = info?.episodes?.[selectedSeason] || [];
  const seasons = Object.keys(info?.episodes || {}).sort((a, b) => Number(a) - Number(b));

  // Construye el stream de un episodio con todos los campos necesarios
  const buildEpisodeStream = useCallback((ep) => ({
    ...ep,
    stream_id: ep.id,
    name: ep.title
      ? `${serie.name} T${selectedSeason}E${ep.episode_num} · ${ep.title}`
      : `${serie.name} - T${selectedSeason} E${ep.episode_num}`,
    container_extension: ep.container_extension || ep.info?.container_extension || 'mp4',
    stream_icon: ep.info?.movie_image || serie.cover || serie.stream_icon || '',
    cover: ep.info?.movie_image || serie.cover || serie.stream_icon || '',
    category_name: serie.category_name || '',
    series_cover: serie.cover || serie.stream_icon || '',
  }), [serie, selectedSeason]);

  // Lista completa de episodios de la temporada actual (para auto-play)
  const buildEpisodeList = useCallback(() =>
    episodes.map(ep => buildEpisodeStream(ep)),
    [episodes, buildEpisodeStream]
  );

  const openEpisodePlayer = useCallback((episodeStream, episodeList, index, resumePosition = 0) => {
    navigation.navigate('Player', {
      stream: episodeStream,
      type: 'series',
      resumePosition,
      episodeList,
      currentEpisodeIndex: index,
      seriesInfo: { name: serie.name, cover: serie.cover, series_id: serie.series_id },
      returnRoute: 'SeriesDetail',
      returnParams: { serie },
    });
  }, [navigation, serie]);

  const handlePlayEpisode = useCallback((ep, index) => {
    const episodeStream = buildEpisodeStream(ep);
    const episodeList = buildEpisodeList();
    const resumeItem = getContinueWatchingItem(episodeStream, 'series');

    if (shouldAskResume(resumeItem)) {
      promptResumePlayback({
        resumeItem,
        title: episodeStream.name || episodeStream.title || 'este capítulo',
        onContinue: () => openEpisodePlayer(episodeStream, episodeList, index, getResumePositionMillis(resumeItem)),
        onRestart: () => openEpisodePlayer(episodeStream, episodeList, index, 0),
      });
      return;
    }

    openEpisodePlayer(episodeStream, episodeList, index, 0);
  }, [buildEpisodeStream, buildEpisodeList, getContinueWatchingItem, openEpisodePlayer]);

  const handleShare = async () => {
    try {
      const name = serie?.name || 'Serie';
      const rating = serie?.rating ? `⭐ ${parseFloat(serie.rating).toFixed(1)}` : '';
      const lines = [`📺 Te recomiendo la serie "${name}"`, rating, '', 'Disponible en FLASHNETV'].filter(Boolean);
      await Share.share({ message: lines.join('\n') });
    } catch (e) {}
  };

  const handleWatchlist = async () => {
    try {
      const next = await toggleWatchlist(serie, 'series');
      setWatchlisted(next);
    } catch (e) {
      logger.log('Toggle series watchlist error:', e?.message || e);
    }
  };

  const handleToggleWatched = async (ep) => {
    try {
      const episodeStream = buildEpisodeStream(ep);
      await toggleEpisodeWatched(serie, episodeStream);
    } catch (e) {
      logger.log('Toggle watched episode error:', e?.message || e);
    }
  };

  const handleEpisodeDownload = useCallback((episodeStream, progress = 0) => {
    const downloadedItem = getDownloadedItem(episodeStream, 'series');
    if (downloadedItem) {
      Alert.alert(
        'Eliminar capitulo',
        `Eliminar "${downloadedItem.name || episodeStream.name}" de este celular?`,
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Eliminar', style: 'destructive', onPress: () => deleteDownload(downloadedItem) },
        ]
      );
      return;
    }

    if (progress > 0 && progress < 1) {
      cancelDownload(episodeStream, 'series');
      return;
    }

    downloadItem(episodeStream, 'series');
  }, [cancelDownload, deleteDownload, downloadItem, getDownloadedItem]);

  if (loading && !info) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.loadingText}>Cargando serie...</Text>
      </View>
    );
  }

  if (error && !info) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.errorIcon}>⚠️</Text>
        <Text style={styles.errorText}>No se pudo cargar la serie</Text>
        <FocusableButton style={styles.retryBtn} onPress={loadInfo}>
          <Text style={styles.retryText}>↺  Reintentar</Text>
        </FocusableButton>
        <FocusableButton style={styles.backBtnCenter} onPress={() => safeBack(navigation, returnRoute, returnParams)}>
          <Text style={styles.backBtnCenterText}>← Volver</Text>
        </FocusableButton>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>

        <View style={[styles.heroContainer, { height: heroHeight }]}>
          {serie.cover ? (
            <Image source={{ uri: serie.cover }} style={[styles.heroPoster, { height: heroHeight }]} resizeMode="cover" />
          ) : (
            <View style={[styles.heroPosterPlaceholder, { height: heroHeight }]} />
          )}
          <View style={styles.heroOverlay} />
          <FocusableButton style={styles.backBtn} focusedStyle={styles.focusedPill} onPress={() => safeBack(navigation, returnRoute, returnParams)} hasTVPreferredFocus={isTV}>
            <Text style={styles.backText}>← Volver</Text>
          </FocusableButton>
          {error && (
            <View style={styles.staleBadge}>
              <Text style={styles.staleBadgeText}>Caché · toca para actualizar</Text>
            </View>
          )}
        </View>

        <View style={styles.infoContainer}>
          <Text style={styles.serieName}>{serie.name}</Text>
          {serie.rating && serie.rating !== '0' && !isNaN(parseFloat(serie.rating)) && (
            <Text style={styles.serieRating}>⭐ {parseFloat(serie.rating).toFixed(1)}</Text>
          )}
          {info?.info?.plot ? (
            <Text style={styles.seriePlot} numberOfLines={4}>{info.info.plot}</Text>
          ) : null}
          {info?.info?.genre ? (
            <Text style={styles.serieGenre}>🎭 {info.info.genre}</Text>
          ) : null}
          {info?.info?.cast ? (
            <Text style={styles.serieCast} numberOfLines={2}>👥 {info.info.cast}</Text>
          ) : null}
        </View>

        <View style={styles.quickActions}>
          <FocusableButton style={styles.quickActionBtn} focusedStyle={styles.focusedPill} onPress={handleShare}>
            <Text style={styles.quickActionText}>↗ Compartir</Text>
          </FocusableButton>
          <FocusableButton style={[styles.quickActionBtn, watchlisted && styles.quickActionActive]} focusedStyle={styles.focusedPill} onPress={handleWatchlist}>
            <Text style={styles.quickActionText}>{watchlisted ? '✓ Ver después' : '+ Ver después'}</Text>
          </FocusableButton>
        </View>

        {seasons.length > 0 && (
          <View style={styles.seasonsContainer}>
            <Text style={styles.sectionTitle}>Temporadas</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.seasonsList}>
              {seasons.map((season) => (
                <FocusableButton
                  key={season}
                  style={[styles.seasonBtn, selectedSeason === season && styles.seasonBtnActive]}
                  focusedStyle={styles.seasonBtnFocused}
                  onPress={() => setSelectedSeason(season)}
                >
                  <Text style={[styles.seasonText, selectedSeason === season && styles.seasonTextActive]}>
                    T{season}
                  </Text>
                </FocusableButton>
              ))}
            </ScrollView>
          </View>
        )}

        <View style={styles.episodesContainer}>
          <Text style={styles.sectionTitle}>
            {episodes.length} episodio{episodes.length !== 1 ? 's' : ''} · Temporada {selectedSeason}
          </Text>
          {episodes.map((ep, index) => {
            const episodeStream = buildEpisodeStream(ep);
            const downloaded = isDownloaded(episodeStream, 'series');
            const progress = getProgress(episodeStream, 'series');
            const watched = isEpisodeWatched(serie, episodeStream);
            return (
              <FocusableButton
                key={ep.id}
                style={[styles.episodeRow, watched && styles.episodeRowWatched]}
                focusedStyle={styles.episodeRowFocused}
                activeOpacity={0.8}
                onPress={() => handlePlayEpisode(ep, index)}
              >
                {ep.info?.movie_image ? (
                  <Image source={{ uri: ep.info.movie_image }} style={styles.epThumb} resizeMode="cover" />
                ) : (
                  <View style={styles.epThumbPlaceholder}>
                    <Text style={styles.epNum}>{ep.episode_num}</Text>
                  </View>
                )}
                <View style={styles.epInfo}>
                  <View style={styles.epTitleRow}>
                    <Text style={[styles.epTitle, watched && styles.epTitleWatched]} numberOfLines={2}>
                      {ep.title || `Episodio ${ep.episode_num}`}
                    </Text>
                    {watched && <Text style={styles.watchedBadge}>Visto</Text>}
                  </View>
                  {ep.info?.plot ? (
                    <Text style={styles.epPlot} numberOfLines={2}>{ep.info.plot}</Text>
                  ) : null}
                  {ep.info?.duration ? (
                    <Text style={styles.epDuration}>⏱ {ep.info.duration}</Text>
                  ) : null}
                </View>
                <View style={styles.epActions}>
                  <TouchableOpacity
                    style={[styles.epWatchedBtn, watched && styles.epWatchedBtnActive]}
                    focusable={false}
                    onPress={(e) => {
                      e.stopPropagation?.();
                      handleToggleWatched(ep);
                    }}
                  >
                    <Text style={[styles.epWatchedText, watched && styles.epWatchedTextActive]}>{watched ? '✓' : '○'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.epDownloadBtn,
                      progress > 0 && progress < 1 && styles.epDownloadBtnActive,
                      downloaded && styles.epDownloadBtnDownloaded,
                    ]}
                    focusable={false}
                    onPress={(e) => {
                      e.stopPropagation?.();
                      handleEpisodeDownload(episodeStream, progress);
                    }}
                  >
                    <Text style={[styles.epDownloadText, downloaded && styles.epDownloadTextDownloaded]}>
                      {downloaded ? 'Borrar' : progress > 0 && progress < 1 ? `${Math.round(progress * 100)}%` : '⬇'}
                    </Text>
                  </TouchableOpacity>
                  <Text style={styles.playIcon}>▶</Text>
                </View>
              </FocusableButton>
            );
          })}
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loadingContainer: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', gap: 16 },
  loadingText: { color: colors.textSecondary, fontSize: 14 },
  errorIcon: { fontSize: 40 },
  errorText: { color: colors.white, fontSize: 17, fontWeight: 'bold' },
  retryBtn: { backgroundColor: colors.primary, paddingHorizontal: 28, paddingVertical: 13, borderRadius: 10, marginTop: 4 },
  retryText: { color: colors.white, fontWeight: '600', fontSize: 15 },
  backBtnCenter: { marginTop: 8, padding: 10 },
  backBtnCenterText: { color: colors.accent, fontSize: 14 },
  heroContainer: { position: 'relative' },
  heroPoster: { width: '100%' },
  heroPosterPlaceholder: { width: '100%', backgroundColor: colors.card },
  heroOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: 120,
    backgroundColor: colors.background, opacity: 0.9,
  },
  backBtn: {
    position: 'absolute', top: isTV ? 24 : 40, left: isTV ? 34 : 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: isTV ? 20 : 14, paddingVertical: isTV ? 11 : 8, borderRadius: 10,
  },
  focusedPill: { backgroundColor: 'rgba(246,182,63,0.22)', borderColor: colors.accentWarm || colors.accent, borderWidth: 2 },
  backText: { color: colors.accentWarm || colors.accent, fontSize: isTV ? 17 : 14, fontWeight: '700' },
  staleBadge: {
    position: 'absolute', bottom: 130, right: 16,
    backgroundColor: 'rgba(255,165,0,0.15)',
    borderColor: 'rgba(255,165,0,0.5)',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  staleBadgeText: { color: '#FFA500', fontSize: 11 },
  infoContainer: { paddingHorizontal: isTV ? 52 : 22, paddingVertical: isTV ? 28 : 22, gap: 10, maxWidth: isTV ? 1100 : undefined, width: '100%', alignSelf: 'center' },
  serieName: { color: colors.white, fontSize: isTV ? 38 : 30, lineHeight: isTV ? 46 : 37, fontWeight: '900' },
  serieRating: { color: colors.accentWarm || '#FFD700', fontSize: isTV ? 18 : 15, fontWeight: '800' },
  seriePlot: { color: colors.textSecondary, fontSize: isTV ? 15 : 13, lineHeight: isTV ? 23 : 20, marginTop: 4 },
  serieGenre: { color: colors.textSecondary, fontSize: 12 },
  serieCast: { color: colors.textSecondary, fontSize: 12 },
  quickActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: isTV ? 52 : 20, marginBottom: 18, maxWidth: isTV ? 1100 : undefined, alignSelf: 'center', width: '100%' },
  quickActionBtn: { backgroundColor: colors.surfaceElevated || colors.card, borderRadius: 14, paddingHorizontal: isTV ? 22 : 16, paddingVertical: isTV ? 15 : 12, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.08)' },
  quickActionActive: { borderColor: colors.accentWarm || colors.accent, backgroundColor: 'rgba(246,182,63,0.14)' },
  quickActionText: { color: colors.white, fontWeight: '800', fontSize: isTV ? 15 : 13 },
  seasonsContainer: { paddingHorizontal: isTV ? 52 : 20, marginBottom: 8, maxWidth: isTV ? 1100 : undefined, alignSelf: 'center', width: '100%' },
  sectionTitle: { color: colors.white, fontSize: isTV ? 24 : 18, fontWeight: '900', marginBottom: 14 },
  seasonsList: { flexDirection: 'row' },
  seasonBtn: {
    paddingHorizontal: isTV ? 24 : 20, paddingVertical: isTV ? 11 : 8, borderRadius: 22,
    backgroundColor: colors.card, borderWidth: 1, borderColor: '#2a2a3a', marginRight: 8,
  },
  seasonBtnActive: { backgroundColor: colors.accentWarm || colors.primary, borderColor: colors.accentWarm || colors.primary },
  seasonBtnFocused: { backgroundColor: 'rgba(246,182,63,0.22)', borderColor: colors.accentWarm || colors.accent },
  seasonText: { color: colors.textSecondary, fontSize: isTV ? 15 : 13, fontWeight: '700' },
  seasonTextActive: { color: '#111', fontWeight: '900' },
  episodesContainer: { paddingHorizontal: isTV ? 52 : 20, paddingVertical: 20, gap: 10, maxWidth: isTV ? 1100 : undefined, alignSelf: 'center', width: '100%' },
  episodeRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceElevated || colors.card,
    borderRadius: 18, overflow: 'hidden', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.08)', gap: 12,
    marginBottom: 8,
  },
  episodeRowFocused: { backgroundColor: 'rgba(246,182,63,0.14)', borderColor: colors.accentWarm || colors.accent },
  episodeRowWatched: { opacity: 0.72, borderColor: 'rgba(50,197,255,0.35)' },
  epThumb: { width: isTV ? 190 : 112, height: isTV ? 108 : 76 },
  epThumbPlaceholder: {
    width: isTV ? 190 : 112, height: isTV ? 108 : 76, backgroundColor: '#0f0f14',
    justifyContent: 'center', alignItems: 'center',
  },
  epNum: { color: colors.primary, fontSize: 20, fontWeight: 'bold' },
  epInfo: { flex: 1, paddingVertical: 10, gap: 4 },
  epTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  epTitle: { color: colors.white, fontSize: isTV ? 20 : 15, lineHeight: isTV ? 26 : 20, fontWeight: '900', flex: 1 },
  epTitleWatched: { color: colors.textSecondary, textDecorationLine: 'line-through' },
  watchedBadge: { color: colors.accent, fontSize: isTV ? 12 : 10, fontWeight: '800', borderWidth: 1, borderColor: 'rgba(50,197,255,0.45)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  epPlot: { color: colors.textSecondary, fontSize: isTV ? 13 : 11 },
  epDuration: { color: colors.accent, fontSize: isTV ? 12 : 11 },
  epActions: { alignItems: 'center', justifyContent: 'center', gap: 8, paddingRight: 12 },
  epWatchedBtn: { minWidth: 34, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 6 },
  epWatchedBtnActive: { borderColor: colors.accent, backgroundColor: 'rgba(50,197,255,0.16)' },
  epWatchedText: { color: colors.textSecondary, fontSize: 13, fontWeight: 'bold' },
  epWatchedTextActive: { color: colors.accent },
  epDownloadBtn: { minWidth: 34, height: 30, borderRadius: 15, backgroundColor: 'rgba(50,197,255,0.12)', borderWidth: 1, borderColor: 'rgba(50,197,255,0.45)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 6 },
  epDownloadBtnActive: { borderColor: '#FFD700', backgroundColor: 'rgba(255,215,0,0.12)' },
  epDownloadBtnDownloaded: { minWidth: isTV ? 64 : 54, borderColor: 'rgba(255,107,107,0.55)', backgroundColor: 'rgba(255,107,107,0.12)' },
  epDownloadText: { color: colors.accent, fontSize: 11, fontWeight: 'bold' },
  epDownloadTextDownloaded: { color: '#ff8c8c' },
  playIcon: { color: colors.accentWarm || colors.primary, fontSize: isTV ? 24 : 18 },
});
