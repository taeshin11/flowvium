#!/usr/bin/env node
// measure-report-quality.mjs — meaningful, READ-ONLY quality metric for FlowVium reports.
//
// WHY: the existing `qualityScore` in generate-report-local.mjs (`qualityCheck`) is a
// presence/length checklist — it cannot detect *real* quality changes (e.g. whether a
// best-of-N portfolio selection actually produced more distinct/grounded rationales).
// This tool scores a report on THREE independent axes so generation improvements can be
// A/B-validated:
//
//   1. CORRECTNESS (lower=better) — defects from verify-report.mjs `verifyReport`
//      (falls back to a few cheap in-file probes if the import is unavailable).
//   2. INSIGHT / DISTINCTNESS (higher=better) — rationaleDistinctness, numericSpecificity,
//      signalDiversity computed from portfolio rationales/catalysts.
//   3. COVERAGE — portfolio size, distinct sectors/markets, shortSqueeze, sectorAllocation.
//
// This tool NEVER writes to any file or DB. It only reads the report JSON (and verify-report
// may do a single best-effort Yahoo fetch in its earlyWarning probe; that is non-fatal and
// already wrapped in try/catch upstream — pass --no-correctness-net to skip it entirely by
// using the local fallback probes instead of the imported verifier).
//
// USAGE:
//   node scripts/measure-report-quality.mjs <reportPath>
//   node scripts/measure-report-quality.mjs --compare <pathA> <pathB>
//   node scripts/measure-report-quality.mjs --local <reportPath>   # force fallback probes
//
// ──────────────────────────────────────────────────────────────────────────────────────
// OVERALL FORMULA (documented, range 0..100, higher=better):
//
//   correctnessScore = 100 * max(0, 1 - defectCount / 10)
//       (10+ defects → 0; each defect costs 10 points off a 100 base)
//   insightScore     = 100 * (0.45*rationaleDistinctness
//                            + 0.35*numericSpecificity
//                            + 0.20*min(1, signalDiversity))
//   coverageScore    = 100 * (
//                            0.30 * min(1, portfolioSize / 12)     // target 12 (US6+KR6)
//                          + 0.25 * min(1, distinctSectors / 6)
//                          + 0.20 * (distinctMarkets >= 2 ? 1 : distinctMarkets * 0.5)
//                          + 0.15 * (shortSqueezeNonEmpty ? 1 : 0)
//                          + 0.10 * (sectorAllocationPresent ? 1 : 0))
//
//   overall = 0.40*correctnessScore + 0.40*insightScore + 0.20*coverageScore
//
// Weights chosen so correctness (no hallucinations) and insight (distinct, grounded
// rationales) dominate equally, with coverage as a smaller structural completeness term.
// ──────────────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// ───────────────────────── tokenization (CJK-aware) ─────────────────────────
// Splits Latin words AND keeps CJK runs as individual bigrams so Korean rationales
// produce meaningful word-sets for Jaccard. Numbers kept (they carry signal).
function tokenize(s) {
  const str = String(s || '').toLowerCase();
  const tokens = new Set();
  // Latin / numeric runs
  for (const m of str.matchAll(/[a-z0-9]+/g)) {
    if (m[0].length >= 2 || /\d/.test(m[0])) tokens.add(m[0]);
  }
  // CJK: take each char + char-bigrams (Korean has no spaces inside compounds)
  const cjk = str.match(/[　-鿿가-힯]/g) || [];
  for (let i = 0; i < cjk.length; i++) {
    tokens.add(cjk[i]);
    if (i + 1 < cjk.length) tokens.add(cjk[i] + cjk[i + 1]);
  }
  return tokens;
}

function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 1 : inter / union;
}

// ───────────────────────── rationale text extraction ─────────────────────────
function rationaleStrings(report) {
  const out = [];
  for (const p of report.portfolio || []) {
    const parts = [
      p.rationale,
      p.entryRationale,
      p.targetRationale,
      p.fundamentalBasis,
      p.technicalBasis,
      ...(Array.isArray(p.catalysts) ? p.catalysts : []),
    ].filter(Boolean);
    if (parts.length) out.push(parts.join(' | '));
  }
  return out;
}

// just the catalyst + rationale strings as a flat list (for numericSpecificity)
function groundableStrings(report) {
  const out = [];
  for (const p of report.portfolio || []) {
    if (p.rationale) out.push(p.rationale);
    for (const c of Array.isArray(p.catalysts) ? p.catalysts : []) if (c) out.push(c);
    if (p.targetRationale) out.push(p.targetRationale);
    if (p.entryRationale) out.push(p.entryRationale);
  }
  return out;
}

// concrete-number detector: %, $, ₩, x/배, 달러, plain ratio/decimal digits
const NUMBER_RE = /(\d+(?:[.,]\d+)?\s*%)|([$₩]\s*\d)|(\d+(?:\.\d+)?\s*(?:x|배|달러|억|조|만))|(\d+\.\d+)|(\b\d{2,}\b)/i;
function hasConcreteNumber(s) {
  return NUMBER_RE.test(String(s || ''));
}

// signal keyword families — each distinct family referenced anywhere counts once
const SIGNAL_FAMILIES = {
  inst13F: /13f|기관\s*매수|institutional|누적\s*매수/i,
  insider: /insider|내부자/i,
  squeeze: /squeeze|스퀴즈|숏\s*커버|short\s*interest/i,
  peg: /\bpeg\b/i,
  momentum: /momentum|모멘텀|돌파|breakout/i,
  high52w: /52주|52w|52-week|연중\s*고점/i,
  opMargin: /영업이익률|operating\s*margin|op\s*margin/i,
  revGrowth: /매출.*yoy|revenue.*growth|매출\s*\+|yoy\s*성장|매출\s*성장/i,
  roe: /\broe\b|자기자본이익률/i,
  rsi: /\brsi\b/i,
  movingAvg: /\d*ma\b|이동평균|50ma|200ma/i,
  valuation: /per\b|p\/e|밸류에이션|저평가|undervalu/i,
  hbm: /hbm|메모리|반도체\s*사이클/i,
  guru: /버핏|buffett|구루|guru|13f\s*구루/i,
  flow: /순매수|외국인|자금\s*유입|fund\s*flow|회전/i,
};

// ───────────────────────── INSIGHT axis ─────────────────────────
function insightAxis(report) {
  const rationales = rationaleStrings(report);
  const tokenSets = rationales.map(tokenize);

  // rationaleDistinctness = 1 - avg pairwise Jaccard
  let distinctness = 1;
  if (tokenSets.length >= 2) {
    let sum = 0, n = 0;
    for (let i = 0; i < tokenSets.length; i++) {
      for (let j = i + 1; j < tokenSets.length; j++) {
        sum += jaccard(tokenSets[i], tokenSets[j]);
        n++;
      }
    }
    distinctness = n ? 1 - sum / n : 1;
  }

  // numericSpecificity = fraction of groundable strings containing a concrete number
  const grounds = groundableStrings(report);
  const withNum = grounds.filter(hasConcreteNumber).length;
  const numericSpecificity = grounds.length ? withNum / grounds.length : 0;

  // signalDiversity = distinct signal families referenced / portfolio size
  const allText = rationales.join('  ');
  let families = 0;
  for (const re of Object.values(SIGNAL_FAMILIES)) if (re.test(allText)) families++;
  const portSize = (report.portfolio || []).length || 1;
  const signalDiversity = families / portSize;

  return {
    rationaleDistinctness: round3(distinctness),
    numericSpecificity: round3(numericSpecificity),
    signalDiversity: round3(signalDiversity),
    _detail: {
      rationaleCount: rationales.length,
      groundableCount: grounds.length,
      groundableWithNumber: withNum,
      signalFamiliesReferenced: families,
    },
  };
}

// ───────────────────────── COVERAGE axis ─────────────────────────
function coverageAxis(report) {
  const port = report.portfolio || [];
  const sectors = new Set(port.map((p) => (p.sector || '').toLowerCase()).filter(Boolean));
  const markets = new Set(port.map((p) => (p.market || '').toLowerCase()).filter(Boolean));
  const ss = report.shortSqueeze;
  const shortSqueezeNonEmpty = Array.isArray(ss) ? ss.length > 0 : !!ss;
  const sa = report.sectorAllocation;
  const sectorAllocationPresent = Array.isArray(sa) ? sa.length > 0 : !!sa;
  return {
    portfolioSize: port.length,
    distinctSectors: sectors.size,
    distinctMarkets: markets.size,
    markets: [...markets],
    shortSqueezeNonEmpty,
    sectorAllocationPresent,
  };
}

// ───────────────────────── CORRECTNESS axis ─────────────────────────
// Prefer the authoritative verifyReport. Fall back to cheap local probes if import fails.
async function correctnessAxis(file, report, { forceLocal = false } = {}) {
  if (!forceLocal) {
    try {
      const verUrl = pathToFileURL(path.resolve('scripts/verify-report.mjs')).href;
      const mod = await import(verUrl);
      if (typeof mod.verifyReport === 'function') {
        const res = await mod.verifyReport(file, { silent: true });
        const defects = res?.defects || [];
        return {
          source: 'verifyReport',
          defectCount: defects.length,
          defects: defects.map((d) => ({
            ticker: d.ticker,
            defect_type: d.defect_type,
            severity: d.severity,
          })),
        };
      }
    } catch (e) {
      // fall through to local probes
      return { ...localProbes(report), _verifyImportError: String(e?.message || e) };
    }
  }
  return localProbes(report);
}

// Cheap re-implementation of the 4 most load-bearing probes — used only if verifyReport
// cannot be imported (e.g. its dependencies/data files are missing).
function localProbes(report) {
  const defects = [];
  const port = report.portfolio || [];

  // (a) allocation sum ≈ 100
  if (port.length) {
    const sum = Math.round(port.reduce((s, p) => s + (Number(p.allocation) || 0), 0));
    if (sum < 95 || sum > 105) {
      defects.push({ ticker: 'PORTFOLIO', defect_type: 'allocation_sum', severity: 'medium', detail: `sum=${sum}` });
    }
  }

  // (b) entry_low < entry_high (parse entryZone "$370.00-$380.00" / "₩a-₩b")
  for (const p of port) {
    const nums = String(p.entryZone || '').match(/[\d,.]+/g);
    if (nums && nums.length >= 2) {
      const lo = parseFloat(nums[0].replace(/,/g, ''));
      const hi = parseFloat(nums[1].replace(/,/g, ''));
      if (isFinite(lo) && isFinite(hi) && lo >= hi) {
        defects.push({ ticker: p.ticker, defect_type: 'entry_zone_inverted', severity: 'high', detail: `${lo}>=${hi}` });
      }
    }
  }

  // (c) ticker↔name plausibility — name present & non-trivial for each holding
  for (const p of port) {
    if (!p.name || String(p.name).trim().length < 2) {
      defects.push({ ticker: p.ticker, defect_type: 'missing_name', severity: 'high' });
    }
  }

  // (d) duplicate fractional % across distinct tickers (copy-paste hallucination)
  const pctByVal = new Map();
  for (const p of port) {
    const text = (p.fundamentalBasis || '') + ' ' + (Array.isArray(p.catalysts) ? p.catalysts.join(' ') : '');
    for (const m of text.matchAll(/(\d+\.\d+)%/g)) {
      const v = m[1];
      if (parseFloat(v) < 1) continue;
      const arr = pctByVal.get(v) || [];
      arr.push(p.ticker);
      pctByVal.set(v, arr);
    }
  }
  for (const [v, tks] of pctByVal) {
    const uniq = [...new Set(tks)];
    if (uniq.length >= 2) {
      defects.push({ ticker: uniq.join('/'), defect_type: 'dup_pct_halluc', severity: 'medium', detail: `${v}% x${uniq.length}` });
    }
  }

  return { source: 'localProbes', defectCount: defects.length, defects };
}

// ───────────────────────── scoring ─────────────────────────
function round3(n) { return Math.round(n * 1000) / 1000; }
function round1(n) { return Math.round(n * 10) / 10; }
function clamp01(n) { return Math.max(0, Math.min(1, n)); }

function scoreReport(axes) {
  const { correctness, insight, coverage } = axes;

  const correctnessScore = 100 * Math.max(0, 1 - correctness.defectCount / 10);

  const insightScore = 100 * (
    0.45 * clamp01(insight.rationaleDistinctness) +
    0.35 * clamp01(insight.numericSpecificity) +
    0.20 * clamp01(Math.min(1, insight.signalDiversity))
  );

  const coverageScore = 100 * (
    0.30 * Math.min(1, coverage.portfolioSize / 12) +
    0.25 * Math.min(1, coverage.distinctSectors / 6) +
    0.20 * (coverage.distinctMarkets >= 2 ? 1 : coverage.distinctMarkets * 0.5) +
    0.15 * (coverage.shortSqueezeNonEmpty ? 1 : 0) +
    0.10 * (coverage.sectorAllocationPresent ? 1 : 0)
  );

  const overall = 0.40 * correctnessScore + 0.40 * insightScore + 0.20 * coverageScore;

  return {
    correctnessScore: round1(correctnessScore),
    insightScore: round1(insightScore),
    coverageScore: round1(coverageScore),
    overall: round1(overall),
  };
}

async function measure(file, { forceLocal = false } = {}) {
  const abs = path.resolve(file);
  const report = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const correctness = await correctnessAxis(abs, report, { forceLocal });
  const insight = insightAxis(report);
  const coverage = coverageAxis(report);
  const scores = scoreReport({ correctness, insight, coverage });
  return {
    file: abs,
    correctness,
    insight,
    coverage,
    scores,
    overall: scores.overall,
  };
}

// ───────────────────────── compare mode ─────────────────────────
function verdict(a, b, key, higherBetter) {
  const va = a, vb = b;
  const delta = round3(vb - va);
  let better;
  if (va === vb) better = 'tie';
  else if (higherBetter) better = vb > va ? 'B' : 'A';
  else better = vb < va ? 'B' : 'A';
  return { a: va, b: vb, delta, better, key };
}

function buildComparison(rA, rB) {
  return {
    correctness: {
      defectCount: verdict(rA.correctness.defectCount, rB.correctness.defectCount, 'defectCount', false),
    },
    insight: {
      rationaleDistinctness: verdict(rA.insight.rationaleDistinctness, rB.insight.rationaleDistinctness, 'rationaleDistinctness', true),
      numericSpecificity: verdict(rA.insight.numericSpecificity, rB.insight.numericSpecificity, 'numericSpecificity', true),
      signalDiversity: verdict(rA.insight.signalDiversity, rB.insight.signalDiversity, 'signalDiversity', true),
    },
    coverage: {
      portfolioSize: verdict(rA.coverage.portfolioSize, rB.coverage.portfolioSize, 'portfolioSize', true),
      distinctSectors: verdict(rA.coverage.distinctSectors, rB.coverage.distinctSectors, 'distinctSectors', true),
      distinctMarkets: verdict(rA.coverage.distinctMarkets, rB.coverage.distinctMarkets, 'distinctMarkets', true),
    },
    scores: {
      correctnessScore: verdict(rA.scores.correctnessScore, rB.scores.correctnessScore, 'correctnessScore', true),
      insightScore: verdict(rA.scores.insightScore, rB.scores.insightScore, 'insightScore', true),
      coverageScore: verdict(rA.scores.coverageScore, rB.scores.coverageScore, 'coverageScore', true),
      overall: verdict(rA.scores.overall, rB.scores.overall, 'overall', true),
    },
    overallVerdict:
      rB.scores.overall > rA.scores.overall ? 'B better'
        : rB.scores.overall < rA.scores.overall ? 'A better'
          : 'tie',
  };
}

// ───────────────────────── CLI ─────────────────────────
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage:\n  node scripts/measure-report-quality.mjs <reportPath>\n  node scripts/measure-report-quality.mjs --compare <pathA> <pathB>\n  node scripts/measure-report-quality.mjs --local <reportPath>');
    process.exit(2);
  }

  const forceLocal = args.includes('--local');
  const positional = args.filter((a) => !a.startsWith('--'));

  if (args.includes('--compare')) {
    if (positional.length < 2) {
      console.error('--compare requires two report paths');
      process.exit(2);
    }
    const [pa, pb] = positional;
    const rA = await measure(pa, { forceLocal });
    const rB = await measure(pb, { forceLocal });
    const out = {
      mode: 'compare',
      A: rA,
      B: rB,
      comparison: buildComparison(rA, rB),
    };
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  const result = await measure(positional[0], { forceLocal });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error('[FATAL]', e?.stack || e?.message || e);
  process.exit(1);
});
