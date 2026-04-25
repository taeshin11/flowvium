import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { logger, loggedRedisSet } from '@/lib/logger';
export const dynamic = 'force-dynamic';

const CACHE_TTL = 60 * 60; // 1 hour

// ── Static fallback for well-known entities (OpenCorporates often rate-limits) ─
const STATIC_ENTITIES: Record<string, object[]> = {
  gazprom: [
    { name: 'GAZPROM PAO', number: '1027700070518', jurisdiction: 'ru', incorporated: '1998-02-25', dissolved: null, type: 'Public Joint Stock Company', address: '16 Nametkina St, Moscow, 117997, Russia', url: 'https://opencorporates.com/companies/ru/1027700070518', note: '러시아 국영 천연가스 기업. 세계 최대 천연가스 생산·공급사. 크렘린 직접 통제.' },
    { name: 'Gazprom Export LLC', number: null, jurisdiction: 'ru', incorporated: null, dissolved: null, type: 'LLC', address: 'Moscow, Russia', url: 'https://www.gazprom-export.com', note: '가즈프롬 해외 수출 자회사. 유럽 가스 수출 담당.' },
    { name: 'Nord Stream AG', number: 'CHE-114.461.807', jurisdiction: 'ch', incorporated: '2005-12-07', dissolved: null, type: 'AG (주식회사)', address: 'Baarerstrasse 52, 6300 Zug, Switzerland', url: 'https://opencorporates.com/companies/ch/CHE-114.461.807', note: '러시아-독일 해저가스관 운영사. 51% 가즈프롬 소유. 스위스 등록.' },
  ],
  'wagner group': [
    { name: 'Concord Management and Consulting LLC', number: '1089847022382', jurisdiction: 'ru', incorporated: '2008-09-01', dissolved: null, type: 'LLC', address: 'Saint Petersburg, Russia', url: 'https://opencorporates.com/companies/ru/1089847022382', note: 'Yevgeny Prigozhin 소유 기업. Wagner 그룹 모기업 역할. 아프리카·우크라이나 용병 파견.' },
    { name: 'Prigozhin Enterprises (Informal network)', number: null, jurisdiction: 'ru', incorporated: null, dissolved: null, type: '비공개 네트워크', address: 'Russia', url: 'https://www.treasury.gov/resource-center/sanctions/OFAC-Enforcement/Pages/20180207.aspx', note: 'OFAC 제재 대상. Prigozhin가 통제하는 기업 네트워크. 인터넷 Research Agency 포함.' },
  ],
  alibaba: [
    { name: 'ALIBABA GROUP HOLDING LIMITED', number: '1567625', jurisdiction: 'ky', incorporated: '2007-06-28', dissolved: null, type: 'Exempted Company', address: 'c/o Walkers Corporate Limited, Cayman Islands', url: 'https://opencorporates.com/companies/ky/1567625', note: '케이맨군도 등록 지주회사. 중국 최대 이커머스·클라우드. NYSE/HKEX 상장.' },
    { name: 'Zhejiang Alibaba E-Commerce Co., Ltd.', number: '330100400010673', jurisdiction: 'cn', incorporated: '1999-09-04', dissolved: null, type: '有限责任公司 (유한책임회사)', address: 'Hangzhou, Zhejiang, China', url: 'https://opencorporates.com/companies/cn/330100400010673', note: '중국 본토 법인. 타오바오·티몰·알리페이 운영.' },
    { name: 'Alibaba Cloud Intelligence Group (Aliyun)', number: null, jurisdiction: 'cn', incorporated: null, dissolved: null, type: '자회사', address: 'Hangzhou, China', url: 'https://www.alibabacloud.com', note: '아시아 최대 클라우드 서비스. 미 상무부 Entity List 검토 이력.' },
  ],
  huawei: [
    { name: 'HUAWEI TECHNOLOGIES CO., LTD.', number: '440301103097767', jurisdiction: 'cn', incorporated: '1987-09-15', dissolved: null, type: '有限责任公司', address: 'Bantian, Longgang District, Shenzhen, Guangdong, China', url: 'https://opencorporates.com/companies/cn/440301103097767', note: '중국 최대 통신장비 기업. 미 상무부 Entity List(2019) 등재. 5G 장비 서방국가 퇴출.' },
    { name: 'Huawei Device Co., Ltd.', number: null, jurisdiction: 'cn', incorporated: null, dissolved: null, type: '자회사', address: 'Dongguan, Guangdong, China', url: 'https://consumer.huawei.com', note: '스마트폰·PC 자회사. 미 제재로 구글 서비스 제한.' },
    { name: 'HiSilicon Technologies Co., Ltd.', number: null, jurisdiction: 'cn', incorporated: '2004-01-01', dissolved: null, type: '자회사', address: 'Shenzhen, China', url: 'https://www.hisilicon.com', note: '화웨이 반도체 설계 자회사. TSMC 거래 미 제재로 중단.' },
  ],
};

function getStaticFallback(query: string): object[] | null {
  const q = query.toLowerCase();
  for (const [key, data] of Object.entries(STATIC_ENTITIES)) {
    if (q.includes(key) || key.includes(q)) return data;
  }
  return null;
}

function createRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

// ── OpenCorporates types ───────────────────────────────────────────────────────
interface OcCompany {
  name: string;
  company_number: string;
  jurisdiction_code: string;
  incorporation_date: string | null;
  dissolution_date: string | null;
  company_type: string | null;
  registered_address_in_full: string | null;
  opencorporates_url: string;
}

interface OcApiResponse {
  results?: {
    companies?: Array<{ company: OcCompany }>;
    total_count?: number;
  };
}

// ── Route handler ──────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q')?.trim() ?? '';

  if (!q) {
    return NextResponse.json({ error: '검색어를 입력하세요' }, { status: 400 });
  }

  const encodedQuery = encodeURIComponent(q);
  const cacheKey = `flowvium:osint:corporate:v1:${encodedQuery}`;
  const redis = createRedis();

  if (redis) {
    try {
      const cached = await redis.get<object>(cacheKey);
      if (cached) return NextResponse.json(cached);
    } catch { /* non-fatal */ }
  }

  // Check static fallback first (preset companies)
  const staticData = getStaticFallback(q);

  try {
    const res = await fetch(
      `https://api.opencorporates.com/v0.4/companies/search?q=${encodedQuery}&per_page=5&format=json`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(10000),
        cache: 'no-store',
      }
    );

    if (!res.ok) throw new Error(`OpenCorporates HTTP ${res.status}`);

    const data: OcApiResponse = await res.json();
    const rawCompanies = data?.results?.companies ?? [];
    const total = data?.results?.total_count ?? rawCompanies.length;

    const apiCompanies = rawCompanies.map(({ company: c }) => ({
      name: c.name,
      number: c.company_number,
      jurisdiction: c.jurisdiction_code,
      incorporated: c.incorporation_date,
      dissolved: c.dissolution_date,
      type: c.company_type,
      address: c.registered_address_in_full,
      url: c.opencorporates_url,
    }));

    // Merge: static data first (more context), then live API results
    const companies = staticData
      ? [...staticData, ...apiCompanies.slice(0, 3)]
      : apiCompanies;

    const result = {
      companies,
      total: companies.length,
      source: staticData ? 'Curated + OpenCorporates' : 'OpenCorporates',
    };

    if (redis) {
      await loggedRedisSet(redis, 'api.osint.corporate', cacheKey, result, { ex: CACHE_TTL });
    }

    return NextResponse.json(result);
  } catch {
    // API failed — return static fallback if available
    if (staticData) {
      return NextResponse.json({
        companies: staticData,
        total: staticData.length,
        source: 'Curated',
      });
    }
    return NextResponse.json({
      companies: [],
      total: 0,
      source: 'OpenCorporates',
      error: 'OpenCorporates 접속 불가 — 기업명을 직접 검색하거나 외부 링크를 이용하세요',
    });
  }
}
