import { Alert } from 'react-native';
import versionInfo from '../../version.json';

export const checkForUpdates = async (silent = false) => {
  if (!silent) {
    Alert.alert(
      'FLASHNETV actualizado',
      `Estas usando FLASHNETV v${versionInfo.version}. El canal de actualizaciones OTA/APK queda pendiente para esta variante.`
    );
  }

  return { upToDate: true, disabled: true };
};
