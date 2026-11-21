import { db, migrate } from "../apps/api/src/db/index.ts";
migrate();
db.prepare("INSERT OR REPLACE INTO projects (id,key,name,status,quality_gate,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run("prj_x1","K1","N1","active",90,"2026-01-01T00:00:00Z","2026-01-01T00:00:00Z");
const rows = db.prepare("SELECT * FROM projects").all();
console.log("Array.isArray =", Array.isArray(rows));
console.log("ctor =", rows?.constructor?.name);
console.log("typeof rows.slice =", typeof rows.slice);
console.log("Object.keys(rows) =", JSON.stringify(Object.keys(rows)));
console.log("JSON =", JSON.stringify(rows));
