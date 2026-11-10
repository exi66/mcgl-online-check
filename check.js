try {
  process.loadEnvFile();
} catch {}

const POSTS = (process.env.POSTS || "")
  .split(/[,\s]+/)
  .map((s) => s.trim())
  .filter(Boolean);

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK || "";

const INTERVAL_MS = (Number(process.env.INTERVAL_SEC) || 60) * 1000;

if (!POSTS.length) {
  console.error("POSTS is empty, nothing to check");
  process.exit(1);
}
if (!DISCORD_WEBHOOK) {
  console.warn("DISCORD_WEBHOOK is empty, notifications will not be sent");
}

// Корректная остановка контейнера (node как PID 1 игнорирует сигналы без обработчика)
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => process.exit(0));

// url -> { game, forum }
const lastState = new Map();

async function getPage(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function parse(html, url) {
  // Блок автора поста: <div class="login"><img .../><a ...>Ник</a> <img .../></div>
  const postId = url.match(/\/post\/(\d+)/)?.[1];
  let scope = html;
  if (postId) {
    const i = html.indexOf(`id='row1-${postId}'`);
    if (i !== -1) scope = html.slice(i);
  }

  const login = scope.match(/<div class="login">([\s\S]*?)<\/div>/);
  if (!login) return null;

  // Первый кружок (до ника) — игра, второй (после ника) — форум
  const m = login[1].match(
    /<img src="\/img\/(online|offline)\.png"[^>]*>\s*<a[^>]*>([^<]+)<\/a>\s*<img src="\/img\/(online|offline)\.png"/,
  );
  if (!m) return null;

  return {
    name: m[2].trim(),
    game: m[1] === "online",
    forum: m[3] === "online",
  };
}

async function sendDiscord(content) {
  if (!DISCORD_WEBHOOK) return;
  try {
    const res = await fetch(DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) console.error("Discord: ", res.status, await res.text());
  } catch (e) {
    console.error("Discord: ", e.message);
  }
}

async function checkOne(url) {
  try {
    const html = await getPage(url);
    const info = parse(html, url);
    if (!info) return;

    const prev = lastState.get(url);
    lastState.set(url, { game: info.game, forum: info.forum });

    // Первая проверка только запоминает состояние, уведомляем лишь об изменениях
    if (!prev) return;

    for (const [key, label] of [
      ["game", "в игре"],
      ["forum", "на форуме"],
    ]) {
      if (prev[key] === info[key]) continue;
      await sendDiscord(
        info[key]
          ? `🟢 **${info.name}** онлайн ${label}`
          : `🔴 **${info.name}** не в сети ${label}`,
      );
    }
  } catch {
    // ошибки запроса к форуму игнорируем, попробуем в следующий раз
  }
}

async function checkAll() {
  for (const url of POSTS) await checkOne(url);
}

checkAll();
setInterval(checkAll, INTERVAL_MS);
