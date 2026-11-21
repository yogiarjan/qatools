import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
const root = resolve(import.meta.dirname, "..");
const P = 5333, B = `http://127.0.0.1:${P}`;
const c = spawn(process.execPath, [resolve(root,"apps/api/node_modules/tsx/dist/cli.mjs"), resolve(root,"apps/api/src/server.ts")], { cwd: resolve(root,"apps/api"), env: {...process.env, PORT:String(P), HOST:"127.0.0.1", QATOOLS_DB: resolve(tmpdir(),`ai2-${Date.now()}.db`)}, stdio:["ignore","pipe","pipe"] });
for (let i=0;i<80;i++){ try{ if((await fetch(`${B}/api/health`)).ok) break }catch{} await new Promise(r=>setTimeout(r,300)); }
const r = await fetch(B+"/api/ai/generate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({task:"generate_usecases",input:{feature_description:"login"},preview_only:true})});
const body = await r.json();
console.log("status:", r.status);
console.log("TOP-LEVEL KEYS:", Object.keys(body));
console.log("HAS meta?", "meta" in body);
console.log("meta =", JSON.stringify(body.meta, null, 2));
console.log("ok =", body.ok, "| error =", body.error);
console.log("data is array?", Array.isArray(body.data), "len =", body.data?.length);
console.log("");
console.log("=== all keys of response ===");
console.log(JSON.stringify(Object.fromEntries(Object.entries(body).map(([k,v])=>[k, Array.isArray(v)?`[array ${v.length}]`:typeof v])), null, 2));
c.kill("SIGKILL"); process.exit(0);
