import * as SQLite from 'expo-sqlite';
import { VaultItem } from '../types';

let dbInstance: SQLite.SQLiteDatabase | null = null;

/**
 * Initializes the SQLite database for AURA Vault.
 *
 * SQLCipher Integration Details:
 * 1. Enabled in app.json via Expo config plugin:
 *    ["expo-sqlite", { "useSQLCipher": true }]
 * 2. Requires `npx expo prebuild` (not supported in Expo Go).
 * 3. Immediately upon opening the database handle, `PRAGMA key` MUST be executed
 *    before any schema query or transaction.
 * 4. Passphrase/Key: Uses the 256-bit key from SecureStore (Task 3).
 */
export async function getVaultDatabase(encryptionKeyHex?: string): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) return dbInstance;

  const db = await SQLite.openDatabaseAsync('aura_vault.db');

  if (encryptionKeyHex) {
    // Apply SQLCipher key PRAGMA
    await db.execAsync(`PRAGMA key = '${encryptionKeyHex}';`);
  }

  // Set WAL mode and prepare tables
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS vault_items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  dbInstance = db;
  return dbInstance;
}

/**
 * Inserts a vault item into the encrypted database.
 */
export async function insertVaultItem(item: VaultItem, keyHex?: string): Promise<void> {
  const db = await getVaultDatabase(keyHex);
  await db.runAsync(
    'INSERT OR REPLACE INTO vault_items (id, title, content, created_at) VALUES (?, ?, ?, ?);',
    [item.id, item.title, item.content, item.createdAt]
  );
}

/**
 * Retrieves all items from the database.
 */
export async function listVaultItems(keyHex?: string): Promise<VaultItem[]> {
  const db = await getVaultDatabase(keyHex);
  const rows = await db.getAllAsync<any>('SELECT id, title, content, created_at FROM vault_items ORDER BY created_at DESC;');
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    content: r.content,
    createdAt: r.created_at,
  }));
}

/**
 * Closes the active database connection.
 */
export async function closeVaultDatabase(): Promise<void> {
  if (dbInstance) {
    await dbInstance.closeAsync();
    dbInstance = null;
  }
}
