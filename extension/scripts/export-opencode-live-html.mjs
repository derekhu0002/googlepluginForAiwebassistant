import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const PAGE_URL = process.env.OPENCODE_WEB_URL ?? "http://localhost:8124/";
const OUTPUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../temp/real-extension-smoke");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "OpenCode.live.HTML");
const CHROMIUM_EXECUTABLE = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? null;

async function resolveChromiumExecutablePath() {
  if (CHROMIUM_EXECUTABLE) {
    return CHROMIUM_EXECUTABLE;
  }

  const playwrightRoot = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
  if (!playwrightRoot) {
    return undefined;
  }

  const entries = await readdir(playwrightRoot, { withFileTypes: true }).catch(() => []);
  const chromiumDirs = entries
    .filter((entry) => entry.isDirectory() && /^chromium-\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => Number(right.slice("chromium-".length)) - Number(left.slice("chromium-".length)));

  for (const dirName of chromiumDirs) {
    const candidate = path.join(playwrightRoot, dirName, "chrome-win64", "chrome.exe");
    try {
      await readdir(path.dirname(candidate));
      return candidate;
    } catch {
      // Try the next cached browser.
    }
  }

  return undefined;
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true, executablePath: await resolveChromiumExecutablePath() });
  try {
    const page = await browser.newPage();
    await page.goto(PAGE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.waitForTimeout(1000);

    const bodyHtml = await page.locator("body").innerHTML();
    const textSample = (await page.locator("body").innerText()).slice(0, 1000);
    await writeFile(OUTPUT_FILE, bodyHtml, "utf8");

    console.log(JSON.stringify({
      pageUrl: PAGE_URL,
      outputFile: OUTPUT_FILE,
      textSample
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
