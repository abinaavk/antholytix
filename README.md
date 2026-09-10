# Antholytix AI

Anthocyanin freshness + QR authenticity scanner — a single Flask app that
serves the frontend (`templates/` + `static/`) and the API (`app.py`)
together, so there's one thing to run and one thing to deploy.

```
antholytix/
├── app.py              # Flask app: serves the frontend + the API
├── requirements.txt
├── seed_labels.py       # seeds demo product/QR codes
├── .env.example
├── static/
│   ├── css/app.css       # includes light + dark theme tokens
│   ├── js/app.js         # all frontend logic (scanner, shop, auth, history…)
│   └── img/
│       └── sandipani-logo.svg   # placeholder — see "About page" below
└── templates/
    └── index.html        # the page shell, rendered by Flask
```

## 1. Set up a virtual environment

```bash
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

## 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` with real values. At minimum set `SECRET_KEY`. OTP emails and
Google Sign-In are optional — signup still works without `SMTP_USER`/
`SMTP_PASS`, it just won't be able to send the verification email.

Flask doesn't load `.env` automatically — either `export` the variables in
your shell, or add `from dotenv import load_dotenv; load_dotenv()` near the
top of `app.py` (python-dotenv is already in requirements.txt).

## 3. Create the database and seed demo labels

```bash
python -c "from app import app, db; app.app_context().push(); db.create_all()"
python seed_labels.py
```

This seeds four demo product codes so the scanner has something to find
immediately — scan (or manually enter) `K7#9-QD4$-N2!B-8XM6` and you'll get
a live, server-verified result the first time you run it.

## Accounts, history, and notifications

Sign-up/sign-in supports both email + OTP and Google Sign-In (if
`GOOGLE_CLIENT_ID` is set — leave it blank to hide the Google button and
only offer email). Scan history and notifications are gated behind
sign-in: `GET /scan/history` is scoped to the caller's own JWT, so a signed-in
user only ever sees their own scans, never anyone else's, and a
logged-out visitor sees a "sign in to see this" prompt instead of any
data. Signing out just clears the local token — no server call needed.

A note on OTP email: `send_otp()` sends the email synchronously inside the
`/auth/signup` request, so with slow or unreachable SMTP the signup
response can take several seconds (it has an 8s connection timeout so it
won't hang forever, but it also won't feel instant). For a production
deployment with real traffic, moving that send to a background task/queue
(Celery, RQ, or even a simple thread) is worth doing — it's fine as-is for
getting started.

## Dark mode

Toggled from the sun/moon icon in the top bar; the choice is saved to
`localStorage` and applied before first paint (via a small inline script in
`templates/index.html`) so there's no flash of the wrong theme on reload.
All colours are CSS custom properties in `static/css/app.css`, branching on
`[data-theme="dark"]` — add new UI with `var(--...)` tokens rather than
hard-coded colours and it'll pick up both themes for free.

## About page / school credit

The About page credits "students of Sandipani Vidyalaya" along with the
official school logo (`static/SandipaniLOGON.webp`) and three team member names.
The same page also has a full chemistry write-up — natural pH
indicators, the anthocyanin/flavylium equilibrium, the biogenic amines
that drive spoilage pH — with a simplified structure diagram.

## Settings (signed-in users)

`/#/settings` — profile name, password change, a Light/Dark/System theme
picker, a flagged-scan email-notification toggle, data export (downloads a
JSON file via `/account/export`), clearing history, and account deletion.
All the mutating ones require the account's own JWT, same as history.

## SEO, crawlers, and the rest of "a real website"

- `/robots.txt` and `/sitemap.xml` are generated routes, not static files —
  edit them in `app.py` if you add real server-rendered pages later. Major
  AI crawlers (GPTBot, ClaudeBot, PerplexityBot, CCBot, Google-Extended) are
  explicitly allowed.
- `/llms.txt` is the emerging convention for AI agents/assistants — a
  plain-language summary instead of them trying to parse the SPA.
- `/docs` is a real, separately-routed, server-rendered page (not part of
  the hash-routed app) with genuine crawlable content: usage, the label
  spec, an API reference for manufacturers, and an FAQ.
- Custom branded 404/500 pages (`templates/404.html`), plus a handful of
  security headers on every response (`X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`).
- `static/manifest.json` + generated PNG icons make the app installable
  ("Add to Home Screen") on phones.
- **Honest limitation:** the dashboard, scanner, shop and history are all
  hash-routed client state behind a single `/` — that's the right call for
  interactive, personalized screens, but it means search engines only ever
  see one crawlable URL for the app itself. `/docs` is where real
  page-level SEO content should grow if you want more indexed pages later.

## 4. Run it

```bash
python app.py
```

Open **http://localhost:5050** — that one URL serves the whole app: the
dashboard, the scanner, the shop, everything.

For production, run behind gunicorn instead of the dev server:

```bash
gunicorn -w 4 -b 0.0.0.0:5050 app:app
```

Camera access (for the pigment + QR scanner) requires HTTPS — put this
behind a reverse proxy with TLS, or use a tunnel like ngrok for testing on
a real phone.

## How the frontend talks to the backend

`static/js/app.js` calls `POST /scan/analyze` with the pigment reading and
the scanned/typed code. Because the page is served by this same Flask app,
that's just a same-origin relative fetch — no configuration needed. If the
backend is ever unreachable (offline, or the page is opened as a static
file with no server behind it) the frontend automatically falls back to a
small built-in demo dataset, so it never dead-ends — you'll see a "Demo
data" tag on the result instead of "Verified against your backend".

## API reference

### Auth
| Method | Route | Body | Notes |
|---|---|---|---|
| POST | `/auth/signup` | `name, email, password, confirm_password` | sends a 6-digit OTP by email (prevents account creation if email dispatch fails) |
| POST | `/auth/verify-otp` | `email, otp` | returns a JWT on success |
| POST | `/auth/resend-otp` | `email` | 1-minute rate-limited with UI feedback |
| POST | `/auth/login` | `email, password` | requires an active, verified account |
| POST | `/auth/google` | `id_token` | Google Sign-In |

### Labels (the data behind each QR code)
| Method | Route | Auth | Body | Notes |
|---|---|---|---|---|
| POST | `/labels` | Admin | `name, company, qty, mfg (YYYY-MM-DD), exp` | registers a new physical label; returns generated `code` |
| GET | `/labels` | Admin | — | list recent labels |
| GET | `/labels/<code>` | none | — | public lookup by code (case-insensitive) |
| GET | `/labels/lookup?code=...` | none | — | public query-param lookup |

### Admin & Telemetry (`make_admin.py <email>` to promote users)
| Method | Route | Auth | Body | Notes |
|---|---|---|---|---|
| GET | `/admin` | Admin | — | Admin Dashboard view shell |
| GET | `/admin/stats` | Admin | — | System telemetry & verdict distribution counts |
| GET | `/admin/overview` | Admin | — | Composite admin dashboard dataset |
| GET | `/admin/labels` | Admin | — | Searchable, paginated label registry |
| PUT | `/admin/labels/<id>` | Admin | `name, company, qty, exp, is_active` | Edit registered label or toggle soft-recall |
| DELETE | `/admin/labels/<id>` | Admin | — | Permanent delete with safe scan detachment (`label_id = None`) |
| GET | `/admin/scans` | Admin | — | Cross-user scan telemetry joined with scanner names & emails |
| GET | `/admin/users` | Admin | — | User directory with scan counts, verification & active status |
| PATCH | `/admin/users/<id>` | Admin | `is_active, is_admin` | Suspend user access or promote/demote administrator |

### Scans
| Method | Route | Auth | Body | Notes |
|---|---|---|---|---|
| POST | `/scan/analyze` | optional | `code, hue, saturation, value` | what the frontend calls — combined pigment + expiry verdict; saves to history if a valid token is sent |
| POST | `/scan/save` | required | `result, color_hex, ph_estimate, description, hue, saturation, value, code` | compatibility endpoint for client-computed results |
| GET | `/scan/history` | required | — | last 50 scans for the signed-in user |
| DELETE | `/scan/history` | required | — | deletes all of the signed-in user's scans |

### Account / Settings
| Method | Route | Auth | Body | Notes |
|---|---|---|---|---|
| GET | `/account/me` | required | — | profile: name, email, is_admin, notify_flagged, member_since |
| PUT | `/account/profile` | required | `name` | update display name |
| PUT | `/account/password` | required | `current_password, new_password` | current password only required if one's already set |
| PATCH | `/account/preferences` | required | `notify_flagged` | toggle flagged-scan email alerts |
| GET | `/account/export` | required | — | JSON dump of profile + full scan history |
| DELETE | `/account` | required | — | deletes the account and all of its scans |

### Health
| Method | Route |
|---|---|
| GET | `/health` |
