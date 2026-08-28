/**
 * tts.mjs — 앵커 음성 합성. 공급자를 갈아끼울 수 있는 한 칸.
 *
 * 배경(2026-08-27): 유튜브 이슈채널 앵커 목소리.
 *   맥 내장 TTS 로 실물을 뽑아 판정을 받았고("별로") ElevenLabs 로 간다.
 *   실측으로 드러난 맥 TTS 의 실체: ko_KR 로 9종이 나열되지만 **한국어를 실제로 말하는 건 Yuna 뿐**
 *   — 나머지는 어떤 입력이든 4,800 bytes 고정(무음)이다. 목록에 있다고 되는 게 아니다.
 *   그래서 아래 [무음 감지] 가 있다. 무음을 성공으로 넘기면 소리 없는 영상이 발행된다.
 *
 * 공급자를 인터페이스로 둔 이유: 품질 판단은 바뀐다. 바뀔 때 상류(대본)와 하류(합성)를
 *   건드리지 않아야 한다. 이번 세션에 "생산자만 바꾸고 소비처를 안 봐서" 30시간 발간이 멈춘 적이 있다.
 *
 * 키는 .env.local 에서만 읽는다(.gitignore:26 `.env*.local` 로 제외 확인).
 *   CLI 인자로 받지 않는다 — `ps` 에 남는다. 로그에도 찍지 않는다.
 */
import { spawnSync } from 'child_process';
import { existsSync, statSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { dirname, resolve } from 'path';
import { ROOT } from './project-root.mjs';

/** 무음 판정 임계. 맥 미설치 음성이 내는 고정 크기(4,800B)보다 넉넉히 위. */
const MIN_AUDIO_BYTES = 10_000;

function envValue(name) {
  if (process.env[name]) return process.env[name];
  try {
    const env = readFileSync(resolve(ROOT, '.env.local'), 'utf8');
    const m = env.match(new RegExp(`^${name}\\s*=\\s*(.+)$`, 'm'));
    return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : '';
  } catch { return ''; }
}

/** macOS 내장 `say`. 무료·오프라인·무제한이지만 감정/강조 제어가 없다. */
async function macProvider(text, { voice = 'Yuna', rate = 200, outPath }) {
  mkdirSync(dirname(outPath), { recursive: true });
  const aiff = `${outPath}.aiff`;
  const txt = `${outPath}.txt`;
  writeFileSync(txt, text);
  const say = spawnSync('say', ['-v', voice, '-r', String(rate), '-o', aiff, '-f', txt], { encoding: 'utf8' });
  try { rmSync(txt); } catch { /* noop */ }
  if (say.status !== 0) throw new Error(`say 실패(voice=${voice}): ${String(say.stderr).slice(0, 80)}`);
  const conv = spawnSync('afconvert', ['-f', 'm4af', '-d', 'aac', aiff, outPath], { encoding: 'utf8' });
  try { rmSync(aiff); } catch { /* noop */ }
  if (conv.status !== 0) throw new Error(`afconvert 실패: ${String(conv.stderr).slice(0, 80)}`);
  return outPath;
}

/**
 * ElevenLabs. Eleven v3 는 인라인 오디오 태그([excited] 등)로 강조를 제어한다 —
 *   맥 TTS 에 없던 부분이라 앵커 톤에 쓸 값어치가 있다.
 *   모델은 고정하지 않는다: 안정적 내레이션은 multilingual v2, 표현력은 v3.
 */
async function elevenProvider(text, opts = {}) {
  const { voice, model = 'eleven_multilingual_v2', outPath, apiKey } = opts;
  const key = apiKey ?? envValue('ELEVENLABS_API_KEY');
  if (!key) {
    throw new Error('ELEVENLABS_API_KEY 없음 — .env.local 에 추가하라(대화·CLI 인자로 넘기지 말 것)');
  }
  const voiceId = voice || envValue('ELEVENLABS_VOICE_ID');
  if (!voiceId) throw new Error('voice 미지정 — ELEVENLABS_VOICE_ID 를 .env.local 에 넣거나 voice 로 전달하라');
  // 2026-08-27: voice_settings 를 명시한다. 종전에는 안 보내서 음성의 기본값을 그대로 썼는데,
  //   Salang 기본값이 similarity_boost=0.75 · use_speaker_boost=true 였다.
  //   similarity 가 높으면 원본 녹음의 특성을 그대로 재현한다 — 배경 잡음까지 같이 온다.
  //   speaker_boost 는 그걸 더 키운다. 사용자가 "뒤쪽에 백색소음" 을 지적해 노출된 문제다.
  //   기본값을 바꾸지 않고 *호출자가 지정할 수 있게* 연다 — 어떤 값이 맞는지는 귀로 정할 일이다.
  const settings = opts?.voiceSettings ?? null;
  // output_format 미지정 시 API 기본은 mp3_44100_128. 인코딩 아티팩트를 줄이려면 192 로.
  const fmt = opts?.outputFormat ?? envValue('ELEVENLABS_OUTPUT_FORMAT') ?? '';
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`
    + (fmt ? `?output_format=${encodeURIComponent(fmt)}` : '');
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: model, ...(settings ? { voice_settings: settings } : {}) }),
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`ElevenLabs HTTP ${r.status}: ${body.slice(0, 160)}`);
  }
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, Buffer.from(await r.arrayBuffer()));
  return outPath;
}

/**
 * 로케일 → 앵커 음성. 2026-08-27 선정: ko=Salang(차분·명료·따뜻), en=Adam(단호).
 *   같은 대본을 한국어 6종·영어 2종으로 뽑아 들려드리고 사용자가 고른 결과다.
 *
 * ID 는 .env.local 에 둔다 — 코드에 박으면 교체 때마다 코드를 고쳐야 하고,
 *   공유 라이브러리 음성은 제작자가 내릴 수도 있어 언젠가 반드시 바뀐다.
 * 미지정 로케일은 영어 앵커로 폴백한다(FlowVium 은 16개 로케일을 낸다).
 */
/**
 * 이 로케일 목소리의 성별. ElevenLabs 가 보이스 메타에 labels.gender 로 준다.
 *
 * 화면의 앵커와 맞춰 보려고 읽는다 — 남자 목소리에 여자 앵커가 나간 적이 있다(2026-08-28).
 * 네트워크가 죽거나 라벨이 없으면 null 이다. 모르는 것과 어긋난 것은 다르다.
 */
export async function voiceGender(locale, opts = {}) {
  const { fetchImpl = fetch, timeoutMs = 8000 } = opts;
  const id = voiceForLocale(locale);
  const key = envValue('ELEVENLABS_API_KEY');
  if (!id || !key) return null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetchImpl(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(id)}`,
      { headers: { 'xi-api-key': key }, signal: ac.signal });
    if (!r.ok) return null;
    const v = await r.json();
    const g = String(v?.labels?.gender ?? '').toLowerCase();
    return g === 'male' || g === 'female' ? g : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

export function voiceForLocale(locale, env = process.env) {
  const base = String(locale ?? '').toLowerCase().split('-')[0];
  const pick = (n) => env?.[n] || envValue(n);
  if (base === 'ko') return pick('ELEVENLABS_VOICE_ID_KO') || pick('ELEVENLABS_VOICE_ID_EN');
  return pick('ELEVENLABS_VOICE_ID_EN') || pick('ELEVENLABS_VOICE_ID');
}

/**
 * 글자 단위 타임스탬프까지 받는 합성. 자막을 **추정하지 않고** 붙이기 위해 쓴다.
 *
 * 왜 별도 함수인가: 엔드포인트가 다르다(/with-timestamps). 응답이 오디오 바이트가 아니라
 *   JSON({audio_base64, alignment}) 이라 macProvider 와 인터페이스가 맞지 않는다.
 *   맥 TTS 에는 대응물이 없어서 공급자 테이블에 넣지 않았다 — 넣으면 mac 에서 조용히 깨진다.
 *
 * alignment vs normalized_alignment: 전자는 **우리가 넘긴 원문**의 글자에 대응하고,
 *   후자는 TTS 가 정규화한 발음 텍스트("$17B"→"seventeen billion")에 대응한다.
 *   자막은 화면에 원문을 띄워야 하므로 alignment 를 쓴다.
 *
 * @returns {Promise<{path:string, alignment:object, durationSec:number}>}
 */
export async function synthesizeWithTimestamps(text, opts = {}) {
  const { model = 'eleven_multilingual_v2', outPath } = opts;
  if (!outPath) throw new Error('outPath 필요');
  if (!text || !String(text).trim()) throw new Error('빈 대본');
  const key = opts.apiKey ?? envValue('ELEVENLABS_API_KEY');
  if (!key) throw new Error('ELEVENLABS_API_KEY 없음 — .env.local 에 추가하라');
  const voiceId = opts.voice || (opts.locale ? voiceForLocale(opts.locale) : '') || envValue('ELEVENLABS_VOICE_ID');
  if (!voiceId) throw new Error('voice 미지정');

  const fmt = opts.outputFormat ?? '';
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps`
    + (fmt ? `?output_format=${encodeURIComponent(fmt)}` : '');
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: String(text), model_id: model,
      ...(opts.voiceSettings ? { voice_settings: opts.voiceSettings } : {}),
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`ElevenLabs HTTP ${r.status}: ${body.slice(0, 160)}`);
  }
  const d = await r.json();
  const buf = Buffer.from(String(d?.audio_base64 ?? ''), 'base64');
  // [무음 감지] synthesize() 와 같은 기준. 여기서 안 잡으면 소리 없는 장면이 그대로 합성된다.
  if (buf.length < MIN_AUDIO_BYTES) {
    throw new Error(`무음 의심 — ${buf.length} bytes (voice=${voiceId})`);
  }
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, buf);

  const alignment = d?.alignment ?? d?.normalized_alignment ?? null;
  const ends = alignment?.character_end_times_seconds ?? [];
  const durationSec = ends.length ? Number(ends[ends.length - 1]) : 0;
  if (!alignment || !durationSec) {
    throw new Error('alignment 없음 — 자막 타이밍을 만들 수 없다(모델/엔드포인트 확인)');
  }
  return { path: outPath, alignment, durationSec };
}

const PROVIDERS = { mac: macProvider, elevenlabs: elevenProvider };

export function listProviders() { return Object.keys(PROVIDERS); }

/** 사용 가능한 ElevenLabs 음성 목록. 키가 있어야 동작한다. */
export async function listElevenVoices() {
  const key = envValue('ELEVENLABS_API_KEY');
  if (!key) throw new Error('ELEVENLABS_API_KEY 없음 — .env.local 에 추가하라');
  const r = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': key }, signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`ElevenLabs voices HTTP ${r.status}`);
  return ((await r.json())?.voices ?? []).map((v) => ({
    id: v.voice_id, name: v.name, labels: v.labels ?? {}, category: v.category,
  }));
}

/**
 * @param {string} text 읽을 대본
 * @param {{provider?:string, voice?:string, model?:string, rate?:number, outPath:string, apiKey?:string}} opts
 * @returns {Promise<string>} 생성된 오디오 경로
 */
export async function synthesize(text, opts = {}) {
  const name = opts.provider ?? envValue('TTS_PROVIDER') ?? 'mac';
  // locale 을 주면 언어별 앵커 음성을 자동 선택한다(voice 를 직접 주면 그게 우선).
  if (!opts.voice && opts.locale) opts = { ...opts, voice: voiceForLocale(opts.locale) };
  const fn = PROVIDERS[name];
  if (!fn) throw new Error(`알 수 없는 TTS 공급자: ${name} (가능: ${listProviders().join(', ')})`);
  if (!opts.outPath) throw new Error('outPath 필요');
  if (!text || !String(text).trim()) throw new Error('빈 대본');
  await fn(String(text), opts);
  // [무음 감지] 설치 안 된 음성·빈 응답을 성공으로 넘기면 소리 없는 영상이 나간다.
  //   실측: 맥의 미설치 ko_KR 음성은 입력과 무관하게 4,800 bytes 고정 파일을 만든다.
  const size = existsSync(opts.outPath) ? statSync(opts.outPath).size : 0;
  if (size < MIN_AUDIO_BYTES) {
    throw new Error(`무음 의심 — ${size} bytes (voice=${opts.voice ?? '기본'}). 음성이 설치/지원되지 않았을 수 있다`);
  }
  return opts.outPath;
}
