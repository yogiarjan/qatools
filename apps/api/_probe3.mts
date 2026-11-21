process.env.QATOOLS_DB = "./data/probe-f.mts.db";
import { buildApp } from "./src/server.js";
const app = await buildApp({ logger: false });
await app.ready();
const r = await app.inject({ method: "POST", url: "/api/projects", payload: { key: "PROBEX", name: "Probe", target_url: "https://shop.example.test" } });
console.log(r.statusCode, r.body.slice(0, 400));
await app.close();
