import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const COST = 0.40, MEM = 1, DAYS = 30, FREE = 1000, WARN = 5;

function freq(s) {
  const p = s.trim().split(/\s+/);
  if (p.length !== 5) return 1;
  const [min, hr, dom, , dow] = p;
  if (min.startsWith("*/")) { const n = parseInt(min.slice(2)); if (n > 0) return 1440/n; }
  if (hr.startsWith("*/")) { const n = parseInt(hr.slice(2)); if (n > 0) return 24/n; }
  if (dow !== "*" && dom === "*") return dow.split(",").length / 7;
  return (hr === "*" ? 24 : hr.split(",").length) * (min === "*" ? 60 : min.split(",").length);
}

function par(filePath) {
  if (!existsSync(filePath)) return 1;
  try {
    const s = readFileSync(filePath, "utf8");
    const reFetch = new RegExp("fetch\(", "g");
    const reSafe  = new RegExp("safeJson\(", "g");
    const rePa    = new RegExp("Promise\.all(?:Settled)?\(", "g");
    const t = (s.match(reFetch)||[]).length + (s.match(reSafe)||[]).length;
    if (t > 20) return Math.max(1, Math.ceil(t / 5));
    const pa = (s.match(rePa)||[]).length;
    return pa > 2 ? pa : 1;
  } catch { return 1; }
}

function dur(ap, fns) {
  const sp = "src/app" + ap + "/route.ts";
  for (const [k, v] of Object.entries(fns)) if (k === sp && v.maxDuration) return v.maxDuration;
  const fp = resolve(root, sp);
  if (existsSync(fp)) {
    try {
      const s = readFileSync(fp, "utf8");
      const re = new RegExp("export\s+const\s+maxDuration\s*=\s*(\d+)");
      const m = s.match(re);
      if (m) return parseInt(m[1]);
    } catch {}
  }
  return 10;
}

const cfg = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8"));
const rows = []; let tot = 0;
for (const c of cfg.crons||[]) {
  const f = freq(c.schedule), d = dur(c.path, cfg.functions||{}), p2 = par(resolve(root, "src/app"+c.path+"/route.ts"));
  const g = f * DAYS * (d/3600) * MEM * p2, cost = g * COST;
  tot += g;
  rows.push({ path: c.path, sched: c.schedule, f, d, p: p2, g, cost, w: cost > WARN });
}
rows.sort((a,b) => b.g - a.g);
const paid = Math.max(0, tot - FREE);

console.log("");
console.log("=== Vercel Cron Cost Estimate (monthly, Vercel Pro) ===");
console.log("");
const HDR = "Path".padEnd(50)+"Schedule".padEnd(18)+"Freq/d".padStart(8)+"Dur".padStart(6)+"Par".padStart(5)+"GB-h/mo".padStart(10)+"Cost/mo".padStart(10);
console.log(HDR);
console.log("-".repeat(107));
for (const r of rows) {
  const flag = r.w ? "  WARNING" : "";
  const line = r.path.padEnd(50)+r.sched.padEnd(18)+r.f.toFixed(1).padStart(8)+String(r.d).padStart(6)+String(r.p).padStart(5)+r.g.toFixed(2).padStart(10)+("$"+r.cost.toFixed(2)).padStart(10)+flag;
  console.log(line);
}
console.log("-".repeat(107));
console.log("TOTAL".padEnd(87)+tot.toFixed(2).padStart(10)+"(pre-tier)".padStart(10));
console.log("");
console.log("Free tier: "+FREE+" GB-h/mo");
console.log("Raw usage: "+tot.toFixed(2)+" GB-h/mo");
console.log("Overage:   "+paid.toFixed(2)+" GB-h/mo");
console.log("Est. overage cost: "+(paid*COST).toFixed(2)+"/month USD");
console.log("");
const warns = rows.filter(r => r.w);
if (warns.length > 0) {
  console.error("WARNING: crons exceeding "+WARN+" USD/mo:");
  warns.forEach(r => console.error("  "+r.path+" => "+r.cost.toFixed(2)+" USD/mo"));
  process.exit(1);
}
console.log("All crons within "+WARN+" USD/month threshold.");
console.log("");
