/**
 * Per-source `SourceSteps` (PRD §4.1): promote (mapping-driven upsert), diff
 * (change-log / event history), refreshDerived. Selected generically by canonical
 * target table — no Philly source literal appears here.
 *
 * M3 NOTE: the per-source `refreshDerived` is intentionally a NO-OP. Refreshing the
 * two population matviews (distress_signal, comp_candidate) once per source would mean
 * 14× redundant full refreshes a night, so derived refresh + geo-stamp + geo_metric
 * recompute run ONCE at the end of the nightly via `finalizeDerived` (finalize.ts,
 * called by run.ts main()). The §4.1 "after promote" invariant still holds — finalize
 * runs strictly after every source has promoted.
 */
import type { SourceSpec, SourceMapping } from '@bandbox/core/contracts';
import { computeSoftRetire } from './adapters/opaBulk.js';
import type { DbClient } from './db.js';
import type { SourceSteps, StagedBatch } from './pipeline.js';
import { mapRows, upsertMapped } from './loaders/upsert.js';
import {
  runDelinquencyEventDiff,
  runParcelChangeLog,
  runViolationEventDiff,
} from './loaders/changeLog.js';

/** Chunk size for the soft-retire UPDATE (parcel_pk IN (...)). */
const RETIRE_CHUNK = 500;

/**
 * Soft-retire OPA accounts present in canonical but ABSENT from the freshly-loaded
 * batch (PRD §3.2) — never hard-delete. CRITICAL: callers must only invoke this on
 * a NON-empty batch; an empty batch would retire every parcel. Returns the count
 * retired.
 */
export async function softRetireParcels(
  db: DbClient,
  mapping: SourceMapping,
  batch: StagedBatch,
): Promise<number> {
  if (batch.rows.length === 0) return 0;
  const loaded = new Set<string>();
  for (const m of mapRows(mapping, batch.rows)) {
    const pk = m.parcel_pk;
    if (typeof pk === 'string' && pk.length > 0) loaded.add(pk);
  }
  if (loaded.size === 0) return 0; // defensive: nothing valid loaded ⇒ do not retire

  const activeRows = (await db.unsafe(
    `select parcel_pk from public.parcel where is_active = true`,
  )) as readonly { parcel_pk: string }[];
  const retire = computeSoftRetire(
    activeRows.map((r) => r.parcel_pk),
    loaded,
  );

  for (let i = 0; i < retire.length; i += RETIRE_CHUNK) {
    const slice = retire.slice(i, i + RETIRE_CHUNK);
    const placeholders = slice.map((_, j) => `$${j + 1}`).join(', ');
    await db.unsafe(
      `update public.parcel set is_active = false, retired_at = now()
        where parcel_pk in (${placeholders}) and is_active = true`,
      slice,
    );
  }
  return retire.length;
}

/** The OPA spine diff: soft-retire missing accounts, then accrue parcel_change_log. */
async function opaDiff(db: DbClient, mapping: SourceMapping, batch: StagedBatch): Promise<number> {
  if (batch.rows.length === 0) return 0; // freshness skip — never retire / re-baseline
  const retired = await softRetireParcels(db, mapping, batch);
  const logged = await runParcelChangeLog(db);
  return retired + logged;
}

/** Choose the diff step for a source by its canonical target (no source literals). */
function diffForSpec(spec: SourceSpec, mapping: SourceMapping): SourceSteps['diff'] {
  if (spec.platform === 's3') {
    return (db, batch) => opaDiff(db, mapping, batch);
  }
  if (spec.targetTable === 'public.tax_delinquency') {
    return (db) => runDelinquencyEventDiff(db);
  }
  if (spec.targetTable === 'public.violation') {
    return (db) => runViolationEventDiff(db);
  }
  // L&I permits/complaints/cases, distress inventory, tax balances, spatial feeds:
  // the canonical append IS the record; no separate event diff in M1.
  return async () => 0;
}

/**
 * Build the `SourceSteps` for a wired source from its `SourceMapping`. promote is
 * the generic mapping-driven upsert; diff is selected by canonical target table.
 */
export function makeStepsForSpec(spec: SourceSpec): SourceSteps {
  const mapping = spec.mapping;
  if (!mapping) throw new Error(`source ${spec.name} has no mapping — cannot build steps`);
  return {
    async promote(tx, batch) {
      const { promoted } = await upsertMapped(tx, mapping, batch.rows);
      return promoted;
    },
    diff: diffForSpec(spec, mapping),
    async refreshDerived() {
      // No-op by design: derived refresh is a single end-of-run finalizeDerived()
      // (finalize.ts), not a per-source step. See the module header.
    },
  };
}
