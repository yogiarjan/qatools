import { buildContext } from "./apps/api/src/modules/codegen/gather.js";
import { GENERATORS } from "./apps/api/src/modules/codegen/frameworks.js";
import { buildReadme } from "./apps/api/src/modules/codegen/readme.js";
import { frameworkMeta } from "@qatools/shared";
import { db, migrate } from "./apps/api/src/db/index.js";
migrate();
const proj = db.prepare("SELECT id,key,name,target_url FROM projects LIMIT 1").get();
console.log("project:", JSON.stringify(proj));
if (proj) {
  const ctx = buildContext(proj.id, { framework: "playwright" }, proj);
  console.log("cases", ctx.cases.length, "flows", ctx.flows.length, "reqs", ctx.requests.length, "db", ctx.db_checks.length);
  const files = GENERATORS.playwright(ctx);
  const r = buildReadme(ctx, frameworkMeta("playwright"), files);
  console.log("NaN lines:", JSON.stringify(r.split("\n").filter(l => l.includes("NaN")), null, 2));
}
