(() => {
  try {
    const theme = localStorage.getItem("office-tone-theme");
    if (theme === "light" || theme === "dark") {
      document.documentElement.dataset.theme = theme;
    }
  } catch {
    // Keep the system theme when storage is unavailable.
  }
})();
