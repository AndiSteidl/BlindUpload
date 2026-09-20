document.addEventListener('DOMContentLoaded', () => {
    // UI Element References
    const dropzone = document.getElementById('dropzone');
    const cameraInput = document.getElementById('camera-input');
    const progressContainer = document.getElementById('progress-container');
    const progressBarFill = document.getElementById('progress-bar-fill');
    const progressPercent = document.getElementById('progress-percent');
    const progressStatusText = document.getElementById('progress-status-text');
    const progressBytesText = document.getElementById('progress-bytes-text');
    const activeFilePill = document.getElementById('active-file-pill');
    const activeFileIcon = document.getElementById('active-file-icon');
    const activeFileName = document.getElementById('active-file-name');
    const activeFileSpeed = document.getElementById('active-file-speed');
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

    function formatBytes(bytes, decimals = 1) {
        if (!bytes || bytes <= 0) return '0 B';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
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
            if (progressContainer) progressContainer.classList.add('hidden');
            if (dropzone) dropzone.classList.remove('hidden');
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

        // 1. IMMEDIATELY HIDE DROPZONE & BUTTON
        // Visual confirmation that the selection was accepted: the button vanishes instantly
        if (dropzone) dropzone.classList.add('hidden');
        if (progressContainer) progressContainer.classList.remove('hidden');

        // Scroll to progress card smoothly on mobile
        if (progressContainer) {
            progressContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        const totalCount = files.length;
        let successCount = 0;
        const errors = [];

        // Distinguish videos and photos
        const videoCount = files.filter(f => isVideoUrl(f.name)).length;
        const photoCount = totalCount - videoCount;
        const totalBytes = files.reduce((sum, f) => sum + f.size, 0);

        let summaryType = '';
        if (videoCount > 0 && photoCount > 0) {
            summaryType = `${videoCount} Video${videoCount > 1 ? 's' : ''} & ${photoCount} Foto${photoCount > 1 ? 's' : ''}`;
        } else if (videoCount > 0) {
            summaryType = `${videoCount} Video${videoCount > 1 ? 's' : ''}`;
        } else {
            summaryType = `${photoCount} Foto${photoCount > 1 ? 's' : ''}`;
        }

        if (progressStatusText) {
            progressStatusText.textContent = `Lade ${summaryType} hoch...`;
        }
        if (progressBytesText) {
            progressBytesText.textContent = `0 B von ${formatBytes(totalBytes)}`;
        }
        if (progressBarFill) progressBarFill.style.width = '0%';
        if (progressPercent) progressPercent.textContent = '0%';

        if (activeFileName) activeFileName.textContent = files[0].name;
        if (activeFileIcon) activeFileIcon.textContent = isVideoUrl(files[0].name) ? '🎥' : '📸';
        if (activeFileSpeed) activeFileSpeed.textContent = '• Verbindung aufbauen...';

        // Track byte upload for each individual file (in exact bytes!)
        const fileBytesUploaded = new Array(totalCount).fill(0);
        const queue = files.map((file, index) => ({ file, index }));
        let activeUploads = 0;
        let completedCount = 0;
        const uploadStartTime = Date.now();

        // Map to track active file state: index -> { name, isVideo, chunkInfo, status }
        const activeFilesMap = new Map();

        function updateUI() {
            const waitingCount = queue.length;
            if (queueActiveText) {
                queueActiveText.textContent = `⚡ ${activeUploads} von max. ${MAX_CONCURRENT} Uploads aktiv`;
            }
            if (queueWaitingText) {
                queueWaitingText.textContent = `${waitingCount} in Warteschlange`;
            }

            // Calculate total uploaded bytes across all files
            const totalUploaded = fileBytesUploaded.reduce((sum, b) => sum + b, 0);
            const percent = totalBytes > 0 
                ? Math.min(uploadCancelled ? 0 : 100, Math.round((totalUploaded / totalBytes) * 100))
                : 0;

            if (progressBarFill) progressBarFill.style.width = `${percent}%`;
            if (progressPercent) progressPercent.textContent = `${percent}%`;

            if (progressBytesText) {
                progressBytesText.textContent = `${formatBytes(totalUploaded)} von ${formatBytes(totalBytes)}`;
            }

            // Title
            if (progressStatusText) {
                if (totalUploaded >= totalBytes && activeUploads > 0) {
                    progressStatusText.textContent = `⚙️ Finalisiere auf dem Server...`;
                } else if (totalCount === 1) {
                    progressStatusText.textContent = `Lade ${summaryType} hoch...`;
                } else {
                    progressStatusText.textContent = `Verarbeite ${completedCount + activeUploads} von ${totalCount} (${summaryType})...`;
                }
            }

            // Active file info
            if (activeFilePill) {
                if (activeFilesMap.size > 0) {
                    const firstActive = Array.from(activeFilesMap.values())[0];
                    if (activeFileIcon) {
                        activeFileIcon.textContent = firstActive.status === 'assembling' ? '⚙️' : (firstActive.isVideo ? '🎥' : '📸');
                    }
                    if (activeFileName) {
                        const suffix = firstActive.status === 'assembling' 
                            ? ' (Wird verarbeitet...)' 
                            : (firstActive.chunkInfo ? ` (${firstActive.chunkInfo})` : '');
                        activeFileName.textContent = `${firstActive.name}${suffix}`;
                    }

                    const elapsedSec = (Date.now() - uploadStartTime) / 1000;
                    if (elapsedSec > 0.8 && totalUploaded > 0 && activeFileSpeed) {
                        const bytesPerSec = totalUploaded / elapsedSec;
                        const remainingBytes = Math.max(0, totalBytes - totalUploaded);
                        const remainingSec = Math.round(remainingBytes / bytesPerSec);
                        let eta = '';
                        if (remainingSec > 60) {
                            eta = `noch ca. ${Math.ceil(remainingSec / 60)} Min.`;
                        } else if (remainingSec > 0) {
                            eta = `noch ca. ${remainingSec}s`;
                        }
                        activeFileSpeed.textContent = `• ~ ${formatBytes(bytesPerSec)}/s ${eta ? '• ' + eta : ''}`;
                    }
                } else if (completedCount === totalCount) {
                    if (activeFileIcon) activeFileIcon.textContent = '✅';
                    if (activeFileName) activeFileName.textContent = 'Alle Dateien übertragen!';
                    if (activeFileSpeed) activeFileSpeed.textContent = '';
                }
            }
        }

        updateUI();

        function uploadChunkedFile(item) {
            return new Promise(async (resolve) => {
                if (uploadCancelled) {
                    return resolve({ success: false, cancelled: true });
                }

                const CHUNK_SIZE = 20 * 1024 * 1024; // 20 MB slices (bypasses Cloudflare Free 100 MB limit)
                const totalChunks = Math.ceil(item.file.size / CHUNK_SIZE);
                const fileId = 'chk_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);

                activeFilesMap.set(item.index, {
                    name: item.file.name,
                    isVideo: true,
                    chunkInfo: `Teil 1/${totalChunks}`,
                    status: 'uploading'
                });
                updateUI();

                for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
                    if (uploadCancelled) {
                        activeFilesMap.delete(item.index);
                        return resolve({ success: false, cancelled: true });
                    }

                    const start = chunkIndex * CHUNK_SIZE;
                    const end = Math.min(item.file.size, start + CHUNK_SIZE);
                    const chunkBlob = item.file.slice(start, end);

                    activeFilesMap.set(item.index, {
                        name: item.file.name,
                        isVideo: true,
                        chunkInfo: `Teil ${chunkIndex + 1}/${totalChunks}`,
                        status: 'uploading'
                    });
                    updateUI();

                    // Retry up to 3 times per chunk on transient network failure
                    let chunkSuccess = false;
                    let lastError = null;

                    for (let attempt = 0; attempt < 3; attempt++) {
                        if (uploadCancelled) {
                            activeFilesMap.delete(item.index);
                            return resolve({ success: false, cancelled: true });
                        }

                        const chunkRes = await new Promise((chunkResolve) => {
                            const formData = new FormData();
                            formData.append('file_id', fileId);
                            formData.append('chunk_index', chunkIndex);
                            formData.append('total_chunks', totalChunks);
                            formData.append('filename', item.file.name);
                            formData.append('chunk', chunkBlob, item.file.name);

                            const xhr = new XMLHttpRequest();
                            activeXhrs.add(xhr);
                            xhr.open('POST', '/api/upload-chunk', true);

                            xhr.upload.onprogress = (e) => {
                                if (e.lengthComputable && !uploadCancelled) {
                                    fileBytesUploaded[item.index] = start + e.loaded;
                                    updateUI();
                                }
                            };

                            // When the final chunk bytes are uploaded, show assembly state while server processes
                            if (chunkIndex === totalChunks - 1) {
                                xhr.upload.onload = () => {
                                    fileBytesUploaded[item.index] = item.file.size;
                                    activeFilesMap.set(item.index, {
                                        name: item.file.name,
                                        isVideo: true,
                                        chunkInfo: 'Finalisiere auf Server...',
                                        status: 'assembling'
                                    });
                                    updateUI();
                                };
                            }

                            xhr.onload = function () {
                                activeXhrs.delete(xhr);
                                if (uploadCancelled) {
                                    return chunkResolve({ success: false, cancelled: true });
                                }
                                if (xhr.status === 200) {
                                    try {
                                        const parsed = JSON.parse(xhr.responseText);
                                        return chunkResolve({ success: true, data: parsed });
                                    } catch (e) {
                                        return chunkResolve({ success: false, error: 'Ungültige Serverantwort' });
                                    }
                                } else {
                                    let msg = `HTTP ${xhr.status}`;
                                    try {
                                        const parsed = JSON.parse(xhr.responseText);
                                        if (parsed.error) msg = parsed.error;
                                    } catch (_) {}
                                    return chunkResolve({ success: false, error: msg });
                                }
                            };

                            xhr.onabort = function () {
                                activeXhrs.delete(xhr);
                                chunkResolve({ success: false, cancelled: true });
                            };

                            xhr.onerror = function () {
                                activeXhrs.delete(xhr);
                                chunkResolve({ success: false, error: 'Netzwerkfehler' });
                            };

                            xhr.send(formData);
                        });

                        if (chunkRes.cancelled) {
                            activeFilesMap.delete(item.index);
                            return resolve({ success: false, cancelled: true });
                        }

                        if (chunkRes.success) {
                            chunkSuccess = true;
                            if (chunkIndex === totalChunks - 1) {
                                fileBytesUploaded[item.index] = item.file.size;
                                activeFilesMap.delete(item.index);
                                updateUI();
                                if (chunkRes.data && chunkRes.data.success) {
                                    return resolve({ success: true, count: 1 });
                                } else {
                                    return resolve({ success: false, error: chunkRes.data?.error || 'Upload fehlgeschlagen' });
                                }
                            }
                            break;
                        } else {
                            lastError = chunkRes.error;
                            await new Promise(r => setTimeout(r, 1000));
                        }
                    }

                    if (!chunkSuccess) {
                        activeFilesMap.delete(item.index);
                        return resolve({ success: false, error: `${item.file.name}: Teil ${chunkIndex + 1}/${totalChunks} fehlgeschlagen (${lastError})` });
                    }
                }
            });
        }

        function uploadSingleFile(item) {
            // Automatically switch to chunked upload for files > 20 MB to bypass Cloudflare 100 MB limit
            const CHUNK_THRESHOLD = 20 * 1024 * 1024;
            if (item.file.size > CHUNK_THRESHOLD) {
                return uploadChunkedFile(item);
            }

            return new Promise((resolve) => {
                if (uploadCancelled) {
                    return resolve({ success: false, cancelled: true });
                }

                activeFilesMap.set(item.index, {
                    name: item.file.name,
                    isVideo: isVideoUrl(item.file.name),
                    chunkInfo: '',
                    status: 'uploading'
                });
                updateUI();

                const formData = new FormData();
                formData.append('photos', item.file);

                const xhr = new XMLHttpRequest();
                activeXhrs.add(xhr);
                xhr.open('POST', '/api/upload', true);

                // Upload progress event
                xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable && !uploadCancelled) {
                        fileBytesUploaded[item.index] = e.loaded;
                        updateUI();
                    }
                };

                xhr.onload = function () {
                    activeXhrs.delete(xhr);
                    activeFilesMap.delete(item.index);

                    if (uploadCancelled) {
                        return resolve({ success: false, cancelled: true });
                    }

                    if (xhr.status === 200) {
                        fileBytesUploaded[item.index] = item.file.size;
                        updateUI();
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
                    activeFilesMap.delete(item.index);
                    resolve({ success: false, cancelled: true });
                };

                xhr.onerror = function () {
                    activeXhrs.delete(xhr);
                    activeFilesMap.delete(item.index);
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

        if (uploadCancelled) {
            isUploading = false;
            if (progressContainer) progressContainer.classList.add('hidden');
            if (dropzone) dropzone.classList.remove('hidden');
            cameraInput.value = '';
            if (successCount > 0) {
                showToast(`Abgebrochen: ${successCount} Foto(s) wurden bereits gespeichert.`, 'info', 4000);
            }
            fetchStats();
            loadMyPhotos();
            return;
        }

        // Show 100% completion in progress card briefly
        if (progressBarFill) progressBarFill.style.width = '100%';
        if (progressPercent) progressPercent.textContent = '100%';
        if (progressStatusText) progressStatusText.textContent = '✅ Alle Dateien erfolgreich übertragen!';
        if (activeFileName) activeFileName.textContent = 'Erfolgreich auf dem Server gespeichert!';
        if (activeFileIcon) activeFileIcon.textContent = '🎉';
        if (activeFileSpeed) activeFileSpeed.textContent = '';

        setTimeout(() => {
            isUploading = false;
            if (progressContainer) progressContainer.classList.add('hidden');
            if (dropzone) dropzone.classList.remove('hidden');
            cameraInput.value = '';

            fetchStats();
            loadMyPhotos();

            if (successCount > 0 && errors.length === 0) {
                const label = successCount === 1 ? '1 Datei' : `${successCount} Dateien`;
                showToast(`🎉 Super! ${label} erfolgreich hochgeladen!`, 'success', 4500);
            } else if (successCount > 0 && errors.length > 0) {
                showToast(`⚠️ ${successCount} von ${totalCount} hochgeladen. Fehler bei: ${errors.join(', ')}`, 'warning', 6000);
            } else if (errors.length > 0) {
                showToast(`Upload fehlgeschlagen: ${errors[0]}`, 'error', 5000);
            }
        }, 1200);
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
