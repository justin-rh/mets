import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
config({ path: rootEnv });

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://mets:mets_dev@localhost:5433/mets',
  port: Number(process.env.PORT ?? 3001),
  authProvider: process.env.AUTH_PROVIDER ?? 'dev',
  mailProvider: process.env.MAIL_PROVIDER ?? 'mock',
  aiProvider: process.env.AI_PROVIDER ?? 'mock',
  storageProvider: process.env.STORAGE_PROVIDER ?? 'local',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  aiModel: process.env.AI_MODEL ?? 'claude-opus-4-8',
  aiDailyTokenBudget: Number(process.env.AI_DAILY_TOKEN_BUDGET ?? 2_000_000),
};
