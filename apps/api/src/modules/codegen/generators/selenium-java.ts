/**
 * Selenium + TestNG (Java, Maven) generator.
 *
 * Emits a Page Object Model Maven project:
 *   pom.xml                                   Selenium 4 + TestNG + WebDriverManager
 *   src/test/java/<pkg>/pages/*.java          page objects from web flows
 *   src/test/java/<pkg>/tests/*Test.java      TestNG tests with real assertions
 *   src/test/resources/testng.xml             parallel="methods" thread-count=N
 *   src/test/resources/config.properties      baseUrl / browser / timeout
 *
 * Java escaping: every interpolated literal goes through `javaStr()`, so a title with
 * `"` or a selector with `\` produces compilable source.
 */

import type { WebStep } from '@qatools/shared';
import { file, type GenerateContext, type GeneratedFile } from '../types.js';
import {
  clampInt,
  commentLine,
  javaStr,
  pascalCase,
  safeSegment,
  textOf,
} from '../util.js';
import { ancestryLine } from '../gather.js';

const SELENIUM_VERSION = '4.27.0';
const TESTNG_VERSION = '7.10.2';
const WEBDRIVERMANAGER_VERSION = '5.9.2';
const SLF4J_VERSION = '2.0.16';
const MAVEN_COMPILER_VERSION = '3.13.0';
const MAVEN_SUREFIRE_VERSION = '3.5.2';

/* ------------------------------------------------------------------ *
 * WebStep → Selenium Java statements
 * ------------------------------------------------------------------ */

function byExpression(selector: string): string {
  const raw = selector.trim();
  if (!raw) return 'By.tagName("body")';
  const xpathMatch = /^\/\//.test(raw) || /^xpath=/i.test(raw);
  if (xpathMatch) return `By.xpath(${javaStr(raw.replace(/^xpath=/i, ''))})`;
  const cssMatch = /^css=/i.test(raw);
  if (cssMatch) return `By.cssSelector(${javaStr(raw.replace(/^css=/i, ''))})`;
  if (/^id=/i.test(raw)) return `By.id(${javaStr(raw.replace(/^id=/i, ''))})`;
  if (/^name=/i.test(raw)) return `By.name(${javaStr(raw.replace(/^name=/i, ''))})`;
  if (/^\[.*=/.test(raw)) {
    // `[data-testid=foo]` is valid CSS; keep it as such.
    return `By.cssSelector(${javaStr(raw)})`;
  }
  return `By.cssSelector(${javaStr(raw)})`;
}

interface JavaEmission {
  code: string[];
  warning?: string;
}

function seleniumStatement(step: WebStep, page: string, baseUrl: string): JavaEmission {
  const selector = textOf(step.selector, '').trim() || 'body';
  const value = textOf(step.value, '');
  const expected = textOf(step.expected, '');
  const by = byExpression(selector);
  const timeoutArg = typeof step.timeout_ms === 'number' && Number.isFinite(step.timeout_ms)
    ? `, java.time.Duration.ofMillis(${clampInt(step.timeout_ms, 0, 600_000)})`
    : '';

  switch (step.action) {
    case 'goto': {
      const raw = value || expected || baseUrl;
      const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
        ? raw
        : `${baseUrl.replace(/\/+$/, '')}${raw.startsWith('/') ? '' : '/'}${raw}`;
      return { code: [`${page}.open(${javaStr(url)});`] };
    }
    case 'click':
      return { code: [`${page}.click(${by});`] };
    case 'fill':
      return { code: [`${page}.type(${by}, ${javaStr(value)});`] };
    case 'select':
      return {
        code: [`${page}.selectByVisibleText(${by}, ${javaStr(value)});`],
      };
    case 'check':
      return { code: [`${page}.check(${by}, true);`] };
    case 'uncheck':
      return { code: [`${page}.check(${by}, false);`] };
    case 'press':
      return { code: [`${page}.pressKey(${by}, ${javaStr(value || 'Enter')});`] };
    case 'wait':
      return {
        code: [
          `// QATools "wait" step — pertimbangkan WebDriverWait dengan kondisi eksplisit.`,
          `try { Thread.sleep(${clampInt(value || step.timeout_ms, 0, 60_000)}L); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }`,
        ],
      };
    case 'assert_text':
      return { code: [`Assert.assertTrue(${page}.text(${by}).contains(${javaStr(expected)}), "Teks tidak memuat: " + ${javaStr(expected)});`] };
    case 'assert_visible':
      return { code: [`Assert.assertTrue(${page}.isVisible(${by}), "Elemen tidak terlihat: " + ${javaStr(selector)});`] };
    case 'assert_url':
      return { code: [`Assert.assertTrue(${page}.url().contains(${javaStr(expected)}), "URL tidak memuat: " + ${javaStr(expected)});`] };
    case 'screenshot':
      return { code: [`${page}.screenshot(${javaStr(value || 'step')});`] };
    case 'hover':
      return { code: [`${page}.hover(${by});`] };
    case 'scroll':
      return { code: [`${page}.scrollTo(${by});`] };
    default:
      return {
        code: [`// Aksi "${textOf(step.action, 'unknown')}" belum dipetakan ke Selenium.`],
        warning: `Aksi web "${textOf(step.action, 'unknown')}" belum punya padanan Selenium.`,
      };
  }
}

/* ------------------------------------------------------------------ *
 * pom.xml
 * ------------------------------------------------------------------ */

function pomXml(ctx: GenerateContext): string {
  const parallel = ctx.parallel
    ? `<parallel>methods</parallel>
        <threadCount>${clampInt(ctx.workers, 1, 16)}</threadCount>`
    : `<parallel>none</parallel>
        <threadCount>1</threadCount>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <groupId>${ctx.package_name}</groupId>
  <artifactId>${ctx.slug}</artifactId>
  <version>1.0.0</version>
  <packaging>jar</packaging>
  <name>${escapeXml(ctx.project.name)} — Selenium TestNG (QATools)</name>
  <description>Proyek automation Selenium + TestNG yang digenerate QATools.</description>

  <properties>
    <maven.compiler.release>17</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    <selenium.version>${SELENIUM_VERSION}</selenium.version>
    <testng.version>${TESTNG_VERSION}</testng.version>
    <webdrivermanager.version>${WEBDRIVERMANAGER_VERSION}</webdrivermanager.version>
    <slf4j.version>${SLF4J_VERSION}</slf4j.version>
    <suiteXmlFile>src/test/resources/testng.xml</suiteXmlFile>
  </properties>

  <dependencies>
    <dependency>
      <groupId>org.seleniumhq.selenium</groupId>
      <artifactId>selenium-java</artifactId>
      <version>\${selenium.version}</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>org.testng</groupId>
      <artifactId>testng</artifactId>
      <version>\${testng.version}</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>io.github.bonigarcia</groupId>
      <artifactId>webdrivermanager</artifactId>
      <version>\${webdrivermanager.version}</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>org.slf4j</groupId>
      <artifactId>slf4j-simple</artifactId>
      <version>\${slf4j.version}</version>
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
          <suiteXmlFiles>
            <suiteXmlFile>\${suiteXmlFile}</suiteXmlFile>
          </suiteXmlFiles>
          <!-- Lokal: jalankan lewat testng.xml. Ganti -DsuiteXmlFile bila perlu. -->
          <parallel>methods</parallel>
          <threadCount>${clampInt(ctx.workers, 1, 16)}</threadCount>
          <reportsDirectory>\${project.build.directory}/surefire-reports</reportsDirectory>
          <testFailureIgnore>false</testFailureIgnore>
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
 * Base page + driver factory
 * ------------------------------------------------------------------ */

function basePageJava(ctx: GenerateContext): string {
  return `package ${ctx.package_name}.pages;

import java.time.Duration;

import org.openqa.selenium.By;
import org.openqa.selenium.JavascriptExecutor;
import org.openqa.selenium.OutputType;
import org.openqa.selenium.TakesScreenshot;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.interactions.Actions;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.Select;
import org.openqa.selenium.support.ui.WebDriverWait;

/**
 * Page object dasar: pembungkus tipis di atas WebDriver dengan wait eksplisit.
 * Digenerate QATools — sunting di sini ketika perilaku aplikasi berubah.
 */
public abstract class BasePage {

    protected final WebDriver driver;
    protected final WebDriverWait wait;

    protected BasePage(WebDriver driver) {
        this.driver = driver;
        long timeoutSeconds = QaConfig.timeoutSeconds();
        this.wait = new WebDriverWait(driver, Duration.ofSeconds(timeoutSeconds));
    }

    /** Buka sebuah URL absolut. */
    public void open(String url) {
        driver.get(url);
    }

    public WebElement find(By by) {
        return wait.until(ExpectedConditions.presenceOfElementLocated(by));
    }

    public void click(By by) {
        wait.until(ExpectedConditions.elementToBeClickable(by)).click();
    }

    public void type(By by, String value) {
        WebElement element = wait.until(ExpectedConditions.visibilityOfElementLocated(by));
        element.clear();
        element.sendKeys(value);
    }

    public void selectByVisibleText(By by, String value) {
        new Select(find(by)).selectByVisibleText(value);
    }

    public void check(By by, boolean checked) {
        WebElement element = wait.until(ExpectedConditions.elementToBeClickable(by));
        if (element.isSelected() != checked) {
            element.click();
        }
    }

    public void pressKey(By by, String key) {
        find(by).sendKeys(key);
    }

    public void hover(By by) {
        new Actions(driver).moveToElement(find(by)).perform();
    }

    public void scrollTo(By by) {
        ((JavascriptExecutor) driver).executeScript("arguments[0].scrollIntoView({block:'center'});", find(by));
    }

    public String text(By by) {
        return wait.until(ExpectedConditions.visibilityOfElementLocated(by)).getText();
    }

    public boolean isVisible(By by) {
        try {
            return wait.until(ExpectedConditions.visibilityOfElementLocated(by)).isDisplayed();
        } catch (RuntimeException notFound) {
            return false;
        }
    }

    public String url() {
        return driver.getCurrentUrl();
    }

    /** Simpan screenshot ke target/screenshots/<name>.png. */
    public void screenshot(String name) {
        try {
            byte[] png = ((TakesScreenshot) driver).getScreenshotAs(OutputType.BYTES);
            java.nio.file.Path dir = java.nio.file.Paths.get("target", "screenshots");
            java.nio.file.Files.createDirectories(dir);
            String safe = name.replaceAll("[^A-Za-z0-9._-]", "-");
            java.nio.file.Files.write(dir.resolve(safe + ".png"), png);
        } catch (Exception e) {
            throw new IllegalStateException("Gagal menyimpan screenshot: " + e.getMessage(), e);
        }
    }
}
`;
}

function qaConfigJava(ctx: GenerateContext): string {
  return `package ${ctx.package_name};

import java.io.IOException;
import java.io.InputStream;
import java.util.Properties;

/**
 * Konfigurasi runtime: dibaca dari src/test/resources/config.properties lalu
 * dioverride oleh system property / environment variable.
 */
public final class QaConfig {

    private static final Properties PROPS = load();
    private static final String DEFAULT_BASE_URL = ${javaStr(ctx.base_url)};

    private QaConfig() {
    }

    private static Properties load() {
        Properties props = new Properties();
        try (InputStream in = QaConfig.class.getClassLoader().getResourceAsStream("config.properties")) {
            if (in != null) {
                props.load(in);
            }
        } catch (IOException e) {
            // Konfigurasi opsional: default di bawah tetap dipakai.
        }
        return props;
    }

    public static String baseUrl() {
        String fromEnv = System.getenv("QA_BASE_URL");
        if (fromEnv != null && !fromEnv.isBlank()) {
            return stripTrailingSlash(fromEnv);
        }
        String fromProp = System.getProperty("baseUrl");
        if (fromProp != null && !fromProp.isBlank()) {
            return stripTrailingSlash(fromProp);
        }
        String fromFile = PROPS.getProperty("baseUrl");
        if (fromFile != null && !fromFile.isBlank()) {
            return stripTrailingSlash(fromFile);
        }
        return DEFAULT_BASE_URL;
    }

    public static String browser() {
        String fromEnv = System.getenv("QA_BROWSER");
        if (fromEnv != null && !fromEnv.isBlank()) {
            return fromEnv;
        }
        return PROPS.getProperty("browser", "chrome");
    }

    public static long timeoutSeconds() {
        String fromEnv = System.getenv("QA_TIMEOUT_SECONDS");
        String raw = fromEnv != null && !fromEnv.isBlank() ? fromEnv : PROPS.getProperty("timeoutSeconds", "20");
        try {
            return Math.max(1L, Long.parseLong(raw.trim()));
        } catch (NumberFormatException e) {
            return 20L;
        }
    }

    /** Jalankan headless? Default true supaya CI tidak butuh display. */
    public static boolean headless() {
        String fromEnv = System.getenv("QA_HEADLESS");
        String raw = fromEnv != null && !fromEnv.isBlank() ? fromEnv : PROPS.getProperty("headless", "true");
        return !"false".equalsIgnoreCase(raw.trim());
    }

    private static String stripTrailingSlash(String url) {
        String out = url.trim();
        while (out.endsWith("/")) {
            out = out.substring(0, out.length() - 1);
        }
        return out;
    }
}
`;
}

function driverFactoryJava(ctx: GenerateContext): string {
  return `package ${ctx.package_name};

import java.time.Duration;

import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.openqa.selenium.edge.EdgeDriver;
import org.openqa.selenium.edge.EdgeOptions;
import org.openqa.selenium.firefox.FirefoxDriver;
import org.openqa.selenium.firefox.FirefoxOptions;

import io.github.bonigarcia.wdm.WebDriverManager;

/**
 * Membuat WebDriver sesuai konfigurasi. WebDriverManager mengunduh driver yang
 * cocok, jadi tidak perlu mengatur PATH secara manual.
 */
public final class DriverFactory {

    private DriverFactory() {
    }

    public static WebDriver create() {
        String browser = QaConfig.browser().toLowerCase();
        boolean headless = QaConfig.headless();
        WebDriver driver;
        switch (browser) {
            case "firefox":
                WebDriverManager.firefoxdriver().setup();
                FirefoxOptions firefox = new FirefoxOptions();
                if (headless) {
                    firefox.addArguments("-headless");
                }
                driver = new FirefoxDriver(firefox);
                break;
            case "edge":
                WebDriverManager.edgedriver().setup();
                EdgeOptions edge = new EdgeOptions();
                if (headless) {
                    edge.addArguments("--headless=new");
                }
                driver = new EdgeDriver(edge);
                break;
            case "chrome":
            default:
                WebDriverManager.chromedriver().setup();
                ChromeOptions chrome = new ChromeOptions();
                if (headless) {
                    chrome.addArguments("--headless=new");
                }
                chrome.addArguments("--window-size=1440,900");
                chrome.addArguments("--disable-gpu");
                chrome.addArguments("--no-sandbox");
                driver = new ChromeDriver(chrome);
                break;
        }
        driver.manage().timeouts().implicitlyWait(Duration.ofSeconds(2));
        driver.manage().timeouts().pageLoadTimeout(Duration.ofSeconds(45));
        if (!headless) {
            driver.manage().window().maximize();
        }
        return driver;
    }
}
`;
}

function baseTestJava(ctx: GenerateContext): string {
  return `package ${ctx.package_name}.tests;

import org.openqa.selenium.WebDriver;
import org.testng.annotations.AfterMethod;
import org.testng.annotations.BeforeMethod;

import ${ctx.package_name}.DriverFactory;
import ${ctx.package_name}.QaConfig;

/**
 * Base class TestNG: mengelola siklus hidup WebDriver per metode test sehingga
 * eksekusi paralel (testng.xml parallel="methods") aman — setiap thread punya driver sendiri.
 */
public abstract class BaseTest {

    protected WebDriver driver;

    @BeforeMethod(alwaysRun = true)
    public void setUp() {
        driver = DriverFactory.create();
    }

    @AfterMethod(alwaysRun = true)
    public void tearDown() {
        if (driver != null) {
            driver.quit();
            driver = null;
        }
    }

    protected String baseUrl() {
        return QaConfig.baseUrl();
    }
}
`;
}

/* ------------------------------------------------------------------ *
 * Page objects
 * ------------------------------------------------------------------ */

function pageObjectJava(cls: string, ctx: GenerateContext, flowIndex: number): string {
  const flow = ctx.flows[flowIndex];
  if (!flow) return '';
  const selectors = new Map<string, string>();
  for (const step of flow.steps) {
    const selector = textOf(step.selector, '').trim();
    if (!selector) continue;
    if (!selectors.has(selector)) {
      selectors.set(selector, `el${selectors.size + 1}`);
    }
  }

  const fields = [...selectors.entries()]
    .map(([selector, prop]) => `    /** Selector: ${commentLine(selector)} */\n    private static final String ${prop.toUpperCase()} = ${javaStr(selector)};`)
    .join('\n');

  const methods: string[] = [];
  if (flow.start_url) {
    methods.push(`    /** Buka halaman awal flow. */\n    public void open() {\n        open(${javaStr(flow.start_url)});\n    }`);
  }
  for (const step of flow.steps) {
    const emission = seleniumStatement(step, "this", flow.start_url || ctx.base_url);
    const methodName = javaMethodName(step);
    const body = emission.code.map((l) => `        ${l}`).join('\n');
    methods.push(
      `    /** ${commentLine(step.description || `${step.action} ${textOf(step.selector, '')}`)} */\n    public void ${methodName}() {\n${body}\n    }`,
    );
  }

  return `package ${ctx.package_name}.pages;

import org.openqa.selenium.By;
import org.testng.Assert;

/**
 * Page object untuk web flow "${commentLine(flow.flow.name)}".
${flow.test_case_code ? ` * Test case: ${commentLine(`${flow.test_case_code} — ${textOf(flow.test_case_title, '')}`)}\n` : ''} * Halaman awal: ${commentLine(flow.start_url || ctx.base_url)}
 * Digenerate QATools.
 */
public class ${cls} extends BasePage {

${fields || '    // Flow ini belum punya selector.'}

    public ${cls}(org.openqa.selenium.WebDriver driver) {
        super(driver);
    }

${methods.join('\n\n') || '    // Belum ada langkah pada flow ini.'}
}
`;
}

function javaMethodName(step: WebStep): string {
  const raw = step.description || `${step.action} ${step.selector ?? step.value ?? ''}`;
  const words = textOf(raw, 'step')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);
  if (!words.length) return 'step';
  const camel = words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join('');
  const safe = camel.replace(/[^A-Za-z0-9_$]/g, '');
  return /^[A-Za-z_$]/.test(safe) ? safe : `step${safe}`;
}

/* ------------------------------------------------------------------ *
 * Test classes
 * ------------------------------------------------------------------ */

function webTestJava(ctx: GenerateContext): string {
  const tests: string[] = [];
  const imports = new Set<string>();

  if (!ctx.flows.length) {
    tests.push(`    @Test(description = "Placeholder: belum ada web flow di QATools")
    public void placeholderBelumAdaWebFlow() {
        // Buat web flow di menu Web Automation QATools lalu generate ulang.
        org.testng.Assert.assertTrue(true, "Placeholder");
    }`);
  }

  for (const flow of ctx.flows) {
    const cls = pascalCase(flow.flow.name, 'Flow');
    imports.add(`${ctx.package_name}.pages.${cls}`);
    const title = flow.test_case_title
      ? `${flow.test_case_code ? `${flow.test_case_code} — ` : ''}${flow.test_case_title}`
      : `Web flow: ${flow.flow.name}`;
    const caseRecord = flow.test_case_id ? ctx.cases.find((c) => c.test_case.id === flow.test_case_id) : undefined;
    const trace = caseRecord ? ancestryLine(caseRecord.ancestry) : '';
    const methodName = safeSegment(pascalCase(flow.flow.name, 'Flow'), 'flow');

    const body: string[] = [];
    body.push(`        ${cls} page = new ${cls}(driver);`);
    body.push('        page.open();');
    for (const step of flow.steps) {
      const emission = seleniumStatement(step, 'page', flow.start_url || ctx.base_url);
      if (emission.warning) ctx.warnings.push(`Selenium: ${flow.flow.name}: ${emission.warning}`);
      for (const line of emission.code) {
        if (line.startsWith('// Aksi ')) continue;
        body.push(`        ${line}`);
      }
    }
    if (caseRecord) {
      for (const step of caseRecord.steps) {
        body.push(`        // Manual: ${commentLine(`${step.order_index}. ${textOf(step.action, '')} → ${textOf(step.expected, '')}`)}`);
      }
      const expectedResult = textOf(caseRecord.test_case.expected_result, '');
      if (expectedResult && !flow.steps.length) {
        body.push(`        Assert.assertTrue(page.text(By.tagName("body")).contains(${javaStr(expectedResult.slice(0, 120))}),`);
        body.push(`                "Halaman tidak memuat hasil yang diharapkan");`);
      }
    }

    tests.push(`    /**
     * ${commentLine(title)}
${trace ? `     * Traceability: ${commentLine(trace)}\n` : ''}     */
    @Test(description = ${javaStr(title)}, groups = { "web", "qatools"${caseRecord?.test_case.is_regression ? ', "regression"' : ''} })
    public void test_${methodName}() {
${body.join('\n')}
    }`);
  }

  return `package ${ctx.package_name}.tests;

import org.openqa.selenium.By;
import org.testng.Assert;
import org.testng.annotations.Test;

import ${ctx.package_name}.QaConfig;
${[...imports].map((i) => `import ${i};`).join('\n')}

/**
 * Test web Selenium untuk proyek "${commentLine(ctx.project.name)}".
 * Semua URL berasal dari QaConfig.baseUrl(); tidak ada URL yang di-hardcode.
 */
public class WebTest extends BaseTest {

${tests.join('\n\n')}
}
`;
}

/* ------------------------------------------------------------------ *
 * testng.xml + config.properties
 * ------------------------------------------------------------------ */

function testngXml(ctx: GenerateContext): string {
  const parallel = ctx.parallel ? 'methods' : 'none';
  const threadCount = ctx.parallel ? clampInt(ctx.workers, 1, 16) : 1;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE suite SYSTEM "https://testng.org/testng-1.0.dtd">
<suite name="QATools-${escapeXml(ctx.project.key)}" verbose="1" parallel="${parallel}" thread-count="${threadCount}"
       data-provider-thread-count="${threadCount}">
  <test name="Web" preserve-order="true">
    <parameter name="baseUrl" value="${escapeXml(ctx.base_url)}"/>
    <packages>
      <package name="${ctx.package_name}.tests"/>
    </packages>
  </test>
</suite>
`;
}

function configProperties(ctx: GenerateContext): string {
  return `# Konfigurasi runtime proyek Selenium — digenerate QATools.
# Bisa dioverride tanpa mengubah kode:
#   PowerShell : $env:QA_BASE_URL = "https://staging.example.com"
#   Maven      : mvn test -DbaseUrl=https://staging.example.com -Dbrowser=firefox
baseUrl=${ctx.base_url}
browser=chrome
timeoutSeconds=20
headless=true
`;
}

function gitignore(): string {
  return `target/
screenshots/
*.iml
.idea/
.vscode/
`;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export function generate(ctx: GenerateContext): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const pkg = ctx.package_name;
  const pkgPath = pkg.replace(/\./g, '/');

  files.push(file('pom.xml', 'yaml', 'Maven POM: Selenium 4, TestNG, WebDriverManager, surefire parallel.', pomXml(ctx)));
  files.push(
    file(
      'src/test/resources/testng.xml',
      'yaml',
      `Suite TestNG dengan parallel="${ctx.parallel ? 'methods' : 'none'}" thread-count=${ctx.parallel ? clampInt(ctx.workers, 1, 16) : 1}.`,
      testngXml(ctx),
    ),
  );
  files.push(
    file('src/test/resources/config.properties', 'yaml', 'Konfigurasi baseUrl/browser/timeout yang bisa dioverride.', configProperties(ctx)),
  );
  files.push(file('.gitignore', 'yaml', 'Abaikan target/ dan artefak IDE.', gitignore()));

  files.push(
    file(
      `src/test/java/${pkgPath}/QaConfig.java`,
      'java',
      'Pembaca konfigurasi (config.properties + environment variable + system property).',
      qaConfigJava(ctx),
    ),
  );
  files.push(
    file(
      `src/test/java/${pkgPath}/DriverFactory.java`,
      'java',
      'Factory WebDriver (Chrome/Firefox/Edge) memakai WebDriverManager, mendukung headless.',
      driverFactoryJava(ctx),
    ),
  );
  files.push(
    file(
      `src/test/java/${pkgPath}/pages/BasePage.java`,
      'java',
      'Base page object: wait eksplisit, klik, ketik, screenshot.',
      basePageJava(ctx),
    ),
  );
  files.push(
    file(
      `src/test/java/${pkgPath}/tests/BaseTest.java`,
      'java',
      'Base class TestNG: setup/teardown WebDriver per metode agar paralel aman.',
      baseTestJava(ctx),
    ),
  );

  const generated: Array<{ cls: string; path: string }> = [];
  for (let i = 0; i < ctx.flows.length; i++) {
    const flow = ctx.flows[i]!;
    const cls = pascalCase(flow.flow.name, 'Flow');
    if (generated.some((g) => g.cls === cls)) continue;
    const path = `src/test/java/${pkgPath}/pages/${cls}.java`;
    generated.push({ cls, path });
    files.push(
      file(path, 'java', `Page object Java untuk web flow "${flow.flow.name}".`, pageObjectJava(cls, ctx, i)),
    );
  }

  if (ctx.layers.includes('web')) {
    files.push(
      file(
        `src/test/java/${pkgPath}/tests/WebTest.java`,
        'java',
        'TestNG test web: satu @Test per web flow dengan assertion TestNG.',
        webTestJava(ctx),
      ),
    );
  }

  if (!ctx.flows.length) {
    ctx.warnings.push(
      'Tidak ada web flow: WebTest.java hanya memuat placeholder. Proyek Maven tetap lengkap dan `mvn test` akan berjalan.',
    );
  }
  if (!ctx.parallel) {
    ctx.warnings.push(
      'Mode paralel tidak diminta: testng.xml memakai parallel="none" dan thread-count=1.',
    );
  }
  return files;
}
