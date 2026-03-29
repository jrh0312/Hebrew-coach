# 🇮🇱 Hebrew Pronunciation Coach

A Progressive Web App (PWA) that helps you practice reading Hebrew text aloud.
Upload any Hebrew text, listen to a native Israeli voice model each sentence, record
yourself, and get instant word-level and phoneme-level pronunciation scores powered
by Microsoft Azure.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Prerequisites — API Accounts](#prerequisites--api-accounts)
   - [Google Cloud Text-to-Speech](#a-google-cloud-text-to-speech)
   - [Azure Cognitive Services Speech](#b-azure-cognitive-services-speech)
3. [Local Development](#local-development)
   - [Clone the repo](#1-clone-the-repo)
   - [Backend setup](#2-backend-setup-fastapi)
   - [Frontend setup](#3-frontend-setup-react--vite)
   - [Verify credentials with the test script](#4-verify-credentials-with-the-test-script)
   - [Open the app](#5-open-the-app)
4. [Deploying to Render](#deploying-to-render)
   - [Step 1 — Push to GitHub](#step-1--push-to-github)
   - [Step 2 — Deploy the backend](#step-2--deploy-the-backend)
   - [Step 3 — Deploy the frontend](#step-3--deploy-the-frontend)
   - [Step 4 — Wire up the services](#step-4--wire-up-the-services)
5. [Installing as a PWA on iPhone](#installing-as-a-pwa-on-iphone)
6. [Environment Variables Reference](#environment-variables-reference)
7. [Project Structure](#project-structure)
8. [Troubleshooting](#troubleshooting)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         iPhone / Browser                    │
│                                                             │
│  React PWA (Vite)                                           │
│  ┌───────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │ Text Input│  │ Segment Player  │  │ Results Display  │  │
│  │ + File    │  │ Listen | Record │  │ Score cards      │  │
│  │ Upload    │  │ Assess button   │  │ Word colours     │  │
│  └───────────┘  └────────┬────────┘  │ Phoneme bars     │  │
│                           │           └──────────────────┘  │
└───────────────────────────┼─────────────────────────────────┘
                            │ HTTPS
              ┌─────────────▼──────────────┐
              │   FastAPI Backend (Python)  │
              │                            │
              │  POST /api/tts             │──► Google Cloud TTS
              │  POST /api/tts/prefetch    │    he-IL-Wavenet-A/B
              │  POST /api/assess          │──► Azure Speech SDK
              │                            │    Pronunciation Assessment
              └────────────────────────────┘    locale: he-IL
```

**Data flow:**
- On text upload the frontend calls `/api/tts/prefetch` once to batch-synthesise
  all segments. Audio is cached as base64 data-URLs — no repeat API calls.
- Recording uses the Web Audio API (ScriptProcessorNode) and encodes to WAV
  in the browser before uploading — no third-party audio library needed.
- Azure returns raw 0–100 scores; nothing is rescaled or normalised.

---

## Prerequisites — API Accounts

You need **two** free API accounts. Both have generous free tiers.

| Service | Free tier | Cost beyond free |
|---|---|---|
| Google Cloud TTS | 1 million Wavenet chars/month | ~$16 / million chars |
| Azure Speech | 5 hours recognition/month (F0) | ~$1 / hour |

---

### A. Google Cloud Text-to-Speech

The TTS API synthesises Hebrew text to MP3 using a Wavenet (neural) voice.

#### Step 1 — Create a Google Cloud project

1. Go to **[console.cloud.google.com](https://console.cloud.google.com)**.
2. Click the project selector at the top → **New Project**.
3. Give it a name (e.g. `hebrew-coach`) and click **Create**.
4. Make sure the new project is selected in the top dropdown.

#### Step 2 — Enable the Text-to-Speech API

1. In the left sidebar go to **APIs & Services → Library**.
2. Search for **Cloud Text-to-Speech API**.
3. Click the result, then click **Enable**.

   > **Wait ~30 seconds** after enabling before making API calls or you may
   > get a `SERVICE_DISABLED` error.

#### Step 3 — Create an API key (Option A — recommended for starters)

1. Go to **APIs & Services → Credentials**.
2. Click **Create Credentials → API key**.
3. Copy the key shown — this is your `GOOGLE_TTS_API_KEY`.
4. **Recommended:** Click **Edit API key** → under *API restrictions* choose
   **Restrict key** → select **Cloud Text-to-Speech API** → Save.
   This prevents the key being misused if it ever leaks.

#### Alternative: Service Account JSON (Option B — for production)

A service account is more secure because it can be scoped precisely and rotated.

1. Go to **IAM & Admin → Service Accounts → Create Service Account**.
2. Name it `hebrew-coach-tts`, click **Create and Continue**.
3. Grant the role **Cloud Text-to-Speech User**, click **Done**.
4. Click the service account → **Keys** tab → **Add Key → Create new key →
   JSON** → **Create**. A `.json` file downloads automatically.
5. Set the environment variable:
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS="/absolute/path/to/downloaded.json"
   ```
   On Render, base64-encode the file and store it as a secret (see
   [Render deployment](#step-2--deploy-the-backend)).

---

### B. Azure Cognitive Services Speech

Azure's Pronunciation Assessment API listens to your recording, aligns it to
the reference text, and scores every phoneme.

#### Step 1 — Create an Azure account

Go to **[portal.azure.com](https://portal.azure.com)** and sign in or create a
free account. New accounts get $200 of credits for 30 days.

#### Step 2 — Create a Speech resource

1. Click **Create a resource** (the **+** icon in the top bar).
2. Search for **Speech** and select it (published by Microsoft).
3. Click **Create**.
4. Fill in the form:
   | Field | Value |
   |---|---|
   | Subscription | Your subscription |
   | Resource group | Create new → `hebrew-coach-rg` |
   | Region | **West Europe** ← closest free-tier region to Israel |
   | Name | `hebrew-coach-speech` (any unique name) |
   | Pricing tier | **Free F0** (5 hrs recognition / month) |
5. Click **Review + create → Create**.
6. Wait for deployment (~1 minute).

#### Step 3 — Copy your key and region

1. Go to the resource you just created.
2. In the left sidebar click **Keys and Endpoint** (under *Resource Management*).
3. Copy **KEY 1** — this is your `AZURE_SPEECH_KEY`.
4. Note the **Location/Region** value (e.g. `westeurope`) — this is your
   `AZURE_SPEECH_REGION`.

   > **Do not share KEY 1.** If it leaks, regenerate it on this same page.

---

## Local Development

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/hebrew-coach.git
cd hebrew-coach
```

### 2. Backend setup (FastAPI)

```bash
# Create and activate a Python virtual environment
cd backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Copy the env template and fill in your keys
cp .env.example .env
```

Now open `backend/.env` in any editor and fill in your values:

```dotenv
# backend/.env

# Paste the API key from Google Cloud Console
GOOGLE_TTS_API_KEY=AIzaSy...yourkey...

# Paste KEY 1 from Azure portal → Keys and Endpoint
AZURE_SPEECH_KEY=abc123...yourkey...
AZURE_SPEECH_REGION=westeurope

# For local dev, allow the Vite dev server
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
```

Start the backend:

```bash
# Still inside backend/ with .venv active
uvicorn main:app --reload --port 8000
```

You should see:
```
INFO:     Application startup complete.
INFO:     Uvicorn running on http://127.0.0.1:8000
```

Leave this terminal running and open a new one for the frontend.

### 3. Frontend setup (React + Vite)

```bash
cd frontend           # from the project root
npm install
npm run dev
```

You should see:
```
  VITE v5.x.x  ready in 300ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.x.x:5173/    ← use this on your iPhone
```

### 4. Verify credentials with the test script

Before touching the browser, run the smoke-test from the **project root** to
confirm both API keys work:

```bash
# From hebrew-coach/ (not backend/)
pip install requests python-dotenv    # if not already installed
python test_api.py
```

Expected output when everything is wired up correctly:

```
Hebrew Pronunciation Coach — API Test Suite
Target: http://localhost:8000

────────────────────────────────────────────────────────────
 1 / Health check
────────────────────────────────────────────────────────────
  ✓ Server is up  (http://localhost:8000)

────────────────────────────────────────────────────────────
 2 / POST /api/tts  — Google Cloud TTS (single segment)
────────────────────────────────────────────────────────────
  Sending text: שָׁלוֹם, אֵיךְ אַתָּה?
  ✓ Received MP3 audio  (12,345 bytes, content-type: audio/mpeg)
  ✓ Saved to _test_tts_output.mp3  — open in any audio player to verify Hebrew voice

────────────────────────────────────────────────────────────
 3 / POST /api/tts/prefetch  — Google Cloud TTS (batch)
────────────────────────────────────────────────────────────
  ✓ All 3/3 segments synthesised successfully

────────────────────────────────────────────────────────────
 4 / POST /api/assess  — Azure Pronunciation Assessment
────────────────────────────────────────────────────────────
  ✓ Azure is reachable and credentials are valid  (NoMatch for silent audio — expected)

────────────────────────────────────────────────────────────
 Summary
────────────────────────────────────────────────────────────
  PASS  health
  PASS  tts
  PASS  prefetch
  PASS  assess

All 4 tests passed. Your backend is ready!
```

> **Azure test shows NoMatch** — this is correct! The test deliberately sends
> silent audio to prove the key is valid. A real recording will get scored.
> If you see a `502` instead, your `AZURE_SPEECH_KEY` or region is wrong.

Open `_test_tts_output.mp3` to hear the Israeli Hebrew voice. If it sounds
like Hebrew you're ready.

### 5. Open the app

| Device | URL |
|---|---|
| Mac (same machine) | http://localhost:5173 |
| iPhone (same Wi-Fi) | http://192.168.x.x:5173 (use the Network URL from `npm run dev`) |

> **iPhone microphone over HTTP:** Safari blocks `getUserMedia` on non-HTTPS
> pages except for `localhost`. Testing over LAN with an IP address won't
> allow recording — deploy to Render (HTTPS) for full iPhone testing.
> You can test TTS playback over LAN; only recording requires HTTPS.

---

## Deploying to Render

Render gives you a free HTTPS backend (Python web service) and a free static
site for the frontend. Both go to sleep after 15 minutes of inactivity on the
free tier — the first request after sleep takes ~30–60 seconds.

### Step 1 — Push to GitHub

```bash
cd hebrew-coach
git init                         # if you haven't already
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/hebrew-coach.git
git push -u origin main
```

### Step 2 — Deploy the backend

You can use the Blueprint (render.yaml) or deploy manually. The Blueprint is
faster when starting from scratch.

#### Option A — Blueprint (deploys both services at once)

1. Go to **[render.com](https://render.com)** → **New → Blueprint**.
2. Connect your GitHub account if prompted.
3. Select the `hebrew-coach` repository.
4. Render reads `render.yaml` and shows you two services to create:
   - `hebrew-coach-api` (Python web service)
   - `hebrew-coach-frontend` (static site)
5. Click **Apply**.
6. Render starts building both services. The first build takes ~3–5 minutes.

After the build, the backend URL will be something like:
```
https://hebrew-coach-api.onrender.com
```

#### Option B — Manual (backend only first)

1. **New → Web Service** → connect your repo.
2. Settings:
   | Field | Value |
   |---|---|
   | Name | `hebrew-coach-api` |
   | Region | Frankfurt |
   | Branch | `main` |
   | Root Directory | `backend` |
   | Runtime | `Python 3` |
   | Build Command | `pip install -r requirements.txt` |
   | Start Command | `uvicorn main:app --host 0.0.0.0 --port $PORT` |
   | Plan | Free |
3. Click **Create Web Service**.

### Step 3 — Set secret environment variables (backend)

> This must be done for **both** deploy options — secrets are never stored
> in `render.yaml` (they're marked `sync: false`).

1. In the Render dashboard, click your **hebrew-coach-api** service.
2. Go to **Environment** in the left sidebar.
3. Add the following key/value pairs (click **Add Environment Variable** for each):

   | Key | Value | Notes |
   |---|---|---|
   | `GOOGLE_TTS_API_KEY` | `AIzaSy…` | From Google Cloud Console |
   | `AZURE_SPEECH_KEY` | `abc123…` | From Azure → Keys and Endpoint |
   | `AZURE_SPEECH_REGION` | `westeurope` | Or wherever you created the resource |
   | `ALLOWED_ORIGINS` | *(fill in after step 4)* | Leave blank for now |

4. Click **Save Changes**. Render will redeploy the backend automatically.

#### Using a service account JSON on Render (Option B credentials)

Render doesn't support uploading files, but you can store the JSON as an
environment variable:

```bash
# On your local machine:
base64 -i service-account.json | tr -d '\n' | pbcopy   # macOS — copies to clipboard
base64 service-account.json | tr -d '\n' | xclip        # Linux
```

Add an env var `GOOGLE_CREDENTIALS_B64` with the pasted value, then add this
to the top of `backend/main.py` before `load_dotenv()`:

```python
import base64, json, os, tempfile

_b64 = os.getenv("GOOGLE_CREDENTIALS_B64")
if _b64:
    _decoded = base64.b64decode(_b64).decode()
    _tmp = tempfile.NamedTemporaryFile(suffix=".json", delete=False, mode="w")
    _tmp.write(_decoded)
    _tmp.close()
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = _tmp.name
```

### Step 4 — Deploy the frontend

#### If you used Blueprint (Option A)

The frontend service was already created. You just need to set its
environment variable and trigger a redeploy:

1. Click the **hebrew-coach-frontend** service in the dashboard.
2. Go to **Environment → Add Environment Variable**:

   | Key | Value |
   |---|---|
   | `VITE_API_URL` | `https://hebrew-coach-api.onrender.com/api` |

   > Replace `hebrew-coach-api` with your actual backend service name if
   > it was assigned a different slug (check the backend's dashboard URL).

3. Click **Save Changes** → the frontend will rebuild (~2 minutes).

#### If you deployed manually (Option B)

1. **New → Static Site** → connect your repo.
2. Settings:
   | Field | Value |
   |---|---|
   | Name | `hebrew-coach-frontend` |
   | Region | Frankfurt |
   | Branch | `main` |
   | Root Directory | `frontend` |
   | Build Command | `npm install && npm run build` |
   | Publish Directory | `dist` |
3. Add environment variable `VITE_API_URL` = `https://hebrew-coach-api.onrender.com/api`
4. Click **Create Static Site**.

### Wire up ALLOWED_ORIGINS on the backend

Now that you know the frontend URL:

1. Go to **hebrew-coach-api → Environment**.
2. Set `ALLOWED_ORIGINS` = `https://hebrew-coach-frontend.onrender.com`
   (use your actual frontend URL).
3. Click **Save Changes** → backend redeploys (~30 seconds).

### Verify the full deployment

Open your frontend URL in a browser. Paste the Genesis 1:1 sample text (one
of the quick-start buttons), click **Start Practice** and confirm:

- ✅ The "Fetching audio…" progress completes and turns into "Read full text: ▶ Play All"
- ✅ Pressing **▶ Play All** plays Hebrew audio
- ✅ Pressing **🎤 Record** on a segment asks for microphone permission
- ✅ After recording, **📊 Assess Pronunciation** returns scores

---

## Installing as a PWA on iPhone

The app works in any browser but installs as a full-screen native-feeling app
when added to your iPhone home screen via Safari.

> **Must use Safari.** Chrome, Firefox, and other iOS browsers cannot install
> PWAs to the home screen on iOS — only Safari can.

### Step-by-step

**1.** Open **Safari** on your iPhone and navigate to your app URL:
```
https://hebrew-coach-frontend.onrender.com
```

**2.** Wait for the page to fully load (you should see the Hebrew Coach title).

**3.** Tap the **Share** button — the rectangle-with-arrow icon in the Safari toolbar:
```
On iPhone with Face ID:   bottom centre of the screen
On older iPhones:         bottom centre or top right
```

**4.** The Share Sheet slides up. Scroll down the list of options until you see:
```
┌─────────────────────────────────┐
│  ⊞  Add to Home Screen         │
└─────────────────────────────────┘
```
Tap it.

**5.** A preview appears showing the app icon and a name field pre-filled with
"HebrewCoach". You can rename it if you like, then tap **Add** in the top-right
corner.

**6.** The icon appears on your home screen. Tap it — the app opens **full-screen**
without any Safari chrome (no address bar, no tabs).

### What the PWA gives you

| Feature | Browser | PWA (home screen) |
|---|---|---|
| Full-screen | ✗ | ✅ |
| Works offline (cached assets) | ✗ | ✅ |
| App icon on home screen | ✗ | ✅ |
| iOS status bar integration | ✗ | ✅ |
| Behaves like a native app | ✗ | ✅ |

> **Note:** Microphone access in the PWA uses the same Safari permission as
> in the browser. If you denied microphone access before, go to
> **Settings → Safari → Microphone** and allow it, or visit the site in
> Safari and reset permissions via **Settings → Safari → Advanced →
> Website Data**.

---

## Environment Variables Reference

### Backend (`backend/.env`)

| Variable | Required | Example | Description |
|---|---|---|---|
| `GOOGLE_TTS_API_KEY` | One of A or B | `AIzaSy...` | Google Cloud API key for TTS |
| `GOOGLE_APPLICATION_CREDENTIALS` | One of A or B | `/path/to/sa.json` | Path to service account JSON |
| `AZURE_SPEECH_KEY` | ✅ Yes | `abc123...` | Azure Speech resource KEY 1 |
| `AZURE_SPEECH_REGION` | ✅ Yes | `westeurope` | Azure resource region |
| `ALLOWED_ORIGINS` | ✅ Yes | `https://myapp.onrender.com` | Comma-separated CORS origins |

### Frontend (set in Render dashboard or `.env.local` locally)

| Variable | Required in prod | Example | Description |
|---|---|---|---|
| `VITE_API_URL` | ✅ Yes | `https://hebrew-coach-api.onrender.com/api` | Full backend API URL including `/api` path. **Build-time** — must redeploy frontend after changing. |

> In local development `VITE_API_URL` is not needed — Vite proxies `/api`
> to `http://localhost:8000` automatically via the dev-server proxy in
> `vite.config.js`.

---

## Project Structure

```
hebrew-coach/
│
├── backend/
│   ├── main.py              FastAPI app — TTS + pronunciation assessment
│   ├── requirements.txt     Python dependencies (pinned)
│   └── .env.example         Template — copy to .env and fill in keys
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx          Root component, full-play state machine
│   │   ├── App.css          All UI styles (dark theme, RTL support)
│   │   ├── components/
│   │   │   ├── TextInput.jsx       Paste / file upload + sample texts
│   │   │   ├── SegmentPlayer.jsx   Per-segment: Listen | Record | Assess
│   │   │   ├── Recorder.jsx        Web Audio API recorder (iOS-safe)
│   │   │   └── ResultsDisplay.jsx  Score cards + word colours + phonemes
│   │   └── utils/
│   │       ├── textUtils.js   Hebrew text → sentence segmentation
│   │       └── audioUtils.js  Float32→WAV encoder + score colour helper
│   ├── public/
│   │   ├── manifest.json    PWA manifest
│   │   ├── favicon.svg      Hebrew letter ה icon
│   │   ├── icon-192.png     PWA icon (replace with real art)
│   │   ├── icon-512.png     PWA icon (replace with real art)
│   │   └── apple-touch-icon.png  iOS home screen icon
│   ├── index.html           HTML shell with iOS meta tags
│   ├── vite.config.js       Vite + vite-plugin-pwa config
│   ├── package.json
│   └── create-icons.py      Generates placeholder PNG icons (no deps)
│
├── test_api.py              Smoke-test script — run before the frontend
├── render.yaml              Render Blueprint — deploys both services
├── .gitignore
└── README.md
```

---

## Troubleshooting

### Google TTS — "SERVICE_DISABLED" error

**Cause:** The Text-to-Speech API wasn't enabled, or was enabled less than a
minute ago.

**Fix:**
1. Go to console.cloud.google.com → APIs & Services → Enabled APIs.
2. Confirm "Cloud Text-to-Speech API" is in the list.
3. Wait 60 seconds after enabling, then retry.

---

### Google TTS — "API key not valid" error

**Cause:** Wrong key, or key is restricted to other APIs.

**Fix:**
1. Go to APIs & Services → Credentials → find your API key → Edit.
2. Under *API restrictions*, either choose **Don't restrict key** or ensure
   **Cloud Text-to-Speech API** is in the allowed list.
3. Click Save. Changes take effect within a few minutes.

---

### Azure — "NoMatch" on real recordings

**Cause:** The audio quality is too low, there is background noise, or the
microphone picked up silence.

**Fix:**
- Speak louder and closer to the microphone.
- Use headphones to prevent echo.
- Make sure you're using HTTPS (required for microphone on mobile).
- On iPhone, check Settings → Privacy & Security → Microphone → Safari is toggled on.

---

### Azure — `502` on `/api/assess`

**Cause:** Wrong `AZURE_SPEECH_KEY` or `AZURE_SPEECH_REGION`.

**Fix:**
1. Go to Azure portal → your Speech resource → Keys and Endpoint.
2. Copy KEY 1 (not KEY 2, though either works).
3. Check the Location field — use exactly that value for `AZURE_SPEECH_REGION`
   (e.g. `westeurope`, not `West Europe`).

---

### "No speech recognized" after recording

**Cause:** The WAV file reached Azure but contained only silence.

**Fix:**
- Check that your browser has microphone permission.
- On the Recorder screen, confirm the red pulsing dot appears when you speak
   (it turns yellow during silence, red during sound).
- Try recording in a quiet room.

---

### iPhone — microphone not working

**Cause:** Safari on iOS requires HTTPS for `getUserMedia`. Local IP addresses
(`192.168.x.x`) don't qualify.

**Fix:**
- Deploy to Render (free) to get an HTTPS URL, or
- Use a tunnelling tool like [ngrok](https://ngrok.com/) during development:
  ```bash
  ngrok http 5173   # then open the https:// URL on your iPhone
  ```

---

### Render — "Service unavailable" after 15 minutes

**Cause:** Render free-tier services sleep after 15 minutes of inactivity.
The first request after sleeping triggers a cold start (~30–60 seconds).

**Fix (for personal use):** This is expected. Simply wait for the loading
spinner to resolve. On free tier there is no way to prevent sleep entirely
without upgrading to a paid plan.

**Tip:** The TTS prefetch request will time out in the browser if the backend
takes more than 30 seconds to wake up. If you see a "TTS failed" banner, wait
10 seconds and paste your text again — the backend should be warm by then.

---

### PWA — "Add to Home Screen" option not visible in Safari

**Cause:** The page may not have loaded fully, or you're using the wrong browser.

**Fix:**
- Confirm you're using **Safari** (not Chrome, Firefox, or another app's
  in-app browser).
- Reload the page and wait for it to finish loading.
- Tap the Share button — the **box with an arrow pointing up** in Safari's toolbar.
- Scroll the Share Sheet *down* to find "Add to Home Screen" — it's not always
  at the top.

---

### `VITE_API_URL` pointing to wrong backend after Render deploy

**Cause:** `VITE_API_URL` is a build-time variable. Changing it in the dashboard
does not update the running site until the frontend is rebuilt.

**Fix:**
1. Update `VITE_API_URL` in the Render dashboard.
2. Go to the frontend service → **Manual Deploy → Deploy latest commit**.
3. Wait for the build to finish (~2 minutes).

---

## Licence

MIT — use freely, attribution appreciated.
