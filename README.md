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

Files
- `index.html` — UI + includes
- `src/app.js` — application logic (QR, three.js scene, WebXR fallback)
- `style.css` — simple UI styles

If you want, I can:
- Add Firebase Firestore persistence + Auth (admin role), or
- Implement full WebXR anchor flow using Anchors API (if target devices support), or
- Wire up a simple floorplan view and pathfinding (A*/graph of waypoints).

Tell me which option you prefer and I'll extend the repo. 👇