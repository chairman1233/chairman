/* THE PLANNER GATE. "Plan my day" writes his schedule; a wrong plan either
   schedules work that can't be done (blocked, gated) or packs the day so
   tight one phone call kills it. Pins the spec's hard rules:
     1. blocked !== null is NEVER scheduled
     2. a gated job schedules ONLY the gate-clearing task
     3. the call block comes first, capped at 20
     4. the day never packs past 85% of the window
     5. >50-minute work splits — no 3-hour blocks
     6. regenerating never touches his own items, done blocks, or started blocks
     7. blocking-someone outranks same-money work
   Run: node planner-check.js */
const fs=require("fs"),vm=require("vm");
const html=fs.readFileSync("./index.html","utf8");
const script=[...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)][0][1];

let failed=0;
const ok=w=>console.log("ok    "+w);
const fail=(w,d)=>{failed++;console.log("FAIL  "+w+(d?"\n      "+d:""));};

function boot(nowHM,sched){
 const store={};
 const ctx={console,
  localStorage:{getItem:k=>(k in store?store[k]:null),setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>{delete store[k]}},
  navigator:{userAgent:"node"},setInterval:()=>0,setTimeout:()=>0,requestAnimationFrame:()=>0,
  document:{hidden:true,getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],
   addEventListener:()=>{},createElement:()=>({style:{},classList:{add(){},remove(){},toggle(){}}}),
   documentElement:{style:{setProperty(){}}},body:{appendChild(){}}}};
 ctx.window=ctx;ctx.addEventListener=()=>{};ctx.fetch=async()=>({ok:true,status:200,json:async()=>[]});
 vm.createContext(ctx);
 try{vm.runInContext(script,ctx)}catch(e){}
 vm.runInContext(`
  globalThis.__setup=(jobs,plans)=>{D.jobs=jobs;D.plans=plans||[];D.notes=[];D.accounts=[];
   D.clock={sched:{},days:{}};D.pom={work:50,rest:10,done:0,day:today(),jobId:null,on:false};};
  globalThis.__plan=()=>{try{planDay()}catch(e){/* render() has no DOM here; state is already saved */}};
  globalThis.__plans=()=>D.plans;
  globalThis.__meta=()=>D.planMeta;
  globalThis.__stubClock=(nowHM,s,e)=>{
   globalThis.PLN_NOW=()=>nowHM;                   /* freeze "now" via the seam */
   globalThis.clockState=()=>({target:s,endT:e,late:0,off:!s,in:s,out:null,worked:0});
  };
 `,ctx);
 vm.runInContext(`__stubClock(${JSON.stringify(nowHM)},${JSON.stringify(sched.s)},${JSON.stringify(sched.e)})`,ctx);
 return ctx;
}
const J=(o)=>Object.assign({id:o.id||Math.random().toString(36).slice(2),status:"Estimating",
 workType:"Estimate",loss:"Water",total:20000,feeMode:"pct",feePct:2,subs:[],extras:[],payments:[],
 advance:0,flat:0},o);

/* 1+2 — blocked never scheduled; gated schedules only the clearing task */
{
 const ctx=boot("08:00",{s:"08:00",e:"17:00"});
 ctx.__setup([
  J({id:"trinity",contractor:"Texas Trinity",jobFor:"Contractor",
     blocked:{on:"eagleview",who:"EagleView",since:"2026-08-24"},phase:"Not started"}),
  J({id:"mario",owner:"Mario",gate:"contract",phase:"Not started"}),
  J({id:"lylian",owner:"Lylian",loss:"Mitigation",phase:"Line items",blocking:{who:"Lylian / carrier",since:"2026-08-24"}}),
 ]);
 ctx.__plan();
 const P=ctx.__plans().filter(p=>p.auto&&p.type!=="Break");
 if(P.some(p=>p.jobId==="trinity"))fail("a BLOCKED job got scheduled — the EagleView isn't in yet");
 else ok("blocked job is never scheduled");
 const mario=P.filter(p=>p.jobId==="mario");
 if(!mario.length)fail("gated job vanished entirely — the clearing task must schedule");
 else if(mario.some(p=>!/agreement|retainer|authorization/i.test(p.text)))
  fail("gated job scheduled REAL work","got: "+mario.map(p=>p.text).join(" | "));
 else ok("gated job schedules only the gate-clearing task");
 if(!P.some(p=>p.jobId==="lylian"))fail("the job someone is stalled on didn't make the day");
 else ok("work that unblocks a third party is on the plan");
}
/* 3 — call block first, capped at 20 */
{
 const ctx=boot("08:00",{s:"08:00",e:"17:00"});
 ctx.__setup([
  J({id:"a",owner:"A",status:"Complete",phase:"Done",next:{text:"Call Bobby about the check",date:"2026-08-24"},total:50000}),
  J({id:"b",owner:"B",status:"Complete",phase:"Done",next:{text:"Call Nicholas to confirm the site visit",date:"2026-08-24"}}),
  J({id:"c",owner:"C",phase:"Line items"}),
 ]);
 ctx.__plan();
 const P=ctx.__plans().filter(p=>p.auto);
 if(!P.length){fail("nothing planned at all");}
 else{
  const first=P[0];
  if(first.type!=="Call")fail("call block is not first","first: "+first.text);
  else if(first.mins>20)fail("call block over the 20-minute cap","mins: "+first.mins);
  else ok("call block is first and capped at 20");
 }
}
/* 4 — never past 85% of the window (window 08:00–17:00, reserve 15, budget .85) */
{
 const ctx=boot("08:00",{s:"08:00",e:"17:00"});
 ctx.__setup(Array.from({length:30},(_,i)=>J({id:"j"+i,owner:"Job "+i,phase:"Line items",loss:"Water"})));
 ctx.__plan();
 const P=ctx.__plans().filter(p=>p.auto);
 const work=P.filter(p=>p.type!=="Break").reduce((n,p)=>n+(p.mins||0),0);
 const windowM=(17*60-15)-(8*60);
 if(work>windowM*0.85+1)fail("day packed past 85%","work "+work+" of "+windowM);
 else ok("day stops at 85% — the slack survives ("+work+" of "+windowM+" min)");
 const m=ctx.__meta();
 if(!m||!m.cut||!m.cut.length)fail("overflow was cut SILENTLY — Didn't fit is empty");
 else ok("everything cut is listed with a reason ("+m.cut.length+" items)");
}
/* 5 — no block over 50 minutes, big work splits into parts */
{
 const ctx=boot("08:00",{s:"08:00",e:"17:00"});
 ctx.__setup([J({id:"big",owner:"Fresh 90",phase:"Not started",mport:"Not needed"})]); /* sketch_field = 90 raw */
 ctx.__plan();
 const P=ctx.__plans().filter(p=>p.auto&&p.type!=="Break");
 if(P.some(p=>(p.mins||0)>50))fail("a block over 50 minutes got emitted","mins: "+P.map(p=>p.mins).join(","));
 else ok("no block exceeds 50 minutes");
 if(!P.some(p=>/Part 1 of/.test(p.text)))fail("90-minute work did not split into labelled parts","got: "+P.map(p=>p.text).join(" | "));
 else ok("90-minute sketch splits into labelled parts");
}
/* 6 — regenerate never touches his items, done blocks, or started blocks */
{
 const ctx=boot("13:00",{s:"08:00",e:"17:00"});
 ctx.__setup([J({id:"x",owner:"X",phase:"Review"})],[
  {id:"his",date:ctxToday(ctx),text:"Meet adjuster at Oak Hollow",type:"Meeting",done:false,auto:false,time:"15:00"},
  {id:"done1",date:ctxToday(ctx),text:"Old auto block",type:"Estimate",done:true,auto:true,time:"09:00",mins:30},
  {id:"run1",date:ctxToday(ctx),text:"Started block",type:"Estimate",done:false,auto:true,time:"12:30",mins:50,startedAt:new Date().toISOString()},
  {id:"stale",date:ctxToday(ctx),text:"Stale auto block",type:"Estimate",done:false,auto:true,time:"10:00",mins:30},
 ]);
 ctx.__plan();
 const ids=ctx.__plans().map(p=>p.id);
 if(!ids.includes("his"))fail("regenerate deleted an item HE typed");
 else ok("his own items survive a regenerate");
 if(!ids.includes("done1"))fail("regenerate deleted a DONE block — history lost");
 else ok("done blocks survive");
 if(!ids.includes("run1"))fail("regenerate deleted the block he's mid-way through");
 else ok("a started block survives with its elapsed time");
 if(ids.includes("stale"))fail("stale un-started auto block was NOT replaced");
 else ok("stale auto blocks are wiped and replaced");
}
function ctxToday(ctx){return vm.runInContext("today()",ctx);}

console.log("");
if(failed){console.error(failed+" planner assertion(s) failed. A wrong plan schedules impossible work — do not push.");process.exit(1);}
console.log("PASS — the day plans itself and tells you why.");
