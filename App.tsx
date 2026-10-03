import React, { useState } from 'react';
import { StyleSheet, Text, View, SafeAreaView, ScrollView, StatusBar, TouchableOpacity } from 'react-native';
import { BiometricGateView } from './src/components/BiometricGateView';
import { CryptoDemoView } from './src/components/CryptoDemoView';
import { PerformanceListView } from './src/components/PerformanceListView';
import { ShareRedactionView } from './src/components/ShareRedactionView';

export default function App() {
  const [isUnlocked, setIsUnlocked] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'all' | 'crypto' | 'perf' | 'share'>('all');

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#09090B" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>AURA Mobile Spike</Text>
        <Text style={styles.headerSubtitle}>Android Privacy Vault Feasibility PoC</Text>
      </View>

      <View style={styles.statusBarBanner}>
        <Text style={styles.statusBannerText}>
          Mode: Development Build Spike | Target: Android Keystore / SQLCipher
        </Text>
      </View>

      {/* Navigation Filter Tabs */}
      <View style={styles.tabsRow}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'all' && styles.tabButtonActive]}
          onPress={() => setActiveTab('all')}
        >
          <Text style={[styles.tabText, activeTab === 'all' && styles.tabTextActive]}>All Tasks</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'crypto' && styles.tabButtonActive]}
          onPress={() => setActiveTab('crypto')}
        >
          <Text style={[styles.tabText, activeTab === 'crypto' && styles.tabTextActive]}>Crypto</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'perf' && styles.tabButtonActive]}
          onPress={() => setActiveTab('perf')}
        >
          <Text style={[styles.tabText, activeTab === 'perf' && styles.tabTextActive]}>Perf (1k)</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'share' && styles.tabButtonActive]}
          onPress={() => setActiveTab('share')}
        >
          <Text style={[styles.tabText, activeTab === 'share' && styles.tabTextActive]}>Redact</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Task 2: Biometric Gate */}
        <BiometricGateView
          onUnlockSuccess={() => setIsUnlocked(true)}
          isUnlocked={isUnlocked}
        />

        {/* Task 3 & 4: Cryptography & Database */}
        {(activeTab === 'all' || activeTab === 'crypto') && (
          <CryptoDemoView />
        )}

        {/* Task 5: 1,000 List Items & Performance Instrumentation */}
        {(activeTab === 'all' || activeTab === 'perf') && (
          <PerformanceListView />
        )}

        {/* Task 6: Android Share Target & Redaction Pipeline */}
        {(activeTab === 'all' || activeTab === 'share') && (
          <ShareRedactionView />
        )}

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            AURA Mobile Feasibility Study — Throwaway Spike (SDK 57/58)
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#09090B',
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#A1A1AA',
    marginTop: 2,
  },
  statusBarBanner: {
    backgroundColor: '#1E1B4B',
    paddingHorizontal: 16,
    paddingVertical: 4,
    marginTop: 6,
  },
  statusBannerText: {
    fontSize: 11,
    color: '#A5B4FC',
    fontWeight: '500',
  },
  tabsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#27272A',
  },
  tabButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#18181B',
    marginRight: 8,
  },
  tabButtonActive: {
    backgroundColor: '#2563EB',
  },
  tabText: {
    color: '#A1A1AA',
    fontSize: 12,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#FFFFFF',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  footer: {
    marginTop: 24,
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#27272A',
  },
  footerText: {
    color: '#71717A',
    fontSize: 10,
    fontStyle: 'italic',
  },
});
