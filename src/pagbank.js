const PAGBANK_ENVIRONMENTS = {
  sandbox: "https://sandbox.api.pagseguro.com",
  production: "https://api.pagseguro.com"
};

function getPagBankConfig() {
  const environment = String(process.env.PAGBANK_ENV || "sandbox").trim().toLowerCase();
  const apiBaseUrl = PAGBANK_ENVIRONMENTS[environment] || PAGBANK_ENVIRONMENTS.sandbox;

  return {
    environment: PAGBANK_ENVIRONMENTS[environment] ? environment : "sandbox",
    apiBaseUrl,
    token: String(process.env.PAGBANK_TOKEN || "").trim()
  };
}

function isPagBankConfigured() {
  return Boolean(getPagBankConfig().token);
}

function getPayLink(checkout) {
  return checkout?.links?.find((link) => link.rel === "PAY" && link.href)?.href || "";
}

function getQrCodeLink(qrCode, rel) {
  return qrCode?.links?.find((link) => link.rel === rel && link.href)?.href || "";
}

function parsePagBankResponse(responseText) {
  try {
    return responseText ? JSON.parse(responseText) : null;
  } catch (_error) {
    return { raw: responseText };
  }
}

async function pagBankRequest(pathname, options = {}) {
  const config = getPagBankConfig();

  if (!config.token) {
    throw new Error("PAGBANK_TOKEN nao configurado no .env.");
  }

  const response = await fetch(`${config.apiBaseUrl}${pathname}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const responseText = await response.text();
  const data = parsePagBankResponse(responseText);

  if (!response.ok) {
    const detail = data?.error_messages?.[0]?.description || data?.message || responseText || "Erro desconhecido";
    throw new Error(`PagBank ${response.status}: ${detail}`);
  }

  return data;
}

function createPagBankCheckout(payload) {
  return pagBankRequest("/checkouts", {
    method: "POST",
    body: payload
  });
}

function createPagBankPixOrder(payload, idempotencyKey) {
  return pagBankRequest("/orders", {
    method: "POST",
    headers: idempotencyKey ? { "x-idempotency-key": idempotencyKey } : {},
    body: payload
  });
}

function getPagBankOrder(orderId) {
  return pagBankRequest(`/orders/${encodeURIComponent(orderId)}`);
}

module.exports = {
  createPagBankCheckout,
  createPagBankPixOrder,
  getPagBankOrder,
  getPayLink,
  getQrCodeLink,
  getPagBankConfig,
  isPagBankConfigured
};
