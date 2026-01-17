import Database from "@tauri-apps/plugin-sql";
import { runMigrations } from "./migrations";
import { tableExists } from "./migrations/utils";

let db: Database | null = null;
let initPromise: Promise<Database> | null = null;
let databaseInitError: string | null = null;

export function getDatabaseInitError(): string | null {
  return databaseInitError;
}

export function setDatabaseInitError(error: string): void {
  databaseInitError = error;
}

/**
 * Dashboard 專用：建立連線池 + 執行 migration。
 * 只有 main-window.ts（Dashboard）應呼叫此函式。
 */
export async function initializeDatabase(): Promise<Database> {
  if (db) return db;
  if (initPromise) return initPromise;

  initPromise = doInitializeDatabase();
  try {
    return await initPromise;
  } catch (err) {
    initPromise = null;
    throw err;
  }
}

/**
 * HUD 專用：等待 Dashboard 建好連線池後複用，永不呼叫 Database.load()。
 * Database.load() 會在 Rust 端以 HashMap.insert() 覆蓋既有 Pool，
 * 若 Dashboard 正在用舊 Pool 跑 migration，transaction context 會遺失，
 * 導致 DROP TABLE 等破壞性操作失去 rollback 保護。
 */
export async function connectToDatabase(
  maxRetries = 100,
  retryDelayMs = 100,
): Promise<Database> {
  if (db) return db;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const existing = Database.get("sqlite:app.db");
      await existing.execute("PRAGMA busy_timeout = 5000;");
      await existing.select<{ n: number }[]>("SELECT 1 AS n");
      db = existing;
      console.log("[database] HUD connected to existing database pool");
      return db;
    } catch {
      if (i < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  // Fallback：Dashboard 尚未載入（極罕見），HUD 自行初始化
  console.warn("[database] HUD fallback: initializing database directly");
  return doInitializeDatabase();
}

async function doInitializeDatabase(): Promise<Database> {
  // 使用 local variable，確保只有 schema 全部建立成功才設定 singleton
  const connection = await Database.load("sqlite:app.db");

  await connection.execute("PRAGMA journal_mode = WAL;");
  await connection.execute("PRAGMA synchronous = NORMAL;");
  await connection.execute("PRAGMA busy_timeout = 5000;");

  // Run all schema migrations
  await runMigrations(connection);

  // --- 關鍵表驗證與恢復 ---
  // 先前版本的 migration 可能因連線池覆蓋導致 DROP TABLE 後未 RENAME，
  // 若 api_usage 不存在則以最新 schema 重建（資料已遺失，但 app 可正常運作）
  if (!(await tableExists(connection, "api_usage"))) {
    // 可能有殘留的 api_usage_new（上次 migration 建了但沒 RENAME 成功）
    if (await tableExists(connection, "api_usage_new")) {
      await connection.execute(
        "ALTER TABLE api_usage_new RENAME TO api_usage;",
      );
      console.log("[database] Recovery: renamed api_usage_new → api_usage");
    } else {
      await connection.execute(`
        CREATE TABLE api_usage (
          id TEXT PRIMARY KEY,
          transcription_id TEXT NOT NULL,
          api_type TEXT NOT NULL CHECK(api_type IN ('whisper', 'chat', 'vocabulary_analysis')),
          model TEXT NOT NULL,
          prompt_tokens INTEGER,
          completion_tokens INTEGER,
          total_tokens INTEGER,
          prompt_time_ms REAL,
          completion_time_ms REAL,
          total_time_ms REAL,
          audio_duration_ms INTEGER,
          estimated_cost_ceiling REAL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (transcription_id) REFERENCES transcriptions(id)
        );
      `);
      await connection.execute(`
        CREATE INDEX IF NOT EXISTS idx_api_usage_transcription_id
        ON api_usage(transcription_id);
      `);
      console.log("[database] Recovery: recreated missing api_usage table");
    }
  }

  // 只有全部 schema 建立成功才設定 singleton
  db = connection;
  console.log("[database] SQLite initialized with WAL mode");

  return db;
}

export function getDatabase(): Database {
  if (!db) {
    throw new Error(
      "[database] Database not initialized. Call initializeDatabase() first.",
    );
  }
  return db;
}
