# QATools — verifikasi menyeluruh

Perintah dijalankan dari root `qatools/` dengan Node bawaan harness:

```powershell
$env:PATH = "C:\Users\yogia\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin;$env:PATH"
```

## 1. Typecheck

```bash
node node_modules/typescript/bin/tsc --noEmit -p apps/api/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json
```

## 2. Boot + registrasi modul

```bash
node scripts/probe.mjs
```

Menjalankan API pada database sementara, menunggu `/api/health`, lalu melaporkan
`MODULES n/21 registered` beserta modul yang gagal. Argumen tambahan akan di-GET:

```bash
node scripts/probe.mjs /api/projects /api/courses /api/ai/settings /api/execute/capabilities
```

Keluaran berakhir dengan `PROBE_RESULT=PASS` atau `PROBE_RESULT=FAIL`.

## 3. Build web

```bash
cd apps/web && node node_modules/vite/bin/vite.js build
```

## 4. Test antar-lane

```bash
node --test --import ./apps/api/node_modules/tsx/dist/loader.mjs apps/api/test/*.test.ts
```

## 5. Seeder

```bash
node apps/api/node_modules/tsx/dist/cli.mjs apps/api/src/seed/run.ts        # kurikulum (idempoten)
node apps/api/node_modules/tsx/dist/cli.mjs apps/api/src/seed/demo.ts       # project demo
```

## 6. End-to-end berurutan

`_verify/e2e.mjs` (ditulis oleh verifier) menjalankan seluruh siklus hidup lewat HTTP
pada database kosong: kebutuhan → use case → skenario → test case → matrix → cycle/sprint →
environment → eksekusi API → eksekusi DB → task AI offline → run manual → defect →
rencana regresi → metrik → enroll → kuis → sertifikat → verifikasi.

```bash
node _verify/e2e.mjs
```

## 7. Jalankan aplikasi

```bash
node scripts/devapi.mjs 5174     # API
cd apps/web && node node_modules/vite/bin/vite.js   # Web di 5173 (proxy /api → 5174)
```
