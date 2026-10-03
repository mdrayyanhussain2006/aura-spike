import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { checkBiometricCapabilities, authenticateBiometric, BiometricCheckResult } from '../auth/biometricAuth';
import { BiometricStatus } from '../types';

interface BiometricGateViewProps {
  onUnlockSuccess: () => void;
  isUnlocked: boolean;
}

export const BiometricGateView: React.FC<BiometricGateViewProps> = ({ onUnlockSuccess, isUnlocked }) => {
  const [capabilities, setCapabilities] = useState<BiometricCheckResult | null>(null);
  const [status, setStatus] = useState<BiometricStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setStatus('checking');
      const caps = await checkBiometricCapabilities();
      setCapabilities(caps);
      setStatus('idle');
    })();
  }, []);

  const handleAuthenticate = async () => {
    setStatus('checking');
    setErrorMessage(null);

    const result = await authenticateBiometric({
      promptMessage: 'Authenticate to access AURA Privacy Vault',
      disableDeviceFallback: false,
    });

    setStatus(result.status);
    if (result.success) {
      onUnlockSuccess();
    } else {
      setErrorMessage(result.error ?? 'Authentication failed');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Task 2: Strong Biometric Screen Gate</Text>
      
      <View style={styles.card}>
        <Text style={styles.label}>Hardware Status:</Text>
        <Text style={styles.value}>
          {capabilities?.hasHardware ? '✅ Hardware Detected' : '❌ Hardware Missing'}
        </Text>

        <Text style={styles.label}>Enrollment Status:</Text>
        <Text style={styles.value}>
          {capabilities?.isEnrolled ? '✅ Biometrics Enrolled' : '⚠️ None Enrolled'}
        </Text>

        <Text style={styles.label}>Security Level (Android BiometricPrompt):</Text>
        <Text style={[styles.badge, capabilities?.securityLevel === 'CLASS_3_STRONG' ? styles.badgeStrong : styles.badgeNormal]}>
          {capabilities?.securityLevel ?? 'Detecting...'}
        </Text>

        <Text style={styles.label}>Supported Types:</Text>
        <Text style={styles.value}>
          {capabilities?.supportedTypes.join(', ') || 'None'}
        </Text>

        {isUnlocked ? (
          <View style={styles.unlockedBox}>
            <Text style={styles.unlockedText}>🔓 Vault Unlocked via Strong Credentials</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.authButton}
            onPress={handleAuthenticate}
            disabled={status === 'checking'}
          >
            {status === 'checking' ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.buttonText}>Authenticate (Biometric / PIN)</Text>
            )}
          </TouchableOpacity>
        )}

        {errorMessage && (
          <Text style={styles.errorText}>Error: {errorMessage}</Text>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#E4E4E7',
    marginBottom: 8,
  },
  card: {
    backgroundColor: '#18181B',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#27272A',
  },
  label: {
    fontSize: 12,
    color: '#A1A1AA',
    marginTop: 6,
  },
  value: {
    fontSize: 14,
    color: '#F4F4F5',
    fontWeight: '500',
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
  },
  badgeStrong: {
    backgroundColor: '#064E3B',
    color: '#34D399',
  },
  badgeNormal: {
    backgroundColor: '#3F3F46',
    color: '#D4D4D8',
  },
  authButton: {
    backgroundColor: '#2563EB',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 6,
    alignItems: 'center',
    marginTop: 14,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  unlockedBox: {
    backgroundColor: '#064E3B',
    padding: 10,
    borderRadius: 6,
    marginTop: 12,
    alignItems: 'center',
  },
  unlockedText: {
    color: '#A7F3D0',
    fontWeight: '600',
  },
  errorText: {
    color: '#F87171',
    fontSize: 12,
    marginTop: 8,
  },
});
