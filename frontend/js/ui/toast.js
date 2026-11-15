// Polite status toast. AI-assisted code — see README "Use of AI".
let timer;
export function toast(msg, ms = 4200) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("is-on");
  clearTimeout(timer);
  timer = setTimeout(() => el.classList.remove("is-on"), ms);
}
