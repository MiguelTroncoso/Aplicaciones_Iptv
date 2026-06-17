/**
 * PlayerScreen — expo-video + Picture-in-Picture
 *
 * Migrado desde expo-av. Cambios clave:
 *   - useVideoPlayer() en lugar de <Video ref>
 *   - VideoView con allowsPictureInPicture + startsPictureInPictureAutomatically
 *   - PiP manual vía viewRef.current.startPictureInPicture()
 *   - staysActiveInBackground = true para que el audio/video siga en PiP
 *   - showNowPlayingNotification = true para la notificación del sistema
 *   - onPlayToEnd para auto-play siguiente episodio
 *   - Barra de navegación oculta con reintentos
 */
import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet,
  StatusBar, ActivityIndicator, Alert, AppState,
  Modal, ScrollView, Pressable, BackHandler, PanResponder,
  FlatList, Image,
  NativeModules, Platform, TVEventHandler, TVFocusGuideView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useVideoPlayer, VideoView, isPictureInPictureSupported } from 'expo-video';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as NavigationBar from 'expo-navigation-bar';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { useAuth } from '../context/AuthContext';
import { useLibrary } from '../context/LibraryContext';
import { useDownloads } from '../context/DownloadsContext';
import { getLiveCategories, getLiveStreams, getStreamUrl } from '../services/xtream';
import { isTV } from '../utils/tv';
import { colors } from '../theme';
import FocusableButton from '../components/FocusableButton';
import logger from '../utils/logger';
import { resetInsideApp } from '../utils/navigation';
import { cleanCategoryName } from '../utils/labels';
import { saveLastLiveChannel } from '../utils/liveHistory';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const getPlaybackExtension = (stream, type) => {
  if (type === 'live') return 'ts';
  return stream?.container_extension || stream?.info?.container_extension || stream?.extension || 'mp4';
};

const cleanName = (raw = '') => {
  const s = String(raw);
  if ((s.match(/\./g) || []).length >= 3) {
    const cut = s.search(/[\s.](?:19|20)\d{2}[.\s]|[\s.](720p|1080p|2160p|4K|BRRip|BluRay|WEBRip|HDTV|DVDRip|AMZN|NF)/i);
    const title = cut > 0 ? s.substring(0, cut) : s;
    return title.replaceAll('.', ' ').replaceAll('_', ' ').trim();
  }
  return s.trim();
};

const formatTime = (secs) => {
  if (!secs || secs <= 0) return '';
  const s = Math.floor(secs);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m restantes`;
  return `${m}m ${s % 60}s restantes`;
};

const normalizeResumeSeconds = (value = 0) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  // La biblioteca guarda positionMillis; expo-video busca en segundos.
  return numeric > 1000 ? numeric / 1000 : numeric;
};

const getSourceContentType = (url = '', ext = '') => {
  const value = `${url} ${ext}`.toLowerCase();
  if (value.includes('.m3u8')) return 'hls';
  if (value.includes('.mpd')) return 'dash';
  return 'auto';
};

const getTrackKey = (track, index = 0) => String(track?.id || track?.language || track?.label || track?.name || index);

const getTrackLabel = (track, index = 0, fallback = 'Pista') => {
  const parts = [track?.label, track?.name, track?.language].filter(Boolean);
  const unique = [...new Set(parts.map(String))];
  return unique.length ? unique.join(' · ') : `${fallback} ${index + 1}`;
};

const normalizeTrackList = (value) => Array.isArray(value) ? value.filter(Boolean) : [];

const CONTROLS_AUTO_HIDE_MS = isTV ? 5000 : 3500;
const LIVE_STALL_SECONDS = 12;
const VOD_STALL_SECONDS = 18;
const STALL_TICK_MS = 4000;

const shouldOfferNextEpisode = ({ hasNextEp, playbackStarted, currentTime, duration, playerStatus }) => {
  const ct = Number(currentTime || 0);
  const d = Number(duration || 0);
  if (!hasNextEp || !playbackStarted || playerStatus === 'loading' || playerStatus === 'error') return false;
  // Evita que el prompt aparezca mientras el episodio recién está cargando.
  // Algunos streams Xtream reportan una duración temporal o disparan playToEnd al inicio.
  if (!Number.isFinite(ct) || !Number.isFinite(d) || d < 90 || ct < 45) return false;
  return ct >= d - 30 && ct / d >= 0.85;
};


// Chromecast — importación condicional.
// En Expo Go el paquete JS puede existir, pero el componente nativo RNGoogleCastButton
// no está registrado y crashea con: View config not found for component `RNGoogleCastButton`.
const isExpoGo = Constants?.appOwnership === 'expo';
let CastButton = null;
let castAvailable = false;
try {
  const nativeCastAvailable = Boolean(
    NativeModules?.RNGoogleCast ||
    NativeModules?.RNGoogleCastModule ||
    NativeModules?.GoogleCast ||
    NativeModules?.RNGoogleCastButton
  );
  if (!isExpoGo && Platform.OS === 'android' && nativeCastAvailable) {
    // eslint-disable-next-line global-require
    const GoogleCast = require('react-native-google-cast');
    CastButton = GoogleCast?.CastButton || null;
    castAvailable = Boolean(CastButton);
  }
} catch (error) {
  logger.log('Chromecast no disponible:', error?.message || error);
  CastButton = null;
  castAvailable = false;
}



// Módulos opcionales: si el build no los trae, la app sigue funcionando.
let Brightness = null;
try { Brightness = require('expo-brightness'); } catch (_) {}

let DocumentPicker = null;
try { DocumentPicker = require('expo-document-picker'); } catch (_) {}

const parseSrtTime = (value = '') => {
  const m = String(value).trim().match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{1,3})/);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number((m[4] || '0').padEnd(3, '0')) / 1000;
};

const parseSrt = (text = '') => {
  const blocks = String(text).replaceAll('\r', '').split(/\n\s*\n/);
  return blocks.map(block => {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    const timingIndex = lines.findIndex(l => l.includes('-->'));
    if (timingIndex < 0) return null;
    const [startRaw, endRaw] = lines[timingIndex].split('-->').map(v => v.trim());
    const subtitleText = lines.slice(timingIndex + 1).join('\n').replace(/<[^>]*>/g, '').trim();
    if (!subtitleText) return null;
    return { start: parseSrtTime(startRaw), end: parseSrtTime(endRaw), text: subtitleText };
  }).filter(row => row && row.end > row.start).sort((a, b) => a.start - b.start);
};

// ─── Componente principal ─────────────────────────────────────────────────────

export default function PlayerScreen({ route, navigation }) {
  const { user, server } = useAuth();
  const { isFavorite, toggleFavorite, addToContinueWatching, markEpisodeWatched, recordWatchSession } = useLibrary();
  const { downloadItem, isDownloaded, getProgress } = useDownloads();

  const {
    stream,
    type = 'live',
    resumePosition = 0,
    offlineUri = null,
    offlineMode = false,
    episodeList = null,
    currentEpisodeIndex = -1,
    seriesInfo = null,
  } = route.params;

  // ─── Estado ───────────────────────────────────────────────────────────────
  const [playerStatus, setPlayerStatus]     = useState('loading'); // 'loading' | 'ready' | 'error'
  const [isPlaying, setIsPlaying]           = useState(false);
  const [currentTime, setCurrentTime]       = useState(0);
  const [duration, setDuration]             = useState(0);
  const showAccessModal = false;
  const [favoriteActive, setFavoriteActive] = useState(false);
  const [downloaded, setDownloaded]         = useState(false);
  const [showTrackModal, setShowTrackModal] = useState(false);
  const [playbackSpeed, setPlaybackSpeed]   = useState(1.0);
  const [sleepMinutes, setSleepMinutes]     = useState(0);  // 0 = off
  const [sleepTimeLeft, setSleepTimeLeft]   = useState(0);
  const [autoRetryCount, setAutoRetryCount] = useState(0);
  const [screenLocked, setScreenLocked]     = useState(false);
  const [showLockMessage, setShowLockMessage] = useState(false);
  const [showRating, setShowRating]         = useState(false);
  const [audioBoost, setAudioBoost]           = useState(1.0);
  const [subtitleSize, setSubtitleSize]       = useState(16);   // 12-28
  const [subtitleColor, setSubtitleColor]     = useState('#FFFFFF');
  const [showSkipCredits, setShowSkipCredits] = useState(false);
  const [trackTab, setTrackTab]             = useState('audio');
  const [audioTracks, setAudioTracks]       = useState([]);
  const [subtitleTracks, setSubtitleTracks] = useState([]);
  const [selectedAudioTrack, setSelectedAudioTrack] = useState(null);
  const [selectedSubtitleTrack, setSelectedSubtitleTrack] = useState(null);
  const [showNextEpPrompt, setShowNextEpPrompt]     = useState(false);
  const [nextEpCountdown, setNextEpCountdown]       = useState(10);
  const [pipActive, setPipActive]           = useState(false);
  const [pipSupported]                      = useState(() => isPictureInPictureSupported());
  const [showControls, setShowControls]     = useState(true);
  const [playbackStarted, setPlaybackStarted] = useState(false);
  const [stallDetected, setStallDetected] = useState(false);
  const [gestureHint, setGestureHint] = useState(null);
  const [externalSubtitles, setExternalSubtitles] = useState([]);
  const [externalSubtitleName, setExternalSubtitleName] = useState('');
  const [brightnessLevel, setBrightnessLevel] = useState(null);
  const [showLiveGuide, setShowLiveGuide] = useState(false);
  const [liveGuideLoading, setLiveGuideLoading] = useState(false);
  const [liveGuideCategories, setLiveGuideCategories] = useState([]);
  const [liveGuideChannels, setLiveGuideChannels] = useState([]);
  const [liveGuideCategoryId, setLiveGuideCategoryId] = useState(stream?.category_id ?? null);

  const viewRef          = useRef(null);
  const lastSaveRef      = useRef(0);
  const appStateRef      = useRef(AppState.currentState);
  const nextEpCountRef   = useRef(null);
  const controlsTimerRef = useRef(null);
  const lockMessageTimerRef = useRef(null);
  const allowNavigationAwayRef = useRef(false);
  const isNavigatingBackRef = useRef(false);
  const isReleasedRef = useRef(false); // true cuando el player nativo ya fue liberado
  const nextEpTriggered  = useRef(false);
  const resumeSeekDone   = useRef(false);
  const episodeWatchedMarkedRef = useRef(false);
  const lastStatsSaveRef = useRef(0);
  const gestureStartRef = useRef({ x: 0, y: 0, time: 0, volume: 1, brightness: null });
  const gestureStateRef = useRef({
    screenLocked: false,
    pipActive: false,
    showTrackModal: false,
    showNextEpPrompt: false,
    playerStatus: 'loading',
    duration: 0,
    brightnessLevel: null,
  });
  const progressTrackRef = useRef(null); // ref para medir el ancho del track de progreso
  const playbackInfoRef = useRef({ currentTime: 0, duration: 0, playbackStarted: false, playerStatus: 'loading' });
  const ratingShownRef = useRef(false);
  const pendingSeekRef = useRef(null); // { target, attempts, expiresAt }
  const progressPreviewRef = useRef(null);
  const stallDetectedRef = useRef(false);
  const stallWatchRef = useRef({ lastTime: 0, lastBuffered: 0, lastWallTime: Date.now(), attempts: 0 });

  // ─── Guard de adulto ──────────────────────────────────────────────────────
  const canPlay = true;

  const canDownload    = type !== 'live' && !offlineUri;
  const downloadProgress = getProgress(stream, type);

  const activeExternalSubtitle = useMemo(() => {
    if (!externalSubtitles.length || type === 'live') return null;
    const t = Number(currentTime || 0);
    return externalSubtitles.find(row => t >= row.start && t <= row.end) || null;
  }, [externalSubtitles, currentTime, type]);
  const returnRoute = route.params?.returnRoute || null;
  const returnParams = route.params?.returnParams || null;

  useEffect(() => {
    if (type === 'live') saveLastLiveChannel(stream);
  }, [stream, type]);

  useEffect(() => {
    playbackInfoRef.current = { currentTime, duration, playbackStarted, playerStatus };
  }, [currentTime, duration, playbackStarted, playerStatus]);

  const setStallState = useCallback((value) => {
    stallDetectedRef.current = value;
    setStallDetected(value);
  }, []);

  const resetStallWatch = useCallback((time = 0) => {
    const safeTime = Number(time || 0);
    stallWatchRef.current = {
      lastTime: Number.isFinite(safeTime) ? safeTime : 0,
      lastBuffered: 0,
      lastWallTime: Date.now(),
      attempts: 0,
    };
    setStallState(false);
  }, [setStallState]);

  // ─── Controles overlay tipo Netflix ───────────────────────────────────────
  // No dependemos solamente de `statusChange`, porque en algunos Android/TV
  // expo-video puede alternar entre loading/ready mientras el video ya está reproduciendo.
  // Por eso el auto-hide se activa cuando detectamos reproducción real.
  const clearControlsTimer = useCallback(() => {
    if (controlsTimerRef.current) {
      clearTimeout(controlsTimerRef.current);
      controlsTimerRef.current = null;
    }
  }, []);

  const canAutoHideControls = useCallback(() => {
    return (
      canPlay &&
      playbackStarted &&
      isPlaying &&
      !pipActive &&
      !showTrackModal &&
      !showLiveGuide &&
      !showNextEpPrompt &&
      !stallDetected &&
      playerStatus !== 'error' &&
      !showAccessModal
    );
  }, [canPlay, playbackStarted, isPlaying, pipActive, showTrackModal, showLiveGuide, showNextEpPrompt, stallDetected, playerStatus, showAccessModal]);

  const startControlsTimer = useCallback(() => {
    clearControlsTimer();
    if (!canAutoHideControls()) return;
    controlsTimerRef.current = setTimeout(() => {
      setShowControls(false);
    }, CONTROLS_AUTO_HIDE_MS);
  }, [clearControlsTimer, canAutoHideControls]);

  const showControlsTemporarily = useCallback(() => {
    if (pipActive) return;
    setShowControls(true);
    startControlsTimer();
  }, [pipActive, startControlsTimer]);

  const decorateLiveChannels = useCallback((items = [], categories = []) => {
    const categoryMap = {};
    categories.forEach(cat => {
      if (cat?.category_id !== undefined && cat?.category_id !== null) {
        categoryMap[String(cat.category_id)] = cat.category_name || cat.name || 'Sin categoria';
      }
    });
    return items.map(item => ({
      ...item,
      category_name: item.category_name || categoryMap[String(item.category_id)] || 'Sin categoria',
    }));
  }, []);

  const loadLiveGuide = useCallback(async () => {
    if (type !== 'live' || liveGuideLoading) return;
    try {
      setLiveGuideLoading(true);
      const [catsResult, streamsResult] = await Promise.allSettled([
        getLiveCategories(server.url, user.username, user.password),
        getLiveStreams(server.url, user.username, user.password),
      ]);
      const cats = catsResult.status === 'fulfilled' && Array.isArray(catsResult.value) ? catsResult.value : [];
      const streams = streamsResult.status === 'fulfilled' && Array.isArray(streamsResult.value) ? streamsResult.value : [];
      const channels = decorateLiveChannels(streams, cats);
      const categoriesWithChannels = cats.filter(cat =>
        channels.some(channel => String(channel.category_id) === String(cat.category_id))
      );

      setLiveGuideCategories(categoriesWithChannels);
      setLiveGuideChannels(channels);
      setLiveGuideCategoryId(prev => {
        if (prev && categoriesWithChannels.some(cat => String(cat.category_id) === String(prev))) return prev;
        if (stream?.category_id && categoriesWithChannels.some(cat => String(cat.category_id) === String(stream.category_id))) return stream.category_id;
        return categoriesWithChannels[0]?.category_id ?? null;
      });
    } catch (error) {
      logger.log('Live guide error:', error?.message || error);
    } finally {
      setLiveGuideLoading(false);
    }
  }, [decorateLiveChannels, liveGuideLoading, server.url, stream?.category_id, type, user.password, user.username]);

  const openLiveGuide = useCallback(() => {
    if (type !== 'live') return;
    clearControlsTimer();
    setShowControls(false);
    setShowLiveGuide(true);
    if (!liveGuideChannels.length) loadLiveGuide();
  }, [clearControlsTimer, liveGuideChannels.length, loadLiveGuide, type]);

  const closeLiveGuide = useCallback(() => {
    setShowLiveGuide(false);
    showControlsTemporarily();
  }, [showControlsTemporarily]);

  const playLiveGuideChannel = useCallback((channel) => {
    if (!channel) return;
    setShowLiveGuide(false);
    navigation.replace('Player', {
      stream: channel,
      type: 'live',
      returnRoute: returnRoute || 'LiveTV',
      returnParams,
    });
  }, [navigation, returnParams, returnRoute]);

  const liveGuideFilteredChannels = useMemo(() => {
    if (!liveGuideCategoryId) return liveGuideChannels;
    return liveGuideChannels.filter(channel => String(channel.category_id) === String(liveGuideCategoryId));
  }, [liveGuideCategoryId, liveGuideChannels]);

  useEffect(() => {
    if (!isTV || !TVEventHandler?.addListener) return undefined;

    const sub = TVEventHandler.addListener((event) => {
      const eventType = event?.eventType;
      if (
        pipActive ||
        showTrackModal ||
        showLiveGuide ||
        showNextEpPrompt ||
        playerStatus === 'error' ||
        !canPlay ||
        screenLocked
      ) {
        return;
      }

      if (type === 'live' && ['select', 'menu'].includes(eventType)) {
        openLiveGuide();
        return;
      }

      if (['up', 'down', 'left', 'right', 'select', 'playPause', 'play', 'pause', 'rewind', 'fastForward', 'menu'].includes(eventType)) {
        showControlsTemporarily();
      }
    });

    return () => {
      try { sub?.remove?.(); } catch (_) {}
    };
  }, [canPlay, openLiveGuide, pipActive, playerStatus, screenLocked, showControlsTemporarily, showLiveGuide, showNextEpPrompt, showTrackModal, type]);

  useEffect(() => {
    if (playbackStarted && canAutoHideControls()) {
      setShowControls(true);
      startControlsTimer();
      return clearControlsTimer;
    }

    clearControlsTimer();
    setShowControls(true);
    return clearControlsTimer;
  }, [playbackStarted, canAutoHideControls, startControlsTimer, clearControlsTimer]);

  // ─── URL del stream ───────────────────────────────────────────────────────
  const playbackExtension = getPlaybackExtension(stream, type);
  const streamUrl = offlineUri || getStreamUrl(
    server.url, user.username, user.password,
    stream.stream_id || stream.id,
    type,
    playbackExtension
  );
  const streamContentType = getSourceContentType(streamUrl, playbackExtension);

  // ─── VideoPlayer (expo-video) ─────────────────────────────────────────────
  // Importante: se inicializa sin fuente. Así el contenido adulto no se abre
  // antes de iniciar la reproduccion.
  const player = useVideoPlayer(null, (p) => {
    p.staysActiveInBackground = true;
    p.showNowPlayingNotification = !isTV;
  });

  const refreshTracksFromPlayer = useCallback(() => {
    try {
      const audios = normalizeTrackList(player.availableAudioTracks);
      const subtitles = normalizeTrackList(player.availableSubtitleTracks);
      setAudioTracks(audios);
      setSubtitleTracks(subtitles);
      setSelectedAudioTrack(player.audioTrack || audios.find(t => t?.isDefault) || audios[0] || null);
      setSelectedSubtitleTrack(player.subtitleTrack || null);
    } catch (e) {
      logger.log('Refresh tracks error:', e?.message || e);
    }
  }, [player]);

  useEffect(() => {
    if (!canPlay) {
      try {
        player.pause();
        player.replace(null);
      } catch (_) {}
      setPlayerStatus('blocked');
      return;
    }

    setPlayerStatus('loading');
    isReleasedRef.current = false;
    setPlaybackStarted(false);
    setCurrentTime(0);
    setDuration(0);
    setShowRating(false);
    setShowSkipCredits(false);
    setShowNextEpPrompt(false);
    resumeSeekDone.current = false;
    nextEpTriggered.current = false;
    episodeWatchedMarkedRef.current = false;
    ratingShownRef.current = false;
    pendingSeekRef.current = null;
    resetStallWatch(0);

    try {
      const source = {
        uri: streamUrl,
        contentType: streamContentType,
        metadata: {
          title: cleanName(stream.name || stream.title || ''),
          artist: 'FLASHNETV',
          artwork: stream.stream_icon || stream.cover || undefined,
        },
      };
      if (typeof player.replaceAsync === 'function') {
        player.replaceAsync(source).then(() => player.play()).catch((err) => {
          logger.log('Player replaceAsync error:', err?.message || err);
          setPlayerStatus('error');
        });
      } else {
        player.replace(source);
        player.play();
      }
    } catch (e) {
      logger.log('Player source error:', e?.message || e);
      setPlayerStatus('error');
    }
  }, [player, canPlay, streamUrl, streamContentType, stream?.name, stream?.title, stream?.stream_icon, stream?.cover, resetStallWatch]);

  // ─── Siguiente episodio ───────────────────────────────────────────────────
  const hasNextEp = episodeList && currentEpisodeIndex >= 0 && currentEpisodeIndex < episodeList.length - 1;
  const nextEp    = hasNextEp ? episodeList[currentEpisodeIndex + 1] : null;

  const playNextEpisode = useCallback(() => {
    clearInterval(nextEpCountRef.current);
    setShowNextEpPrompt(false);
    if (!nextEp) return;
    // Permitir que este reemplazo interno no sea interceptado por beforeRemove.
    allowNavigationAwayRef.current = true;
    navigation.replace('Player', {
      stream: nextEp,
      type: 'series',
      episodeList,
      currentEpisodeIndex: currentEpisodeIndex + 1,
      seriesInfo,
      returnRoute,
      returnParams,
    });
    setTimeout(() => { allowNavigationAwayRef.current = false; }, 300);
  }, [nextEp, navigation, episodeList, currentEpisodeIndex, seriesInfo, returnRoute, returnParams]);

  const cancelNextEp = useCallback(() => {
    clearInterval(nextEpCountRef.current);
    nextEpTriggered.current = true; // no volver a disparar
    setShowNextEpPrompt(false);
  }, []);

  const startNextEpCountdown = useCallback(() => {
    if (nextEpTriggered.current || !hasNextEp) return;
    nextEpTriggered.current = true;
    setNextEpCountdown(10);
    setShowNextEpPrompt(true);
    nextEpCountRef.current = setInterval(() => {
      setNextEpCountdown(prev => {
        if (prev <= 1) {
          clearInterval(nextEpCountRef.current);
          playNextEpisode();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [hasNextEp, playNextEpisode]);

  // ─── Eventos del player ───────────────────────────────────────────────────
  useEffect(() => {
    if (!isNavigatingBackRef.current) isReleasedRef.current = false;

    const statusSub = player.addListener('statusChange', ({ status, error }) => {
      if (status === 'readyToPlay') {
        setPlayerStatus('ready');
        // Seek a resumePosition solo la primera vez
        const resumeSeconds = normalizeResumeSeconds(resumePosition);
        if (resumeSeconds > 0 && !resumeSeekDone.current) {
          resumeSeekDone.current = true;
          player.currentTime = resumeSeconds;
        }
      } else if (status === 'error') {
        logger.log('Player error:', error?.message);
        setPlayerStatus('error');
      } else {
        setPlayerStatus(prev => (prev === 'ready' ? 'ready' : 'loading'));
      }
    });

    const playingSub = player.addListener('playingChange', ({ isPlaying: playing }) => {
      setIsPlaying(playing);
      if (playing) {
        setPlaybackStarted(true);
        setPlayerStatus(prev => (prev === 'error' ? prev : 'ready'));
      }
    });

    // Evento de fin de video → auto-play siguiente episodio.
    // Guardado: en algunos Android/TV este evento puede dispararse al cargar o cambiar fuente.
    const endSub = player.addListener('playToEnd', () => {
      const info = playbackInfoRef.current;
      const realEnd = type !== 'live'
        && info.playbackStarted
        && Number(info.duration || 0) >= 90
        && Number(info.currentTime || 0) >= Math.max(45, Number(info.duration || 0) - 20)
        && Number(info.currentTime || 0) / Number(info.duration || 1) >= 0.85;

      // Algunos Android/TV disparan playToEnd al iniciar o al recalcular duración.
      // La calificación solo aparece al final real, nunca al entrar a una película/episodio.
      if (realEnd && !ratingShownRef.current) {
        ratingShownRef.current = true;
        setShowRating(true);
      }

      if (shouldOfferNextEpisode({
        hasNextEp,
        playbackStarted: info.playbackStarted,
        currentTime: info.currentTime,
        duration: info.duration,
        playerStatus: info.playerStatus,
      })) {
        startNextEpCountdown();
      }
    });

    // Progreso — se actualiza cada segundo gracias a timeUpdateEventInterval
    const timeSub = player.addListener('timeUpdate', ({ currentTime: ct, bufferedPosition }) => {
      const numericCt = Number(ct || 0);
      const numericBuffered = Number(bufferedPosition || 0);
      const playerDuration = Number(player.duration || 0);
      const effectiveDuration = playerDuration > 0 ? playerDuration : duration;
      if (playerDuration > 0 && Math.abs(playerDuration - duration) > 0.5) {
        setDuration(playerDuration);
      }

      const pendingSeek = pendingSeekRef.current;
      if (pendingSeek && Date.now() <= pendingSeek.expiresAt) {
        if (Math.abs(numericCt - pendingSeek.target) <= 4) {
          pendingSeekRef.current = null;
        } else if (numericCt < 1 && pendingSeek.target > 8) {
          setCurrentTime(pendingSeek.target);
          if (pendingSeek.attempts < 2) {
            pendingSeek.attempts += 1;
            setTimeout(() => {
              applySeekTarget(pendingSeek.target);
              try { player.play(); } catch (_) {}
            }, 250);
          } else {
            pendingSeekRef.current = null;
            setGestureHint('Este contenido no permite adelantar');
            setTimeout(() => setGestureHint(null), 2200);
          }
          return;
        }
      }

      setCurrentTime(numericCt);
      if (numericCt > 0.25 || numericBuffered > 0.25) {
        const stalled = stallWatchRef.current;
        if (
          Math.abs(numericCt - stalled.lastTime) > 0.5 ||
          Math.abs(numericBuffered - stalled.lastBuffered) > 0.5
        ) {
          stallWatchRef.current = {
            lastTime: numericCt,
            lastBuffered: Number.isFinite(numericBuffered) ? numericBuffered : stalled.lastBuffered,
            lastWallTime: Date.now(),
            attempts: 0,
          };
          if (stallDetectedRef.current) setStallState(false);
        }
        setPlaybackStarted(true);
        setPlayerStatus(prev => (prev === 'error' ? prev : 'ready'));
      }
      if (canPlay && effectiveDuration > 0) {
        // Guardar progreso cada 15 segundos
        const posMs = numericCt * 1000;
        if (posMs - lastSaveRef.current >= 15000) {
          lastSaveRef.current = posMs;
          addToContinueWatching(stream, type, posMs, effectiveDuration * 1000).catch(() => {});
        }
        if (type === 'series' && !episodeWatchedMarkedRef.current && effectiveDuration > 0 && numericCt / effectiveDuration >= 0.9) {
          episodeWatchedMarkedRef.current = true;
          markEpisodeWatched(seriesInfo || stream, stream).catch(() => {});
        }
        if (numericCt - lastStatsSaveRef.current >= 60) {
          lastStatsSaveRef.current = numericCt;
          recordWatchSession?.(stream, type, 60).catch(() => {});
        }
        // Skip créditos — últimos 3 min de VOD/series
        const remaining = effectiveDuration - numericCt;
        if (remaining > 0 && remaining <= 180 && type !== 'live' && !showSkipCredits && numericCt > 30) {
          setShowSkipCredits(true);
        } else if (remaining > 180 || numericCt <= 30) {
          setShowSkipCredits(false);
        }

        // Trigger countdown solo al final real del capítulo.
        // Evita prompt falso al entrar al episodio mientras el player aún está calculando duración.
        if (!nextEpTriggered.current && shouldOfferNextEpisode({
          hasNextEp,
          playbackStarted: true,
          currentTime: numericCt,
          duration: effectiveDuration,
          playerStatus,
        })) {
          startNextEpCountdown();
        }
      }
    });

    return () => {
      isReleasedRef.current = true; // marcar como liberado ANTES de remover
      try { statusSub.remove(); } catch (_) {}
      try { playingSub.remove(); } catch (_) {}
      try { endSub.remove(); } catch (_) {}
      try { timeSub.remove(); } catch (_) {}
    };
  }, [player, canPlay, hasNextEp, duration, resumePosition, startNextEpCountdown, playbackStarted, currentTime, playerStatus, type, stream, seriesInfo, markEpisodeWatched, addToContinueWatching, recordWatchSession, setStallState]);

  // Activar timeUpdate cada 1 segundo
  useEffect(() => {
    try { player.timeUpdateEventInterval = 1; } catch (_) {}
    return () => { try { player.timeUpdateEventInterval = 0; } catch (_) {} };
  }, [player]);

  useEffect(() => {
    if (
      !canPlay ||
      !playbackStarted ||
      pipActive ||
      playerStatus === 'error' ||
      showAccessModal ||
      screenLocked
    ) {
      return undefined;
    }

    const interval = setInterval(() => {
      if (isReleasedRef.current || isNavigatingBackRef.current) return;

      const currentRaw = Number(player.currentTime ?? currentTime ?? 0);
      const bufferedRaw = Number(player.bufferedPosition ?? 0);
      const current = Number.isFinite(currentRaw) ? currentRaw : Number(currentTime || 0);
      const buffered = Number.isFinite(bufferedRaw) ? bufferedRaw : 0;
      const ref = stallWatchRef.current;
      const playing = Boolean(player.playing ?? isPlaying);

      if (!playing || showTrackModal || showNextEpPrompt) {
        stallWatchRef.current = {
          ...ref,
          lastTime: current,
          lastBuffered: buffered,
          lastWallTime: Date.now(),
        };
        if (stallDetectedRef.current) setStallState(false);
        return;
      }

      const moved =
        Math.abs(current - ref.lastTime) > 0.5 ||
        Math.abs(buffered - ref.lastBuffered) > 0.5;

      if (moved) {
        stallWatchRef.current = {
          lastTime: current,
          lastBuffered: buffered,
          lastWallTime: Date.now(),
          attempts: 0,
        };
        if (stallDetectedRef.current) setStallState(false);
        return;
      }

      const stallLimit = type === 'live' ? LIVE_STALL_SECONDS : VOD_STALL_SECONDS;
      const stalledFor = (Date.now() - ref.lastWallTime) / 1000;
      if (stalledFor < stallLimit) return;

      const nextAttempts = ref.attempts + 1;
      stallWatchRef.current = {
        ...ref,
        attempts: nextAttempts,
        lastWallTime: Date.now(),
      };
      setStallState(true);
      setShowControls(true);
      clearControlsTimer();
      setGestureHint(type === 'live'
        ? 'Senal congelada. Reintentando...'
        : 'Reproduccion congelada. Reintentando...');
      setTimeout(() => setGestureHint(null), 3500);

      try {
        player.pause();
        if (type === 'live') {
          const source = { uri: streamUrl, contentType: streamContentType };
          setPlayerStatus('loading');
          if (typeof player.replaceAsync === 'function') {
            player.replaceAsync(source)
              .then(() => player.play())
              .catch((error) => {
                logger.log('Live stall recovery error:', error?.message || error);
                setPlayerStatus('error');
              });
          } else {
            player.replace(source);
            player.play();
          }
        } else {
          player.play();
        }
      } catch (error) {
        logger.log('Stall recovery error:', error?.message || error);
      }

      if (nextAttempts >= 3) {
        setPlayerStatus('error');
        setStallState(false);
      }
    }, STALL_TICK_MS);

    return () => clearInterval(interval);
  }, [
    canPlay,
    clearControlsTimer,
    currentTime,
    isPlaying,
    pipActive,
    playbackStarted,
    player,
    playerStatus,
    screenLocked,
    setStallState,
    showNextEpPrompt,
    showAccessModal,
    showTrackModal,
    streamContentType,
    streamUrl,
    type,
  ]);

  // Obtener duración y pistas reales cuando cambia la fuente
  useEffect(() => {
    const syncTracks = (payload = {}) => {
      const d = Number(payload.duration || 0);
      if (d > 0) setDuration(d);

      const audios = normalizeTrackList(
        payload.availableAudioTracks || payload.audioTracks || payload.tracks || player.availableAudioTracks
      );
      const subtitles = normalizeTrackList(
        payload.availableSubtitleTracks || payload.subtitleTracks || payload.tracks || player.availableSubtitleTracks
      );

      setAudioTracks(audios);
      setSubtitleTracks(subtitles);
      setSelectedAudioTrack(player.audioTrack || audios.find(t => t?.isDefault) || audios[0] || null);
      setSelectedSubtitleTrack(player.subtitleTrack || null);
    };

    const sourceSub = player.addListener('sourceLoad', syncTracks);
    const audioAvailableSub = player.addListener('availableAudioTracksChange', syncTracks);
    const subtitleAvailableSub = player.addListener('availableSubtitleTracksChange', syncTracks);
    const audioTrackSub = player.addListener('audioTrackChange', ({ audioTrack } = {}) => {
      setSelectedAudioTrack(audioTrack || player.audioTrack || null);
    });
    const subtitleTrackSub = player.addListener('subtitleTrackChange', ({ subtitleTrack } = {}) => {
      setSelectedSubtitleTrack(subtitleTrack || player.subtitleTrack || null);
    });

    // Algunos Android TV no disparan el evento de pistas inmediatamente.
    // Re-sincronizamos después de la carga para que CC/Audio aparezcan si el stream las informa tarde.
    const t1 = setTimeout(refreshTracksFromPlayer, 1200);
    const t2 = setTimeout(refreshTracksFromPlayer, 3500);

    return () => {
      try { sourceSub.remove(); } catch (_) {}
      try { audioAvailableSub.remove(); } catch (_) {}
      try { subtitleAvailableSub.remove(); } catch (_) {}
      try { audioTrackSub.remove(); } catch (_) {}
      try { subtitleTrackSub.remove(); } catch (_) {}
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [player, refreshTracksFromPlayer, streamUrl]);

  // ─── Pantalla completa + NavigationBar ───────────────────────────────────
  const hideSystemUI = useCallback(async () => {
    try {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    } catch (_) {}
    const hide = async () => {
      try {
        await NavigationBar.setVisibilityAsync('hidden');
        await NavigationBar.setBehaviorAsync('overlay-swipe');
      } catch (_) {}
    };
    await hide();
    setTimeout(hide, 500);
    setTimeout(hide, 1200);
  }, []);

  useEffect(() => {
    hideSystemUI();

    const navSub = NavigationBar.addVisibilityListener(({ visibility }) => {
      if (visibility === 'visible' && !pipActive) {
        setTimeout(async () => {
          try { await NavigationBar.setVisibilityAsync('hidden'); } catch (_) {}
        }, 300);
      }
    });

    return () => {
      navSub?.remove?.();
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.DEFAULT).catch(() => {});
      NavigationBar.setVisibilityAsync('visible').catch(() => {});
    };
  }, [hideSystemUI, pipActive]);

  // ─── AppState: re-ocultar UI al volver de background ─────────────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (appStateRef.current.match(/inactive|background/) && next === 'active') {
        if (!pipActive) hideSystemUI();
      }
      appStateRef.current = next;
    });
    return () => sub.remove();
  }, [hideSystemUI, pipActive]);

  // ─── Volver seguro ─────────────────────────────────────────────────────────
  const finishPlayerExit = useCallback(() => {
    allowNavigationAwayRef.current = true;

    // Salida segura centralizada: siempre reconstruye un stack dentro de FLASHNETV.
    // Esto evita que Android cierre la Activity cuando Player quedó solo en el stack.
    let targetRoute = 'MainTabs';
    let targetParams;

    if (returnRoute === 'SeriesDetail' && returnParams?.serie) {
      targetRoute = 'SeriesDetail';
      targetParams = returnParams;
    } else if (returnRoute === 'MovieDetail' && returnParams?.stream) {
      targetRoute = 'MovieDetail';
      targetParams = returnParams;
    } else if (['LiveTV', 'Events', 'Favorites', 'Downloads',
                'ContinueWatching', 'Movies', 'Series', 'Search',
                'Watchlist', 'EPG', 'Stats'].includes(returnRoute)) {
      targetRoute = returnRoute; // volver a la pantalla de origen
    }

    try {
      if (navigation.canGoBack?.()) {
        navigation.goBack();
        setTimeout(() => {
          allowNavigationAwayRef.current = false;
          isNavigatingBackRef.current = false;
        }, 800);
        return;
      }
      resetInsideApp(navigation, targetRoute, targetParams);
    } catch (e) {
      logger.log('Safe player exit error:', e?.message || e);
      try { navigation.navigate('MainTabs'); } catch (_) {}
    }

    setTimeout(() => {
      allowNavigationAwayRef.current = false;
      isNavigatingBackRef.current = false;
    }, 800);
  }, [navigation, returnRoute, returnParams]);

  const persistCurrentProgress = useCallback(async () => {
    if (!canPlay || type === 'live') return;
    const position = Number(player.currentTime ?? currentTime ?? playbackInfoRef.current.currentTime ?? 0);
    const total = Number(player.duration || duration || playbackInfoRef.current.duration || 0);
    if (!Number.isFinite(position) || position <= 0) return;
    const safeDuration = Number.isFinite(total) && total > position + 30 ? total : 0;
    try {
      await addToContinueWatching(stream, type, position * 1000, safeDuration * 1000);
    } catch (_) {}
  }, [addToContinueWatching, canPlay, currentTime, duration, player, stream, type]);

  const goBackSafe = useCallback(async () => {
    if (isNavigatingBackRef.current) return true;
    isNavigatingBackRef.current = true;

    clearInterval(nextEpCountRef.current);
    clearControlsTimer();
    await persistCurrentProgress();

    isReleasedRef.current = true; // marcar ANTES de pausar para evitar doble operación
    try { player.pause(); } catch (_) {}
    try { await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.DEFAULT); } catch (_) {}
    try { await NavigationBar.setVisibilityAsync('visible'); } catch (_) {}

    finishPlayerExit();
    return true;
  }, [player, clearControlsTimer, finishPlayerExit, persistCurrentProgress]);

  // Intercepta el botón atrás del celular/control remoto cuando la pantalla está enfocada.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        goBackSafe();
        return true;
      });
      return () => sub.remove();
    }, [goBackSafe])
  );

  // Bloquea cualquier intento de sacar Player por el stack nativo sin pasar por goBackSafe.
  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e) => {
      if (allowNavigationAwayRef.current) return;
      e.preventDefault();
      goBackSafe();
    });
    return sub;
  }, [navigation, goBackSafe]);

  // ─── Init: favoritos + descargado ────────────────────────────────────────
  useEffect(() => {
    setFavoriteActive(isFavorite(stream, type));
    setDownloaded(isDownloaded(stream, type));
  }, [stream, type, isFavorite, isDownloaded]);



  // ─── Auto-retry en error ──────────────────────────────────────────────────
  useEffect(() => {
    if (playerStatus !== 'error') return;
    if (autoRetryCount >= 3 || type === 'live') return; // live no hace retry, falla rápido
    const timer = setTimeout(() => {
      setAutoRetryCount(c => c + 1);
      setPlayerStatus('loading');
      try {
        player.replace({ uri: streamUrl });
        player.play();
      } catch (_) { setPlayerStatus('error'); }
    }, 3000);
    return () => clearTimeout(timer);
  }, [playerStatus, autoRetryCount]);

  // ─── Sleep timer ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (sleepMinutes <= 0) { setSleepTimeLeft(0); return; }
    setSleepTimeLeft(sleepMinutes * 60);
    const interval = setInterval(() => {
      setSleepTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          try { player.pause(); } catch (_) {}
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [sleepMinutes]);

  // ─── Cleanup al desmontar ─────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      clearInterval(nextEpCountRef.current);
      clearControlsTimer();
      if (lockMessageTimerRef.current) clearTimeout(lockMessageTimerRef.current);
      // El player nativo puede estar liberado antes que el cleanup de JS — siempre guardar
      if (!isReleasedRef.current) {
        try { player.pause(); } catch (_) {}
      }
    };
  }, [player, clearControlsTimer]);

  // ─── Handlers ─────────────────────────────────────────────────────────────
  const handleFavorite = async () => {
    const nowFav = await toggleFavorite(stream, type);
    setFavoriteActive(nowFav);
    Alert.alert(
      nowFav ? 'Agregado a favoritos' : 'Eliminado de favoritos',
      stream.name || stream.title || 'Contenido actualizado'
    );
  };

  const handleDownload = async () => {
    const result = await downloadItem(stream, type);
    if (result?.success) setDownloaded(true);
  };


  const handleSpeedChange = (speed) => {
    setPlaybackSpeed(speed);
    try { player.playbackRate = speed; } catch (_) {}
  };

  const handleAudioBoost = (boost) => {
    setAudioBoost(boost);
    try { player.volume = Math.min(boost, 2.0); } catch (_) {}
  };

  const handleSleepTimer = (minutes) => {
    setSleepMinutes(minutes);
  };

  const showLockHintTemporarily = useCallback(() => {
    setShowLockMessage(true);
    if (lockMessageTimerRef.current) clearTimeout(lockMessageTimerRef.current);
    lockMessageTimerRef.current = setTimeout(() => setShowLockMessage(false), 2200);
  }, []);

  const handleToggleScreenLock = useCallback(() => {
    setScreenLocked(true);
    clearControlsTimer();
    setShowControls(false);
    showLockHintTemporarily();
  }, [clearControlsTimer, showLockHintTemporarily]);

  const handleSkipCredits = useCallback(() => {
    if (type === 'live' || duration <= 0) return;
    const target = Math.max(0, duration - 5);
    try { player.currentTime = target; } catch (e) { logger.log('Skip credits error:', e?.message || e); }
    setCurrentTime(target);
    setShowSkipCredits(false);
  }, [duration, player, type]);

  const handleRateContent = useCallback(async (rating) => {
    try {
      const raw = stream?.raw || stream || {};
      const id = `${type}-${raw.stream_id || raw.series_id || raw.id || raw.name || Date.now()}`;
      const stored = await AsyncStorage.getItem('flashnetv_content_ratings_v1');
      const parsed = stored ? JSON.parse(stored) : [];
      const next = [{
        id,
        type,
        rating,
        name: raw.name || raw.title || 'Sin nombre',
        ratedAt: new Date().toISOString(),
      }, ...parsed.filter(row => row.id !== id)].slice(0, 500);
      await AsyncStorage.setItem('flashnetv_content_ratings_v1', JSON.stringify(next));
    } catch (e) {
      logger.log('Rating save error:', e?.message || e);
    } finally {
      setShowRating(false);
    }
  }, [stream, type]);

  const handleRetry = useCallback(() => {
    if (!canPlay) return;
    setPlayerStatus('loading');
    lastSaveRef.current = 0;
    resumeSeekDone.current = false;
    nextEpTriggered.current = false;
    resetStallWatch(0);
    try {
      player.replace({ uri: streamUrl, contentType: streamContentType });
      player.play();
    } catch (_) {
      setPlayerStatus('error');
    }
  }, [player, streamUrl, streamContentType, canPlay, resetStallWatch]);

  const applySeekTarget = useCallback((target) => {
    const safeTarget = Number(target || 0);
    if (!Number.isFinite(safeTarget) || safeTarget < 0) return;

    // expo-video trabaja de forma más estable con asignación absoluta de currentTime.
    // En algunas builds seekBy(delta) reinicia ciertos VOD al inicio; por eso queda como fallback.
    try {
      player.currentTime = safeTarget;
      return;
    } catch (assignError) {
      logger.log('Seek assign fallback:', assignError?.message || assignError);
    }

    try {
      if (typeof player.seekBy === 'function') {
        const from = Number(player.currentTime ?? currentTime ?? 0);
        const delta = safeTarget - (Number.isFinite(from) ? from : 0);
        player.seekBy(delta);
      }
    } catch (seekError) {
      logger.log('Seek error:', seekError?.message || seekError);
    }
  }, [player, currentTime]);

  const performSeekTo = useCallback((targetSeconds, { resume = true } = {}) => {
    if (type === 'live' || playerStatus === 'loading') return;
    const rawTarget = Number(targetSeconds || 0);
    if (!Number.isFinite(rawTarget)) return;

    const knownDuration = Number(player.duration || duration || 0);
    const max = knownDuration > 2 ? knownDuration - 2 : Math.max(rawTarget, 0);
    const target = Math.max(0, Math.min(max, rawTarget));

    pendingSeekRef.current = { target, attempts: 0, expiresAt: Date.now() + 4500 };
    resumeSeekDone.current = true;
    setCurrentTime(target);

    applySeekTarget(target);
    if (resume) {
      try { player.play(); } catch (_) {}
    }
    showControlsTemporarily();
  }, [type, playerStatus, player, duration, showControlsTemporarily, applySeekTarget]);

  const seekBy = useCallback((seconds) => {
    const current = Number(player.currentTime ?? currentTime ?? 0);
    const safeCurrent = Number.isFinite(current) && current >= 0 ? current : 0;
    performSeekTo(safeCurrent + Number(seconds || 0), { resume: true });
  }, [player, currentTime, performSeekTo]);

  const handlePlayPause = useCallback(() => {
    if (!canPlay) return;
    try {
      if (isPlaying) {
        player.pause();
        clearControlsTimer();
        setShowControls(true);
      } else {
        player.play();
        showControlsTemporarily();
      }
    } catch (e) {
      logger.log('Play/pause error:', e?.message || e);
    }
  }, [canPlay, isPlaying, player, clearControlsTimer, showControlsTemporarily]);

  const handleScreenPress = useCallback(() => {
    if (pipActive) return;
    if (showControls && playbackStarted && isPlaying && !showTrackModal && !showNextEpPrompt) {
      clearControlsTimer();
      setShowControls(false);
      return;
    }
    showControlsTemporarily();
  }, [pipActive, showControls, playbackStarted, isPlaying, showTrackModal, showNextEpPrompt, clearControlsTimer, showControlsTemporarily]);

  const openTrackModal = useCallback((tab = 'audio') => { // 'audio' | 'subtitles' | 'boost'
    clearControlsTimer();
    refreshTracksFromPlayer();
    setTrackTab(tab);
    setShowControls(true);
    setShowTrackModal(true);
  }, [clearControlsTimer, refreshTracksFromPlayer]);

  const closeTrackModal = useCallback(() => {
    setShowTrackModal(false);
    setShowControls(true);
    setTimeout(() => {
      showControlsTemporarily();
    }, 80);
  }, [showControlsTemporarily]);

  const selectAudioTrack = useCallback((track) => {
    try {
      player.audioTrack = track;
      setSelectedAudioTrack(track || null);
      setShowControls(true);
    } catch (e) {
      logger.log('Audio track error:', e?.message || e);
      Alert.alert('Audio no disponible', 'No se pudo cambiar la pista de audio en este stream.');
    }
  }, [player]);

  const selectSubtitleTrack = useCallback((track) => {
    try {
      // null desactiva subtítulos; las demás opciones deben venir de availableSubtitleTracks.
      player.subtitleTrack = track || null;
      setSelectedSubtitleTrack(track || null);
      setShowControls(true);
    } catch (e) {
      logger.log('Subtitle track error:', e?.message || e);
      Alert.alert('Subtítulos no disponibles', 'No se pudo cambiar la pista de subtítulos en este stream.');
    }
  }, [player]);


  const handleLoadExternalSrt = useCallback(async () => {
    if (type === 'live') return;
    if (!DocumentPicker) {
      Alert.alert('SRT no disponible', 'Falta instalar expo-document-picker para cargar subtítulos externos.');
      return;
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/x-subrip', 'text/plain', '*/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0] || result;
      const uri = asset.uri;
      const name = asset.name || 'Subtítulo externo';
      const content = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
      const parsed = parseSrt(content);
      if (!parsed.length) {
        Alert.alert('SRT inválido', 'No se pudieron leer subtítulos válidos en este archivo.');
        return;
      }
      setExternalSubtitles(parsed);
      setExternalSubtitleName(name);
      setShowControls(true);
      Alert.alert('Subtítulo cargado', `${name}\n${parsed.length} líneas listas.`);
    } catch (e) {
      logger.log('SRT load error:', e?.message || e);
      Alert.alert('Error SRT', 'No se pudo cargar el archivo de subtítulos.');
    }
  }, [type]);

  const setGestureMessage = useCallback((message) => {
    setGestureHint(message);
    setTimeout(() => setGestureHint(null), 900);
  }, []);

  const gestureResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !gestureStateRef.current.screenLocked,
    onMoveShouldSetPanResponder: (_, gesture) => !gestureStateRef.current.screenLocked && (Math.abs(gesture.dx) > 10 || Math.abs(gesture.dy) > 10),
    onPanResponderGrant: (evt) => {
      gestureStartRef.current = {
        x: evt.nativeEvent.locationX || 0,
        y: evt.nativeEvent.locationY || 0,
        time: Number(player.currentTime || currentTime || 0),
        volume: Number(player.volume ?? 1),
        brightness: gestureStateRef.current.brightnessLevel,
      };
    },
    onPanResponderMove: (evt, gesture) => {
      const state = gestureStateRef.current;
      if (state.pipActive || state.showTrackModal || state.showNextEpPrompt || state.playerStatus === 'error') return;
      const start = gestureStartRef.current;
      if (Math.abs(gesture.dx) > Math.abs(gesture.dy)) {
        if (type === 'live') return;
        const deltaSeconds = Math.round(gesture.dx / 8);
        const max = state.duration > 2 ? state.duration - 2 : 36000;
        const target = Math.max(0, Math.min(max, start.time + deltaSeconds));
        // Solo actualizamos la UI durante el arrastre. El seek real se hace al soltar.
        setCurrentTime(target);
        setGestureMessage(`${deltaSeconds >= 0 ? '+' : ''}${deltaSeconds}s`);
      } else {
        const isRightSide = (evt.nativeEvent.pageX || 0) > 360;
        const delta = Math.max(-1, Math.min(1, -gesture.dy / 260));
        if (isRightSide) {
          const nextVolume = Math.max(0, Math.min(1, start.volume + delta));
          try { player.volume = nextVolume; } catch (_) {}
          setGestureMessage(`Volumen ${Math.round(nextVolume * 100)}%`);
        } else {
          const base = Number.isFinite(start.brightness) && start.brightness !== null ? start.brightness : 0.5;
          const nextBrightness = Math.max(0.05, Math.min(1, base + delta));
          setBrightnessLevel(nextBrightness);
          if (Brightness?.setBrightnessAsync) Brightness.setBrightnessAsync(nextBrightness).catch(() => {});
          setGestureMessage(`Brillo ${Math.round(nextBrightness * 100)}%`);
        }
      }
    },
    onPanResponderRelease: (_, gesture) => {
      if (type === 'live' || Math.abs(gesture.dx) < 24 || Math.abs(gesture.dx) < Math.abs(gesture.dy)) return;
      const state = gestureStateRef.current;
      const start = gestureStartRef.current;
      const deltaSeconds = Math.round(gesture.dx / 8);
      const max = state.duration > 2 ? state.duration - 2 : 36000;
      const target = Math.max(0, Math.min(max, start.time + deltaSeconds));
      performSeekTo(target, { resume: true });
    },
  })).current;


  useEffect(() => {
    gestureStateRef.current = {
      screenLocked,
      pipActive,
      showTrackModal,
      showNextEpPrompt,
      playerStatus,
      duration,
      brightnessLevel,
    };
  }, [screenLocked, pipActive, showTrackModal, showNextEpPrompt, playerStatus, duration, brightnessLevel]);

  // ─── PiP ─────────────────────────────────────────────────────────────────
  const handlePip = useCallback(async () => {
    if (!pipSupported || !viewRef.current) return;
    try {
      await viewRef.current.startPictureInPicture();
    } catch (e) {
      logger.log('PiP error:', e);
      Alert.alert('PiP no disponible', 'Tu dispositivo no soporta Picture-in-Picture para este contenido.');
    }
  }, [pipSupported]);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <StatusBar hidden translucent backgroundColor="transparent" />

      {/* ── VIDEO (expo-video) ── */}
      <VideoView
        ref={viewRef}
        player={player}
        style={StyleSheet.absoluteFillObject}
        contentFit="contain"
        nativeControls={false}
        allowsFullscreen={false}       // manejamos nosotros la orientación
        allowsPictureInPicture={pipSupported}
        startsPictureInPictureAutomatically={pipSupported}
        onPictureInPictureStart={() => {
          setPipActive(true);
          NavigationBar.setVisibilityAsync('visible').catch(() => {});
        }}
        onPictureInPictureStop={() => {
          setPipActive(false);
          hideSystemUI();
        }}
      />

      {/* Capa táctil invisible: al tocar la pantalla vuelve a mostrar controles */}
      {!isTV && !pipActive && canPlay && !showTrackModal && !showNextEpPrompt && playerStatus !== 'error' && (
        <Pressable
          style={styles.touchCatcher}
          onPress={handleScreenPress}
          onFocus={showControlsTemporarily}
          {...(!isTV ? gestureResponder.panHandlers : {})}
        />
      )}

      {/* ── LOADING ── */}
      {playerStatus === 'loading' && !playbackStarted && (
        <View style={styles.overlay}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.loadingText}>
            {offlineMode ? 'Cargando descarga' : 'Cargando'}{' '}
            {cleanName(stream.name || stream.title || '')}...
          </Text>
        </View>
      )}

      {/* ── ERROR ── */}
      {stallDetected && playerStatus !== 'error' && !pipActive && (
        <View style={styles.stallRecoveryBox} pointerEvents="none">
          <ActivityIndicator color={colors.accent} size="small" />
          <Text style={styles.stallRecoveryText}>Recuperando senal...</Text>
        </View>
      )}

      {playerStatus === 'error' && (
        <View style={styles.overlay}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorText}>No se pudo cargar el contenido</Text>
          <Text style={styles.errorSub}>
            {offlineMode ? 'La descarga puede estar dañada' : 'El stream puede estar inactivo'}
          </Text>
          <FocusableButton style={styles.retryBtn} onPress={handleRetry}>
            <Text style={styles.retryText}>↺  Reintentar</Text>
          </FocusableButton>
          <FocusableButton style={[styles.retryBtn, styles.retryBtnSecondary]} onPress={goBackSafe}>
            <Text style={[styles.retryText, { color: colors.textSecondary }]}>← Volver</Text>
          </FocusableButton>
        </View>
      )}

      {/* ── CONTROLES OVERLAY tipo Netflix: se ocultan solos al reproducir ── */}
      {!pipActive && showControls && playerStatus !== 'error' && (
        <View
          pointerEvents="box-none"
          style={styles.controlsLayer}
        >
          {/* Volver */}
          <FocusableButton
            style={styles.backBtn}
            onFocus={showControlsTemporarily}
            onPress={goBackSafe}
          >
            <Text style={styles.backText}>← Volver</Text>
          </FocusableButton>

          {/* Acciones derecha */}
          <View style={styles.actionsRight}>
            <FocusableButton style={styles.roundBtn} onFocus={showControlsTemporarily} onPress={handleFavorite}>
              <Text style={styles.roundBtnText}>{favoriteActive ? '★' : '☆'}</Text>
            </FocusableButton>

            {canDownload && (
              <FocusableButton
                style={styles.roundBtn}
                onFocus={showControlsTemporarily}
                onPress={handleDownload}
                disabled={downloadProgress > 0 && downloadProgress < 1}
              >
                <Text style={styles.roundBtnTextSmall}>
                  {downloaded
                    ? '✓'
                    : downloadProgress > 0 && downloadProgress < 1
                    ? `${Math.round(downloadProgress * 100)}%`
                    : '⬇'}
                </Text>
              </FocusableButton>
            )}

            {/* Botón PiP */}
            {pipSupported && (
              <FocusableButton style={styles.roundBtn} onFocus={showControlsTemporarily} onPress={handlePip}>
                <Text style={styles.roundBtnTextSmall}>⧉</Text>
              </FocusableButton>
            )}

            {castAvailable && CastButton && (
              <View style={styles.roundBtn}>
                <CastButton style={styles.castBtn} />
              </View>
            )}

            <FocusableButton
              style={[styles.roundBtn, screenLocked && styles.roundBtnActive]}
              onFocus={showControlsTemporarily}
              onPress={handleToggleScreenLock}
            >
              <Text style={styles.roundBtnTextSmall}>🔒</Text>
            </FocusableButton>

            <FocusableButton style={styles.roundBtn} onFocus={showControlsTemporarily} onPress={() => openTrackModal('audio')}>
              <Text style={styles.roundBtnTextSmall}>⚙</Text>
            </FocusableButton>
          </View>

          {/* Controles centrales: pausar, retroceder, adelantar */}
          <View style={styles.centerControls} pointerEvents="box-none">
            {type !== 'live' && (
              <FocusableButton style={styles.seekBtn} onFocus={showControlsTemporarily} onPress={() => seekBy(-10)}>
                <Text style={styles.seekText}>↺ 10</Text>
              </FocusableButton>
            )}

            <FocusableButton
              style={[styles.playPauseBtn, type === 'live' && isTV && styles.liveGuideBtn]}
              onFocus={showControlsTemporarily}
              onPress={type === 'live' && isTV ? openLiveGuide : handlePlayPause}
              hasTVPreferredFocus={false}
            >
              <Text style={styles.playPauseText}>{type === 'live' && isTV ? '☰' : isPlaying ? '❚❚' : '▶'}</Text>
            </FocusableButton>

            {type !== 'live' && (
              <FocusableButton style={styles.seekBtn} onFocus={showControlsTemporarily} onPress={() => seekBy(10)}>
                <Text style={styles.seekText}>10 ↻</Text>
              </FocusableButton>
            )}
          </View>

          {type !== 'live' && duration > 0 && (
            <View style={styles.progressWrap}>
              <Text style={styles.progressTime}>
                {Math.floor(currentTime / 60)}:{String(Math.floor(currentTime % 60)).padStart(2, '0')}
              </Text>
              {/* Barra de progreso interactiva — toca o arrastra para seekear */}
              <View
                ref={progressTrackRef}
                style={styles.progressTrack}
                onStartShouldSetResponder={() => !screenLocked}
                onMoveShouldSetResponder={() => !screenLocked}
                onResponderGrant={(e) => {
                  if (screenLocked || !progressTrackRef.current) return;
                  const { locationX } = e.nativeEvent;
                  progressTrackRef.current.measure((fx, fy, width) => {
                    if (width > 0) {
                      const pct = Math.max(0, Math.min(1, locationX / width));
                      const target = Math.floor(pct * duration);
                      progressPreviewRef.current = target;
                      setCurrentTime(target);
                    }
                  });
                }}
                onResponderMove={(e) => {
                  if (screenLocked || !progressTrackRef.current) return;
                  const { locationX } = e.nativeEvent;
                  progressTrackRef.current.measure((fx, fy, width) => {
                    if (width > 0) {
                      const pct = Math.max(0, Math.min(1, locationX / width));
                      const target = Math.floor(pct * duration);
                      progressPreviewRef.current = target;
                      setCurrentTime(target);
                    }
                  });
                }}
                onResponderRelease={() => {
                  if (screenLocked) return;
                  const target = progressPreviewRef.current;
                  progressPreviewRef.current = null;
                  if (Number.isFinite(target)) performSeekTo(target, { resume: true });
                }}
                onResponderTerminate={() => { progressPreviewRef.current = null; }}
              >
                {/* Track background */}
                <View style={styles.progressTrackInner} />
                {/* Fill */}
                <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, (currentTime / duration) * 100))}%` }]} />
                {/* Thumb */}
                <View style={[styles.progressThumb, { left: `${Math.max(0, Math.min(99, (currentTime / duration) * 100))}%` }]} />
              </View>
              <Text style={styles.progressTime}>
                {Math.floor(duration / 60)}:{String(Math.floor(duration % 60)).padStart(2, '0')}
              </Text>
            </View>
          )}

          {/* Barra info */}
          <View style={styles.infoBar}>
            <View style={styles.infoTextWrap}>
              <Text style={styles.channelName} numberOfLines={2}>
                {cleanName(stream.name || stream.title || '')}
              </Text>
              {offlineMode && <Text style={styles.offlineText}>🔒 Sin conexión</Text>}
              {duration > 0 && currentTime > 0 && (
                <Text style={styles.offlineText}>{formatTime(duration - currentTime)}</Text>
              )}
              {sleepTimeLeft > 0 && (
                <Text style={styles.offlineText}>⏱ Apagado en {Math.ceil(sleepTimeLeft / 60)} min</Text>
              )}
            </View>
            {type === 'live' && (
              <View style={styles.liveDot}>
                <Text style={styles.liveText}>● EN VIVO</Text>
              </View>
            )}
          </View>

          {/* Accesos rápidos inferiores: como en versiones anteriores */}
          {type !== 'live' && (
            <View style={styles.trackQuickActions} pointerEvents="box-none">
              <FocusableButton style={styles.trackQuickBtn} onFocus={showControlsTemporarily} onPress={() => openTrackModal('subtitles')}>
                <Text style={styles.trackQuickText}>CC</Text>
              </FocusableButton>
              <FocusableButton style={styles.trackQuickBtn} onFocus={showControlsTemporarily} onPress={() => openTrackModal('audio')}>
                <Text style={styles.trackQuickText}>Audio</Text>
              </FocusableButton>
              <FocusableButton style={styles.trackQuickBtn} onFocus={showControlsTemporarily} onPress={handleLoadExternalSrt}>
                <Text style={styles.trackQuickText}>{externalSubtitles.length ? 'SRT ✓' : 'SRT'}</Text>
              </FocusableButton>
            </View>
          )}

          {activeExternalSubtitle && (
            <View style={styles.externalSubtitleBox} pointerEvents="none">
              <Text style={styles.externalSubtitleText}>{activeExternalSubtitle.text}</Text>
              {!!externalSubtitleName && <Text style={styles.externalSubtitleName}>{externalSubtitleName}</Text>}
            </View>
          )}

          {gestureHint && (
            <View style={styles.gestureHintBox} pointerEvents="none">
              <Text style={styles.gestureHintText}>{gestureHint}</Text>
            </View>
          )}

          {showSkipCredits && !showNextEpPrompt && (
            <FocusableButton style={styles.skipCreditsBtn} onFocus={showControlsTemporarily} onPress={handleSkipCredits}>
              <Text style={styles.skipCreditsText}>Saltar créditos</Text>
            </FocusableButton>
          )}

          {showRating && (
            <View style={styles.ratingOverlay} pointerEvents="box-none">
              <Text style={styles.ratingTitle}>¿Te gustó este contenido?</Text>
              <View style={styles.ratingBtns}>
                <FocusableButton style={styles.ratingBtn} onPress={() => handleRateContent('like')}>
                  <Text style={styles.ratingEmoji}>👍</Text>
                  <Text style={styles.ratingLabel}>Me gustó</Text>
                </FocusableButton>
                <FocusableButton style={styles.ratingBtn} onPress={() => handleRateContent('dislike')}>
                  <Text style={styles.ratingEmoji}>👎</Text>
                  <Text style={styles.ratingLabel}>No me gustó</Text>
                </FocusableButton>
              </View>
              <FocusableButton onPress={() => setShowRating(false)}>
                <Text style={styles.ratingSkip}>Omitir</Text>
              </FocusableButton>
            </View>
          )}

          {/* Prompt siguiente episodio */}
          {showNextEpPrompt && nextEp && (
            <View style={styles.nextEpPrompt}>
              <Text style={styles.nextEpLabel}>A continuación</Text>
              <Text style={styles.nextEpTitle} numberOfLines={2}>
                {nextEp.name || `Episodio ${currentEpisodeIndex + 2}`}
              </Text>
              <View style={styles.nextEpButtons}>
                <FocusableButton style={styles.nextEpPlayBtn} onFocus={showControlsTemporarily} onPress={playNextEpisode}>
                  <Text style={styles.nextEpPlayText}>▶ Reproducir ({nextEpCountdown}s)</Text>
                </FocusableButton>
                <FocusableButton style={styles.nextEpCancelBtn} onFocus={showControlsTemporarily} onPress={cancelNextEp}>
                  <Text style={styles.nextEpCancelText}>Cancelar</Text>
                </FocusableButton>
              </View>
            </View>
          )}
        </View>
      )}

      {screenLocked && (
        <Pressable
          style={[styles.lockOverlay, !showLockMessage && styles.lockOverlayHidden]}
          onPress={showLockHintTemporarily}
          onLongPress={() => {
            setScreenLocked(false);
            setShowLockMessage(false);
            setShowControls(true);
            showControlsTemporarily();
          }}
          delayLongPress={1200}
        >
          {showLockMessage && (
            <View style={styles.lockMessageBox} pointerEvents="none">
              <Text style={styles.lockIcon}>🔒</Text>
              <Text style={styles.lockText}>Pantalla bloqueada</Text>
              <Text style={styles.lockHint}>Mantén presionado para desbloquear</Text>
            </View>
          )}
        </Pressable>
      )}

      <Modal visible={showLiveGuide} transparent animationType="fade" onRequestClose={closeLiveGuide}>
        <Pressable
          style={guideStyles.backdrop}
          onPress={() => {
            if (!isTV) closeLiveGuide();
          }}
          focusable={false}
          accessible={false}
        >
          <TVFocusGuideView autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={guideStyles.focusGuide}>
            <Pressable style={guideStyles.shell} onPress={() => {}} focusable={false} accessible={false}>
              <View style={guideStyles.sideRail}>
                <Text style={guideStyles.railTitle}>TV</Text>
                <FocusableButton style={guideStyles.railAction} onPress={closeLiveGuide}>
                  <Text style={guideStyles.railActionText}>Volver</Text>
                </FocusableButton>
                <FocusableButton style={guideStyles.railAction} onPress={() => {
                  setShowLiveGuide(false);
                  navigation.navigate('MainTabs', { screen: 'Search' });
                }}>
                  <Text style={guideStyles.railActionText}>Buscar</Text>
                </FocusableButton>
                <FocusableButton style={guideStyles.railAction} onPress={handleFavorite}>
                  <Text style={guideStyles.railActionText}>{favoriteActive ? 'Quitar fav' : 'Favorito'}</Text>
                </FocusableButton>
              </View>

              <View style={guideStyles.categoryPanel}>
                <Text style={guideStyles.panelTitle}>Categorias</Text>
                {liveGuideLoading && !liveGuideCategories.length ? (
                  <View style={guideStyles.loadingBox}>
                    <ActivityIndicator color={colors.accent} size="small" />
                    <Text style={guideStyles.loadingText}>Cargando</Text>
                  </View>
                ) : (
                  <FlatList
                    data={liveGuideCategories}
                    keyExtractor={(item, index) => `guide-cat-${item.category_id || index}`}
                    showsVerticalScrollIndicator={false}
                    renderItem={({ item, index }) => {
                      const active = String(item.category_id) === String(liveGuideCategoryId);
                      return (
                        <FocusableButton
                          style={[guideStyles.categoryBtn, active && guideStyles.categoryBtnActive]}
                          focusedStyle={guideStyles.focused}
                          hasTVPreferredFocus={isTV && index === 0 && !liveGuideCategoryId}
                          onPress={() => setLiveGuideCategoryId(item.category_id)}
                        >
                          <Text style={[guideStyles.categoryText, active && guideStyles.activeText]} numberOfLines={1}>
                            {cleanCategoryName(item.category_name || 'Categoria')}
                          </Text>
                        </FocusableButton>
                      );
                    }}
                  />
                )}
              </View>

              <View style={guideStyles.channelPanel}>
                <View style={guideStyles.channelHeader}>
                  <Text style={guideStyles.panelTitle}>Lista de canales</Text>
                  <Text style={guideStyles.counterText}>{liveGuideFilteredChannels.length}</Text>
                </View>
                <FlatList
                  data={liveGuideFilteredChannels}
                  keyExtractor={(item, index) => `guide-channel-${item.stream_id || item.name || index}`}
                  showsVerticalScrollIndicator={false}
                  ListEmptyComponent={
                    <View style={guideStyles.emptyBox}>
                      <Text style={guideStyles.emptyText}>Sin canales en esta categoria</Text>
                    </View>
                  }
                  renderItem={({ item }) => {
                    const active = String(item.stream_id || item.name) === String(stream?.stream_id || stream?.name);
                    return (
                      <FocusableButton
                        style={[guideStyles.channelRow, active && guideStyles.channelRowActive]}
                        focusedStyle={guideStyles.focused}
                        onPress={() => playLiveGuideChannel(item)}
                      >
                        {item.stream_icon ? (
                          <Image source={{ uri: item.stream_icon }} style={guideStyles.channelLogo} resizeMode="contain" />
                        ) : (
                          <View style={guideStyles.channelLogoFallback}>
                            <Text style={guideStyles.channelLogoText}>{String(item.name || '?').charAt(0)}</Text>
                          </View>
                        )}
                        <View style={guideStyles.channelInfo}>
                          <Text style={[guideStyles.channelName, active && guideStyles.activeText]} numberOfLines={1}>
                            {active ? '▶ ' : ''}{cleanName(item.name || '')}
                          </Text>
                          <Text style={guideStyles.channelMeta} numberOfLines={1}>
                            {cleanCategoryName(item.category_name || 'En vivo')}
                          </Text>
                        </View>
                        <Text style={guideStyles.channelArrow}>›</Text>
                      </FocusableButton>
                    );
                  }}
                />
              </View>
            </Pressable>
          </TVFocusGuideView>
        </Pressable>
      </Modal>

      {/* Modal audio/subtítulos */}
      <Modal visible={showTrackModal} transparent animationType="fade" onRequestClose={closeTrackModal}>
        <Pressable
          style={trackStyles.backdrop}
          onPress={() => {
            if (!isTV) closeTrackModal();
          }}
          focusable={false}
          accessible={false}
        >
          <TVFocusGuideView autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={trackStyles.focusGuide}>
          <Pressable style={trackStyles.box} onPress={() => {}} focusable={false} accessible={false}>
            <Text style={trackStyles.title}>🎧 Audio y subtítulos</Text>

            <View style={trackStyles.tabs}>
              {['audio','subtitles','boost'].map(t => (
                <FocusableButton key={t}
                  style={[trackStyles.tabBtn, trackTab === t && trackStyles.tabBtnActive]}
                  hasTVPreferredFocus={isTV && trackTab === t}
                  onPress={() => setTrackTab(t)}
                >
                  <Text style={[trackStyles.tabText, trackTab === t && trackStyles.tabTextActive]}>
                    {t === 'audio' ? 'Audio' : t === 'subtitles' ? 'Subtítulos' : '🔊 Boost'}
                  </Text>
                </FocusableButton>
              ))}
            </View>

            <ScrollView style={{ maxHeight: isTV ? 260 : 360 }}>
              {trackTab === 'audio' ? (
                <View style={trackStyles.section}>
                  <Text style={trackStyles.sectionLabel}>AUDIO DISPONIBLE</Text>
                  {audioTracks.length === 0 ? (
                    <Text style={trackStyles.info}>Este stream no informa pistas de audio seleccionables.</Text>
                  ) : audioTracks.map((track, index) => {
                    const active = selectedAudioTrack && getTrackKey(selectedAudioTrack, -1) === getTrackKey(track, index);
                    return (
                      <FocusableButton
                        key={`audio-${getTrackKey(track, index)}-${index}`}
                        style={[trackStyles.trackOption, active && trackStyles.trackOptionActive]}
                        onPress={() => selectAudioTrack(track)}
                      >
                        <Text style={[trackStyles.trackText, active && trackStyles.trackTextActive]}>
                          {active ? '✓ ' : ''}{getTrackLabel(track, index, 'Audio')}
                        </Text>
                      </FocusableButton>
                    );
                  })}
                </View>
              ) : trackTab === 'subtitles' ? (
                <View style={trackStyles.section}>
                  <Text style={trackStyles.sectionLabel}>SUBTÍTULOS DISPONIBLES</Text>
                  <FocusableButton
                    style={[trackStyles.trackOption, !selectedSubtitleTrack && trackStyles.trackOptionActive]}
                    onPress={() => selectSubtitleTrack(null)}
                  >
                    <Text style={[trackStyles.trackText, !selectedSubtitleTrack && trackStyles.trackTextActive]}>
                      {!selectedSubtitleTrack ? '✓ ' : ''}Desactivados
                    </Text>
                  </FocusableButton>

                  {subtitleTracks.length === 0 ? (
                    <Text style={trackStyles.info}>Este stream no informa subtítulos seleccionables. Si vienen quemados en la imagen, se mostrarán automáticamente.</Text>
                  ) : subtitleTracks.map((track, index) => {
                    const active = selectedSubtitleTrack && getTrackKey(selectedSubtitleTrack, -1) === getTrackKey(track, index);
                    return (
                      <FocusableButton
                        key={`sub-${getTrackKey(track, index)}-${index}`}
                        style={[trackStyles.trackOption, active && trackStyles.trackOptionActive]}
                        onPress={() => selectSubtitleTrack(track)}
                      >
                        <Text style={[trackStyles.trackText, active && trackStyles.trackTextActive]}>
                          {active ? '✓ ' : ''}{getTrackLabel(track, index, 'Subtítulo')}
                        </Text>
                      </FocusableButton>
                    );
                  })}
                </View>
              ) : null}

              {trackTab === 'boost' && (
                <View style={trackStyles.section}>
                  <Text style={trackStyles.sectionLabel}>VOLUMEN BOOST</Text>
                  <Text style={trackStyles.info}>Para streams con audio bajo. 1.0× = normal, 2.0× = doble volumen.</Text>
                  <View style={trackStyles.boostRow}>
                    {[1.0, 1.25, 1.5, 1.75, 2.0].map(b => (
                      <FocusableButton key={b}
                        style={[trackStyles.trackOption, audioBoost === b && trackStyles.trackOptionActive]}
                        onPress={() => handleAudioBoost(b)}
                      >
                        <Text style={[trackStyles.trackText, audioBoost === b && trackStyles.trackTextActive]}>
                          {audioBoost === b ? '✓ ' : ''}{b.toFixed(2)}×
                        </Text>
                      </FocusableButton>
                    ))}
                  </View>

                  <Text style={[trackStyles.sectionLabel, { marginTop: 18 }]}>VELOCIDAD</Text>
                  <View style={trackStyles.boostRow}>
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map(speed => (
                      <FocusableButton key={speed}
                        style={[trackStyles.trackOption, playbackSpeed === speed && trackStyles.trackOptionActive]}
                        onPress={() => handleSpeedChange(speed)}
                      >
                        <Text style={[trackStyles.trackText, playbackSpeed === speed && trackStyles.trackTextActive]}>
                          {playbackSpeed === speed ? '✓ ' : ''}{speed}×
                        </Text>
                      </FocusableButton>
                    ))}
                  </View>

                  <Text style={[trackStyles.sectionLabel, { marginTop: 18 }]}>TEMPORIZADOR</Text>
                  <View style={trackStyles.boostRow}>
                    {[0, 15, 30, 60, 90].map(minutes => (
                      <FocusableButton key={minutes}
                        style={[trackStyles.trackOption, sleepMinutes === minutes && trackStyles.trackOptionActive]}
                        onPress={() => handleSleepTimer(minutes)}
                      >
                        <Text style={[trackStyles.trackText, sleepMinutes === minutes && trackStyles.trackTextActive]}>
                          {sleepMinutes === minutes ? '✓ ' : ''}{minutes === 0 ? 'Off' : `${minutes}m`}
                        </Text>
                      </FocusableButton>
                    ))}
                  </View>

                  <Text style={[trackStyles.sectionLabel, { marginTop: 18 }]}>TAMAÑO SUBTÍTULOS</Text>
                  <View style={trackStyles.boostRow}>
                    {[12, 14, 16, 20, 24, 28].map(sz => (
                      <FocusableButton key={sz}
                        style={[trackStyles.trackOption, subtitleSize === sz && trackStyles.trackOptionActive]}
                        onPress={() => setSubtitleSize(sz)}
                      >
                        <Text style={[trackStyles.trackText, subtitleSize === sz && trackStyles.trackTextActive]}>
                          {subtitleSize === sz ? '✓ ' : ''}{sz}px
                        </Text>
                      </FocusableButton>
                    ))}
                  </View>

                  <Text style={[trackStyles.sectionLabel, { marginTop: 18 }]}>COLOR SUBTÍTULOS</Text>
                  <View style={trackStyles.colorRow}>
                    {['#FFFFFF','#FFFF00','#00FF00','#00CFFF','#FF8C00'].map(c => (
                      <FocusableButton key={c}
                        style={[trackStyles.colorSwatch, { backgroundColor: c }, subtitleColor === c && trackStyles.colorSwatchActive]}
                        onPress={() => setSubtitleColor(c)}
                      >
                        {subtitleColor === c && <Text style={{ color: '#000', fontSize: 14, fontWeight: 'bold' }}>✓</Text>}
                      </FocusableButton>
                    ))}
                  </View>
                </View>
              )}
            </ScrollView>

            <FocusableButton style={trackStyles.closeBtn} onPress={closeTrackModal}>
              <Text style={trackStyles.closeBtnText}>Cerrar</Text>
            </FocusableButton>
          </Pressable>
          </TVFocusGuideView>
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  touchCatcher: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  controlsLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
    opacity: 1,
  },
  controlsHidden: {
    opacity: 0,
  },
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center', alignItems: 'center', gap: 12,
    zIndex: 5,
  },
  loadingText: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', paddingHorizontal: 20 },
  errorIcon: { fontSize: 40 },
  errorText: { color: colors.white, fontSize: 18, fontWeight: 'bold' },
  errorSub:  { color: colors.textSecondary, fontSize: 13 },
  retryBtn: {
    marginTop: 8, backgroundColor: colors.primary,
    paddingHorizontal: 28, paddingVertical: 13, borderRadius: 10,
    minWidth: 160, alignItems: 'center',
  },
  retryBtnSecondary: { backgroundColor: 'rgba(255,255,255,0.08)', marginTop: 4 },
  retryText: { color: colors.white, fontWeight: '600', fontSize: 15 },
  backBtn: {
    position: 'absolute', top: 40, left: 16,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
  },
  backText: { color: colors.accent, fontSize: 14 },
  actionsRight: {
    position: 'absolute', top: 38, right: 48,
    flexDirection: 'row', gap: 10,
  },
  roundBtn: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    minWidth: 42, height: 42, borderRadius: 21,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 8,
  },
  roundBtnText:      { color: '#FFD700', fontSize: 26, fontWeight: 'bold', marginTop: -2 },
  roundBtnTextSmall: { color: colors.white, fontSize: 14, fontWeight: 'bold' },
  castBtn: { width: 42, height: 42, tintColor: colors.white },
  centerControls: {
    position: 'absolute', top: '42%', left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 22,
  },
  playPauseBtn: {
    width: 74, height: 74, borderRadius: 37,
    backgroundColor: 'rgba(0,0,0,0.68)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
  },
  liveGuideBtn: {
    borderRadius: 16,
    backgroundColor: 'rgba(31,125,255,0.72)',
    borderColor: 'rgba(255,255,255,0.48)',
  },
  playPauseText: { color: colors.white, fontSize: 30, fontWeight: 'bold', marginLeft: 2 },
  seekBtn: {
    minWidth: 72, height: 50, borderRadius: 25,
    backgroundColor: 'rgba(0,0,0,0.58)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 12,
  },
  seekText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  progressWrap: {
    position: 'absolute', bottom: 62, left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  progressTrack: {
    flex: 1,
    height: 22,            // área táctil grande
    justifyContent: 'center',
    backgroundColor: 'transparent',
    paddingVertical: 9,    // centra la barra dentro del área táctil
  },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: colors.accent, position: 'absolute', top: 9, left: 0 },
  progressTrackInner: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', position: 'absolute', top: 9, left: 0, right: 0 },
  progressThumb: {
    position: 'absolute',
    top: -5,
    width: 14, height: 14,
    borderRadius: 7,
    backgroundColor: '#fff',
    marginLeft: -7,
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 3, elevation: 4,
  },
  progressTime: { color: colors.textSecondary, fontSize: 11, minWidth: 42, textAlign: 'center' },
  infoBar: {
    position: 'absolute', bottom: 100, left: 16, right: 16,
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
  },
  infoTextWrap: { flex: 1, paddingRight: 12 },
  channelName: {
    color: colors.white, fontSize: 16, fontWeight: 'bold',
    textShadowColor: '#000', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  offlineText: { color: colors.accent, fontSize: 11, marginTop: 4 },
  liveDot: {
    backgroundColor: 'rgba(255,0,0,0.2)',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6,
    borderWidth: 1, borderColor: '#ff3b3b55',
  },
  liveText: { color: '#ff5555', fontSize: 11, fontWeight: 'bold' },
  trackQuickActions: {
    position: 'absolute', left: 32, bottom: 86,
    flexDirection: 'row', gap: 10, zIndex: 7,
  },
  trackQuickBtn: {
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    paddingHorizontal: 16,
    height: 38,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackQuickText: { color: colors.white, fontSize: 13, fontWeight: '800' },

  externalSubtitleBox: {
    position: 'absolute', left: 80, right: 80, bottom: 126,
    alignItems: 'center', justifyContent: 'center',
  },
  externalSubtitleText: {
    color: '#fff', fontSize: isTV ? 24 : 18, fontWeight: '700', textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.62)', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8,
    textShadowColor: '#000', textShadowRadius: 4,
  },
  externalSubtitleName: { color: colors.textSecondary, fontSize: 10, marginTop: 3 },
  gestureHintBox: {
    position: 'absolute', alignSelf: 'center', top: '30%',
    backgroundColor: 'rgba(0,0,0,0.68)', borderRadius: 16, paddingHorizontal: 18, paddingVertical: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  gestureHintText: { color: colors.white, fontSize: 18, fontWeight: '800' },
  stallRecoveryBox: {
    position: 'absolute',
    top: 28,
    alignSelf: 'center',
    zIndex: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  stallRecoveryText: { color: colors.white, fontSize: 14, fontWeight: '800' },

  // ── Next Episode ────────────────────────────────────────────────────────────
  nextEpPrompt: {
    position: 'absolute', bottom: 110, right: 16,
    backgroundColor: 'rgba(20,20,30,0.92)',
    borderRadius: 14, padding: 16, maxWidth: 280,
    borderWidth: 1, borderColor: 'rgba(100,100,200,0.3)',
  },
  nextEpLabel:  { color: colors.accent, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 6 },
  nextEpTitle:  { color: colors.white, fontSize: 14, fontWeight: '600', marginBottom: 12, lineHeight: 20 },
  nextEpButtons: { flexDirection: 'row', gap: 8 },
  nextEpPlayBtn: {
    flex: 1, backgroundColor: colors.primary,
    borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center',
  },
  nextEpPlayText:   { color: colors.white, fontSize: 12, fontWeight: '700' },
  nextEpCancelBtn: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center',
  },
  nextEpCancelText: { color: colors.textSecondary, fontSize: 12 },
  roundBtnActive: { borderColor: '#FFD700', backgroundColor: 'rgba(255,215,0,0.15)' },
  lockOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center', alignItems: 'center', gap: 12, zIndex: 999,
  },
  lockOverlayHidden: { backgroundColor: 'transparent' },
  lockMessageBox: { justifyContent: 'center', alignItems: 'center', gap: 12 },
  lockIcon: { fontSize: 52 },
  lockText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  lockHint: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  skipCreditsBtn: {
    position: 'absolute',
    bottom: 130, right: 16,
    backgroundColor: 'rgba(20,20,30,0.92)',
    borderRadius: 10,
    paddingVertical: 12, paddingHorizontal: 20,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  skipCreditsText: { color: '#fff', fontWeight: '700', fontSize: isTV ? 16 : 13 },
  ratingOverlay: {
    position: 'absolute', bottom: 110, left: 0, right: 0,
    alignItems: 'center', gap: 16,
  },
  ratingTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', textShadowColor: '#000', textShadowOffset: {width:0,height:1}, textShadowRadius: 6 },
  ratingBtns: { flexDirection: 'row', gap: 20 },
  ratingBtn: { backgroundColor: 'rgba(20,20,30,0.88)', borderRadius: 16, paddingVertical: 16, paddingHorizontal: 28, alignItems: 'center', gap: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  ratingEmoji: { fontSize: 36 },
  ratingLabel: { color: '#fff', fontSize: 13, fontWeight: '600' },
  ratingSkip: { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
});

const guideStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.26)',
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingVertical: isTV ? 30 : 18,
    paddingLeft: isTV ? 54 : 12,
    paddingRight: isTV ? 20 : 12,
  },
  focusGuide: { width: '100%' },
  shell: {
    width: isTV ? '64%' : '100%',
    minWidth: isTV ? 690 : 0,
    maxWidth: isTV ? 780 : 620,
    height: isTV ? '88%' : '82%',
    flexDirection: 'row',
    backgroundColor: 'rgba(11,16,28,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  sideRail: {
    width: isTV ? 150 : 84,
    backgroundColor: 'rgba(5,7,11,0.62)',
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.12)',
    padding: isTV ? 14 : 10,
    gap: isTV ? 12 : 8,
  },
  railTitle: { color: colors.white, fontSize: isTV ? 24 : 18, fontWeight: '900', marginBottom: 8 },
  railAction: {
    minHeight: isTV ? 42 : 36,
    borderRadius: 6,
    paddingHorizontal: 10,
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  railActionText: { color: colors.white, fontSize: isTV ? 13 : 11, fontWeight: '800' },
  categoryPanel: {
    width: isTV ? 220 : 150,
    backgroundColor: 'rgba(17,25,42,0.78)',
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.12)',
    padding: isTV ? 12 : 8,
  },
  channelPanel: { flex: 1, padding: isTV ? 12 : 8 },
  channelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: isTV ? 8 : 6,
  },
  panelTitle: { color: colors.white, fontSize: isTV ? 14 : 12, fontWeight: '900', marginBottom: isTV ? 8 : 6 },
  counterText: { color: colors.textSecondary, fontSize: isTV ? 12 : 10, fontWeight: '800' },
  categoryBtn: {
    minHeight: isTV ? 42 : 34,
    borderRadius: 4,
    paddingHorizontal: 10,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: 4,
  },
  categoryBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.accent,
  },
  categoryText: { color: colors.textSecondary, fontSize: isTV ? 13 : 11, fontWeight: '800' },
  activeText: { color: colors.white },
  focused: {
    borderColor: colors.white,
    backgroundColor: 'rgba(31,125,255,0.38)',
  },
  channelRow: {
    minHeight: isTV ? 54 : 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: isTV ? 11 : 8,
    paddingHorizontal: isTV ? 10 : 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  channelRowActive: { backgroundColor: 'rgba(31,125,255,0.20)' },
  channelLogo: { width: isTV ? 44 : 34, height: isTV ? 34 : 28, backgroundColor: 'rgba(0,0,0,0.28)' },
  channelLogoFallback: {
    width: isTV ? 44 : 34,
    height: isTV ? 34 : 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  channelLogoText: { color: colors.white, fontSize: isTV ? 15 : 12, fontWeight: '900' },
  channelInfo: { flex: 1 },
  channelName: { color: colors.white, fontSize: isTV ? 16 : 13, fontWeight: '900' },
  channelMeta: { color: colors.textSecondary, fontSize: isTV ? 11 : 10, marginTop: 3 },
  channelArrow: { color: colors.textSecondary, fontSize: isTV ? 26 : 20, fontWeight: '300' },
  loadingBox: { paddingVertical: 24, alignItems: 'center', gap: 8 },
  loadingText: { color: colors.textSecondary, fontSize: isTV ? 12 : 10 },
  emptyBox: { padding: 18 },
  emptyText: { color: colors.textSecondary, fontSize: isTV ? 13 : 11 },
});

const trackStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', justifyContent: 'center', alignItems: 'center', padding: isTV ? 14 : 24 },
  focusGuide: { width: '100%', alignItems: 'center' },
  box: {
    width: isTV ? '78%' : '92%', maxWidth: isTV ? 500 : 560, backgroundColor: '#15151d', borderRadius: isTV ? 14 : 20, padding: isTV ? 14 : 22,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  title: { color: colors.white, fontSize: isTV ? 16 : 22, fontWeight: '800', marginBottom: isTV ? 10 : 16 },
  tabs: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 14, padding: 4, marginBottom: isTV ? 10 : 16 },
  tabBtn: { flex: 1, paddingVertical: isTV ? 7 : 10, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  tabBtnActive: { backgroundColor: colors.primary },
  tabText: { color: colors.textSecondary, fontSize: isTV ? 12 : 14, fontWeight: '700' },
  tabTextActive: { color: colors.white },
  section: { marginBottom: isTV ? 10 : 18 },
  sectionLabel: { color: colors.accent, fontSize: isTV ? 10 : 12, fontWeight: '800', marginBottom: isTV ? 7 : 10, letterSpacing: 1 },
  info: { color: colors.textSecondary, fontSize: isTV ? 12 : 14, lineHeight: isTV ? 17 : 20, paddingVertical: isTV ? 6 : 10 },
  trackOption: {
    minHeight: isTV ? 34 : 46,
    borderRadius: isTV ? 9 : 12,
    paddingHorizontal: isTV ? 10 : 14,
    paddingVertical: isTV ? 7 : 12,
    marginBottom: isTV ? 6 : 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
  },
  trackOptionActive: {
    backgroundColor: 'rgba(0, 188, 212, 0.18)',
    borderColor: colors.accent,
  },
  trackText: { color: colors.textSecondary, fontSize: isTV ? 12 : 15, fontWeight: '700' },
  trackTextActive: { color: colors.white },
  closeBtn: { marginTop: isTV ? 8 : 14, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: isTV ? 8 : 12, alignItems: 'center' },
  closeBtnText: { color: colors.white, fontWeight: '800', fontSize: isTV ? 12 : 15 },
});
