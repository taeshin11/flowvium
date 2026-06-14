/**
 * src/lib/kana-to-hangul.ts — 일본어 가나(히라가나/카타카나) → 한글 결정론적 음차 (2026-06-14).
 *
 * 배경: ko 타겟 뉴스 제목에 일본어 브랜드/고유명사가 가나로 잔존(예: "ロンジン 신작 시계" → Longines).
 *   로컬 LLM(qwen3:8b)은 혼합-스크립트 입력에 환각(무관 문장·중국어)을 내 신뢰 불가 — 검증됨.
 *   이미 한국어로 번역된 문장은 그대로 두고, *가나 런만* 코드로 음차해 잔존 외국어를 제거한다.
 *
 * 한계: 음운 기반 근사(국립국어원 표기법 단순화). 고유명사 대부분 무난(ロンジン→론진, トヨタ→토요타).
 *   장음 ー 생략, 촉음 ッ 은 ㅅ 받침. 의미 번역이 아니라 *표기 정규화* 목적.
 */

// 카타카나 → 한글 (2글자 요음 우선 매칭). 히라가나는 +0x60 으로 카타카나화 후 동일 테이블 사용.
const DIGRAPH: Record<string, string> = {
  キャ: '캬', キュ: '큐', キョ: '쿄', ギャ: '갸', ギュ: '규', ギョ: '교',
  シャ: '샤', シュ: '슈', ショ: '쇼', ジャ: '자', ジュ: '주', ジョ: '조',
  チャ: '차', チュ: '추', チョ: '초', ヂャ: '자', ヂュ: '주', ヂョ: '조',
  ニャ: '냐', ニュ: '뉴', ニョ: '뇨', ヒャ: '햐', ヒュ: '휴', ヒョ: '효',
  ビャ: '뱌', ビュ: '뷰', ビョ: '뵤', ピャ: '퍄', ピュ: '퓨', ピョ: '표',
  ミャ: '먀', ミュ: '뮤', ミョ: '묘', リャ: '랴', リュ: '류', リョ: '료',
  ファ: '파', フィ: '피', フェ: '페', フォ: '포', ウィ: '위', ウェ: '웨', ウォ: '워',
  ヴァ: '바', ヴィ: '비', ヴェ: '베', ヴォ: '보', ティ: '티', ディ: '디', トゥ: '투', ドゥ: '두',
  チェ: '체', シェ: '셰', ジェ: '제',
};
const MONO: Record<string, string> = {
  ア: '아', イ: '이', ウ: '우', エ: '에', オ: '오',
  カ: '카', キ: '키', ク: '쿠', ケ: '케', コ: '코',
  ガ: '가', ギ: '기', グ: '구', ゲ: '게', ゴ: '고',
  サ: '사', シ: '시', ス: '스', セ: '세', ソ: '소',
  ザ: '자', ジ: '지', ズ: '즈', ゼ: '제', ゾ: '조',
  タ: '타', チ: '치', ツ: '쓰', テ: '테', ト: '토',
  ダ: '다', ヂ: '지', ヅ: '즈', デ: '데', ド: '도',
  ナ: '나', ニ: '니', ヌ: '누', ネ: '네', ノ: '노',
  ハ: '하', ヒ: '히', フ: '후', ヘ: '헤', ホ: '호',
  バ: '바', ビ: '비', ブ: '부', ベ: '베', ボ: '보',
  パ: '파', ピ: '피', プ: '푸', ペ: '페', ポ: '포',
  マ: '마', ミ: '미', ム: '무', メ: '메', モ: '모',
  ヤ: '야', ユ: '유', ヨ: '요',
  ラ: '라', リ: '리', ル: '루', レ: '레', ロ: '로',
  ワ: '와', ヰ: '이', ヱ: '에', ヲ: '오', ヴ: '부',
};

const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;
// 받침 추가: T==0(받침 없음) 인 한글 음절에 종성 추가. ㄴ=4, ㅇ=21, ㅅ=19.
function addFinal(syllable: string, finalIdx: number): string {
  if (!syllable) return syllable;
  const code = syllable.charCodeAt(syllable.length - 1);
  if (code < HANGUL_BASE || code > HANGUL_LAST) return syllable + (finalIdx === 4 ? 'ㄴ' : '');
  if ((code - HANGUL_BASE) % 28 !== 0) return syllable; // 이미 받침 있음 → 그대로
  return syllable.slice(0, -1) + String.fromCharCode(code + finalIdx);
}

function isKana(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= 0x3041 && c <= 0x3096) || (c >= 0x30a1 && c <= 0x30fa) || c === 0x30fc;
}
function toKatakana(ch: string): string {
  const c = ch.charCodeAt(0);
  if (c >= 0x3041 && c <= 0x3096) return String.fromCharCode(c + 0x60); // 히라가나→카타카나
  return ch;
}

/** 가나 시퀀스 하나를 한글로 음차. ン=ㄴ 받침, ッ=ㅅ 받침, ー(장음) 생략. */
function translitRun(run: string): string {
  const k = Array.from(run).map(toKatakana);
  let out = '';
  let pendingSokuon = false; // ッ
  for (let i = 0; i < k.length; i++) {
    const ch = k[i];
    if (ch === 'ー') continue; // 장음 생략
    if (ch === 'ッ') { pendingSokuon = true; continue; }
    if (ch === 'ン') { out = addFinal(out, 4); continue; } // ㄴ 받침
    let syl = '';
    const two = ch + (k[i + 1] || '');
    if (DIGRAPH[two]) { syl = DIGRAPH[two]; i++; }
    else if (MONO[ch]) { syl = MONO[ch]; }
    else { out += ch; continue; } // 매핑 없는 기호는 통과
    if (pendingSokuon) { out = addFinal(out, 19); pendingSokuon = false; } // ㅅ 받침
    out += syl;
  }
  if (pendingSokuon) out += 'ㅅ';
  return out;
}

/**
 * 텍스트 안의 가나 런만 한글로 음차하고 나머지는 보존.
 * 중점(・)은 공백으로, 그 외 비가나는 그대로 둔다.
 */
export function kanaToHangul(text: string): string {
  if (!text) return text;
  return text
    .replace(/・/g, ' ')
    .replace(/[ぁ-ゖァ-ヺー]+/g, (run) => translitRun(run));
}
