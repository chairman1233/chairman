/* THE INTAKE GATE. His info arrives as texts from contractors; the paste box
   is now the front door. This pins parseLeadText against the REAL texts he
   received, so "paste → filed" never quietly misreads who sent it, where the
   property is, or mistakes a company name for a person.
   Run: node intake-check.js */
const fs=require("fs"),vm=require("vm");
const html=fs.readFileSync("./index.html","utf8");
const script=[...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)][0][1];

const start=script.indexOf("function parseLeadText");
const end=script.indexOf("let _leadLoss");
if(start<0||end<0){console.error("FAIL — parseLeadText not found");process.exit(1);}
const ctx={console};vm.createContext(ctx);
vm.runInContext(script.slice(start,end),ctx);

let failed=0;
const eq=(what,got,want)=>{
 const ok=Array.isArray(want)?want.some(w=>String(got||"").includes(w)):String(got||"")===String(want||"");
 if(ok)console.log("ok    "+what);
 else{failed++;console.log("FAIL  "+what+"\n      got: "+JSON.stringify(got)+" want: "+JSON.stringify(want));}
};

/* 1 — Jordan's actual text, Sat 10:30 PM. Company + contact + address must
   all come out, and "Texas Trinity Construction" must NOT become the client. */
{
 const p=ctx.parseLeadText(
`Jordan Reyes
1203 Twin Oaks Blvd League City, TX 77573 I need to make sure we are on point for the estimate for this Marina job. Can you pull the eagle view I'll pay your for the eagle view and estimate bro.
Texas Trinity Construction`);
 eq("Jordan: company detected",p.company,"Texas Trinity Construction");
 eq("Jordan: the person is Jordan, not the company",p.owner,"Jordan Reyes");
 eq("Jordan: address pulled",p.address,["1203 Twin Oaks Blvd"]);
}
/* 2 — company mentioned inline, the way a forward reads */
{
 const p=ctx.parseLeadText("Jordan Reyes with Texas Trinity Construction needs an estimate at 1203 Twin Oaks Blvd, League City TX 77573");
 eq("inline: company",p.company,"Texas Trinity Construction");
 eq("inline: address",p.address,["1203 Twin Oaks Blvd"]);
}
/* 3 — Mario's onboarding info: contractor with phone, no company name known */
{
 const p=ctx.parseLeadText(`Mario Urrutia
832-431-0987
1414 Pecan Trace Ct, Sugar Land, TX 77498 rebuild`);
 eq("Mario: name",p.owner,"Mario Urrutia");
 eq("Mario: phone",p.phone,"832-431-0987");
 eq("Mario: address",p.address,["1414 Pecan Trace Ct"]);
 eq("Mario: rebuild keyword → job-type HINT only",p.loss,"Rebuild");
}
/* 4 — the homeowner shape the box was built for still works */
{
 const p=ctx.parseLeadText("Fwd: new water loss — Maria Gonzales, 8123 Winkler Dr, Houston 77017. 832-555-0117. State Farm claim 53-889-XX12");
 eq("homeowner: name",p.owner,"Maria Gonzales");
 eq("homeowner: carrier",p.insurer,"State Farm");
 eq("homeowner: no phantom company",p.company,"");
 eq("homeowner: water hint",p.loss,"Water");
}
/* 5 — carrier names must never read as companies ("Farmers Insurance Group"
   is the trap: it ends in Group) */
{
 const p=ctx.parseLeadText("Adjuster from Farmers sent the estimate for Chrese Jackson, 3311 Stratford Manor Dr, Sugar Land TX");
 eq("carrier text: carrier found",p.insurer,"Farmers");
 eq("carrier text: name is the insured",p.owner,"Chrese Jackson");
}
/* 6 — Green Dynasty forward: known company matches, person preserved */
{
 const p=ctx.parseLeadText(`From: Green Dynasty Group
Brenda Thompson, 3126 Bonner Street, La Porte, TX 77571 — hail on the roof`);
 eq("GD: company",p.company,"Green Dynasty Group");
 eq("GD: their client",p.owner,"Brenda Thompson");
 /* "hail on the roof" hints Roof — the loss field is what HE is hired to do,
    and it stays an editable suggestion either way */
 eq("GD: roof hint",p.loss,"Roof");
}

console.log("");
if(failed){console.error(failed+" intake assertion(s) failed. The paste box is his front door — do not push.");process.exit(1);}
console.log("PASS — paste it, it's filed right.");
