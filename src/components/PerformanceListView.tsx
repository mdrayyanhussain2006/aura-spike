import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, Animated, TouchableOpacity, Platform } from 'react-native';
import { FrameMetrics } from '../types';

interface ListItem {
  id: string;
  title: string;
  badge: string;
  category: string;
}

const AnimatedItem: React.FC<{ item: ListItem; index: number }> = React.memo(({ item, index }) => {
  const animatedValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(animatedValue, {
      toValue: 1,
      duration: 350,
      delay: Math.min(index * 15, 300),
      useNativeDriver: true,
    }).start();
  }, [animatedValue, index]);

  const translateY = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [20, 0],
  });

  const opacity = animatedValue;

  return (
    <Animated.View style={[styles.listItem, { opacity, transform: [{ translateY }] }]}>
      <View style={styles.itemHeader}>
        <Text style={styles.itemTitle}>{item.title}</Text>
        <Text style={styles.itemBadge}>{item.badge}</Text>
      </View>
      <Text style={styles.itemCategory}>{item.category}</Text>
    </Animated.View>
  );
});

export const PerformanceListView: React.FC = () => {
  const [isMonitoring, setIsMonitoring] = useState<boolean>(false);
  const [metrics, setMetrics] = useState<FrameMetrics>({
    totalFrames: 0,
    droppedFrames: 0,
    averageFps: 60,
    minFps: 60,
    maxFrameDurationMs: 16.67,
  });

  const animationFrameId = useRef<number | null>(null);
  const lastTimestamp = useRef<number | null>(null);
  const frameDeltas = useRef<number[]>([]);

  // Generate 1,000 list items
  const items: ListItem[] = useMemo(() => {
    return Array.from({ length: 1000 }, (_, i) => ({
      id: `vault-item-${i + 1}`,
      title: `Encrypted Credential Record #${i + 1}`,
      badge: (i % 3 === 0 ? 'HIGH PII' : (i % 3 === 1 ? 'MED RISK' : 'ENCRYPTED')),
      category: `Folder: Vault Category ${Math.floor(i / 100) + 1}`,
    }));
  }, []);

  const startPerformanceMonitoring = () => {
    setIsMonitoring(true);
    frameDeltas.current = [];
    lastTimestamp.current = null;

    const measureFrame = (timestamp: number) => {
      if (lastTimestamp.current !== null) {
        const delta = timestamp - lastTimestamp.current;
        frameDeltas.current.push(delta);
      }
      lastTimestamp.current = timestamp;

      // Keep measuring for 3 seconds of active scrolling/rendering
      if (frameDeltas.current.length < 180) {
        animationFrameId.current = requestAnimationFrame(measureFrame);
      } else {
        finishMonitoring();
      }
    };

    animationFrameId.current = requestAnimationFrame(measureFrame);
  };

  const finishMonitoring = () => {
    setIsMonitoring(false);
    if (animationFrameId.current) {
      cancelAnimationFrame(animationFrameId.current);
      animationFrameId.current = null;
    }

    const deltas = frameDeltas.current;
    if (deltas.length === 0) return;

    // Normal 60Hz frame target is 16.67ms. Anything > 24ms is a dropped frame / jank.
    const dropped = deltas.filter((d) => d > 24.0).length;
    const avgDuration = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const maxDuration = Math.max(...deltas);
    const avgFps = Math.min(60, Math.round(1000 / avgDuration));
    const minFps = Math.min(60, Math.round(1000 / maxDuration));

    setMetrics({
      totalFrames: deltas.length,
      droppedFrames: dropped,
      averageFps: avgFps,
      minFps: minFps,
      maxFrameDurationMs: parseFloat(maxDuration.toFixed(2)),
    });
  };

  useEffect(() => {
    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Task 5: 1,000 List Items & Frame Profiler</Text>

      <View style={styles.card}>
        <View style={styles.metricsRow}>
          <View style={styles.metricCol}>
            <Text style={styles.metricVal}>{metrics.averageFps} FPS</Text>
            <Text style={styles.metricLabel}>Average FPS</Text>
          </View>
          <View style={styles.metricCol}>
            <Text style={[styles.metricVal, metrics.droppedFrames > 0 ? styles.valWarn : styles.valGood]}>
              {metrics.droppedFrames}
            </Text>
            <Text style={styles.metricLabel}>Dropped Frames</Text>
          </View>
          <View style={styles.metricCol}>
            <Text style={styles.metricVal}>{metrics.maxFrameDurationMs}ms</Text>
            <Text style={styles.metricLabel}>Max Frame Time</Text>
          </View>
        </View>

        <View style={styles.hardwareBanner}>
          <Text style={styles.hardwareText}>
            Device Model: {Platform.OS === 'android' ? 'Android Device' : 'Host Environment (No Physical Device Connected)'}
          </Text>
          <Text style={styles.hardwareSubtext}>
            Physical GPU Vsync dropped frame count on physical phone: UNVERIFIED / BLOCKED (No physical Android phone attached via USB/ADB)
          </Text>
        </View>

        <TouchableOpacity
          style={styles.benchmarkButton}
          onPress={startPerformanceMonitoring}
          disabled={isMonitoring}
        >
          <Text style={styles.buttonText}>
            {isMonitoring ? 'Profiling 180 Frames...' : 'Run 3s Frame-Rate Benchmark'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.listWrapper}>
        <Text style={styles.listHeader}>Rendering 1,000 Virtualized Vault Items:</Text>
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => <AnimatedItem item={item} index={index} />}
          initialNumToRender={15}
          maxToRenderPerBatch={20}
          windowSize={7}
          removeClippedSubviews={true}
          style={styles.flatList}
        />
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
    padding: 14,
    borderWidth: 1,
    borderColor: '#27272A',
    marginBottom: 12,
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 10,
  },
  metricCol: {
    alignItems: 'center',
  },
  metricVal: {
    fontSize: 18,
    fontWeight: '700',
    color: '#60A5FA',
  },
  valGood: {
    color: '#34D399',
  },
  valWarn: {
    color: '#F87171',
  },
  metricLabel: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  hardwareBanner: {
    backgroundColor: '#27272A',
    borderRadius: 6,
    padding: 8,
    marginVertical: 6,
  },
  hardwareText: {
    fontSize: 11,
    color: '#FBBF24',
    fontWeight: '600',
  },
  hardwareSubtext: {
    fontSize: 10,
    color: '#A1A1AA',
    marginTop: 2,
  },
  benchmarkButton: {
    backgroundColor: '#6366F1',
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
    marginTop: 6,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 13,
  },
  listWrapper: {
    height: 260,
    backgroundColor: '#09090B',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#27272A',
    padding: 8,
  },
  listHeader: {
    fontSize: 12,
    color: '#A1A1AA',
    marginBottom: 6,
  },
  flatList: {
    flex: 1,
  },
  listItem: {
    backgroundColor: '#18181B',
    padding: 10,
    borderRadius: 6,
    marginBottom: 6,
    borderLeftWidth: 3,
    borderLeftColor: '#3B82F6',
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemTitle: {
    color: '#F4F4F5',
    fontSize: 12,
    fontWeight: '600',
  },
  itemBadge: {
    fontSize: 9,
    color: '#F59E0B',
    backgroundColor: '#451A03',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    fontWeight: '700',
  },
  itemCategory: {
    color: '#71717A',
    fontSize: 11,
    marginTop: 2,
  },
});
