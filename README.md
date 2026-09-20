# 📸 Blind Upload Webapp für "Gabis 50er Feier"

Eine elegante, leichtgewichtige und mobile-optimierte Webanwendung, um Party-Fotos von Gabis 50. Geburtstag zu sammeln – **ohne Registrierung oder Login für die Gäste!**

---

## ✨ Features

- **🔒 Blind Upload ohne Registrierung:** Gäste öffnen einfach den Link / QR-Code und können sofort Fotos und Videos hochladen.
- **☁️ pCloud Cloud-Speicher (0 MB lokale Festplattenbelegung):** Originalfotos und große Videos bis zu 1 GB werden direkt nach dem Upload asynchron in dein persönliches pCloud-Konto übertragen. Die lokale Festplatte des Servers bleibt frei von großen Mediendateien!
- **🔄 Automatische Asynchrone Migration:** Bereits vorhandene lokale Dateien werden beim Starten der App automatisch im Hintergrund zu pCloud migriert und lokal gelöscht.
- **🎥 Große Videos & Streaming:** Unterstützt Videos (MP4, MOV, WEBM etc.) bis zu 1 GB mit Range-Streaming (Scrubbing / Vor- und Zurückspulen in Safari & Chrome).
- **🖼️ "Meine Fotos"-Funktion:** Über ein anonymes Session-Cookie erkennt die App das Smartphone des Gastes. Gäste sehen und verwalten (löschen) **nur ihre eigenen hochgeladenen Fotos**, während die Uploads für alle anderen blind bleiben!
- **📱 Smartphone & Kamera-Optimierung:** Direkte Foto-Aufnahme per Kamera oder Mehrfachauswahl aus der Fotogalerie mit clientseitiger Queue (max. 5 parallele Uploads).
- **📊 Live-Zähler & Queue:** Zeigt auf der Startseite an, wie viele Medien hochgeladen wurden und wie viele Uploads gerade aktiv verarbeitet werden.
- **👑 Admin-Download (ZIP) & Cloud-Status:** Passwortgeschützter Bereich (`/admin`), der den pCloud-Verbindungsstatus anzeigt, manuelle Migration ermöglicht und alle Original-Dateien aus der Cloud als ZIP-Archiv bündelt.
- **🐳 Docker & Linux Ready:** Integrierte `Dockerfile` und `docker-compose.yml` mit ffmpeg, 300s Timeout und persistentem Volume.

---

## 🚀 Schnellstart (Docker Deployment auf Linux)

### 1. Repository klonen & vorbereiten
```bash
git clone <dein-repo-url>
cd BlindUpload
```

### 2. Umgebungs-Variablen konfigurieren (pCloud & Limits)
Erstelle eine `.env` Datei:
```bash
cp .env.example .env
nano .env
```

#### Bei aktivem 2FA/MFA im Hauptkonto (EMPFOHLEN: OAuth2 Access Token):
Da WebDAV keine 2FA-Abfragen unterstützt, nutzt die App die offizielle pCloud REST-API mit einem permanenten Access Token:
1. Öffne die pCloud Entwicklerseite: [https://docs.pcloud.com/my_apps/](https://docs.pcloud.com/my_apps/) (oder für EU: [https://e-my.pcloud.com/](https://e-my.pcloud.com/)).
2. Klicke auf **"Register an App"** (z. B. Name: `BlindUpload`, Redirect URI: `https://my.pcloud.com/`).
3. Notiere dir die angezeigte **Client ID**.
4. Rufe im Browser folgenden Link auf (ersetze `DEINE_CLIENT_ID`):
   - **EU-Konto:** `https://e-my.pcloud.com/oauth2/authorize?client_id=DEINE_CLIENT_ID&response_type=token`
   - **US-Konto:** `https://my.pcloud.com/oauth2/authorize?client_id=DEINE_CLIENT_ID&response_type=token`
5. Bestätige die Autorisierung (mit deinem 2FA-Code). Der Browser leitet dich weiter zu einer URL wie:
   `https://my.pcloud.com/#access_token=DEIN_TOKEN_HIER&locationid=2`
6. Kopiere den `access_token` in deine `.env`:
   ```env
   PCLOUD_ENABLED=true
   PCLOUD_ACCESS_TOKEN=DEIN_TOKEN_HIER
   PCLOUD_REGION=EU
   PCLOUD_FOLDER=/Projekte/Gabis50
   ```

#### Alternative (WebDAV ohne 2FA):
Falls du lieber klassisches WebDAV nutzen möchtest, erstelle ein zweites kostenloses pCloud-Konto ohne 2FA und gib den Ordner von deinem Hauptkonto für diese E-Mail frei:
```env
PCLOUD_ENABLED=true
PCLOUD_USERNAME=dein-zweitkonto@beispiel.de
PCLOUD_PASSWORD=dein-zweitkonto-passwort
PCLOUD_REGION=EU
PCLOUD_FOLDER=/Projekte/Gabis50
```

### 3. Container starten
```bash
docker compose up -d --build
```
Die Anwendung läuft nun unter `http://<deine-server-ip>:8050`.

- Sämtliche Original-Fotos und Videos landen sicher in deinem pCloud-Ordner `/Projekte/Gabis50/uploads/`.
- Bestehende Daten werden beim Start automatisch im Hintergrund hochgeladen und vom Server gelöscht.
- Der Server speichert nur noch kleine Thumbnails (~20 KB) in `./uploads_data/thumbnails`.

---

## 💻 Lokale Entwicklung & Testen (ohne Docker)

### 1. Virtuelle Umgebung erstellen
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Server starten
```bash
python app.py
```
Öffne `http://localhost:8080` im Browser.

---

## 🔐 Admin-Bereich & ZIP Download

- **URL:** `http://<server-ip>:8080/admin`
- **Standard-Passwort:** `Gabi50!` (in `.env` anpassbar)
- **Funktion:** Übersicht über alle Fotos, Gesamtspeicherplatz und Button **"Alle Fotos als ZIP herunterladen"**.

---

## 📁 Ordnerstruktur

```text
├── app.py                # Haupt-Flask Server & API Endpunkte
├── requirements.txt      # Python Abhängigkeiten (Flask, Pillow, Gunicorn)
├── Dockerfile            # Container Definition
├── docker-compose.yml    # Docker Compose Setup mit Volume Persistence
├── templates/
│   ├── index.html        # Startseite für Gäste (Upload & Galerie)
│   ├── admin_login.html  # Login für Veranstalter
│   └── admin.html        # Admin Übersicht & ZIP-Download
├── static/
│   ├── css/style.css     # Responsive Styling & Theme (Champagner Gold/Dark)
│   └── js/app.js         # Frontend Logic (AJAX Upload, Progress Bar, Lightbox)
└── README.md
```
# BlindUpload
