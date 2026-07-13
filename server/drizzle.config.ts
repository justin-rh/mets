import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

config({ path: '../.env' });

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://mets:mets_dev@localhost:5433/mets',
  },
});
