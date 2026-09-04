"""
Seeds a handful of demo labels — the same codes used by the demo data in the
Antholytix web app — so the frontend and a freshly-set-up backend agree with
each other out of the box.

Run once, after the database exists:
    python seed_labels.py

Safe to re-run: existing codes are left untouched, only missing ones are added.
"""
import datetime
from app import app, db, Label

DEMO = [
    # code                              name                    company                         qty      mfg_offset  exp_offset
    ("K7#9-QD4$-N2!B-8XM6", "Fresh Paneer, 200 g",   "Antholytix Foods Pvt. Ltd.", "200 g", -6,  8),
    ("B3$M-8K!Q-7N#D-Z1V4", "Greek Yogurt Cup",      "Antholytix Foods Pvt. Ltd.", "150 g", -20, -2),
    ("R5!P-2X$K-9M#B-Q7C3", "Chicken Mince, 500 g",  "Antholytix Foods Pvt. Ltd.", "500 g", -2,  1),
    ("T8@L-4V%R-1J&Y-5PS2", "Whole Milk, 1 L",       "Antholytix Foods Pvt. Ltd.", "1 L",   -1,  5),
]

with app.app_context():
    db.create_all()
    created = 0
    for code, name, company, qty, mfg_off, exp_off in DEMO:
        if Label.query.filter_by(code=code).first():
            continue
        today = datetime.date.today()
        db.session.add(Label(
            code=code, name=name, company=company, qty=qty,
            mfg_date=today + datetime.timedelta(days=mfg_off),
            exp_date=today + datetime.timedelta(days=exp_off),
        ))
        created += 1
    db.session.commit()
    print(f"Seeded {created} new demo label(s). {len(DEMO) - created} already existed.")
