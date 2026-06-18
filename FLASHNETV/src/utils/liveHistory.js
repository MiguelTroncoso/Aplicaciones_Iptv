import AsyncStorage from '@react-native-async-storage/async-storage';

export const LAST_LIVE_CHANNEL_KEY = 'flashnetv_last_live_channel_v1';

export const saveLastLiveChannel = async (channel) => {
  if (!channel) return;
  const payload = {
    ...channel,
    savedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(LAST_LIVE_CHANNEL_KEY, JSON.stringify(payload)).catch(() => {});
};

export const loadLastLiveChannel = async () => {
  const raw = await AsyncStorage.getItem(LAST_LIVE_CHANNEL_KEY).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
};

export const mergeLastLiveChannel = (lastChannel, channels = []) => {
  if (!lastChannel) return channels[0] || null;
  const id = String(lastChannel.stream_id || lastChannel.id || lastChannel.name || '');
  const fresh = channels.find(channel =>
    String(channel.stream_id || channel.id || channel.name || '') === id
  );
  return fresh || lastChannel;
};

export const sortChannelsForTV = (items = []) =>
  [...items].sort((a, b) => {
    const leftName = String(a?.name || '').trim();
    const rightName = String(b?.name || '').trim();
    const leftStartsWithNumber = /^\d/.test(leftName);
    const rightStartsWithNumber = /^\d/.test(rightName);

    if (leftStartsWithNumber !== rightStartsWithNumber) {
      return leftStartsWithNumber ? 1 : -1;
    }

    return leftName.localeCompare(rightName, 'es', {
      numeric: true,
      sensitivity: 'base',
    });
  });
