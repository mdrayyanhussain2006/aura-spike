import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { useShareIntent } from 'expo-share-intent';
import { quickRedact } from '../redaction/redactionEngine';
import { RedactionResult } from '../types';

const SAMPLE_PAYLOAD = `Hello, please verify my account for user@example.com. You can reach my direct line at +1 (555) 234-5678. Also here is my temporary secret token: api_key="sample_secret_key_992019485720194857".`;

export const ShareRedactionView: React.FC = () => {
  const { hasShareIntent, shareIntent, resetShareIntent, error: shareError } = useShareIntent();
  const [inputText, setInputText] = useState<string>(SAMPLE_PAYLOAD);
  const [result, setResult] = useState<RedactionResult | null>(() => quickRedact(SAMPLE_PAYLOAD));

  // Automatically ingest and scrub incoming text shared from other Android apps
  useEffect(() => {
    if (hasShareIntent && (shareIntent.text || shareIntent.webUrl)) {
      const incomingText = shareIntent.text || shareIntent.webUrl || '';
      setInputText(incomingText);
      setResult(quickRedact(incomingText));
    }
  }, [hasShareIntent, shareIntent]);

  const handleRedact = () => {
    const res = quickRedact(inputText);
    setResult(res);
  };

  const handleLoadSample = (sample: string) => {
    setInputText(sample);
    setResult(quickRedact(sample));
  };

  const handleClearIntent = () => {
    resetShareIntent();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Task 1 & 6: Android Share Target (expo-share-intent)</Text>

      <View style={styles.card}>
        <View style={styles.pluginInfoBox}>
          <Text style={styles.pluginInfoTitle}>Library: expo-share-intent</Text>
          <Text style={styles.pluginInfoText}>
            Intent Hook: <Text style={styles.codeHighlight}>useShareIntent()</Text>
          </Text>
          <Text style={styles.pluginInfoText}>
            Status: {hasShareIntent ? '📥 Live Shared Intent Ingested!' : 'Listening for Android Share Sheet...'}
          </Text>
          {shareError && (
            <Text style={styles.errorText}>Share Intent Error: {shareError}</Text>
          )}
        </View>

        {hasShareIntent && (
          <View style={styles.activeIntentBanner}>
            <Text style={styles.activeIntentText}>
              Shared Payload Type: {shareIntent.type || 'text'}
            </Text>
            <TouchableOpacity style={styles.clearIntentButton} onPress={handleClearIntent}>
              <Text style={styles.clearIntentButtonText}>Dismiss Intent</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.label}>Incoming Shared Raw Text:</Text>
        <TextInput
          style={styles.textArea}
          multiline
          numberOfLines={4}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Paste or share text from another app..."
          placeholderTextColor="#71717A"
        />

        <View style={styles.presetRow}>
          <TouchableOpacity
            style={styles.presetButton}
            onPress={() => handleLoadSample('Contact support at contact@vaultcorp.io or billing@aura.app.')}
          >
            <Text style={styles.presetText}>Email Sample</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.presetButton}
            onPress={() => handleLoadSample('Call me: (800) 555-0199 or +1 (555) 234-5678.')}
          >
            <Text style={styles.presetText}>Phone Sample</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.presetButton}
            onPress={() => handleLoadSample('Server auth: secret="sec_token_991827461029485710".')}
          >
            <Text style={styles.presetText}>Key Sample</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.scrubButton} onPress={handleRedact}>
          <Text style={styles.buttonText}>Run AURA Redaction Gate</Text>
        </TouchableOpacity>

        {result && (
          <View style={styles.resultContainer}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Detected PII:</Text>
              {result.redactionSummary.length > 0 ? (
                result.redactionSummary.map((t, idx) => (
                  <View key={idx} style={styles.tag}>
                    <Text style={styles.tagText}>{t}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.noPiiText}>No PII Detected</Text>
              )}
            </View>

            <Text style={styles.scrubbedLabel}>Sanitized Output (Ready for Safe Encryption):</Text>
            <View style={styles.outputBox}>
              <Text style={styles.outputText}>{result.redacted}</Text>
            </View>
          </View>
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
  pluginInfoBox: {
    backgroundColor: '#27272A',
    borderRadius: 6,
    padding: 10,
    marginBottom: 10,
  },
  pluginInfoTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FBBF24',
    marginBottom: 4,
  },
  pluginInfoText: {
    fontSize: 11,
    color: '#D4D4D8',
    marginTop: 1,
  },
  codeHighlight: {
    fontFamily: 'monospace',
    color: '#38BDF8',
  },
  activeIntentBanner: {
    backgroundColor: '#1E3A8A',
    padding: 8,
    borderRadius: 6,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  activeIntentText: {
    color: '#93C5FD',
    fontSize: 11,
    fontWeight: '600',
  },
  clearIntentButton: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  clearIntentButtonText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '600',
  },
  errorText: {
    color: '#F87171',
    fontSize: 11,
    marginTop: 4,
  },
  label: {
    fontSize: 12,
    color: '#A1A1AA',
    marginBottom: 4,
  },
  textArea: {
    backgroundColor: '#09090B',
    borderRadius: 6,
    padding: 10,
    color: '#FFFFFF',
    fontSize: 12,
    minHeight: 70,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: '#3F3F46',
  },
  presetRow: {
    flexDirection: 'row',
    marginTop: 8,
    justifyContent: 'space-between',
  },
  presetButton: {
    backgroundColor: '#27272A',
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  presetText: {
    color: '#93C5FD',
    fontSize: 11,
  },
  scrubButton: {
    backgroundColor: '#10B981',
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 13,
  },
  resultContainer: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#27272A',
    paddingTop: 10,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 12,
    color: '#A1A1AA',
    marginRight: 6,
  },
  tag: {
    backgroundColor: '#7F1D1D',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 4,
  },
  tagText: {
    color: '#FCA5A5',
    fontSize: 10,
    fontWeight: '700',
  },
  noPiiText: {
    color: '#34D399',
    fontSize: 12,
    fontStyle: 'italic',
  },
  scrubbedLabel: {
    fontSize: 11,
    color: '#A1A1AA',
    marginBottom: 4,
  },
  outputBox: {
    backgroundColor: '#09090B',
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#065F46',
  },
  outputText: {
    color: '#6EE7B7',
    fontSize: 12,
    fontFamily: 'monospace',
  },
});
