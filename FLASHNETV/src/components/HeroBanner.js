import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ImageBackground, useWindowDimensions } from 'react-native';
import { isTV, isTablet } from '../utils/tv';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../theme';

export default function HeroBanner({ item, onPress, type }) {
  // useWindowDimensions re-renderiza cuando rota la pantalla
  const { width, height } = useWindowDimensions();
  // En landscape (width > height) limitamos la altura para no ocultar el contenido debajo
  const isLandscape = width > height;
  const heroHeight = isTV
    ? height * 0.65
    : isLandscape
    ? Math.min(height * 0.70, 360)
    : height * 0.52;

  if (!item) return null;

  // Busca la mejor imagen disponible (evita el bug de item.stream_icon duplicado)
  const image = item.cover || item.stream_icon || item.info?.movie_image || null;

  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress} style={{ width, height: heroHeight }}>
      <ImageBackground
        source={image ? { uri: image } : null}
        style={styles.image}
        resizeMode="cover"
      >
        <LinearGradient
          colors={['transparent', 'rgba(8,8,8,0.85)', '#080808']}
          style={styles.gradient}
        >
          <View style={styles.info}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {type === 'live' ? '🔴 EN VIVO' : type === 'movie' ? '🎬 PELÍCULA' : '📡 SERIE'}
              </Text>
            </View>
            <Text style={styles.title} numberOfLines={2}>{item.name}</Text>
            {item.rating && item.rating !== '0' && !isNaN(parseFloat(item.rating)) && (
              <Text style={styles.rating}>⭐ {parseFloat(item.rating).toFixed(1)}</Text>
            )}
            <View style={styles.buttons}>
              <TouchableOpacity style={styles.playBtn} onPress={onPress}>
                <Text style={styles.playBtnText}>▶  Reproducir</Text>
              </TouchableOpacity>
            </View>
          </View>
        </LinearGradient>
      </ImageBackground>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  image: { flex: 1 },
  gradient: { flex: 1, justifyContent: 'flex-end' },
  info: { padding: 20, gap: 8 },
  badge: {
    backgroundColor: 'rgba(91,61,245,0.85)',
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
  },
  badgeText: { color: colors.white, fontSize: 11, fontWeight: 'bold', letterSpacing: 1 },
  title: {
    color: colors.white,
    fontSize: 28,
    fontWeight: 'bold',
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  rating: { color: '#FFD700', fontSize: 14 },
  buttons: { flexDirection: 'row', gap: 12, marginTop: 8 },
  playBtn: {
    backgroundColor: colors.white,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  playBtnText: { color: '#000', fontWeight: 'bold', fontSize: 15 },
});
