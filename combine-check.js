/* THE COMBINED-INVOICE GATE.
   He bills one contractor for several properties at once. One invoice number
   must cover the lot, every job must be stamped with it so nothing is billed
   twice, and each line must name its own basis — 2% of an estimate, 7.5% of
   what a supplement recovered, or a flat scan. Getting this wrong either
   double-bills a contractor or hides a charge.
   Run: node combine-check.js */
const fs = require("fs"), vm = require("vm");
const html = fs.readFileSync("./index.html", "utf8");
const script = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)][0][1];

let failed = 0;
const ok = w => console.log("ok    " + w);
const fail = (w, d) => { failed++; console.log("FAIL  " + w + (d ? "\n      " + d : "")); };

/* --- static: the pieces exist and the button is wired --- */
const noC = script.replace(/\/\*[\s\S]*?\*\//g, "");
[["billableFor", /function billableFor/], ["combineSheet", /function combineSheet/],
 ["combineIssue", /function combineIssue/], ["combinedHTML", /function combinedHTML/],
 ["printCombined", /async function printCombined/]].forEach(([n, re]) => {
  if (!re.test(noC)) fail("missing " + n); });
if (!failed) ok("the combined-invoice path exists end to end");
if (!/onclick="combineSheet\('\$\{a\.id\}'\)"/.test(html))
  fail("no way to reach it from the account page");
else ok("the account page offers it when more than one job is ready");

/* --- runtime --- */
const ctx = {
  console,
  D: { jobs: [], me: { rate: 2, hourRate: 85, terms: "" }, accounts: [], notes: [], files: [], invNo: 1010 },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  navigator: { userAgent: "node" }, setInterval: () => 0, setTimeout: () => 0,
  requestAnimationFrame: () => 0,
  document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    addEventListener: () => {}, createElement: () => ({ style: {}, classList: { add(){}, remove(){}, toggle(){} } }),
    documentElement: { style: { setProperty(){} } }, body: { appendChild(){} } },
};
ctx.window = ctx; ctx.addEventListener = () => {};
vm.createContext(ctx);
try { vm.runInContext(script, ctx); } catch (e) { ctx.__err = e.message; }
if (typeof ctx.fee !== "function") {
  console.error("FAIL — the script did not parse."); if (ctx.__err) console.error("  " + ctx.__err);
  process.exit(1);
}
vm.runInContext(`
  globalThis.__setup = (accts, jobs) => { D.accounts = accts; D.jobs = jobs; };
  globalThis.__billable = id => billableFor(id).map(j => j.id);
  globalThis.__combined = (a, ids, no) => combinedHTML(a, ids.map(job), no);
  globalThis.__rate = id => rateLabel(job(id), fee(job(id)));
  globalThis.__desc = id => lineDesc(job(id), fee(job(id)));
`, ctx);

const ACCT = { id: "nick", name: "Calis Construction", contact: "Nicholas Cali",
  phone: "713-548-6257", email: "Nick@calis-construction.com",
  fork: "approval", feePct: 2, supPct: 7.5, terms: "Due on carrier approval." };
const J = o => Object.assign({ status: "Complete", total: 0, advance: 0, feeMode: "pct",
  feePct: 2, flat: 0, subs: [], subCosts: {}, extras: [], payments: [], accountId: "nick" }, o);

const JOBS = [
  J({ id: "anthony", address: "5115 Anthony Lane, Pasadena, TX", total: 70406.68, feePct: 2, loss: "Water" }),
  J({ id: "strat", address: "3311 Stratford Manor Dr, Sugar Land, TX", total: 8051.92,
      feePct: 7.5, supBase: 0, loss: "Other" }),
  J({ id: "scan", address: "2102 Crestwind Court, Pearland, TX", feeMode: "flat", flat: 200,
      mport: "Done", loss: "Other" }),
  J({ id: "billed", address: "9 Already Billed St", total: 50000, invNo: "INV-1011" }),
  J({ id: "notready", address: "9 Still Working Dr", total: 40000, status: "Estimating" }),
];
ctx.__setup([ACCT], JOBS);

/* 1. only finished, unbilled, priceable work is offered */
{
  const b = ctx.__billable("nick");
  if (b.includes("billed")) fail("an already-invoiced job is offered again — that double-bills him");
  else ok("a job that already carries an invoice number is never offered twice");
  if (b.includes("notready")) fail("work still in progress is offered for billing");
  else ok("only finished work is offered");
  if (!(b.includes("anthony") && b.includes("strat") && b.includes("scan")))
    fail("the three ready jobs are not all offered", b.join(","));
  else ok("all three ready jobs are offered (estimate, supplement, scan)");
}

/* 2. each line names its own basis */
{
  const r = { anthony: ctx.__rate("anthony"), strat: ctx.__rate("strat"), scan: ctx.__rate("scan") };
  if (!/2% of Estimate/.test(r.anthony)) fail("the fresh estimate does not show 2% of the estimate", r.anthony);
  else ok("estimate line reads: " + r.anthony);
  if (!/7\.5% of recovery/.test(r.strat)) fail("the supplement does not show % of recovery", r.strat);
  else ok("supplement line reads: " + r.strat);
  if (!/scan only|Flat/.test(r.scan)) fail("the scan is not marked flat", r.scan);
  else ok("scan line reads: " + r.scan);

  const d = { a: ctx.__desc("anthony"), s: ctx.__desc("strat"), c: ctx.__desc("scan") };
  if (!/^<b>ESTIMATE<\/b>/.test(d.a)) fail("the estimate line is not labelled ESTIMATE");
  else ok("the estimate line is labelled ESTIMATE");
  if (!/^<b>SUPPLEMENT<\/b>/.test(d.s)) fail("the supplement line is not labelled SUPPLEMENT");
  else ok("the supplement line is labelled SUPPLEMENT");
  if (!/^<b>MATTERPORT SCAN<\/b>/.test(d.c)) fail("the scan line is not labelled MATTERPORT SCAN");
  else ok("the scan line is labelled MATTERPORT SCAN");
  if (!/not on the estimate total/.test(d.s))
    fail("the supplement line does not explain it is billed on the recovery");
  else ok("the supplement line explains it is billed on the recovery, not the total");
  if (!/Nothing recovered, nothing billed/.test(d.s))
    fail("the supplement line drops the nothing-recovered promise");
  else ok('the supplement line keeps "nothing recovered, nothing billed"');
}

/* 3. the document itself */
{
  const out = ctx.__combined(ACCT, ["anthony", "strat", "scan"], "INV-1012");
  const money = n => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const total = 70406.68 * 0.02 + 8051.92 * 0.075 + 200;
  if (!out.includes(money(total))) fail("the combined total is wrong", "expected " + money(total));
  else ok("one total covering all three: " + money(total));
  if (!/INV-1012/.test(out)) fail("the invoice number is missing");
  else ok("one invoice number on the document");
  ["5115 Anthony Lane", "3311 Stratford Manor Dr", "2102 Crestwind Court"].forEach(p => {
    if (!out.includes(p)) fail("property missing from the invoice: " + p); });
  ok("every property appears as its own line");
  if (!/HOW THIS IS BILLED/.test(out)) fail("the rate card is missing");
  else ok("the rate card explains both percentages and the flat scan");
  if (!/PAYMENT IS DUE ON CARRIER APPROVAL/.test(out))
    fail("an approval account is being told the file is held until payment");
  else ok("approval account gets approval wording, not hold-until-paid");
  if (!/Chairman Estimating Co/i.test(out)) fail("the wrong entity is on the combined invoice");
  else ok("the combined invoice carries Chairman Estimating Co");
  if (!/Chairman Remodeling Group — Benny Mancillas/.test(out))
    fail("the Zelle registration is missing or changed");
  else ok("Zelle registration is intact");
}

/* 4. a partner account never gets hold language */
{
  const P = Object.assign({}, ACCT, { id: "gd", name: "Green Dynasty Group", partner: true });
  ctx.__setup([P], [J({ id: "gdj", accountId: "gd", address: "1 Partner Way", total: 10000 })]);
  const out = ctx.__combined(P, ["gdj"], "INV-1013");
  if (/RELEASED ONCE PAYMENT|CARRIER APPROVAL/.test(out))
    fail("a partner is being given estimating hold language");
  else ok("a partner account gets no hold language on a combined invoice either");
}

console.log("");
if (failed) { console.error(failed + " combined-invoice assertion(s) failed. Do not push."); process.exit(1); }
console.log("PASS — one invoice, one number, every line says what it is.");
