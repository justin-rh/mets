import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
config({ path: rootEnv });

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://mets:mets_dev@localhost:5433/mets',
  port: Number(process.env.PORT ?? 3001),
  authProvider: process.env.AUTH_PROVIDER ?? 'dev', // 'dev' | 'entra' — see docs/SSO.md
  entraTenantId: process.env.ENTRA_TENANT_ID ?? '',
  entraClientId: process.env.ENTRA_CLIENT_ID ?? '',
  mailProvider: process.env.MAIL_PROVIDER ?? 'mock', // 'mock' | 'smtp' — see docs/EMAIL.md
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpSecure: process.env.SMTP_SECURE === 'true', // implicit TLS (465); default STARTTLS
  smtpUser: process.env.SMTP_USER ?? '', // empty = unauthenticated relay
  smtpPass: process.env.SMTP_PASS ?? '',
  smtpFrom: process.env.SMTP_FROM ?? 'mets@masterelectronics.com',
  aiProvider: process.env.AI_PROVIDER ?? 'mock',
  storageProvider: process.env.STORAGE_PROVIDER ?? 'local',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  aiModel: process.env.AI_MODEL ?? 'claude-opus-4-8',
  aiDailyTokenBudget: Number(process.env.AI_DAILY_TOKEN_BUDGET ?? 2_000_000),
};
