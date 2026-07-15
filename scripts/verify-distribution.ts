import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { parse } from "acorn";
import {
  isAllowedExternal,
  projectRoot,
  readDistributionContract,
  type DistributionContract,
} from "./distribution-contract.ts";

interface AstNode {
  readonly type: string;
  readonly source?: AstNode;
  readonly value?: unknown;
  readonly callee?: AstNode;
  readonly name?: string;
  readonly [key: string]: unknown;
}

const listFiles = (root: string): string[] => {
  const files: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    assert.ok(directory);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else files.push(relative(root, path));
    }
  }
  return files.sort();
};

const inspectModule = (source: string): readonly string[] => {
  const root = parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
  }) as unknown as AstNode;
  const imports = new Set<string>();
  const pending: unknown[] = [root];

  while (pending.length > 0) {
    const value = pending.pop();
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }

    const node = value as AstNode;
    if (
      node.type === "ImportDeclaration" ||
      node.type === "ExportNamedDeclaration" ||
      node.type === "ExportAllDeclaration"
    ) {
      if (node.source) imports.add(String(node.source.value));
    } else if (node.type === "ImportExpression") {
      assert.equal(node.source?.type, "Literal", "dynamic import must use a literal specifier");
      imports.add(String(node.source?.value));
    } else if (
      node.type === "CallExpression" &&
      node.callee?.type === "Identifier" &&
      node.callee.name === "require"
    ) {
      assert.fail("bundle must not contain require() calls");
    }

    for (const [key, child] of Object.entries(node)) {
      if (key !== "start" && key !== "end" && key !== "loc") pending.push(child);
    }
  }

  return [...imports].sort();
};

const verifyBundle = (contract: DistributionContract): void => {
  assert.ok(existsSync(contract.entryAbsolute), `missing bundle: ${contract.entryRelative}`);
  assert.deepEqual(
    listFiles(contract.distDirectory),
    [contract.outputFileName],
    "dist/ must contain only the declared Pi extension bundle",
  );

  const imports = inspectModule(readFileSync(contract.entryAbsolute, "utf8"));
  const forbidden = imports.filter((specifier) => !isAllowedExternal(specifier));
  assert.deepEqual(
    forbidden,
    [],
    `bundle contains non-host runtime imports: ${forbidden.join(", ")}`,
  );
};

const verifyWithPiLoader = async (packageRoot: string): Promise<void> => {
  const agentDirectory = resolve(packageRoot, ".pi-agent-test");
  const result = await discoverAndLoadExtensions([packageRoot], packageRoot, agentDirectory);
  assert.deepEqual(result.errors, [], "Pi extension loader reported errors");
  assert.equal(result.extensions.length, 1, "Pi loader must load exactly one extension");
  const extension = result.extensions[0];
  assert.ok(extension);
  assert.ok(extension.commands.has("weixin"), "bundle did not register /weixin");
  assert.ok(extension.handlers.has("session_start"), "bundle did not register session_start");
  assert.ok(extension.handlers.has("session_shutdown"), "bundle did not register session_shutdown");
};

const verifyPackage = async (archiveInput?: string): Promise<void> => {
  const temporary = mkdtempSync(join(tmpdir(), "pi-weixin-package-"));
  try {
    const archive =
      archiveInput === undefined ? join(temporary, "pi-weixin.tgz") : resolve(archiveInput);
    const extracted = join(temporary, "extracted");
    if (archiveInput === undefined) {
      execFileSync("pnpm", ["--config.ignore-scripts=true", "pack", "--out", archive], {
        cwd: projectRoot,
        stdio: "pipe",
      });
    }
    mkdirSync(extracted, { recursive: true });
    execFileSync("tar", ["-xzf", archive, "-C", extracted]);

    const packageRoot = join(extracted, "package");
    const contract = readDistributionContract(packageRoot);
    verifyBundle(contract);
    assert.deepEqual(
      listFiles(packageRoot),
      [...contract.publishedRootFiles, contract.entryRelative, "package.json"].sort(),
      "tarball contains files outside the distribution contract",
    );
    assert.equal(existsSync(join(packageRoot, "node_modules")), false);
    assert.equal(existsSync(join(packageRoot, "src")), false);
    await verifyWithPiLoader(packageRoot);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
};

const mode = process.argv[2];
assert.ok(
  mode === "bundle" || mode === "package" || mode === "archive",
  "usage: verify-distribution.ts bundle|package|archive <archive>",
);

if (mode === "archive") {
  const archiveArguments = process.argv.slice(3);
  if (archiveArguments[0] === "--") archiveArguments.shift();
  assert.equal(archiveArguments.length, 1, "archive mode requires exactly one archive path");
  await verifyPackage(archiveArguments[0]);
} else {
  const contract = readDistributionContract();
  verifyBundle(contract);
  if (mode === "package") await verifyPackage();
}
