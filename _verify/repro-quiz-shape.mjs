import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
const root = resolve(import.meta.dirname, "..");
const DB = resolve(tmpdir(), `qz-${Date.now()}.db`);
// seed first
const s = spawn(process.execPath, [resolve(root,"apps/api/node_modules/tsx/dist/cli.mjs"), resolve(root,"apps/api/src/seed/run.ts")], { cwd: resolve(root,"apps/api"), env:{...process.env, QATOOLS_DB: DB}, stdio:["ignore","pipe","pipe"] });
await new Promise(r=>s.on("exit",r));
const P = 5341, B = `http://127.0.0.1:${P}`;
const c = spawn(process.execPath, [resolve(root,"apps/api/node_modules/tsx/dist/cli.mjs"), resolve(root,"apps/api/src/server.ts")], { cwd: resolve(root,"apps/api"), env: {...process.env, PORT:String(P), HOST:"127.0.0.1", QATOOLS_DB: DB}, stdio:["ignore","pipe","pipe"] });
for (let i=0;i<80;i++){ try{ if((await fetch(`${B}/api/health`)).ok) break }catch{} await new Promise(r=>setTimeout(r,300)); }
const j = async (u)=>{const r=await fetch(B+u); return {s:r.status, j:await r.json().catch(()=>null)};};
const courses = await j("/api/courses");
const cid = courses.j.data.find(x=>x.slug==="qa-introduction").id;
const qu = await j(`/api/courses/${cid}/quizzes`);
console.log("GET /courses/:id/quizzes ->", qu.s, JSON.stringify(qu.j).slice(0,700));
const det = await j(`/api/courses/${cid}`);
const d = det.j.data;
console.log("\ncourse detail top keys:", Object.keys(d));
console.log("quizzes key present?", "quizzes" in d);
if (d.quizzes) console.log("quizzes sample:", JSON.stringify(d.quizzes).slice(0,900));
c.kill("SIGKILL"); process.exit(0);
