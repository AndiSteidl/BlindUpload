document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const lightboxModal = document.getElementById('admin-lightbox-modal');
    const lightboxImg = document.getElementById('admin-lightbox-img');
    const lightboxVideo = document.getElementById('admin-lightbox-video');
    const lightboxTitle = document.getElementById('admin-lightbox-title');
    const lightboxMeta = document.getElementById('admin-lightbox-meta');
    const lightboxCloseBtn = document.getElementById('admin-lightbox-close');
    const lightboxPrevBtn = document.getElementById('admin-lightbox-prev');
    const lightboxNextBtn = document.getElementById('admin-lightbox-next');
    const lightboxOpenBtn = document.getElementById('admin-lightbox-open');
    const lightboxDownloadBtn = document.getElementById('admin-lightbox-download');

    function isVideoUrl(url) {
        if (!url) return false;
        const ext = url.split('?')[0].split('.').pop().toLowerCase();
        return ['mp4', 'mov', 'webm', 'm4v', 'avi', 'mkv'].includes(ext);
    }

    // Collect all photo cards
    const photoCards = Array.from(document.querySelectorAll('.admin-gallery .gallery-card'));
    const photoData = photoCards.map(card => ({
        id: card.getAttribute('data-id'),
        originalFilename: card.getAttribute('data-original-filename'),
        uploadedAt: card.getAttribute('data-uploaded-at'),
        fullUrl: card.getAttribute('data-full-url'),
        element: card
    }));

    let currentIndex = -1;

    function openLightbox(index) {
        if (index < 0 || index >= photoData.length) return;
        currentIndex = index;
        const item = photoData[currentIndex];
        const isVid = isVideoUrl(item.fullUrl);

        if (isVid) {
            if (lightboxImg) lightboxImg.classList.add('hidden');
            if (lightboxVideo) {
                lightboxVideo.classList.remove('hidden');
                lightboxVideo.src = item.fullUrl;
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
                lightboxImg.src = item.fullUrl;
            }
        }

        if (lightboxTitle) lightboxTitle.textContent = item.originalFilename || '';
        if (lightboxMeta) lightboxMeta.textContent = `Hochgeladen: ${item.uploadedAt || ''}`;
        if (lightboxOpenBtn) lightboxOpenBtn.href = item.fullUrl;
        if (lightboxDownloadBtn) {
            lightboxDownloadBtn.href = `${item.fullUrl}?download=1`;
            lightboxDownloadBtn.setAttribute('download', item.originalFilename || (isVid ? 'video' : 'foto'));
        }

        lightboxModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    function closeLightbox() {
        lightboxModal.classList.add('hidden');
        if (lightboxImg) lightboxImg.src = '';
        if (lightboxVideo) {
            lightboxVideo.pause();
            lightboxVideo.src = '';
        }
        document.body.style.overflow = '';
        currentIndex = -1;
    }

    function prevLightbox() {
        if (currentIndex > 0) {
            openLightbox(currentIndex - 1);
        } else {
            openLightbox(photoData.length - 1);
        }
    }

    function nextLightbox() {
        if (currentIndex < photoData.length - 1) {
            openLightbox(currentIndex + 1);
        } else {
            openLightbox(0);
        }
    }

    // Attach click events to photo cards
    photoData.forEach((item, index) => {
        item.element.addEventListener('click', (e) => {
            // Prevent opening lightbox if user clicked direct action link
            if (e.target.closest('.gallery-card-link')) return;
            openLightbox(index);
        });
    });

    if (lightboxCloseBtn) lightboxCloseBtn.addEventListener('click', closeLightbox);
    if (lightboxPrevBtn) lightboxPrevBtn.addEventListener('click', prevLightbox);
    if (lightboxNextBtn) lightboxNextBtn.addEventListener('click', nextLightbox);

    if (lightboxModal) {
        lightboxModal.addEventListener('click', (e) => {
            if (e.target === lightboxModal) closeLightbox();
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

    // Touch Swipe Navigation for Smartphones
    let touchStartX = 0;
    let touchEndX = 0;

    if (lightboxModal) {
        lightboxModal.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
        }, { passive: true });

        lightboxModal.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            const threshold = 50;
            if (touchEndX < touchStartX - threshold) nextLightbox();
            if (touchEndX > touchStartX + threshold) prevLightbox();
        }, { passive: true });
    }
});
