import os
import uuid
import sqlite3
import io
import zipfile
from datetime import datetime
from flask import (
    Flask, render_template, request, jsonify, session, 
    send_from_directory, redirect, url_for, make_response, send_file
)
from PIL import Image, ImageOps

# Register HEIC/HEIF support in Pillow if available
try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except ImportError:
    pass

app = Flask(__name__)

# Config & Environment Variables
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'gabi-50th-birthday-secret-key-2026')
app.config['MAX_CONTENT_LENGTH'] = int(os.environ.get('MAX_CONTENT_LENGTH', 100 * 1024 * 1024))  # 100MB per request batch
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'Gabi50!')

# Data directories
DATA_DIR = os.environ.get('DATA_DIR', os.path.join(os.path.abspath(os.path.dirname(__file__)), 'data'))
UPLOADS_DIR = os.path.join(DATA_DIR, 'uploads')
THUMBNAILS_DIR = os.path.join(DATA_DIR, 'thumbnails')
DB_PATH = os.path.join(DATA_DIR, 'photos.db')

for folder in [DATA_DIR, UPLOADS_DIR, THUMBNAILS_DIR]:
    os.makedirs(folder, exist_ok=True)

# Database helper
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
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
                height INTEGER
            )
        ''')
        conn.commit()

init_db()

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'dng'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

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
        
    return jsonify({
        'total_photos': total_photos,
        'my_photos': my_photos
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
                
                width, height = 0, 0
                
                # 2. Create web thumbnail (JPEG) for gallery display
                try:
                    with Image.open(out_path) as img:
                        # Auto rotate based on EXIF tag (mobile camera orientation)
                        try:
                            img = ImageOps.exif_transpose(img)
                        except Exception:
                            pass
                        
                        width, height = img.size
                        
                        # Generate thumbnail (500x500 max)
                        thumb_img = img.copy()
                        if thumb_img.mode in ('RGBA', 'P', 'LA'):
                            thumb_img = thumb_img.convert('RGB')
                            
                        thumb_img.thumbnail((500, 500), Image.Resampling.LANCZOS)
                        thumb_img.save(thumb_path, 'JPEG', quality=82, optimize=True)
                except Exception as thumb_err:
                    # Fallback if thumbnail creation fails: copy or mark thumb
                    print(f"Thumbnail creation fallback for {original_filename}: {thumb_err}")
                    # If thumbnail generation fails, we still keep the original upload intact!
                    thumb_filename = out_filename

                # Insert metadata into SQLite
                with get_db() as conn:
                    conn.execute('''
                        INSERT INTO photos (id, filename, original_filename, thumbnail, session_id, file_size, width, height)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ''', (photo_id, out_filename, original_filename, thumb_filename, user_id, file_size, width, height))
                    conn.commit()
                    
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
            
        # Delete files
        out_path = os.path.join(UPLOADS_DIR, photo['filename'])
        thumb_path = os.path.join(THUMBNAILS_DIR, photo['thumbnail'])
        
        if os.path.exists(out_path):
            os.remove(out_path)
        if os.path.exists(thumb_path) and thumb_path != out_path:
            os.remove(thumb_path)
            
        conn.execute('DELETE FROM photos WHERE id = ?', (photo_id,))
        conn.commit()
        
    return jsonify({'success': True, 'id': photo_id})

@app.route('/uploads/<filename>')
def serve_upload(filename):
    if request.args.get('download', '0') == '1':
        with get_db() as conn:
            photo = conn.execute('SELECT original_filename FROM photos WHERE filename = ?', (filename,)).fetchone()
            download_name = photo['original_filename'] if photo else filename
        return send_from_directory(UPLOADS_DIR, filename, as_attachment=True, download_name=download_name)
    return send_from_directory(UPLOADS_DIR, filename)

@app.route('/thumbnails/<filename>')
def serve_thumbnail(filename):
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
                           COALESCE(SUM(file_size), 0) as total_size
                    FROM photos
                ''').fetchone()
                stats = dict(stats_row) if stats_row else {'total_photos': 0, 'total_guests': 0, 'total_size': 0}
            return render_template('admin.html', photos=photos, stats=stats)
        except Exception as e:
            app.logger.error(f"Fehler im Admin-Bereich: {e}")
            return render_template('admin_login.html', error=f"Datenbankfehler: {str(e)}")
        
    return render_template('admin_login.html', error=error)

@app.route('/admin/logout')
def admin_logout():
    session.pop('admin_authed', None)
    return redirect(url_for('admin'))

@app.route('/admin/download-zip')
def admin_download_zip():
    if not session.get('admin_authed', False):
        return redirect(url_for('admin'))
        
    memory_file = io.BytesIO()
    with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_DEFLATED) as zf:
        with get_db() as conn:
            photos = conn.execute('SELECT filename, original_filename FROM photos').fetchall()
            for idx, photo in enumerate(photos, 1):
                file_path = os.path.join(UPLOADS_DIR, photo['filename'])
                if os.path.exists(file_path):
                    # Preserve exact original filename and extension in ZIP archive
                    ext = os.path.splitext(photo['filename'])[1]
                    original_name = photo['original_filename']
                    if not original_name.lower().endswith(ext.lower()):
                        original_name = f"{original_name}{ext}"
                    zip_entry_name = f"Foto_{idx:03d}_{original_name}"
                    zf.write(file_path, arcname=zip_entry_name)
                    
    memory_file.seek(0)
    now_str = datetime.now().strftime('%Y%m%d_%H%M')
    return send_file(
        memory_file,
        mimetype='application/zip',
        as_attachment=True,
        download_name=f'Gabi_50_Geburtstag_Fotos_{now_str}.zip'
    )

if __name__ == '__main__':
    host = os.environ.get('HOST', '0.0.0.0')
    port = int(os.environ.get('PORT', 8080))
    debug = os.environ.get('DEBUG', 'True').lower() == 'true'
    app.run(host=host, port=port, debug=debug)
