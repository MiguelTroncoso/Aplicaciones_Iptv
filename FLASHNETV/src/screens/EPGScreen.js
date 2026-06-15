import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, TextInput, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { getLiveStreams, getShortEPG } from '../services/xtream';
import { getCache, saveCache } from '../services/contentCache';
import { colors, shadows } from '../theme';
import FocusableButton from '../components/FocusableButton';
import { isTV, layout } from '../utils/tv';
import { safeBack, useSafeHardwareBack } from '../utils/navigation';
import logger from '../utils/logger';

const decodeBase64Utf8 = (encoded = '') => {
  const decoded = global.atob(encoded);
  return decodeURIComponent(Array.from(decoded).map(ch =>
    `%${ch.charCodeAt(0).toString(16).padStart(2, '0')}`
  ).join(''));
};

const safeDecode = (value = '') => {
  try {
    const s = String(value || '');
    if (!s) return '';
    if (typeof global.atob === 'function' && /^[A-Za-z0-9+/=]+$/.test(s) && s.length % 4 === 0) {
      return decodeBase64Utf8(s);
    }
    return s;
  } catch (_) { return String(value || ''); }
};

const formatEpgTime = (value) => {
  if (!value) return '';
  const raw = String(value);
  const date = raw.includes(' ') ? new Date(raw.replace(' ', 'T')) : new Date(Number(raw) * 1000);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
};

export default function EPGScreen({ navigation }) {
  useSafeHardwareBack(navigation, 'Home');
  const { user, server } = useAuth();
  const [channels, setChannels] = useState([]);
  const [selected, setSelected] = useState(null);
  const [epg, setEpg] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [epgLoading, setEpgLoading] = useState(false);

  useEffect(() => { loadChannels(); }, []);

  const loadChannels = async () => {
    try {
      setLoading(true);
      const cached = await getCache(server.url, user.username, 'live', 'all');
      if (cached?.data?.length) {
        setChannels(cached.data);
        setSelected(cached.data[0]);
        setLoading(false);
        loadEpg(cached.data[0]);
        if (cached.isFresh) return;
      }
      const data = await getLiveStreams(server.url, user.username, user.password);
      const list = Array.isArray(data) ? data : [];
      setChannels(list);
      await saveCache(server.url, user.username, 'live', 'all', list);
      if (list[0]) { setSelected(list[0]); loadEpg(list[0]); }
    } catch (e) {
      logger.log('EPG channels error:', e?.message || e);
    } finally { setLoading(false); }
  };

  const loadEpg = async (channel) => {
    if (!channel?.stream_id) return;
    setSelected(channel);
    setEpgLoading(true);
    try {
      const key = `stream-${channel.stream_id}`;
      const cached = await getCache(server.url, user.username, 'epg', key);
      if (cached?.data?.length) {
        setEpg(cached.data);
        if (cached.isFresh) return;
      }
      const data = await getShortEPG(server.url, user.username, user.password, channel.stream_id, 50);
      const list = Array.isArray(data) ? data : [];
      setEpg(list);
      await saveCache(server.url, user.username, 'epg', key, list);
    } catch (e) {
      logger.log('EPG load error:', e?.message || e);
      setEpg([]);
    } finally { setEpgLoading(false); }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return channels;
    return channels.filter(c => String(c.name || '').toLowerCase().includes(q));
  }, [channels, query]);

  const renderChannel = ({ item, index }) => (
    <FocusableButton
      style={[styles.channelRow, selected?.stream_id === item.stream_id && styles.channelRowActive]}
      onPress={() => loadEpg(item)}
      hasTVPreferredFocus={isTV && index === 0}
    >
      {item.stream_icon ? <Image source={{ uri: item.stream_icon }} style={styles.logo} resizeMode="contain" /> : <View style={styles.logoPlaceholder}><Text style={styles.logoText}>📺</Text></View>}
      <View style={{ flex: 1 }}>
        <Text style={styles.channelName} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.channelCat} numberOfLines={1}>{item.category_name || 'Canal en vivo'}</Text>
      </View>
    </FocusableButton>
  );

  const renderProgram = ({ item, index }) => (
    <View style={[styles.programRow, index === 0 && styles.programNow]}>
      <View style={styles.programTimeBox}>
        <Text style={styles.programTime}>{formatEpgTime(item.start || item.start_timestamp)}</Text>
        <Text style={styles.programTimeEnd}>{formatEpgTime(item.end || item.stop || item.stop_timestamp)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.programTitle}>{safeDecode(item.title || item.name || 'Programa')}</Text>
        {!!item.description && <Text style={styles.programDesc} numberOfLines={3}>{safeDecode(item.description)}</Text>}
      </View>
    </View>
  );

  if (loading) return <View style={styles.loading}><ActivityIndicator color={colors.accent} size="large" /><Text style={styles.loadingText}>Cargando guía...</Text></View>;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <FocusableButton onPress={() => safeBack(navigation, 'Home')} style={styles.backBtn}><Text style={styles.backText}>← Volver</Text></FocusableButton>
        <Text style={styles.title}>Guía EPG</Text>
        <FocusableButton onPress={loadChannels} style={styles.refreshBtn}><Text style={styles.refreshText}>Actualizar</Text></FocusableButton>
      </View>

      <View style={styles.body}>
        <View style={styles.leftPane}>
          <TextInput style={styles.search} placeholder="Buscar canal..." placeholderTextColor="#666" value={query} onChangeText={setQuery} />
          <FlatList data={filtered} renderItem={renderChannel} keyExtractor={(item, i) => `${item.stream_id || item.name}-${i}`} />
        </View>
        <View style={styles.rightPane}>
          <Text style={styles.selectedTitle} numberOfLines={2}>{selected?.name || 'Selecciona un canal'}</Text>
          {epgLoading ? <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} /> : (
            <FlatList
              data={epg}
              renderItem={renderProgram}
              keyExtractor={(item, i) => `${item.start || ''}-${item.title || ''}-${i}`}
              ListEmptyComponent={<Text style={styles.empty}>Este canal no informa programación EPG.</Text>}
            />
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: colors.textSecondary },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: layout.horizontalPadding, paddingVertical: isTV ? 18 : 10 },
  backBtn: { padding: 8, borderRadius: 8 },
  backText: { color: colors.accent, fontSize: isTV ? 17 : 14 },
  title: { color: colors.white, fontSize: isTV ? 28 : 20, fontWeight: 'bold' },
  refreshBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: colors.primary },
  refreshText: { color: colors.primary, fontWeight: '700' },
  body: { flex: 1, flexDirection: 'row', paddingHorizontal: layout.horizontalPadding, gap: 14 },
  leftPane: { width: isTV ? 430 : 180 },
  rightPane: { flex: 1, backgroundColor: colors.card, borderRadius: 14, padding: isTV ? 18 : 12, borderWidth: 1, borderColor: '#2a2a3a' },
  search: { color: colors.white, backgroundColor: colors.card, borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#2a2a3a' },
  channelRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.card, borderRadius: 12, padding: 10, marginBottom: 8, borderWidth: 2, borderColor: '#2a2a3a' },
  channelRowActive: { borderColor: colors.primary, ...shadows.glowPurple },
  logo: { width: isTV ? 54 : 40, height: isTV ? 54 : 40, borderRadius: 8, backgroundColor: '#0f0f14' },
  logoPlaceholder: { width: isTV ? 54 : 40, height: isTV ? 54 : 40, borderRadius: 8, backgroundColor: '#0f0f14', alignItems: 'center', justifyContent: 'center' },
  logoText: { fontSize: 18 },
  channelName: { color: colors.white, fontWeight: '700', fontSize: isTV ? 17 : 12 },
  channelCat: { color: colors.textSecondary, fontSize: isTV ? 12 : 10, marginTop: 3 },
  selectedTitle: { color: colors.white, fontSize: isTV ? 24 : 18, fontWeight: '800', marginBottom: 14 },
  programRow: { flexDirection: 'row', gap: 14, padding: isTV ? 16 : 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', marginBottom: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  programNow: { borderColor: colors.accent, backgroundColor: 'rgba(50,197,255,0.08)' },
  programTimeBox: { width: isTV ? 95 : 64 },
  programTime: { color: colors.accent, fontSize: isTV ? 18 : 13, fontWeight: '800' },
  programTimeEnd: { color: colors.textSecondary, fontSize: isTV ? 13 : 10, marginTop: 3 },
  programTitle: { color: colors.white, fontWeight: '700', fontSize: isTV ? 18 : 13 },
  programDesc: { color: colors.textSecondary, fontSize: isTV ? 14 : 11, lineHeight: isTV ? 20 : 16, marginTop: 5 },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: 30 },
});
