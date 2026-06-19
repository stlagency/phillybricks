/**
 * Route "/parcel/[pk]" — Property Deep-Dive (PRD §7.2). Server component:
 * resolves the parcel bundle from the live DB via lib/parcel-query.ts
 * `loadDeepDive` (the same assembly the /api/parcel/:pk route returns) and hands
 * it to the client <DeepDive> for the interactive teach-rail / drawer / distress
 * decomposition. Unknown parcel → notFound().
 */
import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DeepDive } from './DeepDive';
import { db } from '../../../lib/db';
import { loadDeepDive } from '../../../lib/parcel-query';

interface PageProps {
  params: Promise<{ pk: string }>;
}

export const dynamic = 'force-dynamic';

// Per-request memoization so generateMetadata + Page share ONE bundle assembly
// (the deep-dive query is ~10 round-trips incl. the comp candidate scan).
const getDeepDive = cache((pk: string) => loadDeepDive(db(), pk));

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { pk } = await params;
  const data = await getDeepDive(pk);
  if (!data) return { title: 'Parcel not found — Bandbox' };
  return {
    title: `${data.parcel.address} · OPA ${data.parcel.parcel_pk} — Bandbox`,
    description: `Parcel deep-dive for ${data.parcel.address}: assessment vs. sale, sale history, permits & violations, taxes, comps + value estimate, and a decomposable distress score — every figure sourced to the public record.`,
  };
}

export default async function Page({ params }: PageProps) {
  const { pk } = await params;
  const data = await getDeepDive(pk);
  if (!data) notFound();
  return <DeepDive data={data} />;
}
