# RS Wayfinder — Starter (QR → AR)

Prototype starter for indoor navigation using a QR code to anchor a session and (optionally) WebXR for AR placement.

Features
- QR scanning to set an anchor id (uses camera + jsQR)
- If WebXR immersive-ar and hit-test are available, admin can place POIs directly via AR tap
- Fallback placement: place POI a fixed distance in front of the camera
- Simple local admin (prompt password: `admin`) to show Add button and Admin Manager (Edit, Reposition, Export, Import, Clear)
- POIs saved in localStorage per scanned anchor (key `pois_<anchorId>`)
- Basic arrow navigation that points to POI (works best in AR-capable devices)

How to run (dev)
1. This project must be served from a secure origin for some features (WebXR). For local dev, `http://localhost` is accepted by browsers for camera access.
2. Install a tiny static server (optional):
   - `npm install -g http-server` or use `npx http-server`
   - Run: `npx http-server -c-1 -p 8080` then open `http://localhost:8080`

Notes & next steps
- This is intentionally minimal. To make POIs robust across sessions you should integrate WebXR Anchors or a persistent mapping backend (e.g., Firebase + unique anchor transforms provided by ARCore Cloud Anchors / ARKit sharing).
- Improve admin auth (do not use prompt/password in production).

Admin Manager (in-app)
- When logged in as admin you can:
  - Edit POI name
  - Reposition POI (via AR hit-test if available or fallback placement)
  - Export POIs to JSON file (per anchor)
  - Import POIs from JSON (replace or append)
  - Clear all POIs for the current anchor

Floor calibration (non-WebXR fallback)
- If WebXR/anchors are not available, you can still create a consistent floor reference after scanning the QR:
  - Press **Set Floor** → enter your camera height (meters, e.g. 1.6) → point the camera to a visible floor point and tap.
  - The app computes the floor intersection using the camera direction and the height you provided, and stores a floor reference (`anchor_meta_<anchorId>`) with `cameraHeight` and `floorPoint`.
  - Future POI placements without AR will intersect placement rays with this floor plane (y=0 in anchor-local space), making navigation arrows point correctly on the floor plane.

Web AR (Enter AR)
- Use the **Enter AR** button to start a WebXR AR session (if supported by device).
  - The app shows a reticle (hit-test preview) where a POI would be placed.
  - When placing a POI the app shows a **ghost** semi-transparent marker at the candidate pose so you can preview position & orientation before saving.
  - Placement flow: point device → tap to choose placement candidate (or wait for reticle) → use **Confirm Place** to finalize or **Cancel** to abort.
  - You can also reposition POIs using AR placement that uses the same ghost + confirm flow.
  - If the device supports `anchors`, the session will request the feature and use hit-test poses for placement; positions are still saved to localStorage for persistence across sessions.

Files
- `index.html` — UI + includes
- `src/app.js` — application logic (QR, three.js scene, WebXR fallback)
- `style.css` — simple UI styles

If you want, I can:
- Add Firebase Firestore persistence + Auth (admin role), or
- Implement full WebXR anchor flow using Anchors API (if target devices support), or
- Wire up a simple floorplan view and pathfinding (A*/graph of waypoints).

Tell me which option you prefer and I'll extend the repo. 👇