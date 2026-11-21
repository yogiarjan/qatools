import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
process.env.QATOOLS_DB = resolve(mkdtempSync(resolve(tmpdir(), "probef4-")), "p.db");
const { buildApp } = await import("./src/server.js");
const app = await buildApp({ logger: false });
await app.ready();
const mk = async (url, payload) => JSON.parse((await app.inject({ method: "POST", url, payload })).body);
const p = await mk("/api/projects", { key: "P", name: "P", target_url: "https://shop.example.test" });
const pid = p.data.id;
await mk(`/api/projects/${pid}/testcases`, { code: "TC-001", title: "Judul", type: "functional", layer: "web", priority: "high", severity: "major", automation_status: "to_be_automated", engine: "web", status: "ready" });
await mk(`/api/projects/${pid}/testcases`, { code: "TC-003", title: "Api", type: "functional", layer: "api", priority: "high", severity: "major", automation_status: "to_be_automated", engine: "api", status: "ready" });
const col = await mk(`/api/projects/${pid}/collections`, { name: "Auth API", base_url: "https://api.example.test" });
await mk(`/api/collections/${col.data.id}/requests`, { name: "GET /x", method: "GET", path: "/x" });
const gen = await mk(`/api/projects/${pid}/codegen`, { framework: "robotframework", base_url: "https://shop.example.test" });
const readme = gen.data.files.find(f=>f.path==="README.md").content;
const stripped = readme.replace(/\{\{[a-zA-Z0-9_.]+\}\}/g, "");
for (const line of stripped.split("\n")) {
  if (/\$\{[a-zA-Z_][a-zA-Z0-9_]*\}/.test(line)) console.log("HIT:", JSON.stringify(line));
}
console.log("--- warn lines ---");
const m = readme.match(/## 5\.[\s\S]*?## 6\./);
console.log(m ? m[0] : "(none)");
await app.close();
