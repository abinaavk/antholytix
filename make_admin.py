#!/usr/bin/env python3
"""
CLI script to promote a user to administrator.
Usage:
    python make_admin.py <email>
"""
import sys
import os

# Ensure project directory is in python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import app, db, User

def promote_to_admin(email):
    if not email or not email.strip():
        print("Error: Email argument is required.")
        print("Usage: python make_admin.py <email>")
        sys.exit(1)

    clean_email = email.strip().lower()
    with app.app_context():
        user = User.query.filter(User.email.ilike(clean_email)).first()
        if not user:
            print(f"Error: User with email '{clean_email}' not found.")
            sys.exit(1)

        user.is_admin = True
        db.session.commit()
        print(f"Success: User '{user.email}' (ID: {user.id}) has been promoted to admin.")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Error: No email provided.")
        print("Usage: python make_admin.py <email>")
        sys.exit(1)
    promote_to_admin(sys.argv[1])
