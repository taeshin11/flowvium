import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { logger, loggedRedisSet } from '@/lib/logger';
export const dynamic = 'force-dynamic';

const CACHE_TTL = 24 * 60 * 60; // 24 hours
const OFAC_CSV_URL = 'https://www.treasury.gov/ofac/downloads/sdn.csv';

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

// ── CSV parsing ───────────────────────────────────────────────────────────────
// OFAC SDN format: "ent_num","SDN_Name","SDN_Type","Program","Title","Callsign","Vess_type","Tonnage","GRT","Vess_flag","Vess_owner","Remarks"
// Fields may be quoted. We split conservatively on `","` and strip outer quotes.

interface SdnEntry {
  entNum: string;
  name: string;
  type: string;
  program: string;
  remarks: string;
}

function parseSdnCsv(csv: string): SdnEntry[] {
  const lines = csv.split('\n');
  const entries: SdnEntry[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Remove leading/trailing outer quote if present then split by ","
    const stripped = line.startsWith('"') && line.endsWith('"')
      ? line.slice(1, -1)
      : line;

    const cols = stripped.split('","');

    // Need at least 4 columns: ent_num, SDN_Name, SDN_Type, Program
    if (cols.length < 4) continue;

    const entNum = cols[0].replace(/^"|"$/g, '').trim();
    const name = cols[1].replace(/^"|"$/g, '').trim();
    const type = cols[2].replace(/^"|"$/g, '').trim();
    const program = cols[3].replace(/^"|"$/g, '').trim();
    const remarks = cols[11] ? cols[11].replace(/^"|"$/g, '').trim() : '';

    // Skip header or empty name rows
    if (!name || name === 'SDN_Name' || name === '-0-') continue;

    entries.push({ entNum, name, type, program, remarks });
  }

  return entries;
}

// ── Fetch and cache OFAC SDN CSV ───────────────────────────────────────────────
async function getSdnData(redis: Redis | null): Promise<SdnEntry[] | null> {
  const cacheKey = 'flowvium:osint:sanctions:v1:sdn-csv';

  if (redis) {
    try {
      const cached = await redis.get<SdnEntry[]>(cacheKey);
      if (cached && Array.isArray(cached) && cached.length > 0) return cached;
    } catch { /* non-fatal */ }
  }

  try {
    const res = await fetch(OFAC_CSV_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(30000),
      cache: 'no-store',
    });
    if (!res.ok) return null;

    const csv = await res.text();
    const entries = parseSdnCsv(csv);

    if (redis && entries.length > 0) {
      await loggedRedisSet(redis, 'api.osint.sanctions', cacheKey, entries, { ex: CACHE_TTL });
    }

    return entries;
  } catch {
    return null;
  }
}

// ── Program code → Korean readable label ─────────────────────────────────────
const PROGRAM_LABELS: Record<string, string> = {
  // Russia / Ukraine
  'UKRAINE-EO13660': '우크라이나 위기 (EO13660)',
  'UKRAINE-EO13661': '러시아 개인 제재 (EO13661)',
  'UKRAINE-EO13662': '러시아 섹터 제재 (EO13662)',
  'UKRAINE-EO13685': '크림반도 제재',
  'RUSSIA-EO14024': '러시아 침공 제재 (2022)',
  'RUSSIA-EO14066': '러시아 무역 제한',
  'RUSSIA-EO14068': '러시아 신규 투자 금지',
  'RUSSIA-EO14071': '러시아 서비스 수출 금지',
  // Iran
  'IRAN': '이란 제재',
  'IRAN-EO13599': '이란 정부 자산 동결',
  'IRAN-TRA': '이란 거래 금지',
  'IFSR': '이란 금융 제재',
  'ISA': '이란 제재법',
  // North Korea
  'DPRK': '북한 제재',
  'DPRK2': '북한 WMD 관련',
  'DPRK3': '북한 사이버·무기',
  'DPRK4': '북한 광물·섬유 수출',
  'DPRK-EO13722': '북한 운송·광업 제재',
  'DPRK-EO13810': '북한 추가 제재',
  // Terror / SDN
  'SDGT': '글로벌 테러 지원',
  'SDNTK': '마약 밀수 관련',
  'FTO': '외국 테러조직',
  // Cyber
  'CYBER2': '사이버 공격 제재',
  // China
  'CMIC': '중국 군사 기업',
  'NS-CMIC': '중국 국가안보 관련',
  // Others
  'DRCONGO': '콩고 분쟁 관련',
  'SOMALIA': '소말리아 제재',
  'LIBYA': '리비아 제재',
  'SYRIA': '시리아 제재',
  'BELARUS-EO14038': '벨라루스 억압 정권',
  'VENEZUELA-EO13692': '베네수엘라 민주주의 제재',
};

function readableProgramLabel(program: string): string {
  // Try exact match first
  if (PROGRAM_LABELS[program]) return PROGRAM_LABELS[program];
  // Try prefix match
  for (const [key, label] of Object.entries(PROGRAM_LABELS)) {
    if (program.startsWith(key)) return label;
  }
  return program; // fallback to raw if unknown
}

// Clean OFAC CSV artifacts from remarks field
function cleanRemarks(raw: string): string {
  return raw
    .replace(/(,\s*-0-\s*)+/g, '') // remove ,-0- placeholders
    .replace(/^-0-\s*,?\s*/g, '')   // remove leading -0-
    .replace(/;\s*$/g, '')           // trailing semicolons
    .replace(/"\s*,\s*"/g, ' ')      // leftover quote-comma-quote
    .replace(/\s{2,}/g, ' ')         // collapse whitespace
    .trim();
}

// Featured programs to show on auto-load (no search query)
const FEATURED_PROGRAMS = [
  { key: 'RUSSIA', label: '러시아 제재', color: 'red' },
  { key: 'IRAN', label: '이란 제재', color: 'orange' },
  { key: 'DPRK', label: '북한 제재', color: 'yellow' },
  { key: 'SDGT', label: '테러 지원', color: 'red' },
  { key: 'CYBER2', label: '사이버 공격', color: 'purple' },
  { key: 'CMIC', label: '중국 제재', color: 'blue' },
];

// ── Route handler ──────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q')?.trim() ?? '';
  const featured = searchParams.get('featured') === 'true';

  const redis = createRedis();
  const entries = await getSdnData(redis);

  if (!entries) {
    return NextResponse.json({
      matches: [],
      total: 0,
      source: 'OFAC SDN',
      updatedAt: new Date().toISOString(),
      error: 'Failed to load OFAC data',
    });
  }

  // Featured mode: return representative entries per program
  if (featured || !q) {
    const grouped: Record<string, { label: string; color: string; entries: object[] }> = {};
    for (const prog of FEATURED_PROGRAMS) {
      const matched = entries
        .filter(e => e.program.toUpperCase().includes(prog.key))
        .slice(0, 6)
        .map(e => ({
          name: e.name,
          type: e.type,
          program: e.program,
          programLabel: readableProgramLabel(e.program),
          remarks: cleanRemarks(e.remarks),
          entNum: e.entNum,
        }));
      if (matched.length > 0) {
        grouped[prog.key] = { label: prog.label, color: prog.color, entries: matched };
      }
    }
    return NextResponse.json({
      featured: true,
      groups: grouped,
      totalEntries: entries.length,
      source: 'OFAC SDN',
      updatedAt: new Date().toISOString(),
    });
  }

  const queryLower = q.toLowerCase();
  const matches = entries
    .filter((e) => e.name.toLowerCase().includes(queryLower))
    .slice(0, 15)
    .map((e) => ({
      name: e.name,
      type: e.type,
      program: e.program,
      programLabel: readableProgramLabel(e.program),
      remarks: cleanRemarks(e.remarks),
      entNum: e.entNum,
    }));

  return NextResponse.json({
    matches,
    total: matches.length,
    source: 'OFAC SDN',
    updatedAt: new Date().toISOString(),
  });
}
