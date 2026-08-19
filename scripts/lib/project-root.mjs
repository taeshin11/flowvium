/**
 * project-root.mjs — 프로젝트 루트를 유도한다. 절대경로를 박지 않는다.
 *
 * 2026-08-20: 16개 감사·검증 스크립트가 `C:/Flowvium` 을 리터럴로 들고 있었다. 맥 이관 후
 * 전부 오작동했고, check-uncommitted-risk 는 실패를 성공으로 보고했다(거짓 초록).
 * 이 파일은 scripts/lib 에 있으므로 상위 두 단계가 루트다. FLOWVIUM_ROOT 로 덮을 수 있다.
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const DERIVED = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export function projectRoot() { return process.env.FLOWVIUM_ROOT || DERIVED; }
export function fromRoot(...seg) { return resolve(projectRoot(), ...seg); }
export const ROOT = projectRoot();
