import * as fs from 'fs';
import * as path from 'path';

export function readText(filePath: string): string {
  const fullPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(fullPath)) throw new Error(`File not found: ${filePath}`);
  return fs.readFileSync(fullPath, 'utf8');
}

export function readExistingText(possiblePaths: string[]): string {
  for (const p of possiblePaths) {
    const fullPath = path.resolve(process.cwd(), p);
    if (fs.existsSync(fullPath)) return fs.readFileSync(fullPath, 'utf8');
  }
  throw new Error(`None of the paths found: ${possiblePaths.join(', ')}`);
}

export function findFiles(root: string, predicate: (name: string) => boolean): string[] {
  const results: string[] = [];
  const fullRoot = path.resolve(process.cwd(), root);
  if (!fs.existsSync(fullRoot)) return results;
  
  const scan = (dir: string) => {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        scan(fullPath);
      } else {
        if (predicate(file)) results.push(fullPath);
      }
    }
  };
  scan(fullRoot);
  return results;
}

export function assertContains(text: string, requiredText: string, message: string) {
  if (!text.includes(requiredText)) {
    throw new Error(`${message}: Expected text to contain "${requiredText}"`);
  }
}

export function assertNotContains(text: string, forbiddenText: string, message: string) {
  if (text.includes(forbiddenText)) {
    throw new Error(`${message}: Expected text NOT to contain "${forbiddenText}"`);
  }
}

export function assertMatches(text: string, regex: RegExp, message: string) {
  if (!regex.test(text)) {
    throw new Error(`${message}: Expected text to match ${regex.toString()}`);
  }
}

export function assertNoPatternInFiles(files: string[], regex: RegExp, allowedContextDescription: string) {
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    if (regex.test(text)) {
      throw new Error(`File ${file} contains forbidden pattern ${regex.toString()}. Allowed context: ${allowedContextDescription}`);
    }
  }
}

export function assertFileExists(filePath: string) {
  const fullPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Expected file to exist: ${filePath}`);
  }
}

export function collectAdminSurfaceFiles() {
  return findFiles('apps/web/src', n => n.endsWith('.astro') || n.endsWith('.ts'));
}

export function collectMeasurementControlTowerFiles() {
  const pages = findFiles('apps/web/src/pages/admin', n => n.includes('measurement-'));
  const components = findFiles('apps/web/src/components/admin', n => n.includes('measurement-'));
  return [...pages, ...components];
}

export function collectReleaseReadinessFiles() {
  return findFiles('apps/api/src/infrastructure/release', n => n.endsWith('.ts'));
}

export function collectProductFinderFiles() {
  const allApi = findFiles('apps/api/src', n => n.endsWith('.ts'));
  return allApi.filter(f => f.toLowerCase().includes('productfinder') || f.toLowerCase().includes('product-finder'));
}

export function collectDocsFiles() {
  return findFiles('docs/measurement-control-tower', n => n.endsWith('.md'));
}
