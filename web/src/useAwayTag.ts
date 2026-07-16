import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { actingUserId, fetchUsers } from './api';

// Mirrors the server's locationSlug: 'Santa Clara, CA' → 'santa-clara-ca'.
const slug = (loc: string) => loc.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Returns a predicate marking location tags that are NOT the acting user's
 * home site, so out-of-town tickets stand out on the board. 'remote' is
 * site-neutral (matches the scoring rule) and never flagged.
 */
export function useAwayTag(): (tag: string) => boolean {
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: fetchUsers, staleTime: 300_000 });
  const uid = actingUserId();
  return useMemo(() => {
    const locSlugs = new Set(
      (users ?? []).flatMap((u) => (u.location ? [slug(u.location)] : [])),
    );
    locSlugs.delete('remote');
    const me = (users ?? []).find((u) => u.id === uid);
    const home = me?.location ? slug(me.location) : '';
    return (tag: string) => locSlugs.has(tag) && tag !== home;
  }, [users, uid]);
}
