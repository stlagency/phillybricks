/**
 * @phillybricks/core — pure logic + frozen contracts.
 * The core-implementation agent (M1/M3) appends exports for:
 *   - adapters/philadelphia (CityAdapter)
 *   - scoring (distress composite + versioned config)
 *   - comps (comp selection, trim, value estimate)
 *   - transfers (flag derivation)
 */
export * from './contracts/index.js';

/** Bumped whenever the distress weights / normalization config changes. */
export const CORE_VERSION = '0.1.0';
