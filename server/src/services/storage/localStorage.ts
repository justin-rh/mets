// Local-disk storage adapter (STORAGE_PROVIDER=local). The Azure Blob
// adapter swaps in for production with the same three calls; storage keys
// are opaque to the rest of the app either way. Bytes never touch Postgres.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile as fsRead, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../uploads');

// Extension allowlist — screenshots, docs, logs. No svg (script execution
// risk when rendered), no executables, no unknowns.
export const ALLOWED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
  '.pdf', '.txt', '.log', '.csv', '.xlsx', '.docx', '.zip', '.eml', '.msg',
]);

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

export function extensionOf(filename: string): string {
  return path.extname(filename).toLowerCase();
}

/** Content types safe to render inline; everything else downloads. */
export function inlineContentType(contentType: string): boolean {
  return (contentType.startsWith('image/') && contentType !== 'image/svg+xml')
    || contentType === 'application/pdf';
}

export async function saveFile(buffer: Buffer, filename: string): Promise<{ storageKey: string; sha256: string }> {
  const ext = extensionOf(filename);
  const month = new Date().toISOString().slice(0, 7);
  const storageKey = `${month}/${randomUUID()}${ext}`;
  const target = path.join(ROOT, storageKey);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, buffer);
  return { storageKey, sha256: createHash('sha256').update(buffer).digest('hex') };
}

export async function readFile(storageKey: string): Promise<Buffer> {
  // storage keys are server-generated, but never trust a path join
  const target = path.join(ROOT, storageKey);
  if (!target.startsWith(ROOT)) throw Object.assign(new Error('bad storage key'), { statusCode: 400 });
  return fsRead(target);
}

export async function deleteFile(storageKey: string): Promise<void> {
  const target = path.join(ROOT, storageKey);
  if (!target.startsWith(ROOT)) return;
  await unlink(target).catch(() => {});
}
