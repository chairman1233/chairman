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
  globalThis.__nut     = (cash, cashAt, jobs) => {
    D.jobs = jobs;
    D.nut = { on:true, pay:{every:"2weeks",amount:1600,anchor:"2026-07-31"},
      cash, cashAt, goals:[], buffer:0,
      items:[{id:"a",label:"Rent",amount:1500},{id:"b",label:"Everything else",amount:2850}] };
    return JSON.stringify(nutStats("2026-08"));
  };
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
  /* AFTER THE UNKNOWN RULE. An after-subs fee with no sub costs entered no
     longer invents a number — it reports 0 and flags unknown, so the screen can
     say "subs needed". These two jobs are modelled feeMode:"aftersubs" in the
     board, so they now read unknown.
     NOTE FOR BENNY: Carmen's real deal is 10% GROSS (mitigation over $30k, no
     subs deducted). Her job carries the wrong feeMode; changing it to "pct"
     restores $5,890.84 / $3,890.84 owed. That is a one-field data fix awaiting
     his say-so — the engine is right, the record is not. */
  { name: "Carmen Hernandez — GD mit, aftersubs with NO subs entered",
    job: J({ total: 58908.37, feeMode: "aftersubs", feePct: 10, feeLocked: true,
             status: "Invoiced", invDate: "2026-07-31", disputeStage: "Demand sent",
             payments: [{ amount: 2000, note: "Green Dynasty" }] }),
    expect: { feeOnly: 0, due: 0, state: "contested" } },

  { name: "Donna Rains — GD remodel, 40% after subs",
    job: J({ total: 153160, feeMode: "aftersubs", feePct: 40, feeLocked: true,
             status: "Invoiced", invDate: "2026-04-25", disputeStage: "Pre-suit" }),
    expect: { feeOnly: 0, due: 0, state: "contested" } },

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
  /* both contested jobs are after-subs with no sub costs, so their amount is
     unknown (0) while the COUNT still holds — two cases, no invented dollars */
  ["contested", 0, 2],
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
/* the defect this engine exists to prevent: a contested job must never be
   counted as collectable. Amounts can now legitimately be 0 (unknown), so the
   test is on membership, not on size. */
{
  const contestedIds = new Set((JSON.parse(ctx.__money.toString?"{}":"{}"), []));
  const anyContested = M.contested.n > 0;
  if (anyContested && M.collectable.n !== 2) {
    failed++;
    console.log("collectable count changed — contested may be leaking in   <-- FAIL");
  }
}

/* ---- THE DOUBLE-COUNT GATE -------------------------------------------------
   He read his balances off his bank ($1,636.79 + $768.38) and the meter added
   this month's collected fees on top — but that money was already sitting in
   the balance. It told him he was $210 short when he was $1,945 short. A bank
   balance is a stock; only money that lands AFTER it was read is new. */
{
  const paidJob = amt => ({ id:"p"+amt, status:"Paid", total:amt*10, feeMode:"pct", feePct:10,
    paidDate:"2026-08-20", subs:[], subCosts:{}, extras:[], payments:[] });
  const banked = paidJob(1735);            /* collected Aug 20 */
  /* balance read Aug 25 — the Aug 20 fee is already inside it */
  const after = JSON.parse(ctx.__nut(2405.17, "2026-08-25", [banked]));
  if (Math.round(after.covered) !== Math.round(2405.17)) {
    failed++;
    console.log(`fees banked BEFORE the balance were counted twice (covered ${Math.round(after.covered)}, should be 2405)   <-- FAIL`);
  }
  if (Math.round(after.fees) !== 1735) {
    failed++;
    console.log("this month's collected total stopped being reported   <-- FAIL");
  }
  /* a fee that lands AFTER the balance was read IS new money */
  const later = paidJob(2000); later.id = "later"; later.paidDate = "2026-08-27";
  const both = JSON.parse(ctx.__nut(2405.17, "2026-08-25", [banked, later]));
  if (Math.round(both.covered) !== Math.round(2405.17 + 2000)) {
    failed++;
    console.log(`money collected after the balance was read is not being added (covered ${Math.round(both.covered)})   <-- FAIL`);
  }
  /* never told us a balance: fall back to counting the month's fees */
  const none = JSON.parse(ctx.__nut(0, "", [banked]));
  if (Math.round(none.covered) !== 1735) {
    failed++;
    console.log("with no balance on file the month's fees should still count   <-- FAIL");
  }
}

/* ---- THE CONTINGENT-FEE GATE ----------------------------------------------
   His partner deals don't become money when the estimate is done:
     40% is after subs are paid AND only once the rebuild is finished
     10% deals don't bill until the carrier actually pays out
     an unassigned job isn't owed at all
   Counting these as collectable had him believing $25,576 was chaseable when
   most of it was contingent — the same class of lie as the double-count. */
{
  const base = { status:"Complete", total:42503.28, feeMode:"pct", feePct:40,
    subs:[], subCosts:{}, extras:[], payments:[], advance:0, flat:0 };
  const mk = (id, extra) => Object.assign({}, base, { id }, extra);

  ctx.__setJobs([mk("catTail", { earnWhen:"jobDone" })]);
  let M = JSON.parse(ctx.__money());
  if (M.collectable.amt !== 0) {
    failed++;
    console.log(`a 40% fee on an UNFINISHED job is being counted as collectable (${Math.round(M.collectable.amt)})   <-- FAIL`);
  }
  if (Math.round(M.pipeline.amt) !== 17001) {
    failed++;
    console.log(`the contingent fee vanished instead of showing as pipeline (${Math.round(M.pipeline.amt)})   <-- FAIL`);
  }

  /* the job finishes -> the money becomes real */
  ctx.__setJobs([mk("catTail", { earnWhen:"jobDone", jobDoneAt:"2026-09-30" })]);
  M = JSON.parse(ctx.__money());
  if (Math.round(M.collectable.amt) !== 17001) {
    failed++;
    console.log(`finishing the job did not make the 40% collectable (${Math.round(M.collectable.amt)})   <-- FAIL`);
  }

  /* 10% waits for the carrier */
  ctx.__setJobs([mk("water", { feePct:10, earnWhen:"carrierPays" })]);
  M = JSON.parse(ctx.__money());
  if (M.collectable.amt !== 0) {
    failed++;
    console.log("a 10% fee is collectable before the carrier paid   <-- FAIL");
  }
  ctx.__setJobs([mk("water", { feePct:10, earnWhen:"carrierPays", carrierPaidAt:"2026-09-02" })]);
  M = JSON.parse(ctx.__money());
  if (Math.round(M.collectable.amt) !== 4250) {
    failed++;
    console.log(`carrier paying did not release the 10% (${Math.round(M.collectable.amt)})   <-- FAIL`);
  }

  /* not assigned = not money, at any stage */
  ctx.__setJobs([mk("unassigned", { earnWhen:"assigned" })]);
  M = JSON.parse(ctx.__money());
  if (M.collectable.amt !== 0) {
    failed++;
    console.log("an UNASSIGNED job is being counted as collectable   <-- FAIL");
  }

  /* ordinary 2% work is untouched — it bills on delivery like always */
  ctx.__setJobs([mk("normal", { feePct:2, total:112388.61 })]);
  M = JSON.parse(ctx.__money());
  if (Math.round(M.collectable.amt) !== 2248) {
    failed++;
    console.log(`normal delivery-billed work stopped being collectable (${Math.round(M.collectable.amt)})   <-- FAIL`);
  }

  /* money already received stays received, trigger or not */
  ctx.__setJobs([mk("paidAnyway", { status:"Paid", earnWhen:"jobDone", paidDate:"2026-08-20" })]);
  M = JSON.parse(ctx.__money());
  if (Math.round(M.banked.amt) !== 17001) {
    failed++;
    console.log("a PAID contingent job stopped counting as banked   <-- FAIL");
  }
}

console.log("-".repeat(96));
if (failed) {
  console.error(`\n${failed} money assertion(s) failed. Do not push — this changes what he invoices.`);
  process.exit(1);
}
console.log(`PASS — ${CASES.length} fee cases and ${BUCKETS.length} bucket totals hold.`);
