/*************************************************************************
 * KONFIGURACE
 *************************************************************************/
const CLIENT_ID = 'e4f69f9108aa4e72bc268fffab71b7fb';
const REDIRECT_URI = 'https://v-track-me.vercel.app';
const SCOPES = [
  'user-top-read',
  'user-read-recently-played',
  'user-read-private',
  'user-read-email'
].join(' ');

let codeVerifier = null;
let accessToken = null;
let userProfile = null;
let timeRange = 'medium_term';

/*************************************************************************
 * POMOCNÉ FUNKCE
 *************************************************************************/
const $ = s => document.querySelector(s);

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.style.opacity = 1;
  setTimeout(() => t.style.opacity = 0, 3000);
}

function switchPanel(id) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelector(`.tab[data-target="${id}"]`).classList.add('active');
}

function msToMinutesSeconds(ms) {
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

/*************************************************************************
 * PKCE
 *************************************************************************/
function base64encode(str) {
  return btoa(String.fromCharCode.apply(null, new Uint8Array(str)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generateCodeChallenge(codeVerifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64encode(digest);
}

function generateCodeVerifier() {
  const array = new Uint32Array(28);
  crypto.getRandomValues(array);
  return Array.from(array, dec => ('0' + dec.toString(16)).slice(-2)).join('');
}

/*************************************************************************
 * AUTORIZACE
 *************************************************************************/
async function login() {
  codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  localStorage.setItem('code_verifier', codeVerifier);

  const url = new URL('https://accounts.spotify.com/authorize');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('show_dialog', 'true');

  window.location = url.toString();
}

function logout() {
  accessToken = null;
  userProfile = null;
  localStorage.removeItem('access_token');
  localStorage.removeItem('code_verifier');
  $('#user-section').hidden = true;
  $('#login-prompt').style.display = 'flex';
  $('#login-btn').style.display = 'none';
  $('#user-info').innerHTML = '';
  $('#logout-btn').style.display = 'none';
}

async function getAccessToken(code) {
  const verifier = localStorage.getItem('code_verifier');
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Token request failed: ${err.error_description || err.error}`);
  }

  const data = await res.json();
  localStorage.setItem('access_token', data.access_token);
  return data.access_token;
}

function handleRedirect() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('code')) {
    const code = params.get('code');
    history.replaceState(null, '', REDIRECT_URI);
    return code;
  }
  return null;
}

/*************************************************************************
 * API FUNKCE
 *************************************************************************/
async function fetchUserProfile() {
  const res = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error('Nepodařilo se načíst profil uživatele');
  return await res.json();
}

async function fetchUserTop(type, limit = 50) {
  const res = await fetch(`https://api.spotify.com/v1/me/top/${type}?limit=${limit}&time_range=${timeRange}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error(`Failed to load top ${type}`);
  return await res.json();
}

async function fetchRecentlyPlayed(limit = 50) {
  const res = await fetch(`https://api.spotify.com/v1/me/player/recently-played?limit=${limit}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error('Failed to load recently played');
  return await res.json();
}

async function fetchUserTopAlbumsFromTracks(limit = 50) {
  const topTracks = await fetchUserTop('tracks', 50);
  const albumMap = new Map();

  topTracks.items.forEach(track => {
    const album = track.album;
    if (!albumMap.has(album.id)) {
      albumMap.set(album.id, { album, count: 1 });
    } else {
      albumMap.get(album.id).count++;
    }
  });

  const sorted = [...albumMap.values()].sort((a, b) => b.count - a.count).slice(0, limit);
  return { items: sorted.map(x => x.album) };
}

function extractTopGenres(artists) {
  const genres = {};
  artists.forEach(artist => {
    artist.genres.forEach(g => {
      genres[g] = (genres[g] || 0) + 1;
    });
  });
  return Object.entries(genres).sort((a, b) => b[1] - a[1]).slice(0, 10).map(g => g[0]);
}

/*************************************************************************
 * RENDER
 *************************************************************************/
function renderTopArtists(artists) {
  const box = $('#artists-list');
  box.innerHTML = '';
  artists.forEach((a, i) => {
    const url = a.external_urls.spotify;
    box.insertAdjacentHTML('beforeend', `
      <article class="card" onclick="window.open('${url}', '_blank')">
        <img src="${a.images[1]?.url || a.images[0]?.url || ''}" alt="">
        <div>
          <h3>${i + 1}. ${a.name}</h3>
          <p class="small">Followers: ${a.followers.total.toLocaleString()}</p>
          <p class="small">Genres: ${a.genres.join(', ')}</p>
        </div>
      </article>`);
  });
}

function renderTopAlbums(albums) {
  const box = $('#albums-list');
  box.innerHTML = '';
  albums.forEach((a, i) => {
    const url = a.external_urls.spotify;
    box.insertAdjacentHTML('beforeend', `
      <article class="card" onclick="window.open('${url}', '_blank')">
        <img src="${a.images[1]?.url || a.images[0]?.url || ''}" alt="">
        <div>
          <h3>${i + 1}. ${a.name}</h3>
          <p class="small">Release date: ${a.release_date}</p>
          <p class="small">Artists: ${a.artists.map(ar => ar.name).join(', ')}</p>
        </div>
      </article>`);
  });
}

function renderTopTracks(tracks) {
  const box = $('#tracks-list');
  box.innerHTML = '';
  tracks.forEach((t, i) => {
    const url = t.external_urls.spotify;
    box.insertAdjacentHTML('beforeend', `
      <article class="card" onclick="window.open('${url}', '_blank')">
        <img src="${t.album.images[1]?.url || t.album.images[0]?.url || ''}" alt="">
        <div>
          <h3>${i + 1}. ${t.name}</h3>
          <p class="small">Artists: ${t.artists.map(a => a.name).join(', ')}</p>
          <p class="small">Album: ${t.album.name}</p>
          <p class="small">Duration: ${msToMinutesSeconds(t.duration_ms)}</p>
        </div>
      </article>`);
  });
}

function renderRecentlyPlayed(data) {
  const box = $('#recent-list');
  box.innerHTML = '';
  data.items.forEach((item, i) => {
    const t = item.track;
    const url = t.external_urls.spotify;
    box.insertAdjacentHTML('beforeend', `
      <article class="card" onclick="window.open('${url}', '_blank')">
        <img src="${t.album.images[1]?.url || t.album.images[0]?.url || ''}" alt="">
        <div>
          <h3>${i + 1}. ${t.name}</h3>
          <p class="small">Artists: ${t.artists.map(a => a.name).join(', ')}</p>
          <p class="small">Album: ${t.album.name}</p>
        </div>
      </article>`);
  });
}

function renderGenres(genres) {
  const box = $('#genres-list');
  box.innerHTML = '';
  genres.forEach(g => {
    box.insertAdjacentHTML('beforeend', `<div class="genre-card">${g}</div>`);
  });
}

/*************************************************************************
 * INIT
 *************************************************************************/
async function loadData() {
  try {
    userProfile = await fetchUserProfile();
    $('#user-info').innerHTML = `<img src="${userProfile.images[0]?.url || ''}" alt="avatar" style="width:40px;border-radius:50%;margin-right:0.5rem;"><strong>${userProfile.display_name}</strong>`;
    $('#user-section').hidden = false;
    $('#login-prompt').style.display = 'none';
    $('#logout-btn').style.display = 'inline-block';

    const [artists, albums, tracks, recent] = await Promise.all([
      fetchUserTop('artists'),
      fetchUserTopAlbumsFromTracks(),
      fetchUserTop('tracks'),
      fetchRecentlyPlayed()
    ]);

    renderTopArtists(artists.items);
    renderTopAlbums(albums.items);
    renderTopTracks(tracks.items);
    renderRecentlyPlayed(recent);
    renderGenres(extractTopGenres(artists.items));
  } catch (err) {
    console.error(err);
    toast('Chyba při načítání dat');
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  const code = handleRedirect();
  if (code) {
    try {
      accessToken = await getAccessToken(code);
    } catch (e) {
      toast('Chyba při přihlášení');
      return;
    }
  } else {
    accessToken = localStorage.getItem('access_token');
  }

  if (accessToken) {
    await loadData();
  } else {
    $('#login-btn').style.display = 'inline-block';
  }

  // Event listeners
  $('#login-btn').onclick = login;
  $('#login-btn-prompt').onclick = login;
  $('#logout-btn').onclick = logout;

  document.querySelectorAll('.tab').forEach(btn =>
    btn.addEventListener('click', () => switchPanel(btn.dataset.target)));

  $('#time-range-select').addEventListener('change', async e => {
    timeRange = e.target.value;
    await loadData();
  });
});
