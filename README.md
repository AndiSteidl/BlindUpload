# 📸 Blind Upload Webapp für "Gabis 50er Feier"

Eine elegante, leichtgewichtige und mobile-optimierte Webanwendung, um Party-Fotos und -Videos von Gabis 50. Geburtstag zu sammeln – **ohne Registrierung oder Login für die Gäste!**

---

## ✨ Features

- **🔒 Blind Upload ohne Registrierung:** Gäste öffnen einfach den Link oder scannen den QR-Code und können sofort Fotos und Videos hochladen.
- **💾 100% Lokale Server-Speicherung:** Alle Originaldateien und Thumbnails werden zuverlässig im persistenten Verzeichnis `./uploads_data` auf dem Linux-Server gespeichert – unabhängig von externen Cloud-Diensten.
- **🧩 Automatischer Chunked Upload (Cloudflare Free kompatibel):** Dateien > 20 MB (z. B. 4K-Videos vom Smartphone) werden im Browser automatisch in 20-MB-Blöcke gesplittet und hochgeladen. Dadurch umgeht die App das strikte 100-MB-Limit von Cloudflare Free spielend leicht und ohne HTTP-413-Fehler!
- **🎥 Große Videos & Media-Player:** Unterstützt Fotos (JPG, PNG, HEIC, DNG etc.) und Videos (MP4, MOV, WEBM etc.) bis zu 1 GB. Inklusive automatischer Video-Thumbnail-Generierung (ffmpeg mit modernem Python-Fallback) und integriertem Video-Player in der Lightbox.
- **🖼️ "Meine Fotos"-Funktion:** Über ein anonymes Session-Cookie erkennt die App das Smartphone des Gastes. Gäste sehen und verwalten (löschen) **nur ihre eigenen hochgeladenen Medien**, während die Uploads für alle anderen blind bleiben!
- **📱 Smartphone & Kamera-Optimierung:** Direkte Foto-/Video-Aufnahme per Kamera oder Mehrfachauswahl aus der Fotogalerie mit clientseitiger Queue (max. 5 parallele Uploads).
- **📊 Live-Zähler & Queue:** Zeigt auf der Startseite an, wie viele Medien bereits hochgeladen wurden und wie viele Uploads gerade aktiv verarbeitet werden.
- **👑 Admin-Bereich mit Suchfilter & ZIP-Download:** Passwortgeschützter Bereich (`/admin`) mit Live-Statistiken, Such- und Datumsfilter, Lightbox-Vorschau und Ein-Klick-Download aller Original-Dateien als ZIP-Archiv.
- **🐳 Docker & Linux Ready:** Integrierte `Dockerfile` und `docker-compose.yml` mit ffmpeg, 300s Timeout und persistentem Volume `./uploads_data:/app/data`.

---

## 🚀 Schnellstart (Docker Deployment auf Linux)

### 1. Repository klonen & vorbereiten
```bash
git clone <dein-repo-url>
cd BlindUpload
```

### 2. Umgebungs-Variablen anpassen (optional)
Kopiere die `.env.example`:
```bash
cp .env.example .env
nano .env
```

Beispielkonfiguration:
```env
SECRET_KEY=gabi-50th-birthday-secret-key-2026
ADMIN_PASSWORD=Gabi50!
MAX_CONTENT_LENGTH=1073741824
```

### 3. Container starten
```bash
docker compose up -d --build
```
Die Anwendung läuft nun unter `http://<deine-server-ip>:8050` (oder hinter deinem Nginx / Cloudflare Proxy).

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
- **Standard-Passwort:** `Gabi50!` (in `.env` konfigurierbar)
- **Funktionen:**
  - Übersicht über alle Medien (Fotos & Videos)
  - Suchfilter nach Dateinamen, Gast-ID oder Datum
  - Vollbild-Lightbox mit HTML5 Video-Player
  - Button **"Alle Fotos als ZIP herunterladen"** (geordnet nach `Foto_001_...` bzw. `Video_001_...`)

---

## 📁 Ordnerstruktur

```text
├── app.py                # Haupt-Flask Server (Upload, Chunks, Admin, ZIP)
├── requirements.txt      # Python Abhängigkeiten (Flask, Pillow, pillow-heif, gunicorn)
├── Dockerfile            # Container Definition (mit ffmpeg)
├── docker-compose.yml    # Docker Compose Setup mit Volume Persistence
├── templates/
│   ├── index.html        # Startseite für Gäste (Upload & Galerie)
│   ├── admin_login.html  # Login für Veranstalter
│   └── admin.html        # Admin Übersicht mit Suchfiltern & ZIP-Download
├── static/
│   ├── css/style.css     # Responsive Styling (Champagner Gold / Dark Theme)
│   ├── js/app.js         # Frontend Logic (Chunked Upload, Progress Bar, Lightbox)
│   └── js/admin.js       # Admin Dashboard Logic (Filter, Suche, Lightbox)
└── README.md
```
