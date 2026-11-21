process.env.QATOOLS_DB = "./data/probe-f.mts.db";
import { buildApp } from "./src/server.js";
const app = await buildApp({ logger: false });
await app.ready();
const mk = async (url, payload) => {
  const r = await app.inject({ method: "POST", url, payload });
  return JSON.parse(r.body);
};
const p = await mk("/api/projects", { key: "PROBE", name: "Probe", target_url: "https://shop.example.test" });
const pid = p.data.id;
const tc = await mk(`/api/projects/${pid}/testcases`, {
  code: "TC-001", title: "Judul", type: "functional", layer: "web",
  priority: "high", severity: "major", automation_status: "to_be_automated",
  engine: "web", status: "ready", is_regression: 1,
});
const gen = await mk(`/api/projects/${pid}/codegen`, { framework: "playwright", base_url: "https://shop.example.test" });
const files = gen.data.files;
for (const f of files) {
  const bad = ["undefined","[object Object]","NaN"].filter(t => f.content.includes(t));
  if (bad.length) console.log("BAD", f.path, bad);
}
const readme = files.find(f=>f.path==="README.md").content;
console.log("--- README ---");
console.log(readme);
await app.close();
