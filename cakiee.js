// ws/cakiee.js - move the basket, catch the right ingredients, bake your cake

const PATH = 'assets/';
const MAX_LIVES = 3;

// what each cake needs besides the shared ingredients (change the fruit count here)
const CAKES = {
    matcha:     { fruit: 'matcha-powder', cake: 'cake-matcha',     accent: '#a8c08a' },
    strawberry: { fruit: 'strawberry',    cake: 'cake-strawberry', accent: '#ffcdcb' },
    blueberry:  { fruit: 'blueberry',     cake: 'cake-blueberry',  accent: '#bcd1fb' },
};
const FRUITS = ['matcha-powder', 'strawberry', 'blueberry'];
const BAD = ['beetle', 'mouldy-flour', 'eggshell'];   // catching one = lose a heart

// how big each picture is drawn (1 = normal size)
const SIZE = {
    egg: 0.8, flour: 1.1, milk: 1.05, cream: 1.15,
    'matcha-powder': 1.1, strawberry: 0.85, blueberry: 0.8,
    beetle: 0.85, 'mouldy-flour': 0.85, eggshell: 0.8,
};
const NAMES = [...Object.keys(SIZE), 'basket', 'red-heart', 'grey-heart',
               'cake-matcha', 'cake-strawberry', 'cake-blueberry'];

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

const board = $('board');
const ctx = board.getContext('2d');
const gameScreen = $('gameScreen');

// ---------- pictures ----------
// The PNGs have empty space around the drawing. We cut that space away, so sizes and
// hit boxes match what you really see. (If the browser blocks it, we use the full picture.)
const art = {};   // name -> { pic, w, h, url }

function trim(img) {
    const full = { pic: img, w: img.naturalWidth, h: img.naturalHeight, url: img.src };
    try {
        const c = document.createElement('canvas');
        c.width = full.w;
        c.height = full.h;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        const data = g.getImageData(0, 0, c.width, c.height).data;
        let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
        for (let y = 0; y < c.height; y++) {
            for (let x = 0; x < c.width; x++) {
                if (data[(y * c.width + x) * 4 + 3] > 24) {
                    if (x < x0) x0 = x;
                    if (x > x1) x1 = x;
                    if (y < y0) y0 = y;
                    if (y > y1) y1 = y;
                }
            }
        }
        if (x1 < 0) return full;
        const w = x1 - x0 + 1, h = y1 - y0 + 1;
        const out = document.createElement('canvas');
        out.width = w;
        out.height = h;
        out.getContext('2d').drawImage(c, x0, y0, w, h, 0, 0, w, h);
        return { pic: out, w, h, url: out.toDataURL() };
    } catch (e) {
        return full;
    }
}

function loadArt(name) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => { art[name] = trim(img); resolve(); };
        img.onerror = () => {                         // missing file: show a grey box instead of crashing
            const c = document.createElement('canvas');
            c.width = c.height = 64;
            c.getContext('2d').fillStyle = '#ccc';
            c.getContext('2d').fillRect(0, 0, 64, 64);
            art[name] = { pic: c, w: 64, h: 64, url: c.toDataURL() };
            resolve();
        };
        img.src = PATH + name + '.png';
    });
}

const loaded = Promise.all(NAMES.map(loadArt));

// ---------- game state ----------
let state = 'select';            // select | play | win | lose
let cakeId, needs, got, lives;
let items, pops, spawnTimer, elapsed, last, raf;
let W = 0, H = 0, S = 60;        // screen size, and the base size of an ingredient
const basket = { x: 0, y: 0, w: 0, h: 0, target: 0, squash: 0 };
const keys = { left: false, right: false };

function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = board.clientWidth;
    H = board.clientHeight;
    board.width = W * dpr;
    board.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    S = clamp(Math.min(W, H) * 0.11, 52, 90);

    const a = art.basket;
    basket.w = clamp(W * 0.15, 120, 230);
    basket.h = basket.w * a.h / a.w;
    basket.y = H - basket.h - Math.max(10, H * 0.03);
    basket.target = clamp(basket.target, 0, W - basket.w);
    basket.x = clamp(basket.x, 0, W - basket.w);
}

window.addEventListener('resize', () => { if (!gameScreen.hidden) resize(); });

// ---------- start / restart ----------
function begin(id) {
    cakeId = id;
    const c = CAKES[id];
    needs = { egg: 3, milk: 2, [c.fruit]: 2, flour: 1, cream: 2 };   // 10 ingredients in total
    got = {};
    Object.keys(needs).forEach((k) => { got[k] = 0; });
    lives = MAX_LIVES;
    items = [];
    pops = [];
    spawnTimer = 0.4;
    elapsed = 0;
    document.body.style.setProperty('--accent', c.accent);

    $('selectScreen').hidden = true;
    $('overlay').hidden = true;
    gameScreen.hidden = false;
    resize();
    basket.x = basket.target = (W - basket.w) / 2;

    buildNeeds();
    renderLives(-1);
    state = 'play';
    last = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
}

document.querySelectorAll('.cake-card').forEach((btn) => {
    btn.addEventListener('click', () => loaded.then(() => begin(btn.dataset.cake)));
});

// ---------- HUD ----------
function buildNeeds() {
    const list = $('needs');
    list.innerHTML = '';
    Object.keys(needs).forEach((k) => {
        const li = document.createElement('li');
        li.dataset.k = k;
        const img = new Image();
        img.src = art[k].url;
        img.alt = k.replace('-', ' ');
        li.append(img, document.createElement('span'));
        list.append(li);
    });
    updateNeeds();
}

function updateNeeds() {
    document.querySelectorAll('#needs li').forEach((li) => {
        const left = needs[li.dataset.k] - got[li.dataset.k];
        li.querySelector('span').textContent = left > 0 ? '×' + left : '✓';
        li.classList.toggle('done', left <= 0);
    });
}

function renderLives(lostIndex) {
    const box = $('lives');
    box.innerHTML = '';
    for (let i = 0; i < MAX_LIVES; i++) {
        const img = new Image();
        img.src = art[i < lives ? 'red-heart' : 'grey-heart'].url;
        img.alt = '';
        if (i === lostIndex) img.className = 'hit';
        box.append(img);
    }
    box.setAttribute('aria-label', lives + ' of ' + MAX_LIVES + ' lives left');
}

// ---------- falling items ----------
function spawn() {
    const r = Math.random();
    let name;
    if (r < 0.55) {
        // an ingredient the cake needs; ones we still need appear 3x more often
        const pool = [];
        Object.keys(needs).forEach((k) => {
            for (let i = 0; i < (got[k] < needs[k] ? 3 : 1); i++) pool.push(k);
        });
        name = pick(pool);
    } else if (r < 0.75) {
        name = pick(FRUITS.filter((f) => f !== CAKES[cakeId].fruit));   // the wrong fruit
    } else {
        name = pick(BAD);
    }

    const a = art[name];
    const scale = (S * SIZE[name]) / Math.max(a.w, a.h);
    const w = a.w * scale, h = a.h * scale;
    items.push({
        name, a, w, h,
        x0: rand(w / 2 + 8, W - w / 2 - 8),
        x: 0, y: -h,
        vy: (110 + Math.random() * 50) * (H / 600) * (1 + Math.min(elapsed / 90, 0.5)),   // gets faster
        phase: rand(0, 6.28),
        amp: rand(0, 10),
        rot: 0,
    });
}

// the basket only catches things that land in its opening (the top part)
function inBasket(it) {
    const mx = basket.x + basket.w * 0.12, mw = basket.w * 0.76;
    const my = basket.y + basket.h * 0.05, mh = basket.h * 0.35;
    const iw = it.w * 0.7, ih = it.h * 0.7;
    return it.y + ih / 2 > my && it.y - ih / 2 < my + mh &&
           it.x + iw / 2 > mx && it.x - iw / 2 < mx + mw;
}

function onCatch(it) {
    basket.squash = 1;
    const name = it.name;
    if (BAD.includes(name)) return hurt('Yuck!', it);
    if (!(name in needs)) return hurt('Not needed!', it);
    if (got[name] >= needs[name]) return hurt('Too many!', it);

    got[name]++;
    updateNeeds();
    pop('+1', it.x, basket.y, '#5d7a4a');
    if (Object.keys(needs).every((k) => got[k] >= needs[k])) finish(true);
}

function hurt(text, it) {
    lives--;
    renderLives(lives);                    // the heart that was just lost has this index
    pop(text, it.x, basket.y, '#c0504d');
    gameScreen.classList.remove('shake');
    void gameScreen.offsetWidth;           // restart the shake animation
    gameScreen.classList.add('shake');
    if (lives <= 0) finish(false);
}

function pop(text, x, y, color) {
    pops.push({ text, x: clamp(x, 50, W - 50), y, t: 0, color });
}

// ---------- loop ----------
function update(dt) {
    elapsed += dt;

    const speed = W * 0.9;
    if (keys.left) basket.target -= speed * dt;
    if (keys.right) basket.target += speed * dt;
    basket.target = clamp(basket.target, 0, W - basket.w);
    basket.x += (basket.target - basket.x) * Math.min(1, 16 * dt);   // smooth movement
    basket.squash = Math.max(0, basket.squash - dt * 4);

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
        spawn();
        spawnTimer = Math.max(0.55, 0.95 - elapsed * 0.004);
    }

    for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        it.y += it.vy * dt;
        it.x = it.x0 + Math.sin(elapsed * 2 + it.phase) * it.amp;
        it.rot = Math.sin(elapsed * 2.5 + it.phase) * 0.2;
        if (inBasket(it)) {
            items.splice(i, 1);
            onCatch(it);
            if (state !== 'play') return;
        } else if (it.y - it.h / 2 > H) {
            items.splice(i, 1);            // fell on the floor
            if (it.name in needs && got[it.name] < needs[it.name]) {
                hurt('Missed!', it);       // a needed ingredient was missed = lose a heart
                if (state !== 'play') return;
            }
        }
    }

    pops.forEach((p) => { p.t += dt; p.y -= 40 * dt; });
    pops = pops.filter((p) => p.t < 1);
}

function draw() {
    ctx.clearRect(0, 0, W, H);

    items.forEach((it) => {
        ctx.save();
        ctx.translate(it.x, it.y);
        ctx.rotate(it.rot);
        ctx.drawImage(it.a.pic, -it.w / 2, -it.h / 2, it.w, it.h);
        ctx.restore();
    });

    // the basket is drawn after the items, so they disappear into it
    ctx.save();
    ctx.translate(basket.x + basket.w / 2, basket.y + basket.h);
    ctx.scale(1 + basket.squash * 0.08, 1 - basket.squash * 0.1);
    ctx.drawImage(art.basket.pic, -basket.w / 2, -basket.h, basket.w, basket.h);
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.font = '600 ' + Math.round(S * 0.34) + 'px Lora, Georgia, serif';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    pops.forEach((p) => {
        ctx.globalAlpha = 1 - p.t;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.strokeText(p.text, p.x, p.y);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, p.x, p.y);
    });
    ctx.globalAlpha = 1;
}

function loop(now) {
    if (state !== 'play') return;
    const dt = Math.min((now - last) / 1000, 0.05);   // never jump too far after a lag
    last = now;
    update(dt);
    draw();
    if (state === 'play') raf = requestAnimationFrame(loop);
}

// finishe - win / lose
function finish(win) {
    state = win ? 'win' : 'lose';
    keys.left = keys.right = false;
    draw();                                // show the last catch for a moment
    setTimeout(() => showResult(win), 600);
}

function showResult(win) {
    if (state === 'select') return;        // the player already pressed Back
    $('ovImg').src = art[win ? CAKES[cakeId].cake : 'mouldy-flour'].url;
    $('ovTitle').textContent = win ? 'Enjoy your cake!' : 'The cake is ruined';
    $('ovText').textContent = win ? '' : 'Watch out for bugs, mouldly flour and ingredients!';
    $('ovText').hidden = win;              // the win screen has no small text
    $('retryBtn').textContent = 'Try again';
    $('overlay').hidden = false;
    $('retryBtn').focus();
}

$('retryBtn').addEventListener('click', () => begin(cakeId));

$('menuBtn').addEventListener('click', () => {
    state = 'select';
    $('overlay').hidden = true;
    gameScreen.hidden = true;
    $('selectScreen').hidden = false;
});

// ---------- controls: mouse / finger, and arrow keys or A / D ----------
function moveTo(e) {
    if (state === 'play') basket.target = clamp(e.clientX - basket.w / 2, 0, W - basket.w);
}
gameScreen.addEventListener('pointermove', moveTo);
gameScreen.addEventListener('pointerdown', moveTo);

function setKey(e, down) {
    if (state !== 'play') return;
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { keys.left = down; e.preventDefault(); }
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { keys.right = down; e.preventDefault(); }
}
window.addEventListener('keydown', (e) => setKey(e, true));
window.addEventListener('keyup', (e) => setKey(e, false));

// ---------- title screen + Back button ----------
const titleScreen = $('titleScreen');
const backBtn = $('backBtn');

// Start -> select your cake
$('startBtn').addEventListener('click', () => {
    titleScreen.classList.add('leaving');                 // fade out
    setTimeout(() => {
        titleScreen.hidden = true;
        $('selectScreen').hidden = false;
        backBtn.hidden = false;
        document.querySelector('.cake-card').focus();     // keyboard users land on the first cake
    }, 500);
});

// Back -> stop the game (if playing) and return to the title screen
backBtn.addEventListener('click', () => {
    state = 'select';
    cancelAnimationFrame(raf);
    keys.left = keys.right = false;
    $('overlay').hidden = true;
    gameScreen.hidden = true;
    $('selectScreen').hidden = true;
    backBtn.hidden = true;
    titleScreen.classList.remove('leaving');
    titleScreen.hidden = false;
    $('startBtn').focus();
});