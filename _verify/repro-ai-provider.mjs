import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
const root = resolve(import.meta.dirname, "..");
const P = 5331, B = `http://127.0.0.1:${P}`;
const c = spawn(process.execPath, [resolve(root,"apps/api/node_modules/tsx/dist/cli.mjs"), resolve(root,"apps/api/src/server.ts")], { cwd: resolve(root,"apps/api"), env: {...process.env, PORT:String(P), HOST:"127.0.0.1", QATOOLS_DB: resolve(tmpdir(),`ai-${Date.now()}.db`)}, stdio:["ignore","pipe","pipe"] });
for (let i=0;i<80;i++){ try{ if((await fetch(`${B}/api/health`)).ok) break }catch{} await new Promise(r=>setTimeout(r,300)); }
const j = async (u,m,b)=>{const r=await fetch(B+u,{method:m||"GET",headers:{"content-type":"application/json"},body:b?JSON.stringify(b):undefined});return {s:r.status,t:await r.text()};};
console.log("--- AI generate with BOGUS provider ---");
const a = await j("/api/ai/generate","POST",{task:"generate_usecases",input:{feature_description:"x"},provider:"definitely-not-a-provider",preview_only:true});
console.log(a.s, a.t.slice(0,700));
console.log("");
console.log("--- AI generate with NO provider (offline) ---");
const b2 = await j("/api/ai/generate","POST",{task:"generate_usecases",input:{feature_description:"login"},preview_only:true});
console.log(b2.s, b2.t.slice(0,400));
console.log("");
console.log("--- AI status ---");
const s = await j("/api/ai/status"); console.log(s.s, s.t.slice(0,400));
c.kill("SIGKILL"); process.exit(0);
