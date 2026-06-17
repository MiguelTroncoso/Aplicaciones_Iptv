import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, Share, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { useLibrary } from '../context/LibraryContext';
import { useDownloads } from '../context/DownloadsContext';
import FocusableButton from '../components/FocusableButton';
import { colors } from '../theme';
import { isTV } from '../utils/tv';
import versionInfo from '../../version.json';

const maskUser = (value = '') => {
  const raw = String(value || 'usuario');
  if (raw.includes('@')) {
    const [name, domain] = raw.split('@');
    return `${name.slice(0, 3)}${name.length > 3 ? '***' : ''}@${domain || ''}`;
  }
  return raw.length > 5 ? `${raw.slice(0, 3)}***${raw.slice(-2)}` : raw;
};

export default function AccountScreen({ navigation }) {
  const { user, signOut, checkSession } = useAuth();
  const { favorites, watchStats } = useLibrary();
  const { downloads } = useDownloads();
  const [adultEnabled, setAdultEnabled] = useState(true);

  const expirationDate = useMemo(() => {
    if (!user?.expiration_date) return 'Sin fecha';
    try {
      return new Date(parseInt(user.expiration_date, 10) * 1000).toLocaleDateString('es-ES');
    } catch (_) {
      return 'Sin fecha';
    }
  }, [user?.expiration_date]);

  const handleShare = async () => {
    try {
      await Share.share({ message: 'FLASHNETV - IPTV simple para Android y TV Box' });
    } catch (_) {}
  };

  const handleCheckSession = async () => {
    const result = await checkSession?.();
    Alert.alert(
      result?.expired ? 'Sesion vencida' : 'Cuenta activa',
      result?.message || `Usuario: ${user?.username || ''}\nVence: ${expirationDate}`
    );
  };

  const confirmSignOut = () => {
    Alert.alert(
      'Cerrar sesion',
      'Quieres salir de FLASHNETV?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Salir', style: 'destructive', onPress: signOut },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.userRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{String(user?.username || 'F').charAt(0).toUpperCase()}</Text>
            </View>
            <View style={styles.userInfo}>
              <Text style={styles.username} numberOfLines={1}>{maskUser(user?.username)}</Text>
              <Text style={styles.userMeta}>Vence: {expirationDate}</Text>
            </View>
            <FocusableButton style={styles.bellBtn} onPress={handleCheckSession}>
              <Text style={styles.bellText}>!</Text>
            </FocusableButton>
          </View>
        </View>

        <View style={styles.quickRow}>
          <FocusableButton style={styles.quickCard} onPress={() => navigation.navigate('Favorites')}>
            <Text style={styles.quickIcon}>♥</Text>
            <Text style={styles.quickText}>Favoritos</Text>
            <Text style={styles.quickCount}>{favorites.length}</Text>
          </FocusableButton>
          <FocusableButton style={styles.quickCard} onPress={() => navigation.navigate('History')}>
            <Text style={styles.quickIcon}>◷</Text>
            <Text style={styles.quickText}>Historial</Text>
            <Text style={styles.quickCount}>{watchStats.length}</Text>
          </FocusableButton>
          <FocusableButton style={styles.quickCard} onPress={handleShare}>
            <Text style={styles.quickIcon}>↗</Text>
            <Text style={styles.quickText}>Compartir</Text>
            <Text style={styles.quickCount}>App</Text>
          </FocusableButton>
        </View>

        <Text style={styles.sectionTitle}>Mas funciones</Text>

        <View style={styles.menu}>
          <MenuRow icon="⌕" label="Buscar contenido" onPress={() => navigation.navigate('Search')} />
          <MenuRow icon="⬇" label="Descargas" value={String(downloads.length)} onPress={() => navigation.navigate('Downloads')} />
          <MenuRow icon="▦" label="Peliculas" onPress={() => navigation.navigate('Movies')} />
          <MenuRow icon="≡" label="Series" onPress={() => navigation.navigate('Series')} />
          <View style={styles.menuRow}>
            <Text style={styles.menuIcon}>18</Text>
            <Text style={styles.menuLabel}>Para adultos</Text>
            <Switch
              value={adultEnabled}
              onValueChange={setAdultEnabled}
              trackColor={{ false: '#333842', true: colors.primary }}
              thumbColor="#fff"
            />
          </View>
          <MenuRow icon="?" label="Ayuda y Feedback" onPress={handleCheckSession} />
          <MenuRow icon="⚙" label="Configuraciones" value={`v${versionInfo.version}`} onPress={handleCheckSession} />
          <MenuRow icon="×" label="Cerrar sesion" danger onPress={confirmSignOut} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function MenuRow({ icon, label, value, danger = false, onPress }) {
  return (
    <FocusableButton style={styles.menuRow} onPress={onPress}>
      <Text style={[styles.menuIcon, danger && styles.dangerText]}>{icon}</Text>
      <Text style={[styles.menuLabel, danger && styles.dangerText]}>{label}</Text>
      <Text style={styles.menuValue}>{value || '›'}</Text>
    </FocusableButton>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111', paddingBottom: isTV ? 0 : 10 },
  scrollContent: { paddingBottom: 112 },
  hero: {
    minHeight: 176,
    backgroundColor: '#07111f',
    justifyContent: 'flex-end',
    paddingHorizontal: 24,
    paddingBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#dbe7ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.primary, fontSize: 34, fontWeight: '900' },
  userInfo: { flex: 1 },
  username: { color: colors.white, fontSize: 22, fontWeight: '700' },
  userMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 3 },
  bellBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellText: { color: colors.white, fontSize: 20, fontWeight: '900' },
  quickRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 24, marginTop: -10 },
  quickCard: {
    flex: 1,
    minHeight: 88,
    backgroundColor: '#2b2a34',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  quickIcon: { color: colors.white, fontSize: 27, fontWeight: '900' },
  quickText: { color: colors.white, fontSize: 14, fontWeight: '700' },
  quickCount: { color: colors.textSecondary, fontSize: 10, fontWeight: '700' },
  sectionTitle: { color: colors.white, fontSize: 24, fontWeight: '500', paddingHorizontal: 24, marginTop: 34, marginBottom: 16 },
  menu: { paddingHorizontal: 22, gap: 6 },
  menuRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 2,
  },
  menuIcon: { width: 28, color: '#b9c1d4', fontSize: 20, fontWeight: '800', textAlign: 'center' },
  menuLabel: { flex: 1, color: colors.white, fontSize: 18, fontWeight: '500' },
  menuValue: { color: '#a8adb8', fontSize: 24, fontWeight: '300' },
  dangerText: { color: colors.danger },
});
