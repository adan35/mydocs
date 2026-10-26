/** Who may do what with a shared document. Pure, so the rules are unit-tested. */
export type Role = 'view' | 'edit' | 'owner';
export type LinkRole = 'off' | 'view' | 'edit';

export interface ShareMeta {
  name: string;
  ownerEmail: string;
  ownerName: string;
  /** What anyone holding the link can do. */
  linkRole: LinkRole;
  /** Secret part of the link. Rotating it kills every link already sent. */
  linkKey: string;
  members: Record<string, 'view' | 'edit'>;
  createdAt: number;
}

const RANK: Record<Role, number> = { view: 1, edit: 2, owner: 3 };

export const normEmail = (s: string) => s.trim().toLowerCase();
export const canWrite = (r: Role) => r === 'edit' || r === 'owner';

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The strongest role a caller has. `email` is the verified Google email (or null when
 * signed out); `key` is the secret from a share link. Link editing needs a signed-in
 * user, so an edit link opened without signing in only reads.
 */
export function resolveRole(
  meta: ShareMeta,
  email: string | null,
  key: string | null,
): Role | null {
  const who = email ? normEmail(email) : null;
  if (who && who === normEmail(meta.ownerEmail)) return 'owner';
  let best: Role | null = null;
  const take = (r: Role) => {
    if (!best || RANK[r] > RANK[best]) best = r;
  };
  const member = who ? meta.members[who] : undefined;
  if (member) take(member);
  if (meta.linkRole !== 'off' && key && safeEqual(key, meta.linkKey)) {
    take(meta.linkRole === 'edit' && !who ? 'view' : meta.linkRole);
  }
  return best;
}

/** AI quota: tokens are reserved before a call and settled to the real usage after it. */
export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);

export function nextMonthStart(d = new Date()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
}

export function tryReserve(used: number, limit: number, want: number) {
  return want <= Math.max(0, limit - used)
    ? { ok: true as const, used: used + want }
    : { ok: false as const, used };
}

export const settle = (used: number, reserved: number, actual: number) =>
  Math.max(0, used - reserved + actual);
