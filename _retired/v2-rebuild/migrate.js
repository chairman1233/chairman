/* ============================================================================
   MIGRATION — boards.data.jobs (v1 JSON blob) into the §7 model.
   Applies the §11 repairs. Lossless: the original row is kept on `_v1` so
   nothing is destroyed and a bad map can be re-run from the backup.
   ========================================================================== */

const FORK_BY_CONTACT = {
  "mario urrutia": "delivery", "jose uribe": "delivery", "rafael gonzalez": "delivery",
  "nicholas cali": "approval", "nick cali": "approval", "jordan reyes": "approval"
};

/* §11: Lylian's loss reads Rebuild and is actually Water — as stored, the fee
   engine routes an $11,904.19 job to 40% instead of retainer coverage. */
const LOSS_REPAIRS = [
  { match: /maverick park/i, loss: "Water",
    note: "[Repair] Loss corrected Rebuild → Water. $11,904.19 is under $30,000, so it is retainer-covered and earns zero on the job. As stored it routed to 40%." }
];

function migrate(v1, todayISO) {
  const out = { v: 2, accounts: [], jobs: [], subCosts: [], scanDays: [], payments: [],
                notes: (v1.notes || []).slice(), me: v1.me || {}, seq: { invNo: 1010 }, log: [] };
  const say = m => out.log.push(m);

  /* ---- accounts. §11: Green Dynasty exists twice — one full record, one
     empty stub. Keep the record with jobs, fold the stub into it. ---- */
  const seen = {};
  (v1.accounts || []).forEach(a => {
    const key = String(a.name || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    const jobCount = (v1.jobs || []).filter(j => j.accountId === a.id).length;
    if (seen[key]) {
      const keep = seen[key];
      if (jobCount > keep._jobs) { keep._dupes.push(keep.id); Object.assign(keep, a, { _jobs: jobCount, _dupes: keep._dupes }); }
      else keep._dupes.push(a.id);
      say("Deduped account " + a.name);
      return;
    }
    const contact = String(a.contact || "").trim().toLowerCase();
    const isGD = /green dynasty/i.test(a.name || "");
    const isMe = /chairman remodeling/i.test(a.name || "");
    const banned = /valued renovations/i.test(a.name || "");
    seen[key] = {
      id: a.id, name: a.name, contact: a.contact || "", phone: a.phone || "", email: a.email || "",
      fork: FORK_BY_CONTACT[contact] || "delivery",
      feePct: a.feePct != null ? a.feePct : 2,
      supPct: a.supPct != null ? a.supPct : 7.5,
      banned: banned,
      bannedNote: banned ? "No-showed twice on scheduled estimates. Site intake naming him returns \"call me\" — no job is created." : "",
      terms: "", reimbursables: true,
      ledger: isGD,
      rules: isGD ? [
        { lossTypes: ["water", "mitigation", "mold"], minTotal: 30000, pct: 10, feeBasis: "gross" },
        { lossTypes: ["rebuild", "remodel"],          minTotal: 0,     pct: 40, feeBasis: "aftersubs" },
        { lossTypes: ["water", "mitigation", "mold"], minTotal: 0,     pct: 0,  retainerCovers: true }
      ] : [],
      _self: isMe, _jobs: jobCount, _dupes: [], _v1: a
    };
    if (banned) say("Valued Renovations (Wes Garcia) marked BANNED, not inactive — cannot be selected.");
    if (isGD)   say("Green Dynasty set as the ledger account with its rule table.");
  });
  out.accounts = Object.values(seen).filter(a => !a._self);
  const dupeMap = {};
  out.accounts.forEach(a => a._dupes.forEach(d => { dupeMap[d] = a.id; }));

  /* ---- jobs ---- */
  (v1.jobs || []).forEach(j => {
    if (j._demo) return;
    const accId = dupeMap[j.accountId] || j.accountId;
    const acct = out.accounts.find(a => a.id === accId);
    const led = acct && acct.ledger;

    /* v1 status -> v0 state */
    const st = j.status, fork = acct ? (led ? "ledger" : acct.fork) : "delivery";
    let state = "Intake";
    if (st === "Lost") state = "Lost";
    else if (j.paidDate || st === "Paid") state = j.releasedAt ? "Released" : "Paid";
    else if (j.invNo || st === "Invoiced") state = "Invoiced";
    else if (j.readyDate || st === "Complete") state = fork === "approval" ? "Ready" : "Ready";
    else if (j.mportLink) state = "Scanned";
    else if (j.status === "Waiting") state = "Intake";
    else state = "Scheduled";

    let loss = j.loss || "";
    const rep = LOSS_REPAIRS.find(r => r.match.test(j.address || ""));
    if (rep) { loss = rep.loss; out.notes.unshift({ id: "mg" + Math.random().toString(36).slice(2),
      jobId: j.id, kind: "Note", pin: true, created: new Date().toISOString(), text: rep.note });
      say("Repaired loss type on " + (j.address || "").slice(0, 30)); }

    const job = {
      id: j.id, accountId: accId,
      address: j.address || "", access: j.access || "",
      claimNo: j.claim || "", insurer: j.insurer || "",
      ownerLabel: j.owner || j.client || "",          /* DISPLAY ONLY — never billed */
      state,
      walkAt: j.startDate || null, walkConfirmed: false,
      scanSource: j.mportLink ? "matterport" : (j.mport === "Not needed" ? "magicplan" : "matterport"),
      scanDayId: null,
      /* §7: mportStatus cannot be Scheduled while a link exists — live bug */
      mportStatus: j.mportLink ? "Ready" : (j.mport === "Ordered" ? "Scheduled" : (j.mport || "")),
      mportLink: j.mportLink || "",
      readyDate: j.readyDate || null,
      loss,
      jobType: j.supBase ? "supplement" : "fresh",
      baseline: j.supBase != null ? j.supBase : null,
      total: +j.total || 0,
      feeOverride: null, feeOverrideReason: "",
      deliveredAt: null, approvedAt: null,
      invNo: j.invNo || null, invDate: j.invDate || null,
      paidAt: j.paidDate || null, paidAmount: j.paidAmount || null, paidSource: j.paidSource || "",
      releasedAt: null, expiresAt: null, extendedUntil: null, pdfKey: null,
      legal: !!j.sealed || !!j.disputeStage,
      _v1: j
    };

    /* approval-fork jobs that are finished have, in fact, been delivered —
       that is how the fork works, the file goes first */
    if (fork === "approval" && job.readyDate && !job.invNo) {
      job.state = "Delivered"; job.deliveredAt = job.readyDate;
      say("Delivered stamped on " + (job.address || "").slice(0, 26) + " (approval fork, ESX done)");
    }
    /* §11: 3311 Stratford was billed at 2% on supplement-looking work —
       Benny confirmed a deliberate discount. Record it as an override with the
       reason so future-Benny can tell a favour from a mistake. */
    if (/stratford/i.test(job.address) && job.total > 0) {
      job.feeOverride = +(job.total * 0.02).toFixed(2);
      job.feeOverrideReason = "Deliberate discount to Nick Cali — billed 2% on work that looked like a supplement.";
      say("Stratford recorded as a deliberate feeOverride with its reason.");
    }
    out.jobs.push(job);
  });

  /* §11: backfill releasedAt on the jobs already sent off-system, so they do
     not sit in "Paid — Send It" asking to be sent a second time. Do NOT
     re-invoice them. */
  let backfilled = 0;
  out.jobs.forEach(j => {
    if (j.paidAt && !j.releasedAt) {
      j.releasedAt = j.paidAt; j.state = "Released"; backfilled++;
      out.notes.unshift({ id: "mg-rel-" + j.id, jobId: j.id, kind: "Note", pin: false,
        created: new Date().toISOString(),
        text: "[Repair] This file was already sent off-system before the rebuild. releasedAt backfilled to the payment date so it doesn't ask to be sent again. Not re-invoiced." });
    }
  });
  if (backfilled) say("Backfilled releasedAt on " + backfilled + " job(s) already sent off-system.");

  /* §11: burned numbers and the sequence */
  const used = out.jobs.map(j => +String(j.invNo || "").replace(/\D/g, "")).filter(n => n >= 1000);
  out.seq.invNo = Math.max(1009, ...used) + 1;
  say("Invoice sequence set to " + out.seq.invNo + " (INV-1001 stays burned).");

  /* §11: the Rains $60,000 partial payment is recorded nowhere */
  const rains = out.jobs.find(j => /glynn way/i.test(j.address) && j.total > 150000);
  if (rains) {
    rains.legal = true;
    out.payments.push({ id: "pay-rains-60k", amount: 60000, clearedAt: "2026-08-14",
      source: "Green Dynasty", matchedInvNo: rains.invNo || null, accountId: rains.accountId,
      note: "Partial payment on Rains Claim 2 — was recorded nowhere in v1." });
    say("Recorded the $60,000 Rains partial payment and flagged the case legal.");
  }
  /* §11: Carmen moves to the ledger, and the caseLog is corrected — Bobby is
     pursuing the homeowner for the shortfall, it is his exposure, not Benny's */
  const carmen = out.jobs.find(j => /lakewood/i.test(j.address));
  if (carmen) {
    carmen.legal = true;
    carmen.disputeAmt = 18908.37;
    out.notes.unshift({ id: "mg-carmen", jobId: carmen.id, kind: "Note", pin: true,
      created: new Date().toISOString(),
      text: "[Repair] Moved to the ledger. The carrier paid $40,000; Bobby is pursuing Carmen for the $18,908.37 shortfall — that is Bobby's exposure, not Benny's, and not a dispute with the carrier. Benny is owed on the full estimate either way. $3,891 outstanding, owed by Bobby." });
    say("Carmen moved to the ledger with the case note corrected.");
  }
  out.accounts.forEach(a => { delete a._jobs; delete a._dupes; });
  return out;
}

if (typeof module !== "undefined") module.exports = { migrate };
if (typeof window !== "undefined") window.Migrate = { migrate };
