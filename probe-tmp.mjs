import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { resolve } from "node:path";
const s = mkdtempSync(resolve(tmpdir(), "q-"));
process.env.QATOOLS_DB = resolve(s, "d.db");
const { migrate, db } = await import("./apps/api/src/db/index.js");
migrate();
try {
  const m = await import("./apps/api/src/modules/matrix/index.js");
  console.log("matrix default:", typeof m.default, "service:", typeof m.matrixService);
  console.log("document:", typeof m.matrixService?.document);
  const svc = await import("./apps/api/src/modules/metrics/service.js");
  console.log("metricsService.snapshot:", typeof svc.metricsService.snapshot);
} catch (e) { console.log("ERR", e.message); }
