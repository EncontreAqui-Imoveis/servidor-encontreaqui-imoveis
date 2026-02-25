import { promises as fs } from 'fs';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import path from 'path';

import { MEDIA_UPLOAD_DIR } from './uploadMiddleware';

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function normalizePath(value: string): string {
  return path.resolve(value);
}

function isWithinMediaTempDir(filePath: string): boolean {
  const normalizedFilePath = normalizePath(filePath);
  const normalizedTempDir = normalizePath(MEDIA_UPLOAD_DIR);
  return (
    normalizedFilePath === normalizedTempDir ||
    normalizedFilePath.startsWith(`${normalizedTempDir}${path.sep}`)
  );
}

function collectUploadPaths(value: unknown, accumulator: Set<string>): void {
  if (!value) return;

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectUploadPaths(entry, accumulator);
    }
    return;
  }

  if (!isObjectLike(value)) return;

  const maybePath = (value as { path?: unknown }).path;
  if (typeof maybePath === 'string' && maybePath.length > 0) {
    if (isWithinMediaTempDir(maybePath)) {
      accumulator.add(normalizePath(maybePath));
    }
    return;
  }

  for (const nestedValue of Object.values(value)) {
    if (Array.isArray(nestedValue)) {
      collectUploadPaths(nestedValue, accumulator);
      continue;
    }
    if (
      isObjectLike(nestedValue) &&
      typeof (nestedValue as { path?: unknown }).path === 'string'
    ) {
      collectUploadPaths(nestedValue, accumulator);
    }
  }
}

async function cleanupPaths(paths: Iterable<string>) {
  const cleanupOps: Promise<unknown>[] = [];
  for (const filePath of paths) {
    cleanupOps.push(fs.unlink(filePath).catch(() => undefined));
  }
  await Promise.all(cleanupOps);
}

export const tempUploadCleanup: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  let finalized = false;

  const finalize = () => {
    if (finalized) return;
    finalized = true;

    const pathsToCleanup = new Set<string>();
    collectUploadPaths((req as Request & { file?: unknown }).file, pathsToCleanup);
    collectUploadPaths((req as Request & { files?: unknown }).files, pathsToCleanup);

    if (pathsToCleanup.size > 0) {
      void cleanupPaths(pathsToCleanup);
    }
  };

  res.on('finish', finalize);
  res.on('close', finalize);

  next();
};
