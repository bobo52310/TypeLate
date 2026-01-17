import Database from "@tauri-apps/plugin-sql";

export async function tableExists(
  db: Database,
  tableName: string,
): Promise<boolean> {
  const rows = await db.select<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=$1",
    [tableName],
  );
  return rows.length > 0;
}

async function hasColumn(
  db: Database,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const columns = await db.select<{ name: string }[]>(
    `PRAGMA table_info(${tableName})`,
  );
  return columns.some((col) => col.name === columnName);
}

/** Idempotent ADD COLUMN: skips if column already exists to avoid duplicate column errors on retry after crash */
export async function addColumnIfNotExists(
  db: Database,
  tableName: string,
  columnDefinition: string,
): Promise<void> {
  const columnName = columnDefinition.split(/\s+/)[0];
  if (!columnName) {
    throw new Error(
      `[migrations] Invalid columnDefinition: "${columnDefinition}"`,
    );
  }
  if (!(await hasColumn(db, tableName, columnName))) {
    await db.execute(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition};`,
    );
  }
}
