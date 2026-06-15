import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLibrary } from '../context/LibraryContext';
import { useDownloads } from '../context/DownloadsContext';
import { colors } from '../theme';
import FocusableButton from '../components/FocusableButton';
import { safeBack, useSafeHardwareBack } from '../utils/navigation';
import { isTV, layout } from '../utils/tv';

const hours = (seconds = 0) => `${(seconds / 3600).toFixed(1)} h`;
const startOfWeek = () => {
  const d = new Date();
  const day = d.getDay() || 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day + 1);
  return d.getTime();
};

export default function StatsScreen({ navigation }) {
  useSafeHardwareBack(navigation, 'Home');
  const { watchStats = [], continueWatching = [], favorites = [], watchedEpisodes = [], clearWatchStats } = useLibrary();
  const { downloads = [] } = useDownloads();

  const stats = useMemo(() => {
    const weekStart = startOfWeek();
    const totalSeconds = watchStats.reduce((sum, row) => sum + Number(row.seconds || 0), 0);
    const weekSeconds = watchStats.filter(row => new Date(row.watchedAt).getTime() >= weekStart).reduce((sum, row) => sum + Number(row.seconds || 0), 0);
    const byType = watchStats.reduce((acc, row) => {
      acc[row.type || 'otros'] = (acc[row.type || 'otros'] || 0) + Number(row.seconds || 0);
      return acc;
    }, {});
    const byCategory = watchStats.reduce((acc, row) => {
      const key = row.category_name || 'Sin categoría';
      acc[key] = (acc[key] || 0) + Number(row.seconds || 0);
      return acc;
    }, {});
    const topCategories = Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const last = watchStats[0];
    return { totalSeconds, weekSeconds, byType, topCategories, last };
  }, [watchStats]);

  const clearStats = () => Alert.alert('Limpiar estadísticas', '¿Quieres borrar el historial local de estadísticas?', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Borrar', style: 'destructive', onPress: clearWatchStats },
  ]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <FocusableButton onPress={() => safeBack(navigation, 'Home')} style={styles.backBtn}><Text style={styles.backText}>← Volver</Text></FocusableButton>
        <Text style={styles.title}>Estadísticas</Text>
        <FocusableButton onPress={clearStats} style={styles.clearBtn}><Text style={styles.clearText}>Borrar</Text></FocusableButton>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.grid}>
          <Card title="Esta semana" value={hours(stats.weekSeconds)} icon="📅" />
          <Card title="Total visto" value={hours(stats.totalSeconds)} icon="⏱" />
          <Card title="Favoritos" value={String(favorites.length)} icon="⭐" />
          <Card title="Episodios vistos" value={String(watchedEpisodes.length)} icon="✅" />
          <Card title="En curso" value={String(continueWatching.length)} icon="▶" />
          <Card title="Descargas" value={String(downloads.length)} icon="⬇" />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Por tipo de contenido</Text>
          <Bar label="Películas" value={stats.byType.movie || 0} max={Math.max(1, stats.totalSeconds)} />
          <Bar label="Series" value={stats.byType.series || 0} max={Math.max(1, stats.totalSeconds)} />
          <Bar label="TV en vivo" value={stats.byType.live || 0} max={Math.max(1, stats.totalSeconds)} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Categorías más vistas</Text>
          {stats.topCategories.length ? stats.topCategories.map(([name, secs]) => (
            <Bar key={name} label={name} value={secs} max={stats.topCategories[0][1]} />
          )) : <Text style={styles.empty}>Aún no hay datos. Mira contenido por unos minutos para llenar esta pantalla.</Text>}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Último contenido registrado</Text>
          <Text style={styles.lastText}>{stats.last?.name || 'Sin reproducciones registradas todavía'}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Card({ icon, title, value }) {
  return <View style={styles.card}><Text style={styles.cardIcon}>{icon}</Text><Text style={styles.cardValue}>{value}</Text><Text style={styles.cardTitle}>{title}</Text></View>;
}

function Bar({ label, value, max }) {
  const pct = Math.max(3, Math.min(100, (Number(value || 0) / Number(max || 1)) * 100));
  return <View style={styles.barRow}><View style={styles.barTop}><Text style={styles.barLabel} numberOfLines={1}>{label}</Text><Text style={styles.barValue}>{hours(value)}</Text></View><View style={styles.track}><View style={[styles.fill, { width: `${pct}%` }]} /></View></View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: layout.horizontalPadding, paddingVertical: isTV ? 18 : 10 },
  backBtn: { padding: 8, borderRadius: 8 },
  backText: { color: colors.accent, fontSize: isTV ? 17 : 14 },
  title: { color: colors.white, fontSize: isTV ? 28 : 20, fontWeight: 'bold' },
  clearBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: colors.primary },
  clearText: { color: colors.primary, fontWeight: '700' },
  content: { paddingHorizontal: layout.horizontalPadding, paddingBottom: 40 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 18 },
  card: { width: isTV ? '31%' : '48%', backgroundColor: colors.card, borderRadius: 16, padding: isTV ? 20 : 14, borderWidth: 1, borderColor: '#2a2a3a' },
  cardIcon: { fontSize: isTV ? 30 : 22, marginBottom: 10 },
  cardValue: { color: colors.white, fontSize: isTV ? 28 : 20, fontWeight: '900' },
  cardTitle: { color: colors.textSecondary, fontSize: isTV ? 15 : 12, marginTop: 4 },
  section: { backgroundColor: colors.card, borderRadius: 16, padding: isTV ? 20 : 14, marginBottom: 16, borderWidth: 1, borderColor: '#2a2a3a' },
  sectionTitle: { color: colors.white, fontSize: isTV ? 20 : 15, fontWeight: '800', marginBottom: 12 },
  barRow: { marginBottom: 12 },
  barTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginBottom: 6 },
  barLabel: { color: colors.white, flex: 1, fontSize: isTV ? 15 : 12 },
  barValue: { color: colors.accent, fontSize: isTV ? 14 : 11, fontWeight: '700' },
  track: { height: 8, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 5, overflow: 'hidden' },
  fill: { height: 8, backgroundColor: colors.accent, borderRadius: 5 },
  empty: { color: colors.textSecondary, fontSize: isTV ? 15 : 12 },
  lastText: { color: colors.textSecondary, fontSize: isTV ? 16 : 13 },
});
