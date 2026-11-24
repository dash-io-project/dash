import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

/**
 * Copy the Couchbase SDK and the native addon into the server output.
 * The production image contains only that output.
 */
export async function traceCouchbase(serverDir) {
  const root = join(serverDir, "node_modules");
  await mkdir(root, { recursive: true });
  await copyPackage("couchbase", require, root, new Set());
}

function packageRoot(fromRequire, name) {
  let entry;
  try {
    entry = fromRequire.resolve(name);
  } catch {
    return undefined;
  }
  let dir = dirname(entry);
  while (dir !== dirname(dir)) {
    const manifestPath = join(dir, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (manifest.name === name) {
        return dir;
      }
    }
    dir = dirname(dir);
  }
  return undefined;
}

async function copyPackage(name, fromRequire, destRoot, seen) {
  if (seen.has(name)) {
    return;
  }
  const source = packageRoot(fromRequire, name);
  if (!source) {
    return;
  }
  seen.add(name);
  const manifestPath = join(source, "package.json");
  const destination = join(destRoot, ...name.split("/"));
  await rm(destination, { recursive: true, force: true });
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, {
    recursive: true,
    dereference: true,
    filter(path) {
      if (name !== "couchbase") {
        return true;
      }
      const relative = path.slice(source.length);
      return !/(?:^|[/\\])(?:deps|src)(?:[/\\]|$)/.test(relative);
    },
  });
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const child = createRequire(join(source, "package.json"));
  const required = new Set(Object.keys(manifest.dependencies ?? {}));
  const names = [...required, ...Object.keys(manifest.optionalDependencies ?? {})];
  for (const dependency of names) {
    await copyPackage(dependency, child, destRoot, seen);
    if (required.has(dependency) && !seen.has(dependency)) {
      throw new Error(`Couchbase runtime dependency was not found: ${dependency}`);
    }
  }
}
