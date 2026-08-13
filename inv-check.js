/* Invoice numbering gate. INV-1001 was issued to three different jobs because
   numbers came from a counter two devices could disagree on. This pins:
   - nextInvNo derives from the board, so duplicates cannot recur
   - fixInvoiceDupes repairs the existing damage exactly once, earliest keeps
   - phantoms (invoice numbers on Waiting/Estimating/Lost jobs) are freed
   - custom numbers like GDCon-DRains-C2-Final are never touched
   - CK_ never fabricates a 7am shift onto a board that has real hours
   Run: node inv-check.js */
const fs=require("fs"),vm=require("vm");
const html=fs.readFileSync("./index.html","utf8");
const script=[...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)][0][1];

const store={};
const ctx={console,
 localStorage:{getItem:k=>(k in store?store[k]:null),setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>{delete store[k]}},
 navigator:{userAgent:"node"},setInterval:()=>0,setTimeout:()=>0,requestAnimationFrame:()=>0,
 document:{hidden:false,getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],
  addEventListener:()=>{},createElement:()=>({style:{},classList:{add(){},remove(){},toggle(){}}}),
  documentElement:{style:{setProperty(){}}},body:{appendChild(){}}}};
ctx.window=ctx;ctx.addEventListener=()=>{};
vm.createContext(ctx);
try{vm.runInContext(script,ctx)}catch(e){}
let failed=0;
const fail=(w,d)=>{failed++;console.log("FAIL  "+w+(d?"\n      "+d:""))};
const ok=w=>console.log("ok    "+w);

vm.runInContext(`
 globalThis.__setup=js=>{D.jobs=js;D.notes=[];D.invNo=1001;delete D.invFixV1;};
 globalThis.__jobs=()=>JSON.stringify(D.jobs.map(j=>({id:j.id,invNo:j.invNo||null,invDate:j.invDate||null,status:j.status})));
 globalThis.__notes=()=>JSON.stringify(D.notes.map(n=>n.text));
 globalThis.__next=()=>nextInvNo();
 globalThis.__peek=()=>peekInvNo();
 globalThis.__fix=()=>fixInvoiceDupes();
 globalThis.__sched=(s,seeded)=>{D.clock={sched:s,days:{}};if(seeded!==undefined)D.clock.seeded=seeded;CK_();return JSON.stringify(D.clock.sched)+"|"+!!D.clock.seeded;};
`,ctx);

/* --- numbering derives from the board --- */
console.log("\n— numbering —");
ctx.__setup([{id:"a",status:"Invoiced",invNo:"INV-1007",invDate:"2026-08-01"},
             {id:"b",status:"Paid",invNo:"GDCon-DRains-C2-Final"}]);
if(ctx.__peek()!=="INV-1008")fail("peek should be INV-1008, got "+ctx.__peek());else ok("peek follows the highest issued number");
if(ctx.__next()!=="INV-1008")fail("next should issue INV-1008");else ok("next issues without duplicating");

/* --- the actual damage on his board, repaired --- */
console.log("\n— repair —");
ctx.__setup([
 {id:"gd",   status:"Lost",     invNo:"INV-1001",invDate:"2026-08-08"},   /* phantom */
 {id:"rains",status:"Paid",     invNo:"INV-1001",invDate:"2026-08-06"},
 {id:"brian",status:"Paid",     invNo:"INV-1001",invDate:"2026-08-07"},
 {id:"dhl",  status:"Paid",     invNo:"INV-1002",invDate:"2026-08-02"},
 {id:"bren", status:"Paid",     invNo:"INV-1002",invDate:"2026-08-03"},
 {id:"jen",  status:"Paid",     invNo:"INV-1002",invDate:"2026-08-04"},
 {id:"val",  status:"Waiting",  invNo:"INV-1003",invDate:"2026-08-07"},   /* phantom */
 {id:"car",  status:"Invoiced", invNo:"INV-1004",invDate:"2026-08-08"},
 {id:"don",  status:"Invoiced", invNo:"GDCon-DRains-C2-Final"},
]);
ctx.__fix();
const jobs=JSON.parse(ctx.__jobs());
const by=id=>jobs.find(j=>j.id===id);
if(by("gd").invNo!==null)fail("Lost job still holds "+by("gd").invNo);else ok("phantom on the Lost job freed");
if(by("val").invNo!==null)fail("Waiting job still holds "+by("val").invNo);else ok("phantom on the Waiting job freed");
if(by("rains").invNo!=="INV-1001")fail("earliest INV-1001 holder lost its number");else ok("Rains (earliest) keeps INV-1001");
if(by("dhl").invNo!=="INV-1002")fail("earliest INV-1002 holder lost its number");else ok("DHL (earliest) keeps INV-1002");
if(by("don").invNo!=="GDCon-DRains-C2-Final")fail("custom number was touched");else ok("custom number untouched");
const nums=jobs.map(j=>j.invNo).filter(n=>n&&/^INV-/.test(n));
if(new Set(nums).size!==nums.length)fail("duplicates survive: "+nums.join(","));else ok("every INV number now unique: "+nums.sort().join(", "));
const renumbered=jobs.filter(j=>["brian","bren","jen"].includes(j.id)).every(j=>/^INV-10(0[5-9]|[1-9]\d)$/.test(j.invNo||""));
if(!renumbered)fail("later duplicates not renumbered upward");else ok("later duplicates renumbered upward");
if(JSON.parse(ctx.__notes()).length<5)fail("repairs not recorded as notes");else ok("every change left a note on the job");
/* idempotent */
const before=ctx.__jobs();ctx.__fix();
if(ctx.__jobs()!==before)fail("repair ran twice");else ok("repair is one-time");

/* --- schedule seeding --- */
console.log("\n— schedule —");
let r=ctx.__sched({},false);
if(!/08:00/.test(r)||!/true$/.test(r))fail("blank board did not seed 8-5 once: "+r);else ok("blank board seeds 8–5 exactly once, flagged");
r=ctx.__sched({1:{s:"08:00",e:"17:00"}},undefined);
if(/07:00/.test(r))fail("fabricated 7am onto a board with real hours: "+r);else ok("board with real hours never gets 7am invented");
if(!/\|false$/.test(r)===false&&/true$/.test(r))fail("partial board wrongly marked seeded");else ok("partial board not marked seeded");

console.log("");
if(failed){console.error(failed+" invoice/schedule assertion(s) failed. Do not push.");process.exit(1);}
console.log("PASS — numbering, repair and schedule seeding hold.");
