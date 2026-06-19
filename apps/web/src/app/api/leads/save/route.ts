/**
 * /api/leads/save — mini-CRM write surface (PRD §3.5, §7.3). POST upserts one
 * saved lead for the current user (status / tags / notes); GET lists the user's
 * saved leads, newest first. Both are auth-gated (requireUser) and POST is
 * CSRF-guarded (sameOrigin).
 *
 * Ownership is enforced EXPLICITLY in SQL (`where user_id = ${userId}` / the
 * UNIQUE(user_id, parcel_pk) conflict target) — the server connection is NOT the
 * `authenticated` role, so RLS does not apply and the guard must be in the query.
 */
import { NextResponse } from 'next/server';
import type {
  SavedLead,
  SavedLeadStatus,
  SaveLeadInput,
} from '@bandbox/core/contracts';
import { db } from '../../../../lib/db';
import { requireUser, sameOrigin, authError } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

const STATUSES: ReadonlySet<SavedLeadStatus> = new Set<SavedLeadStatus>([
  'new',
  'contacted',
  'negotiating',
  'dead',
  'won',
]);

/** A raw app.saved_lead row (postgres.js returns timestamps as Date). */
interface SavedLeadRow {
  id: string;
  parcel_pk: string;
  status: string;
  tags: string[] | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Normalize a DB row to the frozen SavedLead contract. */
function toSavedLead(r: SavedLeadRow): SavedLead {
  return {
    id: r.id,
    parcel_pk: r.parcel_pk,
    status: r.status as SavedLeadStatus,
    tags: r.tags ?? [],
    notes: r.notes,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

export async function POST(req: Request): Promise<Response> {
  const user = await requireUser(req);
  if (user instanceof Response) return user;
  if (!sameOrigin(req)) return authError(403, 'forbidden_origin');

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const input = body as Partial<SaveLeadInput>;
  const parcelPk = typeof input.parcel_pk === 'string' ? input.parcel_pk.trim() : '';
  if (!parcelPk) return NextResponse.json({ error: 'parcel_pk required' }, { status: 400 });

  if (input.status !== undefined && !STATUSES.has(input.status)) {
    return NextResponse.json({ error: 'invalid_status' }, { status: 400 });
  }
  const status: SavedLeadStatus = input.status ?? 'new';

  // tags: an array of non-empty strings (default empty); notes: string|null.
  const tags: string[] = Array.isArray(input.tags)
    ? input.tags.filter((t): t is string => typeof t === 'string' && t.length > 0)
    : [];
  const notes: string | null =
    input.notes === undefined || input.notes === null ? null : String(input.notes);

  const sql = db();
  const rows = await sql<SavedLeadRow[]>`
    insert into app.saved_lead (user_id, parcel_pk, status, tags, notes)
    values (${user.userId}, ${parcelPk}, ${status}, ${tags}, ${notes})
    on conflict (user_id, parcel_pk) do update
      set status = excluded.status,
          tags = excluded.tags,
          notes = excluded.notes,
          updated_at = now()
    returning id, parcel_pk, status, tags, notes, created_at, updated_at`;

  return NextResponse.json(toSavedLead(rows[0]!));
}

export async function GET(req: Request): Promise<Response> {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const sql = db();
  const rows = await sql<SavedLeadRow[]>`
    select id, parcel_pk, status, tags, notes, created_at, updated_at
    from app.saved_lead
    where user_id = ${user.userId}
    order by created_at desc`;

  const body: SavedLead[] = rows.map(toSavedLead);
  return NextResponse.json(body);
}
