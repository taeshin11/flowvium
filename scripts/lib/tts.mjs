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
async function elevenProvider(text, { voice, model = 'eleven_multilingual_v2', outPath, apiKey }) {
  const key = apiKey ?? envValue('ELEVENLABS_API_KEY');
  if (!key) {
    throw new Error('ELEVENLABS_API_KEY 없음 — .env.local 에 추가하라(대화·CLI 인자로 넘기지 말 것)');
  }
  const voiceId = voice || envValue('ELEVENLABS_VOICE_ID');
  if (!voiceId) throw new Error('voice 미지정 — ELEVENLABS_VOICE_ID 를 .env.local 에 넣거나 voice 로 전달하라');
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: model }),
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
