/**
 * Mock scan fixtures — `ScanResponse` shaped EXACTLY like
 * @bandbox/core/contracts (PRD §6, GET /api/scan?geo=&lens=&period=).
 *
 * Typed mock data for the Market Scan surface only. In production each lens's
 * response arrives from `GET /api/scan` (one call per active lens/period); the
 * BlueprintMap colors the active geo unit's `bucket` (0..4) on the lens ramp.
 *
 * The 12 neighborhoods + their polygon points are ported verbatim from the
 * market-scan mockup SVG (Point Breeze is the active parcel). Geometry here is
 * the mockup's stylized blueprint layout, NOT real coordinates — production
 * polygons come from `public.geo_boundary` via PMTiles.
 */
import type { LensMetric, ScanResponse, ScanFeature, GeoType } from '@bandbox/core/contracts';

/** Blueprint polygon geometry for the SVG choropleth (from the mockup). */
export interface HoodShape {
  geo_id: string;
  name: string;
  /** Short label as drawn on the blueprint. */
  mapLabel: string;
  /** SVG polygon points (viewBox 0 0 760 560). */
  points: string;
  /** Label anchor (x, y) in viewBox units. */
  labelXY: [number, number];
  /** Per-lens quantile bucket 0..4 (matches the mockup data-* attributes). */
  buckets: Record<LensMetric, number>;
  /** True for the active/selected unit (Point Breeze). */
  active?: boolean;
}

export const HOODS: HoodShape[] = [
  {
    geo_id: 'germantown',
    name: 'Germantown',
    mapLabel: 'GERMANTOWN',
    points: '250,30 360,26 372,96 300,118 244,92',
    labelXY: [305, 74],
    buckets: { distress: 2, price: 2, momentum: 1, livability: 2 },
  },
  {
    geo_id: 'brewerytown',
    name: 'Brewerytown',
    mapLabel: 'BREWERYTOWN',
    points: '200,120 296,116 312,178 232,200 196,160',
    labelXY: [252, 162],
    buckets: { distress: 3, price: 2, momentum: 3, livability: 1 },
  },
  {
    geo_id: 'strawberry-mansion',
    name: 'Strawberry Mansion',
    mapLabel: 'STRAWBERRY M.',
    points: '300,118 372,96 416,150 372,196 312,178',
    labelXY: [360, 150],
    buckets: { distress: 4, price: 1, momentum: 2, livability: 1 },
  },
  {
    geo_id: 'kensington',
    name: 'Kensington',
    mapLabel: 'KENSINGTON',
    points: '416,150 520,128 560,196 484,236 420,204',
    labelXY: [486, 186],
    buckets: { distress: 4, price: 1, momentum: 3, livability: 0 },
  },
  {
    geo_id: 'fishtown',
    name: 'Fishtown',
    mapLabel: 'FISHTOWN',
    points: '484,236 560,196 612,250 556,300 496,278',
    labelXY: [548, 252],
    buckets: { distress: 2, price: 3, momentum: 4, livability: 3 },
  },
  {
    geo_id: 'northern-liberties',
    name: 'Northern Liberties',
    mapLabel: 'N. LIBERTIES',
    points: '420,204 484,236 496,278 440,300 396,256',
    labelXY: [445, 262],
    buckets: { distress: 1, price: 4, momentum: 3, livability: 4 },
  },
  {
    geo_id: 'brewerytown-s',
    name: 'Brewerytown S.',
    mapLabel: 'BREWERYTOWN S.',
    points: '232,200 312,178 372,196 360,260 268,272',
    labelXY: [318, 226],
    buckets: { distress: 3, price: 2, momentum: 2, livability: 2 },
  },
  {
    geo_id: 'fairmount',
    name: 'Fairmount',
    mapLabel: 'FAIRMOUNT',
    points: '268,272 360,260 396,256 440,300 372,340 296,322',
    labelXY: [346, 300],
    buckets: { distress: 1, price: 4, momentum: 2, livability: 4 },
  },
  {
    geo_id: 'old-city',
    name: 'Old City',
    mapLabel: 'OLD CITY',
    points: '440,300 556,300 540,358 460,360',
    labelXY: [498, 332],
    buckets: { distress: 1, price: 4, momentum: 2, livability: 3 },
  },
  {
    geo_id: 'grays-ferry',
    name: 'Grays Ferry',
    mapLabel: 'GRAYS FERRY',
    points: '220,360 320,344 360,400 300,452 224,432',
    labelXY: [272, 404],
    buckets: { distress: 3, price: 2, momentum: 3, livability: 1 },
  },
  {
    geo_id: 'point-breeze',
    name: 'Point Breeze',
    mapLabel: 'POINT BREEZE',
    points: '320,344 444,346 472,420 388,460 360,400',
    labelXY: [392, 408],
    buckets: { distress: 4, price: 3, momentum: 4, livability: 2 },
    active: true,
  },
  {
    geo_id: 'passyunk-square',
    name: 'Passyunk Square',
    mapLabel: 'PASSYUNK SQ.',
    points: '444,346 552,352 560,430 472,460 472,420',
    labelXY: [510, 408],
    buckets: { distress: 2, price: 3, momentum: 3, livability: 4 },
  },
];

/** Per-lens legend copy + tick labels (from the mockup `lenses` object). */
export const LENS_META: Record<
  LensMetric,
  {
    head: string;
    cap: string;
    min: string;
    mid: string;
    max: string;
    unit: string;
    metric_class: ScanResponse['metric_class'];
  }
> = {
  price: {
    head: 'Price & value · active lens',
    cap: 'Lighter blue = cheaper per square foot; the deepest blue blocks are where the dollars already moved.',
    min: '$120/SF',
    mid: 'median $235/SF',
    max: '$540/SF',
    unit: '$/SF',
    metric_class: 'a_backfillable',
  },
  momentum: {
    head: 'Development momentum · active lens',
    cap: 'Greener = more active permits and finished rehabs. This is recovery moving, block by block.',
    min: '2 permits',
    mid: 'median 28',
    max: '140+ permits',
    unit: 'permits',
    metric_class: 'a_backfillable',
  },
  distress: {
    head: 'Distress & risk · active lens',
    cap: 'Darker red = more distress signals stacked on the block. Vacancy, tax liens and L&I cases compound here.',
    min: '0 signals',
    mid: 'median 2.4',
    max: '6+ signals',
    unit: 'signals',
    metric_class: 'b_forward_accruing',
  },
  livability: {
    head: 'Livability · active lens',
    cap: 'Warmer terracotta = calmer streets — fewer crime reports and faster 311 closeouts. A separate read from the red.',
    min: 'low',
    mid: 'median',
    max: 'high',
    unit: 'index',
    metric_class: 'a_backfillable',
  },
};

/** Sequential 5-stop ramps per lens, light + dark (from the mockup `ramp()`). */
export const LENS_RAMPS: Record<LensMetric, { light: string[]; dark: string[] }> = {
  distress: {
    light: ['#F3D8D5', '#E89C95', '#DD5A52', '#E81828', '#B11220'],
    dark: ['#3A2522', '#7A2C2C', '#B5323A', '#E03340', '#FF3A47'],
  },
  price: {
    light: ['#DCE8F6', '#A9CBEE', '#6FA8DC', '#3F86CD', '#0A2A5E'],
    dark: ['#22303F', '#2E4C70', '#3C6CA0', '#4C86C6', '#5C97D8'],
  },
  momentum: {
    light: ['#DCE8DE', '#A9CDB2', '#6FA585', '#3E7D5A', '#1F5238'],
    dark: ['#243329', '#33503C', '#3F6C50', '#4F8C66', '#5FA77E'],
  },
  livability: {
    light: ['#EFE2D2', '#DCC09B', '#C99A66', '#B5703A', '#8A4E22'],
    dark: ['#34291E', '#5A442C', '#86603A', '#B07E45', '#D69A4E'],
  },
};

const GEO_TYPE: GeoType = 'neighborhood';

/** Build a contract-shaped ScanResponse for one lens + period. */
export function buildScanResponse(
  lens: LensMetric,
  period = '2026 Q2',
): ScanResponse {
  const features: ScanFeature[] = HOODS.map((h) => ({
    geo_id: h.geo_id,
    geo_type: GEO_TYPE,
    name: h.name,
    // a believable display value derived from the bucket (mock only)
    value: h.buckets[lens],
    bucket: h.buckets[lens],
  }));
  const meta = LENS_META[lens];
  return {
    geo_type: GEO_TYPE,
    lens,
    period,
    features,
    period_min: '2018 Q1',
    period_max: '2026 Q2',
    periods: ['2018 Q1', '2020 Q1', '2022 Q1', '2024 Q1', '2026 Q2'],
    metric_class: meta.metric_class,
    legend: { min: 0, median: 2, max: 4, unit: meta.unit },
  };
}

/** All four lens responses keyed by lens (what /api/scan returns per call). */
export const scanByLens: Record<LensMetric, ScanResponse> = {
  price: buildScanResponse('price'),
  momentum: buildScanResponse('momentum'),
  distress: buildScanResponse('distress'),
  livability: buildScanResponse('livability'),
};
