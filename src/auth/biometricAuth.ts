import * as LocalAuthentication from 'expo-local-authentication';
import { BiometricStatus } from '../types';

export interface BiometricCheckResult {
  hasHardware: boolean;
  isEnrolled: boolean;
  supportedTypes: string[];
  securityLevel: 'CLASS_3_STRONG' | 'CONVENIENCE' | 'NONE';
}

/**
 * Inspects device biometric hardware and enrollment status on Android.
 * Android differentiates between Class 3 (Strong) biometrics (Fingerprint/Iris/3D Face)
 * and Class 2/1 (Weak/Convenience).
 */
export async function checkBiometricCapabilities(): Promise<BiometricCheckResult> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const isEnrolled = await LocalAuthentication.isEnrolledAsync();
  const types = await LocalAuthentication.supportedAuthenticationTypesAsync();

  const typeStrings: string[] = [];
  let isStrong = false;

  for (const type of types) {
    if (type === LocalAuthentication.AuthenticationType.FINGERPRINT) {
      typeStrings.push('Fingerprint (Class 3 Strong)');
      isStrong = true;
    } else if (type === LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION) {
      typeStrings.push('Facial Recognition');
    } else if (type === LocalAuthentication.AuthenticationType.IRIS) {
      typeStrings.push('Iris (Class 3 Strong)');
      isStrong = true;
    }
  }

  return {
    hasHardware,
    isEnrolled,
    supportedTypes: typeStrings,
    securityLevel: isStrong ? 'CLASS_3_STRONG' : (hasHardware ? 'CONVENIENCE' : 'NONE'),
  };
}

/**
 * Enforces strong biometric authentication or device credentials (PIN/Pattern).
 * Under Android BiometricPrompt, this maps to BIOMETRIC_STRONG | DEVICE_CREDENTIAL.
 */
export async function authenticateBiometric(options?: {
  promptMessage?: string;
  cancelLabel?: string;
  disableDeviceFallback?: boolean;
}): Promise<{ success: boolean; error?: string; status: BiometricStatus }> {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) {
      return { success: false, error: 'Biometric hardware not available on this device', status: 'unsupported' };
    }

    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    if (!isEnrolled) {
      return { success: false, error: 'No biometrics or device PIN enrolled in Android Settings', status: 'not_enrolled' };
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: options?.promptMessage ?? 'Unlock AURA Privacy Vault',
      cancelLabel: options?.cancelLabel ?? 'Cancel',
      fallbackLabel: 'Use Device PIN / Pattern',
      disableDeviceFallback: options?.disableDeviceFallback ?? false,
    });

    if (result.success) {
      return { success: true, status: 'authenticated' };
    } else {
      return { success: false, error: result.error ?? 'Authentication failed or cancelled', status: 'failed' };
    }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Biometric authentication error', status: 'failed' };
  }
}
