import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const requireFromRepo = createRequire(path.join(repoRoot, "package.json"));

function resolveRollupNativePackageName() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "linux") {
    const report = typeof process.report?.getReport === "function" ? process.report.getReport() : null;
    const libc = report?.header?.glibcVersionRuntime ? "gnu" : "musl";

    if (arch === "x64") {
      return `@rollup/rollup-linux-x64-${libc}`;
    }

    if (arch === "arm64") {
      return `@rollup/rollup-linux-arm64-${libc}`;
    }

    return null;
  }

  if (platform === "darwin") {
    if (arch === "x64") {
      return "@rollup/rollup-darwin-x64";
    }

    if (arch === "arm64") {
      return "@rollup/rollup-darwin-arm64";
    }

    return null;
  }

  if (platform === "win32") {
    if (arch === "x64") {
      return "@rollup/rollup-win32-x64-msvc";
    }

    if (arch === "arm64") {
      return "@rollup/rollup-win32-arm64-msvc";
    }

    if (arch === "ia32") {
      return "@rollup/rollup-win32-ia32-msvc";
    }

    return null;
  }

  return null;
}

function resolveInstalledRollupVersion() {
  const rollupPackageJsonPath = requireFromRepo.resolve("rollup/package.json");
  const rollupPackageJson = JSON.parse(readFileSync(rollupPackageJsonPath, "utf8"));
  return rollupPackageJson.version;
}

function hasInstalledPackage(packageName) {
  try {
    requireFromRepo.resolve(`${packageName}/package.json`);
    return true;
  } catch {
    return false;
  }
}

function installMissingPackage(packageName, version) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(
    npmCommand,
    [
      "install",
      "--no-save",
      "--package-lock=false",
      "--ignore-scripts",
      "--include=optional",
      `${packageName}@${version}`
    ],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: process.env
    }
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function main() {
  const packageName = resolveRollupNativePackageName();
  if (!packageName) {
    return;
  }

  const rollupPackageJsonPath = path.join(repoRoot, "node_modules", "rollup", "package.json");
  if (!existsSync(rollupPackageJsonPath)) {
    return;
  }

  if (hasInstalledPackage(packageName)) {
    return;
  }

  const version = resolveInstalledRollupVersion();
  console.warn(`[ensure-rollup-native] missing ${packageName}@${version}; installing for ${process.platform}/${process.arch}`);
  installMissingPackage(packageName, version);
}

main();