import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

const SEVEN_ZIP_TIMEOUT = 120_000; // 2 minutes

/** Resolve the 7z binary name (7z on most systems, 7za on Alpine p7zip). */
async function resolve7zBin(): Promise<string> {
  for (const bin of ['7z', '7za']) {
    const ok = await new Promise<boolean>((resolve) => {
      execFile(bin, ['--help'], { timeout: 5_000 }, (err) => resolve(!err));
    });
    if (ok) return bin;
  }
  throw new Error('7z binary not found. Install p7zip (Linux) or 7-Zip (Windows).');
}

/** Check whether the 7z binary is available on this system. */
export async function is7zAvailable(): Promise<boolean> {
  try {
    await resolve7zBin();
    return true;
  } catch {
    return false;
  }
}

/**
 * Compress files into a .7z archive using LZMA2 at maximum compression.
 * All `inputPaths` must be absolute and will be validated to exist.
 */
export async function compressTo7z(inputPaths: string[], outputPath: string): Promise<void> {
  const bin = await resolve7zBin();

  // Validate inputs exist
  for (const p of inputPaths) {
    if (!path.isAbsolute(p)) throw new Error(`Input path must be absolute: ${p}`);
    await fs.access(p);
  }
  if (!path.isAbsolute(outputPath)) throw new Error(`Output path must be absolute: ${outputPath}`);

  // 7z a -t7z -mx=9 outputPath inputPaths...
  const args = ['a', '-t7z', '-mx=9', '-y', outputPath, ...inputPaths];

  await new Promise<void>((resolve, reject) => {
    execFile(bin, args, { timeout: SEVEN_ZIP_TIMEOUT }, (err, _stdout, stderr) => {
      if (err) {
        reject(new Error(`7z compression failed: ${stderr || err.message}`));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Extract a .7z archive into `outputDir`.
 * Both paths must be absolute.
 */
export async function extractFrom7z(archivePath: string, outputDir: string): Promise<void> {
  const bin = await resolve7zBin();

  if (!path.isAbsolute(archivePath)) throw new Error(`Archive path must be absolute: ${archivePath}`);
  if (!path.isAbsolute(outputDir)) throw new Error(`Output dir must be absolute: ${outputDir}`);

  await fs.access(archivePath);
  await fs.mkdir(outputDir, { recursive: true });

  // 7z x archivePath -oOutputDir -y
  const args = ['x', archivePath, `-o${outputDir}`, '-y'];

  await new Promise<void>((resolve, reject) => {
    execFile(bin, args, { timeout: SEVEN_ZIP_TIMEOUT }, (err, _stdout, stderr) => {
      if (err) {
        reject(new Error(`7z extraction failed: ${stderr || err.message}`));
      } else {
        resolve();
      }
    });
  });
}
