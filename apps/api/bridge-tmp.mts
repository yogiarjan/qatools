import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { resolve } from "node:path";
const s = mkdtempSync(resolve(tmpdir(), "qbr-")); process.env.QATOOLS_DB = resolve(s, "b.db");
const { buildApp } = await import("./src/server.js");
const app = await buildApp();
const j = async (m,u,p) => { const r = await app.inject({method:m,url:"/api"+u,...(p?{payload:p}:{})}); let b; try{b=r.json()}catch{b=r.body} return {s:r.statusCode,b}; };
const { newId, nowIso } = await import("@qatools/shared");
const { db } = await import("./src/db/index.js");
const P=newId("prj_"), now=nowIso();
db.prepare(`INSERT INTO projects (id,key,name,status,quality_gate,created_at,updated_at) VALUES (?,?,?,'active',90,?,?)`).run(P,"BR","Bridge",now,now);
const tc=newId("tc_"), run=newId("run_");
db.prepare(`INSERT INTO test_cases (id,project_id,code,title,type,layer,priority,severity,automation_status,engine,risk_score,estimated_minutes,is_regression,status,generated_by,created_at,updated_at) VALUES (?,?,'TC-001','Bridge case','functional','api','critical','blocker','automated','api',0,5,1,'ready','manual',?,?)`).run(tc,P,now,now);
db.prepare(`INSERT INTO test_runs (id,project_id,code,name,kind,engine,status,created_at,updated_at) VALUES (?,?,'RUN-0001','Bridge run','manual','api','running',?,?)`).run(run,P,now,now);
console.log("EXECUTE  ->", JSON.stringify(await j("POST",`/runs/${run}/execute`,{engine:"api",test_case_ids:[tc],dry_run:true})).slice(0,420));
const d = await j("POST",`/projects/${P}/defects`,{title:"Bridge defect",actual_result:"x",expected_result:"y"});
console.log("AI-TRIAGE->", JSON.stringify(await j("POST",`/defects/${d.b.data.id}/ai-triage`,{})).slice(0,420));
console.log("REG-RUN  ->", JSON.stringify(await j("POST",`/projects/${P}/regression/run`,{strategy:"risk_based",dry_run:true})).slice(0,420));
console.log("METRICS  ->", JSON.stringify((await j("GET",`/projects/${P}/metrics`)).b).slice(0,300));
process.exit(0);

