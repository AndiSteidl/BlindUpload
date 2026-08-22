document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const galleryGrid = document.querySelector('.admin-gallery .gallery-grid');
    const selectAllBtn = document.getElementById('select-all-btn');
    const deselectAllBtn = document.getElementById('deselect-all-btn');
    const stickySelectionBar = document.getElementById('selection-bar');
    const selectedCountBadge = document.getElementById('selected-count-badge');
    const btnShareSelected = document.getElementById('btn-share-selected');
    const btnDownloadSelected = document.getElementById('btn-download-selected');
    const btnZipSelected = document.getElementById('btn-zip-selected');

    // Lightbox Elements
    const lightboxModal = document.getElementById('admin-lightbox-modal');
    const lightboxImg = document.getElementById('admin-lightbox-img');
    const lightboxTitle = document.getElementById('admin-lightbox-title');
    const lightboxMeta = document.getElementById('admin-lightbox-meta');
    const lightboxCloseBtn = document.getElementById('admin-lightbox-close');
    const lightboxPrevBtn = document.getElementById('admin-lightbox-prev');
    const lightboxNextBtn = document.getElementById('admin-lightbox-next');
    const lightboxDownloadBtn = document.getElementById('admin-lightbox-download');
    const lightboxShareBtn = document.getElementById('admin-lightbox-share');
    const toastContainer = document.getElementById('toast-container') || createToastContainer();

    // Data State
    let photoCards = Array.from(document.querySelectorAll('.admin-gallery .gallery-card'));
    let photoData = photoCards.map(card => ({
        id: card.getAttribute('data-id'),
        filename: card.getAttribute('data-filename'),
        originalFilename: card.getAttribute('data-original-filename'),
        uploadedAt: card.getAttribute('data-uploaded-at'),
        fileSize: card.getAttribute('data-file-size'),
        fullUrl: card.getAttribute('data-full-url'),
        element: card
    }));

    let currentLightboxIndex = -1;
    let selectedIds = new Set();

    function createToastContainer() {
        const div = document.createElement('div');
        div.id = 'toast-container';
        div.className = 'toast-container';
        document.body.appendChild(div);
        return div;
    }

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

    // ----------------------------------------------------
    // Selection Management
    // ----------------------------------------------------
    function updateSelectionUI() {
        const count = selectedIds.size;
        if (selectedCountBadge) {
            selectedCountBadge.textContent = count;
        }

        if (stickySelectionBar) {
            if (count > 0) {
                stickySelectionBar.classList.remove('hidden');
            } else {
                stickySelectionBar.classList.add('hidden');
            }
        }

        photoData.forEach(item => {
            const checkbox = item.element.querySelector('.card-select-checkbox');
            if (checkbox) {
                const isSelected = selectedIds.has(item.id);
                checkbox.checked = isSelected;
                if (isSelected) {
                    item.element.classList.add('selected');
                } else {
                    item.element.classList.remove('selected');
                }
            }
        });
    }

    // Event handlers for gallery card clicks & checkboxes
    photoData.forEach((item, index) => {
        const card = item.element;
        const checkbox = card.querySelector('.card-select-checkbox');

        if (checkbox) {
            checkbox.addEventListener('change', (e) => {
                e.stopPropagation();
                if (checkbox.checked) {
                    selectedIds.add(item.id);
                } else {
                    selectedIds.delete(item.id);
                }
                updateSelectionUI();
            });
        }

        // Clicking on the photo or card (outside direct link buttons) opens lightbox
        card.addEventListener('click', (e) => {
            // Ignore click if user tapped on checkbox directly
            if (e.target.closest('.card-select-container') || e.target.tagName === 'INPUT') {
                return;
            }
            if (e.target.closest('.gallery-card-action')) {
                return; // Let direct download link work
            }
            openLightbox(index);
        });
    });

    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
            photoData.forEach(item => selectedIds.add(item.id));
            updateSelectionUI();
            showToast(`Alle ${photoData.length} Fotos ausgewählt.`, 'info', 2500);
        });
    }

    if (deselectAllBtn) {
        deselectAllBtn.addEventListener('click', () => {
            selectedIds.clear();
            updateSelectionUI();
        });
    }

    // ----------------------------------------------------
    // Lightbox Logic
    // ----------------------------------------------------
    function openLightbox(index) {
        if (index < 0 || index >= photoData.length) return;
        currentLightboxIndex = index;
        const item = photoData[currentLightboxIndex];

        lightboxImg.src = item.fullUrl;
        if (lightboxTitle) lightboxTitle.textContent = item.originalFilename;
        if (lightboxMeta) {
            lightboxMeta.textContent = `Hochgeladen: ${item.uploadedAt || 'Unbekannt'}`;
        }
        if (lightboxDownloadBtn) {
            lightboxDownloadBtn.href = `${item.fullUrl}?download=1`;
            lightboxDownloadBtn.setAttribute('download', item.originalFilename);
        }

        lightboxModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden'; // Prevent background scrolling
    }

    function closeLightbox() {
        lightboxModal.classList.add('hidden');
        lightboxImg.src = '';
        document.body.style.overflow = '';
        currentLightboxIndex = -1;
    }

    function prevLightbox() {
        if (currentLightboxIndex > 0) {
            openLightbox(currentLightboxIndex - 1);
        } else {
            openLightbox(photoData.length - 1); // Loop to end
        }
    }

    function nextLightbox() {
        if (currentLightboxIndex < photoData.length - 1) {
            openLightbox(currentLightboxIndex + 1);
        } else {
            openLightbox(0); // Loop to start
        }
    }

    if (lightboxCloseBtn) lightboxCloseBtn.addEventListener('click', closeLightbox);
    if (lightboxPrevBtn) lightboxPrevBtn.addEventListener('click', prevLightbox);
    if (lightboxNextBtn) lightboxNextBtn.addEventListener('click', nextLightbox);

    if (lightboxModal) {
        lightboxModal.addEventListener('click', (e) => {
            if (e.target === lightboxModal) {
                closeLightbox();
            }
        });
    }

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        if (lightboxModal && !lightboxModal.classList.contains('hidden')) {
            if (e.key === 'Escape') closeLightbox();
            if (e.key === 'ArrowLeft') prevLightbox();
            if (e.key === 'ArrowRight') nextLightbox();
        }
    });

    // Touch Swipe Navigation for Lightbox (Smartphones)
    let touchStartX = 0;
    let touchEndX = 0;

    if (lightboxModal) {
        lightboxModal.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
        }, { passive: true });

        lightboxModal.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            handleSwipe();
        }, { passive: true });
    }

    function handleSwipe() {
        const threshold = 50; // min distance for swipe
        if (touchEndX < touchStartX - threshold) {
            nextLightbox(); // Swipe Left -> Next
        }
        if (touchEndX > touchStartX + threshold) {
            prevLightbox(); // Swipe Right -> Prev
        }
    }

    // ----------------------------------------------------
    // Single Photo Web Share (Lightbox)
    // ----------------------------------------------------
    if (lightboxShareBtn) {
        lightboxShareBtn.addEventListener('click', async () => {
            if (currentLightboxIndex < 0) return;
            const item = photoData[currentLightboxIndex];

            if (navigator.share) {
                try {
                    showToast('Lade Bild zum Teilen...', 'info', 2000);
                    const response = await fetch(item.fullUrl);
                    const blob = await response.blob();
                    const file = new File([blob], item.originalFilename, { type: blob.type || 'image/jpeg' });

                    if (navigator.canShare && navigator.canShare({ files: [file] })) {
                        await navigator.share({
                            files: [file],
                            title: item.originalFilename
                        });
                        showToast('Bild erfolgreich gesendet / in Fotos gesichert!', 'success');
                    } else {
                        await navigator.share({
                            title: item.originalFilename,
                            url: window.location.origin + item.fullUrl
                        });
                    }
                } catch (err) {
                    if (err.name !== 'AbortError') {
                        console.error('Share failed:', err);
                        showToast('Teilen konnte nicht abgeschlossen werden.', 'error');
                    }
                }
            } else {
                // Fallback: direct download
                const link = document.createElement('a');
                link.href = `${item.fullUrl}?download=1`;
                link.download = item.originalFilename;
                link.click();
                showToast('Web Share nicht unterstützt. Bild wird heruntergeladen.', 'info');
            }
        });
    }

    // ----------------------------------------------------
    // Actions for Selected Photos (iPhone & Desktop)
    // ----------------------------------------------------

    // 1. Web Share API (Native iOS "In Fotos sichern" / Camera Roll integration)
    if (btnShareSelected) {
        btnShareSelected.addEventListener('click', async () => {
            const selectedList = photoData.filter(p => selectedIds.has(p.id));
            if (selectedList.length === 0) return;

            if (!navigator.share) {
                showToast('⚠️ Web Share wird von diesem Browser leider nicht unterstützt. Nutze "Einzeln herunterladen".', 'info', 5000);
                return;
            }

            try {
                showToast(`Bereite ${selectedList.length} Bild(er) zum Teilen vor...`, 'info', 3000);
                
                const files = await Promise.all(selectedList.map(async (item) => {
                    const res = await fetch(item.fullUrl);
                    const blob = await res.blob();
                    const ext = item.filename.split('.').pop() || 'jpg';
                    const mime = blob.type || (ext === 'png' ? 'image/png' : 'image/jpeg');
                    return new File([blob], item.originalFilename, { type: mime });
                }));

                if (navigator.canShare && navigator.canShare({ files })) {
                    await navigator.share({
                        files: files,
                        title: `Gabis 50er - ${files.length} Fotos`
                    });
                    showToast('🎉 Erfolgreich gesichert / geteilt!', 'success');
                } else {
                    showToast('⚠️ Dein Gerät unterstützt das Teilen von mehreren Dateien gleichzeitig nicht. Teile die Bilder einzeln.', 'error', 4500);
                }
            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.error('Batch share error:', err);
                    showToast('Fehler beim Teilen der Dateien.', 'error');
                }
            }
        });
    }

    // 2. Individual Downloads (Ideal for mobile browsers without ZIP extraction)
    if (btnDownloadSelected) {
        btnDownloadSelected.addEventListener('click', () => {
            const selectedList = photoData.filter(p => selectedIds.has(p.id));
            if (selectedList.length === 0) return;

            showToast(`Starte Download von ${selectedList.length} Foto(s)...`, 'info', 3500);

            selectedList.forEach((item, index) => {
                setTimeout(() => {
                    const a = document.createElement('a');
                    a.href = `${item.fullUrl}?download=1`;
                    a.download = item.originalFilename;
                    a.target = '_blank';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                }, index * 400); // Stagger downloads slightly so mobile browser doesn't block them
            });
        });
    }

    // 3. Download selected as ZIP
    if (btnZipSelected) {
        btnZipSelected.addEventListener('click', async () => {
            const ids = Array.from(selectedIds);
            if (ids.length === 0) return;

            showToast(`Erstelle ZIP-Archiv für ${ids.length} Fotos...`, 'info', 4000);

            try {
                const response = await fetch('/admin/download-selected-zip', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ photo_ids: ids })
                });

                if (!response.ok) {
                    throw new Error('ZIP Erstellung fehlgeschlagen.');
                }

                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `Gabi_50_Auswahl_${ids.length}_Fotos.zip`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
                showToast('ZIP-Datei heruntergeladen!', 'success');
            } catch (err) {
                console.error('ZIP download error:', err);
                showToast('Fehler beim Erstellen des ZIP-Archivs.', 'error');
            }
        });
    }
});
