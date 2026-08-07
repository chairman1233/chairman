/* Parse gate. Run BEFORE every push:   node parse-check.js
   C-117 shipped a template literal that closed too early; the whole inline
   script failed to parse and the app booted to a blank page. Verifying after
   deploy cannot catch that — there is no running app left to ask. This checks
   the file itself. */
const fs=require("fs");
const vm=require("vm");
const FILE="./index.html";

const html=fs.readFileSync(FILE,"utf8");
const scripts=[...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);

if(!scripts.length){console.error("FAIL — no inline script found");process.exit(1);}

let bad=0;
scripts.forEach((src,i)=>{
 try{
  new vm.Script(src,{filename:`inline-script-${i+1}`});
 }catch(e){
  bad++;
  const line=(e.stack||"").match(/inline-script-\d+:(\d+)/);
  const n=line?+line[1]:null;
  console.error(`FAIL — inline script ${i+1} does not parse`);
  console.error(`  ${e.message}`);
  if(n){
   const lines=src.split("\n");
   for(let k=Math.max(0,n-3);k<Math.min(lines.length,n+2);k++){
    console.error(`  ${k+1===n?">>":"  "} ${k+1}  ${lines[k]}`);
   }
   /* map back to the document so the line number is useful in an editor */
   const before=html.slice(0,html.indexOf(src)).split("\n").length;
   console.error(`  document line ~${before+n-1}`);
  }
 }
});

if(bad){console.error(`\n${bad} script(s) failed. Do not push.`);process.exit(1);}
console.log(`PASS — ${scripts.length} inline script(s) parse clean.`);
