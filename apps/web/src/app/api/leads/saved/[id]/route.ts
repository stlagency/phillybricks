/**
 * /api/leads/saved/:id — mutate one saved lead the current user owns (PRD §3.5,
 * §7.3). PATCH updates status / tags / notes; DELETE removes the row. Both guard
 * ownership EXPLICITLY in SQL (`id = ${id} and user_id = ${userId}`) — the server
 * connection is not the `authenticated` role, so RLS does not apply; a row owned by
 * another user simply does not match and returns 404. PATCH is CSRF-guarded.
 */
import { NextResponse } from 'next/server';
import type { SavedLead, SavedLeadStatus } from '@bandbox/core/contracts';
import { db } from '../../../../../lib/db';
import { requireUser, sameOrigin, authError } from '../../../../../lib/auth';

export const dynamic = 'force-dynamic';

const STATUSES: ReadonlySet<SavedLeadStatus> = new Set<SavedLeadStatus>([
  'new',
  'contacted',
  'negotiating',
  'dead',
  'won',
]);

interface SavedLeadRow {
  id: string;
  parcel_pk: string;
  status: string;
  tags: string[] | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

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

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await requireUser(req);
  if (user instanceof Response) return user;
  if (!sameOrigin(req)) return authError(403, 'forbidden_origin');

  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const input = body as { status?: unknown; tags?: unknown; notes?: unknown };

  if (input.status !== undefined && !STATUSES.has(input.status as SavedLeadStatus)) {
    return NextResponse.json({ error: 'invalid_status' }, { status: 400 });
  }

  // Only patch the fields that were provided (COALESCE keeps the existing value when null).
  const status: SavedLeadStatus | null =
    input.status === undefined ? null : (input.status as SavedLeadStatus);
  const tags: string[] | null =
    input.tags === undefined
      ? null
      : Array.isArray(input.tags)
        ? input.tags.filter((t): t is string => typeof t === 'string' && t.length > 0)
        : [];
  // notes: undefined ⇒ leave; null ⇒ clear; string ⇒ set. Sentinel distinguishes "leave".
  const notesProvided = input.notes !== undefined;
  const notes: string | null =
    !notesProvided || input.notes === null ? null : String(input.notes);

  const sql = db();
  const rows = await sql<SavedLeadRow[]>`
    update app.saved_lead set
      status = coalesce(${status}, status),
      tags = coalesce(${tags}, tags),
      notes = ${notesProvided ? notes : sql`notes`},
      updated_at = now()
    where id = ${id} and user_id = ${user.userId}
    returning id, parcel_pk, status, tags, notes, created_at, updated_at`;

  if (rows.length === 0) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(toSavedLead(rows[0]!));
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await requireUser(req);
  if (user instanceof Response) return user;
  if (!sameOrigin(req)) return authError(403, 'forbidden_origin');

  const { id } = await ctx.params;
  const sql = db();
  const rows = await sql<{ id: string }[]>`
    delete from app.saved_lead
    where id = ${id} and user_id = ${user.userId}
    returning id`;

  if (rows.length === 0) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
