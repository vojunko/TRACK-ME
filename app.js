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

function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.style.backgroundColor = isError ? '#ff6b6b' : '#4CAF50';
  t.style.opacity = 1;
  setTimeout(() => t.style.opacity = 0, 5000);
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
  try {
    codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);

    localStorage.setItem('code_verifier', codeVerifier);

    const authUrl = new URL('https://accounts.spotify.com/authorize');
    authUrl.searchParams.append('client_id', CLIENT_ID);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('redirect_uri', REDIRECT_URI);
    authUrl.searchParams.append('scope', SCOPES);
    authUrl.searchParams.append('code_challenge_method', 'S256');
    authUrl.searchParams.append('code_challenge', codeChallenge);
    authUrl.searchParams.append('show_dialog', 'true');

    window.location.href = authUrl.toString();
  } catch (error) {
    toast('Chyba při přípravě přihlášení: ' + error.message, true);
  }
}

function logout() {
  accessToken = null;
  userProfile = null;
  localStorage.removeItem('access_token');
  localStorage.removeItem('code_verifier');
  $('#user-section').hidden = true;
  $('#login-prompt').style.display = 'flex';
  $('#user-info').innerHTML = '';
}

async function getAccessToken(code) {
  try {
    const codeVerifier = localStorage.getItem('code_verifier');
    if (!codeVerifier) throw new Error('Chybějící code verifier');

    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    });

    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error_description || error.error || 'Nepodařilo se získat token');
    }

    const data = await response.json();
    return data.access_token;
  } catch (error) {
    console.error('Chyba při získávání tokenu:', error);
    throw error;
  }
}

function handleRedirect() {
  const params = new URLSearchParams(window.location.search);
  
  if (params.has('error')) {
    toast(`Chyba přihlášení: ${params.get('error')}`, true);
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
 * SPRÁVA TOKENU A OPRAVNĚNÍ
 *************************************************************************/
async function checkTokenValidity() {
  if (!accessToken) {
    throw new Error('Token není k dispozici');
  }
  try {
    const response = await fetch('https://api.spotify.com/v1/me', {
      headers: { 
        'Authorization': `Bearer ${accessToken}`
      }
    });

    const text = await response.text();

    if (!response.ok) {
      // Pokusíme se získat JSON z textu, pokud to jde
      try {
        const error = JSON.parse(text);
        throw new Error(error.error?.message || 'Chyba autorizace');
      } catch {
        // Pokud není JSON, zobrazíme raw text - často HTML s chybou
        throw new Error(`Chyba autorizace: ${text.substring(0, 100)}`);
      }
    }

    // Pokud OK, můžeme vrátit true
    return true;
  } catch (error) {
    console.error('Kontrola tokenu selhala:', error);
    throw error;
  }
}

/*************************************************************************
 * NAČÍTÁNÍ DAT Z API
 *************************************************************************/
async function fetchWithAuth(url, errorMessage) {
  try {
    const response = await fetch(url, {
      headers: { 
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.status === 401) {
      throw new Error('Session expirovala. Přihlaste se znovu.');
    }

    if (response.status === 403) {
      throw new Error('Chybí potřebná oprávnění. Odhlaste se a přihlaste znovu.');
    }

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || errorMessage);
    }

    return await response.json();
  } catch (error) {
    console.error('Chyba při načítání dat:', error);
    throw error;
  }
}

async function fetchUserProfile() {
  return await fetchWithAuth(
    'https://api.spotify.com/v1/me',
    'Nepodařilo se načíst profil uživatele'
  );
}

async function fetchUserTop(type, limit = 50) {
  return await fetchWithAuth(
    `https://api.spotify.com/v1/me/top/${type}?limit=${limit}&time_range=${timeRange}`,
    `Nepodařilo se načíst top ${type}`
  );
}

async function fetchRecentlyPlayed(limit = 50) {
  return await fetchWithAuth(
    `https://api.spotify.com/v1/me/player/recently-played?limit=${limit}`,
    'Nepodařilo se načíst nedávno přehrávané skladby'
  );
}

async function fetchUserTopTracks(limit = 50) {
  return await fetchUserTop('tracks', limit);
}

async function fetchUserTopAlbumsFromTracks(limit = 50) {
  const topTracksData = await fetchUserTopTracks(50);
  const albumMap = new Map();

  topTracksData.items.forEach(track => {
    const album = track.album;
    albumMap.set(album.id, albumMap.has(album.id) 
      ? { ...albumMap.get(album.id), count: albumMap.get(album.id).count + 1 }
      : { album, count: 1 }
    );
  });

  return {
    items: [...albumMap.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
      .map(item => item.album)
  };
}

function extractTopGenres(artists) {
  const genreCounts = artists.reduce((acc, artist) => {
    artist.genres.forEach(genre => {
      acc[genre] = (acc[genre] || 0) + 1;
    });
    return acc;
  }, {});

  return Object.entries(genreCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(entry => entry[0]);
}

/*************************************************************************
 * RENDEROVÁNÍ UI
 *************************************************************************/
function renderError(message, showLogout = true) {
  return `
    <div class="error-container">
      <h3>Nastala chyba</h3>
      <p>${message}</p>
      ${showLogout ? `
        <button onclick="logout()" class="btn error-btn">
          <i class="icon-logout"></i> Odhlásit se
        </button>
        <p class="help-text">
          Po odhlášení se ujistěte, že při přihlašování povolíte všechna požadovaná oprávnění.
        </p>
      ` : ''}
    </div>
  `;
}

function renderProfile(profile) {
  $('#user-info').innerHTML = `
    <img src="${profile.images?.[0]?.url || ''}" 
         alt="Profilová fotka" 
         class="profile-img">
    <span>${profile.display_name || 'Uživatel'}</span>
  `;
  
  $('#user-info').onclick = () => {
    window.open(profile.external_urls?.spotify || '#', '_blank');
  };
}

function renderList(items, containerId, templateFn) {
  const container = $(`#${containerId}`);
  container.innerHTML = items.length > 0 
    ? items.map(templateFn).join('') 
    : '<p class="no-data">Žádná data k zobrazení</p>';
}

function renderTopArtists(artists) {
  renderList(artists, 'artists-list', (artist, index) => `
    <article class="card" onclick="window.open('${artist.external_urls.spotify}', '_blank')">
      <img src="${artist.images[1]?.url || artist.images[0]?.url || ''}" 
           alt="${artist.name}">
      <div>
        <h3>${index + 1}. ${artist.name}</h3>
        <p class="small">Sledujících: ${artist.followers.total.toLocaleString()}</p>
        <p class="small">Žánry: ${artist.genres.slice(0, 3).join(', ') || '–'}</p>
      </div>
    </article>
  `);
}

function renderTopAlbums(albums) {
  renderList(albums, 'albums-list', (album, index) => `
    <article class="card" onclick="window.open('${album.external_urls.spotify}', '_blank')">
      <img src="${album.images[1]?.url || album.images[0]?.url || ''}" 
           alt="${album.name}">
      <div>
        <h3>${index + 1}. ${album.name}</h3>
        <p class="small">Datum vydání: ${album.release_date}</p>
        <p class="small">Umělci: ${album.artists.map(a => a.name).join(', ')}</p>
      </div>
    </article>
  `);
}

function renderTopTracks(tracks) {
  renderList(tracks, 'tracks-list', (track, index) => `
    <article class="card" onclick="window.open('${track.external_urls.spotify}', '_blank')">
      <img src="${track.album.images[1]?.url || track.album.images[0]?.url || ''}" 
           alt="${track.name}">
      <div>
        <h3>${index + 1}. ${track.name}</h3>
        <p class="small">Umělci: ${track.artists.map(a => a.name).join(', ')}</p>
        <p class="small">Album: ${track.album.name}</p>
        <p class="small">Délka: ${msToMinutesSeconds(track.duration_ms)}</p>
      </div>
    </article>
  `);
}

function renderRecentlyPlayed(tracks) {
  renderList(tracks, 'recent-list', (item, index) => {
    const track = item.track;
    return `
      <article class="card" onclick="window.open('${track.external_urls.spotify}', '_blank')">
        <img src="${track.album.images[1]?.url || track.album.images[0]?.url || ''}" 
             alt="${track.name}">
        <div>
          <h3>${index + 1}. ${track.name}</h3>
          <p class="small">Umělci: ${track.artists.map(a => a.name).join(', ')}</p>
          <p class="small">Album: ${track.album.name}</p>
          <p class="small">Přehráno: ${new Date(item.played_at).toLocaleString()}</p>
        </div>
      </article>
    `;
  });
}

function renderTopGenres(genres) {
  renderList(genres, 'genres-list', (genre, index) => `
    <article class="card genre-card">
      <h3>${index + 1}. ${genre}</h3>
    </article>
  `);
}

function msToMinutesSeconds(ms) {
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}:${seconds.padStart(2, '0')}`;
}

/*************************************************************************
 * HLAVNÍ LOGIKA APLIKACE
 *************************************************************************/
async function loadUserData() {
  try {
    $('#login-prompt').style.display = 'none';
    $('#user-section').hidden = false;
    $('#loading-spinner').style.display = 'block';

    // Kontrola platnosti tokenu a oprávnění
    try {
      await checkTokenValidity();
      
      const hasPermissions = await verifyPermissions();
      if (!hasPermissions) throw new Error('Chybí potřebná oprávnění');
    } catch (error) {
      $('#user-section').innerHTML = renderError(error.message);
      throw error;
    }

    // Načtení profilu uživatele
    userProfile = await fetchUserProfile();
    renderProfile(userProfile);

    // Paralelní načítání všech dat
    const [artists, albums, tracks, recent] = await Promise.all([
      fetchUserTop('artists').catch(e => {
        $('#artists-list').innerHTML = renderError(e.message, false);
        return { items: [] };
      }),
      fetchUserTopAlbumsFromTracks().catch(e => {
        $('#albums-list').innerHTML = renderError(e.message, false);
        return { items: [] };
      }),
      fetchUserTopTracks().catch(e => {
        $('#tracks-list').innerHTML = renderError(e.message, false);
        return { items: [] };
      }),
      fetchRecentlyPlayed().catch(e => {
        $('#recent-list').innerHTML = renderError(e.message, false);
        return { items: [] };
      })
    ]);

    // Renderování dat
    if (artists.items.length > 0) {
      renderTopArtists(artists.items);
      renderTopGenres(extractTopGenres(artists.items));
    }

    if (albums.items.length > 0) renderTopAlbums(albums.items);
    if (tracks.items.length > 0) renderTopTracks(tracks.items);
    if (recent.items.length > 0) renderRecentlyPlayed(recent.items);

  } catch (error) {
    console.error('Hlavní chyba:', error);
    toast(error.message, true);
    
    if (error.message.includes('401') || error.message.includes('403')) {
      $('#user-section').innerHTML = renderError(
        'Pro pokračování se prosím odhlaste a přihlaste znovu se všemi oprávněními.',
        true
      );
    }
  } finally {
    $('#loading-spinner').style.display = 'none';
  }
}

async function init() {
  try {
    const code = handleRedirect();
    
    if (code) {
      accessToken = await getAccessToken(code);
      localStorage.setItem('access_token', accessToken);
      await loadUserData();
    } else {
      accessToken = localStorage.getItem('access_token');
      if (accessToken) {
        await loadUserData();
      } else {
        // Token není, ukážeme přihlašovací výzvu
        $('#login-prompt').style.display = 'flex';
        $('#user-section').hidden = true;
      }
    }
  } catch (error) {
    console.error('Inicializační chyba:', error);
    toast('Chyba při spuštění aplikace: ' + error.message, true);
  }

  // Event listeners
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchPanel(tab.dataset.target));
  });

  $('#time-range-select')?.addEventListener('change', async (e) => {
    timeRange = e.target.value;
    await loadUserData();
  });

  $('#login-btn').addEventListener('click', login);
  $('#logout-btn').addEventListener('click', logout);
  $('#login-btn-prompt').addEventListener('click', login);
}

// Spuštění aplikace
document.addEventListener('DOMContentLoaded', init);
