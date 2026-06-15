import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView,
  Platform, ScrollView, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { isTV, isTablet } from '../utils/tv';
import { useAuth } from '../context/AuthContext';
import { colors, shadows } from '../theme';
import BrandLogo from '../components/BrandLogo';
import versionInfo from '../../version.json';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [username, setUsername]         = useState('');
  const [password, setPassword]         = useState('');
  const [loading, setLoading]           = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert('Error', 'Ingresa tu usuario y contraseña');
      return;
    }
    setLoading(true);
    const result = await signIn(username.trim(), password.trim());
    setLoading(false);
    if (!result.success) {
      Alert.alert(
        'No se pudo conectar',
        result.error || 'Verifica tu usuario y contraseña e intenta de nuevo.'
      );
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        <View style={styles.topGradient} />

        <View style={styles.logoContainer}>
          <View style={styles.logoGlow}>
            <BrandLogo variant="login" centered />
          </View>
          <Text style={styles.tagline}>IPTV simple para tu TV Box</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Ingresar</Text>
          {isTV && (
            <Text style={styles.tvHint}>Presiona OK en cada campo para escribir</Text>
          )}

          {/* Usuario */}
          <Text style={styles.label}>Usuario</Text>
          <View style={styles.inputWrapper}>
            <TextInput
              style={styles.input}
              placeholder="usuario"
              placeholderTextColor="#444"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
              autoFocus={!isTV}
            />
          </View>

          {/* Contraseña con ojo */}
          <Text style={styles.label}>Contraseña</Text>
          <View style={styles.inputWrapper}>
            <TextInput
              style={[styles.input, styles.inputWithIcon]}
              placeholder="contraseña"
              placeholderTextColor="#444"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              returnKeyType="done"
              onSubmitEditing={handleLogin}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={styles.eyeBtn}
              onPress={() => setShowPassword(prev => !prev)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.eyeIcon}>{showPassword ? '🙈' : '👁️'}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading}
            hasTVPreferredFocus={isTV}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>INGRESAR</Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.footer}>FLASHNETV v{versionInfo.version}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topGradient: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 300,
    backgroundColor: colors.backgroundDeep, opacity: 0.6,
    borderBottomLeftRadius: 60, borderBottomRightRadius: 60,
  },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  logoContainer: { alignItems: 'center', marginBottom: 40, marginTop: 20 },
  logoGlow: { ...shadows.glowBlue, marginBottom: 10 },
  tagline: {
    color: colors.textSecondary, fontSize: 12,
    letterSpacing: 0.5, textAlign: 'center',
  },
  card: {
    backgroundColor: colors.card, borderRadius: 20, padding: 24,
    borderWidth: 1, borderColor: '#2a2a3a', ...shadows.glowPurple,
    maxWidth: isTV ? 500 : isTablet ? 440 : '100%',
    width: '100%', alignSelf: 'center',
  },
  cardTitle: {
    color: colors.white, fontSize: 18, fontWeight: 'bold',
    marginBottom: 20, letterSpacing: 0.5,
  },
  label: {
    color: colors.accent, fontSize: 11, fontWeight: '600',
    marginBottom: 6, letterSpacing: 1.5, textTransform: 'uppercase',
  },
  inputWrapper: {
    marginBottom: 16, borderRadius: 12, borderWidth: 1,
    borderColor: '#2a2a3a', backgroundColor: '#0f0f14',
    flexDirection: 'row', alignItems: 'center',
  },
  input: {
    flex: 1, color: colors.white, padding: 14, fontSize: 15,
  },
  inputWithIcon: { paddingRight: 48 },
  eyeBtn: {
    position: 'absolute', right: 12,
    width: 36, height: 36,
    justifyContent: 'center', alignItems: 'center',
  },
  eyeIcon: { fontSize: 18 },
  button: {
    backgroundColor: colors.primary, borderRadius: 12,
    padding: 16, alignItems: 'center', marginTop: 8,
    ...shadows.glowPurple,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: {
    color: colors.white, fontWeight: 'bold',
    fontSize: 15, letterSpacing: 2,
  },
  footer: { color: '#333', textAlign: 'center', marginTop: 32, fontSize: 12 },
  tvHint: {
    color: colors.textSecondary, fontSize: 13,
    textAlign: 'center', marginBottom: 16, fontStyle: 'italic',
  },
});
