import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from './schema';

const MIGRATION_VERSION = 1;

export function openDatabase(databasePath: string): DatabaseSync {
  if (databasePath !== ':memory:') {
    mkdirSync(path.dirname(databasePath), { recursive: true });
  }
  const database = new DatabaseSync(databasePath);
  migrate(database);
  return database;
}

export function migrate(database: DatabaseSync): void {
  database.exec(SCHEMA_SQL);
  const foreignKeys = database.prepare('PRAGMA foreign_keys').get() as { foreign_keys?: number } | undefined;
  if (Number(foreignKeys?.foreign_keys) !== 1) {
    throw new Error('SQLite foreign_keys не включены');
  }
  const existing = database
    .prepare('SELECT version FROM schema_migrations WHERE version = ?')
    .get(MIGRATION_VERSION);
  if (!existing) {
    database
      .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
      .run(MIGRATION_VERSION, new Date().toISOString());
  }
}

export function withTransaction<T>(database: DatabaseSync, work: () => T): T {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function likeContains(value: string): string {
  const escaped = value.replace(/[\\%_]/gu, (character) => `\\${character}`);
  return `%${escaped}%`;
}
