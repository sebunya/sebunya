import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';

// Set diagnostic logging if debug environment variable is present
if (process.env.OTEL_DEBUG) {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
}

/**
 * Tracing runs only when somewhere to send it is configured.
 *
 * Started unconditionally, the SDK instrumented every request, query and Redis
 * call on both 1-vCPU replicas and exported to its default, localhost:4318, where
 * nothing listens: every batch failed with ECONNREFUSED and no trace was ever
 * collected. Nothing in the API reads the OpenTelemetry context (TraceContext is
 * its own AsyncLocalStorage), so switching it off loses nothing.
 */
export function otelExportConfigured(env: Record<string, string | undefined> = process.env): boolean {
  const endpoint = (env.OTEL_EXPORTER_OTLP_ENDPOINT ?? env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? '').trim();
  const exporter = (env.OTEL_TRACES_EXPORTER ?? '').trim().toLowerCase();
  if (exporter === 'none') return false;
  return endpoint.length > 0 || (exporter.length > 0 && exporter !== 'otlp');
}

let sdk: NodeSDK | null = null;

if (otelExportConfigured()) {
  // Constructed only here: building the auto-instrumentations installs their hooks.
  sdk = new NodeSDK({
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable noisy FS instrumentation to prevent log and trace saturation
        '@opentelemetry/instrumentation-fs': {
          enabled: false,
        },
      }),
    ],
  });
  try {
    sdk.start();
    console.log('[OTel] OpenTelemetry SDK initialized successfully.');
  } catch (error) {
    console.error('[OTel] Error initializing OpenTelemetry SDK:', error);
  }
} else {
  console.log('[OTel] Tracing off: no OTEL_EXPORTER_OTLP_ENDPOINT or OTEL_TRACES_EXPORTER configured.');
}

export default sdk;
