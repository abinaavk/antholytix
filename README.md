# Antholytix

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
│   ├── css/app.css
│   └── js/app.js         # all frontend logic (scanner, shop, history…)
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
| POST | `/auth/signup` | `name, email, password` | sends a 6-digit OTP by email |
| POST | `/auth/verify-otp` | `email, otp` | returns a JWT on success |
| POST | `/auth/resend-otp` | `email` | |
| POST | `/auth/login` | `email, password` | requires a verified account |
| POST | `/auth/google` | `id_token` | Google Sign-In |

### Labels (the data behind each QR code)
| Method | Route | Auth | Body | Notes |
|---|---|---|---|---|
| POST | `/labels` | required | `name, company, qty, mfg (YYYY-MM-DD), exp` | registers a new physical label; returns the generated `code` to encode into the QR square |
| GET | `/labels` | required | — | list recent labels |
| GET | `/labels/<code>` | none | — | public lookup by code |

### Scans
| Method | Route | Auth | Body | Notes |
|---|---|---|---|---|
| POST | `/scan/analyze` | optional | `code, hue, saturation, value` | what the frontend calls — combined pigment + expiry verdict; saves to history if a valid token is sent |
| POST | `/scan/save` | required | `result, color_hex, ph_estimate, description, hue, saturation, value, code` | compatibility endpoint for client-computed results |
| GET | `/scan/history` | required | — | last 50 scans for the signed-in user |

### Health
| Method | Route |
|---|---|
| GET | `/health` |
