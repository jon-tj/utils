
const searchInput = document.getElementById('search');
const listEl = document.getElementById('utils-list');
const noResultsEl = document.getElementById('no-results');
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

function render() {
    const query = searchInput.value.trim();
    const filtered = utils.filter((u) => matches(u, query));

    listEl.innerHTML = filtered
        .map(
            (u) => `
                <a href="${encodeURIComponent(u.id)}/">
                    <button class="primary">
                        <span class="material-symbols-outlined" aria-hidden="true">${escapeHtml(u.icon)}</span>
                        <span>${escapeHtml(u.name)}</span>
                    </button>
                </a>
                <p><span class="group">${escapeHtml(u.group)}</span> ${escapeHtml(u.description)}</p>
            `
        )
        .join('');

    noResultsEl.hidden = filtered.length > 0;
}

searchInput.addEventListener('input', render);

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