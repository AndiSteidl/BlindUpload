# 📸 Blind Upload Webapp für "Gabis 50er Feier"

Eine elegante, leichtgewichtige und mobile-optimierte Webanwendung, um Party-Fotos von Gabis 50. Geburtstag zu sammeln – **ohne Registrierung oder Login für die Gäste!**

---

## ✨ Features

- **🔒 Blind Upload ohne Registrierung:** Gäste öffnen einfach den Link / QR-Code und können sofort Fotos hochladen.
- **🖼️ "Meine Fotos"-Funktion:** Über ein anonymes Session-Cookie erkennt die App das Smartphone des Gastes. Gäste sehen und verwalten (löschen) **nur ihre eigenen hochgeladenen Fotos**, während die Uploads für alle anderen blind bleiben!
- **📱 Smartphone & Kamera-Optimierung:** Direkte Foto-Aufnahme per Kamera oder Mehrfachauswahl aus der Fotogalerie.
- **🔄 Automatische EXIF-Rotation & Komprimierung:** Hochaufgelöste Handyfotos werden automatisch gedreht, optimiert und als responsive Thumbnails gespeichert (spart Bandbreite & Speicherplatz).
- **📊 Live-Zähler:** Zeigt auf der Startseite an, wie viele Fotos schon gemeinsam gesammelt wurden.
- **👑 Admin-Download (ZIP):** Passwortgeschützter Bereich (`/admin`), in dem Gabi oder die Veranstalter alle gesammelten Original-Fotos mit 1-Klick als ZIP-Archiv herunterladen können.
- **🐳 Docker & Linux Ready:** Integrierte `Dockerfile` und `docker-compose.yml` mit persistentem Volume für Datenbank & Fotos.

---

## 🚀 Schnellstart (Docker Deployment auf Linux)

### 1. Repository klonen & vorbereiten
```bash
git clone <dein-repo-url>
cd BlindUpload
```

### 2. Umgebungs-Variablen konfigurieren (optional)
Erstelle eine `.env` Datei:
```bash
cp .env.example .env
nano .env
```
Inhalte der `.env`:
```env
PORT=8080
SECRET_KEY=dein-geheimer-schluessel-gabi50
ADMIN_PASSWORD=Gabi50!
```

### 3. Container starten
```bash
docker compose up -d --build
```
Die Anwendung läuft nun unter `http://<deine-server-ip>:8080`.

Das Verzeichnis `./uploads_data` auf dem Linux-Host speichert alle Fotos und die SQLite-Datenbank **dauerhaft & persistent**!

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
