import { Global, Injectable, Module } from '@nestjs/common';
import { open as openFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEnv } from '../../config/env';

export const IMAGE_TYPES = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
} as const;
export type ImageExt = keyof typeof IMAGE_TYPES;

/** Detects image type from file contents (never trust the client-provided MIME type). */
export function sniffImage(buf: Buffer): ImageExt | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/**
 * Private file storage on local disk. Keys are relative paths such as "student-photos/<id>.jpg".
 * Swap this implementation for S3-compatible object storage when deploying to multiple instances.
 */
@Injectable()
export class StorageService {
  private readonly root = path.resolve(loadEnv().STORAGE_DIR);

  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error('Invalid storage key');
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    const tmp = `${full}.${process.pid}.tmp`;
    await writeFile(tmp, data, { mode: 0o600 });
    await rename(tmp, full);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolve(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  /** Absolute path of a stored file, for streaming with HTTP range support. */
  async pathOf(key: string): Promise<string | null> {
    const full = this.resolve(key);
    try {
      await stat(full);
      return full;
    } catch {
      return null;
    }
  }

  /** Moves an uploaded temporary file into storage under `key`. */
  async moveIn(key: string, tmpPath: string): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await rename(tmpPath, full);
  }

  /** Directory for in-progress uploads (same file system, so moveIn is a rename). */
  get uploadDir(): string {
    return path.join(this.root, '.uploads');
  }
}

/** Reads the first bytes of a file to detect its real type. */
export async function headOf(file: string, n = 16): Promise<Buffer> {
  const fh = await openFile(file, 'r');
  try {
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

export type DocType = 'pdf' | 'mp4' | 'webm';
export const DOC_MIME: Record<DocType, string> = { pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm' };

/** Detects PDF and the two video containers tablets can play. */
export function sniffDocument(head: Buffer): DocType | null {
  if (head.length >= 4 && head.toString('ascii', 0, 4) === '%PDF') return 'pdf';
  if (head.length >= 8 && head.toString('ascii', 4, 8) === 'ftyp') return 'mp4';
  if (head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3) return 'webm';
  return null;
}

@Global()
@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
