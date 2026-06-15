/**
 * SportsRow — multi-deporte ESPN, compatible móvil + TV
 *
 * Móvil/Tablet: tabs en ScrollView horizontal
 * TV: tabs en FlatList horizontal con FocusableButton (navegable con D-pad)
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, ActivityIndicator, Image, ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  fetchTabScoreboard,
  getMatchStatus,
  formatMatchTime,
  formatMatchDate,
  SPORT_TABS,
  SPORT_EMOJI,
} from '../services/sports';
import { colors } from '../theme';
import { isTV, isTablet, layout } from '../utils/tv';
import FocusableButton from './FocusableButton';

const REFRESH_MS = 45000;
const SPORTS_CACHE_TTL_MS = 15 * 60 * 1000;
const CARD_WIDTH  = isTV ? 220 : isTablet ? 300 : 260;

const normalize = (value = '') => String(value)
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const CHANNEL_HINTS = {
  nba: ['nba', 'espn', 'star', 'tnt', 'space'],
  wnba: ['wnba', 'espn'],
  ncaamb: ['ncaa', 'espn'],
  nfl: ['nfl', 'espn', 'fox sports', 'fox', 'star'],
  ncaaf: ['ncaa', 'college football', 'espn'],
  mlb: ['mlb', 'espn', 'fox sports', 'fox'],
  nhl: ['nhl', 'espn'],
  mls: ['mls', 'apple', 'espn'],
  ligamx: ['liga mx', 'tudn', 'azteca', 'espn', 'fox sports'],
  epl: ['premier', 'espn', 'star', 'fox sports'],
  laliga: ['la liga', 'espn', 'directv', 'dsports'],
  seriea: ['serie a', 'espn', 'star'],
  bundesliga: ['bundesliga', 'espn'],
  ligue1: ['ligue 1', 'espn'],
  ucl: ['champions', 'espn', 'fox sports'],
  uel: ['europa league', 'espn'],
  copa: ['libertadores', 'espn', 'fox sports', 'directv', 'dsports'],
  sudamericana: ['sudamericana', 'espn', 'directv', 'dsports'],
  arg: ['argentina', 'tyc', 'espn', 'tnt sports'],
  bra: ['brasileirao', 'brasil', 'premiere', 'espn'],
  chile: ['chile', 'tnt sports', 'estadio', 'espn'],
  friendly: ['amistoso', 'espn', 'fox sports', 'directv', 'dsports'],
  intfriendly: ['amistoso', 'fifa', 'espn', 'fox sports'],
  default: ['espn', 'fox sports', 'directv', 'dsports', 'tnt sports', 'star']
};

const buildMatchQuery = (match) => [
  match?.homeTeam?.shortName,
  match?.awayTeam?.shortName,
  match?.homeTeam?.name,
  match?.awayTeam?.name,
  match?.competition,
].filter(Boolean).join(' ');

const findBestLiveChannel = (match, channels = []) => {
  if (!match || !Array.isArray(channels) || channels.length === 0) return null;
  const home = normalize(match.homeTeam?.shortName || match.homeTeam?.name || '');
  const away = normalize(match.awayTeam?.shortName || match.awayTeam?.name || '');
  const competition = normalize(match.competition || '');
  const hints = CHANNEL_HINTS[match.league] || CHANNEL_HINTS.default;
  let best = null;
  let bestScore = 0;

  for (const channel of channels) {
    const name = normalize(channel?.name || channel?.title || '');
    if (!name) continue;
    let score = 0;
    if (home && name.includes(home)) score += 5;
    if (away && name.includes(away)) score += 5;
    if (competition && name.includes(competition)) score += 4;
    for (const hint of hints) if (name.includes(normalize(hint))) score += 3;
    if (name.includes('evento') || name.includes('eventos') || name.includes('deportes') || name.includes('sports')) score += 2;
    if (match.status === 'IN_PLAY' || match.status === 'HALFTIME') score += 1;
    if (score > bestScore) { bestScore = score; best = channel; }
  }

  return bestScore >= 3 ? best : null;
};


export default function SportsRow({ navigation, liveChannels = [] }) {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);
  const [tab, setTab]         = useState('live');
  const [lastUpdated, setLastUpdated] = useState(null);
  const isMounted  = useRef(true);
  const intervalRef = useRef(null);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; clearInterval(intervalRef.current); };
  }, []);

  const loadMatches = useCallback(async (selectedTab) => {
    if (!isMounted.current) return;
    const cacheKey = `flashnetv_sports_cache_${selectedTab}`;
    setLoading(true);
    setError(false);

    let cachedMatches = [];
    try {
      const raw = await AsyncStorage.getItem(cacheKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        const age = Date.now() - (parsed?.savedAt || 0);
        if (Array.isArray(parsed?.data) && parsed.data.length && age < SPORTS_CACHE_TTL_MS) {
          cachedMatches = parsed.data;
          if (isMounted.current) {
            setMatches(parsed.data);
            setLastUpdated(parsed.savedAt ? new Date(parsed.savedAt) : new Date());
            setLoading(false);
          }
        }
      }
    } catch (_) {}

    try {
      const data = await fetchTabScoreboard(selectedTab);
      if (!isMounted.current) return;
      if (Array.isArray(data) && data.length) {
        setMatches(data);
        setLastUpdated(new Date());
        await AsyncStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), data })).catch(() => {});
      } else if (cachedMatches.length) {
        setMatches(cachedMatches);
      } else {
        setMatches([]);
      }
    } catch {
      if (isMounted.current) {
        if (cachedMatches.length) setMatches(cachedMatches);
        else { setMatches([]); setError(true); }
      }
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    clearInterval(intervalRef.current);
    loadMatches(tab);
    intervalRef.current = setInterval(() => loadMatches(tab), REFRESH_MS);
    return () => clearInterval(intervalRef.current);
  }, [tab, loadMatches]);

  // ─── Tab button ──────────────────────────────────────────────────────────
  const TabBtn = useCallback(({ item }) => {
    const active = tab === item.key;
    if (isTV) {
      return (
        <FocusableButton
          style={[styles.tabBtn, active && styles.tabBtnActive]}
          focusedStyle={styles.tabBtnFocused}
          onPress={() => setTab(item.key)}
        >
          <Text style={[styles.tabText, active && styles.tabTextActive]}>{item.label}</Text>
        </FocusableButton>
      );
    }
    return (
      <TouchableOpacity
        style={[styles.tabBtn, active && styles.tabBtnActive]}
        onPress={() => setTab(item.key)}
      >
        <Text style={[styles.tabText, active && styles.tabTextActive]}>{item.label}</Text>
      </TouchableOpacity>
    );
  }, [tab]);

  // ─── Match card ──────────────────────────────────────────────────────────
  const renderMatch = useCallback(({ item }) => {
    const statusInfo = getMatchStatus(item.status);
    const timeLabel  = formatMatchTime(item);
    const isLive     = item.status === 'IN_PLAY' || item.status === 'HALFTIME';
    const hasScore   = item.homeScore !== null && item.awayScore !== null;
    const sportEmoji = item.flag || SPORT_EMOJI[item.sport] || SPORT_EMOJI.default;

    const openMatchChannel = () => {
      if (!navigation) return;
      const channel = findBestLiveChannel(item, liveChannels);
      if (channel) {
        navigation.navigate('Player', { stream: channel, type: 'live', returnRoute: 'MainTabs' });
        return;
      }
      navigation.navigate('Search', { initialQuery: buildMatchQuery(item) });
    };

    const Card = isTV ? FocusableButton : TouchableOpacity;
    const cardProps = isTV
      ? { style: [styles.card, { width: CARD_WIDTH }], focusedStyle: styles.cardFocused, onPress: openMatchChannel }
      : { style: [styles.card, { width: CARD_WIDTH }], activeOpacity: 0.85, onPress: openMatchChannel };

    return (
      <Card {...cardProps}>
        {/* Header */}
        <View style={styles.cardHeader}>
          <Text style={styles.leagueName} numberOfLines={1}>
            {sportEmoji} {item.competition}
          </Text>
          <View style={[styles.statusBadge, {
            backgroundColor: statusInfo.color + '20',
            borderColor:     statusInfo.color + '60',
          }]}>
            {isLive && <Text style={[styles.liveDot, { color: statusInfo.color }]}>●</Text>}
            <Text style={[styles.statusText, { color: statusInfo.color }]}>
              {statusInfo.label}
            </Text>
          </View>
        </View>

        {/* Equipos */}
        <View style={styles.matchBody}>
          <TeamBlock team={item.homeTeam} />
          <View style={styles.centerBlock}>
            {hasScore && (isLive || item.status === 'FINISHED') ? (
              <Text style={styles.score}>{item.homeScore} - {item.awayScore}</Text>
            ) : (
              <Text style={styles.vsText}>VS</Text>
            )}
            {timeLabel ? <Text style={styles.timeLabel}>{timeLabel}</Text> : null}
          </View>
          <TeamBlock team={item.awayTeam} />
        </View>

        <Text style={styles.watchHint} numberOfLines={1}>
          {findBestLiveChannel(item, liveChannels) ? '▶ Abrir canal relacionado' : '🔍 Buscar transmisión'}
        </Text>

        {item.venue ? (
          <Text style={styles.venue} numberOfLines={1}>📍 {item.venue}</Text>
        ) : null}
        {/* Fecha del partido — clave para saber si es reciente */}
        {item.utcDate ? (
          <Text style={styles.dateLabel}>
            📅 {formatMatchDate(item.utcDate)}
          </Text>
        ) : null}
      </Card>
    );
  }, [navigation, liveChannels]);

  // ─── Render tabs: ScrollView en móvil, FlatList en TV ────────────────────
  const TabsContainer = isTV ? (
    <FlatList
      data={SPORT_TABS}
      horizontal
      keyExtractor={t => t.key}
      renderItem={({ item }) => <TabBtn item={item} />}
      showsHorizontalScrollIndicator={false}
      style={styles.tabsScroll}
      contentContainerStyle={styles.tabsContent}
    />
  ) : (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.tabsScroll}
      contentContainerStyle={styles.tabsContent}
    >
      {SPORT_TABS.map(t => <TabBtn key={t.key} item={t} />)}
    </ScrollView>
  );

  const emptyMsg = error
    ? 'Sin conexión. Verificá tu internet.'
    : tab === 'live'
    ? 'No hay partidos en vivo ahora.\nProbá el tab "Hoy".'
    : 'No hay eventos programados para hoy en esta liga.';

  return (
    <View style={styles.container}>
      <View style={styles.rowHeader}>
        <Text style={styles.rowTitle}>🏆 Deportes</Text>
        {lastUpdated && (
          <Text style={styles.updatedText}>Actualizado {lastUpdated.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</Text>
        )}
        {isTV ? (
          <FocusableButton style={styles.refreshBtn} onPress={() => loadMatches(tab)}>
            <Text style={styles.refreshText}>↺</Text>
          </FocusableButton>
        ) : (
          <TouchableOpacity style={styles.refreshBtn} onPress={() => loadMatches(tab)}>
            <Text style={styles.refreshText}>↺</Text>
          </TouchableOpacity>
        )}
      </View>

      {TabsContainer}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size={isTV ? 'large' : 'small'} />
          <Text style={styles.loadingText}>Cargando resultados...</Text>
        </View>
      ) : matches.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>{emptyMsg}</Text>
        </View>
      ) : (
        <FlatList
          data={matches}
          renderItem={renderMatch}
          keyExtractor={(item, i) => `${item.league}-${item.id || i}`}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
}

function TeamBlock({ team }) {
  return (
    <View style={styles.teamBlock}>
      {team?.logo ? (
        <Image source={{ uri: team.logo }} style={styles.teamLogo} resizeMode="contain" />
      ) : (
        <View style={styles.teamLogoPlaceholder} />
      )}
      <Text style={styles.teamName} numberOfLines={2}>{team?.shortName || '?'}</Text>
      {team?.record ? <Text style={styles.teamRecord}>{team.record}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: isTV ? 26 : 24 },

  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: layout.horizontalPadding,
    marginBottom: isTV ? 8 : 10,
  },
  rowTitle: { color: colors.white, fontSize: isTV ? 18 : 17, fontWeight: 'bold' },
  updatedText: { color: colors.textSecondary, fontSize: isTV ? 10 : 10, marginRight: 6 },
  refreshBtn: { padding: isTV ? 5 : 8 },
  refreshText: { color: colors.accent, fontSize: isTV ? 18 : 22 },

  tabsScroll: { marginBottom: isTV ? 9 : 12 },
  tabsContent: { paddingHorizontal: layout.horizontalPadding, gap: isTV ? 7 : 8 },
  tabBtn: {
    paddingHorizontal: isTV ? 10 : 12,
    paddingVertical: isTV ? 6 : 6,
    borderRadius: isTV ? 14 : 20,
    backgroundColor: colors.card,
    borderWidth: isTV ? 2 : 1,
    borderColor: '#2a2a3a',
  },
  tabBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabBtnFocused: { borderColor: colors.accent, backgroundColor: 'rgba(50,197,255,0.2)' },
  tabText: { color: colors.textSecondary, fontSize: isTV ? 11 : 12 },
  tabTextActive: { color: '#fff', fontWeight: '700' },

  list: { paddingHorizontal: layout.horizontalPadding, gap: isTV ? 10 : 12 },

  card: {
    backgroundColor: colors.card,
    borderRadius: isTV ? 10 : 14,
    padding: isTV ? 10 : 14,
    borderWidth: isTV ? 2 : 1,
    borderColor: '#2a2a3a',
    gap: isTV ? 7 : 10,
  },
  cardFocused: { borderColor: colors.accent, backgroundColor: 'rgba(50,197,255,0.08)' },

  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  leagueName: { color: colors.textSecondary, fontSize: isTV ? 10 : 11, flex: 1 },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: isTV ? 6 : 7,
    paddingVertical: isTV ? 2 : 3,
    borderRadius: 10, borderWidth: 1, gap: 3,
  },
  liveDot: { fontSize: isTV ? 7 : 7 },
  statusText: { fontSize: isTV ? 9 : 10, fontWeight: 'bold' },

  matchBody: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  teamBlock: { flex: 1, alignItems: 'center', gap: isTV ? 4 : 6 },
  teamLogo: { width: isTV ? 30 : 38, height: isTV ? 30 : 38 },
  teamLogoPlaceholder: {
    width: isTV ? 30 : 38, height: isTV ? 30 : 38,
    backgroundColor: '#0f0f14', borderRadius: isTV ? 26 : 19,
  },
  teamName: { color: colors.white, fontSize: isTV ? 10 : 12, fontWeight: '600', textAlign: 'center' },
  teamRecord: { color: colors.textSecondary, fontSize: isTV ? 9 : 9, textAlign: 'center' },

  centerBlock: { paddingHorizontal: isTV ? 8 : 10, alignItems: 'center', gap: 2, minWidth: isTV ? 58 : 70 },
  score: { color: colors.white, fontSize: isTV ? 18 : 22, fontWeight: 'bold', letterSpacing: 1 },
  vsText: { color: colors.textSecondary, fontSize: isTV ? 13 : 16, fontWeight: 'bold' },
  timeLabel: { color: colors.accent, fontSize: isTV ? 9 : 10, fontWeight: '600', textAlign: 'center' },

  watchHint: { color: colors.accentWarm || colors.accent, fontSize: isTV ? 9 : 10, fontWeight: '800', textAlign: 'center' },
  venue: { color: '#555', fontSize: isTV ? 8 : 9, textAlign: 'center' },
  dateLabel: { color: '#666', fontSize: isTV ? 8 : 9, textAlign: 'center', marginTop: 2 },

  center: {
    paddingHorizontal: layout.horizontalPadding,
    paddingVertical: isTV ? 18 : 20,
    alignItems: 'center', gap: 8, minHeight: isTV ? 74 : 80, justifyContent: 'center',
  },
  loadingText: { color: colors.textSecondary, fontSize: isTV ? 12 : 12 },
  emptyText: { color: colors.textSecondary, fontSize: isTV ? 12 : 13, textAlign: 'center', lineHeight: isTV ? 18 : 20 },
});
