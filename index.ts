import { Hono } from "hono";
import Database from "bun:sqlite";
import { mkdir } from "node:fs/promises";

await mkdir("./data", { recursive: true });

const db = new Database(process.env.DATABASE_URL || "./data/apod.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS apod_cache (
    date TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  )
`);

const app = new Hono();

async function fetchAPOD(date?: string): Promise<Record<string, unknown>> {
  const apiKey = process.env.NASA_API_KEY;
  if (!apiKey) {
    throw new Error("NASA_API_KEY secret is not set. Please set it in the deployment secrets.");
  }

  const targetDate = date || new Date().toISOString().split("T")[0];

  // Check cache (valid for 12 hours)
  const cached = db.query<{ data: string; fetched_at: number }, [string]>(
    "SELECT data, fetched_at FROM apod_cache WHERE date = ?"
  ).get(targetDate);

  if (cached && Date.now() - cached.fetched_at < 12 * 60 * 60 * 1000) {
    return JSON.parse(cached.data);
  }

  const url = `https://api.nasa.gov/planetary/apod?api_key=${apiKey}&date=${targetDate}`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ msg: res.statusText }));
    throw new Error((err as Record<string, unknown>).msg as string || res.statusText);
  }

  const data = await res.json() as Record<string, unknown>;

  db.query("INSERT OR REPLACE INTO apod_cache (date, data, fetched_at) VALUES (?, ?, ?)").run(
    targetDate,
    JSON.stringify(data),
    Date.now()
  );

  return data;
}

// API endpoint
app.get("/api/apod", async (c) => {
  const date = c.req.query("date");
  try {
    const data = await fetchAPOD(date);
    return c.json(data);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// Serve the HTML page
app.get("/", (c) => {
  return c.html(/* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NASA Astronomy Picture of the Day</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #050a14;
      --surface: #0d1626;
      --surface2: #131e30;
      --border: rgba(255,255,255,0.08);
      --accent: #4f8ef7;
      --accent2: #a78bfa;
      --text: #e8edf5;
      --text-muted: #8896a8;
      --gold: #f5c542;
    }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Inter', sans-serif;
      min-height: 100vh;
      overflow-x: hidden;
    }

    /* Star field background */
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      background-image:
        radial-gradient(1px 1px at 20% 30%, rgba(255,255,255,0.4) 0%, transparent 100%),
        radial-gradient(1px 1px at 80% 10%, rgba(255,255,255,0.3) 0%, transparent 100%),
        radial-gradient(1px 1px at 50% 60%, rgba(255,255,255,0.3) 0%, transparent 100%),
        radial-gradient(1px 1px at 10% 80%, rgba(255,255,255,0.2) 0%, transparent 100%),
        radial-gradient(1px 1px at 90% 70%, rgba(255,255,255,0.2) 0%, transparent 100%),
        radial-gradient(1.5px 1.5px at 35% 15%, rgba(255,255,255,0.5) 0%, transparent 100%),
        radial-gradient(1.5px 1.5px at 65% 85%, rgba(255,255,255,0.4) 0%, transparent 100%);
      pointer-events: none;
      z-index: 0;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
      padding: 2rem 1.5rem 4rem;
      position: relative;
      z-index: 1;
    }

    header {
      text-align: center;
      margin-bottom: 2.5rem;
    }

    .nasa-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: rgba(79,142,247,0.1);
      border: 1px solid rgba(79,142,247,0.25);
      border-radius: 999px;
      padding: 0.35rem 1rem;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--accent);
      margin-bottom: 1rem;
    }

    .nasa-badge svg { width: 14px; height: 14px; }

    h1 {
      font-family: 'Space Grotesk', sans-serif;
      font-size: clamp(1.6rem, 5vw, 2.4rem);
      font-weight: 700;
      background: linear-gradient(135deg, #ffffff 0%, #a0c4ff 50%, var(--accent2) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      line-height: 1.2;
    }

    .subtitle {
      margin-top: 0.5rem;
      color: var(--text-muted);
      font-size: 0.95rem;
    }

    /* Date navigation */
    .date-nav {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      margin-bottom: 2rem;
      flex-wrap: wrap;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.5rem 1rem;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, transform 0.1s;
    }

    .btn:hover { background: var(--surface2); border-color: rgba(255,255,255,0.15); }
    .btn:active { transform: scale(0.97); }

    .btn-primary {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
    }
    .btn-primary:hover { background: #3a7de8; border-color: #3a7de8; }

    input[type="date"] {
      padding: 0.5rem 0.75rem;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      font-size: 0.875rem;
      font-family: inherit;
      outline: none;
      transition: border-color 0.15s;
      color-scheme: dark;
    }

    input[type="date"]:focus { border-color: var(--accent); }

    /* Card */
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 8px 40px rgba(0,0,0,0.5), 0 0 80px rgba(79,142,247,0.05);
    }

    .media-wrapper {
      position: relative;
      width: 100%;
      background: #000;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 300px;
    }

    .apod-image {
      width: 100%;
      max-height: 580px;
      object-fit: contain;
      display: block;
      cursor: zoom-in;
      transition: opacity 0.3s;
    }

    .apod-video {
      width: 100%;
      aspect-ratio: 16/9;
      border: none;
    }

    .media-type-badge {
      position: absolute;
      top: 1rem;
      right: 1rem;
      background: rgba(0,0,0,0.6);
      backdrop-filter: blur(8px);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.3rem 0.6rem;
      font-size: 0.7rem;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--gold);
    }

    .info {
      padding: 2rem;
    }

    .apod-date {
      font-size: 0.8rem;
      font-weight: 500;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--accent);
      margin-bottom: 0.6rem;
    }

    .apod-title {
      font-family: 'Space Grotesk', sans-serif;
      font-size: clamp(1.2rem, 3vw, 1.65rem);
      font-weight: 600;
      line-height: 1.3;
      margin-bottom: 0.5rem;
    }

    .apod-copyright {
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-bottom: 1.25rem;
    }

    .apod-copyright span { color: var(--text-muted); }

    .apod-explanation {
      font-size: 0.95rem;
      line-height: 1.75;
      color: #b8c8d8;
    }

    .read-more-btn {
      background: none;
      border: none;
      color: var(--accent);
      font-size: 0.9rem;
      font-family: inherit;
      cursor: pointer;
      padding: 0;
      margin-top: 0.4rem;
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    /* Loading */
    .loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      padding: 5rem 2rem;
      text-align: center;
    }

    .spinner {
      width: 44px;
      height: 44px;
      border: 3px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    .loading-text { color: var(--text-muted); font-size: 0.95rem; }

    /* Error */
    .error {
      padding: 3rem 2rem;
      text-align: center;
    }

    .error-icon { font-size: 2.5rem; margin-bottom: 1rem; }
    .error-title { font-size: 1.1rem; font-weight: 600; margin-bottom: 0.5rem; }
    .error-msg { color: var(--text-muted); font-size: 0.9rem; margin-bottom: 1.5rem; line-height: 1.6; }

    /* Image lightbox */
    .lightbox {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.92);
      z-index: 100;
      align-items: center;
      justify-content: center;
      cursor: zoom-out;
    }

    .lightbox.active { display: flex; }
    .lightbox img { max-width: 95vw; max-height: 95vh; object-fit: contain; border-radius: 4px; }

    .lightbox-close {
      position: fixed;
      top: 1rem;
      right: 1.25rem;
      background: rgba(255,255,255,0.1);
      border: none;
      color: white;
      font-size: 1.5rem;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
    }

    .lightbox-close:hover { background: rgba(255,255,255,0.2); }

    @media (max-width: 480px) {
      .info { padding: 1.25rem; }
    }

    @media (prefers-reduced-motion: reduce) {
      .spinner { animation: none; }
      .apod-image { transition: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="nasa-badge">
        <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="3"/><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"/></svg>
        NASA Open APIs
      </div>
      <h1>Astronomy Picture of the Day</h1>
      <p class="subtitle">One stunning corner of our universe, every day</p>
    </header>

    <div class="date-nav">
      <button class="btn" id="prevBtn">&#8592; Previous</button>
      <input type="date" id="datePicker" />
      <button class="btn" id="nextBtn">Next &#8594;</button>
      <button class="btn btn-primary" id="todayBtn">Today</button>
    </div>

    <div class="card" id="card">
      <div class="loading">
        <div class="spinner"></div>
        <p class="loading-text">Reaching into the cosmos&hellip;</p>
      </div>
    </div>
  </div>

  <!-- Lightbox -->
  <div class="lightbox" id="lightbox">
    <button class="lightbox-close" id="lightboxClose">&times;</button>
    <img id="lightboxImg" src="" alt="" />
  </div>

  <script>
    const card = document.getElementById('card');
    const datePicker = document.getElementById('datePicker');
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightboxImg');

    const today = new Date().toISOString().split('T')[0];
    let currentDate = today;

    datePicker.max = today;
    datePicker.min = '1995-06-16'; // APOD launched June 16, 1995
    datePicker.value = today;

    function formatDisplayDate(dateStr) {
      const [y, m, d] = dateStr.split('-');
      return new Date(y, m - 1, d).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
      });
    }

    function truncate(text, max = 400) {
      if (text.length <= max) return { short: text, full: null };
      const cut = text.lastIndexOf(' ', max);
      return { short: text.slice(0, cut) + '…', full: text };
    }

    function renderLoading() {
      card.innerHTML = \`
        <div class="loading">
          <div class="spinner"></div>
          <p class="loading-text">Reaching into the cosmos&hellip;</p>
        </div>\`;
    }

    function renderError(msg) {
      card.innerHTML = \`
        <div class="error">
          <div class="error-icon">🔭</div>
          <div class="error-title">Unable to load image</div>
          <div class="error-msg">\${msg}</div>
          <button class="btn" onclick="loadAPOD(currentDate)">Try again</button>
        </div>\`;
    }

    function renderAPOD(data) {
      const { short, full } = truncate(data.explanation || '');
      const isVideo = data.media_type === 'video';
      const copyright = data.copyright ? \`<div class="apod-copyright">&#169; \${data.copyright.trim()}</div>\` : '';

      const mediaHtml = isVideo
        ? \`<iframe class="apod-video" src="\${data.url}" allowfullscreen title="\${data.title}"></iframe>\`
        : \`<img class="apod-image" src="\${data.hdurl || data.url}" alt="\${data.title}" id="apodImg" loading="lazy" />\`;

      card.innerHTML = \`
        <div class="media-wrapper">
          \${mediaHtml}
          <span class="media-type-badge">\${isVideo ? '▶ Video' : '📷 Image'}</span>
        </div>
        <div class="info">
          <div class="apod-date">\${formatDisplayDate(data.date)}</div>
          <h2 class="apod-title">\${data.title}</h2>
          \${copyright}
          <p class="apod-explanation" id="expText">\${short}</p>
          \${full ? '<button class="read-more-btn" id="readMoreBtn">Read more</button>' : ''}
        </div>\`;

      if (full) {
        let expanded = false;
        document.getElementById('readMoreBtn').addEventListener('click', () => {
          expanded = !expanded;
          document.getElementById('expText').textContent = expanded ? full : short;
          document.getElementById('readMoreBtn').textContent = expanded ? 'Show less' : 'Read more';
        });
      }

      if (!isVideo) {
        document.getElementById('apodImg').addEventListener('click', () => {
          lightboxImg.src = data.hdurl || data.url;
          lightboxImg.alt = data.title;
          lightbox.classList.add('active');
        });
      }
    }

    async function loadAPOD(date) {
      currentDate = date;
      datePicker.value = date;
      renderLoading();

      try {
        const res = await fetch(\`/api/apod?date=\${date}\`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to fetch');
        renderAPOD(data);
      } catch (e) {
        renderError(e.message);
      }
    }

    function shiftDate(days) {
      const d = new Date(currentDate + 'T00:00:00');
      d.setDate(d.getDate() + days);
      const newDate = d.toISOString().split('T')[0];
      if (newDate >= '1995-06-16' && newDate <= today) {
        loadAPOD(newDate);
      }
    }

    document.getElementById('prevBtn').addEventListener('click', () => shiftDate(-1));
    document.getElementById('nextBtn').addEventListener('click', () => shiftDate(1));
    document.getElementById('todayBtn').addEventListener('click', () => loadAPOD(today));
    datePicker.addEventListener('change', () => loadAPOD(datePicker.value));

    // Lightbox close
    document.getElementById('lightboxClose').addEventListener('click', () => lightbox.classList.remove('active'));
    lightbox.addEventListener('click', (e) => { if (e.target === lightbox) lightbox.classList.remove('active'); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') lightbox.classList.remove('active'); });

    // Keyboard nav
    document.addEventListener('keydown', (e) => {
      if (lightbox.classList.contains('active')) return;
      if (e.key === 'ArrowLeft') shiftDate(-1);
      if (e.key === 'ArrowRight') shiftDate(1);
    });

    loadAPOD(today);
  </script>
</body>
</html>`);
});

export default { port: process.env.PORT || 3000, fetch: app.fetch };
