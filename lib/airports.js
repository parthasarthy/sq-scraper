/**
 * Airport / city lookup table.
 * Maps common city names, regions, and IATA codes → IATA code.
 * All keys are lowercase for case-insensitive matching.
 */
const AIRPORTS = {
  // Singapore
  singapore: 'SIN', sin: 'SIN', changi: 'SIN',

  // Australia
  sydney: 'SYD', syd: 'SYD',
  melbourne: 'MEL', mel: 'MEL',
  brisbane: 'BNE', bne: 'BNE',
  perth: 'PER', per: 'PER',
  adelaide: 'ADL', adl: 'ADL',

  // Japan
  tokyo: 'TYO', tyo: 'TYO', narita: 'NRT', nrt: 'NRT', haneda: 'HND', hnd: 'HND',
  osaka: 'OSA', osa: 'OSA', kansai: 'KIX', kix: 'KIX',

  // South Korea
  seoul: 'SEL', sel: 'SEL', incheon: 'ICN', icn: 'ICN',

  // China
  beijing: 'PEK', pek: 'PEK',
  shanghai: 'SHA', sha: 'SHA', pudong: 'PVG', pvg: 'PVG',
  guangzhou: 'CAN', can: 'CAN',
  chengdu: 'CTU', ctu: 'CTU',
  shenzhen: 'SZX', szx: 'SZX',

  // Hong Kong / Taiwan
  'hong kong': 'HKG', hkg: 'HKG', hongkong: 'HKG',
  taipei: 'TPE', tpe: 'TPE',

  // India
  mumbai: 'BOM', bom: 'BOM', bombay: 'BOM',
  delhi: 'DEL', del: 'DEL', 'new delhi': 'DEL',
  bangalore: 'BLR', blr: 'BLR', bengaluru: 'BLR',
  chennai: 'MAA', maa: 'MAA', madras: 'MAA',
  hyderabad: 'HYD', hyd: 'HYD',
  kolkata: 'CCU', ccu: 'CCU', calcutta: 'CCU',

  // Southeast Asia
  bangkok: 'BKK', bkk: 'BKK', suvarnabhumi: 'BKK',
  'kuala lumpur': 'KUL', kul: 'KUL', klia: 'KUL',
  jakarta: 'CGK', cgk: 'CGK',
  bali: 'DPS', dps: 'DPS', denpasar: 'DPS',
  manila: 'MNL', mnl: 'MNL',
  'ho chi minh': 'SGN', sgn: 'SGN', saigon: 'SGN',
  hanoi: 'HAN', han: 'HAN',
  yangon: 'RGN', rgn: 'RGN', rangoon: 'RGN',
  phnom_penh: 'PNH', pnh: 'PNH',
  vientiane: 'VTE', vte: 'VTE',
  colombo: 'CMB', cmb: 'CMB',
  kathmandu: 'KTM', ktm: 'KTM',
  dhaka: 'DAC', dac: 'DAC',

  // Middle East
  dubai: 'DXB', dxb: 'DXB',
  abudhabi: 'AUH', auh: 'AUH', 'abu dhabi': 'AUH',
  doha: 'DOH', doh: 'DOH',
  riyadh: 'RUH', ruh: 'RUH',
  jeddah: 'JED', jed: 'JED',

  // Europe
  london: 'LON', lon: 'LON', heathrow: 'LHR', lhr: 'LHR', gatwick: 'LGW', lgw: 'LGW',
  paris: 'PAR', par: 'PAR', 'charles de gaulle': 'CDG', cdg: 'CDG',
  frankfurt: 'FRA', fra: 'FRA',
  amsterdam: 'AMS', ams: 'AMS',
  zurich: 'ZRH', zrh: 'ZRH',
  munich: 'MUC', muc: 'MUC',
  rome: 'ROM', rom: 'ROM', fiumicino: 'FCO', fco: 'FCO',
  milan: 'MIL', mil: 'MIL', malpensa: 'MXP', mxp: 'MXP',
  madrid: 'MAD', mad: 'MAD',
  barcelona: 'BCN', bcn: 'BCN',
  vienna: 'VIE', vie: 'VIE',
  brussels: 'BRU', bru: 'BRU',
  copenhagen: 'CPH', cph: 'CPH',
  stockholm: 'STO', sto: 'STO', arlanda: 'ARN', arn: 'ARN',
  oslo: 'OSL', osl: 'OSL',
  helsinki: 'HEL', hel: 'HEL',
  moscow: 'MOW', mow: 'MOW',
  istanbul: 'IST', ist: 'IST',
  athens: 'ATH', ath: 'ATH',
  lisbon: 'LIS', lis: 'LIS',

  // USA
  'new york': 'NYC', nyc: 'NYC', jfk: 'JFK', newark: 'EWR', ewr: 'EWR',
  'los angeles': 'LAX', lax: 'LAX',
  chicago: 'CHI', chi: 'CHI', ohare: 'ORD', ord: 'ORD',
  houston: 'HOU', hou: 'HOU', iah: 'IAH',
  dallas: 'DFW', dfw: 'DFW',
  seattle: 'SEA', sea: 'SEA',
  sanfrancisco: 'SFO', sfo: 'SFO', 'san francisco': 'SFO',

  // Canada
  toronto: 'YTO', yto: 'YTO', yyz: 'YYZ',
  vancouver: 'YVR', yvr: 'YVR',

  // Africa
  johannesburg: 'JNB', jnb: 'JNB',
  capetown: 'CPT', cpt: 'CPT', 'cape town': 'CPT',
  nairobi: 'NBO', nbo: 'NBO',
};

/**
 * Resolve a user-supplied string to an IATA code.
 * Returns the IATA code (uppercase) or null if not found.
 */
function resolveAirport(input) {
  if (!input) return null;
  const key = input.trim().toLowerCase();
  // Direct IATA 3-letter code passthrough
  if (/^[a-z]{3}$/.test(key) && AIRPORTS[key]) return AIRPORTS[key];
  if (/^[A-Z]{3}$/.test(input.trim())) return input.trim().toUpperCase(); // already IATA
  return AIRPORTS[key] || null;
}

module.exports = { resolveAirport, AIRPORTS };
