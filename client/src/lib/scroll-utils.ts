export function scrollAppToTop() {
  requestAnimationFrame(() => {
    document.getElementById("app-main-content")?.scrollTo({ top: 0, left: 0, behavior: "auto" });
  });
}
