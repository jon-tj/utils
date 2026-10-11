const STORAGE_KEY = 'joel-piss-counter';

const MOODS = [
    [0, 'No pees yet today. Hydrate, Joel! 🥤'],
    [1, 'First tinkle of the day! 🌅'],
    [3, 'Joel is warming up 🚿'],
    [5, 'A healthy little bladder 💛'],
    [8, 'Joel is a fountain ⛲'],
    [12, 'Has Joel considered seeing a doctor? 🩺'],
    [20, 'JOEL IS A WATERFALL 🌊🌊🌊'],
];

const btnPee = document.getElementById('btn-pee');
const btnUndo = document.getElementById('btn-undo');
const btnReset = document.getElementById('btn-reset');
const historyList = document.getElementById('history-list');
const bubbles = document.querySelector('.bubbles');
const slot = (name) => document.querySelector(`[data-slot="${name}"]`);

function load() {
    try {
        const pees = JSON.parse(localStorage.getItem(STORAGE_KEY));
        return Array.isArray(pees) ? pees : [];
    } catch {
        return [];
    }
}

function save(pees) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pees));
}

function dayKey(timestamp) {
    const d = new Date(timestamp);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${month}-${day}`;
}

function countByDay(pees) {
    const counts = new Map();
    for (const t of pees) {
        const key = dayKey(t);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
}

function moodFor(count) {
    let mood = MOODS[0][1];
    for (const [threshold, text] of MOODS) {
        if (count >= threshold) mood = text;
    }
    return mood;
}

function timeAgo(timestamp) {
    const minutes = Math.floor((Date.now() - timestamp) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
    return `${Math.floor(hours / 24)} days ago`;
}

function formatDay(key) {
    if (key === dayKey(Date.now())) return 'Today';
    if (key === dayKey(Date.now() - 86400000)) return 'Yesterday';
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function render() {
    const pees = load();
    const counts = countByDay(pees);
    const today = counts.get(dayKey(Date.now())) ?? 0;

    slot('today').textContent = today;
    slot('total').textContent = pees.length;
    slot('best').textContent = Math.max(0, ...counts.values());
    slot('mood').textContent = moodFor(today);
    slot('last').textContent = pees.length ? `Last pee: ${timeAgo(pees[pees.length - 1])}` : '';
    btnUndo.disabled = pees.length === 0;

    historyList.innerHTML = '';
    if (counts.size === 0) {
        const li = document.createElement('li');
        li.className = 'empty';
        li.textContent = 'The diary is empty... for now 👀';
        historyList.append(li);
        return;
    }
    const days = [...counts.entries()].sort(([a], [b]) => b.localeCompare(a)).slice(0, 14);
    for (const [key, count] of days) {
        const li = document.createElement('li');
        li.innerHTML = `
            <span class="history-date">${formatDay(key)}</span>
            <span class="history-drops">${'💧'.repeat(Math.min(count, 20))}</span>
            <span class="history-count">${count}</span>
        `;
        historyList.append(li);
    }
}

function splash() {
    const rect = btnPee.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const emojis = ['💧', '💦', '✨', '💛'];
    for (let i = 0; i < 10; i++) {
        const el = document.createElement('span');
        el.className = 'splash';
        el.textContent = emojis[i % emojis.length];
        const angle = (Math.PI * 2 * i) / 10;
        el.style.left = `${cx}px`;
        el.style.top = `${cy}px`;
        el.style.setProperty('--dx', `${Math.cos(angle) * 140}px`);
        el.style.setProperty('--dy', `${Math.sin(angle) * 140}px`);
        bubbles.append(el);
        el.addEventListener('animationend', () => el.remove());
    }
    btnPee.classList.remove('boing');
    void btnPee.offsetWidth;
    btnPee.classList.add('boing');
}

btnPee.addEventListener('click', () => {
    const pees = load();
    pees.push(Date.now());
    save(pees);
    splash();
    render();
});

btnUndo.addEventListener('click', () => {
    const pees = load();
    pees.pop();
    save(pees);
    render();
});

btnReset.addEventListener('click', () => {
    if (confirm("Erase all of Joel's pee history? 😱")) {
        save([]);
        render();
    }
});

setInterval(render, 60000);
render();
