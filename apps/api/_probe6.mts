import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
process.env.QATOOLS_DB = resolve(mkdtempSync(resolve(tmpdir(), "probef3-")), "p.db");
const { buildApp } = await import("./src/server.js");
const app = await buildApp({ logger: false });
await app.ready();
const mk = async (url, payload) => JSON.parse((await app.inject({ method: "POST", url, payload })).body);
const p = await mk("/api/projects", { key: "P", name: "P", target_url: "https://shop.example.test" });
const gen = await mk(`/api/projects/${p.data.id}/codegen`, { framework: "robotframework", base_url: "https://shop.example.test" });
const readme = gen.data.files.find(f=>f.path==="README.md").content;
const stripped = readme.replace(/\{\{[a-zA-Z0-9_.]+\}\}/g, "");
for (const line of stripped.split("\n")) {
  if (/\$\{[a-zA-Z_][a-zA-Z0-9_]*\}/.test(line)) console.log("HIT:", JSON.stringify(line));
}
await app.close();
