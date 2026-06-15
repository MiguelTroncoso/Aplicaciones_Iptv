import React, { useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, Image,
} from 'react-native';
import { colors } from '../theme';
import { isTV, layout } from '../utils/tv';
import FocusableButton from './FocusableButton';
import { cleanContentTitle, cleanCategoryName } from '../utils/labels';

const CARD_WIDTH = layout.posterWidth;
const POSTER_HEIGHT = layout.posterHeight;
const CARD_TEXT_HEIGHT = isTV ? 58 : 86;
const FOCUS_PAD = isTV ? 20 : 18;
const ROW_LIST_HEIGHT = POSTER_HEIGHT + CARD_TEXT_HEIGHT + FOCUS_PAD * 2;
const ROW_MARGIN_BOTTOM = isTV ? 24 : 40;

const CURRENT_YEAR = new Date().getFullYear();
const ONE_YEAR_MS  = 365 * 24 * 60 * 60 * 1000;

const cleanName = cleanContentTitle;

const isNewRelease = (item) => {
  const raw = item?.raw || item || {};
  const year = parseInt(raw.year || raw.releaseDate?.split('-')[0] || '0');
  if (year >= CURRENT_YEAR - 1 && year > 2000) return true;
  const added = parseInt(raw.added || '0');
  if (added > 0) return (Date.now() - added * 1000) < ONE_YEAR_MS;
  return false;
};

export default function ContentRow({
  title,
  subtitle,
  data,
  onPress,
  type,
  showFavoriteButton = false,
  isFavorite = () => false,
  onFavoritePress,
  showProgress = false,
  showEstrenoBadge = false,
  onSeeAll,
}) {
  const [focusedKey, setFocusedKey] = useState(null);

  if (!data || data.length === 0) return null;

  const renderItem = ({ item, index }) => {
    const raw = item.raw || item;
    const uid = item.id || raw.id || item.stream_id || raw.stream_id || item.series_id || raw.series_id || raw.name || raw.title || 'c';
    const itemKey = `${item.type || type || 'row'}-${uid}-${index}`;
    const focused = focusedKey === itemKey;
    const image = item.stream_icon || item.cover || raw.stream_icon || raw.cover || raw.info?.movie_image || item.poster || raw.poster;
    const name = cleanName(item.name || raw.name || raw.title || 'Sin nombre');
    const rating = item.rating || raw.rating;
    const favoriteType = item.type || type;
    const favActive = isFavorite(raw, favoriteType);
    const progress = item.progress || 0;
    const showEstreno = showEstrenoBadge && isNewRelease(item);

    return (
      <FocusableButton
        style={[styles.card, focused && styles.cardActive, { marginRight: index === data.length - 1 ? 0 : layout.cardGap }]}
        focusedStyle={styles.cardFocused}
        onPress={() => onPress(raw, item)}
        onLongPress={() => showFavoriteButton && onFavoritePress?.(raw, favoriteType)}
        onFocus={() => setFocusedKey(itemKey)}
        onBlur={() => setFocusedKey(prev => (prev === itemKey ? null : prev))}
      >
        <View style={[styles.posterWrapper, focused && styles.posterWrapperActive]}>
          {focused && <View style={styles.focusHalo} pointerEvents="none" />}
          {image ? (
            <Image source={{ uri: image }} style={styles.poster} resizeMode="cover" />
          ) : (
            <View style={styles.posterPlaceholder}>
              <Text style={styles.posterIcon}>
                {favoriteType === 'live' ? '📺' : favoriteType === 'movie' ? '🎬' : '📡'}
              </Text>
            </View>
          )}

          {/* Badge ESTRENO */}
          {showEstreno && (
            <View style={styles.estrenoBadge}>
              <Text style={styles.estrenoText}>ESTRENO</Text>
            </View>
          )}

          {favoriteType === 'live' && (
            <View style={styles.liveBadge}>
              <Text style={styles.liveText}>● VIVO</Text>
            </View>
          )}

          {showFavoriteButton && (!isTV || favActive) && (
            <TouchableOpacity
              style={styles.favoriteBtn}
              onPress={(e) => {
                e.stopPropagation();
                onFavoritePress && onFavoritePress(raw, favoriteType);
              }}
            >
              <Text style={styles.favoriteIcon}>{favActive ? '★' : '☆'}</Text>
            </TouchableOpacity>
          )}

          {showProgress && progress > 0 && (
            <View style={styles.progressTrack}>
              <View style={[styles.progressBar, { width: `${Math.min(progress * 100, 100)}%` }]} />
            </View>
          )}

          {/* Rating badge en la esquina inferior izquierda */}
          {rating && rating !== '0' && !Number.isNaN(parseFloat(rating)) && (
            <View style={styles.ratingBadge}>
              <Text style={styles.ratingBadgeText}>★ {parseFloat(rating).toFixed(1)}</Text>
            </View>
          )}
        </View>

        <View style={[styles.textArea, focused && styles.textAreaActive]}>
          <Text style={[styles.cardTitle, focused && styles.cardTitleActive]} numberOfLines={focused ? 3 : 2}>{name}</Text>
        </View>
      </FocusableButton>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={styles.rowTitle} numberOfLines={1}>{cleanCategoryName(title)}</Text>
          {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
        </View>
        {onSeeAll && (
          <FocusableButton style={styles.seeAllBtn} onPress={onSeeAll}>
            <Text style={styles.seeAll}>Ver todo</Text>
          </FocusableButton>
        )}
      </View>

      <FlatList
        data={data}
        renderItem={renderItem}
        getItemLayout={(_, index) => ({
          length: CARD_WIDTH + layout.cardGap,
          offset: (CARD_WIDTH + layout.cardGap) * index,
          index,
        })}
        keyExtractor={(item, index) => {
          const raw = item.raw || item;
          const uid = item.id || raw.id || item.stream_id || raw.stream_id || item.series_id || raw.series_id || raw.name || raw.title || 'c';
          return `${item.type || type || 'row'}-${uid}-${index}`;
        }}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.flatList}
        contentContainerStyle={styles.list}
        initialNumToRender={isTV ? 10 : 6}
        maxToRenderPerBatch={isTV ? 12 : 8}
        windowSize={5}
        removeClippedSubviews={!isTV}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: ROW_MARGIN_BOTTOM, overflow: 'visible' },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: layout.horizontalPadding,
    marginBottom: isTV ? 12 : 12,
  },
  headerText: { flex: 1, paddingRight: 12 },
  rowTitle: { color: colors.white, fontSize: isTV ? 19 : 20, lineHeight: isTV ? 24 : 26, fontWeight: '900', letterSpacing: 0.2 },
  rowSubtitle: { color: colors.textSecondary, fontSize: isTV ? 12 : 12, marginTop: 2 },
  seeAllBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: 'transparent' },
  seeAll: { color: colors.accentWarm || colors.accent, fontSize: isTV ? 14 : 13, fontWeight: '800' },
  flatList: { height: ROW_LIST_HEIGHT, overflow: 'visible' },
  list: { paddingHorizontal: layout.horizontalPadding, paddingTop: FOCUS_PAD, paddingBottom: FOCUS_PAD },
  card: { width: CARD_WIDTH, height: POSTER_HEIGHT + CARD_TEXT_HEIGHT, borderWidth: 2, borderColor: 'transparent', borderRadius: 14, overflow: 'visible' },
  cardActive: { zIndex: 80, elevation: 28 },
  cardFocused: { backgroundColor: 'rgba(246,182,63,0.08)', borderColor: 'rgba(255,255,255,0.92)' },
  posterWrapper: { width: CARD_WIDTH, height: POSTER_HEIGHT, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.card, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  posterWrapperActive: {
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 30,
  },
  focusHalo: {
    position: 'absolute',
    left: -8,
    right: -8,
    top: -8,
    bottom: -8,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.accentWarm || '#F6B63F',
    backgroundColor: 'rgba(246,182,63,0.08)',
  },
  poster: { width: CARD_WIDTH, height: POSTER_HEIGHT, backgroundColor: colors.card },
  posterPlaceholder: { width: CARD_WIDTH, height: POSTER_HEIGHT, backgroundColor: colors.card, justifyContent: 'center', alignItems: 'center' },
  posterIcon: { fontSize: isTV ? 32 : 36 },

  // Badge ESTRENO
  estrenoBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: colors.danger || '#E50914',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
  },
  estrenoText: { color: '#fff', fontSize: isTV ? 10 : 8, fontWeight: '900', letterSpacing: 0.5 },

  liveBadge: { position: 'absolute', top: 8, left: 8, backgroundColor: 'rgba(255,0,0,0.8)', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4 },
  liveText: { color: colors.white, fontSize: isTV ? 11 : 9, fontWeight: 'bold' },

  favoriteBtn: { position: 'absolute', top: 8, right: 8, width: isTV ? 28 : 30, height: isTV ? 28 : 30, borderRadius: isTV ? 14 : 15, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  favoriteIcon: { color: colors.accentWarm || '#FFD700', fontSize: isTV ? 17 : 18, fontWeight: 'bold' },

  progressTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 5, backgroundColor: 'rgba(255,255,255,0.18)' },
  progressBar: { height: 5, backgroundColor: colors.accentWarm || colors.primary },

  // Rating badge en poster
  ratingBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.72)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  ratingBadgeText: { color: colors.accentWarm || '#FFD700', fontSize: isTV ? 12 : 10, fontWeight: '800' },

  textArea: { minHeight: CARD_TEXT_HEIGHT, paddingTop: 7, paddingRight: 4, zIndex: 2 },
  textAreaActive: { paddingTop: 9 },
  cardTitle: { color: colors.white, fontSize: isTV ? 12 : 14, lineHeight: isTV ? 16 : 19, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.55)', textShadowRadius: 2 },
  cardTitleActive: { color: '#fff', fontSize: isTV ? 13 : 15, lineHeight: isTV ? 17 : 20, fontWeight: '900' },
});
