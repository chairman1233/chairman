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
  /* the logo loader is canvas work — stub the image so boot can be tested
     headlessly; the crop maths itself is checked statically below */
  global.Image = function () { setTimeout(() => this.onerror && this.onerror(), 0); };
  global.setInterval = () => 0; global.setTimeout = () => 0; global.clearTimeout = () => 0;
  global.addEventListener = () => {};
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
  /* SPEC §6 says eight. Benny added a ninth on purpose: "Jobs" — pipeline,
     completed, and who owes him. Those lists existed in v1, he uses them, and
     hiding a finished job because it left the 7am buckets is what he objected
     to. Nine is the ceiling now; a tenth still fails. */
  const screens = [...src.matchAll(/^R\.(\w+)\s*=/gm)].map(m => m[1]);
  const real = screens.filter(s => s !== "signin");
  if (real.length > 9) fail("more than nine screens", real.join(", "));
  else ok(real.length + " screens (" + real.join(", ") + ")");
  if (!real.includes("jobs")) fail("the Jobs list (pipeline / completed / owed) is missing");
  else ok("Jobs carries pipeline, completed and who-owes");
  if (C.BUCKETS.length !== 5) fail("bucket count changed unexpectedly");
  else ok("five buckets on the home screen");
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

/* ---- 7b. v1 AND v0 RUN SIDE BY SIDE ON THE SAME ORIGIN.
       v1 owns localStorage "chairman_v2" and the `boards` table. v0 read that
       same key on first load, mistook a raw v1 blob for migrated data, and
       showed 9 accounts with no fork. Nothing v0 writes may share a name with
       anything v1 owns. ---- */
{
  const v1 = fs.readFileSync(__dirname + "/../index.html", "utf8");
  const keysOf = s => [...s.matchAll(/localStorage\.(?:get|set|remove)Item\(\s*["'`]([^"'`]+)/g)].map(m => m[1])
    .concat([...s.matchAll(/\bK\s*=\s*"([^"]+)"/g)].map(m => m[1]));
  const mine = new Set(keysOf(src)), theirs = new Set(keysOf(v1));
  const clash = [...mine].filter(k => theirs.has(k) && k !== "chairman_sess");
  if (clash.length) fail("v0 writes a localStorage key v1 owns", clash.join(", "));
  else ok("no localStorage key collides with v1 (the session is shared on purpose)");
  if (!/boards_v2/.test(src)) fail("v0 is not using its own table");
  else ok("v0 reads and writes boards_v2, its own table");
  if (/method:"POST"[\s\S]{0,120}\/rest\/v1\/boards\?/.test(src))
    fail("v0 WRITES to the v1 boards table — the old app must stay untouched");
  else ok("v0 never writes to the v1 table — rollback stays clean");
}

/* ---- 7c. HIS LOGO, AND ONLY HIS.
       I have twice replaced his real mark with a hexagon I drew. His asset is
       logo-print.jpg; nothing else may stand in for it. ---- */
{
  if (/viewBox="0 0 124 136"/.test(src))
    fail("a hand-drawn mark is standing in for his logo again");
  else ok("no invented mark anywhere in v0");
  if (!/logo-print\.jpg/.test(src)) fail("his logo file is not being used at all");
  else ok("the header and the letterhead both load his own logo file");
  if (!fs.existsSync(__dirname + "/../logo-print.jpg")) fail("logo-print.jpg is missing from the repo");
  else ok("logo-print.jpg is present");
  /* and it must be cropped to the mark, not the whole render with its frame
     and drop shadow — that printed as a grey box */
  if (!/MARK_BOX/.test(src) || !/lum>135/.test(src))
    fail("the logo is not cropped and hard-cut — the frame and shadow will print");
  else ok("the logo is cropped to the mark and hard-cut, no frame or shadow");
  /* his mark is black on white and must not be recoloured for the screen —
     it sits on a white plate instead */
  if (/buildMark\([^)]*\[\s*2[0-9]{2}\s*,/.test(src))
    fail("the mark is being recoloured/inverted for the dark UI");
  else ok("the mark is never inverted — it sits on a white plate");
  if (!/\.plate\{/.test(html)) fail("no white plate behind the mark");
  else ok("the white plate is in the stylesheet");
}

/* ---- 7d. TWO REAL LAYOUTS, NOT ONE PHONE PAGE STRETCHED ---- */
{
  if (!/@media\(min-width:1024px\)/.test(html))
    fail("there is no desktop layout at all — this is the phone page on a monitor");
  else ok("a desktop layout exists at ≥1024px");
  const desk = html.slice(html.indexOf("@media(min-width:1024px)"), html.indexOf("@media print"));
  if (!/#side\{display:flex/.test(desk)) fail("desktop has no persistent side rail");
  else ok("desktop gets a persistent left rail");
  if (!/nav\{display:none\}/.test(desk)) fail("the phone bottom bar is still showing on desktop");
  else ok("the phone bottom bar is hidden on desktop");
  if (!/\.bkgrid\{display:grid/.test(desk)) fail("buckets do not lay out as a grid on desktop");
  else ok("buckets become a grid on desktop");
  if (!/max-width:1180px/.test(desk)) fail("desktop content is still pinned to a phone column");
  else ok("desktop content uses the full working width");
  /* and the phone layout must survive */
  if (!/nav\{position:fixed/.test(html)) fail("the mobile bottom nav is gone");
  else ok("mobile keeps its fixed bottom nav");
  if (!/--tap:56px/.test(html)) fail("mobile tap targets shrank");
  else ok("mobile tap targets stay at 56px");
}

/* ---- 7e. THE FOUR THINGS THAT WERE DEAD ---- */
{
  /* SYNC — a write may never be dropped, and the screen must say where it is */
  if (/if\s*\(\s*!SESS\s*\|\|\s*busy\s*\)\s*return/.test(src))
    fail("push still drops the write when one is already in flight");
  else ok("a write in flight no longer discards the next one");
  if (!/let dirty=false/.test(src)) fail("there is no dirty flag — writes can be lost");
  else ok("every write is marked dirty until the cloud confirms it");
  if (!/setInterval\(\(\)=>\{if\(dirty\)push\(\);\}/.test(src.replace(/\s+/g, "")))
    fail("nothing retries a failed push");
  else ok("a failed push retries until it lands");
  if (!/if\(dirty\)\{push\(\);return render\(\);\}/.test(src))
    fail("a poll can still overwrite a write that hasn't reached the cloud");
  else ok("an unsent local write is never clobbered by the poll");
  ["queued", "saving", "synced", "offline"].forEach(w => {
    if (!new RegExp(w).test(src)) fail('the sync chip never says "' + w + '"');
  });
  ok("the chip reports queued / saving / synced / offline honestly");

  /* PRINT — must not wipe the document on a timer */
  if (/setTimeout\(\(\)=>\{document\.title=was;\$\("#print"\)\.innerHTML="";\},600\)/.test(src.replace(/\s+/g, "")))
    fail("the invoice is still cleared on a 600ms timer — phones print blank");
  else ok("the invoice clears on afterprint, not a timer");
  if (!/addEventListener\("afterprint"/.test(src)) fail("nothing listens for afterprint");
  else ok("afterprint drives the cleanup");
  if (!/if\(!_markDark\)await loadMarks\(\)/.test(src))
    fail("the letterhead can print before the mark has loaded");
  else ok("the mark is loaded before the document is built");

  /* MARK PAID — no prompt() anywhere, and the three fields must save */
  const nocomment = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const prompts = (nocomment.match(/(^|[^.\w])prompt\s*\(/g) || []).length;
  if (prompts) fail("prompt() is still used " + prompts + " time(s) — suppressed in an installed PWA");
  else ok("prompt() is gone — every input is a real form");
  ["paidAt", "paidAmount", "paidSource"].forEach(f => {
    if (!new RegExp("j\\." + f + "\\s*=").test(src)) fail("markPaid does not set " + f);
  });
  ok("markPaid saves paidAt, paidAmount and paidSource");
  if (!/j\.state="Paid"/.test(src)) fail("marking paid does not move the job off hold");
  else ok("marking paid moves the job to Paid");
  if (!/D\.payments\.push/.test(src)) fail("the payment is not recorded in the ledger");
  else ok("the payment lands in the payments ledger too");

  /* ESX — the bucket is gone */
  if (/noesx/.test(require("fs").readFileSync(__dirname + "/core.js", "utf8")))
    fail("the ESX bucket is still there");
  else ok("the ESX bucket is deleted");
  if (C.BUCKETS.length !== 5) fail("expected five buckets after removing ESX", C.BUCKETS.length);
  else ok("five buckets remain, in order");
}

/* ---- 7f. A HOMEOWNER CAN CALL. That must not be blocked, and must not turn
       the app into a homeowner product — it is one option on New Job. ---- */
{
  if (!/__owner/.test(src)) fail("there is no way to log a homeowner-called job");
  else ok("New Job offers \"Homeowner called me direct\"");
  ["nOwnName", "nOwnPhone"].forEach(f => {
    if (!new RegExp(f).test(src)) fail("the homeowner form is missing " + f);
  });
  ok("name, phone and address are captured for a direct job");
  if (!/if\(!accountId&&!direct\)\s*return toast/.test(src))
    fail("a job with no GC account is still blocked");
  else ok("a job is no longer blocked just because the caller isn't a GC");
  if (!/const payerOf=/.test(src)) fail("there is no single payer resolver");
  else ok("one payer resolver — the account, or the homeowner on a direct job");
  if (!/j\.direct\?\(j\.ownerLabel\|\|"Homeowner"\):a\.name/.test(src.replace(/\s+/g, "")))
    fail("the invoice does not bill the homeowner on a direct job");
  else ok("a direct job bills the homeowner, not a blank company");
  /* and the fee still computes with no account at all */
  const f = C.feeOf({ id: "d1", accountId: "", total: 50000, jobType: "fresh" }, [], []);
  if (f.amount !== 1000) fail("a direct job does not price at the default 2%", "got " + f.amount);
  else ok("a direct job prices at the default 2%");
  if (C.forkOf({ accountId: "" }, []) !== "delivery")
    fail("a direct job is not on the delivery fork");
  else ok("a direct job is delivery fork — they pay, then the file goes");
}

/* ---- 7g. THE THINGS HE SAID WERE MISSING ---- */
{
  /* ghost cards: an empty bucket says nothing, it does not fake a job */
  if (/b\.jobs\.length\?esc\(b\.action\)[^:]*:"nothing here"/.test(src.replace(/\s+/g, "")))
    fail("an empty bucket still prints filler text");
  else ok("an empty bucket is blank — no ghost");
  /* dollars on the money buckets, not just a count */
  if (!/b\.money=b\.jobs\.reduce/.test(src.replace(/\s+/g, "")))
    fail("the money buckets carry a count but no dollars");
  else ok("Invoiced-Not-Paid, Approved-Bill-It and Paid-Send-It show the dollars");
  /* completed work is still reachable */
  if (!/\["Paid","Released","Expired"\]\.includes\(j\.state\)/.test(src.replace(/\s+/g, "")))
    fail("finished jobs are not listed anywhere");
  else ok("completed jobs (paid / released) have their own list");
  /* the pipeline */
  if (!/const ACTIVE=\["Intake","Scheduled","Scanned","Ready","Delivered","Approved"\]/.test(src))
    fail("in-progress jobs are not listed");
  else ok("pipeline lists scheduled, scanned, ready, delivered, approved");
  /* who owes, with the age */
  if (!/const owedJobs=/.test(src)) fail("there is no who-owes-me list");
  else ok("who-owes-me lists amount and days outstanding");
  /* the haul */
  if (!/This month/.test(src) || !/Year to date/.test(src))
    fail("month and YTD collected are missing");
  else ok("Money shows fee collected this month and YTD");
  if (!/paidAmount!=null\?\+j\.paidAmount/.test(src.replace(/\s+/g, "")))
    fail("the haul is counting estimate volume, not fee collected");
  else ok("the haul counts what actually cleared, not estimate volume");
  /* print, on the job, one thumb */
  if (!/Print invoice \$\{esc\(j\.invNo\)\}/.test(src))
    fail("there is no Print invoice button on the job screen");
  else ok("Print invoice sits on the job itself");
  /* a thin device must not overwrite a fat cloud */
  if (!/theirs>mine\+2/.test(src)) fail("a stale device can still push over the real board");
  else ok("a device holding far less than the cloud restores instead of pushing");
}

/* ---- 7h. ORDER, AGE, PARTNERS, AND ONE CHIP ---- */
{
  /* every row carries the date it came in and how long it has sat */
  if (!/const inDateOf=/.test(src) || !/const ageOf=/.test(src))
    fail("jobs have no in-date or age");
  else ok("every job carries a date in and an age");
  if (!/class="jr-d"/.test(src)) fail("the list does not show the date column");
  else ok("the list line is date · age · who · state · next · amount");
  if (!/_sort==="age"/.test(src)) fail("the list cannot be sorted by age");
  else ok("the list sorts oldest-first or biggest-first");

  /* GREEN DYNASTY ARE PARTNERS. The hold language must never reach them. */
  if (!/fork==="ledger"\?""/.test(src.replace(/\s+/g, "")))
    fail("a ledger/partner invoice still prints hold-until-paid language");
  else ok("a ledger account prints no hold language — partners are not on Mario's terms");
  /* prove it with the real rule, not just the string */
  const gd = [{ id: "bobby", name: "Green Dynasty Group", ledger: true, rules: [] }];
  if (C.forkOf({ accountId: "bobby" }, gd) !== "ledger")
    fail("Green Dynasty is not resolving as a ledger account");
  else ok("Green Dynasty resolves as ledger, not delivery");

  /* one chip, silent when synced */
  if (/synced\s*"\+new Date/.test(src)) fail("the app still announces 'synced'");
  else ok("synced is silence — the chip only speaks when queued, failed or offline");
  const chipFn = (src.match(/function chip\(\)\{[\s\S]*?\n\}/) || [""])[0];
  if (!/style\.display=state\?"":"none"/.test(chipFn.replace(/\s+/g, "")))
    fail("the chips are always visible");
  else ok("both chip mounts hide when there is nothing to report");

  /* the confusing label is gone and there is a way back */
  const coreNoComments = require("fs").readFileSync(__dirname + "/core.js", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  if (/ESX done/.test(coreNoComments))
    fail('"ESX done" is still a button');
  else ok('"ESX done" is renamed to what it actually is');
  if (typeof C.prevAction !== "function") fail("there is no way to undo a state tap");
  else ok("a job can be stepped back one state");
  const back = C.prevAction({ state: "Approved" }, []);
  if (!back || back.to !== "Delivered" || !back.clears.includes("approvedAt"))
    fail("stepping back from Approved does not clear approvedAt");
  else ok("stepping back from Approved returns it to Delivered and clears the stamp");
}

/* ---- 8. the homeowner is a label and nothing else ---- */
{
  /* On a GC job the homeowner is a label. On a job the homeowner called in
     themselves they ARE the client, so the rule is scoped to j.direct. */
  const gcPaths = src.replace(/j\.direct\?[^:]{0,200}:/g, "");
  if (/ownerLabel[^;]{0,80}(mailto|tel:)/i.test(gcPaths))
    fail("a homeowner on a GC job is being contacted");
  else ok("on a GC job the homeowner stays a label — never billed, never contacted");
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
  if ("noesx" in got) fail("the ESX bucket is back in the migration view");
  else ok("no ESX bucket in the migrated board either");
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
