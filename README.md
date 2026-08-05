# Chairman — Estimating Co.

Job pipeline, invoicing, scheduling and crew tracking for an insurance estimator / general contractor.

Runs entirely in the browser. No server, no accounts, no monthly fee.

---

## What's in here

| File | What it is |
|---|---|
| `index.html` | The whole app. One file. |
| `manifest.webmanifest` | Makes it installable as a phone app |
| `sw.js` | Offline support (network-first, so it never serves a stale version) |
| `icon-192.png` / `icon-512.png` | Home-screen icons |
| `netlify.toml` | Hosting config + cache headers |

---

## Deploy it — do it in this order

### 1. GitHub (10 minutes)

Somewhere to keep the code and a history you can roll back to.

1. Go to **github.com** → **New repository**
2. Name it `chairman` — set it to **Private**
3. On the next screen click **uploading an existing file**
4. Drag in **everything from this folder**
5. **Commit changes**

### 2. Netlify (5 minutes) — this is the one that matters

Gives you a real web address, which you need for the app to install on your phone and work offline.

1. Go to **netlify.com** → sign in **with GitHub**
2. **Add new site** → **Import an existing project** → **GitHub** → pick `chairman`
3. Leave the build settings empty — publish directory `.`
4. **Deploy**

You'll get a URL like `chairman-abc123.netlify.app`. Under **Site configuration → Change site name** you can make it something like `chairman-est.netlify.app`.

From then on, any change you push to GitHub redeploys itself in about 30 seconds.

### 3. Put it on your phone

- **iPhone:** open the Netlify URL in **Safari** → Share → **Add to Home Screen**
- **Android:** open it in **Chrome** → menu → **Install app**

It then runs full-screen like a real app and works with no signal.

> Do this on your phone **and** your desktop if you use both — but read the next section first.

---

## 4. Supabase — only when you actually need it

**You probably don't need it yet.** Be clear about what it does and doesn't solve.

Right now your data lives in the browser on **one device**. That means:

- Your phone and your laptop each hold **separate, unconnected** copies
- Clearing your browser data wipes it
- Losing the phone loses whatever was only on the phone

Supabase fixes that by putting your jobs in a real database in the cloud, so every device sees the same thing and nothing is lost with the hardware.

**The cost:** you'd need a login, every screen has to handle being offline and syncing later, and conflicts have to be resolved when two devices edit the same job. That's real work and real new ways to break.

**My honest advice:** run it on one device for a few weeks. Use **Settings → Back up my data** every so often. If you find yourself wanting the same board on your phone *and* your desk, that's the signal — come back and we'll add Supabase then.

If you do add it, the order is: GitHub → Netlify → Supabase. Never Supabase first — you'd be building sync before you know whether you need it.

---

## Backups

**Settings → Back up my data** downloads a `.json` file with everything. Keep one somewhere safe now and then.

Two things it does **not** include, by design:

- **Your AI key** — stripped out so it can't leak in a file you email or upload
- **Uploaded photos and documents** — they live in the browser's own file storage. Treat uploads as working copies, not your archive of record.

---

## Notes

- **AI is optional.** Settings → AI assistant. Google Gemini's free tier is the easy pick; Ollama runs on your own PC and never sends job data anywhere.
- **Never commit an API key** into this repo. The app keeps it in your browser, not in these files — keep it that way.
- The repo is **private** for a reason: it's your business data structure and your client names end up in your browser, not in git, but there's no upside to making it public.
