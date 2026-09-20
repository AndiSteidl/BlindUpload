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
    const queueActiveText = document.getElementById('queue-active-text');
    const queueWaitingText = document.getElementById('queue-waiting-text');
    const activeUploadsLivePill = document.getElementById('active-uploads-live-pill');
    const serverActiveCount = document.getElementById('server-active-count');

    // Lightbox Elements
    const lightboxModal = document.getElementById('lightbox-modal');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxVideo = document.getElementById('lightbox-video');
    const modalCloseBtn = document.getElementById('modal-close-btn');

    function isVideoUrl(url) {
        if (!url) return false;
        const ext = url.split('?')[0].split('.').pop().toLowerCase();
        return ['mp4', 'mov', 'webm', 'm4v', 'avi', 'mkv'].includes(ext);
    }

    // Concurrency & State Variables (Max 5 parallel uploads)
    const MAX_CONCURRENT = 5;
    let isUploading = false;
    let uploadCancelled = false;
    const activeXhrs = new Set();

    // Initialize App & periodic live stats polling
    fetchStats();
    loadMyPhotos();
    setInterval(fetchStats, 15000);

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
    // Cancel Upload Handler (Aborts all active queue workers)
    // ----------------------------------------------------
    if (btnCancelUpload) {
        btnCancelUpload.addEventListener('click', () => {
            uploadCancelled = true;
            activeXhrs.forEach(xhr => {
                try { xhr.abort(); } catch (e) {}
            });
            activeXhrs.clear();
            isUploading = false;
            progressContainer.classList.add('hidden');
            cameraInput.value = '';
            showToast('❌ Upload wurde abgebrochen.', 'info', 3000);
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
    // Queue Upload with Max 5 Concurrent Workers & Live Display
    // ----------------------------------------------------
    async function handleFilesUpload(fileList) {
        if (isUploading) return;

        const files = Array.from(fileList);
        if (files.length === 0) return;

        isUploading = true;
        uploadCancelled = false;
        activeXhrs.clear();

        const totalCount = files.length;
        let successCount = 0;
        const errors = [];

        // Show progress UI
        progressContainer.classList.remove('hidden');
        progressBarFill.style.width = '0%';
        progressPercent.textContent = '0%';

        // Track byte ratio of each individual file (0.0 to 1.0)
        const fileProgress = new Array(totalCount).fill(0);
        const queue = files.map((file, index) => ({ file, index }));
        let activeUploads = 0;
        let completedCount = 0;

        function updateUI() {
            const waitingCount = queue.length;
            if (queueActiveText) {
                queueActiveText.textContent = `⚡ ${activeUploads} von max. ${MAX_CONCURRENT} Uploads aktiv`;
            }
            if (queueWaitingText) {
                queueWaitingText.textContent = `${waitingCount} in Warteschlange`;
            }
            if (progressStatusText) {
                if (totalCount === 1) {
                    progressStatusText.textContent = 'Lade 1 Foto hoch...';
                } else {
                    progressStatusText.textContent = `Verarbeite ${completedCount + activeUploads} von ${totalCount} Fotos...`;
                }
            }

            // Calculate total combined progress percentage
            const totalRatio = fileProgress.reduce((sum, val) => sum + val, 0) / totalCount;
            const overallPercent = Math.min(uploadCancelled ? 0 : 100, Math.round(totalRatio * 100));
            progressBarFill.style.width = `${overallPercent}%`;
            progressPercent.textContent = `${overallPercent}%`;
        }

        updateUI();

        function uploadSingleFile(item) {
            return new Promise((resolve) => {
                if (uploadCancelled) {
                    return resolve({ success: false, cancelled: true });
                }

                const formData = new FormData();
                formData.append('photos', item.file);

                const xhr = new XMLHttpRequest();
                activeXhrs.add(xhr);
                xhr.open('POST', '/api/upload', true);

                // Upload progress event
                xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable && !uploadCancelled) {
                        fileProgress[item.index] = e.loaded / e.total;
                        updateUI();
                    }
                };

                xhr.onload = function () {
                    activeXhrs.delete(xhr);
                    if (uploadCancelled) {
                        return resolve({ success: false, cancelled: true });
                    }

                    if (xhr.status === 200) {
                        fileProgress[item.index] = 1.0;
                        try {
                            const res = JSON.parse(xhr.responseText);
                            if (res.success && res.uploaded && res.uploaded.length > 0) {
                                return resolve({ success: true, count: res.uploaded.length });
                            } else {
                                return resolve({ success: false, error: res.error || 'Unbekannter Fehler' });
                            }
                        } catch (err) {
                            return resolve({ success: false, error: 'Ungültige Serverantwort' });
                        }
                    } else if (xhr.status === 413) {
                        return resolve({ success: false, error: `${item.file.name}: Datei überschreitet das Limit (max. 100 MB).` });
                    } else {
                        let errMsg = `Fehler (${xhr.status})`;
                        try {
                            const res = JSON.parse(xhr.responseText);
                            if (res.error) errMsg = res.error;
                        } catch (_) {}
                        return resolve({ success: false, error: `${item.file.name}: ${errMsg}` });
                    }
                };

                xhr.onabort = function () {
                    activeXhrs.delete(xhr);
                    resolve({ success: false, cancelled: true });
                };

                xhr.onerror = function () {
                    activeXhrs.delete(xhr);
                    if (uploadCancelled) return resolve({ success: false, cancelled: true });
                    resolve({ success: false, error: `${item.file.name}: Netzwerkfehler` });
                };

                xhr.send(formData);
            });
        }

        async function worker() {
            while (queue.length > 0 && !uploadCancelled) {
                const item = queue.shift();
                activeUploads++;
                updateUI();

                const res = await uploadSingleFile(item);

                activeUploads--;
                completedCount++;
                updateUI();

                if (res.cancelled) break;

                if (res.success) {
                    successCount += (res.count || 1);
                    if (completedCount % 3 === 0 || completedCount === totalCount) {
                        fetchStats();
                        loadMyPhotos();
                    }
                } else if (res.error) {
                    errors.push(res.error);
                }
            }
        }

        // Spawn pool of up to MAX_CONCURRENT concurrent workers
        const workerCount = Math.min(MAX_CONCURRENT, queue.length);
        const workers = [];
        for (let i = 0; i < workerCount; i++) {
            workers.push(worker());
        }

        await Promise.all(workers);

        // Cleanup state
        isUploading = false;
        progressContainer.classList.add('hidden');
        cameraInput.value = '';

        if (uploadCancelled) {
            if (successCount > 0) {
                showToast(`Abgebrochen: ${successCount} Foto(s) wurden bereits gespeichert.`, 'info', 4000);
            }
            fetchStats();
            loadMyPhotos();
            return;
        }

        fetchStats();
        loadMyPhotos();

        if (successCount > 0 && errors.length === 0) {
            showToast(`🎉 Super! ${successCount} Foto(s) erfolgreich hochgeladen!`, 'success', 4500);
        } else if (successCount > 0 && errors.length > 0) {
            showToast(`⚠️ ${successCount} von ${totalCount} Fotos hochgeladen. Fehler bei: ${errors.join(', ')}`, 'warning', 6000);
        } else if (errors.length > 0) {
            showToast(`Upload fehlgeschlagen: ${errors[0]}`, 'error', 5000);
        }
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
                if (activeUploadsLivePill && serverActiveCount) {
                    const act = data.active_uploads || 0;
                    serverActiveCount.textContent = act;
                    if (act > 0) {
                        activeUploadsLivePill.classList.remove('hidden');
                    } else {
                        activeUploadsLivePill.classList.add('hidden');
                    }
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

                myPhotosGrid.innerHTML = photos.map(photo => {
                    const isVid = isVideoUrl(photo.filename);
                    const videoBadgeHtml = isVid ? '<span class="video-badge">🎬 Video</span>' : '';
                    const videoClass = isVid ? 'gallery-card is-video' : 'gallery-card';
                    return `
                        <div class="${videoClass}" data-id="${photo.id}" data-full="/uploads/${photo.filename}" data-is-video="${isVid}">
                            <img src="/thumbnails/${photo.thumbnail}" alt="${photo.original_filename}" loading="lazy">
                            ${videoBadgeHtml}
                            <button class="delete-btn" data-id="${photo.id}" title="Dieses Element löschen">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                            </button>
                        </div>
                    `;
                }).join('');

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
    // Lightbox Logic (Photo & Video Player)
    // ----------------------------------------------------
    function openLightbox(url) {
        const isVid = isVideoUrl(url);
        if (isVid) {
            if (lightboxImg) lightboxImg.classList.add('hidden');
            if (lightboxVideo) {
                lightboxVideo.classList.remove('hidden');
                lightboxVideo.src = url;
                lightboxVideo.play().catch(() => {});
            }
        } else {
            if (lightboxVideo) {
                lightboxVideo.classList.add('hidden');
                lightboxVideo.pause();
                lightboxVideo.src = '';
            }
            if (lightboxImg) {
                lightboxImg.classList.remove('hidden');
                lightboxImg.src = url;
            }
        }
        lightboxModal.classList.remove('hidden');
    }

    function closeLightbox() {
        lightboxModal.classList.add('hidden');
        if (lightboxImg) lightboxImg.src = '';
        if (lightboxVideo) {
            lightboxVideo.pause();
            lightboxVideo.src = '';
        }
    }

    if (modalCloseBtn) {
        modalCloseBtn.addEventListener('click', closeLightbox);
    }

    if (lightboxModal) {
        lightboxModal.addEventListener('click', (e) => {
            if (e.target === lightboxModal) {
                closeLightbox();
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
