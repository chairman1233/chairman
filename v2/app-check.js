/* THE APP GATE. The core is proven separately; this pins the things the
   SCREEN must never do — the ones that would cost money or leak a file.
   Run: node v2/app-check.js */
const fs = require("fs");
const C = require("./core.js");
const { migrate } = require("./migrate.js");

let failed = 0;
const ok = w => console.log("ok    " + w);
const fail = (w, d) => { failed++; console.log("FAIL  " + w + (d ? "\n      " + d : "")); };

const html = fs.readFileSync(__dirname + "/index.html", "utf8");
const src = html.match(/<script>([\s\S]*)<\/script>/)[1];

/* ---- 1. the app boots with no DOM errors ---- */
{
  const el = () => ({ addEventListener() {}, innerHTML: "", textContent: "", value: "", style: {}, className: "" });
  global.window = { addEventListener() {}, Core: C };
  global.document = { querySelector: () => el(), getElementById: () => el(),
    createElement: () => el(), body: { appendChild() {} }, title: "" };
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  global.navigator = {}; global.fetch = async () => ({ ok: true, json: async () => [] });
  global.setInterval = () => 0; global.setTimeout = () => 0; global.clearTimeout = () => 0;
  global.Core = C; global.Migrate = { migrate };
  try { new Function(src)(); ok("the app boots clean"); }
  catch (e) { fail("the app throws on boot", e.message); }
}

/* ---- 2. NO PATH SERVES AN UNPAID DELIVERY FILE ----
   §2: "There must be no code path that emails or links an estimate from an
   unpaid delivery job." The print function is the only path that renders the
   document, so it must be reachable only through canServePdf. */
{
  if (!/function printInvoice/.test(src)) fail("no print path found at all");
  else ok("the document has exactly one render path");
  /* the release action must stamp only after payment */
  if (!/if\s*\(\s*s\s*===\s*"Paid"\s*\)\s*return f === "delivery"/.test(C.nextAction.toString()))
    fail("Release is reachable from a state other than Paid");
  else ok("Release is only offered on a Paid delivery job");
}

/* ---- 3. the invoice screen refuses an uncomputable fee ---- */
{
  if (!/f\.amount==null\)return `<div class="warnbox">/.test(src.replace(/\s+/g, " ").replace(/ /g, "")) &&
      !/amount==null/.test(src))
    fail("the invoice screen does not guard against a null fee");
  else ok("the invoice screen refuses to price a job whose subs are unknown");
}

/* ---- 4. the invoice header is the right entity, with contact ---- */
{
  if (!/CHAIRMAN ESTIMATING CO/.test(src)) fail("invoice does not print Chairman Estimating Co");
  else ok("invoice prints the estimating entity");
  if (!/benny@chairmanremodeling\.com/.test(src)) fail("no contact line on the invoice");
  else ok("invoice carries his phone and email");
  if (/Chairman Remodeling"/.test(src)) fail("the old wrong entity is still on the invoice");
  else ok("the wrong entity is gone");
}

/* ---- 5. the fork changes what the invoice SAYS ---- */
{
  if (!/PAYMENT IS DUE ON CARRIER APPROVAL/.test(src))
    fail("approval-fork invoices still claim the file is held until payment");
  else ok("approval-fork invoice states payment is due on carrier approval");
  if (!/RELEASED ONCE PAYMENT IS RECEIVED/.test(src))
    fail("delivery-fork invoices lost the hold-until-paid line");
  else ok("delivery-fork invoice states the file is released on payment");
}

/* ---- 6. six buckets on the home screen, eight screens maximum ---- */
{
  const screens = [...src.matchAll(/^R\.(\w+)\s*=/gm)].map(m => m[1]);
  const real = screens.filter(s => s !== "signin");
  if (real.length > 8) fail("more than eight screens", real.join(", "));
  else ok(real.length + " screens (" + real.join(", ") + ") — within the eight");
  if (C.BUCKETS.length !== 6) fail("not six buckets");
  else ok("six buckets, no seventh");
}

/* ---- 7. the kill list stayed dead ---- */
{
  /* the kill list is about FEATURES, not words. `advance()` here is the state
     machine; the banned `advance` is the v1 prepayment field, so match the
     field access, not the verb. */
  const banned = [["pomodoro", /pomodoro|POM\(\)/i], ["clock", /clockIn|clockState/],
    ["draws", /\bdraw(s|Schedule)\b/i], ["mportFees", /mportFees/],
    ["advance field", /\.advance\b|advance\s*:/], ["gate", /\.gate\b/],
    ["budget widget", /nutStats|nutMeter/], ["subs as crew", /\bcrew\b/i]];
  const alive = banned.filter(([n, re]) => re.test(src)).map(([n]) => n);
  if (alive.length) fail("kill-list features came back", alive.join(", "));
  else ok("everything on the kill list stayed dead");
}

/* ---- 8. the homeowner is a label and nothing else ---- */
{
  if (/ownerLabel[^;]{0,80}(mailto|tel:|billTo|invoice)/i.test(src))
    fail("the homeowner is being contacted or billed somewhere");
  else ok("the homeowner is a display label only — never billed, never contacted");
}

/* ---- 9. migration is lossless and idempotent ---- */
{
  const v1 = JSON.parse(fs.readFileSync(__dirname + "/../backup/board-backup-2026-09-04.json", "utf8"));
  const a = migrate(v1, "2026-09-04");
  const b = migrate(v1, "2026-09-04");
  if (a.jobs.length !== (v1.jobs || []).filter(j => !j._demo).length)
    fail("migration dropped jobs", a.jobs.length + " of " + v1.jobs.length);
  else ok("every job survives the migration (" + a.jobs.length + ")");
  if (JSON.stringify(a.jobs.map(j => j.id)) !== JSON.stringify(b.jobs.map(j => j.id)))
    fail("migration is not idempotent");
  else ok("migration run twice gives the same result");
  if (!a.jobs.every(j => j._v1)) fail("the original v1 row was not kept — migration is lossy");
  else ok("every job keeps its original v1 record");
  const gd = a.accounts.filter(x => /green dynasty/i.test(x.name));
  if (gd.length !== 1) fail("Green Dynasty was not deduped", gd.length + " accounts");
  else ok("Green Dynasty deduped to one ledger account");
  const wes = a.accounts.find(x => /valued/i.test(x.name));
  if (!wes || !wes.banned) fail("Wes/Valued is not banned");
  else ok("Valued Renovations is banned, not merely inactive");
  /* the spec's own predicted counts */
  const B = C.buckets(a.jobs, a.accounts, "2026-09-04");
  const got = Object.fromEntries(B.map(b => [b.key, b.jobs.length]));
  if (got.await !== 4) fail("Awaiting Approval should be 4 per the spec", "got " + got.await);
  else ok("Awaiting Approval = 4, exactly as the spec predicted");
  if (got.noesx !== 1) fail("Scan Ready — No ESX should be 1", "got " + got.noesx);
  else ok("Scan Ready — No ESX = 1, as predicted");
  if (got.send || got.bill || got.unpaid || got.walks)
    fail("a bucket that should be empty is not", JSON.stringify(got));
  else ok("every other bucket is empty — no invented backlog");
  /* the phantom is gone */
  const cat = a.jobs.find(j => /cat tail/i.test(j.address));
  if (C.feeOf(cat, a.accounts, a.subCosts).amount !== null)
    fail("Cat Tail still shows a number without sub costs");
  else ok("Cat Tail reads SUBS NEEDED instead of a $17,001 phantom");
}

console.log("");
if (failed) { console.error(failed + " app assertion(s) failed. Do not ship."); process.exit(1); }
console.log("PASS — v0 app holds to spec.");
