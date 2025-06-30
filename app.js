/*************************************************************************
 * KONFIGURACE
 *************************************************************************/
const CLIENT_ID = 'e4f69f9108aa4e72bc268fffab71b7fb';
const REDIRECT_URI = 'https://v-track-me.vercel.app';
const SCOPES = [
  'user-top-read',
  'user-read-recently-played',
  'user-read-private',
  'user-read-email',
  'user-read-playback-state',
  'user-library-read'
].join(' ');

let codeVerifier = null;
let accessToken = null;
let userProfile = null;
let timeRange = 'medium_term';
let audioFeaturesChart = null;
let radarChart = null;

/*************************************************************************
 * POMOCNÉ FUNKCE
 *************************************************************************/
const $ = s => document.querySelector(s);

function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.style.opacity = 1;
  t.style.background = isError ? '#ff6b6bcc' : '#1db954cc';
  setTimeout(() => t.style.opacity = 0, 3000);
}

function switchPanel(id) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  $(`#${id}`).classList.add('active');
  document.querySelector(`.tab[data-target="${id}"]`).classList.add('active');
  
  // Special handling for charts
  if (id === 'audio-features-panel' && audioFeaturesChart) {
    setTimeout(() => audioFeaturesChart.update(), 100);
  }
  if (id === 'overview-panel' && radarChart) {
    setTimeout(() => radarChart.update(), 100);
  }
}

function msToMinutesSeconds(ms) {
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${min}:${sec.toString().padStart(2, '0')}`;
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
    toast(`Login error: ${params.get('error')}`, true);
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
  const res = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error('Failed to load user profile');
  return await res.json();
}

async function fetchUserTop(type, limit = 50) {
  const url = `https://api.spotify.com/v1/me/top/${type}?limit=${limit}&time_range=${timeRange}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error(`Failed to load top ${type}`);
  return await res.json();
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
      throw new Error('Please log out and log back in to grant permissions');
    }
    
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error.message || 'Failed to load recently played');
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

async function fetchAudioFeatures(trackIds) {
  if (!trackIds || trackIds.length === 0) return [];
  const ids = trackIds.join(',');
  const res = await fetch(`https://api.spotify.com/v1/audio-features?ids=${ids}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error('Failed to load audio features');
  const data = await res.json();
  return data.audio_features;
}

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
 * RENDER FUNKCE
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
          <p class="small">Genres: ${a.genres.slice(0, 3).join(', ')}${a.genres.length > 3 ? '...' : ''}</p>
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
      `<article class="card genre-card" title="Top genre #${i + 1}">
        <h3>${i + 1}. ${g}</h3>
      </article>`);
  });
}

function renderAudioFeaturesChart(features) {
  const ctx = document.getElementById('audio-features-chart').getContext('2d');
  
  if (audioFeaturesChart) {
    audioFeaturesChart.destroy();
  }
  
  // Calculate averages
  const averages = {
    danceability: 0,
    energy: 0,
    speechiness: 0,
    acousticness: 0,
    instrumentalness: 0,
    liveness: 0,
    valence: 0
  };
  
  features.forEach(f => {
    if (!f) return;
    averages.danceability += f.danceability;
    averages.energy += f.energy;
    averages.speechiness += f.speechiness;
    averages.acousticness += f.acousticness;
    averages.instrumentalness += f.instrumentalness;
    averages.liveness += f.liveness;
    averages.valence += f.valence;
  });
  
  const count = features.filter(f => f).length;
  Object.keys(averages).forEach(k => {
    averages[k] = (averages[k] / count) * 100;
  });
  
  audioFeaturesChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Danceability', 'Energy', 'Speechiness', 'Acousticness', 'Instrumentalness', 'Liveness', 'Mood'],
      datasets: [{
        label: 'Average %',
        data: [
          averages.danceability,
          averages.energy,
          averages.speechiness,
          averages.acousticness,
          averages.instrumentalness,
          averages.liveness,
          averages.valence
        ],
        backgroundColor: [
          'rgba(29, 185, 84, 0.7)',
          'rgba(29, 185, 84, 0.7)',
          'rgba(29, 185, 84, 0.7)',
          'rgba(29, 185, 84, 0.7)',
          'rgba(29, 185, 84, 0.7)',
          'rgba(29, 185, 84, 0.7)',
          'rgba(29, 185, 84, 0.7)'
        ],
        borderColor: [
          'rgba(29, 185, 84, 1)',
          'rgba(29, 185, 84, 1)',
          'rgba(29, 185, 84, 1)',
          'rgba(29, 185, 84, 1)',
          'rgba(29, 185, 84, 1)',
          'rgba(29, 185, 84, 1)',
          'rgba(29, 185, 84, 1)'
        ],
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          ticks: {
            callback: function(value) {
              return value + '%';
            }
          }
        }
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: function(context) {
              return context.parsed.y.toFixed(1) + '%';
            }
          }
        }
      }
    }
  });
  
  // Generate personality description
  let description = '';
  if (averages.energy > 70) description += 'You prefer high-energy tracks. ';
  if (averages.danceability > 70) description += 'Your music is very danceable. ';
  if (averages.acousticness > 50) description += 'You enjoy acoustic sounds. ';
  if (averages.instrumentalness > 30) description += 'You appreciate instrumental music. ';
  if (averages.valence > 60) description += 'Your music tends to be positive and cheerful. ';
  if (averages.valence < 40) description += 'Your music tends to be more melancholic. ';
  
  $('#audio-features-description').innerHTML = `
    <p>${description || 'Your music taste is well-balanced.'}</p>
    <div class="feature-details">
      <p><strong>Danceability:</strong> ${averages.danceability.toFixed(1)}%</p>
      <p><strong>Energy:</strong> ${averages.energy.toFixed(1)}%</p>
      <p><strong>Positivity (Valence):</strong> ${averages.valence.toFixed(1)}%</p>
      <p><strong>Acousticness:</strong> ${averages.acousticness.toFixed(1)}%</p>
    </div>
  `;
}

function renderRadarChart(features) {
  const ctx = document.getElementById('features-radar').getContext('2d');
  
  if (radarChart) {
    radarChart.destroy();
  }
  
  // Calculate averages
  const averages = {
    danceability: 0,
    energy: 0,
    speechiness: 0,
    acousticness: 0,
    instrumentalness: 0,
    liveness: 0,
    valence: 0,
    tempo: 0
  };
  
  const counts = {
    danceability: 0,
    energy: 0,
    speechiness: 0,
    acousticness: 0,
    instrumentalness: 0,
    liveness: 0,
    valence: 0,
    tempo: 0
  };
  
  features.forEach(f => {
    if (!f) return;
    if (f.danceability) { averages.danceability += f.danceability; counts.danceability++; }
    if (f.energy) { averages.energy += f.energy; counts.energy++; }
    if (f.speechiness) { averages.speechiness += f.speechiness; counts.speechiness++; }
    if (f.acousticness) { averages.acousticness += f.acousticness; counts.acousticness++; }
    if (f.instrumentalness) { averages.instrumentalness += f.instrumentalness; counts.instrumentalness++; }
    if (f.liveness) { averages.liveness += f.liveness; counts.liveness++; }
    if (f.valence) { averages.valence += f.valence; counts.valence++; }
    if (f.tempo) { averages.tempo += f.tempo; counts.tempo++; }
  });
  
  // Normalize tempo (0-200 BPM to 0-1)
  const normalizedTempo = (averages.tempo / counts.tempo) / 200;
  
  radarChart = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: ['Danceability', 'Energy', 'Speechiness', 'Acousticness', 'Instrumentalness', 'Liveness', 'Mood', 'Tempo'],
      datasets: [{
        label: 'Your Average',
        data: [
          averages.danceability / counts.danceability,
          averages.energy / counts.energy,
          averages.speechiness / counts.speechiness,
          averages.acousticness / counts.acousticness,
          averages.instrumentalness / counts.instrumentalness,
          averages.liveness / counts.liveness,
          averages.valence / counts.valence,
          normalizedTempo
        ],
        backgroundColor: 'rgba(29, 185, 84, 0.2)',
        borderColor: 'rgba(29, 185, 84, 1)',
        pointBackgroundColor: 'rgba(29, 185, 84, 1)',
        pointBorderColor: '#fff',
        pointHoverBackgroundColor: '#fff',
        pointHoverBorderColor: 'rgba(29, 185, 84, 1)'
      }]
    },
    options: {
      responsive: true,
      scales: {
        r: {
          angleLines: {
            display: true
          },
          suggestedMin: 0,
          suggestedMax: 1,
          ticks: {
            display: false
          }
        }
      },
      plugins: {
        legend: {
          display: false
        }
      }
    }
  });
}

function renderOverview(topArtists, topTracks, features) {
  // Top artist
  if (topArtists.length > 0) {
    const topArtist = topArtists[0];
    $('#top-artist').innerHTML = `
      <div class="overview-item">
        <img src="${topArtist.images[0]?.url || ''}" alt="${topArtist.name}">
        <div>
          <h4>${topArtist.name}</h4>
          <p>${topArtist.genres.slice(0, 2).join(', ')}</p>
          <p>${topArtist.followers.total.toLocaleString()} followers</p>
        </div>
      </div>
    `;
  }
  
  // Top track
  if (topTracks.length > 0) {
    const topTrack = topTracks[0];
    $('#top-track').innerHTML = `
      <div class="overview-item">
        <img src="${topTrack.album.images[0]?.url || ''}" alt="${topTrack.name}">
        <div>
          <h4>${topTrack.name}</h4>
          <p>${topTrack.artists.map(a => a.name).join(', ')}</p>
          <p>${msToMinutesSeconds(topTrack.duration_ms)}</p>
        </div>
      </div>
    `;
  }
  
  // Mood indicator
  if (features.length > 0) {
    const avgValence = features.reduce((sum, f) => sum + (f?.valence || 0), 0) / features.filter(f => f?.valence).length;
    let mood = 'Neutral';
    let emoji = '😐';
    if (avgValence > 0.7) {
      mood = 'Happy';
      emoji = '😊';
    } else if (avgValence > 0.4) {
      mood = 'Positive';
      emoji = '🙂';
    } else if (avgValence > 0.2) {
      mood = 'Melancholic';
      emoji = '😔';
    } else {
      mood = 'Sad';
      emoji = '😢';
    }
    
    $('#mood-indicator').innerHTML = `
      <div class="mood-display">
        <span class="mood-emoji">${emoji}</span>
        <span class="mood-text">${mood}</span>
        <div class="mood-bar">
          <div class="mood-progress" style="width: ${avgValence * 100}%"></div>
        </div>
      </div>
    `;
  }
}

/*************************************************************************
 * IMPORT DAT
 *************************************************************************/
function setupFileUpload() {
  const uploadArea = $('#upload-area');
  const fileInput = $('#data-upload');
  
  // Handle drag and drop
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = '#1db954';
  });
  
  uploadArea.addEventListener('dragleave', () => {
    uploadArea.style.borderColor = '#444';
  });
  
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = '#444';
    if (e.dataTransfer.files.length > 0) {
      fileInput.files = e.dataTransfer.files;
      handleFileUpload({ target: fileInput });
    }
  });
  
  // Handle file selection
  fileInput.addEventListener('change', handleFileUpload);
}

function handleFileUpload(event) {
  const files = event.target.files;
  if (!files || files.length === 0) return;
  
  $('#upload-progress').innerHTML = '<p>Processing files...</p>';
  
  let processedFiles = 0;
  let allData = [];
  
  Array.from(files).forEach(file => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        
        // Handle different Spotify export formats
        if (Array.isArray(data)) {
          // New format (StreamingHistory_X.json)
          allData = allData.concat(data);
        } else if (data && data.endTime) {
          // Old format (endsong_X.json)
          allData.push(data);
        }
        
        processedFiles++;
        $('#upload-progress').innerHTML = `<p>Processed ${processedFiles} of ${files.length} files</p>`;
        
        if (processedFiles === files.length) {
          processImportedData(allData);
        }
      } catch (err) {
        console.error('Error parsing file:', err);
        $('#upload-progress').innerHTML += `<p style="color:red">Error processing ${file.name}: ${err.message}</p>`;
      }
    };
    
    reader.onerror = () => {
      processedFiles++;
      $('#upload-progress').innerHTML += `<p style="color:red">Error reading ${file.name}</p>`;
    };
    
    if (file.name.match(/\.json$/i)) {
      reader.readAsText(file);
    } else {
      processedFiles++;
      $('#upload-progress').innerHTML += `<p style="color:orange">Skipping non-JSON file: ${file.name}</p>`;
    }
  });
}

function processImportedData(data) {
  if (data.length === 0) {
    $('#upload-progress').innerHTML += '<p style="color:red">No valid data found in files</p>';
    return;
  }
  
  // Process data (this is simplified - you'd want to do more analysis)
  const playCounts = {};
  const artistCounts = {};
  const trackCounts = {};
  const dateCounts = {};
  
  data.forEach(item => {
    const trackName = item.trackName || item.master_metadata_track_name;
    const artistName = item.artistName || item.master_metadata_album_artist_name;
    const date = new Date(item.endTime || item.ts).toISOString().split('T')[0];
    
    if (trackName && artistName) {
      const trackKey = `${trackName} - ${artistName}`;
      trackCounts[trackKey] = (trackCounts[trackKey] || 0) + 1;
      artistCounts[artistName] = (artistCounts[artistName] || 0) + 1;
      dateCounts[date] = (dateCounts[date] || 0) + 1;
    }
  });
  
  // Sort results
  const sortedTracks = Object.entries(trackCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  
  const sortedArtists = Object.entries(artistCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  
  // Display results
  let html = `
    <div class="imported-stats">
      <div class="stat-box">
        <h4>Total Streams</h4>
        <p class="big-number">${data.length}</p>
      </div>
      <div class="stat-box">
        <h4>Unique Tracks</h4>
        <p class="big-number">${Object.keys(trackCounts).length}</p>
      </div>
      <div class="stat-box">
        <h4>Unique Artists</h4>
        <p class="big-number">${Object.keys(artistCounts).length}</p>
      </div>
    </div>
    
    <div class="imported-columns">
      <div class="imported-column">
        <h4>Top Tracks</h4>
        <ol class="imported-list">
          ${sortedTracks.map(([track, count]) => `
            <li>
              <span class="track-name">${track.split(' - ')[0]}</span>
              <span class="artist-name">${track.split(' - ')[1]}</span>
              <span class="play-count">${count} plays</span>
            </li>
          `).join('')}
        </ol>
      </div>
      
      <div class="imported-column">
        <h4>Top Artists</h4>
        <ol class="imported-list">
          ${sortedArtists.map(([artist, count]) => `
            <li>
              <span class="artist-name">${artist}</span>
              <span class="play-count">${count} plays</span>
            </li>
          `).join('')}
        </ol>
      </div>
    </div>
  `;
  
  $('#imported-stats-container').innerHTML = html;
  $('#imported-data-stats').style.display = 'block';
  $('#upload-progress').innerHTML += '<p style="color:#1db954">Data import complete!</p>';
  
  // Store data in localStorage for future sessions
  localStorage.setItem('importedData', JSON.stringify(data));
}

/*************************************************************************
 * HLAVNÍ NAČTENÍ DAT
 *************************************************************************/
async function loadUserData() {
  $('#login-prompt').style.display = 'none';
  $('#user-section').hidden = false;
  $('#login-btn').style.display = 'none';
  $('#logout-btn').style.display = 'inline-block';
  if (!accessToken) return;

  try {
    userProfile = await fetchUserProfile();

    // Display user info
    const userInfo = $('#user-info');
    userInfo.innerHTML = 
      `<img src="${userProfile.images?.[0]?.url || ''}" alt="User avatar" style="width:40px; height:40px; border-radius:50%; margin-right:0.5rem;">
      <span>${userProfile.display_name}</span>`;

    userInfo.style.cursor = 'pointer';
    userInfo.title = 'Open Spotify profile';
    userInfo.onclick = () => {
      const url = userProfile.external_urls?.spotify || `https://open.spotify.com/user/${userProfile.id}`;
      window.open(url, '_blank');
    };

    // Load all data in parallel
    const [artistsData, albumsData, tracksData, recentData] = await Promise.all([
      fetchUserTop('artists'),
      fetchUserTopAlbumsFromTracks(),
      fetchUserTopTracks(),
      fetchRecentlyPlayed().catch(e => ({ items: [] })) // Graceful fallback
    ]);

    // Get audio features for top tracks
    const trackIds = tracksData.items.map(t => t.id).filter(id => id);
    const audioFeatures = await fetchAudioFeatures(trackIds);

    // Render all sections
    renderTopArtists(artistsData.items);
    renderTopAlbums(albumsData.items);
    renderTopTracks(tracksData.items);
    renderRecentlyPlayed(recentData.items);
    
    // Genres from top artists
    const topGenres = extractTopGenres(artistsData.items);
    renderTopGenres(topGenres);
    
    // Audio features
    renderAudioFeaturesChart(audioFeatures);
    renderRadarChart(audioFeatures);
    
    // Overview
    renderOverview(artistsData.items, tracksData.items, audioFeatures);

  } catch (e) {
    toast('Error loading data: ' + e.message, true);
    if (e.message.includes('401')) {
      logout();
    }
  }
}

/*************************************************************************
 * INICIALIZACE
 *************************************************************************/
function init() {
  // Handle Spotify redirect
  const code = handleRedirect();
  if (code) {
    getAccessToken(code).then(token => {
      accessToken = token;
      localStorage.setItem('access_token', token);
      loadUserData();
    }).catch(err => {
      toast('Login error: ' + err.message, true);
    });
  } else {
    accessToken = localStorage.getItem('access_token');
    if (accessToken) {
      loadUserData();
    }
  }

  // Tab switching
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', e => {
      switchPanel(btn.dataset.target);
    });
  });

  // Time range selector
  const timeRangeSelect = document.querySelector('#time-range-select');
  if (timeRangeSelect) {
    timeRangeSelect.addEventListener('change', async e => {
      timeRange = e.target.value;
      await loadUserData();
    });
  }

  // Setup file upload
  setupFileUpload();
  
  // Check for previously imported data
  const importedData = localStorage.getItem('importedData');
  if (importedData) {
    try {
      processImportedData(JSON.parse(importedData));
    } catch (e) {
      console.error('Error loading saved data:', e);
    }
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', init);

// Event listeners
$('#login-btn').addEventListener('click', login);
$('#logout-btn').addEventListener('click', logout);
$('#login-btn-prompt').addEventListener('click', login);
