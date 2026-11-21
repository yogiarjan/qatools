import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
const root = resolve(import.meta.dirname, "..");
const P = 5321, B = `http://127.0.0.1:${P}`;
const c = spawn(process.execPath, [resolve(root,"apps/api/node_modules/tsx/dist/cli.mjs"), resolve(root,"apps/api/src/server.ts")], { cwd: resolve(root,"apps/api"), env: {...process.env, PORT:String(P), HOST:"127.0.0.1", QATOOLS_DB: resolve(tmpdir(),`pfx-${Date.now()}.db`)}, stdio:["ignore","pipe","pipe"] });
for (let i=0;i<80;i++){ try{ if((await fetch(`${B}/api/health`)).ok) break }catch{} await new Promise(r=>setTimeout(r,300)); }
const j = async (u,m,b)=>{const r=await fetch(B+u,{method:m||"GET",headers:{"content-type":"application/json"},body:b?JSON.stringify(b):undefined});return {s:r.status,j:await r.json().catch(()=>null)};};
const p = await j("/api/projects","POST",{key:"PFX",name:"Prefix check"});
const pid = p.j.data.id;
const conn = await j(`/api/projects/${pid}/db-connections`,"POST",{name:"c",dialect:"sqlite",dsn:resolve(tmpdir(),"pfx.db")});
const chk = await j(`/api/projects/${pid}/db-checks`,"POST",{connection_id:conn.j.data.id,name:"k",sql:"SELECT 1 AS n"});
console.log("db_connection id  =", conn.j.data.id);
console.log("db_check      id  =", chk.j.data.id);
console.log("ARCHITECTURE.md requires db check prefix 'dbc_' (section 5.3 table)");
console.log("db_connection id starts with dbc_ ?", String(conn.j.data.id).startsWith("dbc_"));
console.log("db_check      id starts with dbc_ ?", String(chk.j.data.id).startsWith("dbc_"));
c.kill("SIGKILL"); process.exit(0);
