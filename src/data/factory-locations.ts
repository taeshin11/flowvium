export interface FactoryLocation {
  id: string;
  ticker: string;
  name: string;
  country: string;
  lat: number;
  lng: number;
  radiusKm: number;
  tags: string[];
  significance: 'critical' | 'major' | 'moderate';
}

export const FACTORY_LOCATIONS: FactoryLocation[] = [
  // ── Semiconductor Fabs ─────────────────────────────────────────────────────
  {
    id: 'tsmc-tainan-n3',
    ticker: 'TSM',
    name: 'TSMC Fab 18 / Tainan (N3/N2)',
    country: 'TW',
    lat: 22.9271,
    lng: 120.3038,
    radiusKm: 2.0,
    tags: ['foundry', 'NVDA', 'AAPL', 'AMD', 'QCOM', 'ARM'],
    significance: 'critical',
  },
  {
    id: 'tsmc-taichung',
    ticker: 'TSM',
    name: 'TSMC Fab 15 / Taichung (N5/N7)',
    country: 'TW',
    lat: 24.1964,
    lng: 120.6464,
    radiusKm: 1.5,
    tags: ['foundry', 'NVDA', 'AMD', 'AAPL'],
    significance: 'critical',
  },
  {
    id: 'samsung-pyeongtaek',
    ticker: '005930.KS',
    name: 'Samsung Pyeongtaek P3/P4 (HBM/DRAM/NAND)',
    country: 'KR',
    lat: 37.0034,
    lng: 127.0786,
    radiusKm: 2.5,
    tags: ['memory', 'HBM', 'DRAM', 'NAND', 'NVDA'],
    significance: 'critical',
  },
  {
    id: 'skhynix-icheon',
    ticker: '000660.KS',
    name: 'SK Hynix Icheon M14/M16 (HBM3E)',
    country: 'KR',
    lat: 37.2776,
    lng: 127.4512,
    radiusKm: 2.0,
    tags: ['memory', 'HBM', 'DRAM', 'NVDA', 'MU'],
    significance: 'critical',
  },
  {
    id: 'micron-boise',
    ticker: 'MU',
    name: 'Micron Fab 10X / Boise ID',
    country: 'US',
    lat: 43.6022,
    lng: -116.1936,
    radiusKm: 1.5,
    tags: ['memory', 'DRAM', 'NAND'],
    significance: 'major',
  },
  {
    id: 'intel-chandler',
    ticker: 'INTC',
    name: 'Intel Fab 42 / Chandler AZ (18A)',
    country: 'US',
    lat: 33.3045,
    lng: -111.8316,
    radiusKm: 1.5,
    tags: ['foundry', 'logic', 'INTC'],
    significance: 'major',
  },
  {
    id: 'asml-veldhoven',
    ticker: 'ASML',
    name: 'ASML HQ / Veldhoven (EUV 제조)',
    country: 'NL',
    lat: 51.3965,
    lng: 5.4195,
    radiusKm: 1.0,
    tags: ['EUV', 'lithography', 'supply-chain'],
    significance: 'critical',
  },
  // ── Supply Chain / Assembly ─────────────────────────────────────────────────
  {
    id: 'foxconn-zhengzhou',
    ticker: 'AAPL',
    name: 'Foxconn iPhone City / Zhengzhou',
    country: 'CN',
    lat: 34.7046,
    lng: 113.7394,
    radiusKm: 3.0,
    tags: ['assembly', 'AAPL', 'iPhone'],
    significance: 'critical',
  },
  // ── EV / Battery ───────────────────────────────────────────────────────────
  {
    id: 'catl-ningde',
    ticker: 'CATL',
    name: 'CATL 본사 공장 / Ningde',
    country: 'CN',
    lat: 26.6616,
    lng: 119.5163,
    radiusKm: 2.0,
    tags: ['battery', 'EV', 'TSLA', 'NIO'],
    significance: 'major',
  },
  {
    id: 'tesla-shanghai',
    ticker: 'TSLA',
    name: 'Tesla Gigafactory Shanghai',
    country: 'CN',
    lat: 30.9265,
    lng: 121.8571,
    radiusKm: 2.0,
    tags: ['EV', 'TSLA', 'assembly'],
    significance: 'major',
  },
  {
    id: 'tesla-nevada',
    ticker: 'TSLA',
    name: 'Tesla Gigafactory Nevada (배터리)',
    country: 'US',
    lat: 39.5363,
    lng: -118.9769,
    radiusKm: 2.0,
    tags: ['battery', 'EV', 'TSLA'],
    significance: 'moderate',
  },
  {
    id: 'samsung-austin',
    ticker: 'TSM',
    name: 'Samsung Austin Semiconductor (S3/S5)',
    country: 'US',
    lat: 30.3820,
    lng: -97.7749,
    radiusKm: 1.5,
    tags: ['foundry', 'logic'],
    significance: 'moderate',
  },
];
