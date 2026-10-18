/**
 * bgm-beds.mjs — 배경음악 폴더에서 **출처가 적힌 곡만** 고른다. (2026-10-18 신설)
 *
 * 종전: assets/bgm 에 놓인 오디오 파일을 전부 돌려 썼다. 10/17 확인 결과 4곡 중 2곡이 사본이었고,
 *   남은 Suno 곡은 어느 계정·요금제로 만들었는지 확인이 안 됐다(상업 이용은 유료 요금제 조건).
 *   파일이 놓이기만 하면 발행에 섞이는 구조라, 출처를 모르는 곡을 막을 자리가 없었다.
 * 규칙: 같은 폴더의 SOURCES.json 에 { "<파일>": { source, license, ... } } 로 적힌 파일만 쓴다.
 *   목록이 없거나 깨졌으면 아무 곡도 쓰지 않는다 — 음악 없는 회차가 출처 모르는 음악보다 낫다.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

export const BED_RE = /\.(wav|mp3|m4a)$/i;

/** @returns {{beds:string[], skipped:string[], reason?:string}} beds 는 정렬된 파일 이름 */
export function licensedBeds(dir) {
  let files = [];
  try { files = readdirSync(dir).filter((f) => BED_RE.test(f)).sort(); } catch { return { beds: [], skipped: [], reason: '폴더 없음' }; }
  let list;
  try { list = JSON.parse(readFileSync(join(dir, 'SOURCES.json'), 'utf8')); } catch (e) {
    return { beds: [], skipped: files, reason: `SOURCES.json 을 못 읽었다(${e.code ?? e.name})` };
  }
  const has = (f) => list?.[f] && String(list[f].source ?? '').trim() && String(list[f].license ?? '').trim();
  return { beds: files.filter(has), skipped: files.filter((f) => !has(f)) };
}
