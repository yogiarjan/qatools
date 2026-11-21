import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
process.env.QATOOLS_DB = resolve(mkdtempSync(resolve(tmpdir(), "pw2-")), "p.db");
const { buildApp } = await import("./src/server.js");
const app = await buildApp({ logger: false });
await app.ready();
const J = async (m,url,p) => { const r = await app.inject({ method:m, url, ...(p?{payload:p}:{}) }); return { s:r.statusCode, b:r.body?JSON.parse(r.body):null }; };
const p = await J("POST","/api/projects",{key:"P",name:"P",target_url:"https://shop.example.test"});
const pid=p.b.data.id;
const wc=await J("POST",`/api/projects/${pid}/testcases`,{code:"TC-001",title:"Login",type:"functional",layer:"web",priority:"high",severity:"major",automation_status:"to_be_automated",engine:"web",status:"ready",expected_result:"Dashboard tampil"});
const dc=await J("POST",`/api/projects/${pid}/testcases`,{code:"TC-004",title:"Db",type:"functional",layer:"db",priority:"medium",severity:"major",automation_status:"to_be_automated",engine:"db",status:"ready"});
await J("POST",`/api/projects/${pid}/web-flows`,{test_case_id:wc.b.data.id,name:"Login Flow",start_url:"https://shop.example.test/login",steps:[{action:"goto",value:"https://shop.example.test/login"}]});
const conn=await J("POST",`/api/projects/${pid}/db-connections`,{name:"Q",dialect:"sqlite",dsn:"sqlite:///x.db"});
await J("POST",`/api/projects/${pid}/db-checks`,{connection_id:conn.b.data.id,test_case_id:dc.b.data.id,name:"Users",sql:"SELECT COUNT(*) AS n FROM users",assertions:[{source:"row_count",operator:"gte",expected:1}]});
const g = await J("POST",`/api/projects/${pid}/codegen`,{framework:"playwright",base_url:"https://shop.example.test"});
console.log("summary:", JSON.stringify(g.b.data.summary));
for (const f of g.b.data.files) {
  const nan = f.content.split("\n").filter(l=>/\bNaN\b/.test(l));
  const undef = f.content.split("\n").filter(l=>/(['"`])undefined\1/.test(l));
  const bad = /[^\\]\\[^'\\"]/.test(f.content) ? "ODD-ESCAPE" : "";
  if (nan.length) console.log("NaN>", f.path, JSON.stringify(nan));
  if (undef.length) console.log("UNDEF>", f.path, JSON.stringify(undef));
  if (bad) console.log("ESC>", f.path);
}
console.log("=== web.spec.ts ===");
console.log(g.b.data.files.find(f=>f.path==="tests/web.spec.ts").content);
await app.close();
