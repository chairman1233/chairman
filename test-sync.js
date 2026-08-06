/* Chairman regression suite.
   Run from the repo folder:
     npm install jsdom
     node test-sync.js

   HONEST STATUS (2026-08-06): written at C-61, hand-maintained through C-71.
   Builds C-72..C-99 shipped without it (the test sandbox was down).
   Section 9 ("look") asserts the OLD pure-black / cmdname design that was
   deliberately replaced in C-83+ — it is DISABLED below. Do NOT "fix" the app
   to satisfy section 9; if you revive it, rewrite its assertions against the
   current design (#121212 surfaces, .hdmark wordmark, desaturated palette).
   Everything else (sync, clock, money, map, forms, data-integrity, QA) still
   describes intended behaviour. */
const {JSDOM}=require('jsdom');
const fs=require('fs');
const FILE='./index.html';

function boot(seedLS){
 const html=fs.readFileSync(FILE,'utf8');
 const dom=new JSDOM(html,{runScripts:"dangerously",pretendToBeVisual:true,url:"https://local.test/",
  beforeParse(w){
   w.scrollTo=()=>{};w.confirm=()=>undefined;w.matchMedia=()=>({matches:false});
   w.fetch=()=>Promise.reject(new Error('offline'));
   w.navigator.serviceWorker={register(){return Promise.resolve()}};
   w.indexedDB={open(){const r={};setTimeout(()=>{r.onerror&&r.onerror()},0);return r;}};
   if(seedLS) for(const k in seedLS) w.localStorage.setItem(k,seedLS[k]);
  }});
 return dom.window;
}

const fails=[];
const ok=(n,c)=>{ if(!c) fails.push(n); };

setTimeout(()=>{

 /* 1 — save() must stamp a time and tell the cloud. Its absence was the whole bug. */
 {
  const w=boot(), E=s=>w.eval(s);
  E('D.jobs.push({id:"t1",client:"Test Client",status:"Estimating",total:100000})');
  E('save()');
  ok('save stamps _ts', typeof E('D._ts')==='number' && E('D._ts')>0);
  ok('save writes storage', /Test Client/.test(w.localStorage.getItem('chairman_v2')||''));
  ok('save keeps a backup copy', /Test Client/.test(w.localStorage.getItem('chairman_v2_bak')||''));
  ok('cloudDirty is reachable from save', typeof E('cloudDirty')==='function');
 }

 /* 2 — an empty server copy must never overwrite real local work */
 {
  const w=boot(), E=s=>w.eval(s);
  E('D.jobs.push({id:"t2",client:"Keep Me",status:"Estimating"});save()');
  ok('guard spots empty remote vs real local',
     E('boardIsEmpty({jobs:[],notes:[],plans:[]}) && !boardIsEmpty(D)')===true);
  ok('local board intact', E('D.jobs.length')===1);
  ok('non-empty remote is not treated as empty',
     E('boardIsEmpty({jobs:[{id:1}],notes:[],plans:[]})')===false);
  const src=E('cloudPull.toString()');
  ok('empty-remote guard only applies when local is newer',
     /boardIsEmpty\(remote\.data\)&&!boardIsEmpty\(D\)&&\(D\._ts\|\|0\)>rts/.test(src.replace(/\s+/g,'')));
 }

 /* 3 — clock-in survives closing and reopening */
 {
  const w=boot(), E=s=>w.eval(s);
  E('clockIn()');
  const stamped=E('clockState().in');
  ok('clock in recorded', !!stamped);
  const saved=w.localStorage.getItem('chairman_v2');
  ok('clock in hits storage immediately', /"in":"\d\d:\d\d"/.test(saved||''));
  const w2=boot({chairman_v2:saved});
  ok('clock in survives reopening', w2.eval('clockState().in')===stamped);
 }

 /* 4 — a rename must never orphan real work again */
 {
  const old=JSON.stringify({jobs:[{id:"o1",client:"Old Job",status:"Estimating"}],notes:[],seeded:false});
  const w=boot({chairman_cc_v1:old});
  ok('adopts real work from an older key',
     w.eval('D.jobs.length')===1 && w.eval('D.jobs[0].client')==='Old Job');
 }
 {
  const demo=JSON.stringify({jobs:[{id:"d1",client:"Linh Nguyen"}],seeded:true});
  ok('but ignores seeded demo data', boot({chairman_cc_v1:demo}).eval('D.jobs.length')===0);
 }

 /* 5 — snapshot rescues a board that got emptied */
 {
  const w=boot({chairman_v2:JSON.stringify({jobs:[],notes:[],plans:[]}),
                chairman_v2_bak:JSON.stringify({jobs:[{id:"b1",client:"Rescued"}],notes:[]})});
  ok('falls back to last good snapshot', w.eval('D.jobs.length')===1);
 }

 /* 6 — ticker moves on a quiet day too */
 {
  const w=boot(), html=w.eval('tickerHTML()');
  ok('ticker no longer hard-disables animation', !/animation:none/.test(html));
  ok('ticker duplicates content for a seamless loop', (html.match(/class="it"/g)||[]).length>=4);
  ok('wireTape exists', typeof w.eval('wireTape')==='function');
 }

 /* 7 — money still adds up */
 {
  const E=s=>boot().eval(s);
  ok('2% fee', Math.round(E('fee({total:100000,feeMode:"pct"}).gross'))===2000);
  ok('flat fee', Math.round(E('fee({total:100000,feeMode:"flat",flat:1500}).gross'))===1500);
  ok('retainer bills nothing', E('fee({total:100000,feeMode:"retainer"}).due')===0);
  /* added C-90+: part-payments and company deals */
  ok('payments reduce what is owed',
     Math.round(E('fee({total:100000,feeMode:"flat",flat:10000,payments:[{id:"p",amount:4000}]}).due'))===6000);
  ok('aftersubs uses the balance after subs',
     Math.round(E('fee({total:100000,feeMode:"aftersubs",feePct:10,subs:["s1"],subCosts:{s1:20000}}).feeOnly'))===8000);
 }

 /* 7b — company deal rules (C-91..C-95) */
 {
  const w=boot(), E=s=>w.eval(s);
  E('D.accounts=[{id:"gd",name:"Green Dynasty Group",feeMode:"retainer",rules:['
   +'{id:"r1",loss:["Mitigation","Water","Mold"],minTotal:30000,pct:10,mode:"aftersubs"},'
   +'{id:"r2",loss:["Remodel","Rebuild"],minTotal:0,pct:40,mode:"aftersubs"}]}]');
  E('D.jobs.push({id:"g1",accountId:"gd",contractor:"Green Dynasty Group",jobFor:"Contractor",loss:"Water",total:45000,feeMode:"retainer"})');
  E('applyAcctRule(job("g1"))');
  ok('a $45k Water job takes the 10% mit deal', E('job("g1").feePct')===10 && E('job("g1").feeMode')==='aftersubs');
  E('job("g1").total=20000;applyAcctRule(job("g1"))');
  ok('dropping under $30k hands the rate back to the company default', E('job("g1").feeMode')==='retainer');
  E('job("g1").total=45000;job("g1").loss="Remodel";applyAcctRule(job("g1"))');
  ok('a Remodel takes 40%', E('job("g1").feePct')===40);
  E('job("g1").feeLocked=true;job("g1").feePct=12;applyAcctRule(job("g1"))');
  ok('a locked fee is never overwritten by a rule', E('job("g1").feePct')===12);
 }

 /* 7c — disputes leave the collection paths (C-98) */
 {
  const w=boot(), E=s=>w.eval(s);
  E('D.jobs.push({id:"d1",owner:"Court Case",status:"Invoiced",invDate:"2026-04-25",total:100000,feeMode:"pct",disputeStage:"Pre-suit"})');
  E('D.jobs.push({id:"d2",owner:"Normal Late",status:"Invoiced",invDate:"2026-04-25",total:50000,feeMode:"pct"})');
  ok('inDispute recognises a staged case', E('inDispute(job("d1"))')===true);
  ok('a Settled case is no longer in dispute', E('job("d1").disputeStage="Settled";inDispute(job("d1"))')===false);
  E('job("d1").disputeStage="Pre-suit"');
  const fn=E('(flowNext()||{}).j ? flowNext().j.id : null');
  ok('flowNext never targets a disputed job', fn!=='d1');
  ok('the AI context carries the stand-down order', /Never suggest nudging/.test(E('aiContext()')));
  ok('the brief separates disputed money', /in dispute/i.test(E('brief().lines.join(" ")')));
  ok('a chronology can always be produced', /DISPUTE CHRONOLOGY/.test(E('disputeChronText(job("d1"))')));
 }

 /* 8 — map: pins, distances, directions */
 {
  const w=boot(), E=s=>w.eval(s);
  E('D.me.addr="1234 Main St, Houston, TX";D.me.homeLat=29.76;D.me.homeLon=-95.37;save()');
  ok('home base recognised', E('!!homeBase()'));
  E('D.jobs.push({id:"m1",owner:"Ben Truong",address:"88 Cedar Post, Houston TX",status:"Estimating",total:50000,lat:29.90,lon:-95.60,workType:"Estimate",insurer:"State Farm",claim:"AB-1"});save()');
  const mi=E('milesFromHome(job("m1"))');
  ok('distance computed', typeof mi==='number' && mi>10 && mi<30);
  ok('job appears on the map', E('mapJobs().length')===1);
  const card=E('pinCard(job("m1"))');
  ok('popup carries the client name', /Ben Truong/.test(card));
  ok('popup carries the address', /Cedar Post/.test(card));
  ok('popup carries carrier and claim', /State Farm/.test(card) && /AB-1/.test(card));
  ok('popup shows the estimate', /50,000|50000/.test(card));
  ok('popup has a directions link', /google\.com\/maps\/dir/.test(card));
  ok('directions start from home base', /origin=/.test(E('directionsURL(job("m1"))')));
  E('job("m1").status="Paid";save()');
  ok('paid job hidden by default', E('mapJobs().length')===0);
  E('D.mapDone=true;save()');
  ok('paid job shown when toggled on', E('mapJobs().length')===1);
  ok('lost jobs never mapped', (E('D.jobs.push({id:"m2",status:"Lost",lat:29.7,lon:-95.4});mapJobs().length'))===1);
 }

 /* 8b — phone numbers belong on the job, not buried in a note */
 {
  const w=boot(), E=s=>w.eval(s);
  E('D.jobs.push({id:"p1",owner:"Marcus",phone:"713-555-0142",contractorPhone:"832-555-0100",status:"Estimating",lat:29.8,lon:-95.4})');
  const form=E('newJob.toString()');
  ok('the job form has a phone input', /id="jph"/.test(form));
  ok('the job form has a contractor phone input', /id="jcph"/.test(form));
  ok('save reads a phone field', /phone:\$\("#jph"\)/.test(E('saveJob.toString()')));
  const card=E('pinCard(job("p1"))');
  ok('map popup shows the phone', /713-555-0142/.test(card));
  ok('map popup makes the phone tappable', /href="tel:7135550142"/.test(card));
  E('D.jobs.push({id:"g1",owner:"Jennifer",address:"123 Tonkawa Trl, Houston TX",status:"Estimating"})');
  ok('unlocated address is flagged', E('geoUnresolved(job("g1"))')===true);
  ok('a located address is not flagged', E('geoUnresolved(job("p1"))')===false);
  ok('lost jobs are not nagged about', E('job("g1").status="Lost";geoUnresolved(job("g1"))')===false);
 }

 /* 8c — settings must not lie about where the data lives */
 {
  const w=boot(), E=s=>w.eval(s);
  const src=E('settings.toString()');
  ok('settings no longer claims device-only storage unconditionally',
     !/Saves on this device only\. Back it up/.test(src));
  ok('settings reports real sync state', /signedIn\(\)/.test(src));
  ok('example data is guarded when the board has real work',
     /boardIsEmpty\(D\)/.test(E('demo.toString()')));
 }

 /* 8d — the job form must not fight him, and must not save junk */
 {
  const w=boot(), E=s=>w.eval(s), doc=w.document;
  const save=E('saveJob.toString()');
  const form=E('newJob.toString()');
  ok('cloud pull stands down while a form is open',
     /getElementById\("ov"\)\)return/.test(E('cloudPull.toString()').replace(/\s+/g,'')));
  ok('name field blocks autofill', /id="jc"[^>]*autocomplete="off"/.test(form));
  ok('who-is-this-for is read from the DOM', /forFromDOM\(\)/.test(save));
  ok('validation exists', typeof E('validateJob')==='function');
  doc.getElementById('view').innerHTML=
    '<div id="jfor"><button class="opt2 on"></button><button class="opt2"></button></div>'+
    '<label><input class="in" id="jc" value=""></label>'+
    '<label><input class="in" id="jt" value="0"></label>'+
    '<label><input class="in" id="jv" value="0"></label>';
  ok('a nameless job is rejected', E('validateJob("Homeowner")').includes('name'));
  doc.getElementById('jc').value='Brenda Thompson';
  ok('a named job passes', E('validateJob("Homeowner")').length===0);
  doc.getElementById('jt').value='-5';
  ok('a negative total is rejected', E('validateJob("Homeowner")').includes('total'));
 }

 /* 9 — look — DISABLED. Written for the C-71 pure-black + cmdname design that
    was deliberately replaced in C-83+ (Material #121212 surfaces, .hdmark
    header wordmark, desaturated palette). Do not resurrect these assertions
    against the current app; rewrite them if the look section is revived. */
 if(0){}

 /* 10 — the data-integrity blocker: no silent overwrite, seeds quarantined,
    and a wipe must be visible and reversible */
 {
  const w=boot(), E=s=>w.eval(s);
  E('demoGo()');
  ok('example rows are tagged', E('D.jobs.every(j=>j._demo)')===true);
  ok('a board of only examples still counts as empty', E('boardIsEmpty(D)')===true);
  E('D.jobs.push({id:"real1",owner:"Brenda Thompson",status:"Estimating"});save()');
  ok('a real job among examples makes the board non-empty', E('boardIsEmpty(D)')===false);

  const w2=boot(), E2=s=>w2.eval(s);
  E2('D.jobs.push({id:"here1",owner:"Only Here",status:"Estimating"},{id:"both",owner:"Shared"});save()');
  const lost=E2('onlyHere(D,{jobs:[{id:"both",owner:"Shared"}],notes:[],subs:[],plans:[]})');
  ok('local-only work is detected before any overwrite', lost.length===1 && lost[0].name==='Only Here');
  ok('cloudPull asks instead of overwriting', /askConflict/.test(E2('cloudPull.toString()')));
  const merged=E2('mergeBoards({jobs:[{id:"a"},{id:"b"}],notes:[],subs:[],plans:[],log:[],files:[]},{jobs:[{id:"b"},{id:"c"}],notes:[],subs:[],plans:[],log:[],files:[]})');
  ok('merge is a union, not a replacement', merged.jobs.length===3);

  const w3=boot(), E3=s=>w3.eval(s);
  E3('D.jobs.push({id:"h1",owner:"Before Wipe",status:"Estimating"});save()');
  E3('snapshot("test")');
  ok('history records a version', E3('readHist().length')>0);
  E3('D.jobs=[];save()');
  ok('history survives the board being emptied', E3('readHist().length')>0);
  ok('an earlier version still holds the work',
     E3('readHist().some(v=>v.data.includes("Before Wipe"))')===true);
 }

 /* 11 — the 13-defect QA pass */
 {
  const w=boot(), E=s=>w.eval(s);
  const addr=E('parseUSAddress("18617 Egret Bay Boulevard Houston Texas 77058")');
  ok('address parses a postcode', addr.postalcode==='77058');
  ok('a five-digit house number is not read as the postcode', addr.street.indexOf('18617')===0);
  ok('a spelled-out state is understood', addr.state==='TX');
  ok('phone numbers are masked', /••• ••• 0142/.test(E('maskDigits("call 713-555-0142")')));
  ok('ordinary numbers survive masking', E('maskDigits("total 38500")')==='total 38500');
  E('D.jobs=[];D.notes=[{id:"n1",jobId:"gone",text:"713-555-0142",created:new Date().toISOString()}];migrate()');
  ok('a note pointing at a deleted job is detached', E('D.notes[0].jobId')===null);
  const sav=E('save.toString()');
  ok('quota errors are identified', /isQuota/.test(sav));
  ok('he is told when saving has stopped', /NOT being saved/.test(sav));
  ok('0 entries, not 0 entrys', E('plural(0,"entry")')==='0 entries');
  ok('paid work cannot be overdue', E('DONE_ST').includes('Paid'));
  ok('a truncated Google key is caught', /cut short/.test(E('keyProblem("gemini","AIzaSyShort123")')));
  /* keys must never travel in a backup — C-86 moved to per-provider keys */
  ok('backups strip the key map', /safe\.ai\.keys=\{\}/.test(E('backup.toString()').replace(/\s+/g,'')));
 }

 console.log(fails.length ? 'FAIL:\n  - '+fails.join('\n  - ')
                          : 'PASS — all checks green');
 process.exit(fails.length?1:0);
},2500);
