/* ================= THE MONEY GATE =================================
   fee() decides what Benny invoices. Nothing was asserting that Carmen is
   $5,890.84 and Donna Rains is $61,264 — so any refactor could quietly change
   what he bills a client and the first person to notice would be the client.

   This pins the arithmetic to known answers. Every case below is either a real
   job off his board or one of his stated deal terms. If a change here is
   deliberate, update the expectation in the same commit and say why. If it
   isn't, this fails the push.

   Run:  node money-check.js                                                */
const fs = require("fs");
const vm = require("vm");

const html = fs.readFileSync("./index.html", "utf8");
const script = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)][0][1];

/* ---- a sandbox with just enough app to run the money code ---- */
const ctx = {
  console,
  D: { jobs: [], me: { rate: 2, hourRate: 85, terms: "Due on completion" }, accounts: [], notes: [], files: [] },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  navigator: { serviceWorker: null, userAgent: "node" },
  setInterval: () => 0, setTimeout: () => 0, requestAnimationFrame: () => 0,
  document: {
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    addEventListener: () => {}, createElement: () => ({ style: {}, classList: { add(){}, remove(){}, toggle(){} } }),
    documentElement: { style: { setProperty(){} } }, body: { appendChild(){} },
  },
};
/* The app calls window.addEventListener at line ~1746, TEN LINES ABOVE
   `const onRetainer`. Without this stub the script dies there, onRetainer is
   never initialized, and moneyState() throws a TDZ error that looks like an
   app bug but is purely an artefact of the harness. Stub it and the whole
   file runs to completion. */
ctx.window = ctx;
ctx.addEventListener = () => {};
vm.createContext(ctx);

/* Freeze the clock instead of redefining the app's date helpers.
   An earlier version of this file pre-declared today()/ago() in the sandbox so
   the tests would have a fixed date. The app declares those too, so the whole
   script died on "Identifier 'today' has already been declared" — a parse
   error, which means NOTHING loaded and the gate reported a useless failure.
   Stub Date instead: the app's own today() then returns the frozen day. */
const FROZEN = new Date("2026-08-08T12:00:00Z").getTime();
const RealDate = Date;
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(FROZEN); else super(...a); }
  static now() { return FROZEN; }
}
ctx.Date = FakeDate;

/* Run the app. Its top-level boot code (render, service worker, listeners)
   will throw in Node — expected. Function declarations are hoisted, so
   everything we need is defined regardless. What we must NOT tolerate is a
   parse error, which is why fee() is checked immediately below. */
try { vm.runInContext(script, ctx); } catch (e) { ctx.__bootErr = e.message; }
if (typeof ctx.fee !== "function") {
  console.error("FAIL — fee() did not load, so the script did not parse in the sandbox.");
  if (ctx.__bootErr) console.error("  " + ctx.__bootErr);
  process.exit(1);
}
/* Only `function name(){}` declarations become properties of the sandbox
   global. Helpers written as `const subTotal = j => ...` are lexical bindings
   — fee() closes over them and works fine, but they are not reachable from
   out here. So we check what we CALL, not what fee() uses internally. */
for (const fn of ["moneyState", "MONEY"]) {
  if (typeof ctx[fn] !== "function") { console.error(`FAIL — ${fn}() did not load.`); process.exit(1); }
}
if (ctx.__bootErr) console.log("(app boot stopped in Node: " + ctx.__bootErr + " — expected, no DOM)\n");

/* The app declares `let D`, which is a LEXICAL binding, not a property of the
   global object. So ctx.D out here and the D that MONEY() reads are two
   different objects — an earlier version of this file set ctx.D.jobs and every
   bucket came back 0/0, which looked like a broken engine and was a broken
   harness. Bridge functions declared INSIDE the sandbox close over the real D. */
vm.runInContext(`
  globalThis.__setJobs = js => { D.jobs = js; };
  globalThis.__money   = () => JSON.stringify(MONEY(), (k,v) => k === "jobs" ? undefined : v);
  globalThis.__fee     = j  => { D.jobs = [j]; return JSON.stringify(fee(j)); };
  globalThis.__state   = j  => { D.jobs = [j]; return moneyState(j); };
`, ctx);
const feeOf   = j => JSON.parse(ctx.__fee(j));
const stateOf = j => ctx.__state(j);

/* ---- the cases ------------------------------------------------------- */
/* Subs are NOT {name, amount} objects. The app stores j.subs as an array of
   sub IDs and j.subCosts as {id: amount} — an earlier version of this file
   passed objects, subTotal() read 0 from them, and the after-subs cases
   "failed" against perfectly correct fee math. withSubs() builds the real
   shape so the tests exercise what the app actually does. */
const J = (o) => Object.assign({
  id: o.id || "j", status: "Estimating", total: 0, advance: 0, feeMode: "pct",
  flat: 0, subs: [], subCosts: {}, extras: [], payments: [],
}, o);
const withSubs = (job, amounts) => {
  job.subs = amounts.map((_, i) => "s" + i);
  job.subCosts = {};
  amounts.forEach((a, i) => { job.subCosts["s" + i] = a; });
  return job;
};

const CASES = [
  /* --- his real board, as of 2026-08-08 --- */
  { name: "Carmen Hernandez — GD mit, 10% after subs, $2k paid",
    job: J({ total: 58908.37, feeMode: "aftersubs", feePct: 10, feeLocked: true,
             status: "Invoiced", invDate: "2026-07-31", disputeStage: "Demand sent",
             payments: [{ amount: 2000, note: "Green Dynasty" }] }),
    expect: { feeOnly: 5890.837, due: 3890.837, state: "contested" } },

  { name: "Donna Rains — GD remodel, 40% after subs",
    job: J({ total: 153160, feeMode: "aftersubs", feePct: 40, feeLocked: true,
             status: "Invoiced", invDate: "2026-04-25", disputeStage: "Pre-suit" }),
    expect: { feeOnly: 61264, due: 61264, state: "contested" } },

  /* --- the Green Dynasty terms he stated, as arithmetic --- */
  { name: "GD mitigation $40k, 10% after $10k subs",
    job: withSubs(J({ total: 40000, feeMode: "aftersubs", feePct: 10 }), [10000]),
    expect: { feeOnly: 3000, due: 3000, subs: 10000, state: "working" } },

  { name: "GD remodel $100k, 40% after $25k subs",
    job: withSubs(J({ total: 100000, feeMode: "aftersubs", feePct: 40 }), [15000, 10000]),
    expect: { feeOnly: 30000, due: 30000, subs: 25000, state: "working" } },

  /* --- each fee mode --- */
  { name: "straight percentage — 2% of $38,500",
    job: J({ total: 38500, feeMode: "pct", feePct: 2 }),
    expect: { feeOnly: 770, due: 770, state: "working" } },

  { name: "flat fee ignores the total",
    job: J({ total: 250000, feeMode: "flat", flat: 500 }),
    expect: { feeOnly: 500, due: 500, state: "working" } },

  { name: "retainer bills nothing but records what it was worth",
    job: J({ total: 50000, feeMode: "retainer", feePct: 10, status: "Complete" }),
    expect: { feeOnly: 0, due: 0, wouldBe: 5000, state: "covered" } },

  /* --- money states --- */
  { name: "finished, never invoiced — the fastest cash",
    job: J({ total: 20000, feeMode: "pct", feePct: 10, status: "Complete" }),
    expect: { due: 2000, state: "unbilled" } },

  { name: "invoiced inside terms is not late",
    job: J({ total: 20000, feeMode: "pct", feePct: 10, status: "Invoiced",
             invDate: "2026-08-07", terms: "Net 30" }),
    expect: { due: 2000, state: "sent" } },

  { name: "invoiced past terms is late",
    job: J({ total: 20000, feeMode: "pct", feePct: 10, status: "Invoiced",
             invDate: "2026-06-01", terms: "Net 30" }),
    expect: { due: 2000, state: "late" } },

  { name: "an invoice with no date counts as late, not fresh",
    job: J({ total: 20000, feeMode: "pct", feePct: 10, status: "Invoiced" }),
    expect: { state: "late" } },

  { name: "paid is banked at gross, not due",
    job: J({ total: 20000, feeMode: "pct", feePct: 10, status: "Paid",
             invDate: "2026-07-01", paidDate: "2026-07-10" }),
    expect: { state: "banked" } },

  { name: "a dispute beats every UNPAID state",
    job: J({ total: 20000, feeMode: "pct", feePct: 10, status: "Complete",
             disputeStage: "Mediation" }),
    expect: { state: "contested" } },

  /* Found live on his board: Benny & Donna Rains is Paid $8,930.51 and still
     carries the Rains disputeStage, so collected cash was being reported as
     contested. Money that arrived is not money at risk. */
  { name: "paid beats contested — cash in hand is not at risk",
    job: J({ total: 20000, feeMode: "pct", feePct: 10, status: "Paid",
             paidDate: "2026-08-09", disputeStage: "Filed" }),
    expect: { state: "banked" } },

  /* Also found live: three closed retainer jobs read "Collected · $0" because
     covered was only reachable from Complete. */
  { name: "retainer stays covered after it's marked Paid",
    job: J({ total: 50000, feeMode: "retainer", feePct: 10, status: "Paid",
             paidDate: "2026-08-05" }),
    expect: { wouldBe: 5000, state: "covered" } },

  { name: "retainer with extras is billable, not covered",
    job: J({ total: 50000, feeMode: "retainer", status: "Complete",
             extras: [{ label: "Site meeting", amount: 350 }] }),
    expect: { due: 350, state: "unbilled" } },

  { name: "lost is not money",
    job: J({ total: 99999, feeMode: "pct", feePct: 50, status: "Lost" }),
    expect: { state: "lost" } },

  /* --- the things that have bitten before --- */
  { name: "advance reduces what's due but not what was earned",
    job: J({ total: 10000, feeMode: "pct", feePct: 10, advance: 400 }),
    expect: { feeOnly: 1000, due: 600 } },

  { name: "extras bill on top of a retainer",
    job: J({ total: 50000, feeMode: "retainer", status: "Complete",
             extras: [{ label: "Adjuster meeting", amount: 350 }] }),
    expect: { feeOnly: 0, extras: 350, due: 350 } },

  { name: "subs bigger than the total cannot make the fee negative",
    job: withSubs(J({ total: 10000, feeMode: "aftersubs", feePct: 40 }), [25000]),
    expect: { feeOnly: 0, due: 0 } },

  { name: "overpayment never shows as a negative amount due",
    job: J({ total: 10000, feeMode: "pct", feePct: 10, advance: 5000 }),
    expect: { due: 0, over: 4000 } },
];

/* ---- run ---- */
const near = (a, b) => Math.abs((a || 0) - (b || 0)) < 0.005;
let failed = 0;
console.log("case".padEnd(56) + "field".padEnd(10) + "want".padEnd(14) + "got");
console.log("-".repeat(96));
for (const c of CASES) {
  let f;
  try { f = feeOf(c.job); } catch (e) { console.log(c.name.padEnd(56) + "THREW  " + e.message); failed++; continue; }
  for (const [k, want] of Object.entries(c.expect)) {
    const got = k === "state" ? stateOf(c.job) : f[k];
    const ok = k === "state" ? got === want : near(got, want);
    if (!ok) {
      failed++;
      console.log(c.name.slice(0, 54).padEnd(56) + k.padEnd(10)
        + String(want).padEnd(14) + String(got) + "   <-- FAIL");
    }
  }
}

/* ---- the bucket totals, on his real board shape ---- */
ctx.__setJobs([
  J({ id: "a", total: 58908.37, feeMode: "aftersubs", feePct: 10, status: "Invoiced",
      invDate: "2026-07-31", disputeStage: "Demand sent", payments: [{ amount: 2000 }] }),
  J({ id: "b", total: 153160, feeMode: "aftersubs", feePct: 40, status: "Invoiced",
      invDate: "2026-04-25", disputeStage: "Pre-suit" }),
  J({ id: "c", total: 20000, feeMode: "pct", feePct: 10, status: "Complete" }),
  J({ id: "d", total: 30000, feeMode: "pct", feePct: 10, status: "Invoiced",
      invDate: "2026-08-07", terms: "Net 30" }),
]);
const M = JSON.parse(ctx.__money());
const BUCKETS = [
  ["contested", 65154.837, 2],
  ["unbilled", 2000, 1],
  ["sent", 3000, 1],
  ["collectable", 5000, 2],
];
for (const [k, amt, n] of BUCKETS) {
  const got = M[k];
  if (!near(got.amt, amt) || got.n !== n) {
    failed++;
    console.log(("MONEY()." + k).padEnd(56) + "amt/n".padEnd(10)
      + `${Math.round(amt)}/${n}`.padEnd(14) + `${Math.round(got.amt)}/${got.n}   <-- FAIL`);
  }
}
/* sealed case money must not appear in any bucket — it lives on Disputes */
ctx.D.jobs.push({ id: "sealedpaid", status: "Paid", total: 89305.05, feeMode: "aftersubs",
  feePct: 10, paidDate: "2026-08-09", sealed: true, subs: [], subCosts: {}, extras: [], payments: [] });
const M2 = JSON.parse(ctx.__money());
if (Math.round(M2.banked.amt) !== Math.round(M.banked.amt)) {
  failed++;
  console.log("a SEALED Paid job leaked into banked   <-- FAIL");
}
/* the defect this engine exists to prevent */
if (M.collectable.amt >= M.contested.amt) {
  failed++;
  console.log("collectable must NOT include contested money   <-- FAIL");
}

console.log("-".repeat(96));
if (failed) {
  console.error(`\n${failed} money assertion(s) failed. Do not push — this changes what he invoices.`);
  process.exit(1);
}
console.log(`PASS — ${CASES.length} fee cases and ${BUCKETS.length} bucket totals hold.`);
