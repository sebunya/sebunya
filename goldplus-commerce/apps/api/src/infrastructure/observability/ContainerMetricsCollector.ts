import * as client from 'prom-client';
import fs from 'fs';
import { PerformanceObserver, performance } from 'perf_hooks';
import { logger } from '../logging/logger';

// Prometheus metrics configuration
export const containerMemoryLimit = new client.Gauge({
  name: 'goldplus_container_memory_limit_bytes',
  help: 'Cgroup memory limit for the container in bytes',
});

export const containerMemoryUsage = new client.Gauge({
  name: 'goldplus_container_memory_usage_bytes',
  help: 'Cgroup current memory usage in bytes',
});

export const containerOomPreWarning = new client.Gauge({
  name: 'goldplus_container_oom_pre_warning',
  help: 'Indicator if container memory exceeds 90% of limit (1 = Warning, 0 = OK)',
});

export const containerCpuThrottled = new client.Gauge({
  name: 'goldplus_container_cpu_throttled_seconds',
  help: 'Cumulative CPU throttle duration in seconds',
});

export const containerOpenFileDescriptors = new client.Gauge({
  name: 'goldplus_container_open_file_descriptors',
  help: 'Number of open file descriptors in the process',
});

export const containerEventLoopUtilization = new client.Gauge({
  name: 'goldplus_container_event_loop_utilization_ratio',
  help: 'Event loop utilization ratio',
});

export const containerGcDuration = new client.Histogram({
  name: 'goldplus_container_gc_duration_seconds',
  help: 'Garbage collection pause duration in seconds',
  labelNames: ['gctype'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
});

// Safely register metrics
const registerMetricSafe = (m: client.Metric) => {
  try {
    client.register.registerMetric(m);
  } catch (err) {
    // Ignore already registered
  }
};

registerMetricSafe(containerMemoryLimit);
registerMetricSafe(containerMemoryUsage);
registerMetricSafe(containerOomPreWarning);
registerMetricSafe(containerCpuThrottled);
registerMetricSafe(containerOpenFileDescriptors);
registerMetricSafe(containerEventLoopUtilization);
registerMetricSafe(containerGcDuration);

// ── GC Duration Observer ──────────────────────────────────────────────────────
try {
  const gcObserver = new PerformanceObserver((list) => {
    const entries = list.getEntries();
    for (const entry of entries) {
      // entry.kind represents GC type (e.g. 1 = scavenge, 2 = mark-sweep)
      const kind = (entry as any).kind;
      const type = kind === 1 ? 'scavenge' : kind === 2 ? 'mark-sweep' : 'other';
      containerGcDuration.observe({ gctype: type }, entry.duration / 1000);
    }
  });
  gcObserver.observe({ entryTypes: ['gc'] });
} catch (e) {
  logger.warn({ err: e }, '[ContainerMetricsCollector] PerformanceObserver GC profiling not supported in this environment');
}

// ── ELU Tracking State ────────────────────────────────────────────────────────
const hasElu = typeof performance !== 'undefined' && typeof performance.eventLoopUtilization === 'function';
let lastElu = hasElu ? performance.eventLoopUtilization() : null;

export class ContainerMetricsCollector {
  public collect() {
    this.collectMemory();
    this.collectCpu();
    this.collectFileDescriptors();
    this.collectEventLoopUtilization();
  }

  private collectMemory() {
    let limit = 0;
    let usage = 0;

    // Check cgroup v2 paths
    if (fs.existsSync('/sys/fs/cgroup/memory.max')) {
      try {
        const limitStr = fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf-8').trim();
        limit = limitStr === 'max' ? 0 : Number(limitStr);
        usage = Number(fs.readFileSync('/sys/fs/cgroup/memory.current', 'utf-8').trim());
      } catch (e) {
        // Fallback silently
      }
    } 
    // Check cgroup v1 paths
    else if (fs.existsSync('/sys/fs/cgroup/memory/memory.limit_in_bytes')) {
      try {
        limit = Number(fs.readFileSync('/sys/fs/cgroup/memory/memory.limit_in_bytes', 'utf-8').trim());
        usage = Number(fs.readFileSync('/sys/fs/cgroup/memory/memory.usage_in_bytes', 'utf-8').trim());
      } catch (e) {
        // Fallback silently
      }
    }

    // Default V8 memory limit if cgroups missing/unreadable (e.g. macOS developer environment)
    if (!limit || isNaN(limit)) {
      limit = process.memoryUsage().heapTotal;
    }
    if (!usage || isNaN(usage)) {
      usage = process.memoryUsage().heapUsed;
    }

    containerMemoryLimit.set(limit);
    containerMemoryUsage.set(usage);

    // Trigger pre-warning flag if memory consumption exceeds 90%
    const thresholdExceeded = (usage / limit) > 0.9 ? 1 : 0;
    containerOomPreWarning.set(thresholdExceeded);
  }

  private collectCpu() {
    let throttledSec = 0;

    // Cgroup v2 CPU stats
    if (fs.existsSync('/sys/fs/cgroup/cpu.stat')) {
      try {
        const stats = fs.readFileSync('/sys/fs/cgroup/cpu.stat', 'utf-8');
        const throttledUsecMatch = stats.match(/throttled_usec\s+(\d+)/);
        if (throttledUsecMatch) {
          throttledSec = Number(throttledUsecMatch[1]) / 1000000;
        }
      } catch (e) {
        // Ignore
      }
    }
    // Cgroup v1 CPU stats
    else if (fs.existsSync('/sys/fs/cgroup/cpu/cpu.stat')) {
      try {
        const stats = fs.readFileSync('/sys/fs/cgroup/cpu/cpu.stat', 'utf-8');
        const throttledTimeMatch = stats.match(/nr_throttled\s+(\d+)/);
        if (throttledTimeMatch) {
          // cgroup v1 reports throttle occurrences, let's derive metric estimate or set throttle occurrence count
          throttledSec = Number(throttledTimeMatch[1]);
        }
      } catch (e) {
        // Ignore
      }
    }

    containerCpuThrottled.set(throttledSec);
  }

  private collectFileDescriptors() {
    let fdCount = 0;
    if (fs.existsSync('/proc/self/fd')) {
      try {
        const fds = fs.readdirSync('/proc/self/fd');
        fdCount = fds.length;
      } catch (e) {
        // Default to estimated/internal handles
      }
    }
    containerOpenFileDescriptors.set(fdCount);
  }

  private collectEventLoopUtilization() {
    if (!hasElu || !lastElu) {
      containerEventLoopUtilization.set(0);
      return;
    }
    try {
      const currentElu = performance.eventLoopUtilization();
      const diff = performance.eventLoopUtilization(currentElu, lastElu);
      containerEventLoopUtilization.set(diff.utilization);
      lastElu = currentElu;
    } catch (e) {
      containerEventLoopUtilization.set(0);
    }
  }
}

export const containerMetricsCollector = new ContainerMetricsCollector();
