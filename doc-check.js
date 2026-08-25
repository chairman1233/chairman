/* THE PAPERWORK GATE. These documents leave his hands and go to contractors
   and carriers. INV-1010 printed with "Benny" and two blank lines because his
   profile only had a first name — a half-filled profile must never produce a
   half-filled letterhead. Also pins that no raster logo (the one with the pink
   cast) is used on anything that prints.
   Run: node doc-check.js */
const fs=require("fs"),vm=require("vm");
const html=fs.readFileSync("./index.html","utf8");
const script=[...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)][0][1];

let failed=0;
const ok=w=>console.log("ok    "+w);
const fail=(w,d)=>{failed++;console.log("FAIL  "+w+(d?"\n      "+d:""));};

/* --- 1. static: nothing that prints may pull the raster logo --- */
{
 const printFns=["invoiceHTML","contractHTML","printStatus"];
 let bad=[];
 printFns.forEach(fn=>{
  const i=script.indexOf("function "+fn+"(");
  if(i<0)return;
  const body=script.slice(i,i+9000);
  const end=body.indexOf("\nfunction ");
  const src=end>0?body.slice(0,end):body;
  if(/printLogo\(\)|_logoForPrint/.test(src))bad.push(fn);
 });
 if(bad.length)fail("a printed document still uses the raster logo (pink cast)","in: "+bad.join(", "));
 else ok("invoice, contract and status letter all use the vector mark");
}

/* --- 2. runtime: a bare profile still yields a complete letterhead --- */
function boot(me){
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
 vm.runInContext(`globalThis.__me=m=>{D.me=Object.assign(D.me||{},m);};
  globalThis.__inv=j=>{D.jobs=[j];D.accounts=[];return invoiceHTML(j);};`,ctx);
 ctx.__me(me);
 return ctx;
}
const JOB={id:"borland",status:"Complete",owner:"Catherine Borland",
 contractor:"Houston Remodeling Contractors LLC",contractorContact:"Mario Urrutia",
 jobFor:"Contractor",billTo:"Contractor",workType:"Estimate",loss:"Rebuild",
 address:"1414 Pecan Trace Ct, Sugar Land, TX 77479",
 total:112388.61,feeMode:"pct",feePct:2,advance:0,flat:0,subs:[],extras:[],payments:[],
 invNo:"INV-1010",invDate:"2026-08-25"};

/* the exact broken profile: first name only, no phone, no email */
{
 const ctx=boot({biz:"Chairman Remodeling",name:"Benny",rate:2,email:"",phone:"",terms:"Due on completion"});
 const out=ctx.__inv(JOB);
 if(!/Benny Mancillas/.test(out))fail("his full name is missing from the invoice");
 else ok("full name prints even when the profile holds only \"Benny\"");
 if(!/Chairman Remodeling Group LLC/.test(out))fail("the legal entity name is missing");
 else ok("legal entity prints on the letterhead");
 if(!/806-1233/.test(out))fail("no phone anywhere on the invoice");
 else ok("phone prints");
 if(!/chairmansolutions@gmail\.com/.test(out))fail("no email anywhere on the invoice");
 else ok("email prints");
 if(/(ZELLE|PAYABLE TO)[^<]*<br>\s*<b/.test(out.replace(/&nbsp;/g," ").replace(/\s+/g," ")))
  fail("payment block has an empty value");
 else ok("payment block carries real values, no blank fields");
 if(/<img/i.test(out))fail("the invoice still embeds a raster image");
 else ok("no raster image on the invoice at all");
 /* the money must still be right after all the layout surgery */
 if(!/\$2,247\.77/.test(out))fail("2% of $112,388.61 is not on the invoice","expected $2,247.77");
 else ok("the fee is right: 2% of $112,388.61 = $2,247.77");
 if(!/INV-1010/.test(out))fail("invoice number missing");
 else ok("invoice number prints in the header");
}
/* a fully-filled profile must win over every fallback */
{
 const ctx=boot({biz:"Mancillas Estimating LLC",name:"B. R. Mancillas",phone:"713-555-0100",
  email:"me@example.com",zelle:"713-555-0100",title:"Public Insurance Estimator"});
 const out=ctx.__inv(JOB);
 if(/Benny Mancillas|806-1233|chairmansolutions/.test(out))
  fail("a fallback overrode what he actually typed in Settings");
 else ok("his own settings always beat the fallbacks");
 if(!/Mancillas Estimating LLC/.test(out))fail("his own business name did not print");
 else ok("his business name prints as typed");
}

console.log("");
if(failed){console.error(failed+" document assertion(s) failed. This paper goes to his clients — do not push.");process.exit(1);}
console.log("PASS — his name, his company and his numbers are on every page.");
