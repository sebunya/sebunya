import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn('DATABASE_URL is not defined. Database connection will fail if used.');
}

const client = postgres(connectionString || 'postgres://localhost:5432/goldplus');
export const db = drizzle(client, { schema });
