/**
 * Ingestion column-map tests (PRD §3.1, §4.2): coercion + geometry-marker
 * primitives, and the per-source mappings in the Philadelphia adapter.
 *
 * ADVERSARIAL INVARIANT (the parcel-key hazard, PRD §3.1): parcel_pk is NEVER
 * derived from the L&I decoy `parcel_id_num`. A row whose real OPA key is garbage
 * but whose decoy is a clean 9-digit number must map to parcel_pk = NULL — the
 * decoy must not leak into the key path.
 */
import { describe, it, expect } from 'vitest';
import { philadelphia } from '../src/adapters/philadelphia.js';
import {
  asNumeric,
  asInt,
  asText,
  boolFromTrueFalse,
  boolFromYN,
  ewktGeom,
  geoJsonGeom,
  isGeomMarker,
} from '../src/ingest/mapping.js';
import type { SourceMapping } from '../src/contracts/index.js';

const mapping = (name: string): SourceMapping => {
  const s = philadelphia.sources.find((x) => x.name === name);
  if (!s?.mapping) throw new Error(`no mapping for ${name}`);
  return s.mapping;
};

describe('coercions', () => {
  it('asText trims and nulls empties', () => {
    expect(asText('  x ')).toBe('x');
    expect(asText('')).toBeNull();
    expect(asText('   ')).toBeNull();
    expect(asText(null)).toBeNull();
  });
  it('asNumeric strips $ and commas', () => {
    expect(asNumeric('$1,234.50')).toBe(1234.5);
    expect(asNumeric('')).toBeNull();
    expect(asNumeric('abc')).toBeNull();
    expect(asNumeric(212900)).toBe(212900);
  });
  it('asInt truncates', () => {
    expect(asInt('1940')).toBe(1940);
    expect(asInt('3.9')).toBe(3);
    expect(asInt('')).toBeNull();
  });
  it('text-boolean parsers use distinct encodings', () => {
    expect(boolFromTrueFalse('true')).toBe(true);
    expect(boolFromTrueFalse('TRUE')).toBe(true);
    expect(boolFromTrueFalse('false')).toBe(false);
    expect(boolFromTrueFalse('Y')).toBe(false); // not a true/false column
    expect(boolFromYN('Y')).toBe(true);
    expect(boolFromYN('y')).toBe(true);
    expect(boolFromYN('N')).toBe(false);
    expect(boolFromYN('true')).toBe(false); // not a Y/N column
  });
});

describe('geometry markers', () => {
  it('ewkt marker carries SRID for transform', () => {
    const m = ewktGeom('SRID=2272;POINT(2716538 255619)');
    expect(isGeomMarker(m)).toBe(true);
    expect(m).toEqual({ __geom: 'ewkt', value: 'SRID=2272;POINT(2716538 255619)' });
  });
  it('empty geometry → null value', () => {
    expect(ewktGeom('').value).toBeNull();
    expect(geoJsonGeom('   ').value).toBeNull();
    expect(geoJsonGeom(null).value).toBeNull();
  });
});

describe('OPA spine mapping', () => {
  const m = mapping('opa_properties_public');
  const raw = {
    parcel_number: '231061100',
    pin: 1001416885,
    location: '4514 PEARCE ST',
    zip_code: '19124',
    shape: 'SRID=2272;POINT(2716538.36 255619.72)',
    market_value: '212900.00',
    sale_price: '287500.00',
    sale_date: '2026-04-23 00:00:00-04:00',
    year_built: '1940',
    number_of_bedrooms: 4,
    total_livable_area: '1600',
    category_code: '1',
    zoning: 'RSA5',
    owner_1: 'BOZARTH TARA',
    owner_2: 'FIGUEROA BETSY',
    mailing_street: '4514 PEARCE ST',
    mailing_address_1: 'SIMPLIFILE LC E-RECORDING', // misleading — must NOT be the mailing_address
    mailing_city_state: 'PHILADELPHIA PA',
    state_code: 'PA',
    recording_date: '2026-04-27 00:00:00-04:00',
  };

  it('maps the real OPA key, pin as text, geom as EWKT marker', () => {
    const row = m.mapRow(raw)!;
    expect(row.parcel_pk).toBe('231061100');
    expect(row.pin).toBe('1001416885');
    expect(row.mailing_address).toBe('4514 PEARCE ST'); // mailing_street, not mailing_address_1
    expect(row.year_built).toBe(1940);
    expect(isGeomMarker(row.geom)).toBe(true);
    expect((row.geom as { __geom: string }).__geom).toBe('ewkt');
    expect(row.is_active).toBe(true);
    expect(row.retired_at).toBeNull();
  });

  it('derives is_out_of_state_owner from state_code', () => {
    expect(m.mapRow(raw)!.is_out_of_state_owner).toBe(false); // PA
    expect(m.mapRow({ ...raw, state_code: 'NJ' })!.is_out_of_state_owner).toBe(true);
    expect(m.mapRow({ ...raw, state_code: '' })!.is_out_of_state_owner).toBe(false); // null → in-state
  });

  it('zero-pads a short parcel_number and rejects a >9-digit value', () => {
    expect(m.mapRow({ ...raw, parcel_number: '57127275' })!.parcel_pk).toBe('057127275');
    expect(m.mapRow({ ...raw, parcel_number: '1234567890' })).toBeNull(); // >9 → unusable spine PK
  });
});

describe('RTT transfer mapping', () => {
  const m = mapping('rtt_summary');
  it('keys on rtt:objectid (NOT document_id, which spans many parcels)', () => {
    const row = m.mapRow({
      objectid: 12345,
      document_id: 2999998, // shared across 72 parcels in the live data
      cartodb_id: 999,
      opa_account_num: '481352600',
      document_type: 'DEED',
      total_consideration: 300000,
      fair_market_value: 250000,
      recording_date: '2025-01-02',
      grantors: 'SMITH JOHN',
      grantees: 'DOE JANE',
    })!;
    expect(row.transfer_id).toBe('rtt:12345');
    expect(row.parcel_pk).toBe('481352600');
    expect(row.is_arms_length).toBe(true);
  });
  it('derives the sheriff flag from document_type', () => {
    const row = m.mapRow({
      objectid: 1, opa_account_num: '481352600', document_type: 'DEED SHERIFF',
      total_consideration: 1, recording_date: '2025-01-02',
    })!;
    expect(row.is_sheriff).toBe(true);
    expect(row.is_arms_length).toBe(false);
  });
  it('skips a row with no stable objectid', () => {
    expect(m.mapRow({ opa_account_num: '481352600', document_type: 'DEED' })).toBeNull();
  });
});

describe('ADVERSARIAL: the L&I decoy parcel_id_num is never a key path', () => {
  for (const name of ['permits', 'violations', 'complaints', 'case_investigations', 'business_licenses']) {
    it(`${name}: garbage opa_account_num + clean 9-digit decoy → parcel_pk NULL`, () => {
      const m = mapping(name);
      // a real source row carries the decoy as a clean 9-digit number; the REAL key is garbage.
      const base: Record<string, unknown> = {
        cartodb_id: 1,
        permitnumber: 'MP-1', violationnumber: 'V-1', complaintnumber: 'C-1',
        investigationprocessid: 'I-1', licensenum: 'L-1',
        opa_account_num: 'NOT-AN-OPA-ID',
        parcel_id_num: '123456789', // the DECOY — a clean 9-digit number that must be IGNORED
        licensetype: 'Rental',
      };
      const row = m.mapRow(base)!;
      expect(row).not.toBeNull();
      // parcel_pk must be NULL (garbage real key), NEVER the decoy 123456789.
      expect(row.parcel_pk).toBeNull();
    });
    it(`${name}: maps the REAL opa_account_num when valid`, () => {
      const m = mapping(name);
      const row = m.mapRow({
        cartodb_id: 1, permitnumber: 'MP-1', violationnumber: 'V-1', complaintnumber: 'C-1',
        investigationprocessid: 'I-1', licensenum: 'L-1',
        opa_account_num: '212440300', parcel_id_num: '999999999', licensetype: 'Rental',
      })!;
      expect(row.parcel_pk).toBe('212440300'); // the real key, not the decoy
    });
  }
});

describe('tax delinquency text-boolean hazards', () => {
  const m = mapping('real_estate_tax_delinquencies');
  it('parses is_actionable (true/false) and sheriff_sale (Y/N) with distinct encodings', () => {
    const row = m.mapRow({
      opa_number: '041040500', year_month: '202206',
      is_actionable: 'true', payment_agreement: 'false', sheriff_sale: 'N',
      total_due: '4041.05', num_years_owed: '7', mailing_state: 'PA',
    })!;
    expect(row.delinquency_pk).toBe('041040500-202206');
    expect(row.parcel_pk).toBe('041040500');
    expect(row.is_actionable).toBe(true);
    expect(row.payment_agreement).toBe(false);
    expect(row.sheriff_sale).toBe(false); // 'N'
    expect(row.num_years_delinquent).toBe(7);
    expect(row.source_updated_at).toBe('2022-06-01');
  });
  it('reads sheriff_sale Y as true', () => {
    expect(m.mapRow({ opa_number: '1', year_month: '202206', sheriff_sale: 'Y' })!.sheriff_sale).toBe(true);
  });
});

describe('business license rental derivation', () => {
  const m = mapping('business_licenses');
  it('is_rental from licensetype, parcel_pk nullable for non-addressed', () => {
    const rental = m.mapRow({ licensenum: 'L1', licensetype: 'Rental', opa_account_num: '453381300' })!;
    expect(rental.is_rental).toBe(true);
    expect(rental.parcel_pk).toBe('453381300');
    const vendor = m.mapRow({ licensenum: 'L2', licensetype: 'Vendor - Sidewalk Sales', opa_account_num: '' })!;
    expect(vendor.is_rental).toBe(false);
    expect(vendor.parcel_pk).toBeNull(); // non-addressed → null, row still kept
  });
});

describe('spatial mappings (crime / 311)', () => {
  it('crime keys on dc_key, geom via GeoJSON marker', () => {
    const m = mapping('incidents_part1_part2');
    const row = m.mapRow({
      dc_key: 202501023567, cartodb_id: 1, geom_geojson: '{"type":"Point","coordinates":[-75,40]}',
      dispatch_date_time: '2025-08-29T18:48:00Z', text_general_code: 'Robbery No Firearm',
    })!;
    expect(row.incident_id).toBe('202501023567');
    expect((row.geom as { __geom: string }).__geom).toBe('geojson');
    expect(row.category).toBe('Robbery No Firearm');
  });
  it('311 keys on service_request_id and carries status', () => {
    const m = mapping('public_cases_fc');
    const row = m.mapRow({
      service_request_id: 14609710, cartodb_id: 1, requested_datetime: '2021-12-09T19:08:25Z',
      service_name: 'Abandoned Vehicle', status: 'Closed', geom_geojson: '{"type":"Point","coordinates":[-75,40]}',
    })!;
    expect(row.request_id).toBe('14609710');
    expect(row.status).toBe('Closed');
  });
});
