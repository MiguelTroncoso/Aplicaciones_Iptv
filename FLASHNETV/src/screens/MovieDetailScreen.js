import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet,
  ScrollView, Image, useWindowDimensions, Share, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useLibrary } from '../context/LibraryContext';
import { useDownloads } from '../context/DownloadsContext';
import { colors, shadows } from '../theme';
import { isTV, layout } from '../utils/tv';
import FocusableButton from '../components/FocusableButton';
import { safeBack, useSafeHardwareBack } from '../utils/navigation';
import logger from '../utils/logger';
import { getResumePositionMillis, promptResumePlayback, shouldAskResume } from '../utils/resumePlayback';

const pickBackdrop = (raw, poster) => {
  const value = raw.backdrop_path || raw.backdrop || raw.info?.backdrop_path;
  if (Array.isArray(value)) return value[0] || poster;
  return value || poster;
};

export default function MovieDetailScreen({ route, navigation }) {
  const { stream, type = 'movie', returnRoute = 'Home', returnParams } = route.params;
  const { width, height } = useWindowDimensions();
  const { isFavorite, toggleFavorite, isInWatchlist, toggleWatchlist, getContinueWatchingItem } = useLibrary();
  const { isDownloaded, downloadItem, getDownloadedItem, getProgress } = useDownloads();
  const [fav, setFav] = useState(false);
  const [watchlisted, setWatchlisted] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [infoVisible, setInfoVisible] = useState(false);

  // Evita que el botón físico atrás cierre Android cuando esta pantalla quedó sola en el stack.
  useSafeHardwareBack(navigation, returnRoute, returnParams);

  const raw = stream?.raw || stream || {};
  const title = raw.name || raw.title || 'Sin título';
  const poster = raw.cover || raw.stream_icon || raw.info?.movie_image || null;
  const backdrop = pickBackdrop(raw, poster);
  const rating = raw.rating || raw.info?.rating || null;
  const plot = raw.plot || raw.info?.plot || raw.description || null;
  const genre = raw.genre || raw.info?.genre || raw.category_name || null;
  const cast = raw.cast || raw.info?.cast || null;
  const director = raw.director || raw.info?.director || null;
  const duration = raw.info?.duration || raw.duration || null;
  const year = raw.year || raw.info?.releasedate?.split('-')?.[0] || null;

  const isLandscape = width > height;
  const heroHeight = isTV ? Math.min(460, Math.max(300, Math.round(height * 0.46))) : isLandscape ? 300 : 330;
  const posterW = isTV ? 138 : 100;
  const posterH = isTV ? 206 : 150;

  useEffect(() => {
    setFav(isFavorite(raw, type));
    setWatchlisted(isInWatchlist(raw, type));
    setDownloaded(isDownloaded(raw, type));
  }, [raw, type, isFavorite, isInWatchlist, isDownloaded]);

  const openPlayer = (resumePosition = 0) => {
    const dl = getDownloadedItem(raw, type);
    navigation.navigate('Player', {
      stream: raw,
      type,
      resumePosition,
      offlineUri: dl?.fileUri || null,
      offlineMode: Boolean(dl?.fileUri),
      returnRoute: 'MovieDetail',
      returnParams: { stream: raw, type },
    });
  };

  const handlePlay = () => {
    const resumeItem = getContinueWatchingItem(raw, type);
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
  };

  const handleFavorite = async () => {
    const next = await toggleFavorite(raw, type);
    setFav(next);
  };

  const handleWatchlist = async () => {
    const next = await toggleWatchlist(raw, type);
    setWatchlisted(next);
  };

  const handleDownload = async () => {
    if (downloaded || downloading) return;
    setDownloading(true);
    const result = await downloadItem(raw, type);
    setDownloading(false);
    if (result?.success) setDownloaded(true);
  };

  const handleShare = async () => {
    try {
      const safeRating = rating && !isNaN(parseFloat(rating)) ? `⭐ ${parseFloat(rating).toFixed(1)}` : '';
      const lines = [`🎬 Te recomiendo "${title}"`, safeRating, genre || '', '', 'Disponible en FLASHNETV'].filter(Boolean);
      await Share.share({ message: lines.join('\n') });
    } catch (e) {
      if (e?.message !== 'User did not share') logger.log('Share movie error:', e?.message || e);
    }
  };

  const downloadLabel = downloaded
    ? '✅ Descargada'
    : downloading
      ? `⬇ ${Math.round((getProgress(raw, type) || 0) * 100)}%`
      : '⬇ Descargar';

  const renderInfoModal = () => (
    <Modal visible={infoVisible} transparent animationType="fade" onRequestClose={() => setInfoVisible(false)}>
      <View style={styles.modalOverlay}>
        <View style={[styles.infoModal, isTV && styles.infoModalTV]}>
          <Text style={styles.modalTitle} numberOfLines={2}>{title}</Text>
          <View style={styles.modalMetaRow}>
            {year && <Text style={styles.modalMeta}>{year}</Text>}
            {duration && <Text style={styles.modalMeta}>• {duration}</Text>}
            {rating && !isNaN(parseFloat(rating)) && <Text style={styles.modalRating}>★ {parseFloat(rating).toFixed(1)}</Text>}
          </View>

          {plot ? (
            <ScrollView style={styles.modalPlotScroll} showsVerticalScrollIndicator>
              <Text style={styles.modalPlot}>{plot}</Text>
              {director && <Text style={styles.modalDetail}><Text style={styles.modalDetailLabel}>Director: </Text>{director}</Text>}
              {genre && <Text style={styles.modalDetail}><Text style={styles.modalDetailLabel}>Género: </Text>{genre}</Text>}
              {cast && <Text style={styles.modalDetail}><Text style={styles.modalDetailLabel}>Reparto: </Text>{cast}</Text>}
            </ScrollView>
          ) : (
            <Text style={styles.modalPlot}>Sin sinopsis disponible.</Text>
          )}

          <View style={styles.modalActions}>
            <FocusableButton style={styles.modalPlayBtn} focusedStyle={styles.focusedLight} onPress={() => { setInfoVisible(false); handlePlay(); }}>
              <Text style={styles.modalPlayText}>▶ Reproducir</Text>
            </FocusableButton>
            <FocusableButton style={styles.modalSecondaryBtn} focusedStyle={styles.focusedPill} onPress={handleFavorite}>
              <Text style={styles.modalSecondaryText}>{fav ? '★ Favorito' : '☆ Favorito'}</Text>
            </FocusableButton>
            <FocusableButton style={styles.modalSecondaryBtn} focusedStyle={styles.focusedPill} onPress={handleWatchlist}>
              <Text style={styles.modalSecondaryText}>{watchlisted ? '✓ Ver después' : '+ Ver después'}</Text>
            </FocusableButton>
            {type !== 'live' && (
              <FocusableButton style={styles.modalSecondaryBtn} focusedStyle={styles.focusedPill} onPress={handleDownload}>
                <Text style={styles.modalSecondaryText}>{downloadLabel}</Text>
              </FocusableButton>
            )}
          </View>

          <View style={styles.modalBottomActions}>
            <FocusableButton style={styles.shareBtn} focusedStyle={styles.focusedPill} onPress={handleShare}>
              <Text style={styles.shareBtnText}>↗ Compartir</Text>
            </FocusableButton>
            <FocusableButton style={styles.closeBtn} focusedStyle={styles.focusedPill} onPress={() => setInfoVisible(false)}>
              <Text style={styles.closeBtnText}>Cerrar</Text>
            </FocusableButton>
          </View>
        </View>
      </View>
    </Modal>
  );

  return (
    <SafeAreaView style={styles.safe} edges={isTV ? [] : ['top']}>
      {renderInfoModal()}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View style={[styles.heroContainer, { width, height: heroHeight }]}>
          {backdrop ? (
            <Image source={{ uri: backdrop }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0f0f14' }]} />
          )}
          <LinearGradient
            colors={['rgba(0,0,0,0.05)', 'rgba(8,8,8,0.68)', colors.background]}
            style={StyleSheet.absoluteFill}
          />
          <FocusableButton
            style={styles.backBtn}
            focusedStyle={styles.focusedPill}
            onPress={() => safeBack(navigation, returnRoute, returnParams)}
            hasTVPreferredFocus={isTV}
          >
            <Text style={styles.backText}>← Volver</Text>
          </FocusableButton>
        </View>

        <View style={[styles.content, isTV && styles.contentTV]}>
          <View style={styles.topRow}>
            {poster && (
              <View style={[styles.posterWrapper, { width: posterW, height: posterH }]}>
                <Image source={{ uri: poster }} style={styles.poster} resizeMode="cover" />
              </View>
            )}

            <View style={styles.infoBlock}>
              <Text style={styles.title} numberOfLines={isTV ? 2 : 3}>{title}</Text>
              <View style={styles.metaRow}>
                {year && <Text style={styles.metaText}>{year}</Text>}
                {duration && <Text style={styles.metaDot}>·</Text>}
                {duration && <Text style={styles.metaText}>{duration}</Text>}
                {rating && !isNaN(parseFloat(rating)) && (
                  <>
                    <Text style={styles.metaDot}>·</Text>
                    <Text style={styles.ratingText}>⭐ {parseFloat(rating).toFixed(1)}</Text>
                  </>
                )}
              </View>
              {genre && <Text style={styles.genre} numberOfLines={2}>{genre}</Text>}
            </View>
          </View>

          <View style={styles.actionsMain}>
            <FocusableButton style={styles.playBtn} focusedStyle={styles.focusedLight} onPress={handlePlay}>
              <Text style={styles.playBtnText} numberOfLines={1}>▶ Reproducir</Text>
            </FocusableButton>
            <FocusableButton style={styles.infoBtn} focusedStyle={styles.focusedPill} onPress={() => setInfoVisible(true)}>
              <Text style={styles.infoBtnText} numberOfLines={1}>ⓘ Más info</Text>
            </FocusableButton>
          </View>

          <View style={styles.actionsSecondary}>
            <FocusableButton style={[styles.secondaryBtn, fav && styles.secondaryBtnActive]} focusedStyle={styles.focusedPill} onPress={handleFavorite}>
              <Text style={styles.secondaryBtnText}>{fav ? '★ Favorito' : '☆ Favorito'}</Text>
            </FocusableButton>
            <FocusableButton style={[styles.secondaryBtn, watchlisted && styles.secondaryBtnActive]} focusedStyle={styles.focusedPill} onPress={handleWatchlist}>
              <Text style={styles.secondaryBtnText}>{watchlisted ? '✓ Ver después' : '+ Ver después'}</Text>
            </FocusableButton>
            {type !== 'live' && (
              <FocusableButton
                style={[styles.secondaryBtn, downloaded && styles.secondaryBtnActive, downloading && styles.iconBtnDownloading]}
                focusedStyle={styles.focusedPill}
                onPress={handleDownload}
              >
                <Text style={styles.secondaryBtnText}>{downloadLabel}</Text>
              </FocusableButton>
            )}
            <FocusableButton style={styles.shareBtnInline} focusedStyle={styles.focusedPill} onPress={handleShare}>
              <Text style={styles.secondaryBtnText}>↗ Compartir</Text>
            </FocusableButton>
          </View>

          {plot ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Sinopsis</Text>
              <Text style={styles.plot} numberOfLines={isTV ? 4 : 7}>{plot}</Text>
            </View>
          ) : null}

          {(director || cast) && (
            <View style={styles.section}>
              {director && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Director</Text>
                  <Text style={styles.detailValue}>{director}</Text>
                </View>
              )}
              {cast && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Reparto</Text>
                  <Text style={styles.detailValue} numberOfLines={isTV ? 2 : 3}>{cast}</Text>
                </View>
              )}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scrollContent: { paddingBottom: 28 },
  heroContainer: { position: 'relative' },
  backBtn: {
    position: 'absolute',
    top: isTV ? 24 : 34,
    left: isTV ? 34 : 16,
    backgroundColor: 'rgba(0,0,0,0.62)',
    paddingHorizontal: isTV ? 20 : 14,
    paddingVertical: isTV ? 11 : 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  focusedPill: { backgroundColor: 'rgba(246,182,63,0.22)', borderColor: colors.accentWarm || colors.accent, borderWidth: 2 },
  backText: { color: colors.accent, fontSize: isTV ? 17 : 14, fontWeight: '700' },
  content: { paddingHorizontal: layout.horizontalPadding, paddingTop: 0, marginTop: -26 },
  contentTV: { maxWidth: 1120, alignSelf: 'center', width: '100%', marginTop: -52 },
  topRow: { flexDirection: 'row', gap: 16, alignItems: 'flex-end', marginBottom: 18 },
  posterWrapper: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#2a2a3a',
    ...shadows.glowPurple,
  },
  poster: { width: '100%', height: '100%' },
  infoBlock: { flex: 1, paddingBottom: 6 },
  title: { color: colors.white, fontSize: isTV ? 42 : 30, lineHeight: isTV ? 50 : 37, fontWeight: '900', marginBottom: 10 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  metaText: { color: colors.textSecondary, fontSize: isTV ? 15 : 12 },
  metaDot: { color: colors.textSecondary, fontSize: 12 },
  ratingText: { color: colors.accentWarm || '#FFD700', fontSize: isTV ? 15 : 12 },
  genre: { color: colors.accentWarm || colors.accent, fontSize: isTV ? 14 : 11, fontWeight: '600' },

  actionsMain: { flexDirection: 'row', gap: 12, marginBottom: 12, alignItems: 'center' },
  playBtn: {
    flex: 1,
    backgroundColor: colors.accentWarm || colors.white,
    paddingVertical: isTV ? 15 : 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: isTV ? 56 : 50,
  },
  focusedLight: { borderColor: colors.white, borderWidth: 3, backgroundColor: '#FFD36B' },
  playBtnText: { color: '#111', fontWeight: '900', fontSize: isTV ? 17 : 15 },
  infoBtn: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.10)',
    paddingVertical: isTV ? 15 : 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: isTV ? 56 : 50,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  infoBtnText: { color: colors.white, fontWeight: 'bold', fontSize: isTV ? 17 : 15 },
  actionsSecondary: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginBottom: isTV ? 20 : 24 },
  secondaryBtn: {
    flexGrow: 1,
    minWidth: isTV ? 170 : 140,
    backgroundColor: colors.surfaceElevated || colors.card,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingVertical: isTV ? 13 : 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  secondaryBtnActive: { borderColor: colors.accentWarm || colors.accent, backgroundColor: 'rgba(246,182,63,0.14)' },
  shareBtnInline: {
    flexGrow: 1,
    minWidth: isTV ? 170 : 140,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: '#2a2a3a',
    paddingVertical: isTV ? 13 : 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  iconBtnDownloading: { opacity: 0.65 },
  secondaryBtnText: { color: colors.white, fontSize: isTV ? 15 : 13, fontWeight: '800' },
  section: { marginBottom: isTV ? 18 : 24 },
  sectionTitle: { color: colors.white, fontSize: isTV ? 24 : 18, fontWeight: '900', marginBottom: 10 },
  plot: { color: colors.textSecondary, fontSize: isTV ? 18 : 16, lineHeight: isTV ? 29 : 26 },
  detailRow: { flexDirection: 'row', gap: 12, marginBottom: 10 },
  detailLabel: { color: colors.textSecondary, fontSize: isTV ? 13 : 11, width: 70, paddingTop: 2 },
  detailValue: { color: colors.white, fontSize: isTV ? 14 : 12, flex: 1, lineHeight: 18 },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.76)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: isTV ? 56 : 20,
  },
  infoModal: {
    width: '100%',
    maxWidth: 640,
    maxHeight: '88%',
    backgroundColor: '#121218',
    borderRadius: 18,
    padding: isTV ? 28 : 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.13)',
  },
  infoModalTV: { maxWidth: 860 },
  modalTitle: { color: colors.white, fontSize: isTV ? 28 : 22, fontWeight: '900', marginBottom: 8 },
  modalMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  modalMeta: { color: colors.textSecondary, fontSize: isTV ? 16 : 13 },
  modalRating: { color: '#FFD700', fontSize: isTV ? 16 : 13, fontWeight: '800' },
  modalPlotScroll: { maxHeight: isTV ? 260 : 260, marginBottom: 18 },
  modalPlot: { color: colors.white, fontSize: isTV ? 17 : 15, lineHeight: isTV ? 26 : 23, marginBottom: 16 },
  modalDetail: { color: colors.textSecondary, fontSize: isTV ? 15 : 13, lineHeight: isTV ? 23 : 20, marginTop: 6 },
  modalDetailLabel: { color: colors.white, fontWeight: '800' },
  modalActions: { flexDirection: isTV ? 'row' : 'column', gap: 10, marginBottom: 12 },
  modalPlayBtn: {
    flex: 1,
    backgroundColor: colors.accentWarm || colors.white,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalPlayText: { color: '#000', fontWeight: '900', fontSize: isTV ? 16 : 14 },
  modalSecondaryBtn: {
    flex: 1,
    backgroundColor: colors.card,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2a2a3a',
  },
  modalSecondaryText: { color: colors.white, fontWeight: '800', fontSize: isTV ? 15 : 13 },
  modalBottomActions: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  shareBtn: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  shareBtnText: { color: colors.accent, fontWeight: '700' },
  closeBtn: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  closeBtnText: { color: colors.white, fontWeight: '700' },
});
