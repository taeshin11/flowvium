#!/usr/bin/env node
/**
 * notify-peer.mjs — 같은 기기의 다른 세션에 "지금 무거운 걸 시작한다" 를 남긴다.
 *
 * 왜 (2026-09-12): 같은 맥미니(48GB)를 쓰는 세션이 **오늘만 두 번 메모리 부족으로 강제 종료**됐다.
 *   우리 보고서 회차가 28GB 모델을 30~60분 붙잡는 순간이 그 원인일 가능성이 크다
 *   (상대 실측: 여유가 3GB 아래로 내려가면 macOS 가 끊는다).
 *   서로 언제 무거운지 모르면 같은 기기에서 계속 부딪힌다.
 *
 * 세션 간 메시지는 사람이 보내는 것이라 스크립트가 직접 못 보낸다.
 *   대신 **공유 파일**에 남긴다 — 상대 세션이 읽을 수 있고, 우리 모니터도 읽는다.
 *   파일 한 줄이면 충분하다. 서로 폴링하지 않고, 필요할 때 들여다본다.
 *
 * 사용: node scripts/notify-peer.mjs --event report-start --detail "evening 회차 · 28GB · ~45분"
 *       node scripts/notify-peer.mjs --event report-end
 */
import { appendFileSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const EVENT = arg('--event');
const DETAIL = arg('--detail', '');
if (!EVENT) { console.error('사용: --event <이름> [--detail "..."]'); process.exit(2); }

// 홈 아래 공유 폴더 — 어느 세션이든 같은 경로로 읽는다. 저장소 안에 두면 git 에 딸려 간다.
const DIR = join(homedir(), 'flowvium_runtime');
const LOG = join(DIR, 'machine-load.log');
const NOW = join(DIR, 'machine-load-now.json');

mkdirSync(DIR, { recursive: true });
const at = new Date().toISOString();
const line = `${at} [flowvium] ${EVENT}${DETAIL ? ` — ${DETAIL}` : ''}`;

try { appendFileSync(LOG, line + '\n'); } catch (e) { console.error(`로그 못 씀: ${e.message}`); }

// 지금 무엇이 도는지 한 눈에 — 끝나면 비운다. 상대가 이 파일 하나만 보면 된다.
try {
  const cur = existsSync(NOW) ? JSON.parse(readFileSync(NOW, 'utf8')) : {};
  if (EVENT.endsWith('-end')) delete cur[EVENT.replace(/-end$/, '')];
  else cur[EVENT.replace(/-start$/, '')] = { since: at, detail: DETAIL };
  writeFileSync(NOW, JSON.stringify(cur, null, 1));
} catch (e) { console.error(`상태 파일 못 씀: ${e.message}`); }

console.log(line);
