import * as THREE from 'https://unpkg.com/three@0.152.2/build/three.module.js';

/*
Starter app features:
- Scan QR to set an "anchor id"
- Use WebXR AR hit-test to place POIs if available, otherwise fallback to placing POI 2m in front
- Save POIs per anchor in localStorage
- Simple admin login (password prompt, default "admin") to show Add button
- Navigation: arrow points towards selected POI (works in AR session; fallback uses device orientation for bearing)

Limitations:
- This is a prototype. For robust, persistent real-world anchors across sessions use platform anchors (ARCore/ARKit) via WebXR Anchors or a backend mapping service.
*/

const video = document.getElementById('video');
const scanCanvas = document.getElementById('scan-canvas');
const scanCtx = scanCanvas.getContext('2d');
const statusEl = document.getElementById('status');
const controls = document.getElementById('controls');
const btnAdmin = document.getElementById('btn-admin');
const btnAdd = document.getElementById('btn-add');
const btnEnter = document.getElementById('btn-enter');
const btnSetFloor = document.getElementById('btn-set-floor');
const btnConfirmPlace = document.getElementById('btn-confirm-place');
const btnCancelPlace = document.getElementById('btn-cancel-place');
const placeControls = document.getElementById('place-controls');
const btnExport = document.getElementById('btn-export');
const btnImport = document.getElementById('btn-import');
const btnClear = document.getElementById('btn-clear');
const fileImport = document.getElementById('file-import');
const poiListEl = document.getElementById('poi-list');

let anchorId = null; // set by QR payload
let isAdmin = localStorage.getItem('isAdmin') === 'true';
let pois = []; // current anchor POIs

// three.js
let scene, camera, renderer, arrowMesh;
let xrSession = null;
let poiGroup = null; // group of POI markers in scene
let reticle = null; // hit-test preview reticle
let markers = []; // active marker meshes for POIs
let ghost = null; // preview marker while placing
let placementActive = false; // true when in placement flow
let lastPlacedPose = null; // last hit pose matrix array

// Anchor metadata (camera height, floor point etc.)
let anchorMeta = null;
let calibratingFloor = false;

initThree();
startVideoAndScan();
updateUI();

btnAdmin.addEventListener('click', async () => {
  if (!isAdmin) {
    const pw = prompt('Masukkan password admin:');
    if (pw === 'admin') {
      isAdmin = true; localStorage.setItem('isAdmin', 'true');
      updateUI();
      alert('Admin mode aktif');
    } else alert('Password salah');
  } else {
    isAdmin = false; localStorage.setItem('isAdmin', 'false'); updateUI();
  }
});

btnAdd.addEventListener('click', async () => {
  if (!anchorId) return alert('Scan QR terlebih dahulu');
  // Prefer WebXR hit-test placement (interactive). Fallback: place 2m ahead.
  if (navigator.xr && await navigator.xr.isSessionSupported && await navigator.xr.isSessionSupported('immersive-ar')) {
    const use = confirm('WebXR AR tersedia. Gunakan untuk menempatkan POI? (Tap layar untuk menempatkan)');
    if (use) {
      await startArPlacement();
      return;
    }
  }
  // fallback: create POI 2m in front of camera
  const dist = parseFloat(prompt('Jarak dari kamera (meter)', '2')) || 2;
  const name = prompt('Nama POI');
  if (!name) return;
  // camera world forward in three.js coordinate is -Z
  const forward = new THREE.Vector3(0, 0, -1);
  forward.applyQuaternion(camera.quaternion);
  const pos = camera.position.clone().add(forward.multiplyScalar(dist));
  const q = camera.quaternion.clone();
  savePoi({name, pos: toSimple(pos), quat: toSimple(q)});
});

function initThree() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 1000);
  renderer = new THREE.WebGLRenderer({alpha: true});
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  // give canvas a class so CSS can target it cleanly
  renderer.domElement.classList.add('xr-canvas');
  document.getElementById('xr-root').appendChild(renderer.domElement);

  // simple ground grid
  const grid = new THREE.GridHelper(20, 20, 0x888888, 0x222222);
  scene.add(grid);

  // lighting for AR markers
  const amb = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(amb);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
  dirLight.position.set(0.5, 1, 0.5);
  scene.add(dirLight);

  // group for POI markers
  poiGroup = new THREE.Group();
  scene.add(poiGroup);

  // arrow helper
  const dir = new THREE.Vector3(0,0,-1);
  arrowMesh = new THREE.ArrowHelper(dir, new THREE.Vector3(0,0,0), 1, 0xff0000, 0.3, 0.2);
  arrowMesh.visible = false;
  scene.add(arrowMesh);

  // reticle for hit-test preview
  reticle = createReticle();
  reticle.visible = false;
  scene.add(reticle);

  window.addEventListener('resize', ()=>{
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight);
  });
  animate();
}

function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}

function createReticle() {
  const r = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.08, 32), new THREE.MeshBasicMaterial({ color: 0x00ffcc, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  r.add(ring);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.02, 16), new THREE.MeshBasicMaterial({ color: 0x00ffcc }));
  dot.rotation.x = -Math.PI / 2;
  r.add(dot);
  return r;
}

let videoStream = null; // active getUserMedia stream

async function startVideoAndScan() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    videoStream = stream;
    video.srcObject = stream;
    video.classList.remove('hidden');
    await video.play();

    scanCanvas.width = video.videoWidth || 640;
    scanCanvas.height = video.videoHeight || 480;
    scanLoop();
  } catch(e) {
    console.error(e);
    statusEl.innerText = 'Gagal akses kamera: ' + e.message;
  }
}

function stopVideoStream() {
  if (!videoStream) return;
  try {
    videoStream.getTracks().forEach(t => t.stop());
  } catch(e){ console.warn('stopVideoStream failed', e); }
  video.srcObject = null;
  videoStream = null;
  video.classList.add('hidden');
}

function scanLoop() {
  if (video.readyState === video.HAVE_ENOUGH_DATA) {
    scanCtx.drawImage(video, 0, 0, scanCanvas.width, scanCanvas.height);
    const imageData = scanCtx.getImageData(0,0, scanCanvas.width, scanCanvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height);
    if (code) {
      onQrDetected(code.data);
      return; // stop scanning further
    }
  }
  requestAnimationFrame(scanLoop);
}

function onQrDetected(data) {
  anchorId = data || 'anchor:' + Date.now();
  statusEl.innerText = `QR terdeteksi — anchor: ${anchorId}`;
  controls.classList.remove('hidden');
  // stop the scanning camera to avoid conflicts with WebXR and to hide duplicate preview
  stopVideoStream();
  loadPois();
  loadAnchorMeta();
  updateUI();
  // Prompt to set camera height if no floor yet
  if (!anchorMeta || !anchorMeta.floorSet) {
    const setNow = confirm('Anchor terdeteksi. Mau set posisi lantai sekarang? (direkomendasikan)');
    if (setNow) startFloorCalibration();
  }
}

function updateUI() {
  btnAdd.classList.toggle('hidden', !isAdmin);
  btnExport.classList.toggle('hidden', !isAdmin);
  btnImport.classList.toggle('hidden', !isAdmin);
  btnClear.classList.toggle('hidden', !isAdmin);
  btnEnter.classList.toggle('hidden', !anchorId);
  btnSetFloor.classList.toggle('hidden', !anchorId);
  btnAdmin.innerText = isAdmin ? 'Logout admin' : 'Admin Login';
  renderPoiList();
}

btnEnter.addEventListener('click', async ()=>{
  if (!anchorId) return alert('Scan QR terlebih dahulu');
  await startArView();
});

function savePoi(poi) {
  pois.push(poi);
  localStorage.setItem(keyForAnchor(), JSON.stringify(pois));
  renderPoiList();
}

// Admin export/import/clear + reposition helpers
btnExport.addEventListener('click', exportPois);
btnImport.addEventListener('click', ()=>fileImport.click());
fileImport.addEventListener('change', handleFileImport);
btnClear.addEventListener('click', ()=>{
  if (!anchorId) return alert('Scan QR terlebih dahulu');
  if (confirm('Hapus semua POI untuk anchor ini?')) {
    pois = [];
    localStorage.removeItem(keyForAnchor());
    renderPoiList();
  }
});

// Set Floor workflow (user-assisted when no AR anchors available)
btnSetFloor.addEventListener('click', startFloorCalibration);

function startFloorCalibration() {
  if (!anchorId) return alert('Scan QR terlebih dahulu');
  let h = parseFloat(prompt('Masukkan tinggi kamera dari lantai (meter)', '1.6'));
  if (!h || isNaN(h) || h <= 0) { alert('Tinggi tidak valid'); return; }
  anchorMeta = anchorMeta || {};
  anchorMeta.cameraHeight = h;
  anchorMeta.floorSet = false;
  anchorMeta.floorPoint = null;
  saveAnchorMeta();

  statusEl.innerText = 'Kalibrasi lantai: arahkan kamera ke titik lantai yang ingin dijadikan referensi lalu tap layar';
  calibratingFloor = true;

  // Listen for a single tap on renderer canvas to capture floor point
  const handler = (ev) => { captureFloorPoint(ev); renderer.domElement.removeEventListener('pointerdown', handler); };
  renderer.domElement.addEventListener('pointerdown', handler, { once: true });
}

function captureFloorPoint(ev) {
  if (!anchorMeta || !anchorMeta.cameraHeight) return alert('Tinggi kamera belum di-set');
  // Use camera direction and the provided height to compute intersection with horizontal plane y=0
  const h = anchorMeta.cameraHeight;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  if (Math.abs(dir.y) < 0.05) { alert('Arahkan kamera sedikit ke bawah (lebih condong ke lantai)'); return; }
  const origin = new THREE.Vector3(0, h, 0); // anchor origin is camera pose at QR scan; treat anchor y=0 as floor
  const t = -origin.y / dir.y; // solve origin.y + t*dir.y = 0
  if (t <= 0) { alert('Tidak menemukan perpotongan lantai. Arahkan kamera lebih ke bawah.'); return; }
  const p = origin.clone().add(dir.multiplyScalar(t));
  anchorMeta.floorSet = true;
  anchorMeta.floorPoint = toSimple(p);
  saveAnchorMeta();
  statusEl.innerText = `Lantai diset (y=0). Titik referensi: (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`;
  // show a small helper marker at floor point
  const floorMarker = createPoiMarker({name: 'FloorRef', pos: anchorMeta.floorPoint});
  floorMarker.traverse(c=>{ c.material && (c.material.opacity = 0.6); if (c.material) c.material.transparent = true; });
  poiGroup.add(floorMarker);
  markers.push(floorMarker);
  calibratingFloor = false;
  updateUI();
}

function exportPois() {
  if (!anchorId) return alert('Scan QR terlebih dahulu');
  const data = JSON.stringify({anchor: anchorId, pois: pois}, null, 2);
  const blob = new Blob([data], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${anchorId}-pois.json`; a.click();
  URL.revokeObjectURL(url);
}

function handleFileImport(ev) {
  const f = ev.target.files && ev.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (Array.isArray(parsed)) {
         importPoisJSON(parsed);
      } else if (parsed && parsed.pois) {
         importPoisJSON(parsed.pois);
      } else {
         alert('File JSON tidak mengenali format POI');
      }
    } catch (err) { alert('Import gagal: ' + err.message); }
  };
  r.readAsText(f);
  fileImport.value = '';
}

function importPoisJSON(data) {
  if (!anchorId) return alert('Scan QR terlebih dahulu');
  const replace = confirm('Ganti POI yang ada? (Cancel untuk menambah)');
  if (replace) {
    pois = data;
  } else {
    pois = pois.concat(data);
  }
  localStorage.setItem(keyForAnchor(), JSON.stringify(pois));
  renderPoiList();
}

async function repositionPoi(idx) {
  if (!anchorId) return alert('Scan QR terlebih dahulu');
  if (navigator.xr && await navigator.xr.isSessionSupported && await navigator.xr.isSessionSupported('immersive-ar')) {
    const use = confirm('Gunakan AR untuk menempatkan ulang POI? (tap layar)');
    if (use) {
      await startArPlacement({
        onPlaced: (pos, quat) => {
          pois[idx].pos = toSimple(pos);
          pois[idx].quat = toSimple(quat);
          localStorage.setItem(keyForAnchor(), JSON.stringify(pois));
          renderPoiList();
        },
        endAfterPlace: true
      });
      return;
    }
  }
  const dist = parseFloat(prompt('Jarak dari kamera (meter)', '2')) || 2;
  const forward = new THREE.Vector3(0,0,-1);
  forward.applyQuaternion(camera.quaternion);
  const pos = camera.position.clone().add(forward.multiplyScalar(dist));
  const q = camera.quaternion.clone();
  pois[idx].pos = toSimple(pos);
  pois[idx].quat = toSimple(q);
  localStorage.setItem(keyForAnchor(), JSON.stringify(pois));
  renderPoiList();
}

function loadPois() {
  if (!anchorId) return;
  const raw = localStorage.getItem(keyForAnchor());
  pois = raw ? JSON.parse(raw) : [];
}

function keyForAnchor() { return `pois_${anchorId}`; }
function keyForAnchorMeta() { return `anchor_meta_${anchorId}`; }

function loadAnchorMeta() {
  if (!anchorId) return;
  const raw = localStorage.getItem(keyForAnchorMeta());
  anchorMeta = raw ? JSON.parse(raw) : { cameraHeight: null, floorSet: false, floorPoint: null };
}

function saveAnchorMeta() {
  if (!anchorId) return;
  localStorage.setItem(keyForAnchorMeta(), JSON.stringify(anchorMeta));
}

function renderPoiList() {
  poiListEl.innerHTML = '';
  pois.forEach((p, i)=>{
    const el = document.createElement('div');
    el.className = 'poi-item';
    el.innerHTML = `<strong>${p.name}</strong>
      <button class="nav" data-i="${i}">Navigate</button>
      ${isAdmin?'<button class="edit" data-i="'+i+'">Edit</button>':''}
      ${isAdmin?'<button class="repos" data-i="'+i+'">Reposition</button>':''}
      ${isAdmin?'<button class="del" data-i="'+i+'">Del</button>':''}`;
    poiListEl.appendChild(el);
  });
  poiListEl.querySelectorAll('button').forEach(b=>{
    b.addEventListener('click', async (ev)=>{
      const idx = parseInt(ev.target.dataset.i);
      if (ev.target.classList.contains('del')) {
        if (!confirm('Hapus POI ini?')) return;
        pois.splice(idx,1); localStorage.setItem(keyForAnchor(), JSON.stringify(pois)); renderPoiList(); return;
      }
      if (ev.target.classList.contains('edit')) {
        const name = prompt('Nama baru', pois[idx].name);
        if (name) { pois[idx].name = name; localStorage.setItem(keyForAnchor(), JSON.stringify(pois)); renderPoiList(); }
        return;
      }
      if (ev.target.classList.contains('repos')) {
        await repositionPoi(idx);
        return;
      }
      // default: navigate
      startNavigateTo(pois[idx]);
    });
  });
}

function startNavigateTo(poi) {
  arrowMesh.visible = true;
  if (xrSession) {
    // In AR session we can compute world positions directly - POI stored with world positions when placed via AR
    // Implementation: we assume poi.pos is world position vector [x,y,z]
    requestAnimationFrame(()=>updateArrowInAr(poi));
  } else {
    // fallback: compute azimuth using deviceorientation and POI relative pos stored as pos {x,y,z}
    updateArrowFallback(poi);
  }
}

function updateArrowInAr(poi) {
  // If the POI contains a world position, use it; otherwise try local coordenates
  const p = new THREE.Vector3(poi.pos.x, poi.pos.y, poi.pos.z);
  // compute camera world position
  const camWorld = new THREE.Vector3(); camera.getWorldPosition(camWorld);
  const dir = p.clone().sub(camWorld).normalize();
  arrowMesh.position.copy(camWorld);
  arrowMesh.setDirection(dir);
  arrowMesh.setLength(Math.min(10, camWorld.distanceTo(p)), 0.3, 0.2);
  // keep updating while visible
  if (arrowMesh.visible) requestAnimationFrame(()=>updateArrowInAr(poi));
}

function updateArrowFallback(poi) {
  // POI pos is stored in anchor-local coordinates; use camera height from anchorMeta for origin
  const p = new THREE.Vector3(poi.pos.x, poi.pos.y, poi.pos.z);
  const camH = (anchorMeta && anchorMeta.cameraHeight) ? anchorMeta.cameraHeight : 1.6;
  const camOrigin = new THREE.Vector3(0, camH, 0);
  const dir = p.clone().sub(camOrigin).setY(0).normalize();
  arrowMesh.position.copy(camOrigin);
  arrowMesh.setDirection(dir);
  arrowMesh.setLength(Math.min(20, camOrigin.distanceTo(p)), 0.3, 0.2);
}

function toSimple(v) {
  if (v.isQuaternion) return {x:v.x,y:v.y,z:v.z,w:v.w};
  return {x:v.x,y:v.y,z:v.z};
}

function createPoiMarker(poi) {
  const g = new THREE.Group();
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 12), new THREE.MeshStandardMaterial({ color: 0xffcc00 }));
  g.add(sphere);
  // simple canvas label
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0,0,256,64);
  ctx.fillStyle = '#fff'; ctx.font = '30px sans-serif'; ctx.fillText(poi.name || '', 8,42);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
  sprite.scale.set(0.6, 0.15, 1);
  sprite.position.set(0, 0.25, 0);
  g.add(sprite);
  g.position.set(poi.pos.x, poi.pos.y, poi.pos.z);
  return g;
}

function refreshPoiMarkers() {
  clearPoiMarkers();
  pois.forEach(p=>{
    if (p.pos) {
      const m = createPoiMarker(p);
      poiGroup.add(m);
      markers.push(m);
    }
  });
}

function clearPoiMarkers() {
  markers.forEach(m=>{ poiGroup.remove(m); m.traverse((c)=>{ if (c.geometry) c.geometry.dispose(); if (c.material) { if (c.material.map) c.material.map.dispose(); c.material.dispose(); } }); });
  markers = [];
}

function createGhostMarker() {
  const g = new THREE.Group();
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 12), new THREE.MeshStandardMaterial({ color: 0x00ccff, transparent: true, opacity: 0.45 }));
  g.add(sphere);
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.15), new THREE.MeshBasicMaterial({ color:0x000000, transparent:true, opacity:0.5 }));
  label.position.set(0,0.25,0);
  g.add(label);
  g.visible = false;
  scene.add(g);
  return g;
}

function showGhostAt(pos, quat) {
  if (!ghost) ghost = createGhostMarker();
  ghost.position.copy(pos);
  ghost.quaternion.copy(quat);
  ghost.visible = true;
}

function hideGhost() {
  if (ghost) ghost.visible = false;
}

function enablePlacementUI(enabled) {
  placementActive = enabled;
  placeControls.classList.toggle('hidden', !enabled);
  btnConfirmPlace.disabled = !enabled;
  btnCancelPlace.disabled = !enabled;
}

async function startArPlacement(options = {}) {
  try {
    // stop scanning camera so the device's camera feed will be used by WebXR (prevents two previews)
    stopVideoStream();

    const session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test','dom-overlay'], optionalFeatures: ['anchors'], domOverlay: { root: document.getElementById('app') } });
    xrSession = session;
    renderer.xr.enabled = true;
    await renderer.xr.setSession(session);

    const refSpace = await session.requestReferenceSpace('local');
    const viewerSpace = await session.requestReferenceSpace('viewer');
    const hitTestSource = await session.requestHitTestSource({ space: viewerSpace });

    statusEl.innerText = 'AR session aktif: tap layar untuk menempatkan POI';
    enablePlacementUI(false); // UI will be enabled when user taps to choose placement (or reticle available)

    let lastHit = null;
    const onXRFrame = (time, frame) => {
      const session = frame.session;
      session.requestAnimationFrame(onXRFrame);
      const viewerPose = frame.getViewerPose(refSpace);
      if (!viewerPose) return;
      const hitTestResults = frame.getHitTestResults(hitTestSource);
      if (hitTestResults.length > 0) {
        const pose = hitTestResults[0].getPose(refSpace);
        lastHit = pose.transform.matrix;
        if (reticle) {
          const m = new THREE.Matrix4().fromArray(lastHit);
          m.decompose(reticle.position, reticle.quaternion, reticle.scale);
          reticle.visible = true;
        }
      } else {
        if (reticle) reticle.visible = false;
      }
    };
    session.requestAnimationFrame(onXRFrame);

    const placeListener = async (ev) => {
      // use lastHit if available; otherwise fallback to camera 2m ahead
      let pos = new THREE.Vector3();
      let quat = new THREE.Quaternion();
      if (lastHit) {
        const m = new THREE.Matrix4().fromArray(lastHit);
        m.decompose(pos, quat, new THREE.Vector3());
      } else {
            // fallback: if floor calibration exists, intersect camera center ray with floor plane y=0
      if (anchorMeta && anchorMeta.floorSet) {
        const h = anchorMeta.cameraHeight;
        const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
        const origin = new THREE.Vector3(0, h, 0);
        if (Math.abs(dir.y) < 0.05) {
          // almost horizontal — fallback to 2m
          camera.getWorldPosition(pos);
          camera.getWorldQuaternion(quat);
          const forward = new THREE.Vector3(0,0,-1).applyQuaternion(quat);
          pos.add(forward.multiplyScalar(2));
        } else {
          const t = -origin.y / dir.y;
          pos.copy(origin.add(dir.multiplyScalar(t)));
          camera.getWorldQuaternion(quat);
        }
      } else {
        // no floor calibration — fallback 2m ahead
        camera.getWorldPosition(pos);
        camera.getWorldQuaternion(quat);
        const forward = new THREE.Vector3(0,0,-1).applyQuaternion(quat);
        pos.add(forward.multiplyScalar(2));
      }
      }

      // show ghost at current candidate and enable confirm UI
      lastPlacedPose = { pos: pos.clone(), quat: quat.clone() };
      showGhostAt(pos, quat);
      enablePlacementUI(true);

      // on direct tap, user might want to confirm immediately by pointerdown -> confirm placement
    };

    renderer.domElement.addEventListener('pointerdown', placeListener);

    const confirmHandler = async () => {
      if (!lastPlacedPose) return;
      const pos = lastPlacedPose.pos;
      const quat = lastPlacedPose.quat;
      if (options.onPlaced) {
        options.onPlaced(pos, quat);
      } else {
        const name = prompt('Nama POI');
        if (name) savePoi({name, pos: toSimple(pos), quat: toSimple(quat)});
      }
      hideGhost();
      enablePlacementUI(false);
      if (options.endAfterPlace !== false) await endArSession();
    };

    const cancelHandler = async () => {
      hideGhost();
      enablePlacementUI(false);
      lastPlacedPose = null;
      if (options.endAfterPlace !== false) await endArSession();
    };

    btnConfirmPlace.addEventListener('click', confirmHandler);
    btnCancelPlace.addEventListener('click', cancelHandler);

    // cleanup when session ends
    session.addEventListener('end', ()=>{
      hideGhost(); enablePlacementUI(false); lastPlacedPose = null;
      btnConfirmPlace.removeEventListener('click', confirmHandler);
      btnCancelPlace.removeEventListener('click', cancelHandler);
    });

  } catch (e) {
    console.error('AR start failed', e);
    alert('Gagal memulai AR: ' + e.message);
  }
}

async function endArSession() {
  if (!xrSession) return;
  await xrSession.end();
  xrSession = null;
  renderer.xr.enabled = false;
  // hide reticle and clear POI markers
  if (reticle) reticle.visible = false;
  hideGhost();
  enablePlacementUI(false);
  clearPoiMarkers();
  arrowMesh.visible = false;
  statusEl.innerText = 'AR session selesai';
  updateUI();
}

async function startArView() {
  try {
    // stop scanning camera if still active (prevents two camera previews)
    stopVideoStream();

    const session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test','dom-overlay'], optionalFeatures: ['anchors'], domOverlay: { root: document.getElementById('app') } });
    xrSession = session;
    renderer.xr.enabled = true;
    await renderer.xr.setSession(session);

    const refSpace = await session.requestReferenceSpace('local');
    const viewerSpace = await session.requestReferenceSpace('viewer');
    const hitTestSource = await session.requestHitTestSource({ space: viewerSpace });

    statusEl.innerText = 'AR view aktif — arahkan perangkat ke sekeliling untuk melihat POI';

    // create markers for existing POIs
    refreshPoiMarkers();

    session.requestAnimationFrame(function onFrame(time, frame){
      session.requestAnimationFrame(onFrame);
      const viewerPose = frame.getViewerPose(refSpace);
      if (!viewerPose) return;
      const hitTestResults = frame.getHitTestResults(hitTestSource);
      if (hitTestResults.length > 0) {
        const pose = hitTestResults[0].getPose(refSpace);
        if (pose && reticle) {
          reticle.visible = true;
          const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
          m.decompose(reticle.position, reticle.quaternion, reticle.scale);
        }
      } else {
        if (reticle) reticle.visible = false;
      }

      // update arrow if navigating
      // update marker visibility (optional); markers are static at saved world positions
    });

    session.addEventListener('end', ()=>endArSession());

  } catch (e) {
    console.error('AR view failed', e);
    alert('Gagal memulai AR view: ' + e.message);
  }
}

/* Notes for developer:
 - This is starter scaffolding. For production you should:
   - Implement robust AR placement using real hit-test results and anchors
   - Use a backend (Firestore, etc) if you need cross-device consistency
   - Improve admin authentication (no plain prompt)
*/
