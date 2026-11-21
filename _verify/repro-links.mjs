import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
const root = resolve(import.meta.dirname, "..");
const P = 5337, B = `http://127.0.0.1:${P}`;
const DB = resolve(tmpdir(), `lk-${Date.now()}.db`);
const c = spawn(process.execPath, [resolve(root,"apps/api/node_modules/tsx/dist/cli.mjs"), resolve(root,"apps/api/src/server.ts")], { cwd: resolve(root,"apps/api"), env: {...process.env, PORT:String(P), HOST:"127.0.0.1", QATOOLS_DB: DB}, stdio:["ignore","pipe","pipe"] });
for (let i=0;i<80;i++){ try{ if((await fetch(`${B}/api/health`)).ok) break }catch{} await new Promise(r=>setTimeout(r,300)); }
const j = async (u,m,b)=>{const r=await fetch(B+u,{method:m||"GET",headers:{"content-type":"application/json"},body:b?JSON.stringify(b):undefined});return (await r.json());};
const p = (await j("/api/projects","POST",{key:"LK",name:"Links"})).data.id;
const rq = (await j(`/api/projects/${p}/requirements`,"POST",{code:"REQ-001",title:"T"})).data.id;
const uc = (await j(`/api/projects/${p}/usecases`,"POST",{code:"UC-001",name:"U",requirement_ids:[rq]})).data.id;
const sc = (await j(`/api/projects/${p}/scenarios`,"POST",{use_case_id:uc,code:"SC-001",title:"S"})).data.id;
const tc = (await j(`/api/projects/${p}/testcases`,"POST",{scenario_id:sc,use_case_id:uc,code:"TC-001",title:"T"})).data.id;
console.log("req=",rq.slice(0,12)," uc=",uc.slice(0,12)," tc=",tc.slice(0,12));
const d = new DatabaseSync(DB);
console.log("\n=== ALL matrix_links rows actually written ===");
for (const row of d.prepare("SELECT link_type, from_kind, to_kind, from_id, to_id FROM matrix_links").all()) {
  console.log(`  ${row.link_type.padEnd(24)} ${row.from_kind}(${String(row.from_id).slice(0,10)}) -> ${row.to_kind}(${String(row.to_id).slice(0,10)})`);
}
console.log("\n=== metrics query needs one of: to_id=req AND (from_kind='testcase') OR to_kind testcase OR uc-linked ===");
console.log("Does ANY link point at the requirement?", d.prepare("SELECT COUNT(*) AS n FROM matrix_links WHERE to_id=?").get(rq).n);
console.log("Links with from_kind='testcase':", d.prepare("SELECT COUNT(*) AS n FROM matrix_links WHERE from_kind='testcase'").get().n);
c.kill("SIGKILL"); process.exit(0);
