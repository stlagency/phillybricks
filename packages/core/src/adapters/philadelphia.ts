/**
 * Philadelphia CityAdapter (PRD §2.1, §4.2, §5.1; docs/DATA_SOURCES.md).
 *
 * THIS FILE IS THE ONLY PLACE PHILADELPHIA SOURCE LITERALS MAY LIVE.
 * Table names, endpoints, document_type vocabularies, geo-source URLs, the scraper
 * config, AND the per-source raw→canonical column-maps (`SourceMapping`) are all
 * Philly-specific and confined here behind the `CityAdapter` seam. A CI grep gate
 * fails the build if these literals appear outside `packages/core/src/adapters/`.
 * A second city is a new adapter, not a rewrite.
 *
 * All facts below are ground-truthed in docs/DATA_SOURCES.md + live introspection
 * (2026-06-18): exact source column names, PK choices, type hazards (text booleans),
 * and the OPA bulk `shape` column being `SRID=2272;POINT(...)` (PA State Plane →
 * transformed to 4326 on load). `expectedJoinRate` values are MEASURED in M1 against
 * the live `public.parcel` and overwrite the placeholders here.
 */
import type {
  CityAdapter,
  DocumentTypes,
  GeoSourceSpec,
  LensMetric,
  ScraperSpec,
  SourceMapping,
  SourceSpec,
} from '../contracts/index.js';
import { deriveTransferFlags } from '../transfers.js';
import {
  asDate,
  asIdText,
  asInt,
  asNumeric,
  asText,
  boolFromTrueFalse,
  boolFromYN,
  ewktGeom,
  geoJsonGeom,
} from '../ingest/mapping.js';

/** Carto SQL API base (fast, free, unauthenticated). */
const CARTO_SQL = 'https://phl.carto.com/api/v2/sql';

/** Nightly OPA bulk dump (public S3, ~303 MB CSV; geometry column `shape` is EWKT 2272). */
const OPA_S3_CSV = 'https://opendata-downloads.s3.amazonaws.com/opa_properties_public.csv';

/**
 * Carto page size, bounded by the ~10 MB Carto client buffer and ~30 s request
 * timeout (PRD §4.1). RTT backfill (5.1M) ≈ 510 pages at this size.
 */
const CARTO_PAGE = 10_000;

/**
 * Canonical parcel-key normalizer (PRD §3.1). MUST mirror the SQL `norm_parcel`
 * function exactly (fixture-tested for parity):
 *
 *   strip every non-digit → x
 *   length(x) === 9            → x as-is
 *   length(x) in 1..8          → left-pad to 9 with '0'
 *   length(x) > 9 OR empty     → null   (quarantine + count, never silent-pad)
 *
 * NEVER derived from L&I `parcel_id_num` (a decoy that is NOT an OPA id). A
 * >9-digit input is rejected precisely so a decoy value cannot be coerced into a
 * colliding 9-digit OPA account. The column-maps below ALWAYS normalize the real
 * OPA key column (opa_account_num / parcel_number / opa_number), never the decoy.
 */
function normParcelKey(raw: string | null | undefined): string | null {
  const x = (raw ?? '').replace(/\D/g, '');
  if (x.length === 9) return x;
  if (x.length >= 1 && x.length <= 8) return x.padStart(9, '0');
  return null; // >9 digits or empty/non-numeric
}

/**
 * Document-type vocabularies (PRD §5.1; literals verified live in Carto).
 * `estateNameRegex` is DERIVED from grantor/grantee free-text names, not read from
 * a column (recovers the "estate/quitclaim is not a document_type" correction).
 */
const SHERIFF_DOCS = ['DEED SHERIFF', "SHERIFF'S DEED"];

const documentTypes: DocumentTypes = {
  armsLength: ['DEED', 'DEED MISCELLANEOUS', 'MISCELLANEOUS DEED'],
  sheriff: SHERIFF_DOCS,
  distress: [
    ...SHERIFF_DOCS,
    'DEED OF CONDEMNATION',
    'DM - LIS PENDENS',
    'DEED LAND BANK',
    'DEED - ADVERSE POSSESSION',
  ],
  estateNameRegex: /ESTATE OF|EXECUT(OR|RIX)|ADMINISTRAT(OR|RIX)|TRUSTEE/i,
};

/** Consideration at or below this is "nominal" (e.g. $1 estate deeds). */
const NOMINAL_CONSIDERATION_FLOOR = 1000;

/** The subset deriveTransferFlags needs (avoids a forward ref to `philadelphia`). */
const transferVocab = { documentTypes, nominalConsiderationFloor: NOMINAL_CONSIDERATION_FLOOR };

/** True when an owner mailing state is present and not Pennsylvania (PRD §4.3). */
function outOfState(stateRaw: unknown): boolean {
  const s = asText(stateRaw);
  return s !== null && s.toUpperCase() !== 'PA';
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-source canonical mappings (raw column names verified live 2026-06-18).
// `mapRow` returns canonical {column → value}; the ingestion engine binds values
// as params and renders GeomMarkers as SQL. Returning null SKIPS a structurally
// unusable row (e.g. no stable id). The DECOY `parcel_id_num` is NEVER referenced.
// ─────────────────────────────────────────────────────────────────────────────

/** OPA spine → public.parcel. PK norm(parcel_number); geometry `shape` is EWKT 2272. */
const opaMapping: SourceMapping = {
  targetTable: 'public.parcel',
  targetColumns: [
    'parcel_pk', 'pin', 'is_active', 'retired_at', 'address', 'zip', 'geom',
    'market_value', 'sale_price', 'sale_date', 'year_built', 'beds', 'livable_area',
    'category_code', 'zoning', 'owner_1', 'owner_2', 'mailing_address',
    'mailing_city_state', 'state_code', 'is_out_of_state_owner', 'source_updated_at',
  ],
  conflictColumns: ['parcel_pk'],
  mapRow(raw) {
    const parcel_pk = normParcelKey(asText(raw.parcel_number));
    if (parcel_pk === null) return null; // a parcel with no usable OPA id cannot be the spine PK
    return {
      parcel_pk,
      pin: asIdText(raw.pin),
      // reactivate-on-reappear: upsert always restores active state (soft-retire is separate).
      is_active: true,
      retired_at: null,
      address: asText(raw.location),
      zip: asText(raw.zip_code),
      geom: ewktGeom(raw.shape),
      market_value: asNumeric(raw.market_value),
      sale_price: asNumeric(raw.sale_price),
      sale_date: asDate(raw.sale_date),
      year_built: asInt(raw.year_built),
      beds: asNumeric(raw.number_of_bedrooms),
      livable_area: asNumeric(raw.total_livable_area),
      category_code: asText(raw.category_code),
      zoning: asText(raw.zoning),
      owner_1: asText(raw.owner_1),
      owner_2: asText(raw.owner_2),
      mailing_address: asText(raw.mailing_street), // NB: mailing_address_1 is the entity name, not the street
      mailing_city_state: asText(raw.mailing_city_state),
      state_code: asText(raw.state_code),
      is_out_of_state_owner: outOfState(raw.state_code),
      source_updated_at: asDate(raw.recording_date),
    };
  },
};

/** RTT deeds → public.transfer. PK rtt:objectid (document_id is NOT unique). */
const rttMapping: SourceMapping = {
  targetTable: 'public.transfer',
  targetColumns: [
    'transfer_id', 'cartodb_id', 'parcel_pk', 'document_type', 'recording_date',
    'total_consideration', 'cash_consideration', 'fair_market_value', 'common_level_ratio',
    'grantors', 'grantees', 'is_sheriff', 'is_distress_doc', 'is_estate_or_nonmarket',
    'is_arms_length', 'price_to_assessment', 'source_updated_at',
  ],
  conflictColumns: ['transfer_id'],
  mapRow(raw) {
    const objectid = asText(raw.objectid);
    if (objectid === null) return null;
    const flags = deriveTransferFlags(
      {
        document_type: asText(raw.document_type),
        total_consideration: asNumeric(raw.total_consideration),
        fair_market_value: asNumeric(raw.fair_market_value),
        grantors: asText(raw.grantors),
        grantees: asText(raw.grantees),
      },
      transferVocab,
    );
    return {
      transfer_id: `rtt:${objectid}`,
      cartodb_id: asInt(raw.cartodb_id),
      parcel_pk: normParcelKey(asText(raw.opa_account_num)),
      document_type: asText(raw.document_type),
      recording_date: asDate(raw.recording_date),
      total_consideration: asNumeric(raw.total_consideration),
      cash_consideration: asNumeric(raw.cash_consideration),
      fair_market_value: asNumeric(raw.fair_market_value),
      common_level_ratio: asNumeric(raw.common_level_ratio),
      grantors: asText(raw.grantors),
      grantees: asText(raw.grantees),
      is_sheriff: flags.is_sheriff,
      is_distress_doc: flags.is_distress_doc,
      is_estate_or_nonmarket: flags.is_estate_or_nonmarket,
      is_arms_length: flags.is_arms_length,
      price_to_assessment: flags.price_to_assessment,
      source_updated_at: asDate(raw.recording_date),
    };
  },
};

/** L&I permits → public.permit. */
const permitMapping: SourceMapping = {
  targetTable: 'public.permit',
  targetColumns: [
    'permit_id', 'cartodb_id', 'parcel_pk', 'permit_type', 'permit_description',
    'status', 'permit_issued_date', 'source_updated_at',
  ],
  conflictColumns: ['permit_id'],
  mapRow(raw) {
    const permit_id = asText(raw.permitnumber);
    if (permit_id === null) return null;
    return {
      permit_id,
      cartodb_id: asInt(raw.cartodb_id),
      parcel_pk: normParcelKey(asText(raw.opa_account_num)),
      permit_type: asText(raw.permittype),
      permit_description: asText(raw.permitdescription),
      status: asText(raw.status),
      permit_issued_date: asDate(raw.permitissuedate),
      source_updated_at: asDate(raw.mostrecentinsp) ?? asDate(raw.permitissuedate),
    };
  },
};

/** L&I violations → public.violation. is_hazardous derived (no native flag). */
const violationMapping: SourceMapping = {
  targetTable: 'public.violation',
  targetColumns: [
    'violation_id', 'cartodb_id', 'parcel_pk', 'violation_code', 'violation_type',
    'status', 'is_hazardous', 'violation_date', 'source_updated_at',
  ],
  conflictColumns: ['violation_id'],
  mapRow(raw) {
    const violation_id = asText(raw.violationnumber);
    if (violation_id === null) return null;
    const prio = asText(raw.caseprioritydesc);
    const title = `${asText(raw.violationcodetitle) ?? ''} ${asText(raw.violationcode) ?? ''}`;
    const is_hazardous =
      (prio !== null && prio.toUpperCase() !== 'STANDARD') ||
      /UNSAFE|IMM|DANGER|FIRE|STRUCT|COLLAPSE/i.test(title);
    return {
      violation_id,
      cartodb_id: asInt(raw.cartodb_id),
      parcel_pk: normParcelKey(asText(raw.opa_account_num)),
      violation_code: asText(raw.violationcode),
      violation_type: asText(raw.violationcodetitle),
      status: asText(raw.violationstatus),
      is_hazardous,
      violation_date: asDate(raw.violationdate),
      source_updated_at: asDate(raw.mostrecentinvestigation) ?? asDate(raw.casecompleteddate),
    };
  },
};

/** L&I complaints → public.complaint. */
const complaintMapping: SourceMapping = {
  targetTable: 'public.complaint',
  targetColumns: [
    'complaint_id', 'cartodb_id', 'parcel_pk', 'complaint_type', 'status',
    'complaint_date', 'source_updated_at',
  ],
  conflictColumns: ['complaint_id'],
  mapRow(raw) {
    const complaint_id = asText(raw.complaintnumber);
    if (complaint_id === null) return null;
    return {
      complaint_id,
      cartodb_id: asInt(raw.cartodb_id),
      parcel_pk: normParcelKey(asText(raw.opa_account_num)),
      complaint_type: asText(raw.complaintcodename),
      status: asText(raw.complaintstatus),
      complaint_date: asDate(raw.complaintdate),
      source_updated_at: asDate(raw.complaintresolution_date) ?? asDate(raw.complaintdate),
    };
  },
};

/** L&I case investigations → public.case_investigation. PK investigationprocessid (casenumber is not unique). */
const caseInvestigationMapping: SourceMapping = {
  targetTable: 'public.case_investigation',
  targetColumns: [
    'case_id', 'cartodb_id', 'parcel_pk', 'case_type', 'status',
    'investigation_date', 'source_updated_at',
  ],
  conflictColumns: ['case_id'],
  mapRow(raw) {
    const case_id = asText(raw.investigationprocessid) ?? asText(raw.cartodb_id);
    if (case_id === null) return null;
    return {
      case_id,
      cartodb_id: asInt(raw.cartodb_id),
      parcel_pk: normParcelKey(asText(raw.opa_account_num)),
      case_type: asText(raw.casetype),
      status: asText(raw.investigationstatus),
      investigation_date: asDate(raw.investigationcompleted),
      source_updated_at: asDate(raw.investigationcompleted),
    };
  },
};

/** distress_inventory mapping factory for the unsafe/imm_dang/demolition kinds. */
function distressInventoryMapping(opts: {
  kind: string;
  idColumn: string;
  idPrefix: string;
  recordedColumn: string;
  freshnessColumn: string;
  statusFromColumn?: string;
}): SourceMapping {
  return {
    targetTable: 'public.distress_inventory',
    targetColumns: [
      'inventory_id', 'cartodb_id', 'parcel_pk', 'kind', 'status',
      'recorded_on', 'source_updated_at',
    ],
    conflictColumns: ['inventory_id'],
    mapRow(raw) {
      const id = asText(raw[opts.idColumn]);
      if (id === null) return null;
      const status = opts.statusFromColumn
        ? asText(raw[opts.statusFromColumn])
        : asText(raw.casecompleteddate) ?? asText(raw.violationresolutiondate)
          ? 'closed'
          : 'open';
      return {
        inventory_id: `${opts.idPrefix}:${id}`,
        cartodb_id: asInt(raw.cartodb_id),
        parcel_pk: normParcelKey(asText(raw.opa_account_num)),
        kind: opts.kind,
        status,
        recorded_on: asDate(raw[opts.recordedColumn]),
        source_updated_at: asDate(raw[opts.freshnessColumn]) ?? asDate(raw[opts.recordedColumn]),
      };
    },
  };
}

const unsafeMapping = distressInventoryMapping({
  kind: 'unsafe', idColumn: 'casenumber', idPrefix: 'unsafe',
  recordedColumn: 'casecreateddate', freshnessColumn: 'mostrecentinvestigation',
});
const immDangMapping = distressInventoryMapping({
  kind: 'imm_dang', idColumn: 'casenumber', idPrefix: 'imm_dang',
  recordedColumn: 'casecreateddate', freshnessColumn: 'mostrecentinvestigation',
});
const demolitionMapping = distressInventoryMapping({
  kind: 'demolition', idColumn: 'caseorpermitnumber', idPrefix: 'demo',
  recordedColumn: 'start_date', freshnessColumn: 'mostrecentinsp', statusFromColumn: 'status',
});

/** Tax delinquencies → public.tax_delinquency. Text booleans differ: is_actionable true/false, sheriff_sale Y/N. */
const taxDelinquencyMapping: SourceMapping = {
  targetTable: 'public.tax_delinquency',
  targetColumns: [
    'delinquency_pk', 'cartodb_id', 'parcel_pk', 'opa_number', 'total_due',
    'principal_due', 'interest_due', 'penalty_due', 'other_charges_due',
    'is_actionable', 'payment_agreement', 'sheriff_sale', 'num_years_delinquent',
    'most_recent_year_owed', 'oldest_year_owed', 'most_recent_payment_date',
    'total_assessment', 'address', 'zip', 'owner_1', 'owner_2', 'mailing_address',
    'mailing_state', 'is_out_of_state_owner', 'building_category', 'geom',
    'year_month', 'source_updated_at',
  ],
  conflictColumns: ['delinquency_pk'],
  mapRow(raw) {
    const opa = asText(raw.opa_number);
    if (opa === null) return null;
    const ym = asText(raw.year_month);
    const snapshotDate = ym && /^\d{6}$/.test(ym) ? `${ym.slice(0, 4)}-${ym.slice(4, 6)}-01` : null;
    return {
      delinquency_pk: `${opa}-${ym ?? 'na'}`,
      cartodb_id: asInt(raw.cartodb_id),
      parcel_pk: normParcelKey(opa),
      opa_number: opa,
      total_due: asNumeric(raw.total_due),
      principal_due: asNumeric(raw.principal_due),
      interest_due: asNumeric(raw.interest_due),
      penalty_due: asNumeric(raw.penalty_due),
      other_charges_due: asNumeric(raw.other_charges_due),
      is_actionable: boolFromTrueFalse(raw.is_actionable),
      payment_agreement: boolFromTrueFalse(raw.payment_agreement),
      sheriff_sale: boolFromYN(raw.sheriff_sale),
      num_years_delinquent: asInt(raw.num_years_owed),
      most_recent_year_owed: asInt(raw.most_recent_year_owed),
      oldest_year_owed: asInt(raw.oldest_year_owed),
      most_recent_payment_date: asDate(raw.most_recent_payment_date),
      total_assessment: asNumeric(raw.total_assessment),
      address: asText(raw.street_address),
      zip: asText(raw.zip_code),
      owner_1: asText(raw.owner),
      owner_2: asText(raw.co_owner),
      mailing_address: asText(raw.mailing_address),
      mailing_state: asText(raw.mailing_state),
      is_out_of_state_owner: outOfState(raw.mailing_state),
      building_category: asText(raw.building_category),
      geom: geoJsonGeom(raw.geom_geojson),
      year_month: ym,
      source_updated_at: snapshotDate,
    };
  },
};

/** Tax balances → public.tax_balance. PK parcel+period+lien (idempotent across reloads). */
const taxBalanceMapping: SourceMapping = {
  targetTable: 'public.tax_balance',
  targetColumns: [
    'balance_id', 'cartodb_id', 'parcel_pk', 'tax_period', 'principal', 'interest',
    'penalty', 'other', 'total', 'owner', 'location', 'unit', 'lien_number', 'source_updated_at',
  ],
  conflictColumns: ['balance_id'],
  mapRow(raw) {
    const pn = asText(raw.parcel_number);
    if (pn === null) return null;
    const tp = asText(raw.tax_period);
    const lien = asText(raw.lien_number);
    return {
      balance_id: `${pn}-${tp ?? 'na'}-${lien ?? '0'}`,
      cartodb_id: asInt(raw.cartodb_id),
      parcel_pk: normParcelKey(pn),
      tax_period: asInt(raw.tax_period),
      principal: asNumeric(raw.principal),
      interest: asNumeric(raw.interest),
      penalty: asNumeric(raw.penalty),
      other: asNumeric(raw.other),
      total: asNumeric(raw.total),
      owner: asText(raw.owner),
      location: asText(raw.location),
      unit: asText(raw.unit),
      lien_number: lien,
      source_updated_at: null, // no source timestamp; stamped via ingested_at default
    };
  },
};

/** Business licenses → public.business_license. is_rental from licensetype. parcel_pk often null (non-addressed). */
const businessLicenseMapping: SourceMapping = {
  targetTable: 'public.business_license',
  targetColumns: [
    'license_id', 'cartodb_id', 'parcel_pk', 'licensetype', 'license_status',
    'business_name', 'rental_category', 'number_of_units', 'owner_occupied', 'opa_owner',
    'address', 'zip', 'business_mailing_address', 'issue_date', 'most_recent_issue_date',
    'expire_date', 'inactive_date', 'is_rental', 'source_updated_at',
  ],
  conflictColumns: ['license_id'],
  mapRow(raw) {
    const license_id = asText(raw.licensenum);
    if (license_id === null) return null;
    const licensetype = asText(raw.licensetype);
    return {
      license_id,
      cartodb_id: asInt(raw.cartodb_id),
      parcel_pk: normParcelKey(asText(raw.opa_account_num)),
      licensetype,
      license_status: asText(raw.licensestatus),
      business_name: asText(raw.business_name),
      rental_category: asText(raw.rentalcategory),
      number_of_units: asNumeric(raw.numberofunits),
      owner_occupied: asText(raw.owneroccupied),
      opa_owner: asText(raw.opa_owner),
      address: asText(raw.address),
      zip: asText(raw.zip),
      business_mailing_address: asText(raw.business_mailing_address),
      issue_date: asDate(raw.initialissuedate),
      most_recent_issue_date: asDate(raw.mostrecentissuedate),
      expire_date: asDate(raw.expirationdate),
      inactive_date: asDate(raw.inactivedate),
      is_rental: (licensetype ?? '').toLowerCase() === 'rental',
      source_updated_at: asDate(raw.mostrecentissuedate) ?? asDate(raw.initialissuedate),
    };
  },
};

/** Crime → public.crime_incident (SPATIAL). PK dc_key. geom from Carto GeoJSON. */
const crimeMapping: SourceMapping = {
  targetTable: 'public.crime_incident',
  targetColumns: ['incident_id', 'cartodb_id', 'geom', 'occurred_on', 'category'],
  conflictColumns: ['incident_id'],
  mapRow(raw) {
    const incident_id = asText(raw.dc_key);
    if (incident_id === null) return null;
    return {
      incident_id,
      cartodb_id: asInt(raw.cartodb_id),
      geom: geoJsonGeom(raw.geom_geojson),
      occurred_on: asDate(raw.dispatch_date_time),
      category: asText(raw.text_general_code),
    };
  },
};

/** 311 → public.service_request (SPATIAL). PK service_request_id. */
const serviceRequestMapping: SourceMapping = {
  targetTable: 'public.service_request',
  targetColumns: ['request_id', 'cartodb_id', 'geom', 'occurred_on', 'category', 'status'],
  conflictColumns: ['request_id'],
  mapRow(raw) {
    const request_id = asText(raw.service_request_id);
    if (request_id === null) return null;
    return {
      request_id,
      cartodb_id: asInt(raw.cartodb_id),
      geom: geoJsonGeom(raw.geom_geojson),
      occurred_on: asDate(raw.requested_datetime),
      category: asText(raw.service_name),
      status: asText(raw.status),
    };
  },
};

/**
 * Source adapters (PRD §4.2). `keyColumns` are CANDIDATE parcel-key columns to
 * normalize and try, in priority order — the join is empirical (PRD §3.1).
 * Carto sources paginate by keyset on `cartodb_id`. Spatial sources (crime/311)
 * AND the OPA spine leave `expectedJoinRate` undefined: spatial sources validate
 * by geometry; OPA DEFINES the parcel universe, so a parcel-self-join gate is
 * meaningless (it would read 0% on the very first load) — OPA's integrity gate is
 * the freshness gate (Last-Modified + row-count ±5%) enforced in its fetcher.
 */
const sources: SourceSpec[] = [
  {
    // 583,617 parcels; key parcel_number; also ingest pin. Bulk CSV (geometry = `shape`, EWKT 2272).
    name: 'opa_properties_public',
    platform: 's3',
    endpoint: OPA_S3_CSV,
    keyColumns: ['parcel_number', 'pin'],
    geometryMode: 'wkt',
    cadence: 'nightly',
    // Spine — EXEMPT from the parcel-join gate (defines parcels); freshness-gated instead.
    expectedJoinRate: undefined,
    targetTable: 'public.parcel',
    mapping: opaMapping,
    notes:
      'Bulk CSV; freshness gate = row count within ±5% of ~583,617 AND S3 Last-Modified newer than last run. Soft-retire missing accounts. Diff → parcel_change_log. Geometry column is `shape` = SRID=2272;POINT (transformed to 4326 on load).',
  },
  {
    name: 'rtt_summary',
    platform: 'carto',
    endpoint: CARTO_SQL,
    keyColumns: ['opa_account_num', 'pin'],
    cursorColumn: 'cartodb_id',
    incrementalColumn: 'cartodb_id',
    geometryMode: 'none',
    cadence: 'nightly',
    pageSize: CARTO_PAGE,
    // MEASURED 2026-06-18: the OLDEST keyset slice (1974-era deeds) joins ~0.505 to
    // current OPA (those parcels are long gone); recent deeds run ~95%+. Floor LOW so
    // the backfill's historic slices are not quarantined — the count reconcile (±0.5%)
    // is the real integrity check for RTT, not the per-batch join gate.
    expectedJoinRate: 0.45,
    targetTable: 'public.transfer',
    mapping: rttMapping,
    notes:
      'Comps spine. One-time backfill to 1974 (resumable). Derive transfer flags on load. transfer_id = rtt:objectid (document_id spans many parcels). ~7-week source lag is normal.',
  },
  {
    name: 'permits',
    platform: 'carto',
    endpoint: CARTO_SQL,
    keyColumns: ['opa_account_num', 'parcel_number'],
    cursorColumn: 'cartodb_id',
    incrementalColumn: 'cartodb_id',
    geometryMode: 'none',
    cadence: 'nightly',
    expectedJoinRate: 0.85, // MEASURED 2026-06-18 vs live public.parcel: 0.927 (opa_account_num); floored
    targetTable: 'public.permit',
    mapping: permitMapping,
    notes: '923K rows. Never join on L&I parcel_id_num (decoy). PK permitnumber.',
  },
  {
    name: 'violations',
    platform: 'carto',
    endpoint: CARTO_SQL,
    keyColumns: ['opa_account_num', 'parcel_number'],
    cursorColumn: 'cartodb_id',
    incrementalColumn: 'cartodb_id',
    geometryMode: 'none',
    cadence: 'nightly',
    expectedJoinRate: 0.9, // MEASURED 2026-06-18 vs live public.parcel: 0.977 (opa_account_num); floored
    targetTable: 'public.violation',
    mapping: violationMapping,
    notes: '1.99M rows. PK violationnumber. is_hazardous derived from caseprioritydesc + code keywords.',
  },
  {
    name: 'complaints',
    platform: 'carto',
    endpoint: CARTO_SQL,
    keyColumns: ['opa_account_num', 'parcel_number'],
    cursorColumn: 'cartodb_id',
    incrementalColumn: 'cartodb_id',
    geometryMode: 'none',
    cadence: 'nightly',
    expectedJoinRate: 0.9, // MEASURED 2026-06-18 vs live public.parcel: 0.972 (opa_account_num); floored
    targetTable: 'public.complaint',
    mapping: complaintMapping,
    notes: '1.03M rows. PK complaintnumber.',
  },
  {
    name: 'case_investigations',
    platform: 'carto',
    endpoint: CARTO_SQL,
    keyColumns: ['opa_account_num', 'parcel_number'],
    cursorColumn: 'cartodb_id',
    incrementalColumn: 'cartodb_id',
    geometryMode: 'none',
    cadence: 'nightly',
    expectedJoinRate: 0.9, // MEASURED 2026-06-18 vs live public.parcel: 0.982 (opa_account_num); floored
    targetTable: 'public.case_investigation',
    mapping: caseInvestigationMapping,
    notes: '2.07M rows. PK investigationprocessid (casenumber not unique).',
  },
  {
    name: 'unsafe',
    platform: 'carto',
    endpoint: CARTO_SQL,
    keyColumns: ['opa_account_num', 'parcel_number'],
    cursorColumn: 'cartodb_id',
    geometryMode: 'none',
    cadence: 'nightly',
    expectedJoinRate: 0.9, // MEASURED 2026-06-18 vs live public.parcel: 0.996 (opa_account_num); floored
    targetTable: 'public.distress_inventory',
    mapping: unsafeMapping,
    notes: '3,130 rows (Carto full, tiny). → distress_inventory kind=unsafe.',
  },
  {
    name: 'imm_dang',
    platform: 'carto',
    endpoint: CARTO_SQL,
    keyColumns: ['opa_account_num', 'parcel_number'],
    cursorColumn: 'cartodb_id',
    geometryMode: 'none',
    cadence: 'nightly',
    expectedJoinRate: 0.9, // MEASURED 2026-06-18 vs live public.parcel: 0.992 (opa_account_num); floored
    targetTable: 'public.distress_inventory',
    mapping: immDangMapping,
    notes: '132 rows (Carto full, tiny). → distress_inventory kind=imm_dang.',
  },
  {
    name: 'demolitions',
    platform: 'carto',
    endpoint: CARTO_SQL,
    keyColumns: ['opa_account_num', 'parcel_number'],
    cursorColumn: 'cartodb_id',
    geometryMode: 'none',
    cadence: 'nightly',
    expectedJoinRate: 0.75, // MEASURED 2026-06-18 vs live public.parcel: 0.867 (older demos, parcels gone); floored
    targetTable: 'public.distress_inventory',
    mapping: demolitionMapping,
    notes: '14,187 rows (Carto full). → distress_inventory kind=demolition.',
  },
  {
    name: 'real_estate_tax_delinquencies',
    platform: 'carto',
    endpoint: CARTO_SQL,
    keyColumns: ['opa_number', 'parcel_number'],
    cursorColumn: 'cartodb_id',
    geometryMode: 'geojson',
    cadence: 'nightly',
    expectedJoinRate: 0.88, // MEASURED 2026-06-18 vs live public.parcel: 0.954 (opa_number); floored
    targetTable: 'public.tax_delinquency',
    mapping: taxDelinquencyMapping,
    notes:
      'Carto full (54K), current monthly snapshot. Diff → delinquency_event. Text booleans: is_actionable/payment_agreement true/false, sheriff_sale Y/N.',
  },
  {
    name: 'real_estate_tax_balances',
    platform: 'carto',
    endpoint: CARTO_SQL,
    keyColumns: ['parcel_number'],
    cursorColumn: 'cartodb_id',
    geometryMode: 'none',
    cadence: 'nightly',
    expectedJoinRate: 0.88, // MEASURED 2026-06-18 vs live public.parcel: 0.949 (parcel_number); floored
    targetTable: 'public.tax_balance',
    mapping: taxBalanceMapping,
    notes: 'Carto full (684K). One row per (parcel, tax_period). lien_number = distress signal.',
  },
  {
    name: 'incidents_part1_part2',
    platform: 'carto',
    endpoint: CARTO_SQL,
    keyColumns: [], // spatial — no parcel key; geo ids stamped via point-in-polygon
    cursorColumn: 'cartodb_id',
    incrementalColumn: 'cartodb_id',
    geometryMode: 'geojson',
    cadence: 'nightly',
    expectedJoinRate: undefined, // spatial ⇒ exempt from parcel-join gate
    targetTable: 'public.crime_incident',
    mapping: crimeMapping,
    windowPredicate: "dispatch_date_time >= (now() - interval '10 years') AND the_geom IS NOT NULL",
    notes: 'Crime. Windowed ~10y; geo ids stamped later. PK dc_key. Validate geom not-null instead of parcel join.',
  },
  {
    name: 'public_cases_fc',
    platform: 'carto',
    endpoint: CARTO_SQL,
    keyColumns: [], // spatial — no parcel key
    cursorColumn: 'cartodb_id',
    incrementalColumn: 'cartodb_id',
    geometryMode: 'geojson',
    cadence: 'nightly',
    expectedJoinRate: undefined, // spatial ⇒ exempt from parcel-join gate
    targetTable: 'public.service_request',
    mapping: serviceRequestMapping,
    windowPredicate:
      "requested_datetime >= (now() - interval '10 years') AND service_name NOT IN ('Information Request') AND the_geom IS NOT NULL",
    notes: "311. Windowed ~10y; 'Information Request' noise filtered; geo ids stamped later. PK service_request_id.",
  },
  {
    name: 'business_licenses',
    platform: 'carto',
    endpoint: CARTO_SQL,
    keyColumns: ['opa_account_num', 'parcel_number'],
    cursorColumn: 'cartodb_id',
    geometryMode: 'none',
    cadence: 'weekly',
    expectedJoinRate: 0.72, // MEASURED 2026-06-18 vs live public.parcel: 0.828 (many non-addressed → null pk); floored
    targetTable: 'public.business_license',
    mapping: businessLicenseMapping,
    notes: '431K rows (Carto full, weekly). PK licensenum. is_rental = licensetype Rental. parcel_pk often null (non-addressed).',
  },
];

/**
 * One-time geographic boundary sources (PRD §4.2; URLs per PRD §2/§4).
 * Azavea neighborhoods (GitHub GeoJSON), ZIP codes, and census tracts.
 */
const geoSources: GeoSourceSpec[] = [
  {
    kind: 'neighborhood',
    url: 'https://raw.githubusercontent.com/opendataphilly/open-geo-data/master/philadelphia-neighborhoods/philadelphia-neighborhoods.geojson',
    idField: 'name',
    nameField: 'name',
  },
  {
    kind: 'zip',
    url: 'https://opendata.arcgis.com/datasets/b54ec5210cee41c3a884c9086f7af1be_0.geojson',
    idField: 'CODE',
    nameField: 'CODE',
  },
  {
    kind: 'tract',
    url: 'https://opendata.arcgis.com/datasets/8bc0786524a4486bb3cf0f9862ad0fbf_0.geojson',
    idField: 'GEOID10',
    nameField: 'NAMELSAD10',
  },
];

/**
 * Sheriff-sale scraper (PRD §4.2; not in open data). VERIFIED live 2026-06-18:
 * server-rendered Ninja Tables, ALL rows in the HTML (mortgage ≈909, foreclosure ≈667),
 * positional `<td>` cells with NO data-* keys → the column-order assertion is the
 * only safety net (M2 gate). Use the NON-www host (www 301-redirects). robots.txt
 * allows these paths with Crawl-delay: 10.
 *
 * `sale_type` (core 'mortgage' | 'tax') is DERIVED from WHICH PAGE, not the SaleType
 * column: the mortgage page is all 'MORTGAGE FORECLOSURE'; the foreclosure page is tax
 * sales whose SaleType varies (Linebarger / GRB / TAX COLLECTION… / TAX LIEN…), preserved
 * raw in `source_sale_type`. `SaleStatus` ∈ {Preview, Postponed} → `sale_status` core vocab.
 * `AssessmentID` is a clean 9-digit OPA → parcel_pk join. No Plaintiff/Defendant columns
 * exist (those + opening_bid/judgment come only from Bid4Assets enrichment, OFF by default).
 * NOTE: each page renders TWO theads (a clone/sticky header) — assert against the first.
 */
const scraper: ScraperSpec = {
  urls: ['https://phillysheriff.com/mortgage/', 'https://phillysheriff.com/foreclosure/'],
  expectedColumns: ['ID', 'BooknWrit', 'AssessmentID', 'Street', 'SaleType', 'SaleStatus', 'SaleDate'],
  crawlDelaySec: 10,
};

/**
 * Per-lens SQL that colors a geo unit from `public.geo_metric` (PRD §2.1, §7.1).
 */
const lensMetricSql: Record<LensMetric, string> = {
  price: `SELECT value FROM public.geo_metric
WHERE geo_type = :geo_type AND geo_id = :geo_id AND period = :period
  AND metric = 'median_price_per_sqft'`,
  momentum: `SELECT value FROM public.geo_metric
WHERE geo_type = :geo_type AND geo_id = :geo_id AND period = :period
  AND metric = 'permit_count'`,
  distress: `SELECT value FROM public.geo_metric
WHERE geo_type = :geo_type AND geo_id = :geo_id AND period = :period
  AND metric = 'distress_share'`,
  livability: `SELECT value FROM public.geo_metric
WHERE geo_type = :geo_type AND geo_id = :geo_id AND period = :period
  AND metric = 'livability_index'`,
};

/**
 * The Philadelphia adapter. Imported everywhere a city-specific literal would
 * otherwise be needed; nothing here leaks outside the adapter seam.
 */
export const philadelphia: CityAdapter = {
  city: 'philadelphia',
  sources,
  normParcelKey,
  documentTypes,
  nominalConsiderationFloor: NOMINAL_CONSIDERATION_FLOOR,
  geoSources,
  scraper,
  lensMetricSql,
};
