import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
const root = resolve(import.meta.dirname, "..");
const P = 5361, B = `http://127.0.0.1:${P}`;
const c = spawn(process.execPath, [resolve(root,"apps/api/node_modules/tsx/dist/cli.mjs"), resolve(root,"apps/api/src/server.ts")], { cwd: resolve(root,"apps/api"), env: {...process.env, PORT:String(P), HOST:"127.0.0.1", QATOOLS_DB: resolve(tmpdir(),`iv-${Date.now()}.db`)}, stdio:["ignore","pipe","pipe"] });
for (let i=0;i<80;i++){ try{ if((await fetch(`${B}/api/health`)).ok) break }catch{} await new Promise(r=>setTimeout(r,300)); }
const j = async (u,m,b)=>{const r=await fetch(B+u,{method:m||"GET",headers:{"content-type":"application/json"},body:b?JSON.stringify(b):undefined});return {s:r.status,j:await r.json().catch(()=>null),t:await r.text().catch(()=>"")};};

console.log("--- A: key as an OBJECT, name as an ARRAY ---");
const a = await j("/api/projects","POST",{key:{a:1},name:[1,2]});
console.log(a.s, JSON.stringify(a.j).slice(0,320));

console.log("\n--- B: 5000-char key ---");
const b = await j("/api/projects","POST",{key:"X".repeat(5000),name:"n"});
console.log(b.s, "key stored as:", JSON.stringify(b.j?.data?.key)?.slice(0,60), "length:", b.j?.data?.key?.length);

console.log("\n--- C: null byte in key/name ---");
const d = await j("/api/projects","POST",{key:"A\u0000B",name:"n\u0000m"});
console.log(d.s, "key:", JSON.stringify(d.j?.data?.key), "name:", JSON.stringify(d.j?.data?.name));

console.log("\n--- D: does the object-key project pollute the list? ---");
const l = await j("/api/projects");
console.log(l.s, "total:", l.j?.total, "keys seen:", JSON.stringify(l.j?.data?.map(x=>x.key)));
c.kill("SIGKILL"); process.exit(0);
