/**
 * face-opener.mjs — 쇼츠 첫 화면에 얼굴 사진을 둔다(한 이슈 편). 근거·규칙은 face-opener.test.mjs 머리말.
 */
import { personMismatch } from './face-check.mjs';

/**
 * 첫 장면과 그림을 바꿀 장면 번호. 바꿀 것이 없거나 모르면 -1.
 * @param {Array<{hook?:string, media?:string|null, sourceTitle?:string, isOutro?:boolean}>} scenes
 * @param {{facesAt:(k:number)=>number|null, chartAt?:(k:number)=>number|null, brief?:boolean}} o
 */
export function faceOpenerIndex(scenes, { facesAt, chartAt = () => 0, brief = false }) {
  if (brief) return -1;
  const first = scenes.findIndex((x) => !x.isOutro);
  if (first < 0 || !scenes[first].media || facesAt(first) !== 0) return -1;
  for (let k = first + 1; k < scenes.length; k++) {
    const x = scenes[k];
    if (x.isOutro || !x.media || x.media === scenes[first].media) continue;
    const n = facesAt(k);
    if (!n || n < 1 || !x.sourceTitle) continue;   // 출처 제목이 없으면 누구 얼굴인지 못 댄다
    if ((chartAt(k) ?? 1) >= 0.3) continue;
    if (personMismatch({ hook: scenes[first].hook, sourceTitle: x.sourceTitle, faces: n, isPerson: true })) continue;
    return k;
  }
  return -1;
}
