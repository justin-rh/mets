import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

/**
 * Dashboard aggregates — live queries; at ~10^5 tickets these run in
 * milliseconds (materialized views are the documented path if that changes).
 * Medians throughout: one three-week vendor ticket wrecks a mean.
 */
export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/api/dashboard', async () => {
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
          where csat_at > now() - interval '30 days') as csat_count_30
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

    const leaderboard = (await db.execute(sql`
      select u.name, sum(t.score) as tp, count(*) as resolved
      from tickets t join users u on u.id = t.assignee_id
      where t.resolved_at > now() - interval '30 days'
      group by u.name order by tp desc limit 10
    `)).rows;

    return { tiles, daily, backlogAge, openByQueue, leaderboard, csatDist };
  });
}
