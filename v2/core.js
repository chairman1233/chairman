/* ============================================================================
   CHAIRMAN ESTIMATING CO — v0 CORE
   Built to chairman-estimating-spec/SPEC.md. Pure logic, no DOM, so the gates
   can run it in Node. Nothing here invents a rule the spec doesn't state.
   ========================================================================== */

/* ---- §2 the fork ---------------------------------------------------------
   Every account sits on one side. Set per account, never hardcoded. */
const FORKS = {
  delivery: ["Intake", "Scheduled", "Scanned", "Ready", "Invoiced", "Paid", "Released", "Expired"],
  approval: ["Intake", "Scheduled", "Scanned", "Ready", "Delivered", "Approved", "Invoiced", "Paid", "Expired"]
};
const LEDGER_STATES = ["Intake", "Scheduled", "Scanned", "Ready", "Delivered", "Earned", "Settled"];

function forkOf(job, accounts) {
  const a = accounts.find(x => x.id === job.accountId);
  if (!a) return "delivery";
  if (a.ledger) return "ledger";
  return a.fork || "delivery";
}
function statesFor(job, accounts) {
  const f = forkOf(job, accounts);
  return f === "ledger" ? LEDGER_STATES : FORKS[f];
}
/* the one action that moves this job forward, and nothing else */
function nextAction(job, accounts) {
  const f = forkOf(job, accounts);
  const s = job.state;
  if (s === "Intake")    return { label: "Schedule the walk", to: "Scheduled", needs: "walkAt" };
  if (s === "Scheduled") return { label: "Scanned",           to: "Scanned" };
  if (s === "Scanned")   return { label: "ESX done",          to: "Ready", stamps: "readyDate" };
  if (s === "Ready")     return f === "approval"
                              ? { label: "Delivered",  to: "Delivered", stamps: "deliveredAt" }
                              : { label: "Invoice",    to: "Invoiced" };
  if (s === "Delivered") return { label: "Approved",   to: "Approved", stamps: "approvedAt" };
  if (s === "Approved")  return { label: "Invoice",    to: "Invoiced" };
  if (s === "Invoiced")  return { label: "Mark paid",  to: "Paid", stamps: "paidAt" };
  if (s === "Paid")      return f === "delivery"
                              ? { label: "Release the file", to: "Released", stamps: "releasedAt" }
                              : null;
  return null;
}

/* ---- §3 fee math — computed, never typed --------------------------------
   Returns {amount, basis, unknown, reason}. amount is null when it cannot be
   known: an aftersubs job with no sub costs must read "subs needed", never a
   number. Every historical aftersubs job has empty subCosts, which is how a
   $37K expectation got carried on a job whose real figure nobody knows. */
function feeOf(job, accounts, subCosts) {
  const a = accounts.find(x => x.id === job.accountId) || {};
  const total = +job.total || 0;

  if (job.feeOverride != null && job.feeOverride !== "") {
    if (!job.feeOverrideReason) {
      return { amount: null, unknown: true, basis: "override", reason: "override needs a reason" };
    }
    return { amount: +job.feeOverride, basis: "override", unknown: false, reason: job.feeOverrideReason };
  }

  /* ledger accounts (Green Dynasty) run off account_rules */
  if (a.ledger) return ledgerFee(job, a, subCosts);

  if (job.jobType === "supplement") {
    if (job.baseline == null) return { amount: null, unknown: true, basis: "supplement", reason: "baseline required" };
    const inc = total - (+job.baseline || 0);
    /* nothing recovered, nothing owed */
    if (inc <= 0) return { amount: 0, basis: "supplement", unknown: false, reason: "no increase recovered" };
    return { amount: inc * ((a.supPct != null ? a.supPct : 7.5) / 100), basis: "supplement", unknown: false,
             reason: (a.supPct != null ? a.supPct : 7.5) + "% of the " + inc.toFixed(2) + " increase" };
  }
  const pct = a.feePct != null ? a.feePct : 2;
  return { amount: total * (pct / 100), basis: "fresh", unknown: false, reason: pct + "% of estimate" };
}

/* §3 ledger table — evaluate highest threshold first; no match falls through
   to retainer coverage and earns zero on the job */
function ledgerFee(job, acct, subCosts) {
  const total = +job.total || 0;
  const loss = String(job.loss || "").toLowerCase();
  const rules = (acct.rules || []).slice().sort((x, y) => (y.minTotal || 0) - (x.minTotal || 0));
  const hit = rules.find(r =>
    (!r.lossTypes || !r.lossTypes.length || r.lossTypes.some(t => loss.includes(t.toLowerCase()))) &&
    total >= (r.minTotal || 0));
  if (!hit || hit.retainerCovers) {
    return { amount: 0, basis: "retainer", unknown: false, reason: "covered by the retainer" };
  }
  if (hit.feeBasis === "aftersubs") {
    const subs = subTotalOf(job, subCosts);
    if (subs == null) {
      return { amount: null, unknown: true, basis: "aftersubs",
               reason: "subs needed — " + hit.pct + "% is of what's left after they're paid" };
    }
    return { amount: Math.max(0, total - subs) * (hit.pct / 100), basis: "aftersubs", unknown: false,
             reason: hit.pct + "% after " + subs.toFixed(2) + " of subs" };
  }
  return { amount: total * (hit.pct / 100), basis: "gross", unknown: false, reason: hit.pct + "% gross" };
}
/* null (not 0) when nothing has been entered — unknown is not zero */
function subTotalOf(job, subCosts) {
  const rows = (subCosts || []).filter(s => s.jobId === job.id);
  if (!rows.length) return null;
  return rows.reduce((n, s) => n + (+s.amount || 0), 0);
}

/* ---- §4 the six buckets, in this order, money first --------------------- */
const BUCKETS = [
  { key: "send",     title: "Paid — Send It",      action: "Release",
    test: (j, A) => j.paidAt && !j.releasedAt && forkOf(j, A) === "delivery" },
  { key: "bill",     title: "Approved — Bill It",  action: "Create invoice",
    test: j => j.approvedAt && !j.invNo },
  { key: "await",    title: "Awaiting Approval",   action: "Nudge",
    test: j => j.deliveredAt && !j.approvedAt },
  { key: "unpaid",   title: "Invoiced — Not Paid", action: "Nudge",
    test: j => j.invNo && !j.paidAt },
  /* The "Scan Ready — No ESX" bucket is gone. He builds the estimate in
     Xactimate and knows what he has open; a card telling him a scan landed is
     duplicate information he never asked the app to hold. The Scanned → Ready
     step still exists on the job itself. */
  { key: "walks",    title: "Walks Today",         action: "Dispatch",
    test: (j, A, today) => j.walkAt && String(j.walkAt).slice(0, 10) === today }
];
function buckets(jobs, accounts, today) {
  return BUCKETS.map(b => Object.assign({}, b, {
    jobs: jobs.filter(j => !j.legal && j.state !== "Lost" && b.test(j, accounts, today))
  }));
}

/* ---- §7 constraints ------------------------------------------------------ */
const INV_START = 1010;          /* INV-1001 is permanently burned */
function nextInvNo(jobs) {
  const used = jobs.map(j => +String(j.invNo || "").replace(/\D/g, "")).filter(n => n >= 1000);
  return Math.max(INV_START - 1, ...used) + 1;
}
/* the hard rules. Returns [] when the job is legal to save. */
function violations(job, accounts, jobs) {
  const out = [];
  const a = accounts.find(x => x.id === job.accountId);
  if (a && a.banned) out.push("account is banned — call me, no job");
  if (job.jobType === "supplement" && job.baseline == null) out.push("supplement needs the adjuster's baseline");
  if (job.mportStatus === "Scheduled" && job.mportLink) out.push("scan cannot be Scheduled and have a link");
  if (job.feeOverride != null && job.feeOverride !== "" && !job.feeOverrideReason)
    out.push("a fee override needs a written reason");
  if (job.invNo && jobs.some(x => x.id !== job.id && x.invNo === job.invNo)) out.push("invoice number already used");
  if (job.releasedAt && !job.paidAt && forkOf(job, accounts) === "delivery")
    out.push("delivery job cannot be released before it is paid");
  return out;
}
/* §2: there must be no code path that serves the PDF of an unpaid delivery job */
function canServePdf(job, accounts) {
  if (forkOf(job, accounts) === "delivery") return !!job.paidAt;
  return !!job.deliveredAt || !!job.readyDate;   /* approval fork gets it to file the claim */
}
/* §6 release window */
const RELEASE_DAYS = 21, EXTEND_DAYS = 30, EXTEND_FEE = 85;
function expiryOf(job) {
  if (job.extendedUntil) return job.extendedUntil;
  if (!job.releasedAt) return null;
  const d = new Date(job.releasedAt + "T12:00:00");
  d.setDate(d.getDate() + RELEASE_DAYS);
  return d.toISOString().slice(0, 10);
}

if (typeof module !== "undefined") module.exports = {
  FORKS, LEDGER_STATES, forkOf, statesFor, nextAction, feeOf, ledgerFee, subTotalOf,
  BUCKETS, buckets, INV_START, nextInvNo, violations, canServePdf, expiryOf,
  RELEASE_DAYS, EXTEND_DAYS, EXTEND_FEE
};

/* browser: one namespace, same functions the gate runs */
if (typeof window !== "undefined") {
  window.Core = { FORKS, LEDGER_STATES, forkOf, statesFor, nextAction, feeOf, ledgerFee,
    subTotalOf, BUCKETS, buckets, INV_START, nextInvNo, violations, canServePdf, expiryOf,
    RELEASE_DAYS, EXTEND_DAYS, EXTEND_FEE };
}
