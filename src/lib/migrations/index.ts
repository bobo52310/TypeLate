import Database from "@tauri-apps/plugin-sql";
import { logInfo } from "@/lib/logger";
import { v1Initial } from "./v1-initial";
import { v2ApiUsage } from "./v2-api-usage";
import { v3VocabularyWeight } from "./v3-vocabulary-weight";
import { v4RecordingStorage } from "./v4-recording-storage";
import { v5HallucinationTerms } from "./v5-hallucination-terms";
import { v6RecalculateCharCount } from "./v6-recalculate-char-count";
import { v7RemoveHallucinationTerms } from "./v7-remove-hallucination-terms";
import { v8ModelTracking } from "./v8-model-tracking";
import { v9TriggerModeDoubleTap } from "./v9-trigger-mode-doubletap";
import { v10VocabularyPrune } from "./v10-vocabulary-prune";

export interface Migration {
  version: number;
  description: string;
  up: (db: Database) => Promise<void>;
}

const migrations: Migration[] = [
  v1Initial,
  v2ApiUsage,
  v3VocabularyWeight,
  v4RecordingStorage,
  v5HallucinationTerms,
  v6RecalculateCharCount,
  v7RemoveHallucinationTerms,
  v8ModelTracking,
  v9TriggerModeDoubleTap,
  v10VocabularyPrune,
];

async function ensureSchemaVersionTable(db: Database): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );
  `);
}

async function getCurrentVersion(db: Database): Promise<number> {
  const rows = await db.select<{ version: number }[]>(
    "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
  );
  return rows[0]?.version ?? 0;
}

export async function runMigrations(db: Database): Promise<void> {
  await ensureSchemaVersionTable(db);

  const currentVersion = await getCurrentVersion(db);

  const pending = migrations.filter((m) => m.version > currentVersion);

  if (pending.length === 0) {
    logInfo("migrations", `Schema is up to date at version ${currentVersion}`);
    return;
  }

  logInfo(
    "migrations",
    `Current version: ${currentVersion}, applying ${pending.length} migration(s)`,
  );

  for (const migration of pending) {
    logInfo("migrations", `Applying v${migration.version}: ${migration.description}`);

    await migration.up(db);

    await db.execute("INSERT OR REPLACE INTO schema_version (version) VALUES ($1);", [
      migration.version,
    ]);

    logInfo("migrations", `Completed v${migration.version}`);
  }

  logInfo(
    "migrations",
    `All migrations applied. Schema version: ${pending[pending.length - 1]?.version}`,
  );
}
