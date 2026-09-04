/* THE v0 GATE. Every assertion here is a line from SPEC.md, not a guess.
   Run: node v2/core-check.js */
const C = require("./core.js");

let failed = 0;
const ok = w => console.log("ok    " + w);
const fail = (w, d) => { failed++; console.log("FAIL  " + w + (d ? "\n      " + d : "")); };
const eq = (w, got, want) => (JSON.stringify(got) === JSON.stringify(want)) ? ok(w)
  : fail(w, "got " + JSON.stringify(got) + " want " + JSON.stringify(want));
const near = (w, got, want) => (got != null && Math.abs(got - want) < 0.01) ? ok(w)
  : fail(w, "got " + got + " want " + want);

/* the six real accounts from the spec */
const A = [
  { id: "mario",  name: "Houston Remodeling Contractors LLC", fork: "delivery", feePct: 2, supPct: 7.5 },
  { id: "jose",   name: "AJ&S Remodeling LLC",                fork: "delivery", feePct: 2, supPct: 7.5 },
  { id: "rafael", name: "Gonz Remodeling & Windows",          fork: "delivery", feePct: 2, supPct: 7.5 },
  { id: "nick",   name: "Calis Construction",                 fork: "approval", feePct: 2, supPct: 7.5 },
  { id: "jordan", name: "Texas Trinity Construction LLC",     fork: "approval", feePct: 2, supPct: 7.5 },
  { id: "wes",    name: "Valued Renovations", banned: true, bannedNote: "no-showed twice" },
  { id: "bobby",  name: "Green Dynasty Group", ledger: true, rules: [
      { lossTypes: ["water", "mitigation", "mold"], minTotal: 30000, pct: 10, feeBasis: "gross" },
      { lossTypes: ["rebuild", "remodel"],          minTotal: 0,     pct: 40, feeBasis: "aftersubs" },
      { lossTypes: ["water", "mitigation", "mold"], minTotal: 0,     pct: 0,  retainerCovers: true }
    ] }
];
const J = o => Object.assign({ id: "j" + Math.random().toString(36).slice(2), state: "Ready", total: 0 }, o);

/* ---- §2 the fork ---- */
eq("delivery account is a delivery job", C.forkOf(J({ accountId: "mario" }), A), "delivery");
eq("approval account is an approval job", C.forkOf(J({ accountId: "nick" }), A), "approval");
eq("Green Dynasty is neither — it's the ledger", C.forkOf(J({ accountId: "bobby" }), A), "ledger");
{
  const d = C.nextAction(J({ accountId: "mario", state: "Ready" }), A);
  eq("a delivery job at Ready goes straight to Invoice", d && d.to, "Invoiced");
  const p = C.nextAction(J({ accountId: "nick", state: "Ready" }), A);
  eq("an approval job at Ready is Delivered first", p && p.to, "Delivered");
  const q = C.nextAction(J({ accountId: "nick", state: "Delivered" }), A);
  eq("then waits for the Approved button", q && q.to, "Approved");
  const r = C.nextAction(J({ accountId: "mario", state: "Paid" }), A);
  eq("a paid delivery job releases the file", r && r.to, "Released");
  eq("a paid approval job is finished — nothing to release",
     C.nextAction(J({ accountId: "nick", state: "Paid" }), A), null);
}

/* ---- §2 THE RULE THAT PROTECTS THE MONEY ----
   no code path may serve the PDF of an unpaid delivery job */
eq("unpaid delivery job: PDF is inaccessible",
   C.canServePdf(J({ accountId: "mario", state: "Invoiced" }), A), false);
eq("paid delivery job: PDF is served",
   C.canServePdf(J({ accountId: "mario", paidAt: "2026-09-01" }), A), true);
eq("approval job gets the file BEFORE paying — they can't get approved without it",
   C.canServePdf(J({ accountId: "nick", deliveredAt: "2026-09-01" }), A), true);
eq("releasing a delivery job before payment is a violation",
   C.violations(J({ accountId: "mario", releasedAt: "2026-09-01" }), A, []).length > 0, true);

/* ---- §3 fee math ---- */
near("fresh estimate is 2%", C.feeOf(J({ accountId: "nick", total: 70406.68 }), A, []).amount, 1408.13);
{
  const s = C.feeOf(J({ accountId: "nick", total: 130000, jobType: "supplement", baseline: 122831.79 }), A, []);
  near("supplement is 7.5% of the increase only", s.amount, 537.62);
  const none = C.feeOf(J({ accountId: "nick", total: 122831.79, jobType: "supplement", baseline: 122831.79 }), A, []);
  eq("nothing recovered, nothing owed", none.amount, 0);
  const nb = C.feeOf(J({ accountId: "nick", total: 130000, jobType: "supplement" }), A, []);
  eq("a supplement with no baseline cannot be priced", nb.amount, null);
}
/* the ledger table */
near("GD water at $46,836.56 is 10% GROSS, no subs deducted",
     C.feeOf(J({ accountId: "bobby", total: 46836.56, loss: "Water" }), A, []).amount, 4683.66);
eq("GD water UNDER $30k earns zero — the retainer covers it",
   C.feeOf(J({ accountId: "bobby", total: 11904.19, loss: "Water" }), A, []).amount, 0);
{
  /* THE ONE THAT CARRIED A $37K PHANTOM */
  const noSubs = C.feeOf(J({ id: "cattail", accountId: "bobby", total: 42503.28, loss: "Rebuild" }), A, []);
  eq("a rebuild with NO sub costs returns null, not a number", noSubs.amount, null);
  eq("...and says why", /subs needed/.test(noSubs.reason), true);
  const withSubs = C.feeOf(J({ id: "cattail", accountId: "bobby", total: 42503.28, loss: "Rebuild" }), A,
                           [{ jobId: "cattail", trade: "framing", amount: 12000 }]);
  near("once subs are entered the 40% is of what's left", withSubs.amount, 12201.31);
}
/* overrides are deliberate, and must be explainable later */
eq("an override with no reason is not a number", C.feeOf(J({ accountId: "nick", total: 8051.92, feeOverride: 161.04 }), A, []).amount, null);
near("an override WITH a reason stands",
     C.feeOf(J({ accountId: "nick", total: 8051.92, feeOverride: 161.04, feeOverrideReason: "deliberate discount to Nick" }), A, []).amount, 161.04);

/* ---- §7 constraints ---- */
eq("numbering starts at 1010 — INV-1001 is burned", C.nextInvNo([]), 1010);
eq("numbering continues above what's been issued",
   C.nextInvNo([{ invNo: "INV-1010" }, { invNo: "INV-1011" }]), 1012);
eq("a duplicate invoice number is a violation",
   C.violations(J({ id: "x", invNo: "INV-1010" }), A, [{ id: "y", invNo: "INV-1010" }]).length > 0, true);
eq("a banned account cannot take a job",
   C.violations(J({ accountId: "wes" }), A, []).some(v => /banned/.test(v)), true);
eq("scan cannot be Scheduled while holding a link",
   C.violations(J({ mportStatus: "Scheduled", mportLink: "https://my.matterport.com/x" }), A, []).length > 0, true);

/* ---- §4 six buckets, in order, money first ---- */
{
  const today = "2026-09-04";
  const jobs = [
    J({ id: "b1", accountId: "mario", paidAt: "2026-09-01", state: "Paid" }),
    J({ id: "b2", accountId: "nick",  approvedAt: "2026-09-02", state: "Approved" }),
    J({ id: "b3", accountId: "nick",  deliveredAt: "2026-09-03", state: "Delivered" }),
    J({ id: "b4", accountId: "mario", invNo: "INV-1010", state: "Invoiced" }),
    J({ id: "b5", accountId: "nick",  mportStatus: "Ready", mportLink: "http://x", state: "Scanned" }),
    J({ id: "b6", accountId: "nick",  walkAt: today, state: "Scheduled" }),
    J({ id: "hidden", accountId: "bobby", legal: true, paidAt: "2026-01-01", state: "Paid" })
  ];
  const B = C.buckets(jobs, A, today);
  eq("six buckets, no more", B.length, 6);
  eq("money first — Paid, Send It leads", B[0].key, "send");
  eq("order is send, bill, await, unpaid, noesx, walks", B.map(x => x.key),
     ["send", "bill", "await", "unpaid", "noesx", "walks"]);
  B.forEach(b => { if (b.jobs.length !== 1) fail(`bucket ${b.key} holds ${b.jobs.length} jobs, want 1`); });
  if (B.every(b => b.jobs.length === 1)) ok("every bucket catches exactly its own job");
  eq("a legal/ledger job never reaches the daily screen",
     B.some(b => b.jobs.some(j => j.id === "hidden")), false);
}

/* ---- §6 release window ---- */
eq("a released file expires 21 days later", C.expiryOf({ releasedAt: "2026-09-04" }), "2026-09-25");
eq("nothing unreleased has an expiry", C.expiryOf({}), null);
eq("an extension overrides it", C.expiryOf({ releasedAt: "2026-09-04", extendedUntil: "2026-10-25" }), "2026-10-25");

console.log("");
if (failed) { console.error(failed + " v0 assertion(s) failed. This is his money — do not ship."); process.exit(1); }
console.log("PASS — v0 core holds to spec.");
