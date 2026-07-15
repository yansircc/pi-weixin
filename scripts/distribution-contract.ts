import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

interface PackageManifest {
  readonly files?: readonly string[];
  readonly pi?: {
    readonly extensions?: readonly string[];
  };
}

export interface DistributionContract {
  readonly root: string;
  readonly distDirectory: string;
  readonly entryRelative: string;
  readonly entryAbsolute: string;
  readonly outputFileName: string;
  readonly publishedRootFiles: readonly string[];
}

export const projectRoot = fileURLToPath(new URL("..", import.meta.url));

const nodeModules = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

const hostModules = new Set(["@earendil-works/pi-coding-agent"]);

export const isAllowedExternal = (specifier: string): boolean =>
  nodeModules.has(specifier) || hostModules.has(specifier);

export const readDistributionContract = (root = projectRoot): DistributionContract => {
  const manifest = JSON.parse(
    readFileSync(resolve(root, "package.json"), "utf8"),
  ) as PackageManifest;
  const extensions = manifest.pi?.extensions ?? [];
  assert.equal(extensions.length, 1, "package.json must declare exactly one Pi extension");

  const entryRelative = extensions[0]?.replace(/^\.\//, "");
  assert.ok(entryRelative, "Pi extension entry is missing");
  assert.ok(
    entryRelative.startsWith("dist/") && entryRelative.endsWith(".js"),
    "Pi extension entry must be a JavaScript file under dist/",
  );
  const extensionDirectory = dirname(entryRelative);
  const publishedFiles = manifest.files ?? [];
  assert.ok(
    publishedFiles.includes(extensionDirectory),
    "package files must publish the Pi extension directory",
  );
  const publishedRootFiles = publishedFiles.filter((path) => path !== extensionDirectory);
  assert.deepEqual(
    publishedRootFiles,
    ["README.md", "LICENSE"],
    "package files must publish only standard root documentation beside the extension",
  );

  const distDirectory = resolve(root, "dist");
  const entryAbsolute = resolve(root, entryRelative);
  assert.ok(entryAbsolute.startsWith(`${distDirectory}${sep}`), "Pi extension entry escapes dist/");

  return {
    root,
    distDirectory,
    entryRelative,
    entryAbsolute,
    outputFileName: relative(distDirectory, entryAbsolute),
    publishedRootFiles,
  };
};
