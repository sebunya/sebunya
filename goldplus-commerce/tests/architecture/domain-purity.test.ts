import { expect, test, describe } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Helper to recursively read all typescript files in a directory
function readAllTsFiles(dir: string, fileList: string[] = []): string[] {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      readAllTsFiles(filePath, fileList);
    } else if (filePath.endsWith('.ts')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

describe('Clean Architecture Boundaries', () => {
  const domainDir = path.join(__dirname, '../../apps/api/src/domain');
  const routesDir = path.join(__dirname, '../../apps/api/src/interfaces/http/routes');
  
  const domainFiles = readAllTsFiles(domainDir);
  const routeFiles = readAllTsFiles(routesDir);

  test('Domain must not import Hono', () => {
    domainFiles.forEach(file => {
      const content = fs.readFileSync(file, 'utf-8');
      expect(content).not.toMatch(/from\s+['"]hono['"]/);
    });
  });

  test('Domain must not import Drizzle', () => {
    domainFiles.forEach(file => {
      const content = fs.readFileSync(file, 'utf-8');
      expect(content).not.toMatch(/from\s+['"]drizzle-orm['"]/);
    });
  });

  test('Domain must not import infrastructure notification adapters', () => {
    domainFiles.forEach(file => {
      const content = fs.readFileSync(file, 'utf-8');
      expect(content).not.toMatch(/from\s+['"].*\/infrastructure\/notifications\/.*['"]/);
    });
  });

  test('Domain must not import HTTP routes', () => {
    domainFiles.forEach(file => {
      const content = fs.readFileSync(file, 'utf-8');
      expect(content).not.toMatch(/from\s+['"].*\/interfaces\/http\/.*['"]/);
    });
  });

  test('HTTP routes must not import repositories directly', () => {
    routeFiles.forEach(file => {
      const content = fs.readFileSync(file, 'utf-8');
      expect(content).not.toMatch(/from\s+['"].*\/infrastructure\/db\/.*['"]/);
      expect(content).not.toMatch(/from\s+['"].*\/infrastructure\/repositories\/.*['"]/);
    });
  });
});
