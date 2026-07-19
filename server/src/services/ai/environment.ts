// SOTO's environment knowledge — the company systems/terminology profiles
// every AI prompt rides on. Two tiers: the CORE quick-reference (paid for on
// every triage/search/incident/intake call) and the EXPANDED profile (used
// when the core triage pass lands under the confidence gate, and by
// suggest-fix grounding). Live copies live in provider.ts (module state, so
// prompts stay DB-free); this module persists admin edits to app_config and
// restores them at boot. Also owns the show-its-work toggle.
import { eq } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import {
  DEFAULT_CORE_ENVIRONMENT_PROFILE,
  DEFAULT_ENVIRONMENT_PROFILE,
  setAiRuntimeEnabled,
  setCoreEnvironmentProfile,
  setEnvironmentProfile,
} from './provider.js';

export type ProfileTier = 'core' | 'expanded';

const TIERS: Record<ProfileTier, {
  key: string;
  fallback: string;
  apply: (text: string) => void;
}> = {
  core: {
    key: 'ai_environment_core',
    fallback: DEFAULT_CORE_ENVIRONMENT_PROFILE,
    apply: setCoreEnvironmentProfile,
  },
  expanded: {
    key: 'ai_environment_profile',
    fallback: DEFAULT_ENVIRONMENT_PROFILE,
    apply: setEnvironmentProfile,
  },
};

const SHOW_WORK_KEY = 'ai_show_work';

async function readConfig(key: string) {
  const [row] = await db.select().from(schema.appConfig).where(eq(schema.appConfig.key, key));
  return row?.value as Record<string, unknown> | undefined;
}

async function writeConfig(key: string, value: object) {
  await db.insert(schema.appConfig)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.appConfig.key, set: { value, updatedAt: new Date() } });
}

const AI_ENABLED_KEY = 'ai_enabled';

/** Restore saved profiles + the AI kill switch over defaults. Called at boot. */
export async function loadEnvironmentProfiles(log?: (m: string) => void) {
  for (const [tier, cfg] of Object.entries(TIERS)) {
    const text = (await readConfig(cfg.key))?.text;
    if (typeof text === 'string' && text.trim()) {
      cfg.apply(text);
      log?.(`ai: custom ${tier} environment profile loaded`);
    }
  }
  const enabled = (await readConfig(AI_ENABLED_KEY))?.enabled;
  if (enabled === false) {
    setAiRuntimeEnabled(false);
    log?.('ai: KILL SWITCH is OFF — all AI features running on the keyword fallback');
  }
}

/** The admin kill switch: persists and applies immediately. */
export async function setAiEnabled(enabled: boolean) {
  await writeConfig(AI_ENABLED_KEY, { enabled });
  setAiRuntimeEnabled(enabled);
  return { enabled };
}

/** Persist an admin edit and apply it live. Empty text = reset to default. */
export async function saveEnvironmentProfile(tier: ProfileTier, text: string) {
  const cfg = TIERS[tier];
  const trimmed = text.trim();
  if (!trimmed) {
    await db.delete(schema.appConfig).where(eq(schema.appConfig.key, cfg.key));
    cfg.apply(cfg.fallback);
    return { custom: false };
  }
  await writeConfig(cfg.key, { text: trimmed });
  cfg.apply(trimmed);
  return { custom: true };
}

/**
 * Show-its-work toggle: when on, triage returns its signals (the reveal in
 * the create dialog) at the cost of a few hundred extra tokens per call.
 * Demo polish — flip it off for production volume.
 */
export async function getShowWork(): Promise<boolean> {
  const value = await readConfig(SHOW_WORK_KEY);
  return (value?.enabled as boolean | undefined) ?? true;
}

export async function setShowWork(enabled: boolean) {
  await writeConfig(SHOW_WORK_KEY, { enabled });
  return { enabled };
}
