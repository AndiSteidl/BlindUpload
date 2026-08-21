document.addEventListener('DOMContentLoaded', () => {
    // UI Element References
    const dropzone = document.getElementById('dropzone');
    const cameraInput = document.getElementById('camera-input');
    const progressContainer = document.getElementById('progress-container');
    const progressBarFill = document.getElementById('progress-bar-fill');
    const progressPercent = document.getElementById('progress-percent');
    const progressStatusText = document.getElementById('progress-status-text');
    const btnCancelUpload = document.getElementById('btn-cancel-upload');
    const myUploadCountText = document.getElementById('my-upload-count-text');
    const totalPhotosCount = document.getElementById('total-photos-count');
    const myPhotosBadge = document.getElementById('my-photos-badge');
    const myPhotosGrid = document.getElementById('my-photos-grid');
    const toggleMyPhotosBtn = document.getElementById('toggle-my-photos-btn');
    const myPhotosContainer = document.getElementById('my-photos-container');
    const toastContainer = document.getElementById('toast-container');

    // Lightbox Elements
    const lightboxModal = document.getElementById('lightbox-modal');
    const lightboxImg = document.getElementById('lightbox-img');
    const modalCloseBtn = document.getElementById('modal-close-btn');

    // State Variables
    let isUploading = false;
    let currentXhr = null;

    // Initialize App
    fetchStats();
    loadMyPhotos();

    // ----------------------------------------------------
    // Toggle Discreet "Meine Fotos" Section
    // ----------------------------------------------------
    if (toggleMyPhotosBtn && myPhotosContainer) {
        toggleMyPhotosBtn.addEventListener('click', () => {
            const isHidden = myPhotosContainer.classList.contains('hidden');
            const count = myPhotosBadge ? myPhotosBadge.textContent : '0';
            if (isHidden) {
                myPhotosContainer.classList.remove('hidden');
                toggleMyPhotosBtn.innerHTML = `🙈 Meine eigenen Fotos ausblenden (${count})`;
                myPhotosContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            } else {
                myPhotosContainer.classList.add('hidden');
                toggleMyPhotosBtn.innerHTML = `👁️ Meine eigenen Fotos anzeigen (${count})`;
            }
        });
    }

    // ----------------------------------------------------
    // Cancel Upload Handler
    // ----------------------------------------------------
    if (btnCancelUpload) {
        btnCancelUpload.addEventListener('click', () => {
            if (currentXhr) {
                currentXhr.abort();
                currentXhr = null;
                isUploading = false;
                progressContainer.classList.add('hidden');
                cameraInput.value = '';
                showToast('❌ Upload wurde abgebrochen.', 'info', 3000);
            }
        });
    }

    // ----------------------------------------------------
    // Dropzone & File Selection Handlers
    // ----------------------------------------------------
    if (dropzone && cameraInput) {
        // Drag events
        ['dragenter', 'dragover'].forEach(eventName => {
            dropzone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropzone.classList.add('drag-over');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropzone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropzone.classList.remove('drag-over');
            }, false);
        });

        dropzone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files && files.length > 0) {
                handleFilesUpload(files);
            }
        });

        cameraInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                handleFilesUpload(e.target.files);
            }
        });
    }

    // ----------------------------------------------------
    // AJAX Upload with Realtime Progress & Cancel (Abort) Support
    // ----------------------------------------------------
    function handleFilesUpload(fileList) {
        if (isUploading) return;

        const files = Array.from(fileList);
        if (files.length === 0) return;

        // Prepare FormData
        const formData = new FormData();
        files.forEach(file => {
            formData.append('photos', file);
        });

        // Show progress UI
        isUploading = true;
        progressContainer.classList.remove('hidden');
        progressBarFill.style.width = '0%';
        progressPercent.textContent = '0%';
        progressStatusText.textContent = `Lade ${files.length} Foto(s) hoch...`;

        currentXhr = new XMLHttpRequest();
        currentXhr.open('POST', '/api/upload', true);

        // Upload progress event
        currentXhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const percent = Math.round((e.loaded / e.total) * 100);
                progressBarFill.style.width = `${percent}%`;
                progressPercent.textContent = `${percent}%`;
                if (percent === 100) {
                    progressStatusText.textContent = 'Verarbeite & sichere Bilder...';
                }
            }
        };

        currentXhr.onload = function () {
            isUploading = false;
            progressContainer.classList.add('hidden');
            cameraInput.value = ''; // Reset input
            const xhrRef = currentXhr;
            currentXhr = null;

            if (xhrRef && xhrRef.status === 200) {
                try {
                    const res = JSON.parse(xhrRef.responseText);
                    if (res.success) {
                        const count = res.uploaded.length;
                        showToast(`🎉 Super! ${count} Foto(s) erfolgreich hochgeladen!`, 'success', 4500);
                        fetchStats();
                        loadMyPhotos();
                    }
                } catch (err) {
                    showToast('Fehler beim Verarbeiten der Server-Antwort.', 'error');
                }
            } else if (xhrRef && xhrRef.status !== 0) {
                try {
                    const res = JSON.parse(xhrRef.responseText);
                    showToast(res.error || 'Upload fehlgeschlagen.', 'error');
                } catch (e) {
                    showToast('Serverfehler beim Upload.', 'error');
                }
            }
        };

        currentXhr.onabort = function () {
            isUploading = false;
            progressContainer.classList.add('hidden');
            cameraInput.value = '';
            currentXhr = null;
        };

        currentXhr.onerror = function () {
            if (!currentXhr) return;
            isUploading = false;
            progressContainer.classList.add('hidden');
            cameraInput.value = '';
            currentXhr = null;
            showToast('Netzwerkfehler beim Upload.', 'error');
        };

        currentXhr.send(formData);
    }

    // ----------------------------------------------------
    // Load Stats & User Photos
    // ----------------------------------------------------
    function fetchStats() {
        fetch('/api/stats')
            .then(res => res.json())
            .then(data => {
                if (totalPhotosCount) {
                    totalPhotosCount.textContent = `Bisher ${data.total_photos} Foto(s) auf der Feier gesammelt`;
                }
                if (myPhotosBadge) {
                    myPhotosBadge.textContent = data.my_photos || '0';
                }
                if (myUploadCountText) {
                    const cnt = data.my_photos || 0;
                    myUploadCountText.textContent = cnt === 1 
                        ? `Du hast bisher 1 eigenes Foto hochgeladen`
                        : `Du hast bisher ${cnt} eigene Fotos hochgeladen`;
                }
            })
            .catch(err => console.error('Stats error:', err));
    }

    function loadMyPhotos() {
        if (!myPhotosGrid) return;

        fetch('/api/my-uploads')
            .then(res => res.json())
            .then(data => {
                const photos = data.photos || [];
                if (myPhotosBadge) myPhotosBadge.textContent = photos.length;
                if (myUploadCountText) {
                    myUploadCountText.textContent = photos.length === 1 
                        ? `Du hast bisher 1 eigenes Foto hochgeladen`
                        : `Du hast bisher ${photos.length} eigene Fotos hochgeladen`;
                }

                // Update toggle button text if section is open or closed
                if (toggleMyPhotosBtn && myPhotosContainer) {
                    const isHidden = myPhotosContainer.classList.contains('hidden');
                    if (isHidden) {
                        toggleMyPhotosBtn.innerHTML = `👁️ Meine eigenen Fotos anzeigen (${photos.length})`;
                    } else {
                        toggleMyPhotosBtn.innerHTML = `🙈 Meine eigenen Fotos ausblenden (${photos.length})`;
                    }
                }

                if (photos.length === 0) {
                    myPhotosGrid.innerHTML = `
                        <div class="empty-state">
                            <div class="empty-icon">📷</div>
                            <h3>Noch keine eigenen Uploads</h3>
                            <p>Tippe oben auf den roten Button, um dein erstes Party-Foto hochzuladen!</p>
                        </div>
                    `;
                    return;
                }

                myPhotosGrid.innerHTML = photos.map(photo => `
                    <div class="gallery-card" data-id="${photo.id}" data-full="/uploads/${photo.filename}">
                        <img src="/thumbnails/${photo.thumbnail}" alt="${photo.original_filename}" loading="lazy">
                        <button class="delete-btn" data-id="${photo.id}" title="Dieses Foto löschen">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                        </button>
                    </div>
                `).join('');

                // Attach Handlers
                document.querySelectorAll('.gallery-card').forEach(card => {
                    card.addEventListener('click', (e) => {
                        if (e.target.closest('.delete-btn')) {
                            e.stopPropagation();
                            const photoId = e.target.closest('.delete-btn').getAttribute('data-id');
                            deletePhoto(photoId);
                            return;
                        }

                        const fullUrl = card.getAttribute('data-full');
                        openLightbox(fullUrl);
                    });
                });
            })
            .catch(err => {
                console.error('Error loading my photos:', err);
                myPhotosGrid.innerHTML = '<div class="empty-state">Fehler beim Laden deiner Fotos.</div>';
            });
    }

    function deletePhoto(photoId) {
        if (!confirm('Möchtest du dieses Foto wirklich löschen?')) return;

        fetch(`/api/delete/${photoId}`, { method: 'POST' })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    showToast('Foto gelöscht.', 'success', 3000);
                    fetchStats();
                    loadMyPhotos();
                } else {
                    showToast(data.error || 'Fehler beim Löschen.', 'error', 4000);
                }
            })
            .catch(err => showToast('Netzwerkfehler beim Löschen.', 'error', 4000));
    }

    // ----------------------------------------------------
    // Lightbox Logic
    // ----------------------------------------------------
    function openLightbox(url) {
        lightboxImg.src = url;
        lightboxModal.classList.remove('hidden');
    }

    if (modalCloseBtn) {
        modalCloseBtn.addEventListener('click', () => {
            lightboxModal.classList.add('hidden');
            lightboxImg.src = '';
        });
    }

    if (lightboxModal) {
        lightboxModal.addEventListener('click', (e) => {
            if (e.target === lightboxModal) {
                lightboxModal.classList.add('hidden');
                lightboxImg.src = '';
            }
        });
    }

    // ----------------------------------------------------
    // Auto-Disappearing Toast Popup Notification System
    // ----------------------------------------------------
    function showToast(message, type = 'info', duration = 4000) {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `<span>${message}</span>`;
        toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-15px) scale(0.95)';
            toast.style.transition = 'all 0.35s ease';
            setTimeout(() => toast.remove(), 350);
        }, duration);
    }
});
