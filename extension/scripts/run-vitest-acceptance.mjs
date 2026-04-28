import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(scriptsDir, "..");
const require = createRequire(import.meta.url);

function resolveVitestEntrypoint() {
  return require.resolve("vitest/vitest.mjs", {
    paths: [extensionRoot, path.resolve(extensionRoot, "..")]
  });
}

function runVitestSelection(selection) {
  return new Promise((resolve, reject) => {
    const vitestEntrypoint = resolveVitestEntrypoint();
    const target = selection.line
      ? `${path.normalize(selection.file)}:${selection.line}`
      : path.normalize(selection.file);
    const args = [
      vitestEntrypoint,
      "run",
      target
    ];

    if (selection.testName) {
      args.push("--testNamePattern", selection.testName);
    }

    const child = spawn(process.execPath, [
      ...args
    ], {
      cwd: extensionRoot,
      stdio: "inherit",
      shell: false,
      env: process.env
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`vitest selection terminated by signal ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`vitest selection failed with exit code ${code ?? 1}: ${selection.testName}`));
        return;
      }
      resolve();
    });
  });
}

export async function runVitestSelections(testcaseName, selections) {
  for (const selection of selections) {
    await runVitestSelection(selection);
  }

  console.log(JSON.stringify({
    testcase: testcaseName,
    result: "passed",
    selections: selections.map((selection) => ({
      file: selection.file,
      line: selection.line,
      testName: selection.testName
    }))
  }, null, 2));
}

export async function runVitestAcceptance(selections) {
  await runVitestSelections("acceptance", selections);
}
