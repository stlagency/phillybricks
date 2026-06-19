/**
 * Print the generated `public.distress_signal` matview DDL (PRD §3.4, §5.3).
 *
 * The output is embedded VERBATIM in the M3 migration (0011) between the
 * `-- BEGIN GENERATED distress_signal` / `-- END GENERATED distress_signal` markers;
 * `distressSql.test.ts` asserts the migration block equals this output, so a config
 * weight/cap change fails CI until the migration is regenerated:
 *
 *   pnpm --filter @bandbox/core exec tsx scripts/print-distress-sql.ts
 */
import { buildDistressSignalDDL } from '../src/scoring/distressSql.js';

process.stdout.write(buildDistressSignalDDL() + '\n');
