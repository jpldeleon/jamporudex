/**
 * ======================================================================
 * JamporuDex — main.js
 * Handles: theme toggle (LocalStorage), floating dock actions, the
 * Add Entry modal's Jikan search flow, the Edit modal, the Lightbox,
 * and scroll-to-top.
 * ======================================================================
 */

document.addEventListener('DOMContentLoaded', () => {
  // ------------------------------------------------------------------
  // THEME TOGGLE
  // ------------------------------------------------------------------
  const THEME_KEY = 'jamporudex-theme';
  const root = document.documentElement;
  const themeToggleBtn = document.getElementById('themeToggle');
  const iconMoon = document.getElementById('iconMoon');
  const iconSparkle = document.getElementById('iconSparkle');

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    const isLight = theme === 'tokyo-night-light';
    iconMoon.classList.toggle('hidden', isLight);
    iconSparkle.classList.toggle('hidden', !isLight);
    localStorage.setItem(THEME_KEY, theme);
  }

  const savedTheme = localStorage.getItem(THEME_KEY) || 'tokyo-night-storm';
  applyTheme(savedTheme);

  themeToggleBtn.addEventListener('click', () => {
    const current = root.getAttribute('data-theme');
    applyTheme(current === 'tokyo-night-storm' ? 'tokyo-night-light' : 'tokyo-night-storm');
  });

  // ------------------------------------------------------------------
  // SCROLL TO TOP
  // ------------------------------------------------------------------
  document.getElementById('scrollTopBtn').addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // ------------------------------------------------------------------
  // GENERIC MODAL OPEN / CLOSE
  // ------------------------------------------------------------------
  function openModal(overlayEl) {
    overlayEl.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeModal(overlayEl) {
    overlayEl.classList.add('hidden');
    document.body.style.overflow = '';
  }

  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => {
      closeModal(document.getElementById(btn.dataset.closeModal));
    });
  });

  document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay);
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.modal-overlay:not(.hidden), .lightbox-overlay:not(.hidden)')
      .forEach((el) => el.classList.add('hidden'));
    document.body.style.overflow = '';
  });

  // ------------------------------------------------------------------
  // ADD ENTRY MODAL — Jikan search flow
  // ------------------------------------------------------------------
  const addModalOverlay = document.getElementById('addModalOverlay');
  const searchTitleInput = document.getElementById('searchTitle');
  const searchTypeSelect = document.getElementById('searchType');
  const searchBtn = document.getElementById('searchBtn');
  const searchResultsEl = document.getElementById('searchResults');
  const addForm = document.getElementById('addForm');
  const selectedPreview = document.getElementById('selectedPreview');

  document.getElementById('openAddModal').addEventListener('click', () => {
    // Reset state each time the modal opens
    searchTitleInput.value = '';
    searchResultsEl.innerHTML = '';
    addForm.classList.add('hidden');
    addForm.reset();
    openModal(addModalOverlay);
    searchTitleInput.focus();
  });

  async function runSearch() {
    const title = searchTitleInput.value.trim();
    if (!title) return;
    searchResultsEl.innerHTML = '<p style="grid-column:1/-1;color:var(--muted);font-size:0.8rem;">Searching…</p>';
    try {
      const res = await fetch(`/api/jikan-search?title=${encodeURIComponent(title)}&type=${searchTypeSelect.value}`);
      const data = await res.json();

      if (!res.ok) {
        // Surface the real problem (rate limit, network issue, etc.)
        // instead of silently showing "No results found."
        console.error('Search error:', data.error || res.status);
        searchResultsEl.innerHTML = `<p style="grid-column:1/-1;color:var(--love);font-size:0.8rem;">${data.error || 'Search failed. Try again in a moment.'}</p>`;
        return;
      }

      renderSearchResults(data.results || [], data.source);
    } catch (err) {
      console.error('Jikan search network error:', err);
      searchResultsEl.innerHTML = '<p style="grid-column:1/-1;color:var(--love);font-size:0.8rem;">Could not reach the server. Check your connection and try again.</p>';
    }
  }

  searchBtn.addEventListener('click', runSearch);
  searchTitleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runSearch(); }
  });

  function renderSearchResults(results, source) {
    if (!results.length) {
      searchResultsEl.innerHTML = '<p style="grid-column:1/-1;color:var(--muted);font-size:0.8rem;">No results found.</p>';
      return;
    }
    searchResultsEl.innerHTML = '';

    if (source === 'anilist') {
      const notice = document.createElement('p');
      notice.style.cssText = 'grid-column:1/-1;color:var(--foam);font-size:0.72rem;margin:0 0 0.4rem;';
      notice.textContent = 'Jikan was unreachable — showing results from AniList instead.';
      searchResultsEl.appendChild(notice);
    }

    results.forEach((item) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'search-result-card';
      card.innerHTML = `<img src="${item.image_url}" alt="${item.title}" /><span>${item.title}</span>`;
      card.addEventListener('click', () => selectResult(item, card));
      searchResultsEl.appendChild(card);
    });
  }

  function selectResult(item, cardEl) {
    document.querySelectorAll('.search-result-card').forEach((c) => c.classList.remove('selected'));
    cardEl.classList.add('selected');

    document.getElementById('f_mal_id').value = item.mal_id;
    document.getElementById('f_title').value = item.title;
    document.getElementById('f_media_type').value = item.type;
    document.getElementById('f_cover_url').value = item.image_url;
    document.getElementById('f_synopsis').value = item.synopsis;

    selectedPreview.innerHTML = `
      <img src="${item.image_url}" alt="${item.title}" />
      <div>
        <strong>${item.title}</strong>
        <div style="font-size:0.75rem;color:var(--muted);text-transform:capitalize;">${item.type}</div>
      </div>
    `;

    addForm.classList.remove('hidden');
  }

  // ------------------------------------------------------------------
  // EDIT MODAL
  // ------------------------------------------------------------------
  const editModalOverlay = document.getElementById('editModalOverlay');
  const editForm = document.getElementById('editForm');

  function openEditModal(card) {
    editForm.action = `/entries/${card.dataset.id}/update`;
    document.getElementById('e_status').value = card.dataset.status;
    document.getElementById('e_progress').value = card.dataset.progress;
    document.getElementById('e_rating').value = card.dataset.rating;
    document.getElementById('e_review').value = card.dataset.review;
    openModal(editModalOverlay);
  }

  // ------------------------------------------------------------------
  // LIGHTBOX
  // ------------------------------------------------------------------
  const lightboxOverlay = document.getElementById('lightboxOverlay');
  const lightboxClose = document.getElementById('lightboxClose');

  function openLightbox(card) {
    document.getElementById('lb_cover').src = card.dataset.cover;
    document.getElementById('lb_cover').alt = card.dataset.title;
    document.getElementById('lb_title').textContent = card.dataset.title;
    document.getElementById('lb_type').textContent = card.dataset.type;
    document.getElementById('lb_progress').textContent = card.dataset.progress || '—';
    document.getElementById('lb_synopsis').textContent = card.dataset.synopsis || 'No synopsis available.';
    document.getElementById('lb_review').textContent = card.dataset.review || 'No review yet.';

    const rating = parseInt(card.dataset.rating, 10) || 0;
    const stars = Array.from({ length: 10 }, (_, i) =>
      `<span style="color:${i < rating ? 'var(--gold)' : 'var(--overlay)'}">★</span>`
    ).join('');
    document.getElementById('lb_rating').innerHTML = stars;

    document.getElementById('lb_deleteForm').action = `/entries/${card.dataset.id}/delete`;

    document.getElementById('lb_edit').onclick = () => {
      closeModal(lightboxOverlay);
      openEditModal(card);
    };

    openModal(lightboxOverlay);
  }

  lightboxClose.addEventListener('click', () => closeModal(lightboxOverlay));
  lightboxOverlay.addEventListener('click', (e) => {
    if (e.target === lightboxOverlay) closeModal(lightboxOverlay);
  });

  document.querySelectorAll('.entry-card').forEach((card) => {
    card.querySelector('.card-cover-btn').addEventListener('click', () => openLightbox(card));
  });

  // ------------------------------------------------------------------
  // SIDE DOCK — mobile trigger, projects subnav, email copy + toast
  // ------------------------------------------------------------------
  const sideDock = document.getElementById('sideDock');
  const sideDockTrigger = document.getElementById('sideDockTrigger');
  const projectsToggle = document.getElementById('projectsToggle');
  const projectsSubnav = document.getElementById('projectsSubnav');
  const copyEmailBtn = document.getElementById('copyEmailBtn');
  const dockToast = document.getElementById('dockToast');

  let toastTimer;
  function showDockToast(message) {
    dockToast.textContent = message;
    dockToast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => dockToast.classList.remove('is-visible'), 2200);
  }

  // Mobile: tap the corner trigger to open/close the panel as an overlay.
  // (On desktop the CSS :hover on .side-dock__panel handles this instead.)
  sideDockTrigger.addEventListener('click', () => {
    const isOpen = sideDock.classList.toggle('is-open');
    sideDockTrigger.setAttribute('aria-expanded', String(isOpen));
  });

  document.addEventListener('click', (e) => {
    if (!sideDock.contains(e.target) && sideDock.classList.contains('is-open')) {
      sideDock.classList.remove('is-open');
      sideDockTrigger.setAttribute('aria-expanded', 'false');
    }
  });

  // Folder icon toggles the project subnav open/closed.
  projectsToggle.addEventListener('click', () => {
    const isOpen = projectsSubnav.classList.toggle('hidden') === false;
    projectsToggle.setAttribute('aria-expanded', String(isOpen));
  });

  // Email is never written in the HTML — it's assembled from two data
  // attributes at click time, then copied straight to the clipboard.
  copyEmailBtn.addEventListener('click', async () => {
    const address = `${copyEmailBtn.dataset.user}@${copyEmailBtn.dataset.domain}`;
    try {
      await navigator.clipboard.writeText(address);
      showDockToast('Email copied to clipboard!');
    } catch (err) {
      showDockToast('Could not copy — clipboard access blocked.');
    }
  });

  // ------------------------------------------------------------------
  // DELETE CONFIRMATION (from the lightbox's inline delete form)
  // ------------------------------------------------------------------
  document.getElementById('lb_deleteForm').addEventListener('submit', (e) => {
    if (!confirm('Remove this entry from your index? This cannot be undone.')) {
      e.preventDefault();
    }
  });
});