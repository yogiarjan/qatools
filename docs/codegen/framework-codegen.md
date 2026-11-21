# Code Generation — Framework Automation

Dokumen ini menjelaskan fitur **Code Generator** QATools: mengubah artefak pengujian
(test case, web flow, API request, DB check) menjadi **proyek automation yang benar-benar
bisa dijalankan** untuk delapan framework mapan.

Modul API: `apps/api/src/modules/codegen/`
Halaman web: `/codegen` (`apps/web/src/features/codegen/CodegenPage.tsx`)

---

## 1. Prinsip yang mengikat

Empat aturan ini menentukan seluruh desain fitur (ARCHITECTURE.md §11.3):

1. **Tanpa dependensi npm baru.** QATools hanya menghasilkan **teks**. Repositori
   QATools tidak pernah bergantung pada Playwright, Robot Framework, k6, dan
   sebagainya. Kode yang digenerate *menyebut* framework tersebut; server tidak.
2. **Hasilnya harus benar-benar bisa dijalankan**, bukan pseudocode. Setiap generator
   mengeluarkan proyek lengkap: test, config, manifest dependensi, dan README berisi
   perintah persisnya.
3. **Peringatan yang jujur.** Apa pun yang tidak berhasil dikonversi masuk ke
   `warnings[]` beserta alasannya — tidak pernah dibuang diam-diam.
4. **Setiap file punya `purpose`.** UI menampilkannya agar pengguna tahu kenapa file
   itu ada.

> **Penting — batas tanggung jawab.** QATools **tidak** memasang Playwright, Robot
> Framework, k6, Cypress, Selenium, Postman/Newman, maupun Java/Maven. Mengunduh ZIP
> lalu menjalankan perintah instalasi di README adalah **langkah Anda**. QATools tidak
> pernah menjalankan kode yang digenerate.

---

## 2. Memilih framework: kapan memakai yang mana

| Framework | Bahasa | Layer | Pilih ketika… |
|---|---|---|---|
| **Playwright** | TypeScript | web, api | Butuh standar industri untuk web modern; auto-wait, trace viewer, dan API testing dalam satu tool. Pilihan default paling aman. |
| **Robot Framework** | Robot | web, api | Tim *keyword-driven*, banyak anggota non-programmer, atau organisasi enterprise yang sudah memakai Robot. Memakai Browser (Playwright) untuk web dan RequestsLibrary untuk API. |
| **pytest** | Python | api, **db** | Butuh API + **database** testing. Ini **satu-satunya** generator yang mengeksekusi SQL sungguhan (sqlite3 / SQLAlchemy). Ringan dan cocok untuk CI. |
| **Cypress** | JavaScript | web | Tim frontend yang ingin pengalaman developer terbaik (time-travel debugging, berjalan di dalam browser). |
| **Selenium + TestNG** | Java | web | Tim Java enterprise; butuh Page Object Model dan eksekusi paralel lewat `testng.xml`. |
| **k6** | JavaScript | api, performance | Butuh **load testing**: stages, virtual user, dan threshold p95/error-rate. |
| **Postman + Newman** | JSON | api | Perlu dibagikan ke tim non-QA, atau diimpor ke Postman GUI. Format paling portabel. |
| **REST Assured** | Java | api | API testing di ekosistem Java/JUnit dengan matcher Hamcrest. |

### Ringkasan cepat

- **Web UI** → Playwright (default), Cypress (tim frontend), Selenium/TestNG (Java).
- **API** → Playwright (kalau sudah pakai), REST Assured (Java), Postman (non-QA),
  pytest (Python).
- **Database** → **pytest** (satu-satunya yang benar-benar menjalankan SQL).
- **Performa** → **k6**.

> Hanya **pytest** yang menyatakan `db` di `supports`. Meminta layer `db` pada
> framework lain menghasilkan **peringatan**, bukan kegagalan diam-diam.

---

## 3. Pemetaan artefak QATools → konstruksi framework

### 3.1 Test case

| QATools | Menjadi |
|---|---|
| `test_cases.code` + `title` | Nama test / `describe` / `*** Test Cases ***` / `@DisplayName` |
| `test_cases.expected_result` | Assertion pada konten halaman (bila flow belum punya assertion) |
| `test_steps[]` | Komentar bernomor di dalam test, agar langkah manual tidak hilang |
| `test_cases.test_data` | Data uji (`lib/data.js` pada k6, komentar pada spec lain) |
| `test_cases.tags` | Tag/`[Tags]`/`groups`; juga sumber ambang performa k6 |
| `test_cases.is_regression` | Tag `regression` |
| `test_cases.estimated_minutes` | Dasar durasi default k6 |
| `automation_status = cannot_automate` | **Dilewati** + peringatan |

Rantai ketertelusuran (requirement → use case → scenario) dibaca dari `matrix_links`
dengan arah yang dibekukan §5.4 (`from_id` = induk) dan ditulis sebagai komentar
`// Traceability: …` di dalam test.

### 3.2 Web flow → langkah otomasi

| `WebStepAction` | Playwright | Cypress | Selenium | Robot (Browser) |
|---|---|---|---|---|
| `goto` | `page.goto(url)` | `cy.visit(url)` | `page.open(url)` | `Go To` |
| `click` | `locator.click()` | `cy.get(s).click()` | `page.click(by)` | `Click` |
| `fill` | `locator.fill(v)` | `.clear().type(v)` | `page.type(by,v)` | `Fill Text` |
| `select` | `.selectOption(v)` | `.select(v)` | `selectByVisibleText` | `Select Options By` |
| `check` / `uncheck` | `.check()` / `.uncheck()` | `.check()` / `.uncheck()` | `check(by,bool)` | `Check/Uncheck Checkbox` |
| `press` | `.press(k)` | `.type('{k}')` | `pressKey(by,k)` | `Press Keys` |
| `wait` | `waitForTimeout(ms)` | `cy.wait(ms)` | `Thread.sleep(ms)` | `Sleep` |
| `assert_text` | `expect(l).toContainText(e)` | `.should('contain.text',e)` | `Assert.assertTrue` | `Get Text` + `Should Contain` |
| `assert_visible` | `expect(l).toBeVisible()` | `.should('be.visible')` | `isVisible` + assert | `Wait For Elements State` |
| `assert_url` | `expect(page).toHaveURL(re)` | `cy.url().should('include')` | `url().contains` | `Get Url` + `Should Contain` |
| `screenshot` | `page.screenshot({path})` | `cy.screenshot(n)` | `page.screenshot(n)` | `Take Screenshot` |
| `hover` | `.hover()` | `.trigger('mouseover')` | `Actions.moveToElement` | `Hover` |
| `scroll` | `.scrollIntoViewIfNeeded()` | `.scrollIntoView()` | `scrollIntoView` | `Scroll To Element` |

Catatan jujur:

- **Cypress tidak punya hover asli.** Yang digenerate adalah `trigger('mouseover')`,
  pendekatan yang didokumentasikan Cypress sendiri — bukan hover sungguhan.
- **`wait` adalah bau kode.** Generator tetap mengeluarkannya (karena itu yang diminta
  artefak) tetapi menyertakan komentar agar diganti dengan web-first assertion.

### 3.3 Assertion DSL → matcher tiap framework

DSL beku `Assertion` (`source`, `path`, `operator`, `expected`) diterjemahkan melalui
satu tabel bersama di `assertions-map.ts`, sehingga delapan framework sepakat soal
semantik. Implementasi acuannya `modules/execute/assertions.ts`.

| Operator DSL | Playwright | pytest | REST Assured (Hamcrest) | Robot | Postman | k6 |
|---|---|---|---|---|---|---|
| `equals` | `toEqual` | `==` | `equalTo` | `Should Be Equal` | `.to.eql` | `String(v)===` |
| `not_equals` | `.not.toEqual` | `!=` | `not(equalTo)` | `Should Not Be Equal` | `.to.not.eql` | `!==` |
| `contains` | `toContain` | `in` | `containsString` | `Should Contain` | `.to.include` | `.includes` |
| `not_contains` | `.not.toContain` | `not in` | `not(containsString)` | `Should Not Contain` | `.to.not.include` | `!.includes` |
| `gt/gte/lt/lte` | `toBeGreaterThan*` | `>` `>=` `<` `<=` | `greaterThan*` | `Should Be True` | `.to.be.above*` | `Number(v)` |
| `exists` | `toBeDefined` | `is not None` | `notNullValue` | `!= ${None}` | `.not.be.undefined` | `!= null` |
| `not_exists` | `toBeUndefined` | `is None` | `nullValue` | `= ${None}` | `.to.be.undefined` | `== null` |
| `matches` | `toMatch(RegExp)` | `re.search` | `matchesPattern` | `Should Match Regexp` | `.to.match` | `RegExp.test` |
| `in` | `toContain` | `in [...]` | `isOneOf` | `Should Contain Any` | `.to.include` | `[..].includes` |
| `length_gte/lte` | `expect(len)` | `len()` | `hasSize` | `len() >=` | `.have.lengthOf` | `.length` |

Aturan penting: **regex tidak pernah memakai flag `g`.** Flag global bersifat stateful
(`lastIndex`), sehingga assertion bisa lulus/gagal bergantian di antara retry Playwright.

Source yang tidak punya padanan (misalnya `row_count` pada framework API) menghasilkan
**peringatan**, bukan assertion yang selalu lulus.

### 3.4 API request → request nyata

- `collection.base_url` digabung dengan `request.path`; bila `path` sudah absolut, ia menang.
- `collection.auth_type` diterjemahkan ke header: `bearer` → `Authorization: Bearer …`,
  `basic` → Basic, `api_key` → header kustom.
- **Token asli tidak pernah ditanam** ke kode yang dibagikan. Nilainya menjadi variabel
  (`{{authToken}}`, `${AUTH_TOKEN}`, `--api-token`) yang wajib diisi pengguna.
- `body_type: json` divalidasi; JSON tidak valid dikirim sebagai string + peringatan.

---

## 4. Struktur proyek yang digenerate

Setiap ZIP berisi satu folder root bernama `<framework>-<nama-proyek>/`.

### Playwright
```
playwright.config.ts     workers, sharding, trace on failure, reporters, baseURL
package.json             @playwright/test, typescript
tsconfig.json
fixtures/qa.fixture.ts   test/expect + page object otomatis
fixtures/helpers.ts      getByPath, escapeRegExp
pages/*.page.ts          page object per web flow
tests/web.spec.ts        satu test per web flow
tests/api.spec.ts        memakai fixture `request`
README.md
```

### Robot Framework
```
tests/web.robot          *** Settings/Variables/Test Cases/Keywords ***
tests/api.robot          RequestsLibrary
tests/database.robot     placeholder + SQL sebagai komentar
resources/keywords.robot keyword reusable
resources/variables.robot BASE_URL, auth, URL per flow
requirements.txt         robotframework, -browser, -requests, -jsonlibrary
robot.yaml
README.md
```

### pytest
```
tests/test_<collection>.py  requests + assertion DSL
tests/test_db_<check>.py    sqlite3 / SQLAlchemy
conftest.py                 fixture, --base-url, --api-token, dig()
pytest.ini                  testpaths, markers, junitxml
requirements.txt            pytest, requests, pytest-html, pytest-xdist, SQLAlchemy
README.md
```

### Cypress
```
cypress.config.js
cypress/e2e/web.cy.js
cypress/support/e2e.js, commands.js
cypress.env.json         kredensial (kosong)
package.json
README.md
```

### Selenium + TestNG
```
pom.xml                           selenium-java, testng, webdrivermanager
src/test/java/<pkg>/QaConfig.java
src/test/java/<pkg>/DriverFactory.java
src/test/java/<pkg>/pages/BasePage.java
src/test/java/<pkg>/pages/*.java   page object
src/test/java/<pkg>/tests/BaseTest.java, WebTest.java
src/test/resources/testng.xml      parallel="methods" thread-count=N
src/test/resources/config.properties
README.md
```

### k6
```
script.js         export const options (stages, thresholds) + default function
lib/checks.js     check(), dig(), authHeaders()
lib/data.js       data uji dari test case
README.md         cara pasang k6
```

### Postman + Newman
```
collection.json   Collection v2.1: folder per collection, request, pm.test()
environment.json  baseUrl + authToken/authBasic/authApiKey (secret, kosong)
README.md         perintah newman + cara impor ke GUI
```

### REST Assured
```
pom.xml                                     rest-assured, junit-jupiter, hamcrest
src/test/java/<pkg>/ApiConfig.java
src/test/java/<pkg>/tests/ApiBaseTest.java
src/test/java/<pkg>/tests/ApiTest.java      given().when().then()
src/test/resources/config.properties
README.md
```

> Jika framework sudah mengeluarkan `README.md` sendiri (k6, Postman), README framework
> itu dipertahankan dan README hasil generator dipindah ke `README.FRAMEWORK.md` —
> tidak ada dua file dengan path yang sama di dalam ZIP.

---

## 5. Cara menjalankan

Perintah di bawah **persis** yang tertulis di README setiap ZIP; sumbernya
`FRAMEWORK_META` di `packages/shared/src/automation.ts` (beku), bukan diketik ulang.

| Framework | Instalasi | Menjalankan |
|---|---|---|
| Playwright | `npm install && npx playwright install` | `npx playwright test` |
| Robot Framework | `pip install -r requirements.txt && rfbrowser init` | `robot --outputdir results tests/` |
| pytest | `pip install -r requirements.txt` | `pytest -v --html=report.html` |
| Cypress | `npm install` | `npx cypress run` |
| Selenium | `mvn -q dependency:resolve` | `mvn test` |
| k6 | `winget install k6` | `k6 run script.js` |
| Postman | `npm install -g newman` | `newman run collection.json -e environment.json` |
| REST Assured | `mvn -q dependency:resolve` | `mvn test` |

### Override base URL tanpa mengubah file

```bash
# Playwright
PW_BASE_URL=https://staging.example.com npx playwright test
# Cypress
CYPRESS_BASE_URL=https://staging.example.com npx cypress run
# pytest
pytest -v --base-url=https://staging.example.com
# k6
k6 run -e QA_BASE_URL=https://staging.example.com script.js
# Selenium / REST Assured
mvn test -DbaseUrl=https://staging.example.com
# Postman
newman run collection.json -e environment.json --env-var baseUrl=https://staging.example.com
```

---

## 6. API

Mounted di `/api` (ARCHITECTURE.md §11.5):

```
GET    /codegen/frameworks                  -> FrameworkMeta[]
POST   /projects/:projectId/codegen         -> GeneratedProject   (body: CodegenRequest)
GET    /projects/:projectId/codegen         -> GeneratedProjectMeta[]
GET    /codegen/:id                         -> GeneratedProject
GET    /codegen/:id/file?path=...           -> text/plain isi file
GET    /codegen/:id/download                -> application/zip
DELETE /codegen/:id
```

Contoh:

```bash
curl -X POST http://127.0.0.1:5174/api/projects/prj_xxx/codegen \
  -H 'Content-Type: application/json' \
  -d '{"framework":"playwright","parallel":true,"workers":4,"persist":true}'
```

Body `CodegenRequest`:

| Field | Arti |
|---|---|
| `framework` | wajib; salah satu dari 8 id |
| `test_case_ids` | kosong = semua test case automatable |
| `layers` | `web`/`api`/`db`/`performance`; kosong = semua yang didukung framework |
| `base_url` | mengalahkan environment default proyek |
| `parallel` + `workers` | sharding/thread (1–16) |
| `use_ai` | penanda `generated_by` |
| `persist` | simpan agar bisa diunduh sebagai ZIP |

### Service in-process

```ts
import { codegenService } from '../codegen/index.js';
const project = await codegenService.generate(req, projectId);
const frameworks = codegenService.frameworks();
```

---

## 7. ZIP tanpa dependensi

`zip.ts` menulis ZIP sendiri dengan metode **STORE** (tanpa kompresi): local file
header (`PK\x03\x04`), central directory (`PK\x01\x02`), dan EOCD (`PK\x05\x06`),
dengan CRC-32 dihitung di `crc32.ts`. Tidak ada `archiver`, `jszip`, atau `adm-zip`.

Timestamp diset tetap ke epoch DOS (1980-01-01) sehingga generate ulang atas artefak
yang sama menghasilkan ZIP **byte-identical** — berguna untuk pengujian dan diff.

Path entri dinormalisasi: `..` diselesaikan seperti filesystem (`a/../b` → `b`) dan
tidak pernah bisa keluar dari folder root arsip.

---

## 8. Halaman `/codegen`

Tiga langkah berurutan:

1. **Pilih framework** — kartu berisi label, bahasa, layer yang didukung, perintah
   instalasi & menjalankan, peringatan `requiresUserInstall`, dan tautan dokumentasi.
2. **Pilih test case** — multi-pilih dengan filter pencarian dan filter layer.
   Tidak memilih apa pun berarti "semua test case automatable".
3. **Opsi** — base URL, paralel + jumlah worker, AI, dan simpan hasil.

Lalu tampil **hasil**: statistik ringkas, daftar peringatan, pohon file, penampil isi
file beserta `purpose`-nya, tombol salin, dan **Download ZIP**. Riwayat generate
tersimpan bisa dibuka kembali dan diunduh ulang.

UI memakai Bahasa Indonesia; identifier kode tetap Inggris, sesuai §10.

---

## 9. Batasan yang jujur

- **Instalasi framework adalah langkah Anda.** QATools tidak memasang apa pun.
- **Layer `db` hanya didukung pytest.** Framework lain melaporkan peringatan.
- **Hover pada Cypress** memakai `trigger('mouseover')`, bukan hover native.
- **`wait`** menghasilkan sleep; komentar memperingatkan agar diganti.
- **Robot + database** hanya memuat SQL sebagai komentar — DatabaseLibrary butuh
  kredensial nyata yang tidak boleh ditanam di kode.
- **Ambang k6** diturunkan dari `test_data`/tag. Bila tidak ada, nilainya default yang
  wajar, bukan SLA yang disepakati; sesuaikan sebelum dipakai sebagai gate rilis.
- **Token autentikasi tidak pernah ditanam**; pengguna wajib mengisinya.
- **`parallel` pada k6** tidak berlaku — k6 mengatur beban lewat `stages`.
- Generator **tidak** memvalidasi apakah selector benar-benar ada di halaman; itu tugas
  eksekusi, bukan codegen.
