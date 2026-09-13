// Normalized metric schema (schemas/normalized_metrics.schema.json) and helpers.
// One record per (provider, page, device, location, metric). A metric the
// provider does not expose is recorded with value null and unit "unsupported"
// only when the caller says so; it is never inferred.

export const METRICS = {
  ttfb_ms: 'ms', fcp_ms: 'ms', lcp_ms: 'ms', cls: 'score', inp_ms: 'ms', tbt_ms: 'ms', speed_index_ms: 'ms',
  visual_complete_ms: 'ms', dom_nodes: 'count', dom_depth: 'count', js_execution_ms: 'ms', layout_ms: 'ms', render_ms: 'ms',
  main_thread_ms: 'ms', requests: 'count', total_bytes: 'bytes', html_bytes: 'bytes', css_bytes: 'bytes', js_bytes: 'bytes',
  image_bytes: 'bytes', font_bytes: 'bytes', cache_efficiency_pct: 'percent', compression: 'label', tls_version: 'label',
  http_protocol: 'label', availability_pct: 'percent', p50_latency_ms: 'ms', p75_latency_ms: 'ms', p95_latency_ms: 'ms',
  p99_latency_ms: 'ms', error_rate: 'ratio', throughput_rps: 'rps', performance_score: 'score', accessibility_score: 'score',
  best_practices_score: 'score', seo_score: 'score', security_score: 'score', security_grade: 'label', page_generation_ms: 'ms',
  lcp_load_delay_ms: 'ms', lcp_load_time_ms: 'ms', lcp_render_delay_ms: 'ms', lcp_ttfb_ms: 'ms', tls_handshake_ms: 'ms', connect_ms: 'ms',
  synchronous_scripts: 'count', duplicate_css_selectors: 'count', http_status: 'code', long_tasks: 'count', tti_ms: 'ms',
  third_party_bytes: 'bytes', third_party_requests: 'count', journeys_passed: 'count', journeys_failed: 'count', console_errors: 'count', network_failures: 'count',
  a11y_violations_serious: 'count', a11y_violations_total: 'count', p0_defects: 'count', p1_defects: 'count', p2_defects: 'count', visual_regressions: 'count',
};

/**
 * metric({provider, page, device, location, metric, value, source, kind, unit?, run_ref?, note?})
 *  kind: 'synthetic' | 'rum' | 'control' | 'load'
 */
export function metric(fields) {
  const { provider, page = 'home', device = 'n/a', location = 'n/a', metric: name, value, source, kind = 'synthetic', unit, run_ref = null, note = null, sample_size = null } = fields;
  if (!provider || !name) throw new Error('metric(): provider and metric are required');
  const known = METRICS[name];
  if (!known && !unit) throw new Error(`metric(): unknown metric ${name} needs an explicit unit`);
  const v = value === undefined ? null : value;
  return { provider, page, device, location, metric: name, value: v, unit: v === null && unit === 'unsupported' ? 'unsupported' : (unit || known), source: source || provider, kind, run_ref, note, sample_size };
}

export function unsupported(fields) { return metric({ ...fields, value: null, unit: 'unsupported' }); }

/** Median / mean / min / max / percentile over finite numbers; null when empty. */
export function stats(values) {
  const xs = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return { n: 0, min: null, max: null, mean: null, median: null, p95: null };
  const q = (p) => xs[Math.min(xs.length - 1, Math.max(0, Math.ceil(p * xs.length) - 1))];
  return { n: xs.length, min: xs[0], max: xs[xs.length - 1], mean: Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 1000, median: q(0.5), p95: q(0.95) };
}
