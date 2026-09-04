"""
Antholytix Flask Backend
=========================
Powers the Antholytix web app: account auth, label/QR registration and
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

from flask import Flask, request, jsonify, render_template
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
import smtplib
from email.message import EmailMessage
import jwt
import bcrypt

# ---------------------------------------------------------------------------
# App & config
# ---------------------------------------------------------------------------
app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get("DATABASE_URL", "sqlite:///antholytix.db")
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "change-me-in-production")

GOOGLE_CLIENT_ID = os.environ.get(
    "GOOGLE_CLIENT_ID",
    "271343610119-96hedavbp4kadn6lnp0opfuj6r08umbv.apps.googleusercontent.com",
)
SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", 587))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASS = os.environ.get("SMTP_PASS", "")

# Comma-separated list of origins allowed to call this API, e.g.
# CORS_ORIGINS="https://antholytix.example.com,http://localhost:5500"
CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",")]
CORS(app, resources={r"/*": {"origins": CORS_ORIGINS}}, supports_credentials=True)

db = SQLAlchemy(app)

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class User(db.Model):
    id            = db.Column(db.Integer, primary_key=True)
    name          = db.Column(db.String(100))
    email         = db.Column(db.String(150), unique=True)
    password_hash = db.Column(db.String(200), nullable=True)
    google_id     = db.Column(db.String(100), nullable=True)
    otp           = db.Column(db.String(6), nullable=True)
    otp_expiry    = db.Column(db.DateTime, nullable=True)
    verified      = db.Column(db.Boolean, default=False)
    created_at    = db.Column(db.DateTime, default=datetime.datetime.utcnow)


class Label(db.Model):
    """One row per physical label / QR code you print."""
    id          = db.Column(db.Integer, primary_key=True)
    code        = db.Column(db.String(32), unique=True, nullable=False, index=True)  # e.g. "K7#9-QD4$-N2!B-8XM6"
    name        = db.Column(db.String(150), nullable=False)
    company     = db.Column(db.String(150), default="Antholytix Foods Pvt. Ltd.")
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
            "created_at": self.created_at.isoformat(),
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


def send_otp(to, otp):
    msg = EmailMessage()
    msg["Subject"] = "Antholytix – Your Verification Code"
    msg["From"] = SMTP_USER
    msg["To"] = to
    msg.set_content(f"Your Antholytix OTP is: {otp}\n\nExpires in 10 minutes.")
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as s:
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
# Frontend (served from templates/ + static/, same app as the API)
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    # api_base is "" because the page is served by this same Flask app, so
    # the frontend's fetch() calls just hit relative paths like /scan/analyze.
    return render_template("index.html", api_base="")


# ===========================================================================
# AUTH ROUTES
# ===========================================================================
@app.route("/auth/signup", methods=["POST"])
def signup():
    d = request.json or {}
    name, email, password = d.get("name"), d.get("email"), d.get("password")
    if not all([name, email, password]):
        return jsonify({"success": False, "message": "All fields required"})
    if User.query.filter_by(email=email).first():
        return jsonify({"success": False, "message": "Email already registered"})
    otp = gen_otp()
    pw = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    user = User(name=name, email=email, password_hash=pw, otp=otp,
                otp_expiry=datetime.datetime.utcnow() + datetime.timedelta(minutes=10))
    db.session.add(user)
    db.session.commit()
    try:
        send_otp(email, otp)
    except Exception as e:
        print(f"Email error: {e}")
    return jsonify({"success": True, "message": "OTP sent to your email"})


@app.route("/auth/verify-otp", methods=["POST"])
def verify_otp():
    d = request.json or {}
    user = User.query.filter_by(email=d.get("email")).first()
    if not user:
        return jsonify({"success": False, "message": "User not found"})
    if user.otp != d.get("otp"):
        return jsonify({"success": False, "message": "Invalid OTP"})
    if datetime.datetime.utcnow() > user.otp_expiry:
        return jsonify({"success": False, "message": "OTP expired"})
    user.verified = True
    user.otp = None
    db.session.commit()
    return jsonify({"success": True, "message": "Verified", "token": make_token(user),
                     "name": user.name, "email": user.email})


@app.route("/auth/resend-otp", methods=["POST"])
def resend_otp():
    user = User.query.filter_by(email=(request.json or {}).get("email")).first()
    if not user:
        return jsonify({"success": False, "message": "User not found"})
    otp = gen_otp()
    user.otp = otp
    user.otp_expiry = datetime.datetime.utcnow() + datetime.timedelta(minutes=10)
    db.session.commit()
    try:
        send_otp(user.email, otp)
    except Exception as e:
        return jsonify({"success": False, "message": str(e)})
    return jsonify({"success": True, "message": "OTP resent"})


@app.route("/auth/login", methods=["POST"])
def login():
    d = request.json or {}
    user = User.query.filter_by(email=d.get("email")).first()
    if not user or not user.password_hash:
        return jsonify({"success": False, "message": "Invalid credentials"})
    if not bcrypt.checkpw(d.get("password", "").encode(), user.password_hash.encode()):
        return jsonify({"success": False, "message": "Invalid credentials"})
    if not user.verified:
        return jsonify({"success": False, "message": "Email not verified. Check your inbox."})
    return jsonify({"success": True, "message": "Login successful", "token": make_token(user),
                     "name": user.name, "email": user.email})


@app.route("/auth/google", methods=["POST"])
def google_auth():
    try:
        from google.oauth2 import id_token
        from google.auth.transport import requests as grequests
        token = (request.json or {}).get("id_token")
        if not token:
            return jsonify({"success": False, "message": "id_token missing"})
        info = id_token.verify_oauth2_token(token, grequests.Request(), GOOGLE_CLIENT_ID)
        email = info["email"]
        name = info.get("name", email.split("@")[0])
    except Exception as e:
        return jsonify({"success": False, "message": f"Token error: {e}"})
    user = User.query.filter_by(email=email).first()
    if not user:
        user = User(name=name, email=email, google_id=info["sub"], verified=True)
        db.session.add(user)
        db.session.commit()
    return jsonify({"success": True, "message": "Login successful", "token": make_token(user),
                     "name": user.name, "email": user.email})


# ===========================================================================
# LABEL ROUTES  (create / list / lookup — this is what the QR code points to)
# ===========================================================================
@app.route("/labels", methods=["POST"])
@auth_required
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
        company=d.get("company", "Antholytix Foods Pvt. Ltd."),
        qty=d.get("qty"),
        mfg_date=mfg,
        exp_date=exp,
    )
    db.session.add(label)
    db.session.commit()
    return jsonify({"success": True, "label": label.to_dict()})


@app.route("/labels", methods=["GET"])
@auth_required
def list_labels():
    labels = Label.query.order_by(Label.created_at.desc()).limit(200).all()
    return jsonify({"success": True, "labels": [l.to_dict() for l in labels]})


@app.route("/labels/<path:code>", methods=["GET"])
def lookup_label(code):
    """Public endpoint — this is what the scanner calls after decoding a QR code.
    No auth required, since a shopper scanning a shelf label isn't logged in."""
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
            "message": "This QR code isn't linked to a known Antholytix product.",
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


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"success": True, "service": "antholytix-backend", "time": datetime.datetime.utcnow().isoformat()})


# ---------------------------------------------------------------------------
if __name__ == "__main__":
    with app.app_context():
        db.create_all()
    app.run(host="0.0.0.0", port=6990, debug=False)
