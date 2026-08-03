
const searchInput = document.getElementById('search');
const listEl = document.getElementById('utils-list');
const noResultsEl = document.getElementById('no-results');

const RECENT_KEY = 'utils.recent';
const RECENT_MAX = 3;

let utils = [];

function normalize(s) {
    return (s || '').toString().toLowerCase();
}

function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[c]));
}

function matches(util, query) {
    if (!query) return true;
    const haystack = [util.name, util.description, util.group, util.id]
        .map(normalize)
        .join(' ');
    return query
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .every((term) => haystack.includes(term));
}

function renderRow(u, isRecent) {
    const tag = isRecent ? ' <span class="recent-tag">(recent)</span>' : '';
    return `
        <a href="${encodeURIComponent(u.id)}/" data-util-id="${escapeHtml(u.id)}">
            <button class="primary">
                <span class="material-symbols-outlined" aria-hidden="true">${escapeHtml(u.icon)}</span>
                <span>${escapeHtml(u.name)}</span>
            </button>
        </a>
        <p><span class="group">${escapeHtml(u.group)}</span> ${escapeHtml(u.description)}${tag}</p>
    `;
}

function readRecent() {
    try {
        const raw = localStorage.getItem(RECENT_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr.filter((v) => typeof v === 'string') : [];
    } catch {
        return [];
    }
}

function writeRecent(ids) {
    try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, RECENT_MAX)));
    } catch {
        // ignore quota / disabled storage
    }
}

function trackRecent(id) {
    const current = readRecent().filter((x) => x !== id);
    current.unshift(id);
    writeRecent(current);
}

function render() {
    const query = searchInput.value.trim();
    const filtered = utils.filter((u) => matches(u, query));

    const recentIds = readRecent().slice(0, RECENT_MAX);
    const recentSet = new Set(recentIds);
    const recent = recentIds
        .map((id) => filtered.find((u) => u.id === id))
        .filter(Boolean);
    const rest = filtered.filter((u) => !recentSet.has(u.id));

    listEl.innerHTML = [
        ...recent.map((u) => renderRow(u, true)),
        ...rest.map((u) => renderRow(u, false)),
    ].join('');

    noResultsEl.hidden = filtered.length > 0;
}

function handleUtilClick(e) {
    const anchor = e.target.closest('a[data-util-id]');
    if (!anchor) return;
    trackRecent(anchor.dataset.utilId);
}

searchInput.addEventListener('input', render);
listEl.addEventListener('click', handleUtilClick);

fetch('util-registry.json')
    .then((r) => r.json())
    .then((data) => {
        utils = data
            .slice()
            .sort((a, b) =>
                (a.group + a.name).localeCompare(b.group + b.name)
            );
        render();
    })
    .catch((err) => {
        console.error('Failed to load util registry:', err);
        listEl.innerHTML =
            '<p>Failed to load utilities. Please try again later.</p>';
    });