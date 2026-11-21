import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
process.env.QATOOLS_DB = resolve(mkdtempSync(resolve(tmpdir(), "pw-")), "p.db");
const { buildApp } = await import("./src/server.js");
const app = await buildApp({ logger: false });
await app.ready();
const J = async (m,url,p) => { const r = await app.inject({ method:m, url, ...(p?{payload:p}:{}) }); return { s:r.statusCode, b:r.body?JSON.parse(r.body):null }; };
const p = await J("POST","/api/projects",{key:"P",name:"P",target_url:"https://shop.example.test"});
const pid=p.b.data.id;
const wc=await J("POST",`/api/projects/${pid}/testcases`,{code:"TC-001",title:"Login",type:"functional",layer:"web",priority:"high",severity:"major",automation_status:"to_be_automated",engine:"web",is_regression:1,status:"ready",expected_result:"Dashboard tampil"});
const nc=await J("POST",`/api/projects/${pid}/testcases`,{code:"TC-002",title:'Verifikasi "kutip ganda" — 100% NaN',type:"negative",layer:"web",priority:"medium",severity:"minor",automation_status:"to_be_automated",engine:"web",status:"ready"});
await J("POST",`/api/projects/${pid}/web-flows`,{test_case_id:wc.b.data.id,name:"Login Flow",start_url:"https://shop.example.test/login",viewport:{width:1440,height:900},steps:[{action:"goto",value:"https://shop.example.test/login"},{action:"click",selector:'button[type="submit"]'},{action:"select",selector:"#language",value:"id"},{action:"check",selector:"#remember"},{action:"press",selector:"#email",value:"Enter"}]});
for (const fw of ["playwright","cypress"]) {
  const g = await J("POST",`/api/projects/${pid}/codegen`,{framework:fw,base_url:"https://shop.example.test"});
  for (const f of g.b.data.files) {
    const lines = f.content.split("\n");
    const nanLines = lines.filter(l=>/\bNaN\b/.test(l) && !l.includes("kutip ganda"));
    if (nanLines.length) console.log(`[${fw}] NaN>`, f.path, JSON.stringify(nanLines));
  }
  const cy = g.b.data.files.find(f=>f.path==="cypress/e2e/web.cy.js");
  if (cy && !cy.content.includes(".click()")) console.log(`[${fw}] WEB.CY.JS:\n${cy.content}`);
}
await app.close();
