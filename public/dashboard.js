let dashboardIsNavigating = false;
let dashboardTimerInterval = null;
let billingPixStatusInterval = null;

function formatDateForDisplay(date) {
  return date.toLocaleString("pt-BR");
}

function updateTimers() {
  const timerElements = document.querySelectorAll("[data-ends-at]");

  timerElements.forEach((element) => {
    const endsAtRaw = element.getAttribute("data-ends-at");
    if (!endsAtRaw) {
      return;
    }

    const endsAt = new Date(endsAtRaw);
    if (Number.isNaN(endsAt.getTime())) {
      return;
    }

    const now = new Date();
    const diffMs = endsAt.getTime() - now.getTime();

    if (diffMs <= 0) {
      element.textContent = `${formatDateForDisplay(endsAt)} (encerrado)`;
      return;
    }

    const totalSeconds = Math.floor(diffMs / 1000);
    const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");

    element.textContent = `${formatDateForDisplay(endsAt)} (faltam ${hours}:${minutes}:${seconds})`;
  });
}

function ensureTimerLoop() {
  updateTimers();
  if (dashboardTimerInterval) {
    return;
  }
  dashboardTimerInterval = window.setInterval(updateTimers, 1000);
}

async function copyLinkToClipboard(url, button) {
  try {
    await navigator.clipboard.writeText(url);
    const originalLabel = button.textContent;
    button.textContent = "Link copiado";
    setTimeout(() => {
      button.textContent = originalLabel;
    }, 1400);
  } catch (error) {
    window.prompt("Copie o link manualmente:", url);
  }
}

function getCreateRaffleModal() {
  return document.getElementById("create-raffle-modal");
}

function getActivityDetailModal() {
  return document.getElementById("activity-detail-modal");
}

function getDrawRaffleModal() {
  return document.getElementById("draw-raffle-modal");
}

function getClientDetailModal() {
  return document.getElementById("client-detail-modal");
}

function getBillingPixModal() {
  return document.getElementById("billing-pix-modal");
}

function getBillingPixElements() {
  const modal = getBillingPixModal();
  if (!modal) {
    return null;
  }

  return {
    modal,
    description: modal.querySelector("[data-billing-pix-description]"),
    loading: modal.querySelector("[data-billing-pix-loading]"),
    error: modal.querySelector("[data-billing-pix-error]"),
    content: modal.querySelector("[data-billing-pix-content]"),
    amount: modal.querySelector("[data-billing-pix-amount]"),
    qrImage: modal.querySelector("[data-billing-pix-qr]"),
    qrPlaceholder: modal.querySelector("[data-billing-pix-qr-placeholder]"),
    code: modal.querySelector("[data-billing-pix-code]"),
    status: modal.querySelector("[data-billing-pix-status]")
  };
}

function updateBodyScrollLock() {
  const hasOpenModal = document.querySelector(".saas-modal-backdrop:not(.hidden)");
  document.body.classList.toggle("no-scroll", Boolean(hasOpenModal));
}

function openCreateRaffleModal() {
  const createRaffleModal = getCreateRaffleModal();
  if (!createRaffleModal) {
    return;
  }

  createRaffleModal.classList.remove("hidden");
  updateBodyScrollLock();

  const firstInput = createRaffleModal.querySelector("input, textarea");
  if (firstInput) {
    firstInput.focus();
  }
}

function closeCreateRaffleModal() {
  const createRaffleModal = getCreateRaffleModal();
  if (!createRaffleModal) {
    updateBodyScrollLock();
    return;
  }

  createRaffleModal.classList.add("hidden");
  updateBodyScrollLock();
}

function closeActivityDetailModal() {
  const activityModal = getActivityDetailModal();
  if (!activityModal) {
    updateBodyScrollLock();
    return;
  }

  activityModal.classList.add("hidden");
  updateBodyScrollLock();
}

function closeDrawRaffleModal() {
  const drawModal = getDrawRaffleModal();
  if (!drawModal) {
    updateBodyScrollLock();
    return;
  }

  drawModal.classList.add("hidden");
  updateBodyScrollLock();
}

function closeClientDetailModal() {
  const clientModal = getClientDetailModal();
  if (!clientModal) {
    updateBodyScrollLock();
    return;
  }

  clientModal.classList.add("hidden");
  updateBodyScrollLock();
}

function clearBillingPixStatusInterval() {
  if (billingPixStatusInterval) {
    window.clearInterval(billingPixStatusInterval);
    billingPixStatusInterval = null;
  }
}

function closeBillingPixModal() {
  const pixModal = getBillingPixModal();
  clearBillingPixStatusInterval();

  if (!pixModal) {
    updateBodyScrollLock();
    return;
  }

  pixModal.classList.add("hidden");
  updateBodyScrollLock();
}

function resetBillingPixModal() {
  const elements = getBillingPixElements();
  if (!elements) {
    return null;
  }

  clearBillingPixStatusInterval();
  elements.modal.dataset.paymentId = "";
  elements.modal.classList.remove("hidden");
  elements.loading?.classList.remove("hidden");
  elements.error?.classList.add("hidden");
  elements.content?.classList.add("hidden");

  if (elements.description) {
    elements.description.textContent = "Gerando cobranca segura pelo PagBank.";
  }
  if (elements.error) {
    elements.error.textContent = "";
  }
  if (elements.status) {
    elements.status.textContent = "Aguardando pagamento.";
  }
  if (elements.code) {
    elements.code.value = "";
  }
  if (elements.qrImage) {
    elements.qrImage.removeAttribute("src");
    elements.qrImage.classList.add("hidden");
  }
  if (elements.qrPlaceholder) {
    elements.qrPlaceholder.classList.remove("hidden");
  }

  updateBodyScrollLock();
  return elements;
}

function showBillingPixError(message) {
  const elements = getBillingPixElements();
  if (!elements) {
    return;
  }

  elements.loading?.classList.add("hidden");
  elements.content?.classList.add("hidden");
  elements.error?.classList.remove("hidden");
  if (elements.error) {
    elements.error.textContent = message || "Nao foi possivel gerar o Pix.";
  }
}

function isFinalPaymentStatus(status) {
  return ["Pago", "Cancelada", "Vencida"].includes(String(status || ""));
}

function renderBillingPixPayment(payment) {
  const elements = getBillingPixElements();
  if (!elements || !payment) {
    return;
  }

  elements.modal.dataset.paymentId = String(payment.id || "");
  elements.loading?.classList.add("hidden");
  elements.error?.classList.add("hidden");
  elements.content?.classList.remove("hidden");

  if (elements.description) {
    elements.description.textContent = payment.description || "Fatura CitySorteios";
  }
  if (elements.amount) {
    elements.amount.textContent = payment.amount || "--";
  }
  if (elements.code) {
    elements.code.value = payment.pixCode || "";
  }
  if (elements.status) {
    elements.status.textContent =
      payment.status === "Pago"
        ? "Pagamento confirmado."
        : payment.status === "Cancelada"
          ? "Pagamento cancelado."
          : payment.status === "Vencida"
            ? "Pix vencido. Gere uma nova cobranca."
            : "Aguardando pagamento pelo PagBank.";
  }

  if (elements.qrImage && elements.qrPlaceholder) {
    if (payment.qrCodeImageUrl) {
      elements.qrImage.onload = () => {
        elements.qrImage.classList.remove("hidden");
        elements.qrPlaceholder.classList.add("hidden");
      };
      elements.qrImage.onerror = () => {
        elements.qrImage.classList.add("hidden");
        elements.qrPlaceholder.classList.remove("hidden");
      };
      elements.qrImage.src = payment.qrCodeImageUrl;
    } else {
      elements.qrImage.classList.add("hidden");
      elements.qrPlaceholder.classList.remove("hidden");
    }
  }

  if (isFinalPaymentStatus(payment.status)) {
    clearBillingPixStatusInterval();
  }
}

async function refreshBillingPixStatus(paymentId) {
  if (!paymentId) {
    return;
  }

  try {
    const response = await fetch(`/dashboard/billing/pagbank/payments/${paymentId}`, {
      headers: {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest"
      }
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      return;
    }

    renderBillingPixPayment(payload.payment);
    if (payload.payment?.status === "Pago") {
      window.setTimeout(() => {
        navigateDashboard("/dashboard?tab=plano", false);
      }, 1600);
    }
  } catch (error) {
    const elements = getBillingPixElements();
    if (elements?.status) {
      elements.status.textContent = "Nao foi possivel verificar agora. O webhook tambem atualiza automaticamente.";
    }
  }
}

function startBillingPixStatusPolling(paymentId) {
  clearBillingPixStatusInterval();
  if (!paymentId) {
    return;
  }

  billingPixStatusInterval = window.setInterval(() => {
    refreshBillingPixStatus(paymentId);
  }, 8000);
}

async function openBillingPixModal() {
  const elements = resetBillingPixModal();
  if (!elements) {
    return;
  }

  try {
    const response = await fetch("/dashboard/billing/pagbank/pix", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest"
      }
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload?.ok) {
      showBillingPixError(payload?.message || "Nao foi possivel gerar o Pix.");
      return;
    }

    renderBillingPixPayment(payload.payment);
    startBillingPixStatusPolling(payload.payment?.id);
  } catch (error) {
    showBillingPixError("Erro de conexao ao gerar o Pix.");
  }
}

async function copyBillingPixCode() {
  const elements = getBillingPixElements();
  const copyButton = elements?.modal.querySelector("[data-copy-billing-pix]");
  const code = elements?.code?.value || "";

  if (!code || !copyButton) {
    return;
  }

  await copyLinkToClipboard(code, copyButton);
}

function createClientDetailItem(title, meta, extra) {
  const item = document.createElement("article");
  const titleElement = document.createElement("strong");
  const metaElement = document.createElement("span");
  titleElement.textContent = title || "Sorteio";
  metaElement.textContent = meta || "";
  item.append(titleElement, metaElement);

  if (extra) {
    const extraElement = document.createElement("small");
    extraElement.textContent = extra;
    item.append(extraElement);
  }

  return item;
}

function renderClientDetailList(listElement, items, emptyMessage, mapper) {
  listElement.innerHTML = "";

  if (!Array.isArray(items) || !items.length) {
    const emptyItem = document.createElement("p");
    emptyItem.className = "saas-muted";
    emptyItem.textContent = emptyMessage;
    listElement.append(emptyItem);
    return;
  }

  items.forEach((item) => {
    listElement.append(mapper(item));
  });
}

async function openClientDetailModal(clientId) {
  const clientModal = getClientDetailModal();
  if (!clientModal || !clientId) {
    return;
  }

  const nameElement = clientModal.querySelector("[data-client-detail-name]");
  const totalElement = clientModal.querySelector("[data-client-detail-total]");
  const cpfElement = clientModal.querySelector("[data-client-detail-cpf]");
  const whatsappElement = clientModal.querySelector("[data-client-detail-whatsapp]");
  const lastElement = clientModal.querySelector("[data-client-detail-last]");
  const participationsList = clientModal.querySelector("[data-client-participations-list]");
  const winsList = clientModal.querySelector("[data-client-wins-list]");

  if (!nameElement || !totalElement || !cpfElement || !whatsappElement || !lastElement || !participationsList || !winsList) {
    return;
  }

  nameElement.textContent = "Carregando cliente...";
  totalElement.textContent = "";
  cpfElement.textContent = "--";
  whatsappElement.textContent = "--";
  lastElement.textContent = "--";
  participationsList.innerHTML = '<p class="saas-muted">Carregando participacoes...</p>';
  winsList.innerHTML = '<p class="saas-muted">Carregando resultados...</p>';
  clientModal.classList.remove("hidden");
  updateBodyScrollLock();

  try {
    const response = await fetch(`/dashboard/clientes/${clientId}/details`, {
      headers: {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest"
      }
    });
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || "Nao foi possivel carregar o cliente.");
    }

    const client = payload.client || {};
    nameElement.textContent = client.participant_name || "Cliente";
    totalElement.textContent = `${client.total_entries || 0} participacao(oes)`;
    cpfElement.textContent = client.participant_cpf || "--";
    whatsappElement.textContent = client.participant_whatsapp || "--";
    lastElement.textContent = client.last_entry_at || "--";

    renderClientDetailList(
      participationsList,
      payload.participations,
      "Nenhuma participacao encontrada.",
      (participation) =>
        createClientDetailItem(
          participation.title,
          `Premio: ${participation.prize || "--"}`,
          `Participou em: ${participation.participated_at || "--"}`
        )
    );

    renderClientDetailList(
      winsList,
      payload.wins,
      "Nenhum sorteio ganho ainda.",
      (win) =>
        createClientDetailItem(
          win.title,
          `Premio: ${win.prize || "--"}`,
          `Sorteado em: ${win.drawn_at || "--"}`
        )
    );
  } catch (error) {
    nameElement.textContent = "Nao foi possivel carregar";
    totalElement.textContent = "";
    participationsList.innerHTML = '<p class="saas-muted">Tente abrir o cliente novamente.</p>';
    winsList.innerHTML = "";
  }
}

function resetDrawModal(title) {
  const drawModal = getDrawRaffleModal();
  if (!drawModal) {
    return null;
  }

  const titleElement = drawModal.querySelector("[data-draw-modal-title]");
  const countdownElement = drawModal.querySelector("[data-draw-countdown]");
  const statusElement = drawModal.querySelector("[data-draw-modal-status]");
  const winnerBox = drawModal.querySelector("[data-draw-winner-box]");
  const winnerName = drawModal.querySelector("[data-draw-winner-name]");
  const confettiLayer = drawModal.querySelector("[data-draw-confetti]");

  if (titleElement) {
    titleElement.textContent = title ? `Sorteando: ${title}` : "Preparando sorteio";
  }
  if (countdownElement) {
    countdownElement.textContent = "5";
    countdownElement.classList.remove("done");
  }
  if (statusElement) {
    statusElement.textContent = "Segurando a ansiedade...";
  }
  if (winnerBox) {
    winnerBox.classList.add("hidden");
  }
  if (winnerName) {
    winnerName.textContent = "";
  }
  if (confettiLayer) {
    confettiLayer.innerHTML = "";
  }

  drawModal.classList.remove("hidden");
  updateBodyScrollLock();
  return drawModal;
}

function runDrawCountdown(drawModal) {
  const countdownElement = drawModal.querySelector("[data-draw-countdown]");
  const statusElement = drawModal.querySelector("[data-draw-modal-status]");
  const labels = {
    5: "Misturando os participantes...",
    4: "Quase la...",
    3: "A sorte esta girando...",
    2: "Preparando a revelacao...",
    1: "Valendo..."
  };
  let current = 5;

  if (countdownElement) {
    countdownElement.textContent = String(current);
  }
  if (statusElement) {
    statusElement.textContent = labels[current];
  }

  return new Promise((resolve) => {
    const intervalId = window.setInterval(() => {
      current -= 1;

      if (current <= 0) {
        window.clearInterval(intervalId);
        if (countdownElement) {
          countdownElement.textContent = "";
          countdownElement.classList.add("done");
        }
        resolve();
        return;
      }

      if (countdownElement) {
        countdownElement.textContent = String(current);
      }
      if (statusElement) {
        statusElement.textContent = labels[current] || "Sorteando...";
      }
    }, 1000);
  });
}

function launchDrawConfetti(drawModal) {
  const confettiLayer = drawModal.querySelector("[data-draw-confetti]");
  if (!confettiLayer) {
    return;
  }

  confettiLayer.innerHTML = "";
  const colors = ["#6f35f2", "#ffb000", "#25c2a0", "#ff4f8b", "#246bfe"];

  for (let index = 0; index < 42; index += 1) {
    const piece = document.createElement("span");
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[index % colors.length];
    piece.style.animationDelay = `${Math.random() * 0.45}s`;
    piece.style.animationDuration = `${1.7 + Math.random() * 1.2}s`;
    piece.style.transform = `rotate(${Math.random() * 180}deg)`;
    confettiLayer.append(piece);
  }
}

function revealDrawWinner(drawModal, winner) {
  const countdownElement = drawModal.querySelector("[data-draw-countdown]");
  const statusElement = drawModal.querySelector("[data-draw-modal-status]");
  const winnerBox = drawModal.querySelector("[data-draw-winner-box]");
  const winnerName = drawModal.querySelector("[data-draw-winner-name]");

  if (countdownElement) {
    countdownElement.textContent = "OK";
    countdownElement.classList.add("done");
  }
  if (statusElement) {
    statusElement.textContent = "Resultado definido.";
  }
  if (winnerName) {
    winnerName.textContent = winner || "Sem vencedor";
  }
  if (winnerBox) {
    winnerBox.classList.remove("hidden");
  }

  launchDrawConfetti(drawModal);
}

function showDrawError(drawModal, message) {
  const countdownElement = drawModal.querySelector("[data-draw-countdown]");
  const statusElement = drawModal.querySelector("[data-draw-modal-status]");

  if (countdownElement) {
    countdownElement.textContent = "!";
    countdownElement.classList.add("done");
  }
  if (statusElement) {
    statusElement.textContent = message || "Nao foi possivel realizar o sorteio.";
  }
}

function getRecentActivityData() {
  const activityDataElement = document.getElementById("recent-activity-data");
  if (!activityDataElement) {
    return [];
  }

  try {
    const parsed = JSON.parse(activityDataElement.textContent || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function openActivityDetailModal(activityId, activityIndexRaw) {
  const activityModal = getActivityDetailModal();
  if (!activityModal) {
    return;
  }

  const recentActivity = getRecentActivityData();
  let selectedActivity = recentActivity.find((activity) => String(activity.raffleId) === String(activityId));

  if (!selectedActivity) {
    const activityIndex = Number.parseInt(String(activityIndexRaw || ""), 10);
    if (Number.isInteger(activityIndex) && activityIndex >= 0 && activityIndex < recentActivity.length) {
      selectedActivity = recentActivity[activityIndex];
    }
  }

  if (!selectedActivity) {
    return;
  }

  const titleElement = activityModal.querySelector("[data-activity-modal-title]");
  const summaryElement = activityModal.querySelector("[data-activity-modal-summary]");
  const eventsListElement = activityModal.querySelector("[data-activity-modal-events]");

  if (!titleElement || !summaryElement || !eventsListElement) {
    return;
  }

  titleElement.textContent =
    selectedActivity.raffleTitle ||
    selectedActivity.label ||
    `Sorteio #${selectedActivity.raffleId || "-"}`;
  summaryElement.textContent = selectedActivity.summary || selectedActivity.label || "Atualizacao registrada.";
  eventsListElement.innerHTML = "";

  const events = Array.isArray(selectedActivity.events)
    ? selectedActivity.events
    : selectedActivity.label || selectedActivity.at
      ? [
          {
            label: selectedActivity.label || "Atualizacao",
            at: selectedActivity.at || selectedActivity.latestAt || ""
          }
        ]
      : [];
  if (!events.length) {
    const emptyItem = document.createElement("li");
    const emptyLabel = document.createElement("strong");
    emptyLabel.textContent = "Nenhum evento encontrado.";
    emptyItem.append(emptyLabel);
    eventsListElement.append(emptyItem);
  } else {
    events.forEach((eventItem) => {
      const listItem = document.createElement("li");
      const label = document.createElement("strong");
      const at = document.createElement("span");
      label.textContent = eventItem.label || "Evento";
      at.textContent = eventItem.at || "";
      listItem.append(label, at);
      eventsListElement.append(listItem);
    });
  }

  activityModal.classList.remove("hidden");
  updateBodyScrollLock();
}

function normalizeHexColor(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  const withHash = raw.startsWith("#") ? raw : `#${raw}`;
  if (!/^#[0-9a-fA-F]{6}$/.test(withHash)) {
    return null;
  }

  return withHash.toLowerCase();
}

function syncColorPicker(picker) {
  const nativeInput = picker.querySelector("[data-color-native]");
  const hexInput = picker.querySelector("[data-color-hex]");

  if (!nativeInput || !hexInput) {
    return;
  }

  const initial = normalizeHexColor(hexInput.value) || normalizeHexColor(nativeInput.value) || "#6a3df0";
  nativeInput.value = initial;
  hexInput.value = initial;
}

function setupColorPickers() {
  document.querySelectorAll("[data-color-picker]").forEach((picker) => {
    syncColorPicker(picker);
  });
}

function normalizeClientSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function filterClients(searchInput) {
  const clientsSection = searchInput.closest(".panel-card");
  if (!clientsSection) {
    return;
  }

  const query = normalizeClientSearch(searchInput.value);
  const queryDigits = String(searchInput.value || "").replace(/\D/g, "");
  const clientRows = Array.from(clientsSection.querySelectorAll("[data-client-row]"));
  const visibleCountElement = clientsSection.querySelector("[data-clients-visible-count]");
  const emptySearchElement = clientsSection.querySelector("[data-clients-empty-search]");
  let visibleCount = 0;

  clientRows.forEach((row) => {
    const rowText = normalizeClientSearch(row.dataset.clientSearchText || row.textContent);
    const rowDigits = String(row.dataset.clientSearchText || row.textContent).replace(/\D/g, "");
    const matchesText = !query || rowText.includes(query);
    const matchesDigits = Boolean(queryDigits && rowDigits.includes(queryDigits));
    const shouldShow = matchesText || matchesDigits;

    row.classList.toggle("client-row-hidden", !shouldShow);
    if (shouldShow) {
      visibleCount += 1;
    }
  });

  if (visibleCountElement) {
    visibleCountElement.textContent = `${visibleCount} resultado(s)`;
  }

  if (emptySearchElement) {
    emptySearchElement.classList.toggle("hidden", visibleCount > 0);
  }
}

function extractDashboardTab(urlValue) {
  try {
    const url = new URL(urlValue, window.location.origin);
    if (url.pathname !== "/dashboard") {
      return null;
    }
    const tab = String(url.searchParams.get("tab") || "")
      .trim()
      .toLowerCase();
    return tab || null;
  } catch (error) {
    return null;
  }
}

function updateDashboardMenuActive(urlValue) {
  const activeTab = extractDashboardTab(urlValue);
  if (!activeTab) {
    return;
  }

  document.querySelectorAll(".saas-menu-item[href]").forEach((menuItem) => {
    const itemTab = extractDashboardTab(menuItem.getAttribute("href"));
    menuItem.classList.toggle("active", itemTab === activeTab);
  });
}

function shouldHandleDashboardLink(anchor, event) {
  if (!anchor || !event) {
    return false;
  }

  if (anchor.target && anchor.target !== "_self") {
    return false;
  }

  if (anchor.hasAttribute("download")) {
    return false;
  }

  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return false;
  }

  if (event.button !== 0) {
    return false;
  }

  return Boolean(extractDashboardTab(anchor.href));
}

function isRaffleDrawForm(form) {
  if (!form || !form.action) {
    return false;
  }

  try {
    const url = new URL(form.action, window.location.origin);
    return /^\/raffles\/\d+\/draw$/.test(url.pathname);
  } catch (error) {
    return false;
  }
}

async function navigateDashboard(urlValue, pushState = true) {
  if (dashboardIsNavigating) {
    return;
  }

  dashboardIsNavigating = true;
  try {
    const response = await fetch(urlValue, {
      headers: {
        "X-Requested-With": "XMLHttpRequest"
      }
    });

    if (!response.ok) {
      window.location.href = urlValue;
      return;
    }

    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const newMain = doc.querySelector(".saas-main");
    const currentMain = document.querySelector(".saas-main");

    if (!newMain || !currentMain) {
      window.location.href = urlValue;
      return;
    }

    currentMain.replaceWith(newMain);

    const newTitle = doc.querySelector("title");
    if (newTitle?.textContent) {
      document.title = newTitle.textContent;
    }

    updateDashboardMenuActive(urlValue);
    setupColorPickers();
    updateTimers();
    closeCreateRaffleModal();
    closeActivityDetailModal();
    closeDrawRaffleModal();
    closeClientDetailModal();
    closeBillingPixModal();
    updateBodyScrollLock();

    if (pushState) {
      window.history.pushState({ url: urlValue }, "", urlValue);
    }
  } catch (error) {
    window.location.href = urlValue;
  } finally {
    dashboardIsNavigating = false;
  }
}

async function submitDrawFormWithoutReload(form) {
  if (!form) {
    return;
  }

  const raffleTitle = form.closest("article")?.querySelector("h3")?.textContent?.trim() || "Sorteio";
  const drawModal = resetDrawModal(raffleTitle);
  if (!drawModal) {
    form.submit();
    return;
  }

  const submitButton = form.querySelector("button[type='submit']");
  if (submitButton) {
    submitButton.disabled = true;
  }

  const countdownPromise = runDrawCountdown(drawModal);

  try {
    const body = new URLSearchParams(new FormData(form));
    const response = await fetch(form.action, {
      method: "POST",
      body,
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
      }
    });

    let payload = {};
    try {
      payload = await response.json();
    } catch (error) {
      payload = {};
    }

    await countdownPromise;

    if (!response.ok || !payload.ok) {
      showDrawError(drawModal, payload.message || "Nao foi possivel realizar o sorteio.");
      return;
    }

    revealDrawWinner(drawModal, payload.winner);

    const redirectTab =
      form.querySelector("input[name='redirect_tab']")?.value || extractDashboardTab(window.location.href) || "sorteios";
    window.setTimeout(() => {
      navigateDashboard(payload.redirectUrl || `/dashboard?tab=${redirectTab}`, false);
    }, 3200);
  } catch (error) {
    await countdownPromise;
    showDrawError(drawModal, "Nao foi possivel realizar o sorteio.");
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
    }
  }
}

document.addEventListener("click", (event) => {
  const copyButton = event.target.closest("[data-copy-url]");
  if (copyButton) {
    event.preventDefault();
    copyLinkToClipboard(copyButton.dataset.copyUrl, copyButton);
    return;
  }

  const openCreateButton = event.target.closest("#open-create-raffle-modal, [data-open-create-modal]");
  if (openCreateButton) {
    event.preventDefault();
    openCreateRaffleModal();
    return;
  }

  const closeCreateButton = event.target.closest("#close-create-raffle-modal");
  if (closeCreateButton) {
    event.preventDefault();
    closeCreateRaffleModal();
    return;
  }

  const openActivityButton = event.target.closest("[data-open-activity-modal]");
  if (openActivityButton) {
    event.preventDefault();
    openActivityDetailModal(
      openActivityButton.getAttribute("data-activity-id"),
      openActivityButton.getAttribute("data-activity-index")
    );
    return;
  }

  const closeActivityButton = event.target.closest("#close-activity-detail-modal");
  if (closeActivityButton) {
    event.preventDefault();
    closeActivityDetailModal();
    return;
  }

  const closeDrawButton = event.target.closest("#close-draw-raffle-modal");
  if (closeDrawButton) {
    event.preventDefault();
    closeDrawRaffleModal();
    return;
  }

  const closeClientButton = event.target.closest("#close-client-detail-modal");
  if (closeClientButton) {
    event.preventDefault();
    closeClientDetailModal();
    return;
  }

  const openBillingPixButton = event.target.closest("[data-open-billing-pix]");
  if (openBillingPixButton) {
    event.preventDefault();
    openBillingPixModal();
    return;
  }

  const closeBillingPixButton = event.target.closest("#close-billing-pix-modal");
  if (closeBillingPixButton) {
    event.preventDefault();
    closeBillingPixModal();
    return;
  }

  const copyBillingPixButton = event.target.closest("[data-copy-billing-pix]");
  if (copyBillingPixButton) {
    event.preventDefault();
    copyBillingPixCode();
    return;
  }

  const refreshBillingPixButton = event.target.closest("[data-refresh-billing-pix]");
  if (refreshBillingPixButton) {
    event.preventDefault();
    const pixModal = getBillingPixModal();
    refreshBillingPixStatus(pixModal?.dataset.paymentId);
    return;
  }

  const clientRow = event.target.closest("[data-open-client-details]");
  if (clientRow) {
    event.preventDefault();
    openClientDetailModal(clientRow.getAttribute("data-client-id"));
    return;
  }

  const createRaffleModal = getCreateRaffleModal();
  if (createRaffleModal && event.target === createRaffleModal) {
    closeCreateRaffleModal();
    return;
  }

  const activityModal = getActivityDetailModal();
  if (activityModal && event.target === activityModal) {
    closeActivityDetailModal();
    return;
  }

  const drawModal = getDrawRaffleModal();
  if (drawModal && event.target === drawModal) {
    closeDrawRaffleModal();
    return;
  }

  const clientModal = getClientDetailModal();
  if (clientModal && event.target === clientModal) {
    closeClientDetailModal();
    return;
  }

  const billingPixModal = getBillingPixModal();
  if (billingPixModal && event.target === billingPixModal) {
    closeBillingPixModal();
    return;
  }

  const anchor = event.target.closest("a[href]");
  if (anchor && shouldHandleDashboardLink(anchor, event)) {
    event.preventDefault();
    navigateDashboard(anchor.href, true);
  }
});

document.addEventListener("input", (event) => {
  const clientsSearchInput = event.target.closest("[data-clients-search]");
  if (clientsSearchInput) {
    filterClients(clientsSearchInput);
    return;
  }

  const nativeInput = event.target.closest("[data-color-native]");
  if (nativeInput) {
    const picker = nativeInput.closest("[data-color-picker]");
    const hexInput = picker?.querySelector("[data-color-hex]");
    if (hexInput) {
      hexInput.value = nativeInput.value.toLowerCase();
    }
    return;
  }

  const hexInput = event.target.closest("[data-color-hex]");
  if (!hexInput) {
    return;
  }

  const normalized = normalizeHexColor(hexInput.value);
  if (!normalized) {
    return;
  }

  const picker = hexInput.closest("[data-color-picker]");
  const native = picker?.querySelector("[data-color-native]");
  if (native) {
    native.value = normalized;
  }
});

document.addEventListener("submit", (event) => {
  const form = event.target.closest("form");
  if (!isRaffleDrawForm(form)) {
    return;
  }

  event.preventDefault();
  submitDrawFormWithoutReload(form);
});

document.addEventListener(
  "blur",
  (event) => {
    const hexInput = event.target.closest("[data-color-hex]");
    if (!hexInput) {
      return;
    }

    const picker = hexInput.closest("[data-color-picker]");
    const native = picker?.querySelector("[data-color-native]");
    if (!native) {
      return;
    }

    const normalized = normalizeHexColor(hexInput.value);
    hexInput.value = normalized || native.value.toLowerCase();
  },
  true
);

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeCreateRaffleModal();
    closeActivityDetailModal();
    closeDrawRaffleModal();
    closeClientDetailModal();
    closeBillingPixModal();
    return;
  }

  if (event.key === "Enter") {
    const clientRow = event.target.closest?.("[data-open-client-details]");
    if (clientRow) {
      event.preventDefault();
      openClientDetailModal(clientRow.getAttribute("data-client-id"));
    }
  }
});

window.addEventListener("popstate", () => {
  if (window.location.pathname === "/dashboard") {
    navigateDashboard(window.location.href, false);
  }
});

updateDashboardMenuActive(window.location.href);
setupColorPickers();
ensureTimerLoop();
