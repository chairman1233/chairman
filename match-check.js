/* Matcher harness. Pulls the estimate-matching functions straight out of
   index.html and runs them against Benny's REAL exported filenames and his
   REAL job list. Filing a client's estimate on the wrong job is the failure
   that matters here, so a wrong match is worse than no match. */
const fs = require("fs");
const vm = require("vm");

const html = fs.readFileSync("./index.html", "utf8");
const script = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)][0][1];

/* lift just the matcher block */
const start = script.indexOf("const ESTDIR_KEY=");
const end = script.indexOf("/* ---- the folder handle");
if (start < 0 || end < 0) { console.error("FAIL — matcher block not found"); process.exit(1); }

/* estMatch names the tied jobs when it can't choose, so it needs jobName */
const ctx = { D: { jobs: [] }, console,
  jobName: j => j.owner || j.contractor || "job",
  sealed: j => !!(j && j.sealed),
  coName: j => (j && j.contractor) || "" };   /* no accounts in this harness */
vm.createContext(ctx);
vm.runInContext(script.slice(start, end), ctx);

ctx.D.jobs = [
  { id: "carmen",  owner: "Carmen Hernandez",       contractor: "Green Dynasty Group",       address: "4235 Lakewood Dr, Pasadena, TX 77504",   status: "Invoiced" },
  { id: "rains1",  owner: "Benny & Donna Rains",    contractor: "Green Dynasty Group",       address: "105 Glynn Way Dr, Houston, TX 77056",    status: "Invoiced" },
  { id: "rains2",  owner: "Donna Rains",            contractor: "Green Dynasty Group",       address: "105 Glynn Way Dr, Houston, TX 77056",    status: "Invoiced" },
  { id: "cokie1",  owner: "Cokie Redo",             contractor: "Green Dynasty Group",       address: "1807 Wooded Acres Dr, Humble, TX 77396", status: "Waiting"  },
  { id: "cokie2",  owner: "Cokie Redo",             contractor: "AJ&S Remodeling LLC",       address: "1807 Wooded Acres Dr, Humble, TX 77396", status: "Waiting"  },
  { id: "brenda",  owner: "Brenda Thompson",        contractor: "Green Dynasty Group",       address: "3126 Bonner Street, La Porte, TX 77571", status: "Paid"     },
  { id: "jennifer",owner: "Jennifer McLaughlin",    contractor: "Green Dynasty Group",       address: "1306 Tomkawa, Deer Park, TX 77536",      status: "Paid"     },
  { id: "lylian",  owner: "Lylian Malacara-Torres", contractor: "Gonz Remodeling & Windows", address: "2506, Maverick Park Lane, Morton Ranch, Harris County", status: "Waiting" },
  { id: "valued",  owner: "",                       contractor: "Valued Renovations",       address: "8403 Red Rooster Lane, Katy, TX 77494",  status: "Estimating" },
];

/* every real filename seen in the ESTIMATES folder, with the job it SHOULD
   land on ("" = should not match anything on the current board) */
const CASES = [
  ["GARY_BYRD_FINAL_DRAFT_CON.pdf",                      ""],
  ["TONKAWA_FINAL_DRAFT_CON.pdf",                        "jennifer"],
  ["TONKAWA_CUSTOMER_TOTAL_AMOUNT_CON.pdf",              "jennifer"],
  ["OAKWILD_FINAL_DRAFT_CON.pdf",                        ""],
  ["BONNER_FINAL_DRAFT_CON.pdf",                         "brenda"],
  ["BONNER_CUSTOMER_TOTAL_AMOUNT_CON.pdf",               "brenda"],
  ["10935_PECAN_REBUILD_CUSTOMER_TOTAL_AMOUNT_CON.pdf",  ""],
  ["10935_PECAN_DR_FINAL_DRAFT_CON.pdf",                 ""],
  ["GARY_BYRD_CUSTOMER_TOTAL_AMOUNT_CON.pdf",            ""],
  ["THE_VOYAGER_FINAL_DRAFT_CON.pdf",                    ""],
  ["GIBSON__FINAL_DRAFT_CON.pdf",                        ""],
  ["521_WINBURN_FINAL_DRAFT_CON.pdf",                    ""],
  ["2002_WOODFORD_GREENC_FINAL_DRAFT_CON.pdf",           ""],
  ["1003 Claxton Street, Houston, TX - Final Estimate.pdf", ""],
  ["107 Glynn Way Dr, Houston - Final Estimate.pdf",      ""],   // 107 is NOT his 105 job
  ["107_GLYNN_WAY_DR_CUSTOMER_TOTAL_AMOUNT_CON.pdf",      ""],
  ["1209 Wisdom Drive, Deer Park, TX - Final Estimate.pdf", ""],
  ["11008 N L St, La Porte, TX (Recon) - Final Estimate.pdf", ""],
  ["ELLIOT_ST_77023-1_FINAL_DRAFT_CON.pdf",              ""],
  /* the ones that SHOULD hit, written the way he actually exports */
  ["4235_LAKEWOOD_DR_FINAL_DRAFT_CON.pdf",               "carmen"],
  ["105_GLYNN_WAY_DR_CUSTOMER_TOTAL_AMOUNT_CON.pdf",     "rains"],  // either Rains job is fine
  ["1807_WOODED_ACRES_FINAL_DRAFT_CON.pdf",              "cokie"],  // either Cokie job is fine
  ["3126_BONNER_ST_CUSTOMER_TOTAL_AMOUNT_CON.pdf",       "brenda"],
  ["Carmen Hernandez Mitigation Estimate.pdf",           "carmen"],

  /* Found by dry-running all 527 PDFs in his real ESTIMATES folder. */

  /* Eight of twelve jobs are Green Dynasty, so the company name scored 60
     against nine of them at once and the matcher took whichever sorted first.
     This file has JENNIFER in the name and was landing on Carmen. */
  ["Green_Dynasty_Ballpark_Estimate_Jennifer - Final Estimate.pdf", "jennifer"],
  ["Green Dynasty Group estimate.pdf",                   ""],

  /* A tie was being resolved by sort order, so all 47 Rains files went to the
     mitigation job and the $61,264 rebuild got none. A tie is a question. */
  ["Rains - 105 Glynn Way Dr, Houston, TX (Mediation) - Final Estimate.pdf", "AMBIGUOUS"],

  /* The tie test used to sit above the score floor, so two jobs tying on a
     worthless score still came back as a match. */
  ["Watson - 2923 Eagle Nest Lane, Humble, TX - Final Estimate.pdf", ""],

  /* HARRIS is a county, and MANCILLAS is his own surname — both appear across
     unrelated paperwork and identify nothing. */
  ["Complete_with_Docusign_MANCILLAS-ENMC-Harris.pdf",   ""],

  /* Still works: a job with no owner falls back to the company that hired him,
     because there it IS the only handle available. */
  ["Proposed Floor Plan_Valued_Renovations.pdf",         "valued"],
];

let wrong = 0, missed = 0, ok = 0;
const rows = [];
for (const [name, want] of CASES) {
  const m = ctx.estMatch(name);
  const got = m ? m.j.id : "";
  const kind = ctx.estDocKind(name);
  let verdict;
  /* NOTE: an earlier version of this check read want.startsWith(got), which is
     true for every empty got — so every miss was scoring as a pass and the
     BONNER / TONKAWA failures were invisible. Check emptiness FIRST. */
  if (want === "AMBIGUOUS") {
    /* the right answer is "I can't tell" — it must offer, say so, and stay
       below the confidence bar so bulk-filing never touches it */
    verdict = (m && m.amb > 1 && m.score < 60) ? "ok (flagged ambiguous)"
            : m ? "WRONG" : "missed";
  } else if (!want) {
    verdict = got ? "WRONG" : "ok (no match)";
  } else if (!got) {
    verdict = "missed";
  } else if (got === want || got.replace(/\d$/, "") === want) {
    verdict = "ok";
  } else {
    verdict = "WRONG";
  }
  if (verdict === "WRONG") wrong++;
  else if (verdict === "missed") missed++;
  else ok++;
  rows.push({ file: name.slice(0, 46), kind, got: got || "—", want: want || "—", score: m ? m.score : 0, verdict });
}

console.log("file".padEnd(48) + "kind".padEnd(11) + "matched".padEnd(11) + "want".padEnd(10) + "score  verdict");
console.log("-".repeat(100));
for (const r of rows) {
  console.log(r.file.padEnd(48) + r.kind.padEnd(11) + r.got.padEnd(11) + r.want.padEnd(10) + String(r.score).padEnd(7) + r.verdict);
}
console.log("-".repeat(100));
console.log(`ok ${ok} · missed ${missed} · WRONG ${wrong}`);
if (wrong) { console.error("\nFAIL — a wrong match files a client's estimate on someone else's job."); process.exit(1); }
if (missed) { console.error(`\nSOFT FAIL — ${missed} file(s) he'd have to hand-assign. Safe, but the point is to save taps.`); process.exit(2); }
console.log("PASS — no misfiles, no misses.");
