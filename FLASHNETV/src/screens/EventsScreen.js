/**
 * EventsScreen — 🔥 Eventos en vivo
 *
 * Busca señales deportivas en el servidor Xtream con prioridad:
 *   1. ★ EVENTOS EXCLUSIVOS ★  (primera y más importante)
 *   2. AGENDA LATINA
 *   3. NBA | MLB | NHL | NFL
 *   4. MMA | UFC | BOXEO | LUCHA LIBRE
 *   5. F1 | RALLY | MOTORSPORTS
 *   6. TENNIS | GOLF
 *   7. BALONCESTO FIBA
 *   8. FÚTBOL / SOCCER general
 *   9. OTROS DEPORTES
 *
 * Al tocar un canal → va directo al Player como live.
 */
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, StyleSheet, ActivityIndicator,
  Image, TouchableOpacity, TextInput, RefreshControl, SectionList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { getLiveCategories, getLiveStreams, isAdultContent } from '../services/xtream';
import { colors } from '../theme';
import FocusableButton from '../components/FocusableButton';
import { isTV, layout } from '../utils/tv';
import logger from '../utils/logger';
import { safeBack, useSafeHardwareBack } from '../utils/navigation';

// ─── Grupos de deporte en ORDEN DE PRIORIDAD ─────────────────────────────────

const SPORT_GROUPS = [
  {
    key:      'exclusivos',
    label:    '⭐ Eventos Exclusivos',
    color:    '#FFD700',
    priority: 1,
    keywords: [
      'eventos exclusivos', 'exclusivos', 'evento exclusivo',
      'exclusivo 1', 'exclusivo 2', 'exclusivos 1', 'exclusivos 2',
    ],
  },
  {
    key:      'agenda',
    label:    '📺 Agenda Latina',
    color:    '#FF6B9D',
    priority: 2,
    keywords: ['agenda latina', 'agenda'],
  },
  {
    key:      'basketball',
    label:    '🏀 Basketball',
    color:    '#FF6B35',
    priority: 3,
    keywords: [
      'nba', 'nbl', 'wnba', 'baloncesto', 'basketball', 'fiba',
      'ncaa basket', 'basket', 'basquet', 'básquet',
    ],
  },
  {
    key:      'football_am',
    label:    '🏈 NFL / Football',
    color:    '#4CAF50',
    priority: 4,
    keywords: [
      'nfl', 'football americano', 'american football',
      'super bowl', 'ncaa football',
    ],
  },
  {
    key:      'baseball',
    label:    '⚾ Béisbol',
    color:    '#2196F3',
    priority: 5,
    keywords: ['mlb', 'beisbol', 'béisbol', 'baseball'],
  },
  {
    key:      'hockey',
    label:    '🏒 Hockey',
    color:    '#9C27B0',
    priority: 6,
    keywords: ['nhl', 'hockey'],
  },
  {
    key:      'mma',
    label:    '🥊 MMA / UFC / Boxeo',
    color:    '#F44336',
    priority: 7,
    keywords: [
      'ufc', 'mma', 'boxeo', 'boxing', 'lucha libre',
      'lucha', 'combate', 'pelea', 'wwe', 'aaa', 'cmll',
    ],
  },
  {
    key:      'motorsports',
    label:    '🏎 Motorsports',
    color:    '#FF9800',
    priority: 8,
    keywords: [
      'f1', 'formula 1', 'formula1', 'rally',
      'nascar', 'motorsport', 'motogp', 'moto gp', 'indycar',
    ],
  },
  {
    key:      'tennis',
    label:    '🎾 Tenis / Golf',
    color:    '#8BC34A',
    priority: 9,
    keywords: ['tennis', 'tenis', 'golf', 'pga', 'atp', 'wta'],
  },
  {
    key:      'football',
    label:    '⚽ Fútbol',
    color:    '#00BCD4',
    priority: 10,
    keywords: [
      'futbol', 'fútbol', 'soccer', 'liga ', 'champions',
      'premier', 'bundesliga', 'serie a', 'ligue', 'libertadores',
      'copa', 'mls', 'conmebol', 'concacaf', 'eliminatoria',
    ],
  },
  {
    key:      'otros',
    label:    '🏆 Otros deportes',
    color:    '#607D8B',
    priority: 11,
    keywords: [
      'deporte', 'sport', 'olimpic', 'olimpico', 'olimpiadas',
      'atletismo', 'natacion', 'ciclismo', 'voleibol', 'volleyball',
    ],
  },
];


const normalizeCategoryName = (value = '') => String(value)
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[★☆•·|]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const EXACT_CATEGORY_PRIORITIES = [
  { match: 'eventos exclusivos 1', groupKey: 'exclusivos', priority: 1 },
  { match: 'agenda latina', groupKey: 'agenda', priority: 2 },
  { match: 'nba mlb nhl nfl', groupKey: 'multi_us', priority: 3 },
  { match: 'mma ufc boxeo lucha libre', groupKey: 'mma', priority: 4 },
  { match: 'f1 rally motorsports', groupKey: 'motorsports', priority: 5 },
  { match: 'tennis golf', groupKey: 'tennis', priority: 6 },
  { match: 'baloncesto fiba', groupKey: 'basketball', priority: 7 },
  { match: 'otros deportes', groupKey: 'otros', priority: 8 },
];

const findGroupByKey = (key) => {
  if (key === 'multi_us') {
    return {
      key: 'multi_us', label: '🏟 NBA | MLB | NHL | NFL', color: '#32C5FF', priority: 3,
      keywords: ['nba', 'mlb', 'nhl', 'nfl'],
    };
  }
  return SPORT_GROUPS.find(g => g.key === key) || SPORT_GROUPS[SPORT_GROUPS.length - 1];
};

const getExactPriority = (categoryName = '') => {
  const normalized = normalizeCategoryName(categoryName);
  return EXACT_CATEGORY_PRIORITIES.find(row => normalized.includes(row.match));
};

const ALL_KEYWORDS = SPORT_GROUPS.flatMap(g => g.keywords);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getSportGroup = (categoryName = '') => {
  const exact = getExactPriority(categoryName);
  if (exact) return { ...findGroupByKey(exact.groupKey), priority: exact.priority };
  const lower = normalizeCategoryName(categoryName);
  // Busca en orden de prioridad
  return [...SPORT_GROUPS]
    .sort((a, b) => a.priority - b.priority)
    .find(g => g.keywords.some(kw => lower.includes(normalizeCategoryName(kw)))) || null;
};

const isSportCat = (name = '') => {
  const lower = normalizeCategoryName(name);
  if (getExactPriority(name)) return true;
  return ALL_KEYWORDS.some(kw => lower.includes(normalizeCategoryName(kw)));
};

// ─── Componente ───────────────────────────────────────────────────────────────

export default function EventsScreen({ navigation }) {
  useSafeHardwareBack(navigation, 'Home');
  const { user, server }  = useAuth();

  const [sections, setSections]         = useState([]); // [{title, group, data:[...]}]
  const [allChannels, setAllChannels]   = useState([]);
  const [loading, setLoading]           = useState(true);
  const [refreshing, setRefreshing]     = useState(false);
  const [search, setSearch]             = useState('');
  const [selectedGroup, setSelectedGroup] = useState(null);

  useEffect(() => { loadEvents(); }, []);

  // ─── Carga ──────────────────────────────────────────────────────────────────

  const loadEvents = async (isRefresh = false) => {
    try {
      isRefresh ? setRefreshing(true) : setLoading(true);

      // 1. Obtener categorías
      const cats = await getLiveCategories(server.url, user.username, user.password);

      // 2. Filtrar categorías deportivas (excluir adulto + kids)
      const sportCats = cats.filter(c =>
        isSportCat(c.category_name || '') &&
        !isAdultContent(c.category_name || '', '')
      );

      if (sportCats.length === 0) {
        setSections([]);
        setAllChannels([]);
        return;
      }

      // 3. Ordenar categorías por prioridad de grupo
      const sortedCats = [...sportCats].sort((a, b) => {
        const ga = getSportGroup(a.category_name)?.priority ?? 99;
        const gb = getSportGroup(b.category_name)?.priority ?? 99;
        return ga - gb;
      });

      // 4. Cargar canales — PRIMERO las categorías exclusivas, luego el resto
      //    Limite 20 categorías para no sobrecargar el servidor
      const toLoad = sortedCats.slice(0, 40);

      const results = await Promise.allSettled(
        toLoad.map(cat =>
          getLiveStreams(server.url, user.username, user.password, cat.category_id)
            .then(streams => streams.map(s => ({
              ...s,
              category_name: cat.category_name,
              category_id:   cat.category_id,
              sportGroup:    getSportGroup(cat.category_name),
            })))
        )
      );

      // 5. Aplanar + deduplicar por stream_id
      const seen = new Set();
      const channels = results
        .filter(r => r.status === 'fulfilled')
        .flatMap(r => r.value || [])
        .filter(c => {
          const id = String(c.stream_id || c.name || Math.random());
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        });

      setAllChannels(channels);

      // 6. Agrupar por grupo deportivo en orden de prioridad
      buildSections(channels);

    } catch (e) {
      logger.log('EventsScreen error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const buildSections = (channels) => {
    const groupMap = new Map(); // key → { group, channels }

    for (const ch of channels) {
      const g = ch.sportGroup;
      const key = g?.key || 'otros';
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          group: g || SPORT_GROUPS[SPORT_GROUPS.length - 1],
          channels: [],
        });
      }
      groupMap.get(key).channels.push(ch);
    }

    // Ordenar por prioridad
    const sorted = [...groupMap.values()]
      .sort((a, b) => (a.group.priority ?? 99) - (b.group.priority ?? 99));

    setSections(
      sorted.map(({ group, channels: chs }) => ({
        key:   group.key,
        title: group.label,
        color: group.color,
        data:  chs,
      }))
    );
  };

  // ─── Filtrado ────────────────────────────────────────────────────────────────

  const filteredChannels = useMemo(() => {
    let pool = allChannels;
    if (selectedGroup) pool = pool.filter(c => c.sportGroup?.key === selectedGroup);
    if (search.trim()) {
      const q = search.toLowerCase();
      pool = pool.filter(c =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.category_name || '').toLowerCase().includes(q)
      );
    }
    return pool;
  }, [allChannels, selectedGroup, search]);

  const isFiltered = !!selectedGroup || !!search.trim();

  // ─── Ir al Player ────────────────────────────────────────────────────────────

  const openChannel = useCallback((item) => {
    navigation.navigate('Player', {
      stream:      item,
      type:        'live',
      returnRoute: 'Events',
    });
  }, [navigation]);

  // ─── Render canal ─────────────────────────────────────────────────────────────

  const ChannelCard = useCallback(({ item }) => {
    const group = item.sportGroup;
    return (
      <FocusableButton
        style={styles.channelCard}
        focusedStyle={styles.channelCardFocused}
        onPress={() => openChannel(item)}
      >
        <View style={styles.logoWrap}>
          {item.stream_icon ? (
            <Image source={{ uri: item.stream_icon }} style={styles.logo} resizeMode="contain" />
          ) : (
            <View style={styles.logoPlaceholder}>
              <Text style={styles.logoEmoji}>{group?.label?.charAt(0) || '📺'}</Text>
            </View>
          )}
          {group && (
            <View style={[styles.groupDot, { backgroundColor: group.color }]} />
          )}
        </View>
        <View style={styles.channelInfo}>
          <Text style={styles.channelName} numberOfLines={2}>{item.name}</Text>
          <Text style={styles.channelCat} numberOfLines={1}>{item.category_name}</Text>
        </View>
        <View style={styles.playWrap}>
          <Text style={styles.playIcon}>▶</Text>
        </View>
      </FocusableButton>
    );
  }, [openChannel]);

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.loadingText}>Buscando eventos deportivos...</Text>
        <Text style={styles.loadingSubText}>Explorando señales del servidor</Text>
      </View>
    );
  }

  const totalChannels = allChannels.length;
  const activeGroups  = sections.map(s => ({ key: s.key, label: s.title, color: s.color }));

  return (
    <SafeAreaView style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <FocusableButton onPress={() => safeBack(navigation, 'Home')} style={styles.backBtn}>
          <Text style={styles.backText}>← Volver</Text>
        </FocusableButton>
        <View style={styles.headerCenter}>
          <Text style={styles.title}>🔥 Eventos</Text>
        </View>
        <Text style={styles.count}>
          {isFiltered ? filteredChannels.length : totalChannels}
        </Text>
      </View>

      {/* Buscador */}
      <View style={styles.searchWrapper}>
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar evento o deporte..."
          placeholderTextColor="#444"
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} style={styles.clearBtn}>
            <Text style={styles.clearText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Tabs de grupos */}
      <FlatList
        data={[
          { key: null, label: '🏆 Todos', color: colors.primary },
          ...activeGroups,
        ]}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={item => item.key || 'all'}
        style={styles.groupList}
        contentContainerStyle={styles.groupContent}
        renderItem={({ item }) => {
          const active = selectedGroup === item.key;
          return (
            <FocusableButton
              style={[
                styles.groupBtn,
                active && { backgroundColor: item.color + 'cc', borderColor: item.color },
              ]}
              focusedStyle={styles.groupBtnFocused}
              onPress={() => { setSelectedGroup(active ? null : item.key); setSearch(''); }}
            >
              <Text style={[styles.groupText, active && styles.groupTextActive]}>
                {item.label}
              </Text>
            </FocusableButton>
          );
        }}
      />

      {/* Contenido */}
      {isFiltered ? (
        // Modo lista plana cuando hay filtro
        <FlatList
          data={filteredChannels}
          keyExtractor={(item, i) => `ev-${item.stream_id || i}`}
          renderItem={({ item }) => <ChannelCard item={item} />}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => loadEvents(true)} tintColor={colors.accent} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>🔍</Text>
              <Text style={styles.emptyTitle}>Sin resultados</Text>
              <TouchableOpacity onPress={() => { setSelectedGroup(null); setSearch(''); }}>
                <Text style={styles.clearFilterText}>Quitar filtro</Text>
              </TouchableOpacity>
            </View>
          }
        />
      ) : sections.length === 0 ? (
        // Sin canales
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📡</Text>
          <Text style={styles.emptyTitle}>No se encontraron eventos deportivos</Text>
          <Text style={styles.emptySubText}>
            El servidor no tiene categorías deportivas activas en este momento.
          </Text>
          <FocusableButton style={styles.retryBtn} onPress={() => loadEvents(true)}>
            <Text style={styles.retryText}>↺ Reintentar</Text>
          </FocusableButton>
        </View>
      ) : (
        // Modo secciones — agrupado por deporte en orden de prioridad
        <SectionList
          sections={sections}
          keyExtractor={(item, i) => `${item.stream_id || i}`}
          renderItem={({ item }) => <ChannelCard item={item} />}
          renderSectionHeader={({ section }) => (
            <View style={[styles.sectionHeader, { borderLeftColor: section.color }]}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <Text style={styles.sectionCount}>{section.data.length}</Text>
            </View>
          )}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => loadEvents(true)} tintColor={colors.accent} />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loadingContainer: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', gap: 14 },
  loadingText: { color: colors.white, fontSize: isTV ? 20 : 16, fontWeight: 'bold' },
  loadingSubText: { color: colors.textSecondary, fontSize: isTV ? 15 : 12 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: layout.horizontalPadding, paddingTop: isTV ? 16 : 8, paddingBottom: 14 },
  backBtn: { padding: 8, borderWidth: 1, borderColor: 'transparent', borderRadius: 8 },
  backText: { color: colors.accent, fontSize: isTV ? 17 : 14 },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: colors.white, fontSize: isTV ? 26 : 18, fontWeight: 'bold' },
  testBadge: { backgroundColor: '#FF9800', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  testBadgeText: { color: '#000', fontSize: isTV ? 12 : 9, fontWeight: '900' },
  count: { color: colors.textSecondary, fontSize: isTV ? 16 : 12 },

  searchWrapper: { marginHorizontal: layout.horizontalPadding, marginBottom: 10, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: '#2a2a3a', flexDirection: 'row', alignItems: 'center' },
  searchInput: { flex: 1, color: colors.white, padding: isTV ? 16 : 12, fontSize: isTV ? 18 : 14 },
  clearBtn: { paddingHorizontal: 14 },
  clearText: { color: colors.textSecondary, fontSize: 16 },

  groupList: { flexGrow: 0, height: isTV ? 72 : 52, marginBottom: 8 },
  groupContent: { paddingHorizontal: layout.horizontalPadding, paddingVertical: 4, gap: 8 },
  groupBtn: { paddingHorizontal: isTV ? 18 : 14, paddingVertical: isTV ? 12 : 8, borderRadius: 22, backgroundColor: colors.card, borderWidth: 2, borderColor: '#2a2a3a' },
  groupBtnFocused: { borderColor: colors.accent },
  groupText: { color: colors.textSecondary, fontSize: isTV ? 15 : 12 },
  groupTextActive: { color: colors.white, fontWeight: '700' },

  list: { paddingHorizontal: layout.horizontalPadding, paddingBottom: 40 },

  // Sección header
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: isTV ? 14 : 10, paddingHorizontal: 4,
    marginTop: isTV ? 20 : 14, marginBottom: isTV ? 8 : 6,
    borderLeftWidth: 4, paddingLeft: 12,
  },
  sectionTitle: { color: colors.white, fontSize: isTV ? 18 : 14, fontWeight: 'bold' },
  sectionCount: { color: colors.textSecondary, fontSize: isTV ? 14 : 11 },

  // Canal card
  channelCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 14, padding: isTV ? 16 : 12, marginBottom: isTV ? 10 : 8, borderWidth: 2, borderColor: '#2a2a3a', gap: 14 },
  channelCardFocused: { borderColor: colors.accent, backgroundColor: 'rgba(50,197,255,0.08)' },

  logoWrap: { position: 'relative' },
  logo: { width: isTV ? 72 : 52, height: isTV ? 72 : 52, borderRadius: 10, backgroundColor: '#0f0f14' },
  logoPlaceholder: { width: isTV ? 72 : 52, height: isTV ? 72 : 52, borderRadius: 10, backgroundColor: '#0f0f14', justifyContent: 'center', alignItems: 'center' },
  logoEmoji: { fontSize: isTV ? 28 : 22 },
  groupDot: { position: 'absolute', bottom: -2, right: -2, width: isTV ? 14 : 10, height: isTV ? 14 : 10, borderRadius: 7, borderWidth: 1.5, borderColor: colors.background },

  channelInfo: { flex: 1, gap: 4 },
  channelName: { color: colors.white, fontSize: isTV ? 18 : 14, fontWeight: '600' },
  channelCat: { color: colors.textSecondary, fontSize: isTV ? 13 : 11 },

  playWrap: { paddingLeft: 8 },
  playIcon: { color: colors.primary, fontSize: isTV ? 28 : 22 },

  emptyContainer: { flex: 1, alignItems: 'center', paddingTop: 60, gap: 12, paddingHorizontal: 24 },
  emptyIcon: { fontSize: 52 },
  emptyTitle: { color: colors.white, fontSize: isTV ? 22 : 17, fontWeight: 'bold', textAlign: 'center' },
  emptySubText: { color: colors.textSecondary, fontSize: isTV ? 16 : 13, textAlign: 'center', lineHeight: isTV ? 24 : 20 },
  clearFilterText: { color: colors.accent, fontSize: isTV ? 16 : 13, marginTop: 4 },
  retryBtn: { backgroundColor: colors.primary, paddingHorizontal: 28, paddingVertical: 13, borderRadius: 10, marginTop: 8 },
  retryText: { color: colors.white, fontWeight: '600', fontSize: isTV ? 18 : 15 },
});
