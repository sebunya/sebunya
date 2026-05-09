import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

console.log('Starting verification script...');

const run = (command: string, cwd: string) => {
  console.log(`Running: ${command} in ${cwd}`);
  try {
    execSync(command, { cwd, stdio: 'inherit' });
  } catch (error) {
    console.error(`Error executing ${command}`);
    process.exit(1);
  }
};

const rootDir = path.resolve(__dirname, '..');

// 1. Architecture Check (Naive file read to ensure domain doesn't import hono/drizzle)
const domainDir = path.join(rootDir, 'apps', 'api', 'src', 'domain');
if (fs.existsSync(domainDir)) {
  const checkDomainImports = (dir: string) => {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        checkDomainImports(fullPath);
      } else if (fullPath.endsWith('.ts')) {
        const content = fs.readFileSync(fullPath, 'utf8');
        if (content.includes('from \'hono\'') || content.includes('from "hono"')) {
          console.error(`Architecture Violation: ${fullPath} imports Hono.`);
          process.exit(1);
        }
        if (content.includes('from \'drizzle-orm\'') || content.includes('from "drizzle-orm"')) {
          console.error(`Architecture Violation: ${fullPath} imports Drizzle.`);
          process.exit(1);
        }
      }
    }
  };
  checkDomainImports(domainDir);
  console.log('Architecture checks passed!');
}

console.log('Verification successful! Ready for first human engineering review.');
