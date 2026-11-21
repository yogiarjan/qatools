import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
process.env.QATOOLS_DB = resolve(mkdtempSync(resolve(tmpdir(), "probef-")), "p.db");
const { buildApp } = await import("./src/server.js");
const app = await buildApp({ logger: false });
await app.ready();
const mk = async (url, payload) => JSON.parse((await app.inject({ method: "POST", url, payload })).body);
const p = await mk("/api/projects", { key: "PROBE", name: "Probe", target_url: "https://shop.example.test" });
const pid = p.data.id;
await mk(`/api/projects/${pid}/testcases`, { code: "TC-001", title: "Judul", type: "functional", layer: "web", priority: "high", severity: "major", automation_status: "to_be_automated", engine: "web", status: "ready", is_regression: 1 });
const gen = await mk(`/api/projects/${pid}/codegen`, { framework: "playwright", base_url: "https://shop.example.test" });
for (const f of gen.data.files) {
  const bad = ["undefined","[object Object]","NaN"].filter(t => f.content.includes(t));
  if (bad.length) console.log("BAD", f.path, bad);
}
console.log("=== README ===");
console.log(gen.data.files.find(f=>f.path==="README.md").content);
await app.close();
