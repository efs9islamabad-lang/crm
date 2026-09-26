# ZameenIQ Real Estate CRM

A personal, local-first CRM based on the ZameenIQ screens in the supplied ZIP. It runs on this computer, stores records in SQLite, and does not need an account with a hosted service or any third-party packages.

## Start the CRM

1. Install Python 3.10 or later if it is not already installed.
2. Double-click **Start CRM.bat**. A browser window opens at `http://127.0.0.1:8765`.
3. Keep the command window open while using the CRM. Close it to stop the local server.

If port 8765 is already in use, open PowerShell in this folder and run `$env:ZAMEENIQ_PORT='8766'; py -3 app.py`, then open `http://127.0.0.1:8766`.

## Starter accounts

| Access | Username | Starter password |
| --- | --- | --- |
| Admin | `admin` | `Admin123!` |
| User | `user` | `User123!` |

Change the starter passwords from the account menu after signing in. Admins can also add, edit, disable, or reset accounts in **Admin settings**. The two available access levels are **Admin** and **User**.

## What the admin controls

In **Admin settings**, an admin can:

- Choose which CRM sections user accounts can access.
- Choose which panels user accounts see on their dashboard.
- Set the short welcome note shown on the sign-in screen.
- Add or manage admin and user accounts.

Admin accounts keep full access. User access settings are checked by the local server as well as by the interface. The dashboard remains available to users so they always have a place to land after signing in.

## Included sections

- Dashboard overview and deal pipeline
- Lead and inquiry records
- Property inventory with local listing images
- Follow-up agenda
- Site visit schedule
- Deal and booking pipeline
- Reports and CSV export
- Account and user-access settings

The initial records are sample data. Edit or remove them and add your own.

## Data and privacy

The database is created at `data/zameeniq.sqlite3` the first time the app starts. Passwords are stored as salted PBKDF2 hashes. The server binds to `127.0.0.1`, so it accepts connections from this computer only. Sign-in sessions end after 12 hours or when the server stops.

To back up the CRM, stop the server and copy `data/zameeniq.sqlite3` to a safe location. Keep that database private; it contains your CRM records.

## Project files

- `app.py` — local HTTP server, login, account roles, and SQLite data API
- `static/index.html` — login and CRM shell
- `static/styles.css` — responsive dark navy and emerald interface
- `static/app.js` — dashboard, record management, and admin controls
- `static/assets/` — local property photography from the supplied ZIP
