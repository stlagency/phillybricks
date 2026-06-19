/**
 * Mock LeadsResponse fixture — shaped EXACTLY like
 * @bandbox/core/contracts `LeadsResponse` (PRD §6, GET /api/leads).
 *
 * Typed mock data for design surfaces only. Not yet wired to a route in this
 * milestone (the leads surface is M6); included so the contract is exercised
 * and the Ledger/Pill components have a realistic feed to render later.
 */
import type { LeadsResponse } from '@bandbox/core/contracts';
import { leadDistressByPk } from './distress';

export const sampleLeads: LeadsResponse = {
  page: 1,
  page_size: 25,
  total: 2,
  rows: [
    {
      parcel_pk: '888001100',
      address: '1422 S BANCROFT ST',
      owner_1: 'RIVERA HOLDINGS LLC',
      is_out_of_state_owner: true,
      distress: leadDistressByPk['888001100']!,
    },
    {
      parcel_pk: '888002200',
      address: '2031 CARPENTER ST',
      owner_1: 'ESTATE OF D. MCBRIDE',
      is_out_of_state_owner: false,
      distress: leadDistressByPk['888002200']!,
    },
  ],
};
