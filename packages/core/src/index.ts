/**
 * @bandbox/core — pure logic + frozen contracts.
 * The core-implementation agent (M1/M3) appends exports for:
 *   - adapters/philadelphia (CityAdapter)
 *   - scoring (distress composite + versioned config)
 *   - comps (comp selection, trim, value estimate)
 *   - transfers (flag derivation)
 */
export * from './contracts/index.js';

// Philadelphia adapter (the ONLY place Philly source literals live).
export { philadelphia } from './adapters/philadelphia.js';

// Transfer-flag derivation (PRD §5.1).
export { deriveTransferFlags } from './transfers.js';
export type { TransferInput, TransferFlags } from './transfers.js';

// Ingestion column-map helpers (coercions + geometry markers, PRD §4.2).
export {
  asText,
  asNumeric,
  asInt,
  asDate,
  asIdText,
  boolFromTrueFalse,
  boolFromYN,
  boolFromYesNo,
  ewktGeom,
  wktGeom,
  geoJsonGeom,
  isGeomMarker,
} from './ingest/mapping.js';

// Distress scoring — versioned config + composite (PRD §5.3).
export {
  DISTRESS_CONFIG,
  DISTRESS_COMPONENT_KEYS,
  type DistressConfig,
  type DistressComponentConfig,
  type NormalizeDescriptor,
} from './scoring/config.js';
export { scoreDistress, type DistressSignalInput } from './scoring/distress.js';

// Distress matview DDL generated from the SAME config as scoreDistress (PRD §3.4).
export {
  buildDistressSignalDDL,
  distressCompositeSql,
  normalizeSql,
  normalizeNumeric,
  compositeNumeric,
} from './scoring/distressSql.js';

// Comps + transparent value estimate (PRD §5.2).
export {
  selectComps,
  estimateValue,
  type CompSubject,
  type CompCandidate,
  type CompsOptions,
  type BroadCategory,
} from './comps/comps.js';

/** Bumped whenever the distress weights / normalization config changes. */
export const CORE_VERSION = '0.1.0';
