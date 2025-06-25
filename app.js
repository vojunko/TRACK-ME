/*************************************************************************
 * KONFIGURACE
 *************************************************************************/
const CLIENT_ID = 'e4f69f9108aa4e72bc268fffab71b7fb';  // <-- Zde vlož svoje Client ID
const REDIRECT_URI = 'https://v-track-me.vercel.app'; // Tvůj redirect URI
const SCOPES = [
  'user-top-read',
  'user-read-recently-played',
  'user-read-private',
  'user-read-email'
].join(' ');

let codeVerifier = null;
let accessToken = null;
let userProfile = null;

// Výchozí time_range
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
  $(`#${id}`).classList.add('active');
  document.querySelector(`.tab[data-target="${id}"]`).classList.add('active');
}

/*************************************************************************
 * PKCE HELPER
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
  const array = new Uint32Array(56 / 2);
  window.crypto.getRandomValues(array);
  return Array.from(array, dec => ('0' + dec.toString(16)).substr(-2)).join('');
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
  const codeVerifier = localStorage.getItem('code_verifier');
  if (!codeVerifier) throw new Error('Code verifier not found in localStorage');

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: REDIRECT_URI,
    code_verifier: codeVerifier,
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
  return data.access_token;
}

function handleRedirect() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('error')) {
    toast(`Chyba při přihlášení: ${params.get('error')}`);
    history.replaceState(null, '', REDIRECT_URI);
    return false;
  }
  if (params.has('code')) {
    const code = params.get('code');
    history.replaceState(null, '', REDIRECT_URI);
    return code;
  }
  return null;
}

/*************************************************************************
 * FETCH UŽIVATELSKÝCH DAT
 *************************************************************************/
async function fetchUserProfile() {
  try {
    const res = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    if (res.status === 403) {
      throw new Error('Nemáte potřebná oprávnění. Prosím, odhlaste se a znovu se přihlaste.');
    }
    
    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.error?.message || 'Nepodařilo se načíst profil uživatele');
    }
    
    return await res.json();
  } catch (error) {
    console.error('Chyba při načítání profilu:', error);
    throw error;
  }
}

async function fetchUserTop(type, limit = 50) {
  try {
    const url = `https://api.spotify.com/v1/me/top/${type}?limit=${limit}&time_range=${timeRange}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    if (res.status === 403) {
      throw new Error('Nemáte oprávnění k této funkci. Prosím, odhlaste se a znovu se přihlaste.');
    }
    
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error?.message || `Failed to load top ${type}`);
    }
    
    return await res.json();
  } catch (error) {
    console.error(`Error fetching top ${type}:`, error);
    throw error;
  }
}

async function fetchRecentlyPlayed(limit = 50) {
  try {
    const url = `https://api.spotify.com/v1/me/player/recently-played?limit=${limit}`;
    const res = await fetch(url, {
      headers: { 
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (res.status === 403) {
      throw new Error('Prosím odhlaste se a znovu se přihlaste pro udělení potřebných oprávnění');
    }
    
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error?.message || 'Failed to load recently played');
    }
    
    return await res.json();
  } catch (error) {
    console.error('Recently played error:', error);
    throw error;
  }
}

async function fetchUserTopTracks(limit = 50) {
  return await fetchUserTop('tracks', limit);
}

async function checkTokenValidity() {
  try {
    const res = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Z top tracků sestaví top alba (dle frekvence)
 */
async function fetchUserTopAlbumsFromTracks(limit = 50) {
  const topTracksData = await fetchUserTopTracks(50);

  const albumMap = new Map();
  topTracksData.items.forEach(track => {
    const album = track.album;
    if (!albumMap.has(album.id)) {
      albumMap.set(album.id, { album, count: 1 });
    } else {
      albumMap.get(album.id).count++;
    }
  });

  const sortedAlbums = [...albumMap.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map(item => item.album);

  return { items: sortedAlbums };
}

/**
 * Z umělců vyextrahuje top žánry (10 nejčastějších)
 */
function extractTopGenres(artists) {
  const genreCounts = {};
  artists.forEach(artist => {
    artist.genres.forEach(g => {
      genreCounts[g] = (genreCounts[g] || 0) + 1;
    });
  });

  const sortedGenres = Object.entries(genreCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(g => g[0]);

  return sortedGenres;
}

/*************************************************************************
 * RENDER FUNKCE (přidán link na Spotify u všech výsledků)
 *************************************************************************/
function renderTopArtists(artists) {
  const box = $('#artists-list');
  box.innerHTML = '';
  artists.forEach((a, i) => {
    const url = a.external_urls.spotify || `https://open.spotify.com/artist/${a.id}`;
    box.insertAdjacentHTML('beforeend',
      `<article class="card" style="cursor:pointer" onclick="window.open('${url}','_blank')">
        <img src="${a.images[1]?.url || a.images[0]?.url || ''}" alt="Artist image">
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
    const url = a.external_urls.spotify || `https://open.spotify.com/album/${a.id}`;
    box.insertAdjacentHTML('beforeend',
      `<article class="card" style="cursor:pointer" onclick="window.open('${url}','_blank')">
        <img src="${a.images[1]?.url || a.images[0]?.url || ''}" alt="Album image">
        <div>
          <h3>${i + 1}. ${a.name}</h3>
          <p class="small">Release date: ${a.release_date}</p>
          <p class="small">Artists: ${a.artists.map(artist => artist.name).join(', ')}</p>
        </div>
      </article>`);
  });
}

function renderTopTracks(tracks) {
  const box = $('#tracks-list');
  box.innerHTML = '';
  tracks.forEach((t, i) => {
    const url = t.external_urls.spotify || `https://open.spotify.com/track/${t.id}`;
    box.insertAdjacentHTML('beforeend',
      `<article class="card" style="cursor:pointer" onclick="window.open('${url}','_blank')">
        <img src="${t.album.images[1]?.url || t.album.images[0]?.url || ''}" alt="Track image">
        <div>
          <h3>${i + 1}. ${t.name}</h3>
          <p class="small">Artists: ${t.artists.map(artist => artist.name).join(', ')}</p>
          <p class="small">Album: ${t.album.name}</p>
          <p class="small">Duration: ${msToMinutesSeconds(t.duration_ms)}</p>
        </div>
      </article>`);
  });
}

function renderRecentlyPlayed(tracks) {
  const box = $('#recent-list');
  box.innerHTML = '';
  tracks.forEach((item, i) => {
    const t = item.track;
    const url = t.external_urls.spotify || `https://open.spotify.com/track/${t.id}`;
    box.insertAdjacentHTML('beforeend',
      `<article class="card" style="cursor:pointer" onclick="window.open('${url}','_blank')">
        <img src="${t.album.images[1]?.url || t.album.images[0]?.url || ''}" alt="Track image">
        <div>
          <h3>${i + 1}. ${t.name}</h3>
          <p class="small">Artists: ${t.artists.map(artist => artist.name).join(', ')}</p>
          <p class="small">Album: ${t.album.name}</p>
          <p class="small">Duration: ${msToMinutesSeconds(t.duration_ms)}</p>
          <p class="small">Played at: ${new Date(item.played_at).toLocaleString()}</p>
        </div>
      </article>`);
  });
}

function renderTopGenres(genres) {
  const box = $('#genres-list');
  box.innerHTML = '';
  genres.forEach((g, i) => {
    box.insertAdjacentHTML('beforeend',
      `<article class="card genre-card" title="Top žánr #${i + 1}">
        <h3>${i + 1}. ${g}</h3>
      </article>`);
  });
}

function renderError(message, showLogoutButton = true) {
  return `
    <div style="grid-column:1/-1; text-align:center; color:#ff6b6b;">
      <p>${message}</p>
      ${showLogoutButton ? `
        <button onclick="logout()" class="btn" style="margin-top:1rem;">
          Odhlásit se a znovu přihlásit
        </button>
      ` : ''}
    </div>
  `;
}

/*************************************************************************
 * HELPER: převod milisekund na minuty a sekundy
 *************************************************************************/
function msToMinutesSeconds(ms) {
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

/*************************************************************************
 * Hlavní načtení uživatelských dat dle timeRange
 *************************************************************************/
async function loadUserData() {
  $('#login-prompt').style.display = 'none';
  $('#user-section').hidden = false;
  $('#login-btn').style.display = 'none';
  $('#logout-btn').style.display = 'inline-block';
  if (!accessToken) return;

  try {
    // Zkontroluj platnost tokenu
    const isValid = await checkTokenValidity();
    if (!isValid) {
      logout();
      toast('Session expirovala. Prosím přihlaste se znovu.');
      return;
    }

    // Načíst profil uživatele
    userProfile = await fetchUserProfile();

    // Zobraz uživatele vlevo nahoře
    const userInfo = $('#user-info');
    userInfo.innerHTML = 
      `<img src="${userProfile.images?.[0]?.url || ''}" alt="User avatar" style="width:40px; height:40px; border-radius:50%; margin-right:0.5rem;">
      <span>${userProfile.display_name}</span>`;

    userInfo.style.cursor = 'pointer';
    userInfo.title = 'Otevřít Spotify profil';

    userInfo.onclick = () => {
      const url = userProfile.external_urls?.spotify || `https://open.spotify.com/user/${userProfile.id}`;
      window.open(url, '_blank');
    };

    // Načti a vykresli top data
    const [artistsData, albumsData, tracksData] = await Promise.all([
      fetchUserTop('artists').catch(e => {
        $('#artists-list').innerHTML = renderError(`Chyba při načítání top umělců: ${e.message}`);
        return { items: [] };
      }),
      fetchUserTopAlbumsFromTracks().catch(e => {
        $('#albums-list').innerHTML = renderError(`Chyba při načítání top alb: ${e.message}`);
        return { items: [] };
      }),
      fetchUserTopTracks().catch(e => {
        $('#tracks-list').innerHTML = renderError(`Chyba při načítání top skladeb: ${e.message}`);
        return { items: [] };
      })
    ]);

    if (artistsData.items.length > 0) {
      renderTopArtists(artistsData.items);
      const topGenres = extractTopGenres(artistsData.items);
      renderTopGenres(topGenres);
    }

    if (albumsData.items.length > 0) {
      renderTopAlbums(albumsData.items);
    }

    if (tracksData.items.length > 0) {
      renderTopTracks(tracksData.items);
    }

    // Načti nedávno přehrávané skladby
    try {
      const recentData = await fetchRecentlyPlayed();
      renderRecentlyPlayed(recentData.items);
    } catch (recentError) {
      console.error('Error loading recently played:', recentError);
      $('#recent-list').innerHTML = renderError(`Nepodařilo se načíst nedávno přehrávané skladby: ${recentError.message}`);
    }

  } catch (e) {
    console.error('Hlavní chyba při načítání dat:', e);
    toast('Chyba při načítání dat: ' + e.message);
    if (e.message.includes('401') || e.message.includes('403')) {
      $('#user-section').innerHTML = renderError('Vaše session expirovala nebo nemáte potřebná oprávnění. Prosím přihlaste se znovu.');
    }
  }
}

/*************************************************************************
 * INICIALIZACE
 *************************************************************************/
async function init() {
  const code = handleRedirect();

  if (code) {
    try {
      const token = await getAccessToken(code);
      accessToken = token;
      localStorage.setItem('access_token', token);
      await loadUserData();
    } catch (err) {
      console.error('Chyba při přihlašování:', err);
      toast('Chyba přihlášení: ' + err.message);
      logout();
    }
  } else {
    accessToken = localStorage.getItem('access_token');
    if (accessToken) {
      try {
        await loadUserData();
      } catch (e) {
        console.error('Chyba při načítání uložené session:', e);
        logout();
      }
    }
  }

  // Přepínání panelů
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', e => {
      switchPanel(btn.dataset.target);
    });
  });

  // Dropdown pro time_range
  const timeRangeSelect = document.querySelector('#time-range-select');
  if (timeRangeSelect) {
    timeRangeSelect.addEventListener('change', async e => {
      timeRange = e.target.value;
      await loadUserData();
    });
  }
}

// Po načtení DOM spustíme init
document.addEventListener('DOMContentLoaded', init);

/*************************************************************************
 * Odkaz na přihlášení
 *************************************************************************/
$('#login-btn').addEventListener('click', login);
$('#logout-btn').addEventListener('click', logout);
$('#login-btn-prompt').addEventListener('click', login);
