#!/usr/bin/env node
/**
 * Portability gate (PRD §2.1, §8). FAILS the build if any Philadelphia-specific
 * SOURCE literal — Carto table name, source endpoint host, source key-column
 * name, or raw document_type code — appears OUTSIDE packages/core/src/adapters/.
 *
 * Our own canonical names (public.parcel, public.transfer, …) and UI copy
 * ("Philadelphia", neighborhood names) are NOT source literals and are allowed.
 *
 * Exit 1 on any violation.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

// Philly SOURCE literals that must live ONLY in the adapter.
const FORBIDDEN = [
  // Carto source tables
  'opa_properties_public',
  'rtt_summary',
  'case_investigations',
  'real_estate_tax_delinquencies',
  'real_estate_tax_balances',
  'incidents_part1_part2',
  'public_cases_fc',
  'business_licenses',
  // source endpoint hosts
  'phl.carto.com',
  'opendata-downloads.s3.amazonaws.com',
  'phillysheriff.com',
  'bid4assets.com',
  // source parcel-key column names (the hazard) + decoy
  'opa_account_num',
  'parcel_id_num',
  // raw document_type codes (derive flags via adapter vocab, never inline)
  "DEED SHERIFF",
  "SHERIFF'S DEED",
  'DM - LIS PENDENS',
  'DEED OF CONDEMNATION',
];

// Directories to scan (code only).
const SCAN_DIRS = ['apps/web/src', 'packages/db', 'packages/ingestion/src', 'packages/tiles/src'];

// Allowed homes for Philly literals + things we never scan.
const ALLOW_PREFIXES = [
  join('packages', 'core', 'src', 'adapters'),
];
const SKIP_SEGMENTS = new Set(['node_modules', 'dist', '.next', 'test', 'tests', '__tests__', 'fixtures']);
const SKIP_EXT = new Set(['.md', '.json', '.map', '.snap']);
const SKIP_FILE_SUFFIX = ['.test.ts', '.test.tsx', '.spec.ts'];

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (SKIP_SEGMENTS.has(name)) continue;
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

const violations = [];
for (const d of SCAN_DIRS) {
  const base = join(ROOT, d);
  for (const file of walk(base)) {
    const rel = relative(ROOT, file);
    if (ALLOW_PREFIXES.some((p) => rel.startsWith(p + sep) || rel.startsWith(p))) continue;
    if (SKIP_EXT.has(file.slice(file.lastIndexOf('.')))) continue;
    if (SKIP_FILE_SUFFIX.some((s) => file.endsWith(s))) continue;
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      for (const lit of FORBIDDEN) {
        if (line.includes(lit)) {
          violations.push({ file: rel, line: i + 1, literal: lit, text: line.trim().slice(0, 120) });
        }
      }
    });
  }
}

if (violations.length > 0) {
  console.error('❌ Portability gate FAILED — Philly source literals outside packages/core/src/adapters/:');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  →  "${v.literal}"`);
    console.error(`      ${v.text}`);
  }
  console.error(`\n${violations.length} violation(s). Move the literal behind the CityAdapter seam.`);
  process.exit(1);
}

console.log('✅ Portability gate passed — no Philly source literals leaked outside the adapter.');
