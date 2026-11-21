import { buildContext } from "./src/modules/codegen/gather.js";
import { GENERATORS } from "./src/modules/codegen/frameworks.js";
import { buildReadme } from "./src/modules/codegen/readme.js";
import { frameworkMeta } from "@qatools/shared";
import { db, migrate, newId, nowIso } from "./src/db/index.js";
migrate();
// Minimal project with one web case, mirroring the test fixture.
const pid = newId("prj_");
db.prepare("INSERT INTO projects (id,key,name,status,quality_gate,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
  .run(pid, "PROBE", "Probe", "active", 95, nowIso(), nowIso());
const tc = newId("tc_");
db.prepare("INSERT INTO test_cases (id,project_id,code,title,type,layer,priority,severity,automation_status,engine,risk_score,estimated_minutes,is_regression,status,generated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
  .run(tc, pid, "TC-001", "Judul", "functional", "web", "high", "major", "to_be_automated", "web", 50, 5, 1, "ready", "manual", nowIso(), nowIso());
const proj = db.prepare("SELECT id,key,name,target_url FROM projects WHERE id=?").get(pid);
const ctx = buildContext(pid, { framework: "playwright", base_url: "https://shop.example.test" }, proj);
console.log("cases", ctx.cases.length, "flows", ctx.flows.length);
const files = GENERATORS.playwright(ctx);
const r = buildReadme(ctx, frameworkMeta("playwright"), files);
console.log("NaN lines:", JSON.stringify(r.split("\n").filter(l => l.includes("NaN")), null, 2));
console.log("undefined lines:", JSON.stringify([...files.map(f=>f.content)].join("\n").split("\n").filter(l=>l.includes("undefined")).slice(0,5), null, 2));
