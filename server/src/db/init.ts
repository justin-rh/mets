// Creates required Postgres extensions before drizzle-kit push runs.
import pg from 'pg';
import { env } from '../config.js';

const client = new pg.Client({ connectionString: env.databaseUrl });
await client.connect();
await client.query('CREATE EXTENSION IF NOT EXISTS vector');
await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
await client.end();
console.log('extensions ready: vector, pg_trgm');
