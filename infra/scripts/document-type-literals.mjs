#!/usr/bin/env node
/**
 * Document-type literal gate (PRD §5.1). Asserts every document_type literal in
 * the philadelphia adapter's `documentTypes` vocab matches ≥1 live source row,
 * so a silent upstream rename fails loudly instead of zeroing out flag derivation.
 *
 * Requires live Carto (public, no key). Run with `--live` in the nightly /
 * weekly CI; a no-network invocation is a no-op notice. Wired in the M1
 * ingestion+verification pass against packages/core/src/adapters/philadelphia.ts.
 */
const live = process.argv.includes('--live');
if (!live) {
  console.log('ℹ️  document-type-literals: pass --live to check the adapter vocab against Carto. (skeleton no-op)');
  process.exit(0);
}
console.error('document-type-literals --live not yet wired; implemented in M1 verification.');
process.exit(0);
