import os
import uuid
import sqlite3
import io
import zipfile
import threading
import shutil
import subprocess
import requests
import mimetypes
import urllib.parse
from requests.auth import HTTPBasicAuth
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
from flask import (
    Flask, render_template, request, jsonify, session, 
    send_from_directory, redirect, url_for, make_response, send_file, Response
)
from PIL import Image, ImageOps, ImageDraw, ImageFont

# Register HEIC/HEIF support in Pillow if available
try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:
    pass

app = Flask(__name__)

# Config & Environment Variables
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'gabi-50th-birthday-secret-key-2026')
app.config['MAX_CONTENT_LENGTH'] = int(os.environ.get('MAX_CONTENT_LENGTH', 1024 * 1024 * 1024))  # 1GB per file
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'Gabi50!')

# pCloud Cloud-Speicher Konfiguration (OAuth2 API oder WebDAV)
PCLOUD_ENABLED = os.environ.get('PCLOUD_ENABLED', 'false').lower() in ('true', '1', 'yes')
PCLOUD_ACCESS_TOKEN = os.environ.get('PCLOUD_ACCESS_TOKEN', '').strip()
PCLOUD_USERNAME = os.environ.get('PCLOUD_USERNAME', '').strip()
PCLOUD_PASSWORD = os.environ.get('PCLOUD_PASSWORD', '').strip()
PCLOUD_REGION = os.environ.get('PCLOUD_REGION', 'EU').strip().upper()
PCLOUD_FOLDER = os.environ.get('PCLOUD_FOLDER', '/Gabis50').strip().rstrip('/')

# Thread pool for asynchronous background tasks (thumbnail generation, pCloud upload & migration)
# max_workers=3 allows concurrent thumbnails, pCloud uploads, and async migrations
executor = ThreadPoolExecutor(max_workers=3)

# Server-side upload concurrency limiter (max 5 simultaneous upload processes)
UPLOAD_SEMAPHORE = threading.Semaphore(5)
active_uploads_lock = threading.Lock()
active_uploads_count = 0

# Data directories
DATA_DIR = os.environ.get('DATA_DIR', os.path.join(os.path.abspath(os.path.dirname(__file__)), 'data'))
UPLOADS_DIR = os.path.join(DATA_DIR, 'uploads')
THUMBNAILS_DIR = os.path.join(DATA_DIR, 'thumbnails')
DB_PATH = os.path.join(DATA_DIR, 'photos.db')

for folder in [DATA_DIR, UPLOADS_DIR, THUMBNAILS_DIR]:
    os.makedirs(folder, exist_ok=True)

# Database helper with WAL mode and busy timeout
def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 30000;")
    return conn

def init_db():
    with get_db() as conn:
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA synchronous = NORMAL;")
        conn.execute('''
            CREATE TABLE IF NOT EXISTS photos (
                id TEXT PRIMARY KEY,
                filename TEXT NOT NULL,
                original_filename TEXT NOT NULL,
                thumbnail TEXT NOT NULL,
                session_id TEXT NOT NULL,
                uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                file_size INTEGER NOT NULL,
                width INTEGER,
                height INTEGER,
                storage_provider TEXT DEFAULT 'local'
            )
        ''')
        # Migrate existing table if storage_provider column is missing
        try:
            conn.execute("ALTER TABLE photos ADD COLUMN storage_provider TEXT DEFAULT 'local';")
        except Exception:
            pass
        conn.commit()

init_db()

# ----------------------------------------------------
# pCloud Cloud-Speicher Helpers (OAuth2 API & WebDAV)
# ----------------------------------------------------
def is_pcloud_configured():
    if not PCLOUD_ENABLED:
        return False
    return bool(PCLOUD_ACCESS_TOKEN) or (bool(PCLOUD_USERNAME) and bool(PCLOUD_PASSWORD))

def is_pcloud_token_mode():
    return bool(PCLOUD_ACCESS_TOKEN)

def pcloud_api_base_url():
    return 'https://eapi.pcloud.com' if PCLOUD_REGION == 'EU' else 'https://api.pcloud.com'

def pcloud_base_url():
    return 'https://ewebdav.pcloud.com' if PCLOUD_REGION == 'EU' else 'https://webdav.pcloud.com'

def pcloud_get_auth():
    return HTTPBasicAuth(PCLOUD_USERNAME, PCLOUD_PASSWORD)

def pcloud_remote_url(filename=''):
    base = pcloud_base_url()
    folder = PCLOUD_FOLDER
    if filename:
        safe_filename = urllib.parse.quote(filename)
        return f"{base}{folder}/uploads/{safe_filename}"
    return f"{base}{folder}/uploads"

def pcloud_ensure_dirs():
    """Ensure remote folders exist on pCloud via REST API or WebDAV MKCOL."""
    if not is_pcloud_configured():
        return False
    try:
        if is_pcloud_token_mode():
            api_base = pcloud_api_base_url()
            url = f"{api_base}/createfolderifnotexists"
            headers = {'Authorization': f'Bearer {PCLOUD_ACCESS_TOKEN}'}
            params = {'path': f"{PCLOUD_FOLDER}/uploads"}
            res = requests.get(url, headers=headers, params=params, timeout=15)
            data = res.json()
            return data.get('result') == 0
        else:
            auth = pcloud_get_auth()
            base = pcloud_base_url()
            parts = [p for p in f"{PCLOUD_FOLDER}/uploads".split('/') if p]
            curr = ""
            for part in parts:
                curr += f"/{part}"
                url = f"{base}{urllib.parse.quote(curr)}"
                requests.request('MKCOL', url, auth=auth, timeout=15)
            return True
    except Exception as err:
        app.logger.warning(f"pCloud ensure_dirs warning: {err}")
        return False

def pcloud_upload_file(local_path, filename):
    """Upload file from local filesystem directly to pCloud via REST API or WebDAV PUT."""
    if not is_pcloud_configured():
        return False
    try:
        pcloud_ensure_dirs()
        if is_pcloud_token_mode():
            api_base = pcloud_api_base_url()
            url = f"{api_base}/uploadfile"
            headers = {'Authorization': f'Bearer {PCLOUD_ACCESS_TOKEN}'}
            params = {
                'path': f"{PCLOUD_FOLDER}/uploads",
                'filename': filename,
                'nopartial': 1
            }
            with open(local_path, 'rb') as f:
                res = requests.post(url, headers=headers, params=params, files={'file': f}, timeout=(15, 600))
            if res.status_code == 200:
                data = res.json()
                if data.get('result') == 0:
                    return True
                app.logger.error(f"pCloud API upload failed for {filename}: {data}")
                return False
            app.logger.error(f"pCloud upload HTTP error {res.status_code}: {res.text}")
            return False
        else:
            url = pcloud_remote_url(filename)
            with open(local_path, 'rb') as f:
                res = requests.put(url, data=f, auth=pcloud_get_auth(), timeout=(15, 600))
            if res.status_code in (200, 201, 204):
                return True
            app.logger.error(f"pCloud PUT {filename} failed: {res.status_code} {res.text}")
            return False
    except Exception as err:
        app.logger.error(f"pCloud upload error for {filename}: {err}")
        return False

def pcloud_delete_file(filename):
    """Delete file from pCloud via REST API or WebDAV DELETE."""
    if not is_pcloud_configured():
        return False
    try:
        if is_pcloud_token_mode():
            api_base = pcloud_api_base_url()
            url = f"{api_base}/deletefile"
            headers = {'Authorization': f'Bearer {PCLOUD_ACCESS_TOKEN}'}
            params = {'path': f"{PCLOUD_FOLDER}/uploads/{filename}"}
            res = requests.get(url, headers=headers, params=params, timeout=30)
            data = res.json()
            return data.get('result') in (0, 2009)
        else:
            url = pcloud_remote_url(filename)
            res = requests.delete(url, auth=pcloud_get_auth(), timeout=30)
            return res.status_code in (200, 204, 404)
    except Exception as err:
        app.logger.error(f"pCloud delete error for {filename}: {err}")
        return False

def pcloud_get_download_stream_info(filename):
    """Returns (stream_url, auth) for downloading or streaming given file on pCloud."""
    if is_pcloud_token_mode():
        api_base = pcloud_api_base_url()
        url = f"{api_base}/getfilelink"
        headers = {'Authorization': f'Bearer {PCLOUD_ACCESS_TOKEN}'}
        params = {'path': f"{PCLOUD_FOLDER}/uploads/{filename}"}
        res = requests.get(url, headers=headers, params=params, timeout=15)
        data = res.json()
        if data.get('result') == 0 and data.get('hosts'):
            host = data['hosts'][0]
            path = data['path']
            return f"https://{host}{path}", None
        return None, None
    else:
        return pcloud_remote_url(filename), pcloud_get_auth()

def pcloud_stream_file(filename, download_name=None):
    """Stream file from pCloud directly to HTTP client with Range-header support for video playback."""
    if not is_pcloud_configured():
        return None
    try:
        stream_url, auth = pcloud_get_download_stream_info(filename)
        if not stream_url:
            return None

        headers = {}
        if 'Range' in request.headers:
            headers['Range'] = request.headers['Range']

        res = requests.get(
            stream_url,
            auth=auth if isinstance(auth, HTTPBasicAuth) else None,
            headers=headers,
            stream=True,
            timeout=(15, 120)
        )
        if res.status_code not in (200, 206):
            return None

        content_type = res.headers.get('Content-Type')
        guessed_type, _ = mimetypes.guess_type(filename)
        if not content_type or content_type in ('application/octet-stream', 'application/x-download'):
            if guessed_type:
                content_type = guessed_type

        resp_headers = {
            'Content-Type': content_type or 'application/octet-stream',
            'Accept-Ranges': 'bytes'
        }
        if download_name:
            safe_download_name = urllib.parse.quote(download_name)
            resp_headers['Content-Disposition'] = f'attachment; filename="{download_name}"; filename*=UTF-8\'\'{safe_download_name}'
        if 'Content-Range' in res.headers:
            resp_headers['Content-Range'] = res.headers['Content-Range']
        if 'Content-Length' in res.headers:
            resp_headers['Content-Length'] = res.headers['Content-Length']

        return Response(
            res.iter_content(chunk_size=128 * 1024),
            status=res.status_code,
            headers=resp_headers
        )
    except Exception as err:
        app.logger.error(f"pCloud stream error for {filename}: {err}")
        return None

IMAGE_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'dng'}
VIDEO_EXTENSIONS = {'mp4', 'mov', 'webm', 'm4v', 'avi', 'mkv'}
ALLOWED_EXTENSIONS = IMAGE_EXTENSIONS | VIDEO_EXTENSIONS

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def is_video_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in VIDEO_EXTENSIONS

def generate_video_thumbnail(original_path, thumb_path):
    """Generate thumbnail for video: ffmpeg frame extraction with elegant Pillow poster fallback."""
    # 1. Try ffmpeg frame extraction if installed
    ffmpeg_bin = shutil.which('ffmpeg')
    if ffmpeg_bin:
        try:
            cmd = [
                ffmpeg_bin, '-y', '-ss', '00:00:00.5',
                '-i', original_path,
                '-vframes', '1',
                '-vf', 'scale=500:500:force_original_aspect_ratio=decrease,pad=500:500:(ow-iw)/2:(oh-ih)/2:black',
                thumb_path
            ]
            subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)
            if os.path.exists(thumb_path) and os.path.getsize(thumb_path) > 0:
                return
        except Exception as e:
            app.logger.warning(f"ffmpeg extraction failed for {original_path}: {e}")

    # 2. Pure Python fallback: Stylish retro video card
    try:
        img = Image.new('RGB', (500, 500), color=(20, 24, 36))
        draw = ImageDraw.Draw(img)

        # Subtle gold decorative accents top & bottom
        for x in range(0, 500, 25):
            if (x // 25) % 2 == 0:
                draw.rectangle([x, 0, x + 25, 10], fill=(234, 179, 8))
                draw.rectangle([x, 490, x + 25, 500], fill=(234, 179, 8))

        # Golden play button circle
        circle_box = [190, 180, 310, 300]
        draw.ellipse(circle_box, fill=(245, 158, 11), outline=(254, 240, 138), width=3)

        # White play triangle
        play_triangle = [(235, 215), (235, 265), (275, 240)]
        draw.polygon(play_triangle, fill=(255, 255, 255))

        # Video format badge at bottom
        ext = original_path.rsplit('.', 1)[1].upper() if '.' in original_path else 'VIDEO'
        draw.rectangle([170, 340, 330, 375], fill=(30, 41, 59), outline=(71, 85, 105), width=1)
        try:
            font = ImageFont.load_default()
            draw.text((250, 357), f"VIDEO ({ext})", fill=(254, 240, 138), anchor="mm", font=font)
        except Exception:
            draw.text((215, 350), f"VIDEO ({ext})", fill=(254, 240, 138))

        img.save(thumb_path, 'JPEG', quality=85, optimize=True)
    except Exception as err:
        app.logger.error(f"Fallback video thumbnail generation failed: {err}")

def generate_thumbnail_task(original_path, thumb_path, photo_id=None):
    """Background task to generate optimized JPEG thumbnail without blocking HTTP request workers."""
    try:
        if is_video_file(original_path):
            generate_video_thumbnail(original_path, thumb_path)
            return

        with Image.open(original_path) as img:
            try:
                img = ImageOps.exif_transpose(img)
            except Exception:
                pass
            
            width, height = img.size
            thumb_img = img.copy()
            if thumb_img.mode in ('RGBA', 'P', 'LA'):
                thumb_img = thumb_img.convert('RGB')
                
            thumb_img.thumbnail((500, 500), Image.Resampling.LANCZOS)
            thumb_img.save(thumb_path, 'JPEG', quality=82, optimize=True)

        if photo_id:
            with get_db() as conn:
                conn.execute('UPDATE photos SET width = ?, height = ? WHERE id = ?', (width, height, photo_id))
                conn.commit()
    except Exception as err:
        app.logger.error(f"Thumbnail generation error for {original_path}: {err}")

def process_upload_task(original_path, thumb_path, photo_id, out_filename):
    """
    Background worker:
    1. Generate optimized JPEG thumbnail (local, ~20KB).
    2. If pCloud configured, upload original to pCloud and remove local copy to keep HDD usage at 0 MB.
    """
    try:
        # Step 1: Generate thumbnail while local file is guaranteed present
        generate_thumbnail_task(original_path, thumb_path, photo_id)

        # Step 2: Offload original to pCloud if enabled
        if is_pcloud_configured() and os.path.exists(original_path):
            success = pcloud_upload_file(original_path, out_filename)
            if success:
                with get_db() as conn:
                    conn.execute("UPDATE photos SET storage_provider = 'pcloud' WHERE id = ?", (photo_id,))
                    conn.commit()
                try:
                    os.remove(original_path)
                    app.logger.info(f"Uploaded {out_filename} to pCloud and removed local copy.")
                except Exception as e:
                    app.logger.warning(f"Could not delete local original {original_path}: {e}")
            else:
                app.logger.error(f"Failed to upload {out_filename} to pCloud; kept local file as fallback.")
    except Exception as err:
        app.logger.error(f"Error in process_upload_task for {out_filename}: {err}")

# Background Migration Tracking
migration_status = {
    'running': False,
    'total': 0,
    'completed': 0,
    'errors': 0,
    'last_run': None
}

def migrate_existing_files_to_pcloud():
    """Background worker to migrate all existing local files to pCloud storage asynchronously."""
    global migration_status
    if not is_pcloud_configured():
        app.logger.info("pCloud is not configured. Migration skipped.")
        return

    if migration_status['running']:
        app.logger.info("Migration is already in progress.")
        return

    migration_status['running'] = True
    migration_status['errors'] = 0
    migration_status['completed'] = 0
    
    try:
        app.logger.info("Starting background migration of existing data to pCloud...")
        pcloud_ensure_dirs()

        # Step 1: Query database for all files not yet on pCloud
        with get_db() as conn:
            rows = conn.execute(
                "SELECT id, filename, original_filename FROM photos WHERE storage_provider != 'pcloud' OR storage_provider IS NULL"
            ).fetchall()
        
        # Step 2: Also inspect local filesystem in UPLOADS_DIR for any files
        local_files = [f for f in os.listdir(UPLOADS_DIR) if not f.startswith('.')] if os.path.exists(UPLOADS_DIR) else []
        
        items_map = {}
        for r in rows:
            items_map[r['filename']] = r['id']
            
        for f in local_files:
            if f not in items_map:
                items_map[f] = None

        migration_status['total'] = len(items_map)

        for filename, photo_id in items_map.items():
            local_path = os.path.join(UPLOADS_DIR, filename)
            if not os.path.exists(local_path):
                continue
                
            success = pcloud_upload_file(local_path, filename)
            if success:
                if photo_id:
                    with get_db() as conn:
                        conn.execute("UPDATE photos SET storage_provider = 'pcloud' WHERE id = ?", (photo_id,))
                        conn.commit()
                # Delete local file to free up disk space
                try:
                    os.remove(local_path)
                    app.logger.info(f"Successfully migrated and removed local file: {filename}")
                except Exception as e:
                    app.logger.warning(f"Could not remove local file {local_path}: {e}")
                migration_status['completed'] += 1
            else:
                migration_status['errors'] += 1
                app.logger.error(f"Failed to migrate {filename} to pCloud.")
                
        migration_status['last_run'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        app.logger.info(f"pCloud migration complete: {migration_status['completed']}/{migration_status['total']} files migrated.")
    except Exception as err:
        app.logger.error(f"Fatal error in pCloud migration: {err}")
    finally:
        migration_status['running'] = False

def start_startup_migration():
    if is_pcloud_configured():
        executor.submit(migrate_existing_files_to_pcloud)

# Asynchronous migration trigger after short startup delay
startup_timer = threading.Timer(2.0, start_startup_migration)
startup_timer.daemon = True
startup_timer.start()

def ensure_session():
    if 'user_id' not in session:
        session['user_id'] = str(uuid.uuid4())
        session.permanent = True
    return session['user_id']

@app.before_request
def make_session_permanent():
    session.permanent = True
    ensure_session()

# Routes
@app.route('/')
def index():
    user_id = ensure_session()
    return render_template('index.html', user_id=user_id)

@app.route('/api/stats', methods=['GET'])
def get_stats():
    with get_db() as conn:
        row = conn.execute('SELECT COUNT(*) as count FROM photos').fetchone()
        total_photos = row['count'] if row else 0
        
        user_id = ensure_session()
        my_row = conn.execute('SELECT COUNT(*) as count FROM photos WHERE session_id = ?', (user_id,)).fetchone()
        my_photos = my_row['count'] if my_row else 0

    with active_uploads_lock:
        current_active = active_uploads_count
        
    return jsonify({
        'total_photos': total_photos,
        'my_photos': my_photos,
        'active_uploads': current_active
    })

@app.route('/api/upload', methods=['POST'])
def upload_file():
    user_id = ensure_session()
    
    if 'photos' not in request.files and 'photo' not in request.files:
        return jsonify({'error': 'Keine Bilddatei übermittelt.'}), 400
        
    files = request.files.getlist('photos') or request.files.getlist('photo')
    
    if not files or len(files) == 0 or files[0].filename == '':
        return jsonify({'error': 'Keine Datei ausgewählt.'}), 400
        
    uploaded_items = []
    errors = []

    global active_uploads_count
    with active_uploads_lock:
        active_uploads_count += 1

    try:
        with UPLOAD_SEMAPHORE:
            for file in files:
                if file and allowed_file(file.filename):
                    try:
                        original_filename = file.filename
                        ext = original_filename.rsplit('.', 1)[1].lower()
                        photo_id = str(uuid.uuid4())
                        
                        # PRESERVE EXACT ORIGINAL EXTENSION & BYTES (HEIC, JPG, PNG, etc.)
                        out_filename = f"{photo_id}.{ext}"
                        thumb_filename = f"thumb_{photo_id}.jpg"
                        
                        out_path = os.path.join(UPLOADS_DIR, out_filename)
                        thumb_path = os.path.join(THUMBNAILS_DIR, thumb_filename)
                        
                        # 1. Save original file 100% UNTOUCHED
                        file.save(out_path)
                        file_size = os.path.getsize(out_path)
                        
                        # 2. Insert metadata into SQLite immediately
                        with get_db() as conn:
                            conn.execute('''
                                INSERT INTO photos (id, filename, original_filename, thumbnail, session_id, file_size, width, height, storage_provider)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'local')
                            ''', (photo_id, out_filename, original_filename, thumb_filename, user_id, file_size, 0, 0))
                            conn.commit()

                        # 3. Offload thumbnail creation + pCloud upload & cleanup to background executor
                        executor.submit(process_upload_task, out_path, thumb_path, photo_id, out_filename)
                            
                        uploaded_items.append({
                            'id': photo_id,
                            'filename': out_filename,
                            'original_filename': original_filename,
                            'thumbnail': thumb_filename,
                            'uploaded_at': datetime.now().strftime('%H:%M:%S'),
                            'file_size': file_size
                        })
                    except Exception as e:
                        errors.append(f"{file.filename}: {str(e)}")
                else:
                    errors.append(f"{file.filename}: Ungültiges Dateiformat.")
    finally:
        with active_uploads_lock:
            active_uploads_count = max(0, active_uploads_count - 1)

    if not uploaded_items and errors:
        return jsonify({'error': 'Upload fehlgeschlagen.', 'details': errors}), 400

    return jsonify({
        'success': True,
        'uploaded': uploaded_items,
        'errors': errors
    })

@app.route('/api/my-uploads', methods=['GET'])
def my_uploads():
    user_id = ensure_session()
    with get_db() as conn:
        rows = conn.execute(
            'SELECT id, filename, original_filename, thumbnail, uploaded_at, file_size, width, height '
            'FROM photos WHERE session_id = ? ORDER BY uploaded_at DESC', (user_id,)
        ).fetchall()
        
    photos = [dict(row) for row in rows]
    return jsonify({'photos': photos})

@app.route('/api/delete/<photo_id>', methods=['POST'])
def delete_photo(photo_id):
    user_id = ensure_session()
    with get_db() as conn:
        photo = conn.execute('SELECT * FROM photos WHERE id = ?', (photo_id,)).fetchone()
        
        if not photo:
            return jsonify({'error': 'Foto nicht gefunden.'}), 404
            
        if photo['session_id'] != user_id:
            return jsonify({'error': 'Keine Berechtigung zum Löschen dieses Fotos.'}), 403
            
        # Delete local files if present
        out_path = os.path.join(UPLOADS_DIR, photo['filename'])
        thumb_path = os.path.join(THUMBNAILS_DIR, photo['thumbnail'])
        
        if os.path.exists(out_path):
            try:
                os.remove(out_path)
            except Exception:
                pass
        if os.path.exists(thumb_path) and thumb_path != out_path:
            try:
                os.remove(thumb_path)
            except Exception:
                pass
            
        # Also remove from pCloud if stored remotely
        if photo['storage_provider'] == 'pcloud' or is_pcloud_configured():
            pcloud_delete_file(photo['filename'])

        conn.execute('DELETE FROM photos WHERE id = ?', (photo_id,))
        conn.commit()
        
    return jsonify({'success': True, 'id': photo_id})

@app.route('/uploads/<filename>')
def serve_upload(filename):
    local_path = os.path.join(UPLOADS_DIR, filename)
    is_download = request.args.get('download', '0') == '1'

    download_name = None
    storage_provider = 'local'
    with get_db() as conn:
        photo = conn.execute('SELECT original_filename, storage_provider FROM photos WHERE filename = ?', (filename,)).fetchone()
        if photo:
            download_name = photo['original_filename']
            storage_provider = photo['storage_provider'] or 'local'

    # 1. If file is available locally on disk, serve it directly
    if os.path.exists(local_path):
        if is_download:
            return send_from_directory(UPLOADS_DIR, filename, as_attachment=True, download_name=download_name or filename)
        return send_from_directory(UPLOADS_DIR, filename)

    # 2. If file has been moved to pCloud, stream it directly with Range support
    if storage_provider == 'pcloud' or is_pcloud_configured():
        stream_resp = pcloud_stream_file(filename, download_name=download_name if is_download else None)
        if stream_resp is not None:
            return stream_resp

    return "Datei nicht gefunden", 404

@app.route('/thumbnails/<filename>')
def serve_thumbnail(filename):
    thumb_path = os.path.join(THUMBNAILS_DIR, filename)
    if os.path.exists(thumb_path):
        return send_from_directory(THUMBNAILS_DIR, filename)
        
    # If thumbnail is still being generated or missing, fallback
    with get_db() as conn:
        photo = conn.execute('SELECT filename, storage_provider FROM photos WHERE thumbnail = ?', (filename,)).fetchone()
        if photo:
            orig_path = os.path.join(UPLOADS_DIR, photo['filename'])
            if os.path.exists(orig_path):
                try:
                    generate_thumbnail_task(orig_path, thumb_path, None)
                    if os.path.exists(thumb_path):
                        return send_from_directory(THUMBNAILS_DIR, filename)
                except Exception:
                    pass
                return send_from_directory(UPLOADS_DIR, photo['filename'])
            elif photo['storage_provider'] == 'pcloud' or is_pcloud_configured():
                return redirect(url_for('serve_upload', filename=photo['filename']))

    return send_from_directory(THUMBNAILS_DIR, filename)

# Admin Interface & Zip Download
@app.route('/admin', methods=['GET', 'POST'])
def admin():
    authenticated = session.get('admin_authed', False)
    error = None
    
    # Allow login via query parameter e.g. /admin?password=Gabi50! or via POST form
    pwd_param = request.args.get('password') or request.form.get('password')
    if pwd_param:
        if pwd_param == ADMIN_PASSWORD:
            session['admin_authed'] = True
            authenticated = True
        else:
            error = 'Falsches Passwort. Bitte erneut versuchen.'
            
    if authenticated:
        try:
            with get_db() as conn:
                photos_rows = conn.execute('SELECT * FROM photos ORDER BY uploaded_at DESC').fetchall()
                photos = [dict(p) for p in photos_rows]
                
                stats_row = conn.execute('''
                    SELECT COUNT(*) as total_photos, 
                           COUNT(DISTINCT session_id) as total_guests,
                           COALESCE(SUM(file_size), 0) as total_size,
                           SUM(CASE WHEN storage_provider = 'pcloud' THEN 1 ELSE 0 END) as pcloud_photos,
                           SUM(CASE WHEN storage_provider != 'pcloud' OR storage_provider IS NULL THEN 1 ELSE 0 END) as local_photos
                    FROM photos
                ''').fetchone()
                stats = dict(stats_row) if stats_row else {
                    'total_photos': 0, 'total_guests': 0, 'total_size': 0,
                    'pcloud_photos': 0, 'local_photos': 0
                }
                stats['pcloud_enabled'] = is_pcloud_configured()
                stats['pcloud_folder'] = PCLOUD_FOLDER
            return render_template('admin.html', photos=photos, stats=stats)
        except Exception as e:
            app.logger.error(f"Fehler im Admin-Bereich: {e}")
            return render_template('admin_login.html', error=f"Datenbankfehler: {str(e)}")
        
    return render_template('admin_login.html', error=error)

@app.route('/admin/logout')
def admin_logout():
    session.pop('admin_authed', None)
    return redirect(url_for('admin'))

@app.route('/admin/api/migration-status')
def admin_migration_status():
    if not session.get('admin_authed', False):
        return jsonify({'error': 'Unauthorized'}), 401
    return jsonify(migration_status)

@app.route('/admin/api/trigger-migration', methods=['POST'])
def admin_trigger_migration():
    if not session.get('admin_authed', False):
        return jsonify({'error': 'Unauthorized'}), 401
    if not is_pcloud_configured():
        return jsonify({'error': 'pCloud ist nicht konfiguriert (bitte in der .env PCLOUD_ENABLED=true und Zugangsdaten setzen).'}), 400
    if migration_status['running']:
        return jsonify({'message': 'Migration läuft bereits im Hintergrund.'}), 200
    
    executor.submit(migrate_existing_files_to_pcloud)
    return jsonify({'success': True, 'message': 'Hintergrund-Migration nach pCloud wurde gestartet.'})

@app.route('/admin/download-zip')
def admin_download_zip():
    if not session.get('admin_authed', False):
        return redirect(url_for('admin'))
        
    memory_file = io.BytesIO()
    with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_DEFLATED) as zf:
        with get_db() as conn:
            photos = conn.execute('SELECT filename, original_filename, storage_provider FROM photos').fetchall()
            for idx, photo in enumerate(photos, 1):
                ext = os.path.splitext(photo['filename'])[1]
                original_name = photo['original_filename']
                if not original_name.lower().endswith(ext.lower()):
                    original_name = f"{original_name}{ext}"
                is_vid = is_video_file(photo['filename'])
                prefix = "Video" if is_vid else "Foto"
                zip_entry_name = f"{prefix}_{idx:03d}_{original_name}"

                file_path = os.path.join(UPLOADS_DIR, photo['filename'])
                if os.path.exists(file_path):
                    # Local file
                    zf.write(file_path, arcname=zip_entry_name)
                elif photo['storage_provider'] == 'pcloud' or is_pcloud_configured():
                    # Stream from pCloud directly into ZIP entry without touching local disk
                    try:
                        stream_url, auth = pcloud_get_download_stream_info(photo['filename'])
                        if stream_url:
                            with requests.get(stream_url, auth=auth if isinstance(auth, HTTPBasicAuth) else None, stream=True, timeout=(15, 180)) as r:
                                if r.status_code == 200:
                                    with zf.open(zip_entry_name, 'w') as zf_entry:
                                        shutil.copyfileobj(r.raw, zf_entry)
                    except Exception as err:
                        app.logger.error(f"Error streaming pCloud file {photo['filename']} into zip: {err}")
                    
    memory_file.seek(0)
    now_str = datetime.now().strftime('%Y%m%d_%H%M')
    return send_file(
        memory_file,
        mimetype='application/zip',
        as_attachment=True,
        download_name=f'Gabi_50_Geburtstag_Medien_{now_str}.zip'
    )

if __name__ == '__main__':
    host = os.environ.get('HOST', '0.0.0.0')
    port = int(os.environ.get('PORT', 8080))
    debug = os.environ.get('DEBUG', 'True').lower() == 'true'
    app.run(host=host, port=port, debug=debug)
