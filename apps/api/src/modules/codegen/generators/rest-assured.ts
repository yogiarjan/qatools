/**
 * REST Assured + JUnit 5 (Java, Maven) generator.
 *
 * Emits:
 *   pom.xml                                  REST Assured + Hamcrest + JUnit 5 + surefire
 *   src/test/java/<pkg>/ApiConfig.java       base URL / token resolution
 *   src/test/java/<pkg>/tests/*Test.java     given().when().then() specs
 *   src/test/resources/config.properties
 *
 * Translation of the Assertion DSL uses Hamcrest matchers, which is what REST Assured's
 * `body(path, matcher)` / `statusCode(matcher)` overloads expect. Values are rendered via
 * `javaStr()`, and JSONPath strings are escaped, so arbitrary titles/paths compile.
 */

import type { Assertion } from '@qatools/shared';
import { matcherFor } from '../assertions-map.js';
import { file, type GenerateContext, type GeneratedFile } from '../types.js';
import {
  commentLine,
  javaStr,
  numOf,
  pascalCase,
  textOf,
} from '../util.js';

const REST_ASSURED_VERSION = '5.5.0';
const JUNIT_VERSION = '5.11.4';
const HAMCREST_VERSION = '2.2';
const JSON_PATH_VERSION = '2.9.0';
const MAVEN_COMPILER_VERSION = '3.13.0';
const MAVEN_SUREFIRE_VERSION = '3.5.2';

/* ------------------------------------------------------------------ *
 * assertion → Hamcrest / REST Assured
 * ------------------------------------------------------------------ */

/**
 * One assertion rendered as a REST Assured `.then()` clause.
 * `status` and `header` use dedicated REST Assured validators; everything else uses
 * `body(jsonPath, hamcrestMatcher)` — which is exactly how a Java QA engineer writes it.
 */
export function restAssuredClause(assertion: Assertion): { clause: string; warning?: string } {
  const m = matcherFor(assertion);
  const path = textOf(assertion.path, '').trim();

  /** Hamcrest matcher expression for the current operator. */
  const hamcrest = (): string | null => {
    switch (m.kind) {
      case 'equal':
        return `equalTo(${javaLiteral(m.expected)})`;
      case 'not_equal':
        return `not(equalTo(${javaLiteral(m.expected)}))`;
      case 'contains':
        return `containsString(${javaStr(m.display)})`;
      case 'not_contains':
        return `not(containsString(${javaStr(m.display)}))`;
      case 'gt':
        return `greaterThan(${javaNumber(m.expected, true)})`;
      case 'gte':
        return `greaterThanOrEqualTo(${javaNumber(m.expected, true)})`;
      case 'lt':
        return `lessThan(${javaNumber(m.expected, true)})`;
      case 'lte':
        return `lessThanOrEqualTo(${javaNumber(m.expected, true)})`;
      case 'exists':
        return 'notNullValue()';
      case 'not_exists':
        return 'nullValue()';
      case 'matches':
        return `matchesPattern(${javaStr(m.regex ?? '')})`;
      case 'in':
        return `isOneOf(${javaList(m.expected)})`;
      case 'length_gte':
        return `hasSize(greaterThanOrEqualTo(${javaNumber(m.expected, false)}))`;
      case 'length_lte':
        return `hasSize(lessThanOrEqualTo(${javaNumber(m.expected, false)}))`;
      default:
        return null;
    }
  };

  const oneLine = (text: string) => text.replace(/\r?\n/g, ' ');
  const message = assertion.message ? `.as(${javaStr(oneLine(assertion.message))})` : '';

  switch (assertion.source) {
    case 'status': {
      const matcher = hamcrest();
      if (!matcher) return { clause: '', warning: `operator "${assertion.operator}" tidak valid untuk status.` };
      return { clause: `.statusCode(${matcher})` };
    }
    case 'duration':
      return { clause: `.time(${hamcrest() ?? 'lessThan(5000L)'})` };
    case 'header': {
      if (!path) return { clause: '', warning: 'assertion header tanpa nama header.' };
      const matcher = hamcrest();
      if (!matcher) return { clause: '', warning: `operator "${assertion.operator}" tidak dipetakan ke Hamcrest.` };
      return { clause: `.header(${javaStr(path)}, ${matcher})` };
    }
    case 'row_count':
      return { clause: '', warning: '`row_count` adalah source database; gunakan generator pytest untuk check ini.' };
    case 'column':
      return { clause: '', warning: '`column` adalah source database; gunakan generator pytest untuk check ini.' };
    case 'jsonpath':
    case 'body':
    case 'element':
    case 'text': {
      const matcher = hamcrest();
      if (!matcher) return { clause: '', warning: `operator "${assertion.operator}" belum dipetakan.` };
      const jsonPath = path ? toJsonPath(path) : '';
      if (jsonPath) {
        return { clause: `.body(${javaStr(jsonPath)}, ${matcher})${message}` };
      }
      return { clause: `.body(${matcher})${message}` };
    }
    default:
      return { clause: '', warning: `assertion source "${assertion.source}" belum dipetakan ke REST Assured.` };
  }
}

/** `$.data.id` stays as-is; a bare `data.id` becomes `$.data.id`. */
function toJsonPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('$')) return trimmed;
  if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(trimmed)) return `$.${trimmed}`;
  return trimmed;
}

function javaLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'nullValue()';
  if (typeof value === 'number') return Number.isFinite(value) ? javaNumber(value, false) : '0';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `Arrays.asList(${value.map(javaLiteral).join(', ')})`;
  return javaStr(value);
}

function javaNumber(value: unknown, asLong: boolean): string {
  const n = numOf(value, 0);
  if (Number.isInteger(n)) return asLong ? `${n}L` : String(n);
  return `${n}${asLong ? 'd' : ''}`;
}

function javaList(value: unknown): string {
  const list = Array.isArray(value)
    ? value
    : String(value ?? '')
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
  return list.map((v) => javaLiteral(v)).join(', ');
}

/* ------------------------------------------------------------------ *
 * pom.xml
 * ------------------------------------------------------------------ */

function pomXml(ctx: GenerateContext): string {
  const parallel = ctx.parallel;
  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <groupId>${ctx.package_name}</groupId>
  <artifactId>${ctx.slug}-api</artifactId>
  <version>1.0.0</version>
  <packaging>jar</packaging>
  <name>${escapeXml(ctx.project.name)} — REST Assured (QATools)</name>
  <description>Proyek API testing REST Assured + JUnit 5 yang digenerate QATools.</description>

  <properties>
    <maven.compiler.release>17</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    <rest-assured.version>${REST_ASSURED_VERSION}</rest-assured.version>
    <junit.version>${JUNIT_VERSION}</junit.version>
    <hamcrest.version>${HAMCREST_VERSION}</hamcrest.version>
    <json-path.version>${JSON_PATH_VERSION}</json-path.version>
    <junit.parallel.enabled>${parallel ? 'true' : 'false'}</junit.parallel.enabled>
  </properties>

  <dependencies>
    <dependency>
      <groupId>io.rest-assured</groupId>
      <artifactId>rest-assured</artifactId>
      <version>\${rest-assured.version}</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>io.rest-assured</groupId>
      <artifactId>json-path</artifactId>
      <version>\${rest-assured.version}</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>com.jayway.jsonpath</groupId>
      <artifactId>json-path</artifactId>
      <version>\${json-path.version}</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>\${junit.version}</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>org.hamcrest</groupId>
      <artifactId>hamcrest</artifactId>
      <version>\${hamcrest.version}</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>org.slf4j</groupId>
      <artifactId>slf4j-simple</artifactId>
      <version>2.0.16</version>
      <scope>test</scope>
    </dependency>
  </dependencies>

  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-compiler-plugin</artifactId>
        <version>${MAVEN_COMPILER_VERSION}</version>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-surefire-plugin</artifactId>
        <version>${MAVEN_SUREFIRE_VERSION}</version>
        <configuration>
          <systemPropertyVariables>
            <junit.jupiter.execution.parallel.enabled>\${junit.parallel.enabled}</junit.jupiter.execution.parallel.enabled>
            <junit.jupiter.execution.parallel.mode.default>concurrent</junit.jupiter.execution.parallel.mode.default>
            <baseUrl>\${baseUrl}</baseUrl>
          </systemPropertyVariables>
        </configuration>
      </plugin>
    </plugins>
  </build>
</project>
`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/* ------------------------------------------------------------------ *
 * config helper
 * ------------------------------------------------------------------ */

function apiConfigJava(ctx: GenerateContext): string {
  return `package ${ctx.package_name};

import java.io.IOException;
import java.io.InputStream;
import java.util.Properties;

import io.restassured.RestAssured;

/**
 * Konfigurasi REST Assured: base URI, base path, dan kredensial.
 * Urutan prioritas: environment variable → system property → config.properties → default.
 */
public final class ApiConfig {

    private static final Properties PROPS = load();
    private static final String DEFAULT_BASE_URL = ${javaStr(ctx.base_url)};

    private ApiConfig() {
    }

    private static Properties load() {
        Properties props = new Properties();
        try (InputStream in = ApiConfig.class.getClassLoader().getResourceAsStream("config.properties")) {
            if (in != null) {
                props.load(in);
            }
        } catch (IOException e) {
            // Opsional: default tetap dipakai.
        }
        return props;
    }

    public static String baseUrl() {
        String value = firstNonBlank(
                System.getenv("QA_BASE_URL"),
                System.getProperty("baseUrl"),
                PROPS.getProperty("baseUrl"),
                DEFAULT_BASE_URL);
        return stripTrailingSlash(value);
    }

    public static String token() {
        String value = firstNonBlank(
                System.getenv("QA_API_TOKEN"),
                System.getProperty("apiToken"),
                PROPS.getProperty("apiToken"),
                "");
        return value;
    }

    /** Terapkan base URI + auth global sebelum setiap request. */
    public static void applyDefaults() {
        RestAssured.baseURI = baseUrl();
        RestAssured.enableLoggingOfRequestAndResponseIfValidationFails();
        String token = token();
        if (!token.isBlank()) {
            RestAssured.requestSpecification = RestAssured.given()
                    .header("Authorization", "Bearer " + token);
        }
    }

    private static String firstNonBlank(String... candidates) {
        for (String candidate : candidates) {
            if (candidate != null && !candidate.isBlank()) {
                return candidate.trim();
            }
        }
        return "";
    }

    private static String stripTrailingSlash(String url) {
        String out = url;
        while (out.endsWith("/")) {
            out = out.substring(0, out.length() - 1);
        }
        return out;
    }
}
`;
}

function apiBaseTestJava(ctx: GenerateContext): string {
  return `package ${ctx.package_name}.tests;

import org.junit.jupiter.api.BeforeAll;

import ${ctx.package_name}.ApiConfig;

/**
 * Base class JUnit 5: menyiapkan base URI + auth sekali per kelas.
 */
public abstract class ApiBaseTest {

    @BeforeAll
    static void configureRestAssured() {
        ApiConfig.applyDefaults();
    }
}
`;
}

/* ------------------------------------------------------------------ *
 * test classes
 * ------------------------------------------------------------------ */

function requestBuilder(r: GenerateContext['requests'][number]): string[] {
  const lines: string[] = [];
  const method = textOf(r.request.method, 'GET').toUpperCase();
  const path = textOf(r.request.path, '/');
  const relative = /^[a-z][a-z0-9+.-]*:\/\//i.test(path)
    ? path
    : path.startsWith('/')
      ? path
      : `/${path}`;

  lines.push(`        given()`);

  for (const [key, value] of Object.entries(r.headers)) {
    lines.push(`                .header(${javaStr(key)}, ${javaStr(value)})`);
  }
  lines.push("                .contentType(\"application/json\")");

  if (r.query && Object.keys(r.query).length) {
    for (const [key, value] of Object.entries(r.query)) {
      lines.push(`                .queryParam(${javaStr(key)}, ${javaStr(value)})`);
    }
  }

  const bodyText = textOf(r.request.body, '');
  const hasBody = bodyText !== '' && method !== 'GET' && method !== 'HEAD';
  if (hasBody) {
    if (r.request.body_type === 'json') {
      // REST Assured parses a JSON string body when contentType is JSON.
      lines.push(`                .body(${javaStr(bodyText)})`);
    } else if (r.request.body_type === 'form') {
      for (const [key, value] of Object.entries(parseForm(bodyText))) {
        lines.push(`                .formParam(${javaStr(key)}, ${javaStr(value)})`);
      }
    } else {
      lines.push(`                .body(${javaStr(bodyText)})`);
    }
  }

  lines.push('        .when()');
  lines.push(`                .${method.toLowerCase()}(${javaStr(relative)})`);
  return lines;
}

function parseForm(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of body.split('&')) {
    const [k, v = ''] = pair.split('=');
    if (!k) continue;
    out[k.trim()] = v.trim();
  }
  return out;
}

function apiTestJava(ctx: GenerateContext): string {
  const methods: string[] = [];
  const used = new Set<string>();

  for (const r of ctx.requests) {
    const baseName = r.test_case_code
      ? pascalCase(r.test_case_code, 'case')
      : pascalCase(`${textOf(r.request.method, 'get')} ${textOf(r.request.path, 'root')} ${textOf(r.request.name, '')}`, 'request');
    let name = `${baseName}Test`.replace(/TestTest$/, 'Test');
    let n = 2;
    while (used.has(name)) name = `${baseName}${n++}Test`;
    used.add(name);

    const title = r.test_case_code
      ? `${r.test_case_code} — ${textOf(r.test_case_title, r.request.name)}`
      : `${textOf(r.request.method, 'GET')} ${textOf(r.request.path, '/')} — ${textOf(r.request.name, '')}`;

    const clauses: string[] = [];
    let index = 0;
    for (const a of r.assertions) {
      const rendered = restAssuredClause(a);
      if (rendered.warning) {
        ctx.warnings.push(`REST Assured: request "${textOf(r.request.name, '')}": ${rendered.warning}`);
        continue;
      }
      clauses.push(`                ${rendered.clause.trim()}`);
      index += 1;
    }
    if (!index) {
      clauses.push('                .statusCode(lessThan(400))');
    }

    const firstClause = clauses[0]!;
    const restClauses = clauses.slice(1);

    methods.push(`    /**
     * ${commentLine(title)}
     */
    @Test
    @DisplayName(${javaStr(title)})
    void ${testMethodName(name)}() {
${requestBuilder(r).join('\n')}
        .then()
${firstClause}
${restClauses.map((c) => `${c}`).join('\n')}${restClauses.length ? '\n' : ''}        ;
    }`);
  }

  if (!methods.length) {
    methods.push(`    /**
     * Placeholder: proyek ini belum punya API request di QATools.
     */
    @Test
    @DisplayName("Placeholder — belum ada API request")
    void placeholderBelumAdaApiRequest() {
        given()
                .contentType("application/json")
        .when()
                .get("/")
        .then()
                .statusCode(lessThan(400));
    }`);
  }

  return `package ${ctx.package_name}.tests;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.greaterThan;
import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.isOneOf;
import static org.hamcrest.Matchers.lessThan;
import static org.hamcrest.Matchers.lessThanOrEqualTo;
import static org.hamcrest.Matchers.matchesPattern;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;

/**
 * Test API REST Assured untuk proyek "${commentLine(ctx.project.name)}".
 * Base URL berasal dari ApiConfig; tidak ada host yang di-hardcode.
 */
public class ApiTest extends ApiBaseTest {

${methods.join('\n\n')}
}
`;
}

function testMethodName(className: string): string {
  const cleaned = className.replace(/[^A-Za-z0-9_$]/g, '');
  const lowered = cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
  return /^[A-Za-z_$]/.test(lowered) ? lowered : `test${lowered}`;
}

function configProperties(ctx: GenerateContext): string {
  return `# Konfigurasi REST Assured — digenerate QATools.
# Override tanpa mengubah kode:
#   mvn test -DbaseUrl=https://staging.example.com -DapiToken=XXX
#   $env:QA_BASE_URL = "https://staging.example.com"
baseUrl=${ctx.base_url}
apiToken=
`;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export function generate(ctx: GenerateContext): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const pkg = ctx.package_name;
  const pkgPath = pkg.replace(/\./g, '/');

  files.push(file('pom.xml', 'yaml', 'Maven POM: REST Assured 5, Hamcrest, JUnit 5, surefire.', pomXml(ctx)));
  files.push(
    file('src/test/resources/config.properties', 'yaml', 'baseUrl dan apiToken yang bisa dioverride lewat -D atau environment variable.', configProperties(ctx)),
  );
  files.push(
    file(
      `src/test/java/${pkgPath}/ApiConfig.java`,
      'java',
      'Konfigurasi REST Assured: base URI, token, dan logging saat validasi gagal.',
      apiConfigJava(ctx),
    ),
  );
  files.push(
    file(
      `src/test/java/${pkgPath}/tests/ApiBaseTest.java`,
      'java',
      'Base class JUnit 5 yang menerapkan base URI + auth sebelum test berjalan.',
      apiBaseTestJava(ctx),
    ),
  );
  files.push(
    file(
      `src/test/java/${pkgPath}/tests/ApiTest.java`,
      'java',
      `Test API: ${ctx.requests.length} @Test dengan given().when().then() dan matcher Hamcrest.`,
      apiTestJava(ctx),
    ),
  );

  if (!ctx.requests.length) {
    ctx.warnings.push(
      'REST Assured: tidak ada API request di proyek ini; ApiTest.java hanya memuat placeholder yang tetap dapat dikompilasi.',
    );
  }
  return files;
}
