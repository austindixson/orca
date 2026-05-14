import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { RepoSnapshot } from './types.js';

const SNAPSHOT_FILE = 'snapshots.json';

type SnapshotDb = Record<string, RepoSnapshot[]>;

export async function readSnapshots(outputDir: string): Promise<SnapshotDb> {
  const path = join(outputDir, SNAPSHOT_FILE);
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as SnapshotDb;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

export async function appendSnapshots(outputDir: string, snapshots: RepoSnapshot[]): Promise<void> {
  const path = join(outputDir, SNAPSHOT_FILE);
  const db = await readSnapshots(outputDir);

  for (const snapshot of snapshots) {
    const existing = db[snapshot.fullName] ?? [];
    existing.push(snapshot);
    db[snapshot.fullName] = existing.slice(-45);
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(db, null, 2), 'utf8');
}

export function getLatestSnapshot(db: SnapshotDb, fullName: string): RepoSnapshot | undefined {
  const rows = db[fullName] ?? [];
  return rows[rows.length - 1];
}
