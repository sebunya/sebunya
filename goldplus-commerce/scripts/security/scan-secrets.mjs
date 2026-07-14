import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { basename, extname } from 'node:path';

const MAX_FILE_BYTES = 1_000_000;
const SOURCE_EXTENSIONS = new Set([
  '.astro', '.cjs', '.css', '.html', '.js', '.json', '.jsx', '.mjs', '.sh',
  '.toml', '.ts', '.tsx', '.yaml', '.yml',
]);
const ROOT_CONFIGS = new Set([
  'Dockerfile', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
  'tsconfig.json', 'vitest.config.ts',
]);
const SKIP_PATH = /(^|\/)(?:\.git|node_modules|dist|coverage|backups?|archives?|logs?|tmp|temp)(\/|$)/i;
const SECRET_LIKE_FILE = /(^|\/)(?:\.env(?:\.|$)|[^/]*\.(?:key|pem|p12|pfx|dump|sql|sqlite|tar|tgz|zip|gz)$)/i;
const SAFE_MARKER = 'secret-scan: allow';

const rules = [
  { id: 'private-key', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
  { id: 'aws-access-key', pattern: /\bAKIA[A-Z0-9]{16}\b/ },
  { id: 'github-token', pattern: /\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{36,}\b/ },
  { id: 'slack-token', pattern: /\bxox(?:b|p|a|r|s)-[A-Za-z0-9-]{20,}\b/ },
  { id: 'stripe-live-secret', pattern: /\bsk_live_[A-Za-z0-9]{20,}\b/ },
  { id: 'google-api-key', pattern: /\bAIza[A-Za-z0-9_-]{35}\b/ },
  {
    id: 'assigned-secret',
    pattern: /\b(?:client[_-]?secret|api[_-]?key|access[_-]?token|private[_-]?key|password)\b\s*[:=]\s*["'`][^"'`\s]{20,}["'`]/i,
  },
];

function shouldScan(file) {
  if (SKIP_PATH.test(file) || SECRET_LIKE_FILE.test(file)) return false;
  if (!file.startsWith('apps/') && !file.startsWith('packages/') && !file.startsWith('scripts/') && !file.startsWith('tests/')) {
    return ROOT_CONFIGS.has(file);
  }
  return SOURCE_EXTENSIONS.has(extname(file)) || basename(file) === 'Dockerfile';
}

const tracked = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .filter(shouldScan);

const findings = [];
for (const file of tracked) {
  let size;
  try {
    size = statSync(file).size;
  } catch {
    continue;
  }
  if (size > MAX_FILE_BYTES) continue;

  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.includes(SAFE_MARKER)) continue;
    for (const rule of rules) {
      if (rule.pattern.test(line)) findings.push({ file, line: index + 1, rule: rule.id });
    }
  }
}

if (findings.length > 0) {
  console.error(`Secret scan failed: ${findings.length} potential finding(s).`);
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line} [${finding.rule}]`);
  }
  process.exit(1);
}

console.log(`Secret scan passed: ${tracked.length} source/config files checked; values were not printed.`);
