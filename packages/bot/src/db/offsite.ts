import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { gzipSync } from 'node:zlib';
import { config } from '../config.js';

// Off-server copies of the nightly backup, so losing the VM doesn't lose the backups with it.
// BACKUP_UPLOAD_URL is an Oracle Object Storage pre-authenticated request (bucket, "Permit object writes" only):
// the server can add backups but can't read or list them. The URL is a secret: never log it.

export async function uploadBackup(file: string): Promise<void> {
  const base = config.backupUploadUrl;
  if (!base) return;
  const name = `${basename(file)}.gz`;
  const body = gzipSync(readFileSync(file));
  const url = base.replace(/\/?$/, '/') + encodeURIComponent(name);
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { method: 'PUT', body, headers: { 'Content-Type': 'application/gzip' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      console.log(`[db] backup uploaded off-server: ${name} (${Math.ceil(body.length / 1024)} KB)`);
      return;
    } catch (err) {
      if (attempt >= 3) throw new Error(`off-server backup upload failed after ${attempt} tries: ${(err as Error).message}`);
      await new Promise((r) => setTimeout(r, attempt * 60_000));
    }
  }
}
