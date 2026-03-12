from flask import Flask, render_template, request, jsonify
import smtplib
from email.message import EmailMessage
import os

app = Flask(__name__)

SMTP_USER = os.environ.get("SMTP_USER", "antholytixai@gmail.com")
SMTP_PASS = os.environ.get("SMTP_PASS", "")

@app.route("/")
def home():
    return render_template("home.html")

@app.route("/technology")
def technology():
    return render_template("technology.html")

@app.route("/about")
def about():
    return render_template("about.html")

@app.route("/suggest", methods=["POST"])
def suggest():
    data = request.json
    msg = data.get("message", "").strip()
    if not msg:
        return jsonify({"success": False, "error": "Empty message"})
    try:
        em = EmailMessage()
        em["Subject"] = "Antholytix AI — Website Suggestion"
        em["From"] = SMTP_USER
        em["To"] = SMTP_USER
        em.set_content(msg)
        with smtplib.SMTP("smtp.gmail.com", 587) as s:
            s.starttls()
            s.login(SMTP_USER, SMTP_PASS)
            s.send_message(em)
        return jsonify({"success": True})
    except Exception as e:
        print(f"Mail error: {e}")
        return jsonify({"success": True})  # silent fail on server — don't block UX

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=6990, debug=False)
