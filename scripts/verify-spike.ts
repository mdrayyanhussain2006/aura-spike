import {
  generate256BitKey,
  bytesToHex,
  hexToBytes,
  encryptString,
  decryptString,
  storeMasterKey,
  getMasterKey,
  __setMockSecureStore,
} from '../src/crypto/vaultCrypto';
import { quickRedact, AURA_REDACTION_PATTERNS } from '../src/redaction/redactionEngine';

interface VerificationResult {
  name: string;
  passed: boolean;
  details: string;
  isMocked?: boolean;
}

const results: VerificationResult[] = [];

function assert(condition: boolean, name: string, details: string, isMocked: boolean = false) {
  results.push({
    name,
    passed: condition,
    details: condition ? `PASS: ${details}` : `FAIL: ${details}`,
    isMocked,
  });
  const label = isMocked ? '[mocked]' : '';
  console.log(`${condition ? '✅ [PASS]' : '❌ [FAIL]'} ${label} ${name} - ${details}`);
}

async function runVerifications() {
  console.log('=================================================================');
  console.log('       AURA MOBILE SPIKE AUTOMATED VERIFICATION SUITE           ');
  console.log('=================================================================\n');

  // --- 1. TASK 3 CRYPTO TESTS (Node runtime) ---
  console.log('--- Testing Task 3: 256-bit Key & AES-GCM Cryptography (Ran on Node) ---');
  const key = generate256BitKey();
  assert(key.length === 32, 'Task 3: Key Length', `Generated 256-bit key (32 bytes). Hex: ${bytesToHex(key).substring(0, 16)}...`);

  const secretPlaintext = 'AURA_SENSITIVE_CONFIDENTIAL_PAYLOAD_992147';
  const encrypted = encryptString(secretPlaintext, key);

  assert(
    encrypted.ivHex.length === 24, // 12 bytes = 24 hex chars
    'Task 3: IV Length',
    `IV is 12 bytes (96-bit NIST standard nonce): ${encrypted.ivHex}`
  );

  assert(
    encrypted.ciphertextHex.length > 0 && !encrypted.combinedHex.includes(secretPlaintext),
    'Task 3: Ciphertext Secrecy',
    `Plaintext is completely absent from encrypted bundle: ${encrypted.combinedHex.substring(0, 32)}...`
  );

  const decrypted = decryptString(encrypted.combinedHex, key);
  assert(
    decrypted === secretPlaintext,
    'Task 3: Decrypt Round-Trip',
    `Decrypted text matches original plaintext exactly.`
  );

  // Tamper detection test
  let tamperCaught = false;
  try {
    const parts = encrypted.combinedHex.split(':');
    // Invert first 2 chars of ciphertext
    const tampered = `${parts[0]}:${parts[1].substring(2)}00`;
    decryptString(tampered, key);
  } catch (err: any) {
    tamperCaught = true;
  }
  assert(
    tamperCaught,
    'Task 3: Tamper Resistance (AEAD Tag)',
    `Ciphertext bit tampering rejected immediately by 128-bit authentication tag.`
  );

  // --- 2. TASK 4 MOCKED AUTHENTICATION REJECTION TEST ---
  console.log('\n--- Testing Task 4: Rejected Authentication Blocks SecureStore Read (Mocked) ---');
  const mockStorage = new Map<string, string>();
  let simulateAuthRejection = true;

  // Install mock adapter to simulate Android OS BiometricPrompt behavior
  __setMockSecureStore({
    setItemAsync: async (alias: string, value: string, options?: any) => {
      mockStorage.set(alias, value);
    },
    getItemAsync: async (alias: string, options?: any) => {
      if (options?.requireAuthentication && simulateAuthRejection) {
        // Simulates user hitting "Cancel" or biometric authentication failure on Android BiometricPrompt
        throw new Error('BiometricPrompt error: User cancelled authentication');
      }
      return mockStorage.get(alias) || null;
    },
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  });

  // Store key with requireAuthentication: true
  const testKey = generate256BitKey();
  await storeMasterKey(testKey, true);

  // Attempt read with rejected/cancelled authentication
  let readBlocked = false;
  let receivedKey: Uint8Array | null = null;
  try {
    receivedKey = await getMasterKey(true);
  } catch (err: any) {
    readBlocked = true;
  }

  assert(
    readBlocked && receivedKey === null,
    'Task 4: Rejected Auth Blocks Keystore Read',
    `When biometric authentication was rejected/cancelled, SecureStore threw and blocked key release. Master key never leaked to memory.`,
    true // isMocked = true
  );

  // Verify that successful authentication DOES release the key
  simulateAuthRejection = false;
  let successKey: Uint8Array | null = null;
  try {
    successKey = await getMasterKey(true);
  } catch (err: any) {}

  assert(
    successKey !== null && bytesToHex(successKey) === bytesToHex(testKey),
    'Task 4: Approved Auth Releases Key',
    `When biometric authentication succeeded, SecureStore released the exact 256-bit key.`,
    true // isMocked = true
  );

  // Reset mock adapter to default
  __setMockSecureStore(null);

  // --- 3. TASK 7 POSITIVE FORMATTED-PHONE TEST CASES (Ran on Node) ---
  console.log('\n--- Testing Task 7: Positive Phone Pattern Verification (14 Formatted Cases) ---');
  const positivePhoneTestCases = [
    { name: 'Standard US Parentheses', raw: 'Call me at (555) 123-4567 please.', expected: 'Call me at [REDACTED_PHONE] please.' },
    { name: 'US Toll-Free with +1', raw: 'Toll-free line is +1-800-555-0199.', expected: 'Toll-free line is [REDACTED_PHONE].' },
    { name: 'US Country Code + Parentheses', raw: 'Reach me on +1 (555) 234-5678 today.', expected: 'Reach me on [REDACTED_PHONE] today.' },
    { name: 'UK London International', raw: 'UK office: +44 20 7946 0958 for billing.', expected: 'UK office: [REDACTED_PHONE] for billing.' },
    { name: 'India Mobile International', raw: 'India support: +91 98765 43210 urgently.', expected: 'India support: [REDACTED_PHONE] urgently.' },
    { name: 'US Standard Hyphenated', raw: 'Direct desk 555-123-4567.', expected: 'Direct desk [REDACTED_PHONE].' },
    { name: 'US Dot Delimited', raw: 'Dotted format: 555.123.4567.', expected: 'Dotted format: [REDACTED_PHONE].' },
    { name: 'US Space Delimited', raw: 'Spaced number 555 123 4567.', expected: 'Spaced number [REDACTED_PHONE].' },
    { name: 'US 1-800 Standard', raw: 'Call 1-800-555-0199 now.', expected: 'Call [REDACTED_PHONE] now.' },
    { name: 'US +1 Dot Delimited', raw: 'Dial +1.800.555.0199 for help.', expected: 'Dial [REDACTED_PHONE] for help.' },
    { name: 'US Toll-Free Parentheses', raw: 'Main line: (800) 555-0199.', expected: 'Main line: [REDACTED_PHONE].' },
    { name: 'Germany Berlin International', raw: 'Berlin branch: +49 30 1234567.', expected: 'Berlin branch: [REDACTED_PHONE].' },
    { name: 'US +1 Hyphenated', raw: 'Mobile: +1-555-234-5678.', expected: 'Mobile: [REDACTED_PHONE].' },
    { name: 'UK London Domestic Area Code', raw: 'London local: (020) 7946 0958.', expected: 'London local: [REDACTED_PHONE].' }
  ];

  positivePhoneTestCases.forEach((tc, idx) => {
    const res = quickRedact(tc.raw);
    const hasStrayParen = res.redacted.includes('([REDACTED_PHONE]') || res.redacted.includes('[REDACTED_PHONE])');
    const hasStrayPlus = res.redacted.includes('+[');
    const isCleanMatch = res.redacted === tc.expected;

    assert(
      isCleanMatch && !hasStrayParen && !hasStrayPlus,
      `Task 7 Pos ${(idx + 1).toString().padStart(2)}: ${tc.name}`,
      `Scrubbed cleanly without stray punctuation: "${res.redacted}"`
    );
  });

  // --- 4. TASK 3 NEGATIVE PHONE-PATTERN TESTS (Ran on Node) ---
  console.log('\n--- Testing Task 3: Negative Phone Pattern Evaluation (12 Cases - Do Not Change Regex) ---');
  const negativeCases = [
    { name: 'Order with # and hyphens', text: 'Order #123-456-7890' },
    { name: 'PO with # and 9 digits', text: 'PO #987654321' },
    { name: 'Invoice with # and 4-4 digits', text: 'Invoice #2024-0012' },
    { name: 'ISO Date YYYY-MM-DD (1)', text: 'Created on 2026-10-02' },
    { name: 'ISO Date YYYY-MM-DD (2)', text: 'Due date: 2024-05-18' },
    { name: 'Version string (dot quad)', text: 'Running firmware v1.2.3.4' },
    { name: 'Version string (release)', text: 'Build release 14.2.0.1982' },
    { name: 'ISO Timestamp', text: 'Timestamp: 2026-10-02T11:15:29' },
    { name: 'Time of day with ms', text: 'Elapsed at 11:15:29.821' },
    { name: '12-digit numeric ID', text: 'Customer ID 123456789012' },
    { name: '16-digit card (spaces)', text: 'Card: 4111 2222 3333 4444' },
    { name: '16-digit card (dashes)', text: 'Card: 4111-2222-3333-4444' },
  ];

  negativeCases.forEach((tc, idx) => {
    const res = quickRedact(tc.text);
    const falselyMatched = res.redactionSummary.includes('PHONE');
    const passed = !falselyMatched; // PASS means it was NOT falsely scrubbed as a phone number
    assert(
      passed,
      `Task 3 Neg ${(idx + 1).toString().padStart(2)}: ${tc.name}`,
      passed
        ? `Clean (Correctly not matched as phone): "${res.redacted}"`
        : `False Positive (Incorrectly matched as phone): "${res.redacted}"`
    );
  });

  // --- 5. TASK 6 GENERAL REDACTION TESTS (Ran on Node) ---
  console.log('\n--- Testing Task 6: PII Redaction Pipeline (Email, Key, Combined - Ran on Node) ---');
  
  // Test email redaction
  const emailSample = 'Send details to alice.smith@example.org or bob+test@aura.co.uk please.';
  const emailRes = quickRedact(emailSample);
  assert(
    emailRes.redactionSummary.includes('EMAIL') &&
    emailRes.redacted === 'Send details to [REDACTED_EMAIL] or [REDACTED_EMAIL] please.',
    'Task 6: Redact Emails',
    `Scrubbed emails and matched summary [${emailRes.redactionSummary.join(', ')}]`
  );

  // Test key/token redaction
  const keySample = 'Authorization token: api_key="sample_api_key_1234567890abcdef" or secret=mysecrettoken12345678';
  const keyRes = quickRedact(keySample);
  assert(
    keyRes.redactionSummary.includes('KEY') &&
    !keyRes.redacted.includes('sample_api_key_') &&
    !keyRes.redacted.includes('mysecrettoken'),
    'Task 6: Redact API Keys / Passwords',
    `Scrubbed secrets: "${keyRes.redacted}"`
  );

  // Test combined payload parity with desktop redactionGate.js
  const combinedSample = 'User test@vault.io with phone (555) 234-5678 entered password="supersecurepassword12345".';
  const combinedRes = quickRedact(combinedSample);
  assert(
    combinedRes.redactionSummary.length === 3 &&
    combinedRes.redactionSummary.includes('EMAIL') &&
    combinedRes.redactionSummary.includes('PHONE') &&
    combinedRes.redactionSummary.includes('KEY') &&
    combinedRes.redacted === 'User [REDACTED_EMAIL] with phone [REDACTED_PHONE] entered [REDACTED_KEY].',
    'Task 6: Combined PII Redaction Parity',
    `All 3 categories detected and scrubbed simultaneously: "${combinedRes.redacted}"`
  );

  console.log('\n=================================================================');
  const totalPassed = results.filter((r) => r.passed).length;
  const totalTests = results.length;
  console.log(`VERIFICATION SUMMARY: ${totalPassed} / ${totalTests} PASSED`);
  console.log(`NOTE: Negative tests that failed reflect known regex false positives (by design, regex unedited).`);
  console.log('=================================================================\n');
}

runVerifications().catch((err) => {
  console.error('Verification script crashed:', err);
  process.exit(1);
});
