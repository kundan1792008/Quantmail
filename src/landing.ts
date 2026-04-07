/**
 * Quant Workspace — premium dark-mode landing page.
 * Served from GET / by the Fastify server.
 */
export const landingPage = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Quant Workspace — AI-Powered Super App</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #0a0a0a;
      --surface: #111111;
      --border: #1e1e1e;
      --accent: #7c3aed;
      --accent-light: #a78bfa;
      --text: #f5f5f5;
      --muted: #888;
      --radius: 12px;
    }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.6;
      min-height: 100vh;
    }

    /* ── Nav ── */
    nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 20px 40px;
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      background: rgba(10,10,10,0.85);
      backdrop-filter: blur(12px);
      z-index: 100;
    }
    .logo { font-size: 1.25rem; font-weight: 700; letter-spacing: -0.5px; }
    .logo span { color: var(--accent-light); }
    .nav-cta {
      background: var(--accent);
      color: #fff;
      padding: 8px 20px;
      border-radius: 8px;
      text-decoration: none;
      font-size: 0.9rem;
      font-weight: 600;
      transition: background 0.2s;
    }
    .nav-cta:hover { background: #6d28d9; }

    /* ── Hero ── */
    .hero {
      text-align: center;
      padding: 120px 24px 80px;
      max-width: 820px;
      margin: 0 auto;
    }
    .badge {
      display: inline-block;
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 4px 14px;
      font-size: 0.8rem;
      color: var(--accent-light);
      margin-bottom: 28px;
      letter-spacing: 0.4px;
    }
    h1 {
      font-size: clamp(2.2rem, 5vw, 3.8rem);
      font-weight: 800;
      letter-spacing: -1.5px;
      line-height: 1.1;
      margin-bottom: 24px;
    }
    h1 em { color: var(--accent-light); font-style: normal; }
    .hero p {
      font-size: 1.1rem;
      color: var(--muted);
      max-width: 560px;
      margin: 0 auto 40px;
    }
    .hero-actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
    .btn-primary {
      background: var(--accent);
      color: #fff;
      padding: 14px 32px;
      border-radius: 10px;
      text-decoration: none;
      font-weight: 700;
      font-size: 1rem;
      transition: background 0.2s, transform 0.1s;
    }
    .btn-primary:hover { background: #6d28d9; transform: translateY(-1px); }
    .btn-secondary {
      background: var(--surface);
      color: var(--text);
      padding: 14px 32px;
      border-radius: 10px;
      text-decoration: none;
      font-weight: 600;
      font-size: 1rem;
      border: 1px solid var(--border);
      transition: border-color 0.2s;
    }
    .btn-secondary:hover { border-color: var(--accent-light); }

    /* ── Section ── */
    section {
      max-width: 1100px;
      margin: 0 auto;
      padding: 80px 24px;
    }
    .section-label {
      text-align: center;
      font-size: 0.8rem;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: var(--accent-light);
      margin-bottom: 16px;
    }
    .section-title {
      text-align: center;
      font-size: clamp(1.6rem, 3vw, 2.4rem);
      font-weight: 700;
      letter-spacing: -0.8px;
      margin-bottom: 56px;
    }

    /* ── App Grid ── */
    .app-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
    }
    .app-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 28px 24px;
      transition: border-color 0.2s, transform 0.15s;
    }
    .app-card:hover { border-color: var(--accent); transform: translateY(-2px); }
    .app-icon { font-size: 2rem; margin-bottom: 14px; }
    .app-card h3 { font-size: 1rem; font-weight: 700; margin-bottom: 8px; }
    .app-card p { font-size: 0.85rem; color: var(--muted); }

    /* ── Feature row (BYOK) ── */
    .byok-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 48px;
      align-items: center;
    }
    @media (max-width: 640px) { .byok-row { grid-template-columns: 1fr; } }
    .byok-text h2 { font-size: 1.8rem; font-weight: 700; letter-spacing: -0.5px; margin-bottom: 16px; }
    .byok-text p { color: var(--muted); margin-bottom: 12px; }
    .key-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 16px;
      font-family: monospace;
      font-size: 0.85rem;
      color: var(--accent-light);
    }
    .byok-visual {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    /* ── Footer ── */
    footer {
      text-align: center;
      padding: 40px 24px;
      border-top: 1px solid var(--border);
      color: var(--muted);
      font-size: 0.85rem;
    }
    footer a { color: var(--accent-light); text-decoration: none; }

    /* ── Divider ── */
    .divider { border: none; border-top: 1px solid var(--border); margin: 0; }
  </style>
</head>
<body>

  <!-- Nav -->
  <nav>
    <div class="logo">Quant<span>Workspace</span></div>
    <a href="/login" class="nav-cta">Get Started →</a>
  </nav>

  <!-- Hero -->
  <div class="hero">
    <div class="badge">✦ Now in Public Beta</div>
    <h1>The <em>AI-Powered</em> Super&nbsp;App for Modern Work</h1>
    <p>
      Mail, Calendar, Drive, Docs, and Sheets—unified by one intelligent brain.
      Quant Workspace replaces five tools with a single, blazing-fast workspace.
    </p>
    <div class="hero-actions">
      <a href="/login" class="btn-primary">Get Started Free</a>
      <a href="#apps" class="btn-secondary">Explore Features</a>
    </div>
  </div>

  <hr class="divider" />

  <!-- Core Apps -->
  <section id="apps">
    <p class="section-label">Core Apps</p>
    <h2 class="section-title">Everything you need, under one roof</h2>
    <div class="app-grid">
      <div class="app-card">
        <div class="app-icon">✉️</div>
        <h3>Quant Mail</h3>
        <p>Smart inbox with AI triage, shadow filtering, and one-click replies.</p>
      </div>
      <div class="app-card">
        <div class="app-icon">📅</div>
        <h3>Quant Calendar</h3>
        <p>Auto-schedule meetings from emails. AI fills your calendar intelligently.</p>
      </div>
      <div class="app-card">
        <div class="app-icon">📁</div>
        <h3>Quant Drive</h3>
        <p>Secure file storage with instant search and per-user isolation.</p>
      </div>
      <div class="app-card">
        <div class="app-icon">📄</div>
        <h3>Quant Docs</h3>
        <p>AI-assisted document editor that writes first drafts from your data.</p>
      </div>
      <div class="app-card">
        <div class="app-icon">📊</div>
        <h3>Quant Sheets</h3>
        <p>Collaborative spreadsheets with an AI co-pilot for instant analysis.</p>
      </div>
    </div>
  </section>

  <hr class="divider" />

  <!-- BYOK Section -->
  <section id="byok">
    <div class="byok-row">
      <div class="byok-text">
        <p class="section-label" style="text-align:left">Architecture</p>
        <h2>Bring Your Own Key (BYOK)</h2>
        <p>
          Quant Workspace never stores your AI provider credentials in plain text.
          Connect OpenAI, Anthropic, or Gemini with your own API keys—isolated per user,
          encrypted at rest.
        </p>
        <p>
          Swap models on the fly. Pay only for what you use. Full data sovereignty.
        </p>
      </div>
      <div class="byok-visual">
        <div class="key-pill">🔑 &nbsp;OPENAI_API_KEY&nbsp;&nbsp;••••••••••••sk-</div>
        <div class="key-pill">🔑 &nbsp;ANTHROPIC_KEY&nbsp;&nbsp;&nbsp;••••••••••••sk-</div>
        <div class="key-pill">🔑 &nbsp;GEMINI_KEY&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;••••••••••••AI-</div>
      </div>
    </div>
  </section>

  <hr class="divider" />

  <!-- CTA -->
  <section style="text-align:center; padding: 100px 24px;">
    <h2 style="font-size:clamp(1.8rem,4vw,2.8rem); font-weight:800; letter-spacing:-1px; margin-bottom:16px;">
      Ready to upgrade your&nbsp;workflow?
    </h2>
    <p style="color:var(--muted); margin-bottom:36px; font-size:1.05rem;">
      Join the beta. Your data, your keys, your workspace.
    </p>
    <a href="/login" class="btn-primary" style="font-size:1.05rem; padding:16px 40px;">
      Create Your Workspace →
    </a>
  </section>

  <!-- Footer -->
  <footer>
    <p>© 2025 Quant Workspace · <a href="/health">API Status</a></p>
  </footer>

</body>
</html>`;
