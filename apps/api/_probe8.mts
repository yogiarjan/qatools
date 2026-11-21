import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
process.env.QATOOLS_DB = resolve(mkdtempSync(resolve(tmpdir(), "probef5-")), "p.db");
const { buildApp } = await import("./src/server.js");
const app = await buildApp({ logger: false });
await app.ready();
const mk = async (url, payload) => JSON.parse((await app.inject({ method: "POST", url, payload })).body);
const p = await mk("/api/projects", { key: "P", name: "P", target_url: "https://shop.example.test" });
const pid = p.data.id;
const wc = await mk(`/api/projects/${pid}/testcases`, { code: "TC-001", title: "Login pengguna dengan email dan password", type: "functional", layer: "web", priority: "high", severity: "major", automation_status: "to_be_automated", engine: "web", is_regression: 1, status: "ready", expected_result: "Dashboard tampil", test_data: [{field:"email",value:"qa@example.test"}] });
await mk(`/api/projects/${pid}/testcases`, { code: "TC-002", title: 'Verifikasi "kutip ganda" & back\\slash <tag> ${inj} `tick` — 100% NaN', type: "negative", layer: "web", priority: "medium", severity: "minor", automation_status: "to_be_automated", engine: "web", status: "ready", expected_result: 'Pesan galat tampil: "kredensial salah"' });
const ac = await mk(`/api/projects/${pid}/testcases`, { code: "TC-003", title: "Api", type: "functional", layer: "api", priority: "high", severity: "major", automation_status: "to_be_automated", engine: "api", status: "ready", estimated_minutes: 2, test_data: [{field:"p95_ms",value:"800"}] });
const dc = await mk(`/api/projects/${pid}/testcases`, { code: "TC-004", title: "Db", type: "functional", layer: "db", priority: "medium", severity: "major", automation_status: "to_be_automated", engine: "db", status: "ready" });
await mk(`/api/projects/${pid}/web-flows`, { test_case_id: wc.data.id, name: "Login Flow", start_url: "https://shop.example.test/login?next=%2Fdashboard", viewport: {width:1440,height:900}, steps: [
 {action:"goto",value:"https://shop.example.test/login?next=%2Fdashboard"},
 {action:"fill",selector:"#email",value:"qa@example.test"},
 {action:"click",selector:'button[type="submit"]'},
 {action:"assert_text",selector:".welcome",expected:"Selamat datang"},
 {action:"select",selector:"#language",value:"id"},
 {action:"check",selector:"#remember"},
 {action:"press",selector:"#email",value:"Enter"},
 {action:"screenshot",value:"login-ok"},
]});
const col = await mk(`/api/projects/${pid}/collections`, { name: "Auth API", base_url: "https://api.example.test" });
await mk(`/api/collections/${col.data.id}/requests`, { test_case_id: ac.data.id, name: "POST /auth/login", method: "POST", path: "/auth/login", body_type:"json", body: JSON.stringify({a:1}), assertions: [{source:"status",operator:"equals",expected:200}] });
const conn = await mk(`/api/projects/${pid}/db-connections`, { name: "Q", dialect: "sqlite", dsn: "sqlite:///x.db" });
await mk(`/api/db-checks`, { connection_id: conn.data.id, test_case_id: dc.data.id, name: "Active users count", sql: "SELECT COUNT(*) AS n FROM users WHERE status = \"active\"", assertions: [{source:"row_count",operator:"gte",expected:1}] });

for (const fw of ["playwright","cypress","pytest","robotframework"]) {
  const gen = await mk(`/api/projects/${pid}/codegen`, { framework: fw, base_url: "https://shop.example.test" });
  console.log(`\n######## ${fw} summary:`, JSON.stringify(gen.data.summary));
  for (const f of gen.data.files) {
    const stripped = f.content.split('Verifikasi "kutip ganda" & back\\\\slash <tag> ${inj} `tick` — 100% NaN').join("");
    if (/\bNaN\b/.test(stripped)) console.log("  NaN->", f.path, JSON.stringify(stripped.split("\n").filter(l=>/\bNaN\b/.test(l))));
    if (/\$\{[a-zA-Z_][a-zA-Z0-9_]*\}/.test(f.content.replace(/\{\{[a-zA-Z0-9_.]+\}\}/g,"")) && (f.language==="json"||f.language==="java")) console.log("  PLACEHOLDER->", f.path, JSON.stringify(f.content.split("\n").filter(l=>/\$\{[a-zA-Z_]/.test(l)).slice(0,3)));
    if (/(['"`])undefined\1/.test(f.content)) console.log("  UNDEF->", f.path, JSON.stringify(f.content.split("\n").filter(l=>/(['"`])undefined\1/.test(l)).slice(0,3)));
  }
}
await app.close();
