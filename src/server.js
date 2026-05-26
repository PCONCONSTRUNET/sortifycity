const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const SQLiteStoreFactory = require("connect-sqlite3");
const bcrypt = require("bcryptjs");
const multer = require("multer");

const { initDb, getDb } = require("./db");
const {
  createPagBankCheckout,
  createPagBankPixOrder,
  getPagBankOrder,
  getPayLink,
  getQrCodeLink,
  getPagBankConfig,
  isPagBankConfigured
} = require("./pagbank");
const { drawRaffle } = require("./raffleService");

const PORT = process.env.PORT || 3000;
const AUTO_DRAW_CHECK_INTERVAL_MS = 15 * 1000;
const DASHBOARD_TABS = ["dashboard", "sorteios", "sorteados", "clientes", "plano", "customizacao", "configuracoes"];
const ADMIN_TABS = ["dashboard", "financeiro", "clientes", "planos", "assinantes"];
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "pconconstrunet";
const ADMIN_PLAN_NAMES = ["Sem plano", "Plano Iniciante", "Plano LUCK"];
const ADMIN_PLAN_KEYS = ["iniciante", "luck"];
const ADMIN_PLAN_STATUSES = ["Ativo", "Pendente", "Suspenso", "Cancelado", "Teste"];
const ADMIN_INVOICE_STATUSES = ["Sem cobranca", "Pendente", "Pago", "Vencida", "Cancelada"];
const ADMIN_PAYMENT_METHODS = ["Nao configurado", "PagBank", "Pix", "Cartao", "Boleto", "Dinheiro", "Transferencia"];
const SESSION_DIR = process.env.VERCEL ? "/tmp" : path.join(__dirname, "..");
const UPLOADS_DIR = process.env.VERCEL
  ? path.join("/tmp", "uploads")
  : path.join(__dirname, "..", "public", "uploads");

const LOGO_UPLOAD_DIR = path.join(UPLOADS_DIR, "logos");
const LOGO_UPLOAD_MAX_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_LOGO_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/svg+xml"
]);
const RAFFLE_UPLOAD_DIR = path.join(UPLOADS_DIR, "raffles");
const RAFFLE_UPLOAD_MAX_SIZE_BYTES = 8 * 1024 * 1024;
const ALLOWED_RAFFLE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(LOGO_UPLOAD_DIR, { recursive: true });
fs.mkdirSync(RAFFLE_UPLOAD_DIR, { recursive: true });

const app = express();
const SQLiteStore = SQLiteStoreFactory(session);

class DatabaseSessionStore extends session.Store {
  constructor(options = {}) {
    super();
    this.ttlMs = options.ttlMs || 1000 * 60 * 60 * 8;
  }

  get(sid, callback) {
    this.getSession(sid).then((sessionData) => callback(null, sessionData)).catch(callback);
  }

  set(sid, sessionData, callback = () => {}) {
    this.saveSession(sid, sessionData).then(() => callback(null)).catch(callback);
  }

  touch(sid, sessionData, callback = () => {}) {
    this.saveSession(sid, sessionData).then(() => callback(null)).catch(callback);
  }

  destroy(sid, callback = () => {}) {
    getDb()
      .run("DELETE FROM app_sessions WHERE sid = ?", [sid])
      .then(() => callback(null))
      .catch(callback);
  }

  async getSession(sid) {
    const nowIso = new Date().toISOString();
    const row = await getDb().get(
      `
        SELECT data
        FROM app_sessions
        WHERE sid = ?
          AND (expires_at IS NULL OR expires_at > ?)
        LIMIT 1
      `,
      [sid, nowIso]
    );

    if (!row) {
      return null;
    }

    const sessionData = JSON.parse(row.data);
    if (sessionData.cookie?.expires) {
      sessionData.cookie.expires = new Date(sessionData.cookie.expires);
    }

    return sessionData;
  }

  async saveSession(sid, sessionData) {
    const expiresAt = sessionData.cookie?.expires
      ? new Date(sessionData.cookie.expires).toISOString()
      : new Date(Date.now() + this.ttlMs).toISOString();

    await getDb().run(
      `
        INSERT INTO app_sessions (sid, data, expires_at, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(sid) DO UPDATE SET
          data = excluded.data,
          expires_at = excluded.expires_at,
          updated_at = datetime('now')
      `,
      [sid, JSON.stringify(sessionData), expiresAt]
    );
  }
}

function createSessionStore() {
  if (process.env.VERCEL && (process.env.SUPABASE_DB_URL || process.env.DATABASE_URL)) {
    return new DatabaseSessionStore();
  }

  return new SQLiteStore({
    db: "sessions.sqlite",
    dir: SESSION_DIR
  });
}

const logoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      callback(null, LOGO_UPLOAD_DIR);
    },
    filename: (req, file, callback) => {
      const storeId = req.session?.user?.id || "store";
      const rawExt = path.extname(file.originalname || "").toLowerCase();
      const ext = rawExt || ".png";
      const safeExt = ext.replace(/[^a-z0-9.]/g, "") || ".png";
      const fileName = `store-${storeId}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${safeExt}`;
      callback(null, fileName);
    }
  }),
  limits: {
    fileSize: LOGO_UPLOAD_MAX_SIZE_BYTES,
    files: 1
  },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_LOGO_MIME_TYPES.has(file.mimetype)) {
      callback(new Error("TIPO_LOGO_INVALIDO"));
      return;
    }
    callback(null, true);
  }
});

const raffleImageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      callback(null, RAFFLE_UPLOAD_DIR);
    },
    filename: (req, file, callback) => {
      const storeId = req.session?.user?.id || "store";
      const rawExt = path.extname(file.originalname || "").toLowerCase();
      const ext = rawExt || ".png";
      const safeExt = ext.replace(/[^a-z0-9.]/g, "") || ".png";
      const fileName = `raffle-${storeId}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${safeExt}`;
      callback(null, fileName);
    }
  }),
  limits: {
    fileSize: RAFFLE_UPLOAD_MAX_SIZE_BYTES,
    files: 1
  },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_RAFFLE_MIME_TYPES.has(file.mimetype)) {
      callback(new Error("TIPO_IMAGEM_SORTEIO_INVALIDO"));
      return;
    }
    callback(null, true);
  }
});

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));

app.use(express.json({
  verify: (req, _res, buffer) => {
    req.rawBody = buffer.toString("utf8");
  }
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/uploads", express.static(UPLOADS_DIR));

app.use(
  session({
    store: createSessionStore(),
    secret: process.env.SESSION_SECRET || "troque-essa-chave-em-producao",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 8,
      httpOnly: true,
      sameSite: "lax",
      secure: Boolean(process.env.VERCEL)
    }
  })
);

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

function popFlash(req) {
  const flash = req.session.flash || null;
  delete req.session.flash;
  return flash;
}

function setPublicFlash(req, token, type, message) {
  req.session.publicFlash = { token, type, message };
}

function popPublicFlash(req, token) {
  const flash = req.session.publicFlash || null;
  if (flash && flash.token === token) {
    delete req.session.publicFlash;
    return { type: flash.type, message: flash.message };
  }
  return null;
}

function wantsJsonResponse(req) {
  const accept = String(req.get("accept") || "").toLowerCase();
  return req.get("x-requested-with") === "XMLHttpRequest" || accept.includes("application/json");
}

function clearSessionCookie(res) {
  res.clearCookie("connect.sid", { path: "/" });
}

function destroySessionAndRedirect(req, res, redirectPath) {
  clearSessionCookie(res);
  if (!req.session) {
    return res.redirect(redirectPath);
  }

  return req.session.destroy(() => {
    res.redirect(redirectPath);
  });
}

function hasDeviceJoinedRaffle(req, publicToken) {
  if (!req.session || !req.session.publicRaffleEntries) {
    return false;
  }
  return Boolean(req.session.publicRaffleEntries[publicToken]);
}

function markDeviceAsJoinedRaffle(req, publicToken, normalizedCpf) {
  if (!req.session) {
    return;
  }
  if (!req.session.publicRaffleEntries) {
    req.session.publicRaffleEntries = {};
  }

  req.session.publicRaffleEntries[publicToken] = {
    cpf: normalizedCpf,
    joinedAt: new Date().toISOString()
  };
}

function isValidDate(value) {
  if (!value) {
    return false;
  }

  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

function ensureAuth(req, res, next) {
  if (!req.session.user) {
    setFlash(req, "error", "Faca login para acessar o painel.");
    return res.redirect("/");
  }
  next();
}

function ensureAdminAuth(req, res, next) {
  if (!req.session.admin) {
    setFlash(req, "error", "Informe a senha administrativa.");
    return res.redirect("/admin/login");
  }
  next();
}

function resolveDashboardTab(rawTab) {
  const candidate = Array.isArray(rawTab) ? rawTab[0] : rawTab;
  const normalizedTab = String(candidate || "")
    .trim()
    .toLowerCase();

  if (DASHBOARD_TABS.includes(normalizedTab)) {
    return normalizedTab;
  }
  return "dashboard";
}

function dashboardRedirect(tab) {
  return `/dashboard?tab=${resolveDashboardTab(tab)}`;
}

function resolveAdminTab(rawTab) {
  const candidate = Array.isArray(rawTab) ? rawTab[0] : rawTab;
  const normalizedTab = String(candidate || "")
    .trim()
    .toLowerCase();

  if (ADMIN_TABS.includes(normalizedTab)) {
    return normalizedTab;
  }
  return "dashboard";
}

function adminRedirect(tab) {
  return `/admin?tab=${resolveAdminTab(tab)}`;
}

function clampText(value, maxLength) {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

function normalizeHexColor(value, fallback) {
  const raw = String(value || "").trim();
  if (!raw) {
    return fallback;
  }

  const withHash = raw.startsWith("#") ? raw : `#${raw}`;
  if (!/^#[0-9a-fA-F]{6}$/.test(withHash)) {
    return null;
  }

  return withHash.toLowerCase();
}

function toPublicLogoPath(fileName) {
  return `/uploads/logos/${fileName}`;
}

function toPublicRaffleImagePath(fileName) {
  return `/uploads/raffles/${fileName}`;
}

function deleteLocalLogoIfManaged(logoPath) {
  if (!logoPath || typeof logoPath !== "string" || !logoPath.startsWith("/uploads/logos/")) {
    return;
  }

  const fileName = path.basename(logoPath);
  const absolutePath = path.join(LOGO_UPLOAD_DIR, fileName);
  fs.promises.unlink(absolutePath).catch(() => {});
}

function deleteLocalRaffleImageIfManaged(imagePath) {
  if (!imagePath || typeof imagePath !== "string" || !imagePath.startsWith("/uploads/raffles/")) {
    return;
  }

  const fileName = path.basename(imagePath);
  const absolutePath = path.join(RAFFLE_UPLOAD_DIR, fileName);
  fs.promises.unlink(absolutePath).catch(() => {});
}

function runLogoUpload(req, res) {
  return new Promise((resolve, reject) => {
    logoUpload.single("logo_file")(req, res, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function runRaffleImageUpload(req, res) {
  return new Promise((resolve, reject) => {
    raffleImageUpload.single("raffle_image_file")(req, res, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function normalizeCpf(value) {
  return String(value || "").replace(/\D/g, "");
}

function formatDatePtBr(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "--";
  }

  return date.toLocaleDateString("pt-BR");
}

function getNextDueDate(billingDay) {
  const now = new Date();
  const safeDay = Math.min(Math.max(Number(billingDay) || 10, 1), 28);
  const dueDate = new Date(now.getFullYear(), now.getMonth(), safeDay);

  if (dueDate < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
    dueDate.setMonth(dueDate.getMonth() + 1);
  }

  return dueDate;
}

function parseDateOnly(value) {
  const raw = String(value || "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }

  return date;
}

function formatDateInput(value) {
  const date = value instanceof Date ? value : parseDateOnly(value);

  if (!date) {
    return "";
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDateLabel(value) {
  const date = value instanceof Date ? value : parseDateOnly(value);
  return formatDatePtBr(date);
}

function addDays(date, days) {
  const result = new Date(date.getTime());
  result.setDate(result.getDate() + days);
  return result;
}

function addHours(date, hours) {
  const result = new Date(date.getTime());
  result.setHours(result.getHours() + hours);
  return result;
}

function todayAtNoon() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
}

function isBeforeToday(value) {
  const date = parseDateOnly(value);
  return Boolean(date && date < todayAtNoon());
}

function normalizeChoice(value, allowedValues, fallback) {
  const raw = String(value || "").trim();
  return allowedValues.includes(raw) ? raw : fallback;
}

function parseMoneyToCents(value) {
  const raw = String(value || "").trim();

  if (!raw) {
    return 0;
  }

  const normalized = raw
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const amount = Number(normalized);

  if (!Number.isFinite(amount)) {
    return 0;
  }

  return Math.max(0, Math.round(amount * 100));
}

function formatMoneyFromCents(cents) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format((Number(cents) || 0) / 100);
}

function normalizeMoneyText(value) {
  const cents = parseMoneyToCents(value);
  return formatMoneyFromCents(cents);
}

function getPublicBaseUrl(req) {
  return String(process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
}

function buildPagBankReference(storeId) {
  return `CS-${storeId}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`.slice(0, 64);
}

function normalizeDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizePhoneForPagBank(value) {
  let digits = normalizeDigits(value);
  if (digits.length > 11 && digits.startsWith("55")) {
    digits = digits.slice(2);
  }

  if (digits.length < 10) {
    return null;
  }

  return {
    country: "55",
    area: digits.slice(0, 2),
    number: digits.slice(2, 11),
    type: "MOBILE"
  };
}

function buildPagBankCustomer(store) {
  const taxId = normalizeDigits(store?.cpf_cnpj);
  if (![11, 14].includes(taxId.length)) {
    throw new Error("Atualize o CPF/CNPJ da loja antes de pagar com Pix.");
  }

  const customer = {
    name: clampText(store.store_name, 100) || "Cliente CitySorteios",
    email: clampText(store.email, 150),
    tax_id: taxId
  };
  const phone = normalizePhoneForPagBank(store.whatsapp);
  if (phone) {
    customer.phones = [phone];
  }

  return customer;
}

function extractPagBankQrCode(order) {
  return order?.qr_codes?.[0] || order?.qr_code?.[0] || null;
}

function buildPaymentResponse(payment) {
  return {
    id: payment.id,
    status: payment.status,
    method: payment.method,
    amount: formatMoneyFromCents(payment.amount_cents),
    description: payment.description,
    pixCode: payment.pagbank_pix_code || "",
    qrCodeImageUrl: payment.pagbank_qr_code_image_url || "",
    expiresAt: payment.pagbank_expires_at || "",
    paymentUrl: payment.pagbank_payment_url || ""
  };
}

function normalizePagBankPaymentMethod(type) {
  const normalizedType = String(type || "").toUpperCase();
  if (normalizedType === "PIX") {
    return "Pix";
  }
  if (normalizedType === "BOLETO") {
    return "Boleto";
  }
  if (normalizedType.includes("CARD")) {
    return "Cartao";
  }
  return "PagBank";
}

function mapPagBankStatus(status) {
  const normalizedStatus = String(status || "").toUpperCase();
  if (["PAID", "AUTHORIZED", "AVAILABLE"].includes(normalizedStatus)) {
    return "Pago";
  }
  if (["CANCELED", "CANCELLED", "DECLINED", "FAILED"].includes(normalizedStatus)) {
    return "Cancelada";
  }
  if (["OVERDUE", "EXPIRED"].includes(normalizedStatus)) {
    return "Vencida";
  }
  return "Pendente";
}

function extractPagBankReference(payload) {
  return (
    payload?.reference_id ||
    payload?.reference ||
    payload?.metadata?.reference_id ||
    payload?.charges?.[0]?.reference_id ||
    payload?.charges?.[0]?.metadata?.reference_id ||
    ""
  );
}

function extractPagBankPaymentId(payload) {
  return payload?.id || payload?.charges?.[0]?.id || payload?.payment?.id || "";
}

function extractPagBankOrderId(payload) {
  const id = String(payload?.id || payload?.order?.id || "").trim();
  return id.startsWith("ORDE_") ? id : "";
}

function extractPagBankStatus(payload) {
  return payload?.charges?.[0]?.status || payload?.payment?.status || payload?.status || "";
}

function extractPagBankMethod(payload) {
  return (
    payload?.payment_method?.type ||
    payload?.charges?.[0]?.payment_method?.type ||
    payload?.payment?.payment_method?.type ||
    ""
  );
}

function verifyPagBankSignature(req) {
  const signature = String(req.get("x-authenticity-token") || "").trim();
  const token = getPagBankConfig().token;

  if (!signature || !token || !req.rawBody) {
    return false;
  }

  const expected = crypto
    .createHash("sha256")
    .update(`${token}-${req.rawBody}`)
    .digest("hex");

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  return signatureBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
}

async function updateStorePlanAfterPayment(db, payment, method) {
  const currentPlan = await db.get("SELECT * FROM store_plans WHERE store_id = ?", [payment.store_id]);
  if (!currentPlan) {
    return;
  }

  const currentDueDate = getPlanDueDate(currentPlan);
  const baseDate = currentDueDate < todayAtNoon() ? todayAtNoon() : currentDueDate;
  const nextDueDate = addDays(baseDate, 30);

  await db.run(
    `
      UPDATE store_plans
      SET plan_status = 'Ativo',
          invoice_status = 'Pago',
          payment_method = ?,
          invoice_due_at = ?,
          updated_at = datetime('now')
      WHERE store_id = ?
    `,
    [method, formatDateInput(nextDueDate), payment.store_id]
  );
}

async function applyPagBankPaymentUpdate(db, payment, payload) {
  const rawStatus = extractPagBankStatus(payload);
  const status = rawStatus ? mapPagBankStatus(rawStatus) : payment.status || "Pendente";
  const methodRaw = extractPagBankMethod(payload);
  const method = methodRaw ? normalizePagBankPaymentMethod(methodRaw) : payment.method || "PagBank";
  const paymentId = extractPagBankPaymentId(payload);
  const orderId = extractPagBankOrderId(payload);
  const paidAt = status === "Pago" ? formatDateInput(todayAtNoon()) : payment.paid_at;

  await db.run(
    `
      UPDATE admin_payments
      SET status = ?,
          method = ?,
          paid_at = ?,
          pagbank_payment_id = COALESCE(NULLIF(?, ''), pagbank_payment_id),
          pagbank_order_id = COALESCE(NULLIF(?, ''), pagbank_order_id),
          updated_at = datetime('now')
      WHERE id = ?
    `,
    [status, method, paidAt || null, paymentId, orderId, payment.id]
  );

  if (status === "Pago") {
    await updateStorePlanAfterPayment(db, payment, method);
  }

  return {
    ...payment,
    status,
    method,
    paid_at: paidAt || null,
    pagbank_payment_id: paymentId || payment.pagbank_payment_id,
    pagbank_order_id: orderId || payment.pagbank_order_id
  };
}

async function refreshPagBankPayment(db, payment) {
  if (!payment?.pagbank_order_id || !isPagBankConfigured()) {
    return payment;
  }

  try {
    const order = await getPagBankOrder(payment.pagbank_order_id);
    return applyPagBankPaymentUpdate(db, payment, order);
  } catch (_error) {
    return payment;
  }
}

function getMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthLabel(monthKey) {
  const [year, month] = String(monthKey || "").split("-").map(Number);
  if (!year || !month) {
    return "--";
  }

  return new Date(year, month - 1, 1).toLocaleDateString("pt-BR", {
    month: "short"
  });
}

function getPlanDueDate(plan) {
  return parseDateOnly(plan?.invoice_due_at) || getNextDueDate(plan?.billing_day);
}

function isPlanActive(plan) {
  return plan?.plan_status === "Ativo" && plan?.plan_name !== "Sem plano";
}

async function getAdminPlanCatalog(db) {
  const rows = await db.all(
    `
      SELECT *
      FROM admin_plan_catalog
      WHERE plan_key IN ('iniciante', 'luck')
      ORDER BY CASE plan_key WHEN 'iniciante' THEN 1 WHEN 'luck' THEN 2 ELSE 3 END
    `
  );
  const byKey = new Map(rows.map((row) => [row.plan_key, row]));
  const defaults = {
    iniciante: {
      plan_key: "iniciante",
      plan_name: "Plano Iniciante",
      monthly_price: "R$ 0,00",
      raffle_limit: 2,
      export_clients: 0,
      description: "Direito de criar 2 sorteios no total para testar a plataforma."
    },
    luck: {
      plan_key: "luck",
      plan_name: "Plano LUCK",
      monthly_price: "R$ 58,99",
      raffle_limit: 0,
      export_clients: 1,
      description: "Sorteios ilimitados e acesso a exportacao de clientes."
    }
  };

  return ADMIN_PLAN_KEYS.map((planKey) => {
    const row = byKey.get(planKey) || defaults[planKey];
    return {
      ...row,
      raffle_limit: Number(row.raffle_limit || 0),
      export_clients: Number(row.export_clients || 0),
      unlimitedRaffles: Number(row.raffle_limit || 0) <= 0,
      raffleLimitLabel: Number(row.raffle_limit || 0) <= 0 ? "Ilimitados" : `${Number(row.raffle_limit || 0)} no total`,
      exportClientsLabel: Number(row.export_clients || 0) ? "Liberado" : "Bloqueado"
    };
  });
}

function findCatalogPlanForStorePlan(planCatalog, planName) {
  return planCatalog.find((catalogPlan) => catalogPlan.plan_name === planName) || null;
}

async function getPublicLandingData(db) {
  const settingsRows = await db.all("SELECT setting_key, setting_value FROM app_settings");
  const settings = Object.fromEntries(
    settingsRows.map((row) => [row.setting_key, row.setting_value])
  );
  const cities = await db.all(
    `
      SELECT city_name, image_url
      FROM platform_cities
      WHERE is_active = 1
      ORDER BY sort_order ASC, city_name ASC
    `
  );

  return {
    appName: settings.app_name || "Sortify City",
    heroKicker: settings.hero_kicker || "SORTIFY CITY",
    heroTitle: settings.hero_title || "Sorteios inteligentes para lojas da sua cidade.",
    heroText: settings.hero_text || "",
    heroCards: [
      {
        title: settings.hero_card_one_title || "Local",
        text: settings.hero_card_one_text || "Feito para o seu comercio"
      },
      {
        title: settings.hero_card_two_title || "2 min",
        text: settings.hero_card_two_text || "Do cadastro ao link pronto"
      }
    ],
    citiesTitle: settings.cities_title || "PRESENTE NAS CIDADES",
    citiesMoreLabel: settings.cities_more_label || "+48",
    citiesMoreText: settings.cities_more_text || "outras cidades",
    cities
  };
}

function generatePublicToken() {
  return crypto.randomBytes(12).toString("hex");
}

async function createUniqueRafflePublicToken(db) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const token = generatePublicToken();
    const existing = await db.get("SELECT id FROM raffles WHERE public_token = ?", [token]);
    if (!existing) {
      return token;
    }
  }

  return `${Date.now().toString(36)}${crypto.randomBytes(8).toString("hex")}`;
}

async function ensureStoreRaffleTokens(db, storeId) {
  const missingTokenRaffles = await db.all(
    `
      SELECT id
      FROM raffles
      WHERE store_id = ? AND (public_token IS NULL OR public_token = '')
    `,
    [storeId]
  );

  for (const raffle of missingTokenRaffles) {
    const token = await createUniqueRafflePublicToken(db);
    await db.run(
      `
        UPDATE raffles
        SET public_token = ?
        WHERE id = ?
      `,
      [token, raffle.id]
    );
  }
}

async function getStoreCustomization(db, storeId) {
  let customization = await db.get(
    `
      SELECT *
      FROM store_customizations
      WHERE store_id = ?
    `,
    [storeId]
  );

  if (!customization) {
    await db.run(
      `
        INSERT INTO store_customizations (store_id)
        VALUES (?)
      `,
      [storeId]
    );

    customization = await db.get(
      `
        SELECT *
        FROM store_customizations
        WHERE store_id = ?
      `,
      [storeId]
    );
  }

  return customization;
}

async function getStorePlan(db, store) {
  let plan = await db.get(
    `
      SELECT *
      FROM store_plans
      WHERE store_id = ?
    `,
    [store.id]
  );

  if (!plan) {
    const createdAt = new Date(store.created_at || Date.now());
    const billingDay = Number.isNaN(createdAt.getTime()) ? 10 : Math.min(Math.max(createdAt.getDate(), 1), 28);

    await db.run(
      `
        INSERT INTO store_plans (store_id, plan_name, plan_status, billing_day)
        VALUES (?, 'Plano Iniciante', 'Ativo', ?)
      `,
      [store.id, billingDay]
    );

    plan = await db.get(
      `
        SELECT *
        FROM store_plans
        WHERE store_id = ?
      `,
      [store.id]
    );
  }

  const nextDueDate = getPlanDueDate(plan);
  const planCatalog = await getAdminPlanCatalog(db);
  const catalogPlan = findCatalogPlanForStorePlan(planCatalog, plan.plan_name);
  const invoiceMonth = nextDueDate.toLocaleDateString("pt-BR", {
    month: "2-digit",
    year: "numeric"
  });

  return {
    ...plan,
    catalogPlan,
    amountCents: parseMoneyToCents(plan.monthly_price),
    raffleLimit: catalogPlan ? catalogPlan.raffle_limit : 0,
    raffleLimitLabel: catalogPlan ? catalogPlan.raffleLimitLabel : "Sem limite configurado",
    canExportClients: Boolean(catalogPlan && catalogPlan.export_clients && isPlanActive(plan)),
    planDescription: catalogPlan?.description || "",
    invoice_due_at: formatDateInput(nextDueDate),
    nextDueDate: formatDatePtBr(nextDueDate),
    invoiceReference: invoiceMonth,
    invoiceNumber: `CS-${store.id}-${String(nextDueDate.getFullYear())}${String(nextDueDate.getMonth() + 1).padStart(2, "0")}`
  };
}

async function getPublicRaffleByToken(db, token) {
  return db.get(
    `
      SELECT
        r.*,
        s.store_name,
        COALESCE(sc.public_modal_title, 'Participe do Sorteio') AS public_modal_title,
        COALESCE(sc.public_modal_subtitle, 'Preencha seus dados e concorra ao premio da loja.') AS public_modal_subtitle,
        COALESCE(sc.brand_primary_color, '#6a3df0') AS brand_primary_color,
        COALESCE(sc.brand_secondary_color, '#3b14ba') AS brand_secondary_color,
        COALESCE(sc.button_text, 'Quero Participar') AS button_text,
        COALESCE(sc.logo_url, '') AS logo_url,
        COALESCE(sc.banner_text, 'Sorteio oficial desta loja') AS banner_text
      FROM raffles r
      INNER JOIN stores s ON s.id = r.store_id
      LEFT JOIN store_customizations sc ON sc.store_id = s.id
      WHERE r.public_token = ?
      LIMIT 1
    `,
    [token]
  );
}

async function syncStoreClientsFromRaffleEntries(db, storeId) {
  await db.run(
    `
      INSERT OR IGNORE INTO store_clients (
        store_id,
        participant_name,
        participant_cpf,
        participant_cpf_normalized,
        participant_whatsapp,
        created_at,
        updated_at,
        last_participation_at
      )
      SELECT
        r.store_id,
        re.participant_name,
        re.participant_cpf,
        re.participant_cpf_normalized,
        re.participant_whatsapp,
        re.created_at,
        datetime('now'),
        re.created_at
      FROM raffle_entries re
      INNER JOIN raffles r ON r.id = re.raffle_id
      WHERE r.store_id = ?
    `,
    [storeId]
  );
}

async function registerStoreClient(db, { storeId, participantName, participantCpf, normalizedCpf, participantWhatsapp }) {
  await db.run(
    `
      INSERT INTO store_clients (
        store_id,
        participant_name,
        participant_cpf,
        participant_cpf_normalized,
        participant_whatsapp,
        created_at,
        updated_at,
        last_participation_at
      )
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))
      ON CONFLICT(store_id, participant_cpf_normalized) DO UPDATE SET
        participant_name = excluded.participant_name,
        participant_cpf = excluded.participant_cpf,
        participant_whatsapp = excluded.participant_whatsapp,
        updated_at = datetime('now'),
        last_participation_at = excluded.last_participation_at
    `,
    [storeId, participantName, participantCpf, normalizedCpf, participantWhatsapp]
  );
}

async function getStoreClients(db, storeId) {
  return db.all(
    `
      SELECT
        c.*,
        COALESCE(stats.total_entries, 0) AS total_entries,
        COALESCE(stats.last_entry_at, c.last_participation_at, c.updated_at, c.created_at) AS last_entry_at
      FROM store_clients c
      LEFT JOIN (
        SELECT
          re.participant_cpf_normalized,
          COUNT(*) AS total_entries,
          MAX(re.created_at) AS last_entry_at
        FROM raffle_entries re
        INNER JOIN raffles r ON r.id = re.raffle_id
        WHERE r.store_id = ?
        GROUP BY re.participant_cpf_normalized
      ) stats ON stats.participant_cpf_normalized = c.participant_cpf_normalized
      WHERE c.store_id = ?
      ORDER BY COALESCE(stats.last_entry_at, c.last_participation_at, c.updated_at, c.created_at) DESC, c.id DESC
    `,
    [storeId, storeId]
  );
}

async function getStoreClientDetails(db, storeId, clientId) {
  const client = await db.get(
    `
      SELECT
        c.*,
        COALESCE(stats.total_entries, 0) AS total_entries,
        COALESCE(stats.last_entry_at, c.last_participation_at, c.updated_at, c.created_at) AS last_entry_at
      FROM store_clients c
      LEFT JOIN (
        SELECT
          re.participant_cpf_normalized,
          COUNT(*) AS total_entries,
          MAX(re.created_at) AS last_entry_at
        FROM raffle_entries re
        INNER JOIN raffles r ON r.id = re.raffle_id
        WHERE r.store_id = ?
        GROUP BY re.participant_cpf_normalized
      ) stats ON stats.participant_cpf_normalized = c.participant_cpf_normalized
      WHERE c.store_id = ? AND c.id = ?
      LIMIT 1
    `,
    [storeId, storeId, clientId]
  );

  if (!client) {
    return null;
  }

  const participations = await db.all(
    `
      SELECT
        r.id,
        r.title,
        r.prize,
        r.drawn_at,
        r.winner_name,
        r.public_token,
        re.created_at AS participated_at
      FROM raffle_entries re
      INNER JOIN raffles r ON r.id = re.raffle_id
      WHERE r.store_id = ? AND re.participant_cpf_normalized = ?
      ORDER BY re.created_at DESC, r.id DESC
    `,
    [storeId, client.participant_cpf_normalized]
  );

  const wins = await db.all(
    `
      SELECT
        id,
        title,
        prize,
        drawn_at,
        draw_trigger,
        public_token
      FROM raffles
      WHERE store_id = ?
        AND drawn_at IS NOT NULL
        AND (
          winner_cpf_normalized = ?
          OR (
            COALESCE(winner_cpf_normalized, '') = ''
            AND LOWER(TRIM(winner_name)) = LOWER(TRIM(?))
          )
        )
      ORDER BY drawn_at DESC, id DESC
    `,
    [storeId, client.participant_cpf_normalized, client.participant_name]
  );

  return {
    client,
    participations,
    wins
  };
}

function safeSpreadsheetValue(value) {
  const text = String(value ?? "");
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function escapeCsvCell(value) {
  const text = safeSpreadsheetValue(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function escapeHtml(value) {
  return safeSpreadsheetValue(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function ensureAdminStoreArtifacts(db) {
  const stores = await db.all(
    `
      SELECT id, store_name, created_at
      FROM stores
      ORDER BY id ASC
    `
  );

  for (const store of stores) {
    await getStorePlan(db, store);
    await syncStoreClientsFromRaffleEntries(db, store.id);
  }

  return stores;
}

async function getAdminStoreRows(db) {
  await ensureAdminStoreArtifacts(db);

  const rows = await db.all(
    `
      SELECT
        s.id,
        s.store_name,
        s.email,
        s.cpf_cnpj,
        s.whatsapp,
        s.created_at,
        COALESCE(sp.plan_name, 'Sem plano') AS plan_name,
        COALESCE(sp.plan_status, 'Pendente') AS plan_status,
        COALESCE(sp.monthly_price, 'R$ 0,00') AS monthly_price,
        COALESCE(sp.billing_day, 10) AS billing_day,
        COALESCE(sp.invoice_status, 'Sem cobranca') AS invoice_status,
        COALESCE(sp.payment_method, 'Nao configurado') AS payment_method,
        sp.invoice_due_at,
        COALESCE(sp.admin_notes, '') AS admin_notes,
        COALESCE(rs.total_raffles, 0) AS total_raffles,
        COALESCE(rs.active_raffles, 0) AS active_raffles,
        COALESCE(rs.drawn_raffles, 0) AS drawn_raffles,
        COALESCE(es.participant_entries, 0) AS participant_entries,
        COALESCE(cs.total_clients, 0) AS total_clients,
        COALESCE(ps.payments_count, 0) AS payments_count,
        COALESCE(ps.paid_cents, 0) AS paid_cents
      FROM stores s
      LEFT JOIN store_plans sp ON sp.store_id = s.id
      LEFT JOIN (
        SELECT
          store_id,
          COUNT(*) AS total_raffles,
          SUM(CASE WHEN drawn_at IS NULL THEN 1 ELSE 0 END) AS active_raffles,
          SUM(CASE WHEN drawn_at IS NOT NULL THEN 1 ELSE 0 END) AS drawn_raffles
        FROM raffles
        GROUP BY store_id
      ) rs ON rs.store_id = s.id
      LEFT JOIN (
        SELECT
          r.store_id,
          COUNT(re.id) AS participant_entries
        FROM raffle_entries re
        INNER JOIN raffles r ON r.id = re.raffle_id
        GROUP BY r.store_id
      ) es ON es.store_id = s.id
      LEFT JOIN (
        SELECT
          store_id,
          COUNT(*) AS total_clients
        FROM store_clients
        GROUP BY store_id
      ) cs ON cs.store_id = s.id
      LEFT JOIN (
        SELECT
          store_id,
          COUNT(*) AS payments_count,
          SUM(CASE WHEN status = 'Pago' THEN amount_cents ELSE 0 END) AS paid_cents
        FROM admin_payments
        GROUP BY store_id
      ) ps ON ps.store_id = s.id
      ORDER BY datetime(s.created_at) DESC, s.id DESC
    `
  );

  return rows.map((row) => {
    const dueDate = getPlanDueDate(row);
    const dueInput = formatDateInput(dueDate);
    const monthlyPriceCents = parseMoneyToCents(row.monthly_price);
    const subscriptionActive = isPlanActive(row);
    const invoiceOverdue =
      !["Pago", "Cancelada", "Sem cobranca"].includes(row.invoice_status) && isBeforeToday(dueInput);

    return {
      ...row,
      active_raffles: Number(row.active_raffles || 0),
      drawn_raffles: Number(row.drawn_raffles || 0),
      paid_cents: Number(row.paid_cents || 0),
      participant_entries: Number(row.participant_entries || 0),
      payments_count: Number(row.payments_count || 0),
      total_clients: Number(row.total_clients || 0),
      total_raffles: Number(row.total_raffles || 0),
      monthlyPriceCents,
      monthlyPriceDisplay: row.monthly_price || formatMoneyFromCents(monthlyPriceCents),
      paidDisplay: formatMoneyFromCents(row.paid_cents),
      invoiceDueInput: dueInput,
      invoiceDueLabel: formatDateLabel(dueDate),
      subscriptionActive,
      invoiceOverdue,
      createdAtLabel: formatDateLabel(row.created_at)
    };
  });
}

async function getAdminPaymentRows(db) {
  const rows = await db.all(
    `
      SELECT
        p.*,
        s.store_name,
        s.email
      FROM admin_payments p
      INNER JOIN stores s ON s.id = p.store_id
      ORDER BY datetime(COALESCE(p.paid_at, p.due_at, p.created_at)) DESC, p.id DESC
    `
  );

  return rows.map((row) => ({
    ...row,
    amount_cents: Number(row.amount_cents || 0),
    amountDisplay: formatMoneyFromCents(row.amount_cents),
    dueLabel: formatDateLabel(row.due_at),
    paidLabel: formatDateLabel(row.paid_at),
    createdAtLabel: formatDateLabel(row.created_at),
    periodDate: parseDateOnly(row.paid_at) || parseDateOnly(row.due_at) || parseDateOnly(row.created_at) || todayAtNoon(),
    isOverdue: row.status !== "Pago" && row.status !== "Cancelada" && isBeforeToday(row.due_at)
  }));
}

function getAdminFinanceFilters(query) {
  const statusOptions = ["all", ...ADMIN_INVOICE_STATUSES.filter((status) => status !== "Sem cobranca")];
  const periodOptions = ["all", "current_month", "previous_month", "overdue"];
  const status = normalizeChoice(query.status, statusOptions, "all");
  const period = normalizeChoice(query.period, periodOptions, "all");
  const storeId = Number(query.store_id || 0);

  return {
    status,
    period,
    storeId: Number.isFinite(storeId) ? storeId : 0
  };
}

function filterAdminPayments(payments, filters) {
  const now = todayAtNoon();
  const currentMonthKey = getMonthKey(now);
  const previousMonthKey = getMonthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));

  return payments.filter((payment) => {
    if (filters.status !== "all" && payment.status !== filters.status) {
      return false;
    }

    if (filters.storeId && Number(payment.store_id) !== filters.storeId) {
      return false;
    }

    if (filters.period === "current_month" && getMonthKey(payment.periodDate) !== currentMonthKey) {
      return false;
    }

    if (filters.period === "previous_month" && getMonthKey(payment.periodDate) !== previousMonthKey) {
      return false;
    }

    if (filters.period === "overdue" && !payment.isOverdue) {
      return false;
    }

    return true;
  });
}

function buildFinanceChart(payments, monthlyRecurringRevenueCents) {
  const now = todayAtNoon();
  const columns = [];

  for (let index = 5; index >= 0; index -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    const monthKey = getMonthKey(date);
    columns.push({
      monthKey,
      label: getMonthLabel(monthKey),
      receivedCents: 0,
      openCents: 0
    });
  }

  const columnByMonth = new Map(columns.map((column) => [column.monthKey, column]));

  payments.forEach((payment) => {
    const monthKey = getMonthKey(payment.periodDate);
    const column = columnByMonth.get(monthKey);

    if (!column) {
      return;
    }

    if (payment.status === "Pago") {
      column.receivedCents += payment.amount_cents;
      return;
    }

    if (payment.status !== "Cancelada") {
      column.openCents += payment.amount_cents;
    }
  });

  const hasChartValue = columns.some((column) => column.receivedCents || column.openCents);
  if (!hasChartValue && monthlyRecurringRevenueCents > 0) {
    columns[columns.length - 1].openCents = monthlyRecurringRevenueCents;
  }

  const maxTotal = Math.max(
    1,
    ...columns.map((column) => column.receivedCents + column.openCents)
  );

  return {
    columns: columns.map((column) => ({
      ...column,
      totalDisplay: formatMoneyFromCents(column.receivedCents + column.openCents),
      receivedDisplay: formatMoneyFromCents(column.receivedCents),
      openDisplay: formatMoneyFromCents(column.openCents),
      receivedPercent: Math.round((column.receivedCents / maxTotal) * 100),
      openPercent: Math.round((column.openCents / maxTotal) * 100)
    }))
  };
}

function buildAdminStats(stores, payments) {
  const now = todayAtNoon();
  const thirtyDaysAgo = addDays(now, -30);
  const activeSubscriptions = stores.filter((store) => store.subscriptionActive);
  const monthlyRecurringRevenueCents = activeSubscriptions.reduce(
    (sum, store) => sum + store.monthlyPriceCents,
    0
  );
  const receivedCents = payments
    .filter((payment) => payment.status === "Pago")
    .reduce((sum, payment) => sum + payment.amount_cents, 0);
  const openCents = payments
    .filter((payment) => !["Pago", "Cancelada"].includes(payment.status))
    .reduce((sum, payment) => sum + payment.amount_cents, 0);
  const overdueCents = payments
    .filter((payment) => payment.isOverdue)
    .reduce((sum, payment) => sum + payment.amount_cents, 0);
  const newStores30Days = stores.filter((store) => {
    const createdAt = parseDateOnly(store.created_at);
    return createdAt && createdAt >= thirtyDaysAgo;
  }).length;

  return {
    totalStores: stores.length,
    activeSubscriptions: activeSubscriptions.length,
    inactiveSubscriptions: stores.length - activeSubscriptions.length,
    monthlyRecurringRevenue: formatMoneyFromCents(monthlyRecurringRevenueCents),
    monthlyRecurringRevenueCents,
    overdueInvoices: stores.filter((store) => store.invoiceOverdue).length,
    totalRaffles: stores.reduce((sum, store) => sum + store.total_raffles, 0),
    totalParticipants: stores.reduce((sum, store) => sum + store.participant_entries, 0),
    newStores30Days,
    receivedCents,
    receivedDisplay: formatMoneyFromCents(receivedCents),
    openCents,
    openDisplay: formatMoneyFromCents(openCents),
    overdueCents,
    overdueDisplay: formatMoneyFromCents(overdueCents)
  };
}

function buildAdminFinanceStats(stores, payments, filters) {
  const activeStores = stores.filter((store) => {
    if (filters.storeId && Number(store.id) !== filters.storeId) {
      return false;
    }

    return store.subscriptionActive;
  });
  const monthlyRecurringRevenueCents = activeStores.reduce(
    (sum, store) => sum + store.monthlyPriceCents,
    0
  );
  const receivedCents = payments
    .filter((payment) => payment.status === "Pago")
    .reduce((sum, payment) => sum + payment.amount_cents, 0);
  const openCents = payments
    .filter((payment) => !["Pago", "Cancelada"].includes(payment.status))
    .reduce((sum, payment) => sum + payment.amount_cents, 0);
  const overdueCents = payments
    .filter((payment) => payment.isOverdue)
    .reduce((sum, payment) => sum + payment.amount_cents, 0);

  return {
    monthlyRecurringRevenue: formatMoneyFromCents(monthlyRecurringRevenueCents),
    monthlyRecurringRevenueCents,
    receivedCents,
    receivedDisplay: formatMoneyFromCents(receivedCents),
    openCents,
    openDisplay: formatMoneyFromCents(openCents),
    overdueCents,
    overdueDisplay: formatMoneyFromCents(overdueCents)
  };
}

app.get("/admin/login", (req, res) => {
  if (req.session.admin) {
    return res.redirect("/admin");
  }

  return res.render("admin-login", {
    flash: popFlash(req)
  });
});

app.post("/admin/login", (req, res) => {
  const password = String(req.body.password || "");

  if (password !== ADMIN_PASSWORD) {
    setFlash(req, "error", "Senha administrativa invalida.");
    return res.redirect("/admin/login");
  }

  req.session.admin = {
    signedInAt: new Date().toISOString()
  };

  setFlash(req, "success", "Area administrativa liberada.");
  return res.redirect("/admin");
});

app.post("/admin/logout", (req, res) => {
  delete req.session.admin;
  setFlash(req, "success", "Voce saiu da area administrativa.");
  return res.redirect("/admin/login");
});

app.get("/admin", ensureAdminAuth, async (req, res) => {
  const db = getDb();
  const activeTab = resolveAdminTab(req.query.tab);
  const stores = await getAdminStoreRows(db);
  const payments = await getAdminPaymentRows(db);
  const financeFilters = getAdminFinanceFilters(req.query);
  const filteredPayments = filterAdminPayments(payments, financeFilters);
  const adminStats = buildAdminStats(stores, payments);
  const financeStats = buildAdminFinanceStats(stores, filteredPayments, financeFilters);
  const financeChart = buildFinanceChart(filteredPayments, 0);
  const planCatalog = await getAdminPlanCatalog(db);
  const subscriberRows = [...stores].sort((a, b) => {
    if (a.subscriptionActive !== b.subscriptionActive) {
      return a.subscriptionActive ? -1 : 1;
    }
    return a.store_name.localeCompare(b.store_name);
  });

  return res.render("admin", {
    flash: popFlash(req),
    activeTab,
    stores,
    recentStores: stores.slice(0, 6),
    subscriberRows,
    payments: filteredPayments,
    allPaymentsCount: payments.length,
    financeFilters,
    adminStats,
    financeStats,
    financeChart,
    planCatalog,
    planNames: ADMIN_PLAN_NAMES,
    planStatuses: ADMIN_PLAN_STATUSES,
    invoiceStatuses: ADMIN_INVOICE_STATUSES,
    paymentMethods: ADMIN_PAYMENT_METHODS
  });
});

app.post("/admin/plans/:planKey", ensureAdminAuth, async (req, res) => {
  const planKey = String(req.params.planKey || "").trim().toLowerCase();
  if (!ADMIN_PLAN_KEYS.includes(planKey)) {
    setFlash(req, "error", "Plano invalido.");
    return res.redirect(adminRedirect("planos"));
  }

  const planName = planKey === "luck" ? "Plano LUCK" : "Plano Iniciante";
  const monthlyPrice = normalizeMoneyText(req.body.monthly_price);
  const requestedLimit = Number(req.body.raffle_limit || 0);
  const raffleLimit = planKey === "luck"
    ? 0
    : Math.max(1, Math.min(999, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 2));
  const exportClients = planKey === "luck" ? 1 : req.body.export_clients === "1" ? 1 : 0;
  const description = clampText(req.body.description, 240);
  const db = getDb();

  await db.run(
    `
      INSERT INTO admin_plan_catalog (
        plan_key,
        plan_name,
        monthly_price,
        raffle_limit,
        export_clients,
        description,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(plan_key) DO UPDATE SET
        monthly_price = excluded.monthly_price,
        raffle_limit = excluded.raffle_limit,
        export_clients = excluded.export_clients,
        description = excluded.description,
        updated_at = datetime('now')
    `,
    [planKey, planName, monthlyPrice, raffleLimit, exportClients, description]
  );

  setFlash(req, "success", `${planName} atualizado.`);
  return res.redirect(adminRedirect("planos"));
});

app.post("/admin/assinantes/:storeId/plan", ensureAdminAuth, async (req, res) => {
  const storeId = Number(req.params.storeId);

  if (!Number.isFinite(storeId)) {
    setFlash(req, "error", "Loja invalida.");
    return res.redirect(adminRedirect("assinantes"));
  }

  const db = getDb();
  const store = await db.get(
    `
      SELECT id, store_name, created_at
      FROM stores
      WHERE id = ?
      LIMIT 1
    `,
    [storeId]
  );

  if (!store) {
    setFlash(req, "error", "Loja nao encontrada.");
    return res.redirect(adminRedirect("assinantes"));
  }

  await getStorePlan(db, store);
  const currentPlan = await db.get("SELECT * FROM store_plans WHERE store_id = ?", [storeId]);
  const planName = normalizeChoice(req.body.plan_name, ADMIN_PLAN_NAMES, currentPlan.plan_name);
  const planStatus = normalizeChoice(req.body.plan_status, ADMIN_PLAN_STATUSES, currentPlan.plan_status);
  const planCatalog = await getAdminPlanCatalog(db);
  const selectedCatalogPlan = findCatalogPlanForStorePlan(planCatalog, planName);
  const monthlyPrice = planName === "Sem plano"
    ? formatMoneyFromCents(0)
    : selectedCatalogPlan?.monthly_price || currentPlan.monthly_price;
  const invoiceStatus = planName === "Sem plano" ? "Sem cobranca" : currentPlan.invoice_status;
  const paymentMethod = currentPlan.payment_method;
  const explicitDueDate = parseDateOnly(req.body.invoice_due_at);
  const requestedDays = Number(req.body.add_days || 0);
  const daysToAdd = Number.isFinite(requestedDays) ? Math.max(0, Math.min(3650, Math.floor(requestedDays))) : 0;
  const currentDueDate = getPlanDueDate(currentPlan);
  let finalDueDate = explicitDueDate || currentDueDate;

  if (daysToAdd > 0) {
    const baseDate = finalDueDate < todayAtNoon() ? todayAtNoon() : finalDueDate;
    finalDueDate = addDays(baseDate, daysToAdd);
  }

  const finalDueInput = formatDateInput(finalDueDate);
  const billingDay = Math.min(Math.max(finalDueDate.getDate(), 1), 28);
  const adminNotes = clampText(req.body.admin_notes, 300);

  await db.run(
    `
      INSERT INTO store_plans (
        store_id,
        plan_name,
        plan_status,
        monthly_price,
        billing_day,
        invoice_status,
        payment_method,
        invoice_due_at,
        admin_notes,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(store_id) DO UPDATE SET
        plan_name = excluded.plan_name,
        plan_status = excluded.plan_status,
        monthly_price = excluded.monthly_price,
        billing_day = excluded.billing_day,
        invoice_status = excluded.invoice_status,
        payment_method = excluded.payment_method,
        invoice_due_at = excluded.invoice_due_at,
        admin_notes = excluded.admin_notes,
        updated_at = datetime('now')
    `,
    [
      storeId,
      planName,
      planStatus,
      monthlyPrice,
      billingDay,
      invoiceStatus,
      paymentMethod,
      finalDueInput,
      adminNotes
    ]
  );

  setFlash(req, "success", `Assinatura de ${store.store_name} atualizada.`);
  return res.redirect(adminRedirect("assinantes"));
});

app.post("/admin/payments", ensureAdminAuth, async (req, res) => {
  const storeId = Number(req.body.store_id || 0);
  const db = getDb();
  const store = await db.get("SELECT id, store_name FROM stores WHERE id = ?", [storeId]);

  if (!store) {
    setFlash(req, "error", "Selecione uma loja para registrar o pagamento.");
    return res.redirect(adminRedirect("financeiro"));
  }

  const amountCents = parseMoneyToCents(req.body.amount);
  if (amountCents <= 0) {
    setFlash(req, "error", "Informe um valor valido para o pagamento.");
    return res.redirect(adminRedirect("financeiro"));
  }

  const status = normalizeChoice(
    req.body.status,
    ADMIN_INVOICE_STATUSES.filter((item) => item !== "Sem cobranca"),
    "Pendente"
  );
  const method = normalizeChoice(req.body.method, ADMIN_PAYMENT_METHODS, "Nao configurado");
  const dueDate = parseDateOnly(req.body.due_at) || todayAtNoon();
  const paidDate = parseDateOnly(req.body.paid_at) || (status === "Pago" ? todayAtNoon() : null);
  const description = clampText(req.body.description, 140) || `Pagamento ${store.store_name}`;

  await db.run(
    `
      INSERT INTO admin_payments (
        store_id,
        description,
        amount_cents,
        status,
        method,
        due_at,
        paid_at,
        reference_month
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      storeId,
      description,
      amountCents,
      status,
      method,
      formatDateInput(dueDate),
      paidDate ? formatDateInput(paidDate) : null,
      getMonthKey(paidDate || dueDate)
    ]
  );

  setFlash(req, "success", "Pagamento registrado no financeiro.");
  return res.redirect(adminRedirect("financeiro"));
});

app.post("/admin/payments/:paymentId/update", ensureAdminAuth, async (req, res) => {
  const paymentId = Number(req.params.paymentId);

  if (!Number.isFinite(paymentId)) {
    setFlash(req, "error", "Pagamento invalido.");
    return res.redirect(adminRedirect("financeiro"));
  }

  const status = normalizeChoice(
    req.body.status,
    ADMIN_INVOICE_STATUSES.filter((item) => item !== "Sem cobranca"),
    "Pendente"
  );
  const method = normalizeChoice(req.body.method, ADMIN_PAYMENT_METHODS, "Nao configurado");
  const paidDate = parseDateOnly(req.body.paid_at) || (status === "Pago" ? todayAtNoon() : null);
  const db = getDb();

  await db.run(
    `
      UPDATE admin_payments
      SET status = ?, method = ?, paid_at = ?, updated_at = datetime('now')
      WHERE id = ?
    `,
    [status, method, paidDate ? formatDateInput(paidDate) : null, paymentId]
  );

  setFlash(req, "success", "Pagamento atualizado.");
  return res.redirect(adminRedirect("financeiro"));
});

app.post("/webhooks/pagbank", async (req, res) => {
  if (isPagBankConfigured() && req.get("x-authenticity-token") && !verifyPagBankSignature(req)) {
    return res.status(401).json({ ok: false });
  }

  const payload = req.body || {};
  const referenceId = extractPagBankReference(payload);
  const paymentId = extractPagBankPaymentId(payload);
  const orderId = extractPagBankOrderId(payload);
  const db = getDb();

  if (!referenceId && !paymentId && !orderId) {
    return res.status(202).json({ ok: true, ignored: true });
  }

  const payment = await db.get(
    `
      SELECT *
      FROM admin_payments
      WHERE pagbank_reference_id = ?
         OR pagbank_payment_id = ?
         OR pagbank_order_id = ?
      LIMIT 1
    `,
    [referenceId, paymentId, orderId]
  );

  if (!payment) {
    return res.status(202).json({ ok: true, ignored: true });
  }

  await applyPagBankPaymentUpdate(db, payment, payload);

  return res.json({ ok: true });
});

app.get("/", async (req, res) => {
  if (req.session.user) {
    const db = getDb();
    const store = await db.get("SELECT id FROM stores WHERE id = ?", [req.session.user.id]);
    if (!store) {
      setFlash(req, "error", "Sessao expirada. Faca login novamente.");
      return destroySessionAndRedirect(req, res, "/");
    }

    return res.redirect("/dashboard");
  }

  const db = getDb();
  const landing = await getPublicLandingData(db);

  return res.render("auth", {
    flash: popFlash(req),
    landing
  });
});

app.post("/", async (req, res) => {
  const body = req.body || {};

  if (body.email && body.password) {
    if (body.store_name || body.cpf_cnpj || body.whatsapp) {
      return handleRegister(req, res);
    }
    return handleLogin(req, res);
  }

  if (req.session.user) {
    const db = getDb();
    const store = await db.get("SELECT id FROM stores WHERE id = ?", [req.session.user.id]);
    if (!store) {
      return destroySessionAndRedirect(req, res, "/");
    }

    return res.redirect("/dashboard");
  }

  return res.redirect("/");
});

async function handleRegister(req, res) {
  const { store_name, email, cpf_cnpj, whatsapp, password } = req.body;

  if (!store_name || !email || !cpf_cnpj || !whatsapp || !password) {
    setFlash(req, "error", "Preencha todos os campos do cadastro.");
    return res.redirect("/");
  }

  if (password.length < 6) {
    setFlash(req, "error", "A senha precisa ter pelo menos 6 caracteres.");
    return res.redirect("/");
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const db = getDb();

  const existingStore = await db.get("SELECT id FROM stores WHERE email = ?", [normalizedEmail]);

  if (existingStore) {
    setFlash(req, "error", "Ja existe uma loja cadastrada com esse email.");
    return res.redirect("/");
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const result = await db.run(
    `
      INSERT INTO stores (store_name, email, cpf_cnpj, whatsapp, password_hash)
      VALUES (?, ?, ?, ?, ?)
    `,
    [store_name.trim(), normalizedEmail, cpf_cnpj.trim(), whatsapp.trim(), passwordHash]
  );

  req.session.user = {
    id: result.lastID,
    storeName: store_name.trim(),
    email: normalizedEmail
  };

  await getStoreCustomization(db, result.lastID);

  setFlash(req, "success", "Cadastro realizado com sucesso.");
  return res.redirect("/dashboard");
}

app.post("/register", handleRegister);

async function handleLogin(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    setFlash(req, "error", "Informe email e senha.");
    return res.redirect("/");
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const db = getDb();

  const store = await db.get("SELECT * FROM stores WHERE email = ?", [normalizedEmail]);

  if (!store) {
    setFlash(req, "error", "Credenciais invalidas.");
    return res.redirect("/");
  }

  const passwordMatches = await bcrypt.compare(password, store.password_hash);

  if (!passwordMatches) {
    setFlash(req, "error", "Credenciais invalidas.");
    return res.redirect("/");
  }

  req.session.user = {
    id: store.id,
    storeName: store.store_name,
    email: store.email
  };

  await getStoreCustomization(db, store.id);

  setFlash(req, "success", "Login realizado com sucesso.");
  return res.redirect("/dashboard");
}

app.post("/login", handleLogin);

app.post("/logout", (req, res) => {
  return destroySessionAndRedirect(req, res, "/");
});

function handleBillingReturn(req, res) {
  return res.redirect(dashboardRedirect("plano"));
}

app.get("/dashboard/billing/pagbank/return", ensureAuth, handleBillingReturn);
app.post("/dashboard/billing/pagbank/return", ensureAuth, handleBillingReturn);

app.post("/dashboard", ensureAuth, (req, res) => {
  return res.redirect(dashboardRedirect(req.query.tab || req.body?.tab || "plano"));
});

app.get("/dashboard", ensureAuth, async (req, res) => {
  const db = getDb();
  const activeTab = resolveDashboardTab(req.query.tab);

  const store = await db.get(
    `
      SELECT id, store_name, email, cpf_cnpj, whatsapp, created_at
      FROM stores
      WHERE id = ?
    `,
    [req.session.user.id]
  );

  if (!store) {
    return destroySessionAndRedirect(req, res, "/");
  }

  req.session.user.storeName = store.store_name;
  req.session.user.email = store.email;

  await ensureStoreRaffleTokens(db, store.id);
  const customization = await getStoreCustomization(db, store.id);
  const plan = await getStorePlan(db, store);
  await syncStoreClientsFromRaffleEntries(db, store.id);

  const raffles = await db.all(
    `
      SELECT
        r.*,
        COUNT(re.id) AS public_entries_count
      FROM raffles r
      LEFT JOIN raffle_entries re ON re.raffle_id = r.id
      WHERE r.store_id = ?
      GROUP BY r.id
      ORDER BY r.created_at DESC, r.id DESC
    `,
    [store.id]
  );

  const ongoingRaffles = raffles.filter((raffle) => !raffle.drawn_at);
  const completedRaffles = raffles.filter((raffle) => Boolean(raffle.drawn_at));
  const totalParticipants = raffles.reduce((accumulator, raffle) => {
    const manualParticipants = String(raffle.participants || "")
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter(Boolean).length;
    const publicParticipants = Number(raffle.public_entries_count || 0);
    return accumulator + manualParticipants + publicParticipants;
  }, 0);

  const dashboardStats = {
    activeRaffles: ongoingRaffles.length,
    totalRaffles: raffles.length,
    totalParticipants,
    drawnWinners: completedRaffles.length
  };

  const toTimestamp = (value) => {
    const timestamp = new Date(value || "").getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  };

  const recentActivity = raffles
    .map((raffle) => {
      const createdAt = raffle.created_at || "";
      const drawnAt = raffle.drawn_at || "";
      const latestAt = drawnAt || createdAt;
      const events = [];

      if (createdAt) {
        events.push({
          type: "created",
          label: "Sorteio criado",
          at: createdAt
        });
      }

      if (drawnAt) {
        events.push({
          type: "winner",
          label: raffle.winner_name ? `Vencedor definido: ${raffle.winner_name}` : "Vencedor definido",
          at: drawnAt
        });
      }

      events.sort((a, b) => toTimestamp(b.at) - toTimestamp(a.at));

      return {
        raffleId: raffle.id,
        raffleTitle: raffle.title || `Sorteio #${raffle.id}`,
        status: drawnAt ? "Finalizado" : "Em andamento",
        winnerName: raffle.winner_name || "",
        createdAt,
        drawnAt,
        latestAt,
        summary: drawnAt
          ? `Vencedor definido${raffle.winner_name ? `: ${raffle.winner_name}` : ""}`
          : "Sorteio criado e em andamento",
        events
      };
    })
    .sort((a, b) => toTimestamp(b.latestAt) - toTimestamp(a.latestAt));

  const clients = await getStoreClients(db, store.id);

  const publicLinkBase = `${req.protocol}://${req.get("host")}`;

  res.render("dashboard", {
    user: req.session.user,
    store,
    flash: popFlash(req),
    activeTab,
    raffles,
    ongoingRaffles,
    completedRaffles,
    dashboardStats,
    recentActivity: recentActivity.slice(0, 8),
    clients,
    customization,
    plan,
    pagbankConfigured: isPagBankConfigured(),
    publicLinkBase
  });
});

async function getBillingContext(req) {
  const db = getDb();
  const storeId = req.session.user.id;
  const store = await db.get(
    `
      SELECT id, store_name, email, cpf_cnpj, whatsapp, created_at
      FROM stores
      WHERE id = ?
      LIMIT 1
    `,
    [storeId]
  );

  if (!store) {
    return { db, store: null };
  }

  if (!isPagBankConfigured()) {
    return {
      db,
      store,
      error: "PagBank ainda nao esta configurado. Informe PAGBANK_TOKEN no .env."
    };
  }

  const plan = await getStorePlan(db, store);
  const amountCents = parseMoneyToCents(plan.monthly_price);

  if (amountCents <= 0 || plan.plan_name === "Sem plano") {
    return {
      db,
      store,
      plan,
      amountCents,
      error: "Este plano nao possui mensalidade para pagamento online."
    };
  }

  const dueDate = parseDateOnly(plan.invoice_due_at) || todayAtNoon();
  const description = `${plan.plan_name} - ${plan.invoiceNumber}`;
  const publicBaseUrl = getPublicBaseUrl(req);
  const webhookUrl = `${publicBaseUrl}/webhooks/pagbank`;
  const returnUrl = `${publicBaseUrl}/dashboard/billing/pagbank/return`;

  return {
    db,
    store,
    plan,
    amountCents,
    dueDate,
    description,
    webhookUrl,
    returnUrl
  };
}

async function createPendingBillingPayment(db, context, method, referenceId) {
  return db.run(
    `
      INSERT INTO admin_payments (
        store_id,
        description,
        amount_cents,
        status,
        method,
        due_at,
        reference_month,
        pagbank_reference_id
      )
      VALUES (?, ?, ?, 'Pendente', ?, ?, ?, ?)
    `,
    [
      context.store.id,
      context.description,
      context.amountCents,
      method,
      formatDateInput(context.dueDate),
      getMonthKey(context.dueDate),
      referenceId
    ]
  );
}

async function handlePagBankCardCheckout(req, res) {
  const context = await getBillingContext(req);
  if (!context.store) {
    return destroySessionAndRedirect(req, res, "/");
  }
  if (context.error) {
    setFlash(req, "error", context.error);
    return res.redirect(dashboardRedirect("plano"));
  }

  const referenceId = buildPagBankReference(context.store.id);

  const paymentResult = await createPendingBillingPayment(context.db, context, "Cartao", referenceId);

  try {
    const checkout = await createPagBankCheckout({
      reference_id: referenceId,
      customer_modifiable: true,
      items: [
        {
          name: context.description.slice(0, 100),
          quantity: 1,
          unit_amount: context.amountCents
        }
      ],
      payment_methods: [
        { type: "CREDIT_CARD" }
      ],
      redirect_url: context.returnUrl,
      return_url: context.returnUrl,
      notification_urls: [context.webhookUrl],
      payment_notification_urls: [context.webhookUrl],
      soft_descriptor: "CITYSORTEIOS"
    });
    const payLink = getPayLink(checkout);

    await context.db.run(
      `
        UPDATE admin_payments
        SET pagbank_checkout_id = ?, pagbank_payment_url = ?, updated_at = datetime('now')
        WHERE id = ?
      `,
      [checkout.id || "", payLink, paymentResult.lastID]
    );

    if (!payLink) {
      throw new Error("PagBank nao retornou o link de pagamento.");
    }

    return res.redirect(payLink);
  } catch (error) {
    await context.db.run(
      `
        UPDATE admin_payments
        SET status = 'Cancelada', updated_at = datetime('now')
        WHERE id = ?
      `,
      [paymentResult.lastID]
    );

    setFlash(req, "error", `Nao foi possivel criar o checkout PagBank: ${error.message}`);
    return res.redirect(dashboardRedirect("plano"));
  }
}

app.post("/dashboard/billing/pagbank/checkout", ensureAuth, handlePagBankCardCheckout);
app.post("/dashboard/billing/pagbank/card", ensureAuth, handlePagBankCardCheckout);

app.post("/dashboard/billing/pagbank/pix", ensureAuth, async (req, res) => {
  const context = await getBillingContext(req);
  if (!context.store) {
    clearSessionCookie(res);
    if (req.session) {
      req.session.destroy(() => {});
    }
    return res.status(401).json({ ok: false, message: "Sessao expirada." });
  }
  if (context.error) {
    return res.status(400).json({ ok: false, message: context.error });
  }

  let customer;
  try {
    customer = buildPagBankCustomer(context.store);
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message });
  }

  const reusablePayment = await context.db.get(
    `
      SELECT *
      FROM admin_payments
      WHERE store_id = ?
        AND status = 'Pendente'
        AND method = 'Pix'
        AND reference_month = ?
        AND amount_cents = ?
        AND pagbank_pix_code IS NOT NULL
        AND (pagbank_expires_at IS NULL OR pagbank_expires_at > ?)
      ORDER BY id DESC
      LIMIT 1
    `,
    [context.store.id, getMonthKey(context.dueDate), context.amountCents, new Date().toISOString()]
  );

  if (reusablePayment) {
    return res.json({
      ok: true,
      payment: buildPaymentResponse(reusablePayment)
    });
  }

  const referenceId = buildPagBankReference(context.store.id);
  const paymentResult = await createPendingBillingPayment(context.db, context, "Pix", referenceId);
  const expiresAt = addHours(new Date(), Number(process.env.PAGBANK_PIX_EXPIRES_HOURS || 24));

  try {
    const order = await createPagBankPixOrder(
      {
        reference_id: referenceId,
        customer,
        items: [
          {
            name: context.description.slice(0, 100),
            quantity: 1,
            unit_amount: context.amountCents
          }
        ],
        qr_codes: [
          {
            amount: {
              value: context.amountCents
            },
            expiration_date: expiresAt.toISOString()
          }
        ],
        notification_urls: [context.webhookUrl]
      },
      referenceId
    );
    const qrCode = extractPagBankQrCode(order);
    const pixCode = qrCode?.text || "";
    const qrCodeImageUrl = getQrCodeLink(qrCode, "QRCODE.PNG");

    if (!pixCode) {
      throw new Error("PagBank nao retornou o codigo copia e cola do Pix.");
    }

    await context.db.run(
      `
        UPDATE admin_payments
        SET pagbank_order_id = ?,
            pagbank_qr_code_id = ?,
            pagbank_pix_code = ?,
            pagbank_qr_code_image_url = ?,
            pagbank_expires_at = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `,
      [
        order.id || "",
        qrCode?.id || "",
        pixCode,
        qrCodeImageUrl,
        qrCode?.expiration_date || expiresAt.toISOString(),
        paymentResult.lastID
      ]
    );

    const payment = await context.db.get("SELECT * FROM admin_payments WHERE id = ?", [paymentResult.lastID]);
    return res.json({
      ok: true,
      payment: buildPaymentResponse(payment)
    });
  } catch (error) {
    await context.db.run(
      `
        UPDATE admin_payments
        SET status = 'Cancelada', updated_at = datetime('now')
        WHERE id = ?
      `,
      [paymentResult.lastID]
    );

    return res.status(502).json({
      ok: false,
      message: `Nao foi possivel gerar o Pix PagBank: ${error.message}`
    });
  }
});

app.get("/dashboard/billing/pagbank/payments/:paymentId", ensureAuth, async (req, res) => {
  const paymentId = Number(req.params.paymentId);
  if (!Number.isFinite(paymentId)) {
    return res.status(400).json({ ok: false, message: "Pagamento invalido." });
  }

  const db = getDb();
  const payment = await db.get(
    `
      SELECT *
      FROM admin_payments
      WHERE id = ? AND store_id = ?
      LIMIT 1
    `,
    [paymentId, req.session.user.id]
  );

  if (!payment) {
    return res.status(404).json({ ok: false, message: "Pagamento nao encontrado." });
  }

  await refreshPagBankPayment(db, payment);
  const updatedPayment = await db.get("SELECT * FROM admin_payments WHERE id = ?", [payment.id]);

  return res.json({
    ok: true,
    payment: buildPaymentResponse(updatedPayment || payment)
  });
});

app.get("/dashboard/clientes/export.csv", ensureAuth, async (req, res) => {
  const db = getDb();
  const storeId = req.session.user.id;
  const store = await db.get("SELECT id, store_name, created_at FROM stores WHERE id = ?", [storeId]);
  const plan = store ? await getStorePlan(db, store) : null;
  if (!plan?.canExportClients) {
    setFlash(req, "error", "A exportacao de clientes esta disponivel apenas no Plano LUCK.");
    return res.redirect(dashboardRedirect("clientes"));
  }

  await syncStoreClientsFromRaffleEntries(db, storeId);
  const clients = await getStoreClients(db, storeId);
  const headers = ["Nome", "CPF", "WhatsApp", "Total de participacoes", "Ultima participacao"];
  const rows = clients.map((client) => [
    client.participant_name,
    client.participant_cpf,
    client.participant_whatsapp,
    client.total_entries,
    client.last_entry_at
  ]);

  const csvLines = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(";"));
  const csv = `\uFEFF${csvLines.join("\r\n")}`;

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="clientes-sortify-city.csv"');
  return res.send(csv);
});

app.get("/dashboard/clientes/export.xls", ensureAuth, async (req, res) => {
  const db = getDb();
  const storeId = req.session.user.id;
  const store = await db.get("SELECT id, store_name, created_at FROM stores WHERE id = ?", [storeId]);
  const plan = store ? await getStorePlan(db, store) : null;
  if (!plan?.canExportClients) {
    setFlash(req, "error", "A exportacao de clientes esta disponivel apenas no Plano LUCK.");
    return res.redirect(dashboardRedirect("clientes"));
  }

  await syncStoreClientsFromRaffleEntries(db, storeId);
  const clients = await getStoreClients(db, storeId);

  const rowsHtml = clients
    .map(
      (client) => `
        <tr>
          <td>${escapeHtml(client.participant_name)}</td>
          <td style="mso-number-format:'\\@';">${escapeHtml(client.participant_cpf)}</td>
          <td style="mso-number-format:'\\@';">${escapeHtml(client.participant_whatsapp)}</td>
          <td>${escapeHtml(client.total_entries)}</td>
          <td>${escapeHtml(client.last_entry_at)}</td>
        </tr>
      `
    )
    .join("");

  const workbookHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
      </head>
      <body>
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>CPF</th>
              <th>WhatsApp</th>
              <th>Total de participacoes</th>
              <th>Ultima participacao</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </body>
    </html>
  `;

  res.setHeader("Content-Type", "application/vnd.ms-excel; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="clientes-sortify-city.xls"');
  return res.send(workbookHtml);
});

app.get("/dashboard/clientes/:clientId/details", ensureAuth, async (req, res) => {
  const clientId = Number(req.params.clientId);
  if (Number.isNaN(clientId)) {
    return res.status(400).json({ ok: false, message: "Cliente invalido." });
  }

  const db = getDb();
  const storeId = req.session.user.id;
  await syncStoreClientsFromRaffleEntries(db, storeId);
  const details = await getStoreClientDetails(db, storeId, clientId);

  if (!details) {
    return res.status(404).json({ ok: false, message: "Cliente nao encontrado." });
  }

  return res.json({
    ok: true,
    ...details
  });
});

app.post("/raffles", ensureAuth, async (req, res) => {
  try {
    await runRaffleImageUpload(req, res);
  } catch (error) {
    const fallbackTab = resolveDashboardTab(req.body?.redirect_tab || "sorteios");
    if (error.code === "LIMIT_FILE_SIZE") {
      setFlash(req, "error", "A foto do sorteio pode ter no maximo 8MB.");
    } else if (String(error.message || "").includes("TIPO_IMAGEM_SORTEIO_INVALIDO")) {
      setFlash(req, "error", "Formato invalido. Envie PNG, JPG ou WEBP.");
    } else {
      setFlash(req, "error", "Nao foi possivel enviar a foto do sorteio.");
    }
    return res.redirect(dashboardRedirect(fallbackTab));
  }

  const { title, prize, participants, ends_at, auto_draw_on_end } = req.body;
  const redirectTab = resolveDashboardTab(req.body.redirect_tab || "sorteios");
  const raffleImageUrl = req.file?.filename ? toPublicRaffleImagePath(req.file.filename) : "";

  if (!title || !prize) {
    if (raffleImageUrl) {
      deleteLocalRaffleImageIfManaged(raffleImageUrl);
    }
    setFlash(req, "error", "Titulo e premio/descricao sao obrigatorios.");
    return res.redirect(dashboardRedirect(redirectTab));
  }

  let endsAtIso = null;
  if (ends_at) {
    if (!isValidDate(ends_at)) {
      if (raffleImageUrl) {
        deleteLocalRaffleImageIfManaged(raffleImageUrl);
      }
      setFlash(req, "error", "Timer invalido. Informe uma data/hora valida.");
      return res.redirect(dashboardRedirect(redirectTab));
    }
    endsAtIso = new Date(ends_at).toISOString();
  }

  const autoDraw = auto_draw_on_end ? 1 : 0;
  if (autoDraw && !endsAtIso) {
    if (raffleImageUrl) {
      deleteLocalRaffleImageIfManaged(raffleImageUrl);
    }
    setFlash(req, "error", "Para auto sorteio, voce precisa definir um timer.");
    return res.redirect(dashboardRedirect(redirectTab));
  }

  const db = getDb();
  const store = await db.get("SELECT id, store_name, created_at FROM stores WHERE id = ?", [req.session.user.id]);
  const plan = store ? await getStorePlan(db, store) : null;
  const existingRaffles = await db.get("SELECT COUNT(*) AS total FROM raffles WHERE store_id = ?", [req.session.user.id]);
  const raffleLimit = Number(plan?.raffleLimit || 0);
  if (raffleLimit > 0 && Number(existingRaffles?.total || 0) >= raffleLimit) {
    if (raffleImageUrl) {
      deleteLocalRaffleImageIfManaged(raffleImageUrl);
    }
    setFlash(req, "error", `Seu plano permite criar ${raffleLimit} sorteio(s) no total. Para ilimitado, use o Plano LUCK.`);
    return res.redirect(dashboardRedirect(redirectTab));
  }

  const publicToken = await createUniqueRafflePublicToken(db);

  await db.run(
    `
      INSERT INTO raffles (store_id, title, prize, participants, ends_at, auto_draw_on_end, public_token, raffle_image_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      req.session.user.id,
      title.trim(),
      prize.trim(),
      (participants || "").trim(),
      endsAtIso,
      autoDraw,
      publicToken,
      raffleImageUrl
    ]
  );

  setFlash(req, "success", "Sorteio criado. Link publico gerado com sucesso.");
  return res.redirect(dashboardRedirect(redirectTab));
});

app.post("/raffles/:id/update", ensureAuth, async (req, res) => {
  const raffleId = Number(req.params.id);
  const redirectTab = resolveDashboardTab(req.body.redirect_tab || "sorteios");

  if (Number.isNaN(raffleId)) {
    setFlash(req, "error", "Sorteio invalido.");
    return res.redirect(dashboardRedirect(redirectTab));
  }

  try {
    await runRaffleImageUpload(req, res);
  } catch (error) {
    if (error.code === "LIMIT_FILE_SIZE") {
      setFlash(req, "error", "A foto do sorteio pode ter no maximo 8MB.");
    } else if (String(error.message || "").includes("TIPO_IMAGEM_SORTEIO_INVALIDO")) {
      setFlash(req, "error", "Formato invalido. Envie PNG, JPG ou WEBP.");
    } else {
      setFlash(req, "error", "Nao foi possivel enviar a foto do sorteio.");
    }
    return res.redirect(dashboardRedirect(redirectTab));
  }

  const uploadedImagePath = req.file?.filename ? toPublicRaffleImagePath(req.file.filename) : "";
  const title = clampText(req.body.title, 120);
  const prize = clampText(req.body.prize, 180);
  const participants = String(req.body.participants || "").trim();
  const shouldRemoveImage = req.body.remove_raffle_image === "1";

  if (!title || !prize) {
    if (uploadedImagePath) {
      deleteLocalRaffleImageIfManaged(uploadedImagePath);
    }
    setFlash(req, "error", "Titulo e premio sao obrigatorios para editar.");
    return res.redirect(dashboardRedirect(redirectTab));
  }

  let endsAtIso = null;
  if (req.body.ends_at) {
    if (!isValidDate(req.body.ends_at)) {
      if (uploadedImagePath) {
        deleteLocalRaffleImageIfManaged(uploadedImagePath);
      }
      setFlash(req, "error", "Timer invalido. Informe uma data/hora valida.");
      return res.redirect(dashboardRedirect(redirectTab));
    }
    endsAtIso = new Date(req.body.ends_at).toISOString();
  }

  const autoDraw = req.body.auto_draw_on_end ? 1 : 0;
  if (autoDraw && !endsAtIso) {
    if (uploadedImagePath) {
      deleteLocalRaffleImageIfManaged(uploadedImagePath);
    }
    setFlash(req, "error", "Para auto sorteio, voce precisa definir um timer.");
    return res.redirect(dashboardRedirect(redirectTab));
  }

  const db = getDb();
  const existingRaffle = await db.get(
    `
      SELECT id, raffle_image_url
      FROM raffles
      WHERE id = ? AND store_id = ?
      LIMIT 1
    `,
    [raffleId, req.session.user.id]
  );

  if (!existingRaffle) {
    if (uploadedImagePath) {
      deleteLocalRaffleImageIfManaged(uploadedImagePath);
    }
    setFlash(req, "error", "Sorteio nao encontrado.");
    return res.redirect(dashboardRedirect(redirectTab));
  }

  let finalRaffleImageUrl = existingRaffle.raffle_image_url || "";
  if (shouldRemoveImage) {
    finalRaffleImageUrl = "";
  }
  if (uploadedImagePath) {
    finalRaffleImageUrl = uploadedImagePath;
  }

  await db.run(
    `
      UPDATE raffles
      SET
        title = ?,
        prize = ?,
        participants = ?,
        ends_at = ?,
        auto_draw_on_end = ?,
        raffle_image_url = ?
      WHERE id = ? AND store_id = ?
    `,
    [title, prize, participants, endsAtIso, autoDraw, finalRaffleImageUrl, raffleId, req.session.user.id]
  );

  if (finalRaffleImageUrl !== existingRaffle.raffle_image_url) {
    deleteLocalRaffleImageIfManaged(existingRaffle.raffle_image_url);
  }

  setFlash(req, "success", "Sorteio atualizado com sucesso.");
  return res.redirect(dashboardRedirect(redirectTab));
});

app.post("/raffles/:id/delete", ensureAuth, async (req, res) => {
  const raffleId = Number(req.params.id);
  const redirectTab = resolveDashboardTab(req.body.redirect_tab || "sorteios");

  if (Number.isNaN(raffleId)) {
    setFlash(req, "error", "Sorteio invalido.");
    return res.redirect(dashboardRedirect(redirectTab));
  }

  const db = getDb();
  const raffle = await db.get(
    `
      SELECT id, raffle_image_url
      FROM raffles
      WHERE id = ? AND store_id = ?
      LIMIT 1
    `,
    [raffleId, req.session.user.id]
  );

  if (!raffle) {
    setFlash(req, "error", "Sorteio nao encontrado.");
    return res.redirect(dashboardRedirect(redirectTab));
  }

  await db.run(
    `
      DELETE FROM raffles
      WHERE id = ? AND store_id = ?
    `,
    [raffleId, req.session.user.id]
  );

  deleteLocalRaffleImageIfManaged(raffle.raffle_image_url);
  setFlash(req, "success", "Sorteio excluido com sucesso.");
  return res.redirect(dashboardRedirect(redirectTab));
});

app.post("/raffles/:id/draw", ensureAuth, async (req, res) => {
  const raffleId = Number(req.params.id);
  const redirectTab = resolveDashboardTab(req.body.redirect_tab);
  const respondAsJson = wantsJsonResponse(req);

  const sendDrawError = (message, statusCode = 400) => {
    if (respondAsJson) {
      return res.status(statusCode).json({ ok: false, message });
    }

    setFlash(req, "error", message);
    return res.redirect(dashboardRedirect(redirectTab));
  };

  if (Number.isNaN(raffleId)) {
    return sendDrawError("Sorteio invalido.");
  }

  const db = getDb();
  const result = await drawRaffle(db, raffleId, req.session.user.id, "manual");

  if (!result.ok) {
    if (result.reason === "SORTEIO_JA_REALIZADO") {
      return sendDrawError("Esse sorteio ja foi realizado.", 409);
    }

    return sendDrawError("Nao foi possivel sortear agora.", 500);
  }

  if (respondAsJson) {
    return res.json({
      ok: true,
      winner: result.winner,
      message: `Sorteio realizado. Vencedor: ${result.winner}`,
      redirectUrl: dashboardRedirect(redirectTab)
    });
  }

  setFlash(req, "success", `Sorteio realizado. Vencedor: ${result.winner}`);
  return res.redirect(dashboardRedirect(redirectTab));
});

app.get("/s/:publicToken", async (req, res) => {
  const db = getDb();
  const publicToken = String(req.params.publicToken || "").trim();
  const raffle = await getPublicRaffleByToken(db, publicToken);

  if (!raffle) {
    return res.status(404).render("public-raffle", {
      raffle: null,
      flash: null,
      entriesCount: 0
    });
  }

  const entriesCountRow = await db.get(
    `
      SELECT COUNT(*) AS total
      FROM raffle_entries
      WHERE raffle_id = ?
    `,
    [raffle.id]
  );

  return res.render("public-raffle", {
    raffle,
    flash: popPublicFlash(req, publicToken),
    entriesCount: entriesCountRow?.total || 0,
    alreadyJoinedOnDevice: hasDeviceJoinedRaffle(req, publicToken)
  });
});

app.post("/s/:publicToken/participar", async (req, res) => {
  const db = getDb();
  const publicToken = String(req.params.publicToken || "").trim();
  const raffle = await getPublicRaffleByToken(db, publicToken);
  const respondAsJson = wantsJsonResponse(req);

  const sendError = (message, statusCode = 400) => {
    if (respondAsJson) {
      return res.status(statusCode).json({ ok: false, message });
    }
    setPublicFlash(req, publicToken, "error", message);
    return res.redirect(`/s/${publicToken}`);
  };

  const sendSuccess = async (message) => {
    if (respondAsJson) {
      const countRow = await db.get(
        `
          SELECT COUNT(*) AS total
          FROM raffle_entries
          WHERE raffle_id = ?
        `,
        [raffle.id]
      );
      return res.status(200).json({
        ok: true,
        message,
        entriesCount: countRow?.total || 0
      });
    }
    setPublicFlash(req, publicToken, "success", message);
    return res.redirect(`/s/${publicToken}`);
  };

  if (!raffle) {
    if (respondAsJson) {
      return res.status(404).json({ ok: false, message: "Sorteio nao encontrado." });
    }
    return res.status(404).send("Sorteio nao encontrado.");
  }

  if (raffle.drawn_at) {
    return sendError("Esse sorteio ja foi finalizado.", 409);
  }

  if (hasDeviceJoinedRaffle(req, publicToken)) {
    return sendError("Este dispositivo ja foi inscrito neste sorteio.", 409);
  }

  const participantName = clampText(req.body.participant_name, 100);
  const participantCpf = clampText(req.body.participant_cpf, 20);
  const participantWhatsapp = clampText(req.body.participant_whatsapp, 25);
  const normalizedCpf = normalizeCpf(participantCpf);

  if (!participantName || !participantCpf || !participantWhatsapp) {
    return sendError("Preencha nome, CPF e WhatsApp para participar.");
  }

  if (normalizedCpf.length !== 11) {
    return sendError("CPF invalido. Informe um CPF com 11 digitos.");
  }

  try {
    await db.run(
      `
        INSERT INTO raffle_entries (
          raffle_id,
          participant_name,
          participant_cpf,
          participant_cpf_normalized,
          participant_whatsapp
        )
        VALUES (?, ?, ?, ?, ?)
      `,
      [raffle.id, participantName, participantCpf, normalizedCpf, participantWhatsapp]
    );

    await registerStoreClient(db, {
      storeId: raffle.store_id,
      participantName,
      participantCpf,
      normalizedCpf,
      participantWhatsapp
    });
  } catch (error) {
    if (String(error.message || "").includes("UNIQUE constraint failed")) {
      return sendError("Esse CPF ja esta participando desse sorteio. Nao e permitido duplicar.", 409);
    }

    return sendError("Nao foi possivel registrar sua participacao.", 500);
  }

  markDeviceAsJoinedRaffle(req, publicToken, normalizedCpf);
  return sendSuccess("Participacao confirmada. Boa sorte no sorteio.");
});

app.post("/dashboard/customization", ensureAuth, async (req, res) => {
  const db = getDb();
  const storeId = req.session.user.id;
  let existingCustomization = await getStoreCustomization(db, storeId);
  try {
    await runLogoUpload(req, res);
  } catch (error) {
    if (error.code === "LIMIT_FILE_SIZE") {
      setFlash(req, "error", "A logo pode ter no maximo 5MB.");
    } else if (String(error.message || "").includes("TIPO_LOGO_INVALIDO")) {
      setFlash(req, "error", "Formato invalido. Envie PNG, JPG, WEBP ou SVG.");
    } else {
      setFlash(req, "error", "Nao foi possivel fazer upload da logo.");
    }
    return res.redirect(dashboardRedirect("customizacao"));
  }

  const uploadedLogoPath = req.file?.filename ? toPublicLogoPath(req.file.filename) : "";
  const shouldRemoveCurrentLogo = req.body.remove_logo === "1";

  const publicModalTitle = clampText(req.body.public_modal_title, 70);
  const publicModalSubtitle = clampText(req.body.public_modal_subtitle, 190);
  const buttonText = clampText(req.body.button_text, 30);
  const bannerText = clampText(req.body.banner_text, 90);
  const primaryColor = normalizeHexColor(req.body.brand_primary_color, "#6a3df0");
  const secondaryColor = normalizeHexColor(req.body.brand_secondary_color, "#3b14ba");

  if (!publicModalTitle || !publicModalSubtitle || !buttonText) {
    if (uploadedLogoPath) {
      deleteLocalLogoIfManaged(uploadedLogoPath);
    }
    setFlash(req, "error", "Preencha titulo, subtitulo e texto do botao.");
    return res.redirect(dashboardRedirect("customizacao"));
  }

  if (!primaryColor || !secondaryColor) {
    if (uploadedLogoPath) {
      deleteLocalLogoIfManaged(uploadedLogoPath);
    }
    setFlash(req, "error", "As cores precisam estar no formato HEX, exemplo: #6a3df0.");
    return res.redirect(dashboardRedirect("customizacao"));
  }

  let finalLogoUrl = existingCustomization.logo_url || "";
  if (shouldRemoveCurrentLogo) {
    finalLogoUrl = "";
  }
  if (uploadedLogoPath) {
    finalLogoUrl = uploadedLogoPath;
  }

  await db.run(
    `
      INSERT INTO store_customizations (
        store_id,
        public_modal_title,
        public_modal_subtitle,
        brand_primary_color,
        brand_secondary_color,
        button_text,
        logo_url,
        banner_text,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(store_id) DO UPDATE SET
        public_modal_title = excluded.public_modal_title,
        public_modal_subtitle = excluded.public_modal_subtitle,
        brand_primary_color = excluded.brand_primary_color,
        brand_secondary_color = excluded.brand_secondary_color,
        button_text = excluded.button_text,
        logo_url = excluded.logo_url,
        banner_text = excluded.banner_text,
        updated_at = datetime('now')
    `,
    [
      storeId,
      publicModalTitle,
      publicModalSubtitle,
      primaryColor,
      secondaryColor,
      buttonText,
      finalLogoUrl,
      bannerText
    ]
  );

  if (finalLogoUrl !== existingCustomization.logo_url) {
    deleteLocalLogoIfManaged(existingCustomization.logo_url);
  }

  setFlash(req, "success", "Customizacao salva com sucesso.");
  return res.redirect(dashboardRedirect("customizacao"));
});

app.post("/dashboard/settings/profile", ensureAuth, async (req, res) => {
  const db = getDb();
  const storeId = req.session.user.id;

  const storeName = clampText(req.body.store_name, 90);
  const email = clampText(req.body.email, 150).toLowerCase();
  const cpfCnpj = clampText(req.body.cpf_cnpj, 30);
  const whatsapp = clampText(req.body.whatsapp, 30);

  if (!storeName || !email || !cpfCnpj || !whatsapp) {
    setFlash(req, "error", "Preencha todos os campos do perfil.");
    return res.redirect(dashboardRedirect("configuracoes"));
  }

  const existingEmail = await db.get(
    `
      SELECT id
      FROM stores
      WHERE email = ? AND id <> ?
    `,
    [email, storeId]
  );

  if (existingEmail) {
    setFlash(req, "error", "Esse email ja esta sendo usado por outra loja.");
    return res.redirect(dashboardRedirect("configuracoes"));
  }

  await db.run(
    `
      UPDATE stores
      SET store_name = ?, email = ?, cpf_cnpj = ?, whatsapp = ?
      WHERE id = ?
    `,
    [storeName, email, cpfCnpj, whatsapp, storeId]
  );

  req.session.user.storeName = storeName;
  req.session.user.email = email;

  setFlash(req, "success", "Dados da loja atualizados.");
  return res.redirect(dashboardRedirect("configuracoes"));
});

app.post("/dashboard/settings/password", ensureAuth, async (req, res) => {
  const db = getDb();
  const storeId = req.session.user.id;
  const { current_password, new_password, confirm_new_password } = req.body;

  if (!current_password || !new_password || !confirm_new_password) {
    setFlash(req, "error", "Preencha senha atual, nova senha e confirmacao.");
    return res.redirect(dashboardRedirect("configuracoes"));
  }

  if (new_password.length < 6) {
    setFlash(req, "error", "A nova senha precisa ter pelo menos 6 caracteres.");
    return res.redirect(dashboardRedirect("configuracoes"));
  }

  if (new_password !== confirm_new_password) {
    setFlash(req, "error", "A confirmacao da senha nao confere.");
    return res.redirect(dashboardRedirect("configuracoes"));
  }

  const store = await db.get("SELECT password_hash FROM stores WHERE id = ?", [storeId]);
  if (!store) {
    return destroySessionAndRedirect(req, res, "/");
  }

  const passwordMatches = await bcrypt.compare(current_password, store.password_hash);
  if (!passwordMatches) {
    setFlash(req, "error", "Senha atual incorreta.");
    return res.redirect(dashboardRedirect("configuracoes"));
  }

  const newPasswordHash = await bcrypt.hash(new_password, 10);
  await db.run("UPDATE stores SET password_hash = ? WHERE id = ?", [newPasswordHash, storeId]);

  setFlash(req, "success", "Senha atualizada com sucesso.");
  return res.redirect(dashboardRedirect("configuracoes"));
});

async function runAutoDraw() {
  const db = getDb();
  const dueRaffles = await db.all(
    `
      SELECT id, store_id
      FROM raffles
      WHERE drawn_at IS NULL
        AND auto_draw_on_end = 1
        AND ends_at IS NOT NULL
        AND datetime(ends_at) <= datetime('now')
    `
  );

  for (const raffle of dueRaffles) {
    await drawRaffle(db, raffle.id, raffle.store_id, "timer-auto");
  }
}

let initPromise = null;
async function ensureInitialized() {
  if (initPromise) {
    return initPromise;
  }

  initPromise = initDb();
  return initPromise;
}

// Local dev/server mode
if (require.main === module) {
  ensureInitialized()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`Servidor rodando em http://localhost:${PORT}`);
      });

      setInterval(() => {
        runAutoDraw().catch((error) => {
          console.error("Erro no auto sorteio:", error.message);
        });
      }, AUTO_DRAW_CHECK_INTERVAL_MS);
    })
    .catch((error) => {
      console.error("Erro ao iniciar aplicacao:", error);
      process.exit(1);
    });
}

// Vercel serverless mode
module.exports = {
  app,
  ensureInitialized
};
