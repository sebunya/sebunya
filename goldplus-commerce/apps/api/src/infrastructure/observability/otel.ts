import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';

// Set diagnostic logging if debug environment variable is present
if (process.env.OTEL_DEBUG) {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
}

const sdk = new NodeSDK({
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

export default sdk;
