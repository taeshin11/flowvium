/**
 * dart-parse.mjs — DART corpCode XML → { stockCode: {corpCode, corpName} }.
 *
 * 배경(2026-08-20): 이 파싱은 fetch-dart-corp-codes.mjs 안에 인라인으로 있었고 엔티티를 디코드하지
 *   않아 "S&amp;T중공업" 같은 이름이 그대로 데이터에 실렸다. 그때 나는 산출물 JSON 을 디코드해서
 *   고쳤는데 — 생산자는 그대로였으니 증상 처치였다. 그 잡이 별개 결함(PowerShell unzip)으로
 *   537시간 멈춰 있어 재발이 드러나지 않았을 뿐이다. 생산 지점에서 디코드하고 테스트로 고정한다.
 */
// news-sanitize 의 decodeEntities 는 뉴스 피드용이라 이중 인코딩(&amp;quot;)을 풀려고 최대 2회 디코드한다.
// DART 는 규격에 맞게 단일 인코딩된 XML 이므로 2회 디코드는 의미론적으로 틀리다 —
// 이름에 문자열 "&amp;" 가 실제로 들어 있으면 원문을 손실시킨다. XML 규격대로 1회만 푼다.
import { decodeXML } from 'entities';

/** @returns {{ map: Record<string,{corpCode:string,corpName:string}>, total:number, listed:number }} */
export function parseCorpXml(xml) {
  // <list><corp_code>00126380</corp_code><corp_name>삼성전자</corp_name>
  //       <stock_code>005930</stock_code><modify_date>20240315</modify_date></list>
  const listRe = /<list>([\s\S]*?)<\/list>/g;
  const map = {};
  let total = 0, listed = 0, m;
  while ((m = listRe.exec(xml)) !== null) {
    total++;
    const body = m[1];
    const corpCode = body.match(/<corp_code>(\d+)<\/corp_code>/)?.[1];
    const rawName  = body.match(/<corp_name>([^<]+)<\/corp_name>/)?.[1]?.trim();
    const stockCode = body.match(/<stock_code>([^<\s]+)<\/stock_code>/)?.[1]?.trim();
    // 6자리 stock_code 만 = KOSPI/KOSDAQ/KONEX 상장사
    if (!corpCode || !stockCode || stockCode.length !== 6) continue;
    map[stockCode] = { corpCode, corpName: rawName ? decodeXML(rawName) : stockCode };
    listed++;
  }
  return { map, total, listed };
}
