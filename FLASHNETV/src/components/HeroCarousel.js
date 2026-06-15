/**
 * HeroCarousel — carrusel hero con auto-scroll, dots, badge ESTRENO,
 * botones "Reproducir" y "Más info".
 *
 * TV: en lugar de FlatList paginado (no funciona con D-pad),
 *     usa índice manual con botones focalizables para navegar slides.
 * Móvil/Tablet: FlatList con pagingEnabled + swipe + auto-scroll.
 */
import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ImageBackground, useWindowDimensions, FlatList,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { isTV, isTablet, layout } from '../utils/tv';
import { colors } from '../theme';
import { cleanContentTitle } from '../utils/labels';
import FocusableButton from './FocusableButton';

const AUTO_SCROLL_MS = 6000;

const cleanName = cleanContentTitle;

const pickImage = (item = {}) => {
  const raw = item.raw || item;
  const candidates = [
    raw.backdrop_path,
    raw.backdrop,
    raw.cover_big,
    raw.movie_image,
    raw.stream_icon,
    raw.cover,
    raw.poster,
    raw.info?.backdrop_path,
    raw.info?.backdrop,
    raw.info?.cover_big,
    raw.info?.movie_image,
    raw.info?.cover,
  ];

  for (const value of candidates) {
    const image = Array.isArray(value) ? value.find(Boolean) : value;
    if (typeof image === 'string' && image.trim()) return image.trim();
  }
  return null;
};

const isNewRelease = (item) => {
  const year = parseInt(item?.year || item?.releaseDate?.split('-')[0] || '0');
  const cur = new Date().getFullYear();
  return year >= cur - 1 && year > 2000;
};

export default function HeroCarousel({ items = [], types = [], onPlay, onInfo }) {
  const { width, height } = useWindowDimensions();
  const isLandscape  = width > height;
  const heroHeight   = isTV
    ? Math.min(height * layout.heroHeightRatio, 280)
    : isLandscape
    ? Math.min(height * 0.72, 340)
    : height * 0.52;

  const flatRef      = useRef(null);
  const timerRef     = useRef(null);
  const currentRef   = useRef(0);
  const [activeIndex, setActiveIndex] = useState(0);

  const validItems = (items || []).filter(Boolean).slice(0, 8);
  const total      = validItems.length;

  const goTo = useCallback((idx) => {
    const safe = ((idx % total) + total) % total;
    currentRef.current = safe;
    setActiveIndex(safe);
    if (!isTV) {
      try { flatRef.current?.scrollToIndex({ index: safe, animated: true }); } catch (_) {}
    }
  }, [total]);

  const resetTimer = useCallback(() => {
    clearInterval(timerRef.current);
    if (total <= 1) return;
    timerRef.current = setInterval(() => goTo(currentRef.current + 1), AUTO_SCROLL_MS);
  }, [total, goTo]);

  useEffect(() => {
    resetTimer();
    return () => clearInterval(timerRef.current);
  }, [resetTimer]);

  if (total === 0) return null;

  // ─── Slide content (shared between TV and mobile) ─────────────────────────
  const SlideContent = ({ item, index }) => {
    const type   = types[index] || 'movie';
    const image  = pickImage(item);
    const name   = cleanName(item.name || item.title || '');
    const rating = parseFloat(item.rating || 0);
    const isNew  = isNewRelease(item);

    return (
      <ImageBackground
        source={image ? { uri: image } : null}
        style={[styles.slideImage, !image && styles.slideFallback, { height: heroHeight }]}
        resizeMode="cover"
      >
        <LinearGradient
          colors={['rgba(0,0,0,0.02)', 'rgba(8,8,8,0.58)', '#080808']}
          style={StyleSheet.absoluteFillObject}
        />
          <View style={[styles.slideContent, { paddingBottom: isTV ? 24 : 32 }]}>
          <View style={styles.badges}>
            {isNew && (
              <View style={styles.estrenoBadge}>
                <Text style={styles.estrenoText}>ESTRENO</Text>
              </View>
            )}
            <View style={styles.typeBadge}>
              <Text style={styles.typeBadgeText}>
                {type === 'live' ? 'EN VIVO' : type === 'movie' ? 'PELÍCULA' : 'SERIE'}
              </Text>
            </View>
          </View>

          <Text style={[styles.heroTitle, { fontSize: isTV ? 26 : isTablet ? 30 : 26 }]} numberOfLines={2}>
            {name}
          </Text>

          {rating > 0 && (
            <Text style={styles.heroRating}>⭐ {rating.toFixed(1)}</Text>
          )}

          <View style={styles.heroButtons}>
            <FocusableButton
              style={styles.playBtn}
              focusedStyle={styles.playBtnFocused}
              onPress={() => onPlay && onPlay(item, type)}
            >
              <Text style={styles.playBtnText} numberOfLines={1} adjustsFontSizeToFit>▶  Reproducir</Text>
            </FocusableButton>
            <FocusableButton
              style={styles.infoBtn}
              focusedStyle={styles.infoBtnFocused}
              onPress={() => onInfo && onInfo(item, type)}
            >
              <Text style={styles.infoBtnText} numberOfLines={1} adjustsFontSizeToFit>ⓘ  Más info</Text>
            </FocusableButton>
          </View>
        </View>
      </ImageBackground>
    );
  };

  // ─── TV: un solo slide visible, navegar con botones ◀ ▶ ─────────────────
  if (isTV) {
    const item = validItems[activeIndex];
    return (
      <View style={{ height: heroHeight }}>
        <SlideContent item={item} index={activeIndex} />
        {/* Flechas de navegación */}
        {total > 1 && (
          <>
            <FocusableButton
              style={styles.tvArrowLeft}
              onPress={() => { goTo(activeIndex - 1); resetTimer(); }}
            >
              <Text style={styles.tvArrowText}>‹</Text>
            </FocusableButton>
            <FocusableButton
              style={styles.tvArrowRight}
              onPress={() => { goTo(activeIndex + 1); resetTimer(); }}
            >
              <Text style={styles.tvArrowText}>›</Text>
            </FocusableButton>
          </>
        )}
        {/* Dots TV */}
        {total > 1 && (
          <View style={styles.dots}>
            {validItems.map((_, i) => (
              <View key={i} style={[styles.dot, i === activeIndex && styles.dotActive]} />
            ))}
          </View>
        )}
      </View>
    );
  }

  // ─── Móvil/Tablet: FlatList con swipe ────────────────────────────────────
  return (
    <View style={{ height: heroHeight }}>
      <FlatList
        ref={flatRef}
        data={validItems}
        keyExtractor={(_, i) => `hero-${i}`}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.x / width);
          currentRef.current = idx;
          setActiveIndex(idx);
          resetTimer();
        }}
        onScrollBeginDrag={() => clearInterval(timerRef.current)}
        getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
        renderItem={({ item, index }) => (
          <View style={{ width }}>
            <SlideContent item={item} index={index} />
          </View>
        )}
      />
      {total > 1 && (
        <View style={styles.dots}>
          {validItems.map((_, i) => (
            <TouchableOpacity key={i} onPress={() => { goTo(i); resetTimer(); }}>
              <View style={[styles.dot, i === activeIndex && styles.dotActive]} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  slideImage: { width: '100%', justifyContent: 'flex-end' },
  slideFallback: { backgroundColor: '#141422' },
  slideContent: { paddingHorizontal: isTV ? 38 : 22, paddingTop: isTV ? 20 : 18, gap: isTV ? 7 : 9, maxWidth: isTV ? 780 : '100%' },

  badges: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  estrenoBadge: {
    backgroundColor: colors.danger || '#E50914',
    paddingHorizontal: isTV ? 10 : 10,
    paddingVertical: isTV ? 4 : 4,
    borderRadius: 4,
  },
  estrenoText: { color: '#fff', fontSize: isTV ? 11 : 11, fontWeight: '900', letterSpacing: 1 },
  typeBadge: {
    backgroundColor: 'rgba(246,182,63,0.88)',
    paddingHorizontal: isTV ? 10 : 10,
    paddingVertical: isTV ? 4 : 4,
    borderRadius: 4,
  },
  typeBadgeText: { color: '#fff', fontSize: isTV ? 11 : 11, fontWeight: '700', letterSpacing: 1 },
  heroTitle: {
    color: colors.white,
    fontWeight: '900',
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  heroRating: { color: colors.accentWarm || '#FFD700', fontSize: isTV ? 14 : 15, fontWeight: '800' },
  heroButtons: { flexDirection: 'row', gap: isTV ? 12 : 12, marginTop: isTV ? 5 : 8, alignItems: 'center' },
  playBtn: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.accentWarm || colors.white,
    paddingHorizontal: isTV ? 20 : 14,
    paddingVertical: isTV ? 9 : 12,
    borderRadius: 10,
    borderWidth: 3,
    borderColor: 'transparent',
    alignItems: 'center',
  },
  playBtnFocused: { borderColor: colors.white, backgroundColor: '#FFD36B' },
  playBtnText: { color: '#111', fontWeight: '900', fontSize: isTV ? 14 : 15 },
  infoBtn: {
    flex: 1,
    minWidth: 0,
    backgroundColor: 'rgba(80,80,80,0.75)',
    paddingHorizontal: isTV ? 20 : 14,
    paddingVertical: isTV ? 9 : 12,
    borderRadius: 10,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
  },
  infoBtnFocused: { borderColor: colors.accentWarm || colors.accent, backgroundColor: 'rgba(80,80,80,0.95)' },
  infoBtnText: { color: colors.white, fontWeight: '600', fontSize: isTV ? 14 : 15 },

  dots: {
    position: 'absolute',
    bottom: isTV ? 16 : 10,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  dot: {
    width: isTV ? 8 : 6,
    height: isTV ? 8 : 6,
    borderRadius: isTV ? 4 : 3,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  dotActive: {
    width: isTV ? 28 : 20,
    backgroundColor: colors.accentWarm || colors.white,
  },

  // TV arrows
  tvArrowLeft: {
    position: 'absolute',
    left: isTV ? 18 : 16,
    top: '40%',
    backgroundColor: 'rgba(0,0,0,0.5)',
    width: 56, height: 56, borderRadius: 28,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)',
  },
  tvArrowRight: {
    position: 'absolute',
    right: isTV ? 18 : 16,
    top: '40%',
    backgroundColor: 'rgba(0,0,0,0.5)',
    width: 56, height: 56, borderRadius: 28,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)',
  },
  tvArrowText: { color: colors.white, fontSize: 32, fontWeight: 'bold', marginTop: -2 },
});
