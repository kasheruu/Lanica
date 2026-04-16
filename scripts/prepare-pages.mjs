import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const outputDir = path.join(projectRoot, "public");

const passthroughDirs = ["assets"];
const passthroughExtensions = new Set([".html", ".css", ".js"]);

async function pathExists(targetPath) {
  try {
    await readdir(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function copyStaticRootFiles() {
  const entries = await readdir(projectRoot, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(projectRoot, entry.name);
    const destinationPath = path.join(outputDir, entry.name);

    if (entry.isDirectory()) {
      if (!passthroughDirs.includes(entry.name)) continue;
      await cp(sourcePath, destinationPath, { recursive: true });
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (!passthroughExtensions.has(extension)) continue;

    await cp(sourcePath, destinationPath);
  }
}

async function main() {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  await copyStaticRootFiles();

  if (!(await pathExists(path.join(projectRoot, "functions")))) {
    console.warn("No functions directory found. Static Pages output prepared without server routes.");
  }

  console.log(`Prepared Cloudflare Pages output in ${outputDir}`);
}

main().catch((error) => {
  console.error("Failed to prepare Cloudflare Pages output:", error);
  process.exitCode = 1;
});
