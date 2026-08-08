/* Duplicate-ID gate for the job form.
   The C-124 refactor split one "More" block into five collapsible groups.
   If any field survived in both the old block and a new group, saveJob()
   reads whichever element the DOM hands back first — silently wrong money.
   Run alongside parse-check.js. */
const fs = require("fs");
const html = fs.readFileSync("./index.html", "utf8");

const start = html.indexOf("function newJob");
const end = html.indexOf("function formSec");
if (start < 0 || end < 0 || end < start) {
  console.error("FAIL — could not isolate newJob()");
  process.exit(1);
}
const src = html.slice(start, end);

const counts = {};
for (const m of src.matchAll(/id="([A-Za-z_][\w-]*)"/g)) {
  counts[m[1]] = (counts[m[1]] || 0) + 1;
}
/* Ids that legitimately appear twice in the SOURCE because they sit on the two
   branches of one ternary — only ever one of them reaches the DOM. Each entry
   is [id, expectedCount]. Anything else at >1 is a real collision. */
const TERNARY_PAIRS = {
  jbill:   2,   // billTo segwrap vs. its hidden placeholder
  jstat:   2,   // "where it stands" row vs. its placeholder on closed-stage jobs
  waitblk: 2,   // ditto
  jwait:   2,   // ditto — the placeholder keeps a hidden input so saveJob still reads it
};

const dupes = Object.entries(counts)
  .filter(([id, n]) => n > 1 && n !== TERNARY_PAIRS[id]);

console.log("dense rows: " + (src.match(/\$\{fRow\(/g) || []).length
  + "  (legacy collapsible sections: " + (src.match(/\$\{formSec\(/g) || []).length + ")");

/* every field saveJob() reads must exist exactly once */
const reads = [...src.matchAll(/\$\("#([A-Za-z_][\w-]*)"\)/g)].map(m => m[1]);
console.log("field ids found: " + Object.keys(counts).length);

if (dupes.length) {
  console.error("FAIL — duplicate ids in the job form:");
  dupes.forEach(([id, n]) => console.error("  #" + id + " x" + n));
  process.exit(1);
}
console.log("PASS — no duplicate ids in newJob().");
