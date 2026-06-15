import { Platform, Dimensions } from 'react-native';

const { width: W, height: H } = Dimensions.get('window');

// ─── Detección de plataforma ──────────────────────────────────────────────────
// Platform.isTV es true en Fire Stick, Android TV y Google TV cuando
// la app fue compilada con el intent-filter LEANBACK_LAUNCHER.
// El fallback por ancho solo aplica si Platform.isTV no está disponible
// Y diferenciamos TV de tablet usando el aspect ratio:
// TVs tienen aspect ratio ~16:9 (landscape forzado, W > H siempre)
// Tablets pueden estar en portrait (H > W) o landscape

const platformIsTV = Platform.isTV === true;
const aspectRatio = W / H;
// TV: Platform.isTV activo, O pantalla muy ancha en Android landscape.
// El fallback es necesario porque algunos Android TV sideloaded no reportan Platform.isTV.
const isTV = platformIsTV || (W >= 960 && aspectRatio >= 1.6 && H <= 720) || (Platform.OS === 'android' && W >= 1280 && aspectRatio >= 1.6);
const isTablet = !isTV && (W >= 768 || H >= 768);
const isLargeScreen = isTV || isTablet;

// Laptop emulando móvil: W < 480 en ventana pequeña, tratar como móvil
// Laptop con ventana grande: W >= 768, tratar como tablet

export { isTV, isTablet, isLargeScreen };

// ─── Columnas de grilla según ancho real ─────────────────────────────────────
// Usa el ancho real de pantalla para calcular cuántas columnas caben
// en vez de valores fijos — así funciona en cualquier resolución
const getGridColumns = () => {
  if (isTV) return 8;
  if (W >= 1200) return 5;      // laptop ventana grande
  if (W >= 900) return 4;       // tablet landscape o laptop pequeño
  if (W >= 768) return 4;       // tablet portrait
  if (W >= 600) return 3;       // tablet pequeña
  return 2;                     // móvil
};

const getPosterWidth = () => {
  if (isTV) return 100;
  if (W >= 900) return 180;
  if (W >= 768) return 160;
  return 130;
};

const getPosterHeight = () => {
  if (isTV) return 142;
  if (W >= 900) return 255;
  if (W >= 768) return 230;
  return 190;
};

export const layout = {
  posterWidth:       getPosterWidth(),
  posterHeight:      getPosterHeight(),
  cardGap:           isTV ? 12 : isTablet ? 14 : 10,
  horizontalPadding: isTV ? 30 : W >= 900 ? 32 : isTablet ? 24 : 16,
  heroHeightRatio:   isTV ? 0.30 : isTablet ? 0.50 : 0.55,
  gridColumns:       getGridColumns(),
  minTouchTarget:    isTV ? 52 : isTablet ? 48 : 44,
  fontSize: {
    xs:   isTV ? 12 : isTablet ? 13 : 11,
    sm:   isTV ? 14 : isTablet ? 14 : 12,
    base: isTV ? 16 : isTablet ? 16 : 14,
    lg:   isTV ? 20 : isTablet ? 20 : 17,
    xl:   isTV ? 24 : isTablet ? 24 : 20,
    xxl:  isTV ? 30 : isTablet ? 30 : 24,
  },
};
