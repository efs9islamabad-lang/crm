#!/usr/bin/env python3
"""Local-first ZameenIQ real estate CRM. Python standard library only."""

from __future__ import annotations

import hashlib
import hmac
import json
import mimetypes
import os
import secrets
import sqlite3
import sys
import threading
import time
import webbrowser
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "zameeniq.sqlite3"
HOST = "127.0.0.1"
PORT = int(os.environ.get("ZAMEENIQ_PORT", "8765"))
PBKDF2_ROUNDS = 310_000
SESSION_TTL = 12 * 60 * 60
sessions: dict[str, tuple[int, float]] = {}
sessions_lock = threading.Lock()

FEATURES = {
    "dashboard": "Dashboard",
    "leads": "Leads & inquiries",
    "properties": "Property inventory",
    "followups": "Follow-ups",
    "visits": "Site visits",
    "deals": "Deals & bookings",
    "reports": "Reports & analytics",
}
WIDGETS = {
    "metrics": "Overview cards",
    "pipeline": "Deal pipeline",
    "followups": "Follow-up agenda",
    "recentLeads": "Recent leads",
}
DEFAULT_SETTINGS = {
    "login_notice": "Your private workspace for property leads, inventory, and follow-ups.",
    "modules": {key: True for key in FEATURES},
    "widgets": {key: True for key in WIDGETS},
}


def db_connect() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def password_hash(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ROUNDS)
    return salt.hex() + "$" + digest.hex()


def password_matches(password: str, encoded: str) -> bool:
    try:
        salt_hex, digest_hex = encoded.split("$", 1)
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), PBKDF2_ROUNDS)
        return hmac.compare_digest(digest.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


def iso_day(offset: int = 0) -> str:
    return (date.today() + timedelta(days=offset)).isoformat()


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with db_connect() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE COLLATE NOCASE,
            name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('admin','user')),
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
            source TEXT NOT NULL DEFAULT 'Other', budget INTEGER NOT NULL DEFAULT 0,
            interest TEXT NOT NULL DEFAULT '', stage TEXT NOT NULL DEFAULT 'New',
            location TEXT NOT NULL DEFAULT '', next_followup TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS properties (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL, location TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT 'House',
            size TEXT NOT NULL DEFAULT '', price INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'Available', image TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS followups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL, lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
            due_date TEXT NOT NULL DEFAULT '', channel TEXT NOT NULL DEFAULT 'Call',
            status TEXT NOT NULL DEFAULT 'Open', notes TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS visits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
            property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
            visit_date TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Scheduled',
            notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS deals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
            property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
            value INTEGER NOT NULL DEFAULT 0, stage TEXT NOT NULL DEFAULT 'Negotiation',
            close_date TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        """)
        count = con.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        if count == 0:
            con.execute("INSERT INTO users(username,name,password_hash,role) VALUES(?,?,?,'admin')",
                        ("admin", "Workspace Admin", password_hash("Admin123!")))
            con.execute("INSERT INTO users(username,name,password_hash,role) VALUES(?,?,?,'user')",
                        ("user", "Sales User", password_hash("User123!")))
        for key, value in DEFAULT_SETTINGS.items():
            con.execute("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)", (key, json.dumps(value)))
        if con.execute("SELECT COUNT(*) FROM leads").fetchone()[0] == 0:
            leads = [
                ("Ayesha Khan", "0300 123 4567", "ayesha.khan@example.com", "Website", 28000000, "10 marla house", "Qualified", "DHA Phase 2, Islamabad", iso_day(0), "Looking for a family home; prefers a corner plot."),
                ("Omar Farooq", "0321 555 0112", "omar.f@example.com", "Referral", 45000000, "1 kanal plot", "Viewing", "Bahria Town, Islamabad", iso_day(1), "Available for a site visit this weekend."),
                ("Sara Malik", "0333 789 0044", "sara.malik@example.com", "Facebook", 16000000, "5 marla house", "New", "Gulberg Greens, Islamabad", iso_day(2), "Asked for payment plan details."),
                ("Bilal Ahmed", "0301 908 2020", "bilal.a@example.com", "Walk-in", 62000000, "1 kanal house", "Negotiation", "DHA Phase 6, Lahore", iso_day(-1), "Discussing final price and transfer timeline."),
                ("Hina Raza", "0345 222 0977", "hina.r@example.com", "WhatsApp", 22000000, "10 marla plot", "Contacted", "Bahria Town, Lahore", iso_day(3), "Interested in ready-to-transfer options."),
            ]
            con.executemany("""INSERT INTO leads(name,phone,email,source,budget,interest,stage,location,next_followup,notes)
                VALUES(?,?,?,?,?,?,?,?,?,?)""", leads)
        if con.execute("SELECT COUNT(*) FROM properties").fetchone()[0] == 0:
            props = [
                ("Contemporary 10 Marla Villa", "DHA Phase 2, Islamabad", "House", "10 Marla", 38500000, "Available", "login-villa.png", "Contemporary finish, possession available."),
                ("Corner 1 Kanal Plot · Street 14", "Bahria Town, Islamabad", "Plot", "1 Kanal", 24500000, "Available", "bahria-villa.png", "Corner plot near the main boulevard."),
                ("Designer 10 Marla Home", "Gulberg Greens, Islamabad", "House", "10 Marla", 31200000, "Reserved", "gulberg-home.png", "Modern kitchen and landscaped lawn."),
                ("Executive 1 Kanal Residence", "DHA Phase 6, Lahore", "House", "1 Kanal", 72000000, "Available", "dha-home.png", "Five bedrooms, recently renovated."),
            ]
            con.executemany("""INSERT INTO properties(title,location,type,size,price,status,image,notes)
                VALUES(?,?,?,?,?,?,?,?)""", props)
        if con.execute("SELECT COUNT(*) FROM followups").fetchone()[0] == 0:
            con.executemany("INSERT INTO followups(title,lead_id,due_date,channel,status,notes) VALUES(?,?,?,?,?,?)", [
                ("Confirm weekend viewing", 2, iso_day(0), "Call", "Open", "Ask which time works best."),
                ("Share payment schedule", 3, iso_day(0), "WhatsApp", "Open", "Send the latest installment plan."),
                ("Discuss final offer", 4, iso_day(-1), "Call", "Open", "Follow up on the revised offer."),
                ("Check property shortlist", 5, iso_day(2), "Email", "Open", "Send two ready-to-transfer options."),
            ])
        if con.execute("SELECT COUNT(*) FROM visits").fetchone()[0] == 0:
            con.executemany("INSERT INTO visits(lead_id,property_id,visit_date,status,notes) VALUES(?,?,?,?,?)", [
                (2, 2, iso_day(1) + "T11:30", "Scheduled", "Meet at the main gate."),
                (1, 1, iso_day(3) + "T16:00", "Scheduled", "Family will join the visit."),
            ])
        if con.execute("SELECT COUNT(*) FROM deals").fetchone()[0] == 0:
            con.executemany("INSERT INTO deals(lead_id,property_id,value,stage,close_date,notes) VALUES(?,?,?,?,?,?)", [
                (4, 4, 70000000, "Negotiation", iso_day(7), "Awaiting signed offer."),
                (2, 2, 24500000, "Viewing", iso_day(14), "Site visit scheduled."),
                (1, 1, 38500000, "Qualified", iso_day(20), "Financing details shared."),
            ])


def get_settings(con: sqlite3.Connection) -> dict:
    settings = {row["key"]: json.loads(row["value"]) for row in con.execute("SELECT key,value FROM settings")}
    merged = {**DEFAULT_SETTINGS, **settings}
    merged["modules"] = {**DEFAULT_SETTINGS["modules"], **settings.get("modules", {})}
    merged["widgets"] = {**DEFAULT_SETTINGS["widgets"], **settings.get("widgets", {})}
    return merged


def record_dict(row: sqlite3.Row) -> dict:
    return dict(row)


def rows(con: sqlite3.Connection, sql: str, params: tuple = ()) -> list[dict]:
    return [record_dict(row) for row in con.execute(sql, params).fetchall()]


class CRMHandler(BaseHTTPRequestHandler):
    server_version = "ZameenIQLocal/1.0"

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'")
        super().end_headers()

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def send_json(self, value: dict | list, status: int = 200, headers: dict | None = None) -> None:
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if headers:
            for key, val in headers.items():
                self.send_header(key, val)
        self.end_headers()
        self.wfile.write(body)

    def error(self, status: int, message: str) -> None:
        self.send_json({"error": message}, status)

    def read_json(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > 1_000_000:
                raise ValueError("Request is too large.")
            raw = self.rfile.read(length) if length else b"{}"
            value = json.loads(raw.decode("utf-8"))
            if not isinstance(value, dict):
                raise ValueError("Expected a JSON object.")
            return value
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("Invalid request body.") from exc

    def session_user(self) -> dict | None:
        cookie = self.headers.get("Cookie", "")
        token = next((part.split("=", 1)[1] for part in cookie.split(";") if part.strip().startswith("ziq_session=")), None)
        if not token:
            return None
        with sessions_lock:
            info = sessions.get(token)
            if not info or info[1] < time.time():
                sessions.pop(token, None)
                return None
        with db_connect() as con:
            user = con.execute("SELECT id,username,name,role,active FROM users WHERE id=?", (info[0],)).fetchone()
        if not user or not user["active"]:
            return None
        return record_dict(user)

    def require_user(self) -> dict | None:
        user = self.session_user()
        if user is None:
            self.error(401, "Please sign in to continue.")
        return user

    def is_admin(self, user: dict) -> bool:
        if user["role"] != "admin":
            self.error(403, "Admin access is required for this action.")
            return False
        return True

    def feature_enabled(self, user: dict, feature: str) -> bool:
        if user["role"] == "admin":
            return True
        with db_connect() as con:
            enabled = bool(get_settings(con)["modules"].get(feature, False))
        if not enabled:
            self.error(403, "This section is not enabled for your account.")
        return enabled

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/public-settings":
            with db_connect() as con:
                notice = get_settings(con)["login_notice"]
            self.send_json({"login_notice": notice})
            return
        if path == "/api/session":
            user = self.session_user()
            if not user:
                self.send_json({"user": None})
                return
            self.send_json({"user": {k: user[k] for k in ("id", "username", "name", "role")}})
            return
        if path.startswith("/api/"):
            user = self.require_user()
            if not user:
                return
            if path == "/api/bootstrap":
                self.api_bootstrap(user)
            elif path == "/api/admin/users":
                if self.is_admin(user):
                    with db_connect() as con:
                        self.send_json({"users": rows(con, "SELECT id,username,name,role,active,created_at FROM users ORDER BY id")})
            else:
                self.error(404, "Endpoint not found.")
            return
        self.serve_static(path)

    def serve_static(self, path: str) -> None:
        relative = "index.html" if path == "/" else unquote(path.lstrip("/"))
        target = (STATIC / relative).resolve()
        if not target.is_relative_to(STATIC.resolve()) or not target.is_file():
            self.send_error(404)
            return
        content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        payload = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type + ("; charset=utf-8" if content_type.startswith("text/") or content_type == "application/javascript" else ""))
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-cache" if target.name == "index.html" else "public, max-age=3600")
        self.end_headers()
        self.wfile.write(payload)

    def api_bootstrap(self, user: dict) -> None:
        with db_connect() as con:
            settings = get_settings(con)
            modules = {key: (user["role"] == "admin" or settings["modules"].get(key, False)) for key in FEATURES}
            data = {"leads": [], "properties": [], "followups": [], "visits": [], "deals": []}
            if modules["leads"]:
                data["leads"] = rows(con, "SELECT * FROM leads ORDER BY id DESC")
            if modules["properties"]:
                data["properties"] = rows(con, "SELECT * FROM properties ORDER BY id DESC")
            if modules["followups"]:
                lead_join = "LEFT JOIN leads l ON l.id=f.lead_id" if modules["leads"] else ""
                lead_name = "l.name" if modules["leads"] else "NULL"
                data["followups"] = rows(con, f"""SELECT f.*,{lead_name} AS lead_name FROM followups f
                    {lead_join} ORDER BY f.due_date,f.id DESC""")
            if modules["visits"]:
                lead_join = "LEFT JOIN leads l ON l.id=v.lead_id" if modules["leads"] else ""
                property_join = "LEFT JOIN properties p ON p.id=v.property_id" if modules["properties"] else ""
                lead_name = "l.name" if modules["leads"] else "NULL"
                property_title = "p.title" if modules["properties"] else "NULL"
                data["visits"] = rows(con, f"""SELECT v.*,{lead_name} AS lead_name,{property_title} AS property_title FROM visits v
                    {lead_join} {property_join} ORDER BY v.visit_date""")
            if modules["deals"]:
                lead_join = "LEFT JOIN leads l ON l.id=d.lead_id" if modules["leads"] else ""
                property_join = "LEFT JOIN properties p ON p.id=d.property_id" if modules["properties"] else ""
                lead_name = "l.name" if modules["leads"] else "NULL"
                property_title = "p.title" if modules["properties"] else "NULL"
                data["deals"] = rows(con, f"""SELECT d.*,{lead_name} AS lead_name,{property_title} AS property_title FROM deals d
                    {lead_join} {property_join} ORDER BY d.id DESC""")
            result = {"user": {k: user[k] for k in ("id", "username", "name", "role")},
                      "settings": settings if user["role"] == "admin" else {"login_notice": settings["login_notice"], "modules": settings["modules"], "widgets": settings["widgets"]},
                      "modules": modules, "features": FEATURES, "widgets": WIDGETS, "data": data}
        self.send_json(result)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        try:
            body = self.read_json()
        except ValueError as exc:
            self.error(400, str(exc))
            return
        if path == "/api/login":
            self.login(body)
            return
        if path == "/api/logout":
            token = self.get_session_token()
            with sessions_lock:
                if token:
                    sessions.pop(token, None)
            self.send_json({"ok": True}, headers={"Set-Cookie": "ziq_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"})
            return
        user = self.require_user()
        if not user:
            return
        if path == "/api/admin/settings":
            if self.is_admin(user):
                self.save_settings(body)
            return
        if path == "/api/admin/users":
            if self.is_admin(user):
                self.create_user(body)
            return
        if path == "/api/password":
            self.change_password(user, body)
            return
        kind = path.removeprefix("/api/")
        if kind in ("leads", "properties", "followups", "visits", "deals"):
            if self.feature_enabled(user, kind):
                self.create_record(kind, body)
            return
        self.error(404, "Endpoint not found.")

    def do_PUT(self) -> None:
        path = urlparse(self.path).path
        try:
            body = self.read_json()
        except ValueError as exc:
            self.error(400, str(exc))
            return
        user = self.require_user()
        if not user:
            return
        if path.startswith("/api/admin/users/"):
            if self.is_admin(user):
                self.update_user(path.rsplit("/", 1)[-1], body, user)
            return
        parts = path.strip("/").split("/")
        if len(parts) == 3 and parts[0] == "api" and parts[1] in ("leads", "properties", "followups", "visits", "deals"):
            if self.feature_enabled(user, parts[1]):
                self.update_record(parts[1], parts[2], body)
            return
        self.error(404, "Endpoint not found.")

    def do_DELETE(self) -> None:
        path = urlparse(self.path).path
        user = self.require_user()
        if not user:
            return
        parts = path.strip("/").split("/")
        if len(parts) == 3 and parts[0] == "api" and parts[1] in ("leads", "properties", "followups", "visits", "deals"):
            if not self.feature_enabled(user, parts[1]):
                return
            try:
                item_id = int(parts[2])
            except ValueError:
                self.error(400, "Invalid record id.")
                return
            table = parts[1]
            with db_connect() as con:
                cur = con.execute(f"DELETE FROM {table} WHERE id=?", (item_id,))
                if cur.rowcount == 0:
                    self.error(404, "Record not found.")
                    return
            self.send_json({"ok": True})
            return
        self.error(404, "Endpoint not found.")

    def get_session_token(self) -> str | None:
        cookie = self.headers.get("Cookie", "")
        return next((part.split("=", 1)[1] for part in cookie.split(";") if part.strip().startswith("ziq_session=")), None)

    def login(self, body: dict) -> None:
        username = str(body.get("username", "")).strip()
        password = str(body.get("password", ""))
        with db_connect() as con:
            row = con.execute("SELECT id,username,name,password_hash,role,active FROM users WHERE username=? COLLATE NOCASE", (username,)).fetchone()
        if not row or not row["active"] or not password_matches(password, row["password_hash"]):
            self.error(401, "That username and password did not match.")
            return
        token = secrets.token_urlsafe(32)
        with sessions_lock:
            sessions[token] = (row["id"], time.time() + SESSION_TTL)
        self.send_json({"user": {"id": row["id"], "username": row["username"], "name": row["name"], "role": row["role"]}},
                       headers={"Set-Cookie": f"ziq_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={SESSION_TTL}"})

    def save_settings(self, body: dict) -> None:
        modules_in = body.get("modules", {})
        widgets_in = body.get("widgets", {})
        modules = {key: bool(modules_in.get(key, DEFAULT_SETTINGS["modules"][key])) for key in FEATURES}
        widgets = {key: bool(widgets_in.get(key, DEFAULT_SETTINGS["widgets"][key])) for key in WIDGETS}
        # The user home page must remain reachable so a user can sign in successfully.
        modules["dashboard"] = True
        notice = str(body.get("login_notice", DEFAULT_SETTINGS["login_notice"])).strip()[:180]
        with db_connect() as con:
            for key, value in (("modules", modules), ("widgets", widgets), ("login_notice", notice)):
                con.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, json.dumps(value)))
        self.send_json({"ok": True})

    def create_user(self, body: dict) -> None:
        username = str(body.get("username", "")).strip()
        name = str(body.get("name", "")).strip()
        password = str(body.get("password", ""))
        role = body.get("role", "user")
        if not username or len(username) > 40 or not name or role not in ("admin", "user"):
            self.error(400, "Enter a name, username (up to 40 characters), and valid role.")
            return
        if len(password) < 10:
            self.error(400, "Use a password with at least 10 characters.")
            return
        try:
            with db_connect() as con:
                cur = con.execute("INSERT INTO users(username,name,password_hash,role) VALUES(?,?,?,?)", (username, name, password_hash(password), role))
                user_id = cur.lastrowid
        except sqlite3.IntegrityError:
            self.error(409, "That username is already in use.")
            return
        self.send_json({"id": user_id, "ok": True}, 201)

    def update_user(self, raw_id: str, body: dict, actor: dict) -> None:
        try:
            user_id = int(raw_id)
        except ValueError:
            self.error(400, "Invalid account id.")
            return
        with db_connect() as con:
            target = con.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
            if not target:
                self.error(404, "Account not found.")
                return
            if target["id"] == actor["id"] and (("active" in body and not bool(body["active"])) or body.get("role") not in (None, "admin")):
                self.error(400, "You cannot disable or change the role of your own account.")
                return
            name = str(body.get("name", target["name"])).strip()[:80]
            role = body.get("role", target["role"])
            active = int(bool(body.get("active", target["active"])))
            password = str(body.get("password", ""))
            if role not in ("admin", "user"):
                self.error(400, "Choose admin or user as the account role.")
                return
            if target["id"] == 1 and (role != "admin" or not active):
                self.error(400, "The original admin account must stay active as an admin.")
                return
            if password and len(password) < 10:
                self.error(400, "Use a password with at least 10 characters.")
                return
            con.execute("UPDATE users SET name=?,role=?,active=? WHERE id=?", (name or target["name"], role, active, user_id))
            if password:
                con.execute("UPDATE users SET password_hash=? WHERE id=?", (password_hash(password), user_id))
        self.send_json({"ok": True})

    def change_password(self, user: dict, body: dict) -> None:
        current = str(body.get("current_password", ""))
        new = str(body.get("new_password", ""))
        with db_connect() as con:
            row = con.execute("SELECT password_hash FROM users WHERE id=?", (user["id"],)).fetchone()
            if not row or not password_matches(current, row["password_hash"]):
                self.error(400, "Your current password was not correct.")
                return
            if len(new) < 10:
                self.error(400, "Use a new password with at least 10 characters.")
                return
            con.execute("UPDATE users SET password_hash=? WHERE id=?", (password_hash(new), user["id"]))
        self.send_json({"ok": True})

    def create_record(self, kind: str, body: dict) -> None:
        schema = {
            "leads": ("name,phone,email,source,budget,interest,stage,location,next_followup,notes", ("name", "phone", "email", "source", "budget", "interest", "stage", "location", "next_followup", "notes")),
            "properties": ("title,location,type,size,price,status,image,notes", ("title", "location", "type", "size", "price", "status", "image", "notes")),
            "followups": ("title,lead_id,due_date,channel,status,notes", ("title", "lead_id", "due_date", "channel", "status", "notes")),
            "visits": ("lead_id,property_id,visit_date,status,notes", ("lead_id", "property_id", "visit_date", "status", "notes")),
            "deals": ("lead_id,property_id,value,stage,close_date,notes", ("lead_id", "property_id", "value", "stage", "close_date", "notes")),
        }
        columns, keys = schema[kind]
        values = [body.get(key, "") for key in keys]
        if kind in ("leads", "properties", "followups") and not str(values[0]).strip():
            self.error(400, "A title or name is required.")
            return
        for i, key in enumerate(keys):
            if key in ("budget", "price", "lead_id", "property_id", "value"):
                try:
                    values[i] = int(values[i]) if str(values[i]).strip() else None if key.endswith("_id") else 0
                except (ValueError, TypeError):
                    self.error(400, f"{key.replace('_',' ').capitalize()} must be a number.")
                    return
        with db_connect() as con:
            q = ",".join("?" for _ in values)
            cur = con.execute(f"INSERT INTO {kind}({columns}) VALUES({q})", values)
            new_id = cur.lastrowid
        self.send_json({"id": new_id, "ok": True}, 201)

    def update_record(self, kind: str, raw_id: str, body: dict) -> None:
        try:
            item_id = int(raw_id)
        except ValueError:
            self.error(400, "Invalid record id.")
            return
        schema = {
            "leads": ("name,phone,email,source,budget,interest,stage,location,next_followup,notes", ("name", "phone", "email", "source", "budget", "interest", "stage", "location", "next_followup", "notes")),
            "properties": ("title,location,type,size,price,status,image,notes", ("title", "location", "type", "size", "price", "status", "image", "notes")),
            "followups": ("title,lead_id,due_date,channel,status,notes", ("title", "lead_id", "due_date", "channel", "status", "notes")),
            "visits": ("lead_id,property_id,visit_date,status,notes", ("lead_id", "property_id", "visit_date", "status", "notes")),
            "deals": ("lead_id,property_id,value,stage,close_date,notes", ("lead_id", "property_id", "value", "stage", "close_date", "notes")),
        }
        columns, keys = schema[kind]
        updates = []
        values = []
        for key in keys:
            if key not in body:
                continue
            value = body[key]
            if key in ("budget", "price", "lead_id", "property_id", "value"):
                try:
                    value = int(value) if str(value).strip() else (None if key.endswith("_id") else 0)
                except (ValueError, TypeError):
                    self.error(400, f"{key.replace('_',' ').capitalize()} must be a number.")
                    return
            updates.append(f"{key}=?")
            values.append(value)
        if not updates:
            self.error(400, "No editable fields were provided.")
            return
        values.append(item_id)
        with db_connect() as con:
            cur = con.execute(f"UPDATE {kind} SET {','.join(updates)} WHERE id=?", values)
            if cur.rowcount == 0:
                self.error(404, "Record not found.")
                return
        self.send_json({"ok": True})


def main() -> None:
    init_db()
    server = ThreadingHTTPServer((HOST, PORT), CRMHandler)
    print(f"ZameenIQ CRM is ready at http://{HOST}:{PORT}")
    print("Starter sign-in details are in README.md. Change the passwords after signing in.")
    threading.Timer(0.8, lambda: webbrowser.open(f"http://{HOST}:{PORT}")).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping ZameenIQ CRM...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
