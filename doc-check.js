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

/* --- 1. HIS logo, and only his. I once swapped it for a mark I drew myself;
       that must never happen again, so the real asset is pinned here. --- */
{
 if(!/const PRINT_MARK=\(pt\)=>`<img src="\$\{esc\(_logoForPrint\|\|printLogo\(\)\)\}"/.test(script))
  fail("the letterhead is not using his own logo asset");
 else ok("the letterhead uses HIS logo file, not a substitute");
 if(/<svg[^>]*viewBox="0 0 124 136"[\s\S]{0,400}?PRINT_MARK/.test(script))
  fail("a hand-drawn mark is still standing in for his logo");
 else ok("no invented mark anywhere in the print path");
 /* and the cleaner must leave zero chroma behind */
 const i=script.indexOf("async function cleanPrintLogo");
 const src=script.slice(i,i+1400);
 if(!/d\.data\[i\+3\]\)d\.data\[i\]=d\.data\[i\+1\]=d\.data\[i\+2\]=0/.test(src))
  fail("surviving logo pixels are not forced to pure black — a profile can tint them");
 else ok("every printed logo pixel is forced to pure black, zero chroma");
}

/* --- 1b. CHROME PRINTS WITH "BACKGROUND GRAPHICS" OFF BY DEFAULT.
       Any text that relies on a dark fill to be legible disappears — that is
       exactly how INV-1010 printed with an unreadable header, total and
       banner. Nothing critical may depend on a background being painted. --- */
{
 const i=script.indexOf("function invoiceHTML");
 const src=script.slice(i,script.indexOf("const safeFile=",i));
 const inverted=[...src.matchAll(/background:#(?:111|000|222)[^"]*color:#fff/g)];
 if(inverted.length)fail(inverted.length+" white-on-dark block(s) in the invoice",
  "with background graphics off these print white on white — use rules and weight instead");
 else ok("no white-on-dark blocks — the invoice reads with backgrounds off");
 if(/#printarea \*\{color:#000!important\}/.test(script))
  fail("the blanket print rule still forces every colour to black");
 else ok("the print stylesheet no longer clobbers deliberate colours");
 /* the three things that must always be legible */
 ["TOTAL DUE","RELEASED ONCE PAYMENT IS RECEIVED","DESCRIPTION"].forEach(k=>{
  const at=src.indexOf(k);
  if(at<0){fail('"'+k+'" is missing from the invoice');return;}
  const near=src.slice(Math.max(0,at-320),at);
  if(/color:#fff/.test(near))fail('"'+k+'" depends on a printed background to be readable');
  else ok('"'+k+'" is legible without background graphics');
 });
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
 if(!/<img[^>]+src=/.test(out))fail("his logo is missing from the invoice entirely");
 else ok("his logo is on the invoice");
 /* the money must still be right after all the layout surgery */
 if(!/\$2,247\.77/.test(out))fail("2% of $112,388.61 is not on the invoice","expected $2,247.77");
 else ok("the fee is right: 2% of $112,388.61 = $2,247.77");
 if(!/INV-1010/.test(out))fail("invoice number missing");
 else ok("invoice number prints in the header");
 /* the two things he asked for by name */
 if(!/RELEASED ONCE PAYMENT IS RECEIVED/.test(out))
  fail("the invoice does not say the estimate is released on payment");
 else ok("\"estimate released once payment is received\" is on the face of the invoice");
 if(!/Delivery on Payment/.test(out))fail("no delivery-on-payment term");
 else ok("delivery-on-payment is also a numbered term");
 if(!/Chairman Remodeling Group — Benny Mancillas/.test(out))
  fail("the Zelle registered name is wrong or missing");
 else ok("Zelle shows as registered: Chairman Remodeling Group — Benny Mancillas");
}
/* a fully-filled profile must win over every fallback */
{
 const ctx=boot({biz:"Mancillas Estimating LLC",name:"B. R. Mancillas",phone:"713-555-0100",
  email:"me@example.com",zelle:"713-555-0100",zelleName:"Mancillas Estimating",title:"Public Insurance Estimator"});
 const out=ctx.__inv(JOB);
 if(/Benny Mancillas|806-1233|chairmansolutions/.test(out))
  fail("a fallback overrode what he actually typed in Settings");
 else ok("his own settings always beat the fallbacks");
 if(!/Mancillas Estimating<\/|Mancillas Estimating\b/.test(out))fail("his own Zelle name did not print");
 else ok("his own Zelle registered name prints as typed");
 if(!/Mancillas Estimating LLC/.test(out))fail("his own business name did not print");
 else ok("his business name prints as typed");
}

console.log("");
if(failed){console.error(failed+" document assertion(s) failed. This paper goes to his clients — do not push.");process.exit(1);}
console.log("PASS — his name, his company and his numbers are on every page.");
