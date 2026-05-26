const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const { Pool } = require("pg");

let dbInstance = null;

const databaseUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "";
const usePostgres = Boolean(databaseUrl);

function replaceQuestionPlaceholders(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function normalizePostgresSql(sql) {
  let normalized = sql
    .replace(/datetime\('now'\)/g, "NOW()")
    .replace(/datetime\(ends_at\)/g, "ends_at::timestamptz")
    .replace(/datetime\(COALESCE\(([^)]*)\)\)/g, "(COALESCE($1)::timestamptz)")
    .replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, "INSERT INTO");

  if (/^\s*INSERT\s+INTO\s+store_clients\b/i.test(normalized) && !/ON\s+CONFLICT/i.test(normalized)) {
    normalized = `${normalized.trim()} ON CONFLICT DO NOTHING`;
  }

  return replaceQuestionPlaceholders(normalized);
}

class PostgresDb {
  constructor(connectionString) {
    const ssl = process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false };
    this.pool = new Pool({ connectionString, ssl });
    this.dialect = "postgres";
  }

  async query(sql, params = []) {
    return this.pool.query(normalizePostgresSql(sql), params);
  }

  async all(sql, params = []) {
    const result = await this.query(sql, params);
    return result.rows;
  }

  async get(sql, params = []) {
    const result = await this.query(sql, params);
    return result.rows[0] || null;
  }

  async run(sql, params = []) {
    let runnableSql = sql;
    if (/^\s*INSERT\s+INTO\s+(stores|admin_payments)\b/i.test(sql) && !/RETURNING\s+id/i.test(sql)) {
      runnableSql = `${sql.trim()} RETURNING id`;
    }

    try {
      const result = await this.query(runnableSql, params);
      return {
        changes: result.rowCount,
        lastID: result.rows[0]?.id || null
      };
    } catch (error) {
      if (error.code === "23505") {
        error.message = `UNIQUE constraint failed: ${error.detail || "duplicate key"}`;
      }
      throw error;
    }
  }

  async exec(sql) {
    const statements = sql
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await this.query(statement);
    }
  }
}

async function ensureColumn(db, table, columnName, addColumnSql) {
  if (db.dialect === "postgres") {
    const column = await db.get(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ?
          AND column_name = ?
        LIMIT 1
      `,
      [table, columnName]
    );

    if (!column) {
      await db.exec(addColumnSql);
    }
    return;
  }

  const columns = await db.all(`PRAGMA table_info(${table})`);
  const exists = columns.some((column) => column.name === columnName);
  if (!exists) {
    await db.exec(addColumnSql);
  }
}

function getSqliteSchemaSql() {
  return `
    CREATE TABLE IF NOT EXISTS stores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      cpf_cnpj TEXT NOT NULL,
      whatsapp TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS raffles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      prize TEXT NOT NULL,
      participants TEXT NOT NULL DEFAULT '',
      ends_at TEXT NULL,
      auto_draw_on_end INTEGER NOT NULL DEFAULT 0,
      drawn_at TEXT NULL,
      winner_name TEXT NULL,
      winner_cpf_normalized TEXT NOT NULL DEFAULT '',
      draw_trigger TEXT NULL,
      public_token TEXT NULL,
      raffle_image_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS store_customizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL UNIQUE,
      public_modal_title TEXT NOT NULL DEFAULT 'Participe do Sorteio',
      public_modal_subtitle TEXT NOT NULL DEFAULT 'Preencha seus dados e concorra ao premio da loja.',
      brand_primary_color TEXT NOT NULL DEFAULT '#6a3df0',
      brand_secondary_color TEXT NOT NULL DEFAULT '#3b14ba',
      button_text TEXT NOT NULL DEFAULT 'Quero Participar',
      logo_url TEXT NOT NULL DEFAULT '',
      banner_text TEXT NOT NULL DEFAULT 'Sorteio oficial desta loja',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS raffle_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raffle_id INTEGER NOT NULL,
      participant_name TEXT NOT NULL,
      participant_cpf TEXT NOT NULL,
      participant_cpf_normalized TEXT NOT NULL,
      participant_whatsapp TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (raffle_id) REFERENCES raffles (id) ON DELETE CASCADE,
      UNIQUE (raffle_id, participant_cpf_normalized)
    );

    CREATE TABLE IF NOT EXISTS store_clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      participant_name TEXT NOT NULL,
      participant_cpf TEXT NOT NULL,
      participant_cpf_normalized TEXT NOT NULL,
      participant_whatsapp TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_participation_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE,
      UNIQUE (store_id, participant_cpf_normalized)
    );

    CREATE TABLE IF NOT EXISTS store_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL UNIQUE,
      plan_name TEXT NOT NULL DEFAULT 'Sem plano',
      plan_status TEXT NOT NULL DEFAULT 'Pendente',
      monthly_price TEXT NOT NULL DEFAULT 'R$ 0,00',
      billing_day INTEGER NOT NULL DEFAULT 10,
      invoice_status TEXT NOT NULL DEFAULT 'Sem cobranca',
      payment_method TEXT NOT NULL DEFAULT 'Nao configurado',
      invoice_due_at TEXT NULL,
      admin_notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS admin_plan_catalog (
      plan_key TEXT PRIMARY KEY,
      plan_name TEXT NOT NULL,
      monthly_price TEXT NOT NULL DEFAULT 'R$ 0,00',
      raffle_limit INTEGER NOT NULL DEFAULT 0,
      export_clients INTEGER NOT NULL DEFAULT 0,
      description TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS platform_cities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      city_name TEXT NOT NULL,
      image_url TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS admin_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      amount_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Pendente',
      method TEXT NOT NULL DEFAULT 'Nao configurado',
      due_at TEXT NULL,
      paid_at TEXT NULL,
      reference_month TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE CASCADE
    );
  `;
}

function getPostgresSchemaSql() {
  return `
    CREATE TABLE IF NOT EXISTS stores (
      id SERIAL PRIMARY KEY,
      store_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      cpf_cnpj TEXT NOT NULL,
      whatsapp TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    CREATE TABLE IF NOT EXISTS raffles (
      id SERIAL PRIMARY KEY,
      store_id INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      prize TEXT NOT NULL,
      participants TEXT NOT NULL DEFAULT '',
      ends_at TEXT NULL,
      auto_draw_on_end INTEGER NOT NULL DEFAULT 0,
      drawn_at TEXT NULL,
      winner_name TEXT NULL,
      winner_cpf_normalized TEXT NOT NULL DEFAULT '',
      draw_trigger TEXT NULL,
      public_token TEXT NULL,
      raffle_image_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    CREATE TABLE IF NOT EXISTS store_customizations (
      id SERIAL PRIMARY KEY,
      store_id INTEGER NOT NULL UNIQUE REFERENCES stores (id) ON DELETE CASCADE,
      public_modal_title TEXT NOT NULL DEFAULT 'Participe do Sorteio',
      public_modal_subtitle TEXT NOT NULL DEFAULT 'Preencha seus dados e concorra ao premio da loja.',
      brand_primary_color TEXT NOT NULL DEFAULT '#6a3df0',
      brand_secondary_color TEXT NOT NULL DEFAULT '#3b14ba',
      button_text TEXT NOT NULL DEFAULT 'Quero Participar',
      logo_url TEXT NOT NULL DEFAULT '',
      banner_text TEXT NOT NULL DEFAULT 'Sorteio oficial desta loja',
      updated_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    CREATE TABLE IF NOT EXISTS raffle_entries (
      id SERIAL PRIMARY KEY,
      raffle_id INTEGER NOT NULL REFERENCES raffles (id) ON DELETE CASCADE,
      participant_name TEXT NOT NULL,
      participant_cpf TEXT NOT NULL,
      participant_cpf_normalized TEXT NOT NULL,
      participant_whatsapp TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (NOW()::text),
      UNIQUE (raffle_id, participant_cpf_normalized)
    );

    CREATE TABLE IF NOT EXISTS store_clients (
      id SERIAL PRIMARY KEY,
      store_id INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
      participant_name TEXT NOT NULL,
      participant_cpf TEXT NOT NULL,
      participant_cpf_normalized TEXT NOT NULL,
      participant_whatsapp TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (NOW()::text),
      updated_at TEXT NOT NULL DEFAULT (NOW()::text),
      last_participation_at TEXT NOT NULL DEFAULT (NOW()::text),
      UNIQUE (store_id, participant_cpf_normalized)
    );

    CREATE TABLE IF NOT EXISTS store_plans (
      id SERIAL PRIMARY KEY,
      store_id INTEGER NOT NULL UNIQUE REFERENCES stores (id) ON DELETE CASCADE,
      plan_name TEXT NOT NULL DEFAULT 'Sem plano',
      plan_status TEXT NOT NULL DEFAULT 'Pendente',
      monthly_price TEXT NOT NULL DEFAULT 'R$ 0,00',
      billing_day INTEGER NOT NULL DEFAULT 10,
      invoice_status TEXT NOT NULL DEFAULT 'Sem cobranca',
      payment_method TEXT NOT NULL DEFAULT 'Nao configurado',
      invoice_due_at TEXT NULL,
      admin_notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (NOW()::text),
      updated_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    CREATE TABLE IF NOT EXISTS admin_plan_catalog (
      plan_key TEXT PRIMARY KEY,
      plan_name TEXT NOT NULL,
      monthly_price TEXT NOT NULL DEFAULT 'R$ 0,00',
      raffle_limit INTEGER NOT NULL DEFAULT 0,
      export_clients INTEGER NOT NULL DEFAULT 0,
      description TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    CREATE TABLE IF NOT EXISTS platform_cities (
      id SERIAL PRIMARY KEY,
      city_name TEXT NOT NULL,
      image_url TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (NOW()::text),
      updated_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    CREATE TABLE IF NOT EXISTS admin_payments (
      id SERIAL PRIMARY KEY,
      store_id INTEGER NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
      description TEXT NOT NULL DEFAULT '',
      amount_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Pendente',
      method TEXT NOT NULL DEFAULT 'Nao configurado',
      due_at TEXT NULL,
      paid_at TEXT NULL,
      reference_month TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (NOW()::text),
      updated_at TEXT NOT NULL DEFAULT (NOW()::text)
    );
  `;
}

async function seedDefaults(db) {
  await db.run(`
    UPDATE store_plans
    SET plan_name = 'Sem plano',
        plan_status = 'Pendente',
        updated_at = datetime('now')
    WHERE plan_name = 'Plano Inicial'
      AND plan_status = 'Ativo'
      AND monthly_price = 'R$ 0,00'
      AND invoice_status = 'Sem cobranca'
  `);

  await db.run(`
    UPDATE store_plans
    SET plan_name = 'Plano Iniciante',
        updated_at = datetime('now')
    WHERE plan_name = 'Plano Inicial'
  `);

  await db.run(`
    UPDATE store_plans
    SET plan_name = 'Plano LUCK',
        updated_at = datetime('now')
    WHERE plan_name IN ('Plano Pro', 'Plano Premium', 'Plano Enterprise')
  `);

  await db.run(
    `
      INSERT INTO admin_plan_catalog (
        plan_key,
        plan_name,
        monthly_price,
        raffle_limit,
        export_clients,
        description
      )
      VALUES ('iniciante', 'Plano Iniciante', 'R$ 0,00', 2, 0, 'Direito de criar 2 sorteios no total para testar a plataforma.')
      ON CONFLICT(plan_key) DO NOTHING
    `
  );

  await db.run(
    `
      INSERT INTO admin_plan_catalog (
        plan_key,
        plan_name,
        monthly_price,
        raffle_limit,
        export_clients,
        description
      )
      VALUES ('luck', 'Plano LUCK', 'R$ 58,99', 0, 1, 'Sorteios ilimitados e acesso a exportacao de clientes.')
      ON CONFLICT(plan_key) DO NOTHING
    `
  );

  const settingDefaults = [
    ["app_name", "Sortify City"],
    ["hero_kicker", "SORTIFY CITY"],
    ["hero_title", "Sorteios inteligentes para lojas da sua cidade."],
    [
      "hero_text",
      "Mercados, farmacias, lojas de roupa e autopecas: qualquer comercio cria um sorteio profissional em menos de 2 minutos e compartilha direto com os clientes."
    ],
    ["hero_card_one_title", "Local"],
    ["hero_card_one_text", "Feito para o seu comercio"],
    ["hero_card_two_title", "2 min"],
    ["hero_card_two_text", "Do cadastro ao link pronto"],
    ["cities_title", "PRESENTE NAS CIDADES"],
    ["cities_more_label", "+48"],
    ["cities_more_text", "outras cidades"]
  ];

  for (const [settingKey, settingValue] of settingDefaults) {
    await db.run(
      `
        INSERT INTO app_settings (setting_key, setting_value)
        VALUES (?, ?)
        ON CONFLICT(setting_key) DO NOTHING
      `,
      [settingKey, settingValue]
    );
  }

  const cityDefaults = [
    ["Lauro Muller", "/assets/cities/lauro-muller.png", 10],
    ["Braco do Norte", "/assets/cities/braco-do-norte.jpg", 20],
    ["Criciuma", "/assets/cities/criciuma.svg", 30],
    ["Tubarao", "/assets/cities/tubarao.jpg", 40],
    ["Sao Ludgero", "/assets/cities/sao-ludgero.png", 50]
  ];

  for (const [cityName, imageUrl, sortOrder] of cityDefaults) {
    await db.run(
      `
        INSERT INTO platform_cities (city_name, image_url, sort_order)
        SELECT ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM platform_cities WHERE city_name = ?
        )
      `,
      [cityName, imageUrl, sortOrder, cityName]
    );
  }

}

async function createIndexes(db) {
  await db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_raffles_public_token ON raffles (public_token);
    CREATE INDEX IF NOT EXISTS idx_raffles_winner_cpf ON raffles (winner_cpf_normalized);
    CREATE INDEX IF NOT EXISTS idx_raffle_entries_raffle_id ON raffle_entries (raffle_id);
    CREATE INDEX IF NOT EXISTS idx_store_clients_store_id ON store_clients (store_id);
    CREATE INDEX IF NOT EXISTS idx_store_clients_store_cpf ON store_clients (store_id, participant_cpf_normalized);
    CREATE INDEX IF NOT EXISTS idx_store_plans_store_id ON store_plans (store_id);
    CREATE INDEX IF NOT EXISTS idx_admin_payments_store_id ON admin_payments (store_id);
    CREATE INDEX IF NOT EXISTS idx_admin_payments_status ON admin_payments (status);
    CREATE INDEX IF NOT EXISTS idx_admin_payments_due_at ON admin_payments (due_at);
    CREATE INDEX IF NOT EXISTS idx_admin_payments_pagbank_reference ON admin_payments (pagbank_reference_id);
    CREATE INDEX IF NOT EXISTS idx_admin_payments_pagbank_order ON admin_payments (pagbank_order_id);
    CREATE INDEX IF NOT EXISTS idx_admin_plan_catalog_name ON admin_plan_catalog (plan_name);
    CREATE INDEX IF NOT EXISTS idx_platform_cities_active_order ON platform_cities (is_active, sort_order);
  `);
}

async function initDb() {
  if (dbInstance) {
    return dbInstance;
  }

  if (usePostgres) {
    dbInstance = new PostgresDb(databaseUrl);
    await dbInstance.exec(getPostgresSchemaSql());
  } else {
    const sqliteDir = process.env.VERCEL ? "/tmp" : path.join(__dirname, "..");
    dbInstance = await open({
      filename: path.join(sqliteDir, "data.sqlite"),
      driver: sqlite3.Database
    });
    dbInstance.dialect = "sqlite";
    await dbInstance.exec("PRAGMA foreign_keys = ON;");
    await dbInstance.exec(getSqliteSchemaSql());
  }

  await ensureColumn(
    dbInstance,
    "raffles",
    "public_token",
    "ALTER TABLE raffles ADD COLUMN public_token TEXT NULL"
  );

  await ensureColumn(
    dbInstance,
    "raffles",
    "raffle_image_url",
    "ALTER TABLE raffles ADD COLUMN raffle_image_url TEXT NOT NULL DEFAULT ''"
  );

  await ensureColumn(
    dbInstance,
    "raffles",
    "winner_cpf_normalized",
    "ALTER TABLE raffles ADD COLUMN winner_cpf_normalized TEXT NOT NULL DEFAULT ''"
  );

  await ensureColumn(
    dbInstance,
    "store_plans",
    "invoice_due_at",
    "ALTER TABLE store_plans ADD COLUMN invoice_due_at TEXT NULL"
  );

  await ensureColumn(
    dbInstance,
    "store_plans",
    "admin_notes",
    "ALTER TABLE store_plans ADD COLUMN admin_notes TEXT NOT NULL DEFAULT ''"
  );

  await ensureColumn(
    dbInstance,
    "admin_payments",
    "pagbank_reference_id",
    "ALTER TABLE admin_payments ADD COLUMN pagbank_reference_id TEXT NULL"
  );

  await ensureColumn(
    dbInstance,
    "admin_payments",
    "pagbank_checkout_id",
    "ALTER TABLE admin_payments ADD COLUMN pagbank_checkout_id TEXT NULL"
  );

  await ensureColumn(
    dbInstance,
    "admin_payments",
    "pagbank_payment_id",
    "ALTER TABLE admin_payments ADD COLUMN pagbank_payment_id TEXT NULL"
  );

  await ensureColumn(
    dbInstance,
    "admin_payments",
    "pagbank_payment_url",
    "ALTER TABLE admin_payments ADD COLUMN pagbank_payment_url TEXT NULL"
  );

  await ensureColumn(
    dbInstance,
    "admin_payments",
    "pagbank_order_id",
    "ALTER TABLE admin_payments ADD COLUMN pagbank_order_id TEXT NULL"
  );

  await ensureColumn(
    dbInstance,
    "admin_payments",
    "pagbank_qr_code_id",
    "ALTER TABLE admin_payments ADD COLUMN pagbank_qr_code_id TEXT NULL"
  );

  await ensureColumn(
    dbInstance,
    "admin_payments",
    "pagbank_pix_code",
    "ALTER TABLE admin_payments ADD COLUMN pagbank_pix_code TEXT NULL"
  );

  await ensureColumn(
    dbInstance,
    "admin_payments",
    "pagbank_qr_code_image_url",
    "ALTER TABLE admin_payments ADD COLUMN pagbank_qr_code_image_url TEXT NULL"
  );

  await ensureColumn(
    dbInstance,
    "admin_payments",
    "pagbank_expires_at",
    "ALTER TABLE admin_payments ADD COLUMN pagbank_expires_at TEXT NULL"
  );

  await seedDefaults(dbInstance);
  await createIndexes(dbInstance);

  return dbInstance;
}

function getDb() {
  if (!dbInstance) {
    throw new Error("Banco ainda nao inicializado. Chame initDb() primeiro.");
  }
  return dbInstance;
}

module.exports = {
  initDb,
  getDb
};
