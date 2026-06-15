import { Alert } from 'react-native';

export const MIN_RESUME_MILLIS = 2 * 60 * 1000;
export const FINISHED_PROGRESS_LIMIT = 0.9;

const toMillis = (value = 0) => {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1000 ? n : n * 1000;
};

export const formatResumeClock = (millis = 0) => {
  const totalSeconds = Math.max(0, Math.floor(toMillis(millis) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

export const shouldAskResume = (resumeItem) => {
  if (!resumeItem) return false;
  const positionMillis = toMillis(resumeItem.positionMillis || resumeItem.position || 0);
  const durationMillis = toMillis(resumeItem.durationMillis || resumeItem.duration || 0);
  if (positionMillis < MIN_RESUME_MILLIS) return false;
  if (durationMillis > 0) {
    const progress = positionMillis / durationMillis;
    // Si ya está prácticamente terminada, no forzamos continuar desde el final.
    if (progress >= FINISHED_PROGRESS_LIMIT) return false;
  }
  return true;
};

export const promptResumePlayback = ({ resumeItem, title = 'este contenido', onContinue, onRestart, onCancel }) => {
  if (!shouldAskResume(resumeItem)) {
    onRestart?.();
    return false;
  }

  const positionMillis = toMillis(resumeItem.positionMillis || resumeItem.position || 0);
  const time = formatResumeClock(positionMillis);

  Alert.alert(
    'Continuar viendo',
    `Ya habías empezado "${title}".\n\n¿Quieres continuar desde ${time} o comenzar desde el inicio?`,
    [
      { text: 'Cancelar', style: 'cancel', onPress: onCancel },
      { text: 'Desde el inicio', onPress: onRestart },
      { text: `Continuar ${time}`, onPress: onContinue },
    ],
    { cancelable: true, onDismiss: onCancel }
  );
  return true;
};

export const getResumePositionMillis = (resumeItem) => toMillis(resumeItem?.positionMillis || resumeItem?.position || 0);
