const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const { initDb, getDb } = require("./db");

const sourcePath = path.join(__dirname, "..", "data.sqlite");

const tables = [
  {
    name: "stores",
    conflict: "id",
    sequence: true,
    columns: ["id", "store_name", "email", "cpf_cnpj", "whatsapp", "password_hash", "created_at"]
  },
  {
    name: "raffles",
    conflict: "id",
    sequence: true,
    columns: [
      "id",
      "store_id",
      "title",
      "prize",
      "participants",
      "ends_at",
      "auto_draw_on_end",
      "drawn_at",
      "winner_name",
      "winner_cpf_normalized",
      "draw_trigger",
      "public_token",
      "raffle_image_url",
      "created_at"
    ]
  },
  {
    name: "store_customizations",
    conflict: "id",
    sequence: true,
    columns: [
      "id",
      "store_id",
      "public_modal_title",
      "public_modal_subtitle",
      "brand_primary_color",
      "brand_secondary_color",
      "button_text",
      "logo_url",
      "banner_text",
      "updated_at"
    ]
  },
  {
    name: "raffle_entries",
    conflict: "id",
    sequence: true,
    columns: [
      "id",
      "raffle_id",
      "participant_name",
      "participant_cpf",
      "participant_cpf_normalized",
      "participant_whatsapp",
      "created_at"
    ]
  },
  {
    name: "store_clients",
    conflict: "id",
    sequence: true,
    columns: [
      "id",
      "store_id",
      "participant_name",
      "participant_cpf",
      "participant_cpf_normalized",
      "participant_whatsapp",
      "created_at",
      "updated_at",
      "last_participation_at"
    ]
  },
  {
    name: "store_plans",
    conflict: "id",
    sequence: true,
    columns: [
      "id",
      "store_id",
      "plan_name",
      "plan_status",
      "monthly_price",
      "billing_day",
      "invoice_status",
      "payment_method",
      "invoice_due_at",
      "admin_notes",
      "created_at",
      "updated_at"
    ]
  },
  {
    name: "admin_plan_catalog",
    conflict: "plan_key",
    sequence: false,
    columns: [
      "plan_key",
      "plan_name",
      "monthly_price",
      "raffle_limit",
      "export_clients",
      "description",
      "updated_at"
    ]
  },
  {
    name: "app_settings",
    conflict: "setting_key",
    sequence: false,
    columns: ["setting_key", "setting_value", "updated_at"]
  },
  {
    name: "platform_cities",
    conflict: "id",
    sequence: true,
    columns: ["id", "city_name", "image_url", "sort_order", "is_active", "created_at", "updated_at"]
  },
  {
    name: "admin_payments",
    conflict: "id",
    sequence: true,
    columns: [
      "id",
      "store_id",
      "description",
      "amount_cents",
      "status",
      "method",
      "due_at",
      "paid_at",
      "reference_month",
      "pagbank_reference_id",
      "pagbank_checkout_id",
      "pagbank_payment_id",
      "pagbank_payment_url",
      "pagbank_order_id",
      "pagbank_qr_code_id",
      "pagbank_pix_code",
      "pagbank_qr_code_image_url",
      "pagbank_expires_at",
      "created_at",
      "updated_at"
    ]
  }
];

function buildUpsertSql(table) {
  const placeholders = table.columns.map(() => "?").join(", ");
  const updateColumns = table.columns.filter((column) => column !== table.conflict);
  const updates = updateColumns.map((column) => `${column} = EXCLUDED.${column}`).join(", ");

  return `
    INSERT INTO ${table.name} (${table.columns.join(", ")})
    VALUES (${placeholders})
    ON CONFLICT (${table.conflict}) DO UPDATE SET ${updates}
  `;
}

async function main() {
  if (!process.env.SUPABASE_DB_URL && !process.env.DATABASE_URL) {
    throw new Error("Defina DATABASE_URL ou SUPABASE_DB_URL no .env antes de migrar.");
  }

  await initDb();
  const target = getDb();
  if (target.dialect !== "postgres") {
    throw new Error("A migracao precisa apontar para Supabase/Postgres.");
  }

  const source = await open({ filename: sourcePath, driver: sqlite3.Database });

  for (const table of tables) {
    const rows = await source.all(`SELECT ${table.columns.join(", ")} FROM ${table.name}`);
    const upsertSql = buildUpsertSql(table);

    for (const row of rows) {
      await target.run(upsertSql, table.columns.map((column) => row[column]));
    }

    if (table.sequence) {
      await target.run(
        `
          SELECT setval(
            pg_get_serial_sequence('${table.name}', 'id'),
            COALESCE((SELECT MAX(id) FROM ${table.name}), 1),
            true
          )
        `
      );
    }

    console.log(`${table.name}: ${rows.length} registro(s) migrado(s).`);
  }

  await source.close();
  console.log("Migracao concluida.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
