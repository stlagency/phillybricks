/**
 * Barrel for typed mock fixtures. Every object here is shaped EXACTLY like a
 * frozen contract in @bandbox/core/contracts and stands in for a live API
 * response until the DB layer lands:
 *
 *   ParcelDeepDive  ← GET /api/parcel/:pk    (parcel.ts)
 *   CompsResult     ← GET /api/comps?pk=…    (comps.ts, also embedded in parcel)
 *   DistressResult  ← parcel.distress + lead rows (distress.ts)
 *   ScanResponse    ← GET /api/scan          (scan.ts)
 *   LeadsResponse   ← GET /api/leads         (leads.ts)
 *
 * The neighborhood view-model (neighborhood.ts) is assembled from these same
 * shapes for the scan right rail; it reuses DistressResult verbatim.
 */
export * from './distress';
export * from './comps';
export * from './parcel';
export * from './scan';
export * from './neighborhood';
export * from './leads';
