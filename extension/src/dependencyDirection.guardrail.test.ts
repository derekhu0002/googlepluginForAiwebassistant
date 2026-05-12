import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = path.resolve(import.meta.dirname);

interface ImportViolation {
  filePath: string;
  importPath: string;
  reason: string;
}

function collectSourceFiles(directoryPath: string): string[] {
  const entries = readdirSync(directoryPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "guardrails") {
        continue;
      }
      files.push(...collectSourceFiles(entryPath));
      continue;
    }

    if (!entry.name.match(/\.(ts|tsx)$/u) || entry.name.includes(".test.")) {
      continue;
    }

    files.push(entryPath);
  }

  return files;
}

function collectImportSpecifiers(filePath: string): string[] {
  const content = readFileSync(filePath, "utf8");
  const matches = content.matchAll(/(?:import|export)\s+(?:[^"'`]+?\s+from\s+)?["'`]([^"'`]+)["'`]|import\(\s*["'`]([^"'`]+)["'`]\s*\)/gu);
  const specifiers: string[] = [];

  for (const match of matches) {
    const specifier = match[1] ?? match[2];
    if (specifier) {
      specifiers.push(specifier);
    }
  }

  return specifiers;
}

function isWithin(directoryName: string, filePath: string) {
  return filePath.startsWith(path.join(SRC_ROOT, directoryName));
}

function validateImport(filePath: string, importPath: string): ImportViolation | null {
  if (!importPath.startsWith(".")) {
    return null;
  }

  const resolvedImport = path.normalize(path.resolve(path.dirname(filePath), importPath));

  if (isWithin("shared", filePath) && (isWithin("background", resolvedImport) || isWithin("sidepanel", resolvedImport) || isWithin("content", resolvedImport))) {
    return {
      filePath,
      importPath,
      reason: "shared 只能向下承载公共契约，不能反向依赖 background / sidepanel / content"
    };
  }

  if (isWithin("background", filePath) && isWithin("sidepanel", resolvedImport)) {
    return {
      filePath,
      importPath,
      reason: "background 负责编排，不应依赖 sidepanel UI"
    };
  }

  if (isWithin("sidepanel", filePath) && (isWithin("background", resolvedImport) || isWithin("content", resolvedImport))) {
    return {
      filePath,
      importPath,
      reason: "sidepanel 只能通过 shared/runtime message 触达后台与采集边界"
    };
  }

  if (isWithin("content", filePath) && (isWithin("background", resolvedImport) || isWithin("sidepanel", resolvedImport))) {
    return {
      filePath,
      importPath,
      reason: "content 只负责页面采集与嵌入式入口，不应依赖编排层或 UI 层"
    };
  }

  return null;
}

describe("extension source dependency direction guardrail", () => {
  it("keeps shared, background, sidepanel, and content dependencies flowing inward through shared contracts", () => {
    const files = ["background", "content", "shared", "sidepanel"].flatMap((directoryName) => collectSourceFiles(path.join(SRC_ROOT, directoryName)));
    const violations: ImportViolation[] = [];

    for (const filePath of files) {
      const imports = collectImportSpecifiers(filePath);
      for (const importPath of imports) {
        const violation = validateImport(filePath, importPath);
        if (violation) {
          violations.push(violation);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});