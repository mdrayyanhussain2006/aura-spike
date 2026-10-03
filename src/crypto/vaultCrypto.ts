import { gcm } from '@noble/ciphers/aes.js';

const VAULT_KEY_ALIAS = 'aura_vault_master_key_v1';

// In-memory fallback cache for Node test environments where Android Keystore is absent
const nodeKeystoreFallback = new Map<string, string>();

let SecureStoreModule: any = null;
let ExpoCryptoModule: any = null;

try {
  SecureStoreModule = require('expo-secure-store');
} catch (_) {}

try {
  ExpoCryptoModule = require('expo-crypto');
} catch (_) {}

/**
 * Test helper: injects a custom or mocked SecureStore module (e.g. to test authentication rejection).
 */
export function __setMockSecureStore(mock: any) {
  SecureStoreModule = mock;
}

/**
 * Helper to convert Uint8Array to Hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Helper to convert Hex string to Uint8Array
 */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string length');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Generates a cryptographically secure 256-bit (32 bytes) random key.
 */
export function generate256BitKey(): Uint8Array {
  // Use WebCrypto if available (Node.js 19+ and modern browsers/React Native)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const key = new Uint8Array(32);
    crypto.getRandomValues(key);
    return key;
  }
  if (ExpoCryptoModule && ExpoCryptoModule.getRandomBytes) {
    const randomBytes = ExpoCryptoModule.getRandomBytes(32);
    return new Uint8Array(randomBytes);
  }
  throw new Error('No cryptographically secure random number generator available in runtime');
}

/**
 * Stores the 256-bit key in Android Keystore / iOS Keychain via expo-secure-store.
 * Optional requireAuthentication gates access behind biometric / device credentials.
 */
export async function storeMasterKey(
  keyBytes: Uint8Array,
  requireAuthentication: boolean = false
): Promise<void> {
  const hex = bytesToHex(keyBytes);
  if (SecureStoreModule && SecureStoreModule.setItemAsync) {
    await SecureStoreModule.setItemAsync(VAULT_KEY_ALIAS, hex, {
      requireAuthentication,
      keychainAccessible: SecureStoreModule.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } else {
    // Fallback in Node test runtime
    nodeKeystoreFallback.set(VAULT_KEY_ALIAS, hex);
  }
}

/**
 * Retrieves the 256-bit key from SecureStore.
 * Throws if authentication is rejected or cancelled by user, blocking access to the key.
 */
export async function getMasterKey(
  requireAuthentication: boolean = false
): Promise<Uint8Array | null> {
  if (SecureStoreModule && SecureStoreModule.getItemAsync) {
    const hex = await SecureStoreModule.getItemAsync(VAULT_KEY_ALIAS, {
      requireAuthentication,
    });
    if (!hex) return null;
    return hexToBytes(hex);
  } else {
    // Fallback in Node test runtime
    const hex = nodeKeystoreFallback.get(VAULT_KEY_ALIAS);
    if (!hex) return null;
    return hexToBytes(hex);
  }
}

/**
 * Encrypts a string using AES-256-GCM via @noble/ciphers.
 * 
 * Architecture & Library Justification:
 * 1. Library: @noble/ciphers (AES-256-GCM by Paul Miller).
 * 2. Vetted & Audited: Independently audited by Cure53, widely adopted in the
 *    Ethereum / Web3 security ecosystem.
 * 3. AEAD Security: Authenticated Encryption with Associated Data (NIST SP 800-38D).
 *    Provides both confidentiality and ciphertext integrity.
 * 4. Tamper Resistance: Automatically generates a 128-bit authentication tag.
 *    Any corruption or tampering causes decryption to fail.
 * 5. Deterministic Nonce: Generates a unique 12-byte (96-bit) cryptographically
 *    random IV/nonce for each encryption operation to prevent nonce-reuse attacks.
 */
export function encryptString(plaintext: string, keyBytes: Uint8Array): {
  ivHex: string;
  ciphertextHex: string;
  combinedHex: string;
} {
  if (keyBytes.length !== 32) {
    throw new Error(`Invalid key length: expected 32 bytes (256-bit), got ${keyBytes.length}`);
  }

  // 12-byte nonce for AES-GCM
  const nonce = new Uint8Array(12);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(nonce);
  } else if (ExpoCryptoModule && ExpoCryptoModule.getRandomBytes) {
    nonce.set(ExpoCryptoModule.getRandomBytes(12));
  } else {
    throw new Error('No secure random generator available for nonce generation');
  }

  const aesGcm = gcm(keyBytes, nonce);
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const ciphertextWithTag = aesGcm.encrypt(plaintextBytes);

  const ivHex = bytesToHex(nonce);
  const ciphertextHex = bytesToHex(ciphertextWithTag);
  const combinedHex = `${ivHex}:${ciphertextHex}`;

  return {
    ivHex,
    ciphertextHex,
    combinedHex,
  };
}

/**
 * Decrypts an AES-256-GCM encrypted payload.
 * Throws an error if ciphertext or tag has been tampered with.
 */
export function decryptString(combinedHex: string, keyBytes: Uint8Array): string {
  if (keyBytes.length !== 32) {
    throw new Error(`Invalid key length: expected 32 bytes (256-bit), got ${keyBytes.length}`);
  }

  const parts = combinedHex.split(':');
  if (parts.length !== 2) {
    throw new Error('Invalid ciphertext format. Expected "ivHex:ciphertextWithTagHex"');
  }

  const nonce = hexToBytes(parts[0]);
  const ciphertextWithTag = hexToBytes(parts[1]);

  if (nonce.length !== 12) {
    throw new Error(`Invalid nonce length: expected 12 bytes, got ${nonce.length}`);
  }

  const aesGcm = gcm(keyBytes, nonce);
  const decryptedBytes = aesGcm.decrypt(ciphertextWithTag);
  return new TextDecoder().decode(decryptedBytes);
}
