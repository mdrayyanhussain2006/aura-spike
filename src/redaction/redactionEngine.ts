import { RedactionResult } from '../types';

/**
 * Port of AURA Desktop PII Redaction Gate (src/main/services/redactionGate.js)
 * 
 * Enhanced to fix stray "(" and "+" boundaries:
 * - EMAIL: Standard RFC-compliant address patterns
 * - PHONE: Comprehensive domestic and international phone formats (+1, parens, spaces, dashes, dots)
 * - KEY: API keys, bearer tokens, secrets, and passwords >= 16 chars
 */
export const AURA_REDACTION_PATTERNS: Record<string, string> = {
  EMAIL: '\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}\\b',
  PHONE: '(?:^|(?<=[^\\w]))(?:\\+?\\d{1,3}[-.\\s]?)?(?:\\(\\d{2,4}\\)|\\d{2,4})[-.\\s]?\\d{3,4}[-.\\s]?\\d{3,5}\\b',
  KEY: '(?:api[_-]?key|key|secret|token|password)["\']?\\s*[:=]\\s*["\']?([a-zA-Z0-9\\-_]{16,})["\']?',
};

/**
 * Scrubs PII from raw text using the ported AURA pipeline patterns.
 * 
 * @param text Raw untrusted text input (e.g., from Android SEND share intent)
 * @returns Object with redacted text, summary list of matched types, and safe boolean
 */
export function quickRedact(text: string | null | undefined): RedactionResult {
  if (text === null || text === undefined) {
    return { redacted: '', redactionSummary: [], safe: true };
  }

  const input = String(text);
  if (!input.trim()) {
    return { redacted: input, redactionSummary: [], safe: true };
  }

  let redacted = input;
  const summary: string[] = [];

  for (const [type, regexStr] of Object.entries(AURA_REDACTION_PATTERNS)) {
    try {
      // Remove any inline (?i) flags if present and use 'gi' flag in RegExp
      const cleanStr = regexStr.replace('(?i)', '');
      const regex = new RegExp(cleanStr, 'gi');

      if (regex.test(redacted)) {
        summary.push(type);
        regex.lastIndex = 0;
        redacted = redacted.replace(regex, `[REDACTED_${type}]`);
      }
    } catch (regexErr: any) {
      console.error(`[RedactionEngine] Regex error for pattern "${type}":`, regexErr?.message);
    }
  }

  return {
    redacted,
    redactionSummary: summary,
    safe: true,
  };
}
