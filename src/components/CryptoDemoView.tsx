import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, Switch } from 'react-native';
import * as SQLite from 'expo-sqlite';
import {
  generate256BitKey,
  storeMasterKey,
  getMasterKey,
  encryptString,
  decryptString,
  bytesToHex,
} from '../crypto/vaultCrypto';

export const CryptoDemoView: React.FC = () => {
  const [currentKey, setCurrentKey] = useState<Uint8Array | null>(null);
  const [requireBiometricAuth, setRequireBiometricAuth] = useState<boolean>(true);
  const [plaintextInput, setPlaintextInput] = useState<string>('AURA Confidential Patient Record #88192');
  const [encryptedBundle, setEncryptedBundle] = useState<string | null>(null);
  const [decryptedText, setDecryptedText] = useState<string | null>(null);
  const [tamperError, setTamperError] = useState<string | null>(null);
  const [authPromptLog, setAuthPromptLog] = useState<string | null>(null);
  const [sqlCipherLog, setSqlCipherLog] = useState<{
    marker: string;
    cipherVersion: string | null;
    dbPath: string;
    controlPath: string;
    vaultCommands: string[];
    controlCommands: string[];
  } | null>(null);
  const [statusLog, setStatusLog] = useState<string>('Ready');

  const handleGenerateAndStoreKey = async () => {
    try {
      setStatusLog('Generating 256-bit CSPRNG key...');
      setAuthPromptLog(null);
      const key = generate256BitKey();

      setStatusLog(`Persisting in Keystore (requireAuthentication: ${requireBiometricAuth})...`);
      await storeMasterKey(key, requireBiometricAuth);
      setCurrentKey(key);

      setStatusLog(`Key stored in Keystore. Biometric gated: ${requireBiometricAuth ? 'YES' : 'NO'}`);
    } catch (err: any) {
      setStatusLog(`Store failed: ${err.message}`);
    }
  };

  const handleReadGatedKey = async () => {
    try {
      setAuthPromptLog('Triggering BiometricPrompt via SecureStore.getItemAsync...');
      const retrieved = await getMasterKey(requireBiometricAuth);

      if (retrieved) {
        setCurrentKey(retrieved);
        setAuthPromptLog('Authentication SUCCESS: Biometric passed, key released from Keystore.');
        setStatusLog('Key retrieved and loaded into memory.');
      } else {
        setAuthPromptLog('Authentication CANCELLED / FAILED: SecureStore blocked key release.');
        setStatusLog('Access blocked: No key returned.');
      }
    } catch (err: any) {
      setAuthPromptLog(`Authentication REJECTED: ${err.message}`);
      setStatusLog(`Keystore read blocked: ${err.message}`);
    }
  };

  const handleOpenSqlCipherAndInsertMarker = async () => {
    if (!currentKey) {
      Alert.alert("Key Required", "Please generate or read the Keystore master key first.");
      return;
    }

    try {
      setStatusLog("Opening SQLCipher database with Keystore key...");
      const keyHex = bytesToHex(currentKey);
      const db = await SQLite.openDatabaseAsync("aura_vault.db");

      // Key the database with SQLCipher PRAGMA
      await db.execAsync("PRAGMA key = '" + keyHex + "';");

      // Task 2: Query PRAGMA cipher_version; to verify if SQLCipher engine is compiled and active
      const versionRows = await db.getAllAsync<any>("PRAGMA cipher_version;");
      const rawVersion = versionRows?.[0]?.cipher_version ?? (versionRows?.[0] ? Object.values(versionRows[0])[0] : null);
      const cipherVersionStr = rawVersion ? String(rawVersion) : null;

      await db.execAsync(
        "CREATE TABLE IF NOT EXISTS vault_items (" +
        "  id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL" +
        ");"
      );

      // Insert marker AURA_MARKER_7731 into encrypted db
      await db.runAsync(
        "INSERT OR REPLACE INTO vault_items (id, title, content, created_at) VALUES (?, ?, ?, ?);",
        ["marker_7731", "SQLCipher Verification Marker", "AURA_MARKER_7731", Date.now()]
      );

      // Task 3: Create control_plain.db with NO key and insert the same marker
      setStatusLog("Opening unencrypted control database (control_plain.db)...");
      const plainDb = await SQLite.openDatabaseAsync("control_plain.db");
      await plainDb.execAsync(
        "CREATE TABLE IF NOT EXISTS vault_items (" +
        "  id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL" +
        ");"
      );
      await plainDb.runAsync(
        "INSERT OR REPLACE INTO vault_items (id, title, content, created_at) VALUES (?, ?, ?, ?);",
        ["marker_control_7731", "Plaintext Control Marker", "AURA_MARKER_7731", Date.now()]
      );

      const dbPath = db.databasePath || "/data/user/0/com.aura.privacyspike/databases/aura_vault.db";
      const controlPath = plainDb.databasePath || "/data/user/0/com.aura.privacyspike/databases/control_plain.db";

      // Task 1: adb exec-out run-as commands for aura_vault.db, -wal, -shm and control_plain.db
      setSqlCipherLog({
        marker: "AURA_MARKER_7731",
        cipherVersion: cipherVersionStr,
        dbPath,
        controlPath,
        vaultCommands: [
          'cmd /c "adb exec-out run-as com.aura.privacyspike cat databases/aura_vault.db > aura_vault.db"',
          'cmd /c "adb exec-out run-as com.aura.privacyspike cat databases/aura_vault.db-wal > aura_vault.db-wal"',
          'cmd /c "adb exec-out run-as com.aura.privacyspike cat databases/aura_vault.db-shm > aura_vault.db-shm"',
        ],
        controlCommands: [
          'cmd /c "adb exec-out run-as com.aura.privacyspike cat databases/control_plain.db > control_plain.db"',
        ],
      });

      setStatusLog(cipherVersionStr ? ("SQLCipher active (v" + cipherVersionStr + "). Databases prepared.") : "Warning: SQLCipher NOT active.");
    } catch (err: any) {
      setStatusLog("Database error: " + err.message);
    }
  };

  const handleEncrypt = () => {
    if (!currentKey) {
      Alert.alert('Key Required', 'Please authenticate and read the 256-bit master key first.');
      return;
    }

    try {
      setTamperError(null);
      setDecryptedText(null);
      const res = encryptString(plaintextInput, currentKey);
      setEncryptedBundle(res.combinedHex);
      setStatusLog('Payload encrypted with AES-256-GCM (@noble/ciphers)');
    } catch (err: any) {
      setStatusLog(`Encryption failed: ${err.message}`);
    }
  };

  const handleDecrypt = () => {
    if (!currentKey || !encryptedBundle) return;

    try {
      const decrypted = decryptString(encryptedBundle, currentKey);
      setDecryptedText(decrypted);
      setStatusLog('Decryption & AEAD tag verification succeeded');
    } catch (err: any) {
      setStatusLog(`Decryption error: ${err.message}`);
    }
  };

  const handleSimulateTampering = () => {
    if (!currentKey || !encryptedBundle) return;

    try {
      // Flip a character in the ciphertext to simulate bit tampering
      const parts = encryptedBundle.split(':');
      const tamperedCipher = parts[1].substring(0, 4) + 'ff' + parts[1].substring(6);
      const tamperedBundle = `${parts[0]}:${tamperedCipher}`;

      // Attempt decryption on tampered payload
      decryptString(tamperedBundle, currentKey);
      setTamperError('FAILED: Tampered data was accepted (Security Failure!)');
    } catch (err: any) {
      setTamperError(`SUCCESS: Tampered payload rejected by AEAD tag: "${err.message}"`);
      setStatusLog('Tamper test verified: Tag validation prevented attack');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Task 3 & 4: 256-Bit Keystore & SQLCipher</Text>

      <View style={styles.card}>
        <View style={styles.authToggleRow}>
          <Text style={styles.toggleLabel}>requireAuthentication (Android Keystore):</Text>
          <Switch
            value={requireBiometricAuth}
            onValueChange={setRequireBiometricAuth}
            trackColor={{ false: '#3F3F46', true: '#2563EB' }}
            thumbColor={requireBiometricAuth ? '#60A5FA' : '#71717A'}
          />
        </View>

        <TouchableOpacity style={styles.actionButton} onPress={handleGenerateAndStoreKey}>
          <Text style={styles.buttonText}>1. Generate & Save Key (requireAuth: {requireBiometricAuth ? 'TRUE' : 'FALSE'})</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.readGatedButton} onPress={handleReadGatedKey}>
          <Text style={styles.buttonText}>🔑 Read Key via Biometric Prompt</Text>
        </TouchableOpacity>

        {authPromptLog && (
          <View style={styles.promptLogBox}>
            <Text style={styles.promptLogText}>{authPromptLog}</Text>
          </View>
        )}

        {/* Task 2 In-App Button: SQLCipher DB marker insertion */}
        <TouchableOpacity
          style={[styles.sqlCipherButton, !currentKey && styles.buttonDisabled]}
          onPress={handleOpenSqlCipherAndInsertMarker}
          disabled={!currentKey}
        >
          <Text style={styles.buttonText}>🗄️ Open SQLCipher DB & Insert "AURA_MARKER_7731"</Text>
        </TouchableOpacity>

        {sqlCipherLog && (
          <View style={styles.sqlCipherBox}>
            <Text style={styles.sqlCipherHeader}>Marker: {sqlCipherLog.marker}</Text>

            {/* Task 2: cipher_version check */}
            <View style={styles.versionRow}>
              <Text style={styles.sqlCipherLabel}>SQLCipher Engine: </Text>
              {sqlCipherLog.cipherVersion ? (
                <Text style={styles.cipherVersionActive}>SQLCipher v{sqlCipherLog.cipherVersion}</Text>
              ) : (
                <Text style={styles.cipherVersionInactive}>SQLCipher NOT active</Text>
              )}
            </View>

            {/* Task 1: Encrypted DB path and pull commands */}
            <Text style={styles.sqlCipherLabel}>Encrypted DB Path (aura_vault.db):</Text>
            <Text style={styles.sqlCipherPath}>{sqlCipherLog.dbPath}</Text>

            <Text style={[styles.sqlCipherLabel, { marginTop: 6 }]}>Encrypted DB Pull Commands (aura_vault.db, -wal, -shm):</Text>
            {sqlCipherLog.vaultCommands.map((cmd, idx) => (
              <Text key={idx} style={styles.sqlCipherCommand}>{cmd}</Text>
            ))}

            {/* Task 3: Control Plaintext DB path and pull command */}
            <Text style={[styles.sqlCipherLabel, { marginTop: 6 }]}>Unencrypted Control Path (control_plain.db):</Text>
            <Text style={styles.sqlCipherPath}>{sqlCipherLog.controlPath}</Text>

            <Text style={[styles.sqlCipherLabel, { marginTop: 6 }]}>Unencrypted Control Pull Command (control_plain.db):</Text>
            {sqlCipherLog.controlCommands.map((cmd, idx) => (
              <Text key={idx} style={styles.sqlCipherCommandControl}>{cmd}</Text>
            ))}

            <Text style={styles.sqlCipherSubtext}>
              Verification check: On PC, run strings on pulled files:
              strings control_plain.db | grep AURA_MARKER_7731 (Found)
              strings aura_vault.db | grep AURA_MARKER_7731 (Zero matches)
            </Text>
          </View>
        )}

        {currentKey && (
          <View style={styles.keyBox}>
            <Text style={styles.keyLabel}>Active Master Key in Memory (Hex Preview):</Text>
            <Text style={styles.keyText}>
              {bytesToHex(currentKey).substring(0, 16)}...{bytesToHex(currentKey).substring(48)}
            </Text>
          </View>
        )}

        <Text style={styles.label}>Plaintext Input:</Text>
        <TextInput
          style={styles.input}
          value={plaintextInput}
          onChangeText={setPlaintextInput}
          placeholder="Enter text to encrypt"
          placeholderTextColor="#71717A"
        />

        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.smallButton, !currentKey && styles.buttonDisabled]}
            onPress={handleEncrypt}
            disabled={!currentKey}
          >
            <Text style={styles.buttonText}>2. Encrypt</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.smallButton, !encryptedBundle && styles.buttonDisabled]}
            onPress={handleDecrypt}
            disabled={!encryptedBundle}
          >
            <Text style={styles.buttonText}>3. Decrypt</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tamperButton, !encryptedBundle && styles.buttonDisabled]}
            onPress={handleSimulateTampering}
            disabled={!encryptedBundle}
          >
            <Text style={styles.buttonText}>Test Tamper</Text>
          </TouchableOpacity>
        </View>

        {encryptedBundle && (
          <View style={styles.resultBox}>
            <Text style={styles.resultLabel}>Ciphertext Bundle (IV:Ciphertext+Tag):</Text>
            <Text style={styles.resultText} numberOfLines={2}>
              {encryptedBundle}
            </Text>
          </View>
        )}

        {decryptedText && (
          <View style={styles.successBox}>
            <Text style={styles.successText}>Decrypted: {decryptedText}</Text>
          </View>
        )}

        {tamperError && (
          <View style={styles.tamperBox}>
            <Text style={styles.tamperText}>{tamperError}</Text>
          </View>
        )}

        <Text style={styles.statusFooter}>Log: {statusLog}</Text>
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
  authToggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    backgroundColor: '#27272A',
    padding: 8,
    borderRadius: 6,
  },
  toggleLabel: {
    fontSize: 12,
    color: '#E4E4E7',
    fontWeight: '600',
  },
  actionButton: {
    backgroundColor: '#3B82F6',
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
    marginTop: 4,
  },
  readGatedButton: {
    backgroundColor: '#8B5CF6',
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
    marginTop: 8,
  },
  sqlCipherButton: {
    backgroundColor: '#D97706',
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
    marginTop: 8,
  },
  sqlCipherBox: {
    backgroundColor: '#451A03',
    padding: 10,
    borderRadius: 6,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#B45309',
  },
  sqlCipherHeader: {
    color: '#FCD34D',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  sqlCipherLabel: {
    color: '#FDE68A',
    fontSize: 10,
    marginTop: 4,
  },
  sqlCipherPath: {
    color: '#FFFFFF',
    fontFamily: 'monospace',
    fontSize: 11,
    backgroundColor: '#1C1917',
    padding: 4,
    borderRadius: 4,
    marginTop: 2,
  },
  versionRow: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 4,
  },
  cipherVersionActive: {
    color: "#34D399",
    fontWeight: "700",
    fontSize: 11,
  },
  cipherVersionInactive: {
    color: "#EF4444",
    fontWeight: "700",
    fontSize: 11,
  },
  sqlCipherCommandControl: {
    color: "#FBBF24",
    fontFamily: "monospace",
    fontSize: 10,
    backgroundColor: "#1C1917",
    padding: 4,
    borderRadius: 4,
    marginTop: 2,
  },
  sqlCipherCommand: {
    color: '#67E8F9',
    fontFamily: 'monospace',
    fontSize: 10,
    backgroundColor: '#1C1917',
    padding: 4,
    borderRadius: 4,
    marginTop: 2,
  },
  sqlCipherSubtext: {
    color: '#D6D3D1',
    fontSize: 10,
    fontStyle: 'italic',
    marginTop: 4,
  },
  promptLogBox: {
    backgroundColor: '#2E1065',
    padding: 8,
    borderRadius: 4,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#6D28D9',
  },
  promptLogText: {
    color: '#DDD6FE',
    fontSize: 11,
  },
  label: {
    fontSize: 12,
    color: '#A1A1AA',
    marginTop: 8,
  },
  smallButton: {
    flex: 1,
    backgroundColor: '#10B981',
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
    marginHorizontal: 2,
  },
  tamperButton: {
    flex: 1,
    backgroundColor: '#DC2626',
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
    marginHorizontal: 2,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 12,
  },
  keyBox: {
    backgroundColor: '#09090B',
    padding: 8,
    borderRadius: 4,
    marginTop: 8,
  },
  keyLabel: {
    fontSize: 10,
    color: '#71717A',
  },
  keyText: {
    color: '#FBBF24',
    fontFamily: 'monospace',
    fontSize: 11,
  },
  input: {
    backgroundColor: '#27272A',
    borderRadius: 6,
    padding: 8,
    color: '#FFFFFF',
    marginTop: 4,
    fontSize: 13,
  },
  row: {
    flexDirection: 'row',
    marginTop: 10,
  },
  resultBox: {
    backgroundColor: '#09090B',
    padding: 8,
    borderRadius: 4,
    marginTop: 8,
  },
  resultLabel: {
    fontSize: 10,
    color: '#71717A',
  },
  resultText: {
    color: '#A5B4FC',
    fontFamily: 'monospace',
    fontSize: 11,
  },
  successBox: {
    backgroundColor: '#064E3B',
    padding: 8,
    borderRadius: 4,
    marginTop: 8,
  },
  successText: {
    color: '#6EE7B7',
    fontSize: 12,
    fontWeight: '500',
  },
  tamperBox: {
    backgroundColor: '#450A0A',
    padding: 8,
    borderRadius: 4,
    marginTop: 8,
  },
  tamperText: {
    color: '#FCA5A5',
    fontSize: 11,
  },
  statusFooter: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 10,
    fontStyle: 'italic',
  },
});
