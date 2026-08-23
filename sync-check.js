/* THE EMPTY-PHONE GATE. He signed in on his phone and watched an empty board
   replace his company: save() minted a fresh _ts on blankness, the pull
   refused the "older" cloud, and the flush pushed emptiness up. This pins the
   three rules that make that impossible:
     1. an empty local board ADOPTS a non-empty cloud, whatever the clocks say
     2. an empty board never pushes over a cloud not CONFIRMED empty
     3. a confirmed-empty cloud can still be seeded by the first device
   Run: node sync-check.js */
const fs=require("fs"),vm=require("vm");
const html=fs.readFileSync("./index.html","utf8");
const script=[...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)][0][1];

let failed=0;
const ok=w=>console.log("ok    "+w);
const fail=(w,d)=>{failed++;console.log("FAIL  "+w+(d?"\n      "+d:""));};

function fresh(remoteRows){
 const store={};
 const calls={pushes:0,pulls:0,lastPushBody:null};
 const ctx={console,
  localStorage:{getItem:k=>(k in store?store[k]:null),setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>{delete store[k]}},
  navigator:{userAgent:"node"},setInterval:()=>0,setTimeout:()=>0,requestAnimationFrame:()=>0,
  document:{hidden:false,getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],
   addEventListener:()=>{},createElement:()=>({style:{},classList:{add(){},remove(){},toggle(){}}}),
   documentElement:{style:{setProperty(){}}},body:{appendChild(){}}}};
 ctx.window=ctx;ctx.addEventListener=()=>{};
 ctx.fetch=async(url,opts)=>{
  if(/\/rest\/v1\/boards/.test(url)&&(!opts||!opts.method||opts.method==="GET")){
   calls.pulls++;return {ok:true,status:200,json:async()=>remoteRows};
  }
  if(/\/rest\/v1\/boards/.test(url)&&opts&&opts.method==="POST"){
   calls.pushes++;calls.lastPushBody=JSON.parse(opts.body);return {ok:true,status:201,json:async()=>[]};
  }
  return {ok:true,status:200,json:async()=>({})};
 };
 vm.createContext(ctx);
 try{vm.runInContext(script,ctx)}catch(e){}
 vm.runInContext(`
  globalThis.__setBoard=(jobs,ts)=>{D.jobs=jobs;D._ts=ts;};
  globalThis.__jobs=()=>D.jobs.map(j=>j.id).join(",");
  globalThis.__ts=()=>D._ts;
  globalThis.__sess=()=>{SESS={access_token:"t",user:{id:"u1"}};};
  globalThis.__pull=()=>cloudPull();
  globalThis.__flush=()=>flushCloud();
  globalThis.__flag=()=>_remoteHadData;
 `,ctx);
 ctx.__sess();
 return {ctx,calls};
}

const REMOTE=[{user_id:"u1",updated_at:"2026-08-20T10:00:00Z",
 data:{jobs:[{id:"real1",status:"Paid"},{id:"real2",status:"Estimating"}],notes:[],plans:[],_ts:new Date("2026-08-20T10:00:00Z").getTime()}}];

(async()=>{
 /* 1 — the exact phone scenario: blank board, FRESH local timestamp */
 {
  const {ctx}=fresh(REMOTE);
  ctx.__setBoard([],Date.now());        /* blank but "newer" — the poison */
  await ctx.__pull();
  if(ctx.__jobs()!=="real1,real2")fail("empty board with fresh _ts did not adopt the cloud","got: "+(ctx.__jobs()||"(still empty)"));
  else ok("empty board adopts a non-empty cloud even when its clock says it's newer");
 }
 /* 2 — empty board must not push over an unknown cloud */
 {
  const {ctx,calls}=fresh(REMOTE);
  ctx.__setBoard([],Date.now());
  await ctx.__flush();                   /* no pull yet — cloud state unknown */
  if(calls.pushes>0)fail("empty board pushed over an UNKNOWN cloud");
  else ok("empty board refuses to push before the cloud has been checked");
 }
 /* 3 — ...or over a cloud confirmed to have data */
 {
  const {ctx,calls}=fresh(REMOTE);
  ctx.__setBoard([],0);
  await ctx.__pull();                    /* adopts; flag true */
  ctx.__setBoard([],Date.now());        /* simulate it somehow blanking again */
  await ctx.__flush();
  if(calls.pushes>0)fail("empty board pushed over a cloud KNOWN to have his jobs");
  else ok("empty board refuses to push over a cloud known to have data");
 }
 /* 4 — a genuinely fresh account still seeds the cloud */
 {
  const {ctx,calls}=fresh([]);           /* remote: no rows at all */
  ctx.__setBoard([{id:"first",status:"Estimating"}],Date.now());
  await ctx.__pull();                    /* no rows → seeds via flush */
  if(calls.pushes<1)fail("first device never seeded an empty cloud");
  else ok("first device with real work still seeds a confirmed-empty cloud");
 }
 /* 5 — a non-empty board still syncs normally */
 {
  const {ctx,calls}=fresh(REMOTE);
  ctx.__setBoard([{id:"mine",status:"Paid"}],Date.now()+5000);
  await ctx.__flush();
  if(calls.pushes!==1)fail("a NORMAL board can no longer push — guard too broad");
  else ok("a board with real work pushes normally");
 }
 console.log("");
 if(failed){console.error(failed+" sync assertion(s) failed. Do not push — this is the class that deletes his company.");process.exit(1);}
 console.log("PASS — an empty device can never win.");
})();
