// Evidence classes and the severity / acceptance vocabularies. Every result
// cell carries one EVIDENCE value so a Playwright WebKit run is never reported
// as Safari and CPU throttling is never reported as a real low-end phone.
export const EVIDENCE = Object.freeze({
  ENGINE_CONTROL: 'ENGINE_CONTROL',                         // Playwright Chromium / Firefox / WebKit on the Linux runner
  EMULATED_VIEWPORT: 'EMULATED_VIEWPORT',                   // device descriptor: viewport, DPR, touch, UA — not the device
  EMULATED_CONSTRAINED_DEVICE: 'EMULATED_CONSTRAINED_DEVICE', // CDP CPU throttling + network conditions (Chromium only)
  EMULATED_NETWORK: 'EMULATED_NETWORK',                     // CDP network conditions (Chromium only)
  REAL_DEVICE: 'REAL_DEVICE',                               // a cloud real-device provider result
  REAL_BROWSER: 'REAL_BROWSER',                             // a cloud real desktop browser (e.g. Safari on macOS)
  AWAITING_REAL_DEVICE: 'AWAITING_REAL_DEVICE',
  AWAITING_REAL_WEBVIEW_VALIDATION: 'AWAITING_REAL_WEBVIEW_VALIDATION',
  MANUAL_AT_VALIDATION_REQUIRED: 'MANUAL_AT_VALIDATION_REQUIRED',
  NOT_TESTED: 'NOT_TESTED',
});

export const SEVERITY = Object.freeze({ P0: 'P0', P1: 'P1', P2: 'P2', P3: 'P3' });

export const ACCEPTANCE = Object.freeze({
  PASS_PASS: 'COMPATIBILITY_PASS_PERFORMANCE_PASS',
  PASS_WARN: 'COMPATIBILITY_PASS_PERFORMANCE_WARNING',
  PASS_FAIL: 'COMPATIBILITY_PASS_PERFORMANCE_FAIL',
  FAIL: 'COMPATIBILITY_FAIL',
  PLATFORM_LIMITATION: 'PLATFORM_LIMITATION',
  NOT_REPRODUCIBLE: 'NOT_REPRODUCIBLE',
  AWAITING_REAL_DEVICE: 'AWAITING_REAL_DEVICE',
});

export const PWA_STATUS = Object.freeze({
  SUPPORTED_AND_PASS: 'SUPPORTED_AND_PASS', SUPPORTED_BUT_FAILING: 'SUPPORTED_BUT_FAILING', NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  NOT_SUPPORTED_BY_PLATFORM: 'NOT_SUPPORTED_BY_PLATFORM', AWAITING_REAL_DEVICE: 'AWAITING_REAL_DEVICE', NOT_TESTED: 'NOT_TESTED',
});

export const VISUAL_CLASS = Object.freeze({
  EXPECTED_DYNAMIC: 'EXPECTED_DYNAMIC', MINOR_RENDERING_DIFFERENCE: 'MINOR_RENDERING_DIFFERENCE', TYPOGRAPHY: 'TYPOGRAPHY', LAYOUT_REGRESSION: 'LAYOUT_REGRESSION',
  CLIPPING: 'CLIPPING', OVERLAP: 'OVERLAP', MISSING_CONTENT: 'MISSING_CONTENT', CRITICAL_VISUAL_BREAK: 'CRITICAL_VISUAL_BREAK',
});
