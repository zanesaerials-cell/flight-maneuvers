import type { Cert } from '../data/aircraft';

/** ACS tolerances that differ between the Private and Commercial standards. */
export function std(cert: Cert) {
  const com = cert !== 'private';
  const spd = com ? { minus: 5, plus: 5, label: '±5 kt' } : { minus: 5, plus: 10, label: '+10 / −5 kt' };
  return {
    com,
    climb: spd,
    approach: spd,
    tdNormal: com ? 200 : 400,
    tdShort: com ? 100 : 200,
    steepBank: com ? 50 : 45,
    slow: com ? { alt: 50, spdPlus: 5, bank: 5 } : { alt: 100, spdPlus: 10, bank: 10 },
  };
}

export const CERTS: { id: Cert; name: string; blurb: string; acsDoc: string; prefix: string }[] = [
  { id: 'private', name: 'Private Pilot', blurb: 'Airplane single-engine land', acsDoc: 'Private Pilot ACS', prefix: 'PA' },
  { id: 'commercial', name: 'Commercial Pilot', blurb: 'Airplane single-engine land', acsDoc: 'Commercial Pilot ACS', prefix: 'CA' },
  { id: 'cfi', name: 'Flight Instructor (CFI)', blurb: 'Single-engine, flown to Commercial standards from the right seat', acsDoc: 'Flight Instructor ACS, flown to Commercial standards — Commercial task', prefix: 'CA' },
  { id: 'multi', name: 'Commercial Multi-Engine Add-On', blurb: 'Airplane multi-engine land', acsDoc: 'Commercial Pilot ACS (AMEL)', prefix: 'CA' },
];
export const certInfo = (c: Cert) => CERTS.find((x) => x.id === c)!;
