/* ================= THE DATA-LOSS GATE =============================
   parse / form / match / money all check LOGIC. None of them can see the class
   of bug that cost Benny an hour today: the app silently throwing away what he
   had typed. Three separate causes in one evening, one symptom every time —
   "it won't save", with nothing on screen to say why.

   This gate covers the two causes that are checkable without a browser:

     C-140  a settings action rebuilt the sheet and redrew every field from
            SAVED data, discarding anything typed and not yet saved
     C-139  a hidden background tab published its stale copy over the
            foreground tab's newer data

   The third (C-138 — Leaflet drawing over the settings sheet, so keystrokes
   never landed) needs real layout and is NOT covered here. That one is a
   browser check, and pretending a Node script catches it would be worse than
   admitting it doesn't.

   Run:  node ui-check.js                                                   */
const fs = require("fs");
const vm = require("vm");

const html = fs.readFileSync("./index.html", "utf8");
const script = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)][0][1];

let failed = 0;
const fail = (what, detail) => { failed++; console.log("FAIL  " + what + (detail ? "\n      " + detail : "")); };
const pass = (what) => console.log("ok    " + what);

/* ------------------------------------------------------------------ 1
   STATIC: every path that rebuilds the Settings sheet must stash first.

   Encoding the rule itself beats testing one example of it. A new provider
   button added next month is caught the day it lands, not the day he loses
   an address to it. */
console.log("\n— settings rebuilds keep what he typed —");
{
  /* find each `close_();settings()` and look back for a stashMe in the same
     statement / handler */
  const re = /close_\(\)\s*;\s*settings\(\)/g;
  let m, n = 0, bad = 0;
  while ((m = re.exec(script))) {
    n++;
    /* the enclosing handler: back to the previous newline that starts a
       function, an onclick=", or a `;` at depth 0 — 400 chars is generous
       and every real call site is far shorter than that */
    const back = script.slice(Math.max(0, m.index - 400), m.index);
    /* A sheet that merely OFFERS to open settings ("Set up AI", "Switch
       provider") has no open settings sheet to preserve — those live inside
       an onclick on a button in a DIFFERENT sheet. Recognise them by the
       button markup immediately before. */
    const isOfferButton = /<button[^>]*onclick="$/.test(back) || /onclick="\s*$/.test(back);
    if (isOfferButton) continue;
    if (!/stashMe\(\)/.test(back)) {
      bad++;
      const line = script.slice(0, m.index).split("\n").length;
      fail("a settings rebuild that does not stash first",
        "inline-script line " + line + ": …" + back.slice(-90).replace(/\s+/g, " ") + " >>> close_();settings()");
    }
  }
  if (!bad) pass(`${n} settings-rebuild path(s), every one stashes first`);
}

/* ------------------------------------------------------------------ 2
   RUNTIME: stashMe() actually moves the open sheet's fields into D.me.
   The static check proves it's CALLED; this proves it WORKS. */
console.log("\n— stashMe moves typed fields into the record —");
{
  const FIELDS = {};                     /* id -> {value} */
  const el = (id) => (FIELDS[id] !== undefined ? { get value() { return FIELDS[id]; }, set value(v) { FIELDS[id] = v; } } : null);
  const ctx = {
    console,
    localStorage: (() => { const s = {}; return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; } }; })(),
    navigator: { userAgent: "node" },
    setInterval: () => 0, setTimeout: () => 0, requestAnimationFrame: () => 0,
    document: {
      hidden: false,
      getElementById: el,
      querySelector: (s) => (s && s[0] === "#" ? el(s.slice(1)) : null),
      querySelectorAll: () => [],
      addEventListener: () => {},
      createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} } }),
      documentElement: { style: { setProperty() {} } },
      body: { appendChild() {} },
    },
  };
  ctx.window = ctx; ctx.addEventListener = () => {};
  vm.createContext(ctx);
  try { vm.runInContext(script, ctx); } catch (e) { /* boots into a DOM it doesn't have — fine */ }

  if (typeof ctx.stashMe !== "function") {
    fail("stashMe() is not defined");
  } else {
    vm.runInContext(`globalThis.__me = () => JSON.stringify(D.me);`, ctx);

    /* sheet closed: nothing to stash, and it must not blow up */
    let threw = null;
    try { ctx.stashMe(); } catch (e) { threw = e.message; }
    if (threw) fail("stashMe() throws when the sheet is closed", threw);
    else pass("stashMe() is a no-op when the sheet isn't open");

    /* sheet open, fields typed, nothing saved */
    Object.assign(FIELDS, {
      sn: "Benny", sb: "Chairman Remodeling",
      sp: "713-555-0100", se: "chairmansolutions@gmail.com",
      sr: "2", shr: "95",
      sad: "6100 Fairmont Pkwy\nLa Porte, TX 77571",
    });
    ctx.stashMe();
    const me = JSON.parse(ctx.__me());
    const want = { biz: "Chairman Remodeling", hourRate: 95, addr: "6100 Fairmont Pkwy\nLa Porte, TX 77571" };
    for (const [k, v] of Object.entries(want)) {
      if (me[k] !== v) fail(`stashMe did not keep ${k}`, `want ${JSON.stringify(v)}, got ${JSON.stringify(me[k])}`);
    }
    if (me.biz === want.biz && me.addr === want.addr && me.hourRate === want.hourRate)
      pass("typed address, business name and hourly rate all survive a stash");
  }
}

/* ------------------------------------------------------------------ 3
   RUNTIME: a hidden tab that is behind must not publish over newer data. */
console.log("\n— a hidden stale tab cannot overwrite the foreground —");
{
  const store = {};
  const ctx = {
    console,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    navigator: { userAgent: "node" },
    setInterval: () => 0, setTimeout: () => 0, requestAnimationFrame: () => 0,
    document: {
      hidden: false,
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      addEventListener: () => {}, createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} } }),
      documentElement: { style: { setProperty() {} } }, body: { appendChild() {} },
    },
  };
  ctx.window = ctx; ctx.addEventListener = () => {};
  vm.createContext(ctx);
  try { vm.runInContext(script, ctx); } catch (e) {}

  vm.runInContext(`
    globalThis.__addr  = () => (D.me && D.me.addr) || "";
    globalThis.__setAddr = a => { D.me.addr = a; };
    globalThis.__ts    = () => D._ts;
    globalThis.__setTs = t => { D._ts = t; };
    globalThis.__save  = () => save();
    globalThis.__key   = () => K;
  `, ctx);

  /* foreground writes the address he just typed */
  ctx.__setAddr("6100 Fairmont Pkwy");
  ctx.__save();
  const goodTs = ctx.__ts();
  const stored = () => JSON.parse(ctx.localStorage.getItem(ctx.__key()) || "{}");
  if ((stored().me || {}).addr !== "6100 Fairmont Pkwy") {
    fail("the foreground write did not reach storage");
  } else {
    /* now be a stale background tab: no address, a minute behind, hidden */
    ctx.__setAddr("");
    ctx.__setTs(goodTs - 60000);
    ctx.document.hidden = true;
    ctx.__save();
    ctx.document.hidden = false;

    if ((stored().me || {}).addr !== "6100 Fairmont Pkwy")
      fail("a hidden stale tab overwrote the foreground's newer data",
        "stored addr is now " + JSON.stringify((stored().me || {}).addr));
    else pass("hidden stale save left storage untouched");

    if (ctx.__addr() !== "6100 Fairmont Pkwy")
      fail("the hidden tab did not adopt the newer copy", "it still holds " + JSON.stringify(ctx.__addr()));
    else pass("the hidden tab adopted the newer copy instead of publishing");

    /* and the same tab, VISIBLE, must still be able to write — otherwise the
       guard has quietly broken saving altogether */
    ctx.__setAddr("changed while visible");
    ctx.__save();
    if ((stored().me || {}).addr !== "changed while visible")
      fail("a VISIBLE tab can no longer save — the guard is too broad");
    else pass("a visible tab still writes normally");
  }
}

console.log("");
if (failed) {
  console.error(`${failed} interaction assertion(s) failed. Do not push — this is the class that loses his typing.`);
  process.exit(1);
}
console.log("PASS — typed input survives rebuilds, and stale tabs cannot overwrite it.");
console.log("NOTE — occlusion (C-138: the map drawing over the sheet) needs real layout and is NOT covered here.");
