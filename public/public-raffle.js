const modalBackdrop = document.getElementById("entry-modal-backdrop");
const openModalButton = document.getElementById("open-entry-modal");
const closeModalButton = document.getElementById("close-entry-modal");
const entryForm = modalBackdrop?.querySelector("form") || null;
const cpfInput = entryForm?.querySelector("#participant_cpf") || null;
const whatsappInput = entryForm?.querySelector("#participant_whatsapp") || null;
const nameInput = entryForm?.querySelector("#participant_name") || null;

function openModal(backdrop, focusInput = false) {
  if (!backdrop) {
    return;
  }

  backdrop.classList.remove("hidden");

  if (focusInput) {
    const firstInput = backdrop.querySelector("input");
    if (firstInput) {
      firstInput.focus();
    }
  }
}

function closeModal(backdrop) {
  if (!backdrop) {
    return;
  }

  backdrop.classList.add("hidden");
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function formatCpf(value) {
  const digits = onlyDigits(value).slice(0, 11);
  if (!digits) {
    return "";
  }

  if (digits.length <= 3) {
    return digits;
  }
  if (digits.length <= 6) {
    return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  }
  if (digits.length <= 9) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  }
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function normalizeWhatsappDigits(value) {
  let digits = onlyDigits(value);
  if (digits.length > 11 && digits.startsWith("55")) {
    digits = digits.slice(2);
  }
  return digits.slice(0, 11);
}

function formatWhatsapp(value) {
  const digits = normalizeWhatsappDigits(value);
  if (!digits) {
    return "";
  }

  if (digits.length <= 2) {
    return `(${digits}`;
  }
  if (digits.length <= 6) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  }
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function showFloatingFlash(type, message) {
  if (!message) {
    return;
  }

  let flash = document.querySelector(".public-floating-flash");
  if (!flash) {
    flash = document.createElement("div");
    flash.className = "public-floating-flash";
    document.body.appendChild(flash);
  }

  flash.className = `public-floating-flash flash ${type}`;
  flash.textContent = message;

  if (type === "success") {
    window.setTimeout(() => {
      if (flash?.parentElement) {
        flash.remove();
      }
    }, 3200);
  }
}

function updateParticipantsCount(total) {
  document.querySelectorAll("[data-participants-count]").forEach((item) => {
    item.textContent = String(total);
  });
}

function lockPublicParticipationState() {
  const actionButton = document.getElementById("open-entry-modal");
  const heroSection = document.querySelector(".public-raffle-hero");

  if (actionButton) {
    actionButton.disabled = true;
    actionButton.textContent = "Voce ja esta inscrito";
    actionButton.classList.add("is-disabled");
    actionButton.removeAttribute("id");
  }

  if (heroSection && !heroSection.querySelector(".public-joined-note")) {
    const joinedNote = document.createElement("p");
    joinedNote.className = "public-joined-note";
    joinedNote.textContent = "Este dispositivo ja foi registrado neste sorteio.";

    if (actionButton?.parentElement === heroSection) {
      actionButton.insertAdjacentElement("afterend", joinedNote);
    } else {
      heroSection.appendChild(joinedNote);
    }
  }
}

async function submitPublicEntryWithoutReload(event) {
  event.preventDefault();

  if (!entryForm) {
    return;
  }

  const submitButton = entryForm.querySelector("button[type='submit']");
  if (submitButton) {
    submitButton.disabled = true;
  }

  if (nameInput) {
    nameInput.value = nameInput.value.trim().replace(/\s{2,}/g, " ");
  }
  if (cpfInput) {
    cpfInput.value = formatCpf(cpfInput.value);
  }
  if (whatsappInput) {
    whatsappInput.value = formatWhatsapp(whatsappInput.value);
  }

  try {
    const body = new URLSearchParams(new FormData(entryForm));
    const response = await fetch(entryForm.action, {
      method: "POST",
      body,
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "application/json"
      }
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      showFloatingFlash("error", payload?.message || "Nao foi possivel registrar sua participacao.");
      return;
    }

    showFloatingFlash("success", payload.message || "Participacao confirmada.");
    if (typeof payload.entriesCount === "number") {
      updateParticipantsCount(payload.entriesCount);
    }

    closeModal(modalBackdrop);
    entryForm.reset();
    lockPublicParticipationState();
  } catch (error) {
    showFloatingFlash("error", "Erro de conexao. Tente novamente.");
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
    }
  }
}

if (openModalButton) {
  openModalButton.addEventListener("click", () => openModal(modalBackdrop, true));
}

if (closeModalButton) {
  closeModalButton.addEventListener("click", () => closeModal(modalBackdrop));
}

if (entryForm) {
  entryForm.addEventListener("submit", submitPublicEntryWithoutReload);
}

if (cpfInput) {
  cpfInput.addEventListener("input", () => {
    cpfInput.value = formatCpf(cpfInput.value);
  });
}

if (whatsappInput) {
  whatsappInput.addEventListener("input", () => {
    whatsappInput.value = formatWhatsapp(whatsappInput.value);
  });
}

if (modalBackdrop) {
  modalBackdrop.addEventListener("click", (event) => {
    if (event.target === modalBackdrop) {
      closeModal(modalBackdrop);
    }
  });
}

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeModal(modalBackdrop);
  }
});
