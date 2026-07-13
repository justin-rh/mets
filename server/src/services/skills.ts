import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

const { skills, agentSkills } = schema;

const LEVELS: [number, number][] = [[20, 3], [10, 2], [5, 1]]; // resolved-count → level

/**
 * Derive expertise from resolution history: an agent who resolved >= 5
 * tickets in a category (last `sinceDays`) earns that category as a skill,
 * leveled by volume. Auto-granted skills are re-synced — revoked when they
 * no longer qualify. Manually assigned skills are never touched.
 */
export async function deriveSkillsFromHistory(sinceDays = 180, minResolved = 5) {
  const rows = (await db.execute(sql`
    select t.assignee_id as user_id, c.name as category, count(*)::int as resolved
    from tickets t
    join categories c on c.id = t.category_id
    where t.assignee_id is not null
      and t.resolved_at > now() - (${sinceDays} || ' days')::interval
    group by t.assignee_id, c.name
    having count(*) >= ${minResolved}
  `)).rows as { user_id: number; category: string; resolved: number }[];

  // Ensure a skill exists per qualifying category.
  const skillIdByName = new Map<string, number>();
  for (const name of new Set(rows.map((r) => r.category))) {
    let [skill] = await db.select().from(skills).where(eq(skills.name, name));
    if (!skill) [skill] = await db.insert(skills).values({ name }).returning();
    skillIdByName.set(name, skill!.id);
  }

  let granted = 0;
  const qualified = new Set<string>();
  for (const r of rows) {
    const skillId = skillIdByName.get(r.category)!;
    const level = LEVELS.find(([min]) => r.resolved >= min)?.[1] ?? 1;
    qualified.add(`${r.user_id}:${skillId}`);
    const result = await db.insert(agentSkills)
      .values({ userId: Number(r.user_id), skillId, level, source: 'auto' })
      .onConflictDoUpdate({
        target: [agentSkills.userId, agentSkills.skillId],
        set: { level },
        // only auto rows get releveled — a manual grant keeps its level
        setWhere: sql`${agentSkills.source} = 'auto'`,
      })
      .returning();
    granted += result.length;
  }

  // Revoke auto skills that no longer qualify.
  const existing = await db.select().from(agentSkills).where(eq(agentSkills.source, 'auto'));
  let revoked = 0;
  for (const row of existing) {
    if (!qualified.has(`${row.userId}:${row.skillId}`)) {
      await db.delete(agentSkills).where(and(
        eq(agentSkills.userId, row.userId),
        eq(agentSkills.skillId, row.skillId),
        eq(agentSkills.source, 'auto'),
      ));
      revoked++;
    }
  }

  return { qualified: qualified.size, revoked };
}

export function startSkillsSync(log: (msg: string) => void, intervalMs = 6 * 3_600_000) {
  const run = () =>
    deriveSkillsFromHistory()
      .then((r) => log(`skills sync: ${r.qualified} qualified, ${r.revoked} revoked`))
      .catch((err) => log(`skills sync failed: ${err.message}`));
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}
