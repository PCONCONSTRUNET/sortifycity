const tabButtons = document.querySelectorAll("[data-target]");
const tabContents = document.querySelectorAll(".tab-content");

function switchTab(targetId) {
  tabButtons.forEach((item) => item.classList.remove("active"));
  tabContents.forEach((item) => item.classList.remove("active"));

  const target = document.getElementById(targetId);
  if (!target) {
    return;
  }

  target.classList.add("active");

  tabButtons.forEach((button) => {
    if (button.dataset.target === targetId) {
      button.classList.add("active");
    }
  });
}

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    switchTab(button.dataset.target);
  });
});

document.querySelectorAll("[data-switch-target]").forEach((button) => {
  button.addEventListener("click", () => {
    switchTab(button.dataset.switchTarget);
  });
});
