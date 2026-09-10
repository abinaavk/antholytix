"""
Antholytix AI Flask Backend
=========================
Powers the Antholytix AI web app: account auth, label/QR registration and
lookup, and pigment + expiry scan analysis / history.

Run locally:
    export SECRET_KEY="change-me"
    export SMTP_USER="your@gmail.com"
    export SMTP_PASS="your-gmail-app-password"
    export GOOGLE_CLIENT_ID="your-web-client-id"
    python app.py

The app listens on 0.0.0.0:5050 by default (matches the original project).
"""
import os
import random
import string
import datetime
from functools import wraps

from flask import Flask, request, jsonify, render_template, Response
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
import smtplib
from email.message import EmailMessage
import jwt
import bcrypt
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# App & config
# ---------------------------------------------------------------------------
load_dotenv()

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get("DATABASE_URL", "sqlite:///antholytix.db")
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY")

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", 587))
SMTP_USER = os.environ.get("SMTP_USER")
SMTP_PASS = os.environ.get("SMTP_PASS")

# Comma-separated list of origins allowed to call this API, e.g.
# CORS_ORIGINS="https://antholytix.example.com,http://localhost:5500"
CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",")]
CORS(app, resources={r"/*": {"origins": CORS_ORIGINS}}, supports_credentials=True)

# Public base URL of this deployment — used for canonical links, Open Graph
# tags, and sitemap.xml. Set this to your real domain once you have one
# (e.g. SITE_URL=https://antholytix.com); it defaults to localhost so
# nothing breaks in local development.
SITE_URL = os.environ.get("SITE_URL", "http://localhost:5050").rstrip("/")

db = SQLAlchemy(app)

def ensure_schema():
    with app.app_context():
        db.create_all()
        try:
            with db.engine.connect() as conn:
                cols = [c["name"] for c in db.inspect(db.engine).get_columns("user")]
                if "is_active" not in cols:
                    conn.execute(db.text("ALTER TABLE user ADD COLUMN is_active BOOLEAN DEFAULT 1"))
                    conn.commit()
                if "is_admin" not in cols:
                    conn.execute(db.text("ALTER TABLE user ADD COLUMN is_admin BOOLEAN DEFAULT 0"))
                    conn.commit()
        except Exception as e:
            pass

ensure_schema()

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class User(db.Model):
    id              = db.Column(db.Integer, primary_key=True)
    name            = db.Column(db.String(100))
    email           = db.Column(db.String(150), unique=True)
    password_hash   = db.Column(db.String(200), nullable=True)
    google_id       = db.Column(db.String(100), nullable=True)
    otp             = db.Column(db.String(6), nullable=True)
    otp_expiry      = db.Column(db.DateTime, nullable=True)
    verified        = db.Column(db.Boolean, default=False)
    is_active       = db.Column(db.Boolean, default=True)
    is_admin        = db.Column(db.Boolean, default=False)
    notify_flagged  = db.Column(db.Boolean, default=True)   # email me when a scan comes back caution/danger
    created_at      = db.Column(db.DateTime, default=datetime.datetime.utcnow)

    def to_public_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "email": self.email,
            "is_admin": bool(self.is_admin),
            "is_active": bool(self.is_active) if self.is_active is not None else True,
            "has_password": bool(self.password_hash),
            "notify_flagged": bool(self.notify_flagged),
            "member_since": self.created_at.date().isoformat() if self.created_at else None,
        }

    def to_admin_dict(self):
        return {
            "id": self.id,
            "name": self.name or "Unnamed",
            "email": self.email,
            "verified": bool(self.verified),
            "is_admin": bool(self.is_admin),
            "is_active": bool(self.is_active) if self.is_active is not None else True,
            "is_disabled": not (bool(self.is_active) if self.is_active is not None else True),
            "google_linked": bool(self.google_id),
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "scan_count": Scan.query.filter_by(user_id=self.id).count(),
        }


class Label(db.Model):
    """One row per physical label / QR code you print."""
    id          = db.Column(db.Integer, primary_key=True)
    code        = db.Column(db.String(32), unique=True, nullable=False, index=True)  # e.g. "K7#9-QD4$-N2!B-8XM6"
    name        = db.Column(db.String(150), nullable=False)
    company     = db.Column(db.String(150), default="Antholytix AI Foods Pvt. Ltd.")
    qty         = db.Column(db.String(50), nullable=True)
    mfg_date    = db.Column(db.Date, nullable=False)
    exp_date    = db.Column(db.Date, nullable=False)
    is_active   = db.Column(db.Boolean, default=True)   # flip false to void/recall a code
    created_at  = db.Column(db.DateTime, default=datetime.datetime.utcnow)

    def to_dict(self):
        return {
            "code": self.code,
            "name": self.name,
            "company": self.company,
            "qty": self.qty,
            "mfg": self.mfg_date.isoformat(),
            "exp": self.exp_date.isoformat(),
            "active": self.is_active,
        }

    def to_admin_dict(self):
        return {
            "id": self.id,
            "code": self.code,
            "name": self.name,
            "company": self.company,
            "qty": self.qty,
            "mfg": self.mfg_date.isoformat() if self.mfg_date else None,
            "exp": self.exp_date.isoformat() if self.exp_date else None,
            "is_active": bool(self.is_active),
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "scan_count": Scan.query.filter_by(label_id=self.id).count(),
        }


class Scan(db.Model):
    id            = db.Column(db.Integer, primary_key=True)
    user_id       = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)  # nullable = anonymous scan allowed
    label_id      = db.Column(db.Integer, db.ForeignKey("label.id"), nullable=True)
    code_scanned  = db.Column(db.String(32), nullable=True)
    overall_state = db.Column(db.String(10))   # safe | caution | danger
    pigment_state = db.Column(db.String(10))
    expiry_state  = db.Column(db.String(10))
    color_hex     = db.Column(db.String(10))
    ph_estimate   = db.Column(db.String(20))
    description   = db.Column(db.String(200))
    hue           = db.Column(db.Float)
    saturation    = db.Column(db.Float)
    value         = db.Column(db.Float)
    created_at    = db.Column(db.DateTime, default=datetime.datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "overall": self.overall_state,
            "pigment_state": self.pigment_state,
            "expiry_state": self.expiry_state,
            "color_hex": self.color_hex,
            "ph_estimate": self.ph_estimate,
            "description": self.description,
            "code": self.code_scanned,
            "label": self.label.to_dict() if self.label_id and self.label else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


Scan.label = db.relationship("Label", backref="scans", foreign_keys=[Scan.label_id])

# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------
def make_token(user):
    return jwt.encode(
        {
            "user_id": user.id,
            "email": user.email,
            "is_admin": bool(getattr(user, "is_admin", False)),
            "exp": datetime.datetime.utcnow() + datetime.timedelta(days=30),
        },
        app.config["SECRET_KEY"],
        algorithm="HS256",
    )


def auth_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        h = request.headers.get("Authorization", "")
        if not h.startswith("Bearer "):
            return jsonify({"success": False, "message": "Unauthorized"}), 401
        try:
            data = jwt.decode(h.split(" ")[1], app.config["SECRET_KEY"], algorithms=["HS256"])
            request.user_id = data["user_id"]
            user = db.session.get(User, request.user_id)
            if not user:
                return jsonify({"success": False, "message": "User not found"}), 401
            if hasattr(user, "is_active") and user.is_active is False:
                return jsonify({"success": False, "message": "Account has been disabled"}), 403
        except jwt.ExpiredSignatureError:
            return jsonify({"success": False, "message": "Token expired"}), 401
        except jwt.InvalidTokenError:
            return jsonify({"success": False, "message": "Invalid token"}), 401
        return f(*args, **kwargs)
    return decorated


def admin_required(f):
    """Verifies the JWT token, checks is_active and user.is_admin. Returns 403 Forbidden otherwise."""
    @wraps(f)
    def decorated(*args, **kwargs):
        h = request.headers.get("Authorization", "")
        if not h.startswith("Bearer "):
            return jsonify({"success": False, "message": "Unauthorized"}), 401
        try:
            data = jwt.decode(h.split(" ")[1], app.config["SECRET_KEY"], algorithms=["HS256"])
            request.user_id = data["user_id"]
            user = db.session.get(User, request.user_id)
            if not user:
                return jsonify({"success": False, "message": "User not found"}), 401
            if hasattr(user, "is_active") and user.is_active is False:
                return jsonify({"success": False, "message": "Account has been disabled"}), 403
            if not getattr(user, "is_admin", False):
                return jsonify({"success": False, "message": "Admin privileges required"}), 403
            request.admin_user = user
        except jwt.ExpiredSignatureError:
            return jsonify({"success": False, "message": "Token expired"}), 401
        except jwt.InvalidTokenError:
            return jsonify({"success": False, "message": "Invalid token"}), 401
        return f(*args, **kwargs)
    return decorated


def optional_auth(f):
    """Like auth_required, but proceeds as anonymous (request.user_id = None) if no/invalid token."""
    @wraps(f)
    def decorated(*args, **kwargs):
        request.user_id = None
        h = request.headers.get("Authorization", "")
        if h.startswith("Bearer "):
            try:
                data = jwt.decode(h.split(" ")[1], app.config["SECRET_KEY"], algorithms=["HS256"])
                request.user_id = data["user_id"]
            except jwt.InvalidTokenError:
                pass
        return f(*args, **kwargs)
    return decorated


def build_otp_email_html(otp):
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Antholytix AI Verification Code</title>
</head>
<body style="margin:0; padding:0; background-color:#f4f1e9; font-family:'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f1e9; padding:40px 16px;">
    <tr>
      <td align="center">
        <!-- Main Card -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:500px; background-color:#ffffff; border-radius:24px; border:1px solid #eae6dc; box-shadow:0 14px 34px -16px rgba(20,20,20,0.12), 0 2px 8px -2px rgba(20,20,20,0.06); overflow:hidden;">
          <tr>
            <td style="padding:36px 32px;">
              <!-- Brand Header -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:26px;">
                <tr>
                  <td style="vertical-align:middle; padding-right:12px;">
                    <div style="width:34px; height:34px; border-radius:10px; background:linear-gradient(135deg, #c23e86, #7c4fc9 35%, #3f70da 70%, #3f9142); box-shadow:inset 0 0 0 2.5px rgba(255,255,255,0.85);"></div>
                  </td>
                  <td style="vertical-align:middle;">
                    <div style="font-family:'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size:18px; font-weight:700; color:#15181a; line-height:1.15; letter-spacing:-0.01em;">Antholytix AI</div>
                    <div style="font-size:11px; color:#93979a; margin-top:2px;">Freshness &amp; authenticity</div>
                  </td>
                </tr>
              </table>

              <!-- Eyebrow Pill -->
              <div style="display:inline-block; font-size:11px; font-weight:700; letter-spacing:0.05em; text-transform:uppercase; color:#238a4e; background-color:#e5f6ec; padding:4px 10px; border-radius:99px; margin-bottom:14px;">Verification Code</div>

              <!-- Heading -->
              <h1 style="margin:0 0 10px; font-size:22px; font-weight:700; color:#15181a; font-family:'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; letter-spacing:-0.02em;">Confirm your email address</h1>
              
              <!-- Subtitle -->
              <p style="margin:0 0 24px; font-size:13.5px; line-height:1.6; color:#5c6165;">Use the one-time code below to verify your email. This code is valid for <strong>10 minutes</strong>.</p>

              <!-- OTP Code Display Card -->
              <div style="background-color:#f5f3ec; border:1.5px solid #eae6dc; border-radius:16px; padding:22px 14px; text-align:center; margin-bottom:22px;">
                <div style="font-family:'Space Grotesk', ui-monospace, 'SFMono-Regular', Consolas, monospace; font-size:36px; font-weight:700; letter-spacing:10px; color:#15181a; text-indent:10px; line-height:1.1;">{otp}</div>
                <div style="font-size:11px; color:#93979a; margin-top:8px;">Expires in 10 minutes · Do not share this code</div>
              </div>

              <!-- Security Notice -->
              <p style="margin:0; font-size:12px; line-height:1.55; color:#93979a;">If you did not request this verification code, you can safely disregard this email — no changes have been made.</p>

              <!-- Spectrum Mini Gradient Line -->
              <div style="height:4px; border-radius:99px; background:linear-gradient(90deg, #c23e86, #7c4fc9, #3f70da, #3f9142, #d9a62e); margin:28px 0 18px;"></div>

              <!-- Footer info -->
              <div style="font-size:11.5px; line-height:1.5; color:#93979a;">
                <div><strong style="color:#5c6165;">Antholytix AI</strong> · Food Freshness &amp; Authenticity Detection</div>
                <div style="margin-top:3px;">Made by students of <a href="https://sandipanividyalaya.org" target="_blank" style="color:#5c6165; text-decoration:underline;">Sandipani Vidyalaya</a></div>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def send_otp(to, otp):
    msg = EmailMessage()
    msg["Subject"] = "Antholytix – Your Verification Code"
    msg["From"] = SMTP_USER
    msg["To"] = to

    plain_text = (
        f"Antholytix AI Verification Code\n\n"
        f"Your verification code is: {otp}\n\n"
        f"This code is valid for 10 minutes.\n"
        f"If you did not request this code, you can safely ignore this email.\n\n"
        f"Antholytix – Freshness & Authenticity\n"
        f"Made by students of Sandipani Vidyalaya (https://sandipanividyalaya.org)\n"
    )
    msg.set_content(plain_text)
    msg.add_alternative(build_otp_email_html(otp), subtype="html")

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=8) as s:
        s.starttls()
        s.login(SMTP_USER, SMTP_PASS)
        s.send_message(msg)


def gen_otp():
    return "".join(random.choices(string.digits, k=6))


def gen_label_code():
    """16 visible characters (letters + digits + symbols), grouped 4-4-4-4 with hyphens,
    matching the format printed on physical labels and expected by the scanner."""
    alphabet = string.ascii_uppercase + string.digits
    symbols = "!@#$%^&*?"
    while True:
        chars = []
        for _ in range(4):
            group = "".join(random.choices(alphabet, k=3)) + random.choice(symbols)
            chars.append("".join(random.sample(group, len(group))))
        code = "-".join(chars)
        if not Label.query.filter_by(code=code).first():
            return code


# ---------------------------------------------------------------------------
# Anthocyanin pH → freshness model (mirrors utils/ColorAnalyzer.kt / the web app's JS)
# ---------------------------------------------------------------------------
def classify_pigment(h, s, v):
    if s < 0.15 or v < 0.15:
        return {"state": "caution", "ph": "pH unclear", "label": "Low colour signal",
                "description": "Hold the label flatter and move to brighter, even light."}
    if (h >= 330 or h < 30) and s > 0.3:
        return {"state": "safe", "ph": "pH 1–4", "label": "Red / Pink",
                "description": "Acidic pigment reading — consistent with a fresh product."}
    if 270 <= h < 330:
        return {"state": "safe", "ph": "pH 5–6", "label": "Purple",
                "description": "Slightly acidic pigment reading — consistent with a fresh product."}
    if 200 <= h < 270:
        return {"state": "caution", "ph": "pH 7–8", "label": "Blue",
                "description": "Near-neutral pigment reading — quality is turning, consume soon."}
    if 90 <= h < 200:
        return {"state": "danger", "ph": "pH 9–10", "label": "Green",
                "description": "Basic pigment reading — spoilage compounds detected."}
    if 45 <= h < 90:
        return {"state": "danger", "ph": "pH 11+", "label": "Yellow",
                "description": "Strongly basic pigment reading — do not consume."}
    return {"state": "caution", "ph": "pH unclear", "label": "Unclassified",
            "description": "Reading was inconclusive — try scanning again."}


def classify_expiry(exp_date):
    if not exp_date:
        return {"state": "caution", "label": "Expiry unknown",
                "description": "This label did not carry a readable expiry date."}
    today = datetime.date.today()
    days = (exp_date - today).days
    if days < 0:
        return {"state": "danger", "label": f"Expired {abs(days)} day{'s' if abs(days) != 1 else ''} ago",
                "description": f"This product passed its expiry date on {exp_date.isoformat()}."}
    if days == 0:
        return {"state": "caution", "label": "Expires today",
                "description": f"Best consumed today — expiry date is {exp_date.isoformat()}."}
    if days <= 2:
        return {"state": "caution", "label": f"Expires in {days} day{'s' if days != 1 else ''}",
                "description": f"Best consumed soon — expiry date is {exp_date.isoformat()}."}
    return {"state": "safe", "label": f"{days} days remaining",
            "description": f"Well within date — expires {exp_date.isoformat()}."}


_RANK = {"safe": 0, "caution": 1, "danger": 2}


def worst_state(a, b):
    return a if _RANK[a] >= _RANK[b] else b


# ---------------------------------------------------------------------------
# Security headers on every response — a reasonable baseline for any site.
# ---------------------------------------------------------------------------
@app.after_request
def set_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(self), microphone=(), geolocation=()"
    return response


# ---------------------------------------------------------------------------
# Frontend (served from templates/ + static/, same app as the API)
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    # api_base is "" because the page is served by this same Flask app, so
    # the frontend's fetch() calls just hit relative paths like /scan/analyze.
    # google_client_id is only sent to the browser if it's actually configured,
    # so the frontend can hide the "Continue with Google" button otherwise.
    google_id = GOOGLE_CLIENT_ID if os.environ.get("GOOGLE_CLIENT_ID") else ""
    return render_template("index.html", api_base="", google_client_id=google_id, site_url=SITE_URL)


@app.route("/docs")
def docs():
    """Real, server-rendered documentation — unlike the hash-routed app
    above, this page's content exists in the HTML Flask sends back, so
    search engines (and AI crawlers) can read it without running JS."""
    return render_template("docs.html", site_url=SITE_URL)


@app.route("/robots.txt")
def robots_txt():
    lines = [
        "User-agent: *",
        "Allow: /",
        "Disallow: /account",
        "Disallow: /scan/",
        "Disallow: /labels",
        "",
        "# AI assistants and answer-engine crawlers are explicitly welcome —",
        "# this is a product site, not sensitive content.",
        "User-agent: GPTBot",
        "Allow: /",
        "User-agent: ChatGPT-User",
        "Allow: /",
        "User-agent: ClaudeBot",
        "Allow: /",
        "User-agent: anthropic-ai",
        "Allow: /",
        "User-agent: PerplexityBot",
        "Allow: /",
        "User-agent: CCBot",
        "Allow: /",
        "User-agent: Google-Extended",
        "Allow: /",
        "",
        f"Sitemap: {SITE_URL}/sitemap.xml",
    ]
    return Response("\n".join(lines) + "\n", mimetype="text/plain")


@app.route("/sitemap.xml")
def sitemap_xml():
    # The dashboard/scanner/shop/history views are hash-routed client state
    # behind "/", not separate crawlable URLs, so only genuinely distinct
    # server-rendered pages belong here.
    pages = [
        {"loc": f"{SITE_URL}/", "changefreq": "weekly", "priority": "1.0"},
        {"loc": f"{SITE_URL}/docs", "changefreq": "monthly", "priority": "0.8"},
    ]
    xml = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for p in pages:
        xml.append(f"  <url><loc>{p['loc']}</loc><changefreq>{p['changefreq']}</changefreq><priority>{p['priority']}</priority></url>")
    xml.append("</urlset>")
    return Response("\n".join(xml), mimetype="application/xml")


@app.route("/llms.txt")
def llms_txt():
    """The emerging llms.txt convention — a concise, plain-language summary
    for AI agents/assistants to read instead of trying to scrape the SPA."""
    text = f"""# Antholytix AI

> Anthocyanin pigment + QR label scanner for checking food freshness and label authenticity.

Antholytix AI labels combine a natural anthocyanin (plant pigment) freshness
indicator with a unique QR code. Scanning a label with the Antholytix AI web
app checks two things at once: whether the pigment's colour shift signals
the product is turning, and whether the QR code and expiry date on record
are genuine and current.

Scope: designed for packaged perishable proteins and dairy (milk, paneer,
yoghurt, meat, fish). Not intended for naturally acidic or dry foods, where
the pH-based colour shift doesn't reliably track spoilage.

## Key pages
- Home / app: {SITE_URL}/ (interactive — sign-in, scanner, shop, history)
- Documentation: {SITE_URL}/docs
- How the chemistry works: {SITE_URL}/#/about

## Contact
WhatsApp: https://wa.me/919363719509
"""
    return Response(text, mimetype="text/plain")


@app.errorhandler(404)
def not_found(e):
    return render_template("404.html", site_url=SITE_URL), 404


@app.errorhandler(500)
def server_error(e):
    return render_template("404.html", site_url=SITE_URL, is_server_error=True), 500


# ===========================================================================
# AUTH ROUTES
# ===========================================================================
@app.route("/auth/signup", methods=["POST"])
def signup():
    d = request.json or {}
    name = (d.get("name") or "").strip()
    email = (d.get("email") or "").strip().lower()
    password = d.get("password") or ""
    confirm_password = d.get("confirm_password")
    if not all([name, email, password]):
        return jsonify({"success": False, "message": "All fields required"})
    if confirm_password is not None and password != confirm_password:
        return jsonify({"success": False, "message": "Passwords do not match"})

    existing = User.query.filter_by(email=email).first()
    if existing:
        if existing.verified:
            return jsonify({"success": False, "message": "Email already registered"})
        db.session.delete(existing)
        db.session.commit()

    otp = gen_otp()

    # Attempt to send OTP email first; if it fails, do not register the account
    try:
        send_otp(email, otp)
    except Exception as e:
        print(f"Email error: {e}")
        return jsonify({"success": False, "message": "Failed to send verification email. Please check your email and try again."})

    pw = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    user = User(name=name, email=email, password_hash=pw, otp=otp,
                otp_expiry=datetime.datetime.utcnow() + datetime.timedelta(minutes=10),
                verified=False)
    db.session.add(user)
    db.session.commit()
    return jsonify({"success": True, "message": "OTP sent to your email"})


@app.route("/auth/verify-otp", methods=["POST"])
def verify_otp():
    d = request.json or {}
    email = (d.get("email") or "").strip().lower()
    otp = (d.get("otp") or "").strip()
    user = User.query.filter_by(email=email).first()
    if not user:
        return jsonify({"success": False, "message": "User not found"})
    if user.otp != otp:
        return jsonify({"success": False, "message": "Invalid OTP"})
    if not user.otp_expiry or datetime.datetime.utcnow() > user.otp_expiry:
        return jsonify({"success": False, "message": "OTP expired"})
    user.verified = True
    user.otp = None
    db.session.commit()
    return jsonify({"success": True, "message": "Verified", "token": make_token(user),
                     "name": user.name, "email": user.email, "is_admin": bool(getattr(user, "is_admin", False))})


@app.route("/auth/resend-otp", methods=["POST"])
def resend_otp():
    email = ((request.json or {}).get("email") or "").strip().lower()
    if not email:
        return jsonify({"success": False, "message": "Email is required"})
    user = User.query.filter_by(email=email).first()
    if not user:
        return jsonify({"success": False, "message": "User not found"})
    otp = gen_otp()
    try:
        send_otp(user.email, otp)
    except Exception as e:
        print(f"Resend OTP email error: {e}")
        return jsonify({"success": False, "message": "Failed to send verification email. Please try again."})
    user.otp = otp
    user.otp_expiry = datetime.datetime.utcnow() + datetime.timedelta(minutes=10)
    db.session.commit()
    return jsonify({"success": True, "message": "OTP resent"})


@app.route("/auth/login", methods=["POST"])
def login():
    d = request.json or {}
    email = (d.get("email") or "").strip().lower()
    password = d.get("password") or ""
    user = User.query.filter_by(email=email).first()
    if not user or not user.password_hash:
        return jsonify({"success": False, "message": "Invalid credentials"})
    if not bcrypt.checkpw(password.encode(), user.password_hash.encode()):
        return jsonify({"success": False, "message": "Invalid credentials"})
    if not user.verified:
        return jsonify({"success": False, "message": "Email not verified. Check your inbox."})
    if hasattr(user, "is_active") and user.is_active is False:
        return jsonify({"success": False, "message": "This account has been disabled. Please contact support."})
    return jsonify({"success": True, "message": "Login successful", "token": make_token(user),
                     "name": user.name, "email": user.email, "is_admin": bool(getattr(user, "is_admin", False))})


@app.route("/auth/google", methods=["POST"])
def google_auth():
    try:
        from google.oauth2 import id_token
        from google.auth.transport import requests as grequests
        token = (request.json or {}).get("id_token")
        if not token:
            return jsonify({"success": False, "message": "id_token missing"})
        info = id_token.verify_oauth2_token(token, grequests.Request(), GOOGLE_CLIENT_ID)
        email = (info.get("email") or "").strip().lower()
        name = info.get("name", email.split("@")[0])
    except Exception as e:
        return jsonify({"success": False, "message": f"Token error: {e}"})
    user = User.query.filter_by(email=email).first()
    if not user:
        user = User(name=name, email=email, google_id=info["sub"], verified=True)
        db.session.add(user)
        db.session.commit()
    else:
        if hasattr(user, "is_active") and user.is_active is False:
            return jsonify({"success": False, "message": "This account has been disabled. Please contact support."})
        if not user.google_id:
            user.google_id = info["sub"]
        user.verified = True
        db.session.commit()
    return jsonify({"success": True, "message": "Login successful", "token": make_token(user),
                     "name": user.name, "email": user.email, "is_admin": bool(getattr(user, "is_admin", False))})


# ===========================================================================
# LABEL ROUTES  (create / list / lookup — this is what the QR code points to)
# ===========================================================================
@app.route("/labels", methods=["POST"])
@admin_required
def create_label():
    """Register a new physical label. Call this once per label you print,
    then encode the returned `code` (or the whole JSON) into its QR square."""
    d = request.json or {}
    name = d.get("name")
    if not name:
        return jsonify({"success": False, "message": "name is required"}), 400
    try:
        mfg = datetime.date.fromisoformat(d["mfg"]) if d.get("mfg") else datetime.date.today()
        exp = (datetime.date.fromisoformat(d["exp"]) if d.get("exp")
               else mfg + datetime.timedelta(days=int(d.get("shelf_life_days", 14))))
    except (KeyError, ValueError):
        return jsonify({"success": False, "message": "mfg/exp must be YYYY-MM-DD"}), 400

    label = Label(
        code=d.get("code") or gen_label_code(),
        name=name,
        company=d.get("company", "Antholytix AI Foods Pvt. Ltd."),
        qty=d.get("qty"),
        mfg_date=mfg,
        exp_date=exp,
    )
    db.session.add(label)
    db.session.commit()
    return jsonify({"success": True, "label": label.to_dict()})


@app.route("/labels", methods=["GET"])
@admin_required
def list_labels():
    labels = Label.query.order_by(Label.created_at.desc()).limit(200).all()
    return jsonify({"success": True, "labels": [l.to_dict() for l in labels]})


@app.route("/labels/lookup", methods=["GET"])
@app.route("/labels/<path:code>", methods=["GET"])
def lookup_label(code=None):
    """Public endpoint — this is what the scanner calls after decoding a QR code.
    No auth required, since a shopper scanning a shelf label isn't logged in."""
    if not code:
        code = request.args.get("code") or ""
    label = Label.query.filter_by(code=code.upper()).first()
    if not label or not label.is_active:
        return jsonify({"success": False, "message": "Label not recognised"}), 404
    return jsonify({"success": True, "label": label.to_dict()})


# ===========================================================================
# SCAN ROUTES
# ===========================================================================
@app.route("/scan/analyze", methods=["POST"])
@optional_auth
def analyze_scan():
    """
    Server-side source of truth for a scan result. Body:
      { "code": "K7#9-QD4$-N2!B-8XM6", "hue": 342.5, "saturation": 0.61, "value": 0.68 }
    `hue` is 0-360, `saturation`/`value` are 0-1 (same convention as the web app).
    Returns the combined pigment + expiry verdict, and saves it to history if
    the caller sent a valid Authorization bearer token.
    """
    d = request.json or {}
    code = (d.get("code") or "").strip().upper()
    hue = float(d.get("hue", 0))
    sat = float(d.get("saturation", 0))
    val = float(d.get("value", 0))

    pigment = classify_pigment(hue, sat, val)
    label = Label.query.filter_by(code=code).first() if code else None

    if code and not label:
        return jsonify({
            "success": True, "recognised": False, "code": code,
            "pigment": pigment,
            "message": "This QR code isn't linked to a known Antholytix AI product.",
        })

    expiry = classify_expiry(label.exp_date if label else None)
    overall = worst_state(pigment["state"], expiry["state"])

    scan = Scan(
        user_id=getattr(request, "user_id", None),
        label_id=label.id if label else None,
        code_scanned=code or None,
        overall_state=overall,
        pigment_state=pigment["state"],
        expiry_state=expiry["state"],
        color_hex=d.get("color_hex"),
        ph_estimate=pigment["ph"],
        description=pigment["description"],
        hue=hue, saturation=sat, value=val,
    )
    db.session.add(scan)
    db.session.commit()

    return jsonify({
        "success": True,
        "recognised": True,
        "overall": overall,
        "pigment": pigment,
        "expiry": expiry,
        "label": label.to_dict() if label else None,
        "scan_id": scan.id,
    })


@app.route("/scan/save", methods=["POST"])
@auth_required
def save_scan():
    """Kept for compatibility with the original app — saves a client-computed result directly."""
    d = request.json or {}
    s = Scan(
        user_id=request.user_id,
        overall_state=d.get("result"),
        pigment_state=d.get("result"),
        color_hex=d.get("color_hex"),
        ph_estimate=d.get("ph_estimate"),
        description=d.get("description"),
        hue=d.get("hue", 0), saturation=d.get("saturation", 0), value=d.get("value", 0),
        code_scanned=d.get("code"),
    )
    db.session.add(s)
    db.session.commit()
    return jsonify({"success": True, "message": "Saved", "scan_id": s.id})


@app.route("/scan/history", methods=["GET"])
@auth_required
def get_history():
    scans = (Scan.query.filter_by(user_id=request.user_id)
             .order_by(Scan.created_at.desc()).limit(50).all())
    return jsonify({"success": True, "scans": [s.to_dict() for s in scans]})


@app.route("/scan/history", methods=["DELETE"])
@auth_required
def clear_history():
    deleted = Scan.query.filter_by(user_id=request.user_id).delete()
    db.session.commit()
    return jsonify({"success": True, "message": f"Cleared {deleted} scan(s)"})


# ===========================================================================
# ACCOUNT / SETTINGS ROUTES
# ===========================================================================
@app.route("/account/me", methods=["GET"])
@auth_required
def get_me():
    user = db.session.get(User, request.user_id)
    if not user:
        return jsonify({"success": False, "message": "Account not found"}), 404
    return jsonify({"success": True, "user": user.to_public_dict()})


@app.route("/account/profile", methods=["PUT"])
@auth_required
def update_profile():
    user = db.session.get(User, request.user_id)
    if not user:
        return jsonify({"success": False, "message": "Account not found"}), 404
    d = request.json or {}
    name = (d.get("name") or "").strip()
    if not name:
        return jsonify({"success": False, "message": "Name can't be empty"}), 400
    user.name = name[:100]
    db.session.commit()
    return jsonify({"success": True, "user": user.to_public_dict()})


@app.route("/account/password", methods=["PUT"])
@auth_required
def update_password():
    user = db.session.get(User, request.user_id)
    if not user:
        return jsonify({"success": False, "message": "Account not found"}), 404
    d = request.json or {}
    current, new = d.get("current_password", ""), d.get("new_password", "")
    if not new or len(new) < 6:
        return jsonify({"success": False, "message": "New password must be at least 6 characters"}), 400
    if user.password_hash:
        # Account has a password already (not Google-only) — the current one must check out.
        if not bcrypt.checkpw(current.encode(), user.password_hash.encode()):
            return jsonify({"success": False, "message": "Current password is incorrect"}), 400
    user.password_hash = bcrypt.hashpw(new.encode(), bcrypt.gensalt()).decode()
    db.session.commit()
    return jsonify({"success": True, "message": "Password updated"})


@app.route("/account/preferences", methods=["PATCH"])
@auth_required
def update_preferences():
    user = db.session.get(User, request.user_id)
    if not user:
        return jsonify({"success": False, "message": "Account not found"}), 404
    d = request.json or {}
    if "notify_flagged" in d:
        user.notify_flagged = bool(d["notify_flagged"])
    db.session.commit()
    return jsonify({"success": True, "user": user.to_public_dict()})


@app.route("/account/export", methods=["GET"])
@auth_required
def export_account():
    user = db.session.get(User, request.user_id)
    if not user:
        return jsonify({"success": False, "message": "Account not found"}), 404
    scans = Scan.query.filter_by(user_id=request.user_id).order_by(Scan.created_at.desc()).all()
    return jsonify({
        "success": True,
        "exported_at": datetime.datetime.utcnow().isoformat(),
        "account": user.to_public_dict(),
        "scans": [s.to_dict() for s in scans],
    })


@app.route("/account", methods=["DELETE"])
@auth_required
def delete_account():
    user = db.session.get(User, request.user_id)
    if not user:
        return jsonify({"success": False, "message": "Account not found"}), 404
    Scan.query.filter_by(user_id=request.user_id).delete()
    db.session.delete(user)
    db.session.commit()
    return jsonify({"success": True, "message": "Account deleted"})


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"success": True, "service": "antholytix-backend", "time": datetime.datetime.utcnow().isoformat()})


# ===========================================================================
# ADMIN ROUTES (HTML page + JSON API protected by @admin_required)
# ===========================================================================
@app.route("/admin")
def admin_page():
    return render_template("index.html", api_base="", google_client_id=GOOGLE_CLIENT_ID or "", site_url=SITE_URL)


@app.route("/admin/stats", methods=["GET"])
@app.route("/api/admin/stats", methods=["GET"])
@admin_required
def admin_stats():
    total_users = User.query.count()
    total_scans = Scan.query.count()
    safe_scans = Scan.query.filter_by(overall_state="safe").count()
    caution_scans = Scan.query.filter_by(overall_state="caution").count()
    danger_scans = Scan.query.filter_by(overall_state="danger").count()
    total_active_labels = Label.query.filter_by(is_active=True).count()
    total_labels = Label.query.count()

    return jsonify({
        "success": True,
        "stats": {
            "total_users": total_users,
            "total_scans": total_scans,
            "total_active_labels": total_active_labels,
            "total_labels": total_labels,
            "active_labels": total_active_labels,
            "verdicts": {
                "safe": safe_scans,
                "caution": caution_scans,
                "danger": danger_scans
            }
        }
    })


@app.route("/admin/overview", methods=["GET"])
@app.route("/api/admin/overview", methods=["GET"])
@admin_required
def admin_overview():
    total_users = User.query.count()
    verified_users = User.query.filter_by(verified=True).count()
    disabled_users = User.query.filter_by(is_active=False).count()
    total_labels = Label.query.count()
    active_labels = Label.query.filter_by(is_active=True).count()
    total_scans = Scan.query.count()
    safe_scans = Scan.query.filter_by(overall_state="safe").count()
    caution_scans = Scan.query.filter_by(overall_state="caution").count()
    danger_scans = Scan.query.filter_by(overall_state="danger").count()

    users = User.query.order_by(User.created_at.desc()).limit(150).all()
    labels = Label.query.order_by(Label.created_at.desc()).limit(150).all()
    recent_scans = Scan.query.order_by(Scan.created_at.desc()).limit(40).all()

    def scan_to_admin(s):
        u = db.session.get(User, s.user_id) if s.user_id else None
        return {
            "id": s.id,
            "code": s.code_scanned or (s.label.code if s.label else "—"),
            "name": (s.label and s.label.name) or s.code_scanned or "Unrecognised product",
            "overall": s.overall_state or "caution",
            "pigment_state": s.pigment_state or "caution",
            "expiry_state": s.expiry_state or "caution",
            "color_hex": s.color_hex or "#93979a",
            "ph": s.ph_estimate or "—",
            "user_id": u.id if u else None,
            "user_email": u.email if u else "Anonymous",
            "user_name": u.name if u else "Anonymous",
            "created_at": s.created_at.isoformat() if s.created_at else None,
        }

    return jsonify({
        "success": True,
        "stats": {
            "total_users": total_users,
            "verified_users": verified_users,
            "disabled_users": disabled_users,
            "total_labels": total_labels,
            "active_labels": active_labels,
            "total_active_labels": active_labels,
            "total_scans": total_scans,
            "verdicts": {
                "safe": safe_scans,
                "caution": caution_scans,
                "danger": danger_scans
            }
        },
        "users": [u.to_admin_dict() for u in users],
        "labels": [l.to_admin_dict() for l in labels],
        "recent_scans": [scan_to_admin(s) for s in recent_scans]
    })


@app.route("/admin/labels", methods=["GET"])
@app.route("/api/admin/labels", methods=["GET"])
@admin_required
def admin_labels():
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 20, type=int)
    q = (request.args.get("q") or "").strip()

    query = Label.query
    if q:
        search = f"%{q}%"
        query = query.filter(db.or_(Label.code.ilike(search), Label.name.ilike(search), Label.company.ilike(search)))

    pagination = query.order_by(Label.created_at.desc()).paginate(page=page, per_page=per_page, error_out=False)
    return jsonify({
        "success": True,
        "labels": [l.to_admin_dict() for l in pagination.items],
        "total": pagination.total,
        "page": pagination.page,
        "pages": pagination.pages,
        "per_page": per_page
    })


@app.route("/admin/labels/<int:label_id>", methods=["PUT"])
@app.route("/api/admin/labels/<int:label_id>", methods=["PUT"])
@admin_required
def admin_update_label(label_id):
    label = db.session.get(Label, label_id)
    if not label:
        return jsonify({"success": False, "message": "Label not found"}), 404

    d = request.json or {}
    if "name" in d and d["name"]:
        label.name = d["name"].strip()
    if "company" in d:
        label.company = d["company"].strip()
    if "qty" in d:
        label.qty = d["qty"]
    if "is_active" in d:
        label.is_active = bool(d["is_active"])
    elif "active" in d:
        label.is_active = bool(d["active"])

    if "mfg" in d or "mfg_date" in d:
        mfg_val = d.get("mfg") or d.get("mfg_date")
        if mfg_val:
            try:
                label.mfg_date = datetime.date.fromisoformat(mfg_val)
            except ValueError:
                pass
    if "exp" in d or "exp_date" in d:
        exp_val = d.get("exp") or d.get("exp_date")
        if exp_val:
            try:
                label.exp_date = datetime.date.fromisoformat(exp_val)
            except ValueError:
                pass

    db.session.commit()
    return jsonify({"success": True, "label": label.to_admin_dict(), "message": "Label updated successfully"})


@app.route("/admin/labels/<int:label_id>", methods=["DELETE"])
@app.route("/api/admin/labels/<int:label_id>", methods=["DELETE"])
@admin_required
def admin_delete_label(label_id):
    label = db.session.get(Label, label_id)
    if not label:
        return jsonify({"success": False, "message": "Label not found"}), 404
    code = label.code
    Scan.query.filter_by(label_id=label.id).update({"label_id": None})
    db.session.delete(label)
    db.session.commit()
    return jsonify({"success": True, "message": f"Label {code} deleted successfully"})


@app.route("/admin/labels/<int:label_id>/toggle-status", methods=["PATCH"])
@app.route("/api/admin/labels/<int:label_id>/toggle-status", methods=["PATCH"])
@admin_required
def admin_toggle_label(label_id):
    label = db.session.get(Label, label_id)
    if not label:
        return jsonify({"success": False, "message": "Label not found"}), 404
    label.is_active = not bool(label.is_active)
    db.session.commit()
    return jsonify({
        "success": True,
        "is_active": label.is_active,
        "message": f"Label {'activated' if label.is_active else 'voided'} successfully"
    })


@app.route("/admin/scans", methods=["GET"])
@app.route("/api/admin/scans", methods=["GET"])
@admin_required
def admin_scans():
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 20, type=int)
    overall_state = request.args.get("overall_state") or request.args.get("state")
    start_date = request.args.get("start_date")
    end_date = request.args.get("end_date")
    q = (request.args.get("q") or "").strip()

    query = db.session.query(Scan, User).outerjoin(User, Scan.user_id == User.id)

    if overall_state and overall_state in ["safe", "caution", "danger"]:
        query = query.filter(Scan.overall_state == overall_state)

    if start_date:
        try:
            s_dt = datetime.datetime.fromisoformat(start_date)
            query = query.filter(Scan.created_at >= s_dt)
        except ValueError:
            pass

    if end_date:
        try:
            e_dt = datetime.datetime.fromisoformat(end_date)
            query = query.filter(Scan.created_at <= e_dt)
        except ValueError:
            pass

    if q:
        search = f"%{q}%"
        query = query.filter(db.or_(
            Scan.code_scanned.ilike(search),
            User.email.ilike(search),
            User.name.ilike(search)
        ))

    pagination = query.order_by(Scan.created_at.desc()).paginate(page=page, per_page=per_page, error_out=False)

    scans = []
    for s, u in pagination.items:
        scans.append({
            "id": s.id,
            "code": s.code_scanned or (s.label.code if s.label else "—"),
            "name": (s.label and s.label.name) or s.code_scanned or "Unrecognised product",
            "overall": s.overall_state or "caution",
            "pigment_state": s.pigment_state or "caution",
            "expiry_state": s.expiry_state or "caution",
            "color_hex": s.color_hex or "#93979a",
            "ph": s.ph_estimate or "—",
            "user_id": u.id if u else None,
            "user_email": u.email if u else "Anonymous",
            "user_name": u.name if u else "Anonymous",
            "created_at": s.created_at.isoformat() if s.created_at else None,
        })

    return jsonify({
        "success": True,
        "scans": scans,
        "total": pagination.total,
        "page": pagination.page,
        "pages": pagination.pages,
        "per_page": per_page
    })


@app.route("/admin/users", methods=["GET"])
@app.route("/api/admin/users", methods=["GET"])
@admin_required
def admin_users():
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 50, type=int)
    q = (request.args.get("q") or "").strip()

    query = User.query
    if q:
        search = f"%{q}%"
        query = query.filter(db.or_(User.email.ilike(search), User.name.ilike(search)))

    pagination = query.order_by(User.created_at.desc()).paginate(page=page, per_page=per_page, error_out=False)
    return jsonify({
        "success": True,
        "users": [u.to_admin_dict() for u in pagination.items],
        "total": pagination.total,
        "page": pagination.page,
        "pages": pagination.pages,
        "per_page": per_page
    })


@app.route("/admin/users/<int:user_id>", methods=["PATCH"])
@app.route("/api/admin/users/<int:user_id>", methods=["PATCH"])
@app.route("/admin/users/<int:user_id>/toggle-status", methods=["PATCH"])
@app.route("/api/admin/users/<int:user_id>/toggle-status", methods=["PATCH"])
@admin_required
def admin_patch_user(user_id):
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({"success": False, "message": "User not found"}), 404

    data = request.json or {}
    if "is_admin" in data:
        user.is_admin = bool(data["is_admin"])
    if "is_disabled" in data:
        user.is_active = not bool(data["is_disabled"])
    if "is_active" in data:
        user.is_active = bool(data["is_active"])
    if not data or ("is_admin" not in data and "is_disabled" not in data and "is_active" not in data):
        # Default toggle active status
        user.is_active = not bool(getattr(user, "is_active", True))

    db.session.commit()
    return jsonify({
        "success": True,
        "user": user.to_admin_dict(),
        "is_active": user.is_active,
        "is_disabled": not user.is_active,
        "is_admin": user.is_admin,
        "message": f"User {user.email} updated successfully"
    })


# ---------------------------------------------------------------------------
if __name__ == "__main__":
    with app.app_context():
        db.create_all()
    app.run(host="0.0.0.0", port=6990, debug=False)
