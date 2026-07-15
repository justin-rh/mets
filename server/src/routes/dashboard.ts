import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireStaffRead } from './guards.js';

/**
 * Dashboard aggregates — live queries; at ~10^5 tickets these run in
 * milliseconds (materialized views are the documented path if that changes).
 * Medians throughout: one three-week vendor ticket wrecks a mean.
 */
export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/api/dashboard', async (req) => {
    requireStaffRead(req);
    const tz = 'America/Phoenix';

    const [tiles] = (await db.execute(sql`
      select
        (select count(*) from tickets t join statuses s on s.id = t.status_id
          where s.category not in ('resolved','closed')) as open_count,
        (select count(*) from tickets where created_at > now() - interval '30 days') as created_30,
        (select count(*) from tickets where resolved_at > now() - interval '30 days') as resolved_30,
        (select percentile_cont(0.5) within group (order by extract(epoch from resolved_at - created_at) / 3600)
          from tickets where resolved_at > now() - interval '30 days') as median_mttr_hours,
        (select percentile_cont(0.5) within group (order by extract(epoch from first_responded_at - created_at) / 3600)
          from tickets where first_responded_at is not null and created_at > now() - interval '30 days') as median_frt_hours,
        (select round(100.0 * count(*) filter (where breached_at is null) / nullif(count(*), 0), 1)
          from sla_instances
          where metric = 'resolution' and completed_at > now() - interval '30 days') as sla_attainment_pct,
        (select round(avg(csat_rating)::numeric, 2) from tickets
          where csat_at > now() - interval '30 days') as csat_avg_30,
        (select count(*) from tickets
          where csat_at > now() - interval '30 days') as csat_count_30,
        (select count(*) from ticket_events
          where event_type = 'kb_deflected' and created_at > now() - interval '30 days') as deflected_30,
        (select count(*) from ticket_events
          where event_type = 'kb_deflection_offered' and created_at > now() - interval '30 days') as deflection_offered_30
    `)).rows as any[];

    const csatDist = (await db.execute(sql`
      select csat_rating as rating, count(*) as count from tickets
      where csat_at > now() - interval '30 days'
      group by csat_rating order by csat_rating desc
    `)).rows;

    const daily = (await db.execute(sql`
      with days as (
        select generate_series(
          date_trunc('day', now() at time zone ${tz}) - interval '29 days',
          date_trunc('day', now() at time zone ${tz}),
          interval '1 day')::date as day
      )
      select d.day::text,
        (select count(*) from tickets where (created_at at time zone ${tz})::date = d.day) as created,
        (select count(*) from tickets where (resolved_at at time zone ${tz})::date = d.day) as resolved
      from days d order by d.day
    `)).rows;

    const backlogAge = (await db.execute(sql`
      select bucket, count(*) as count from (
        select case
          when now() - t.created_at < interval '1 day' then '< 1d'
          when now() - t.created_at < interval '3 days' then '1–3d'
          when now() - t.created_at < interval '7 days' then '3–7d'
          when now() - t.created_at < interval '30 days' then '7–30d'
          else '> 30d'
        end as bucket
        from tickets t join statuses s on s.id = t.status_id
        where s.category not in ('resolved','closed')
      ) b group by bucket
    `)).rows;

    const openByQueue = (await db.execute(sql`
      select tm.name, count(t.id) as count
      from teams tm
      left join tickets t on t.queue_id = tm.id
      left join statuses s on s.id = t.status_id and s.category not in ('resolved','closed')
      where s.id is not null
      group by tm.name order by count desc
    `)).rows;

    // The AI scoreboard: how triage is actually performing, from the same
    // audited decisions agents see in the AI Triage log.
    const [aiTiles] = (await db.execute(sql`
      select
        count(*) filter (where created_at > now() - interval '30 days') as total_30,
        count(*) filter (where status = 'auto_applied' and created_at > now() - interval '30 days') as auto_30,
        count(*) filter (where status = 'applied' and created_at > now() - interval '30 days') as accepted_30,
        count(*) filter (where status = 'corrected' and created_at > now() - interval '30 days') as corrected_30,
        count(*) filter (where status = 'dismissed' and created_at > now() - interval '30 days') as dismissed_30,
        count(*) filter (where status in ('auto_applied','applied') and created_at > now() - interval '7 days') as agreed_wk,
        count(*) filter (where status in ('auto_applied','applied','corrected','dismissed') and created_at > now() - interval '7 days') as judged_wk,
        count(*) filter (where status in ('auto_applied','applied') and created_at between now() - interval '14 days' and now() - interval '7 days') as agreed_prev,
        count(*) filter (where status in ('auto_applied','applied','corrected','dismissed') and created_at between now() - interval '14 days' and now() - interval '7 days') as judged_prev
      from ai_enrichments where feature = 'triage'
    `)).rows as any[];

    const aiByCategory = (await db.execute(sql`
      select result->>'category' as category,
        count(*) as decisions,
        count(*) filter (where status = 'corrected') as corrected
      from ai_enrichments
      where feature = 'triage' and created_at > now() - interval '30 days'
        and status in ('auto_applied','applied','corrected','dismissed')
      group by 1 having count(*) >= 3
      order by decisions desc limit 8
    `)).rows;

    const aiUsage = (await db.execute(sql`
      select feature, count(*) as calls,
        sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens
      from ai_usage where created_at > now() - interval '30 days'
      group by feature order by sum(input_tokens) desc
    `)).rows;

    return { tiles, daily, backlogAge, openByQueue, csatDist, ai: { tiles: aiTiles, byCategory: aiByCategory, usage: aiUsage } };
  });

  // TP leaderboard: rank agents by Ticket Points earned (score of tickets
  // they resolved in the window) with the quality stats that keep it honest —
  // SLA hit rate, first-response speed, and CSAT.
  app.get('/api/dashboard/leaderboard', async (req) => {
    requireStaffRead(req);
    const { days } = z.object({
      days: z.coerce.number().refine((d) => [7, 30, 90].includes(d)).default(30),
    }).parse(req.query as any);

    const rows = (await db.execute(sql`
      select u.id, u.name,
        count(*) as resolved,
        coalesce(sum(t.score), 0) as tp,
        round(100.0 * count(*) filter (where si.id is not null and si.breached_at is null)
          / nullif(count(*) filter (where si.id is not null), 0), 0) as sla_pct,
        percentile_cont(0.5) within group
          (order by extract(epoch from t.first_responded_at - t.created_at) / 3600) as median_frt_hours,
        round(avg(t.csat_rating)::numeric, 1) as csat,
        count(t.csat_rating) as csat_count
      from tickets t
      join users u on u.id = t.assignee_id
      left join sla_instances si on si.ticket_id = t.id and si.metric = 'resolution'
      where t.resolved_at > now() - make_interval(days => ${days})
      group by u.id, u.name
      order by tp desc
      limit 12
    `)).rows;
    return { days, rows };
  });
}
