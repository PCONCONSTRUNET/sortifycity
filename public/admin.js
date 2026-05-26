let adminIsNavigating = false;

function extractAdminTab(urlValue) {
  try {
    const url = new URL(urlValue, window.location.origin);
    if (url.pathname !== "/admin") {
      return null;
    }

    const tab = String(url.searchParams.get("tab") || "")
      .trim()
      .toLowerCase();
    return tab || "dashboard";
  } catch (error) {
    return null;
  }
}

function updateAdminMenuActive(urlValue) {
  const activeTab = extractAdminTab(urlValue);
  if (!activeTab) {
    return;
  }

  document.querySelectorAll(".saas-menu-item[href]").forEach((menuItem) => {
    const itemTab = extractAdminTab(menuItem.getAttribute("href"));
    menuItem.classList.toggle("active", itemTab === activeTab);
  });
}

function shouldHandleAdminLink(anchor, event) {
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

  return Boolean(extractAdminTab(anchor.href));
}

async function navigateAdmin(urlValue, pushState = true) {
  if (adminIsNavigating) {
    return;
  }

  adminIsNavigating = true;
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
    const newMain = doc.querySelector(".admin-main");
    const currentMain = document.querySelector(".admin-main");

    if (!newMain || !currentMain) {
      window.location.href = urlValue;
      return;
    }

    currentMain.replaceWith(newMain);

    const newTitle = doc.querySelector("title");
    if (newTitle?.textContent) {
      document.title = newTitle.textContent;
    }

    updateAdminMenuActive(urlValue);
    window.scrollTo(0, 0);

    if (pushState) {
      window.history.pushState({ url: urlValue }, "", urlValue);
    }
  } catch (error) {
    window.location.href = urlValue;
  } finally {
    adminIsNavigating = false;
  }
}

document.addEventListener("click", (event) => {
  const anchor = event.target.closest("a[href]");
  if (!shouldHandleAdminLink(anchor, event)) {
    return;
  }

  event.preventDefault();
  navigateAdmin(anchor.href, true);
});

document.addEventListener("submit", (event) => {
  const form = event.target.closest(".admin-filter-bar");
  if (!form || String(form.method || "").toLowerCase() !== "get") {
    return;
  }

  event.preventDefault();
  const formData = new FormData(form);
  const url = new URL(form.action || window.location.href, window.location.origin);
  url.search = "";

  formData.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

  navigateAdmin(url.href, true);
});

window.addEventListener("popstate", () => {
  if (window.location.pathname === "/admin") {
    navigateAdmin(window.location.href, false);
  }
});

updateAdminMenuActive(window.location.href);
