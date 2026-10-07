# Night World Online - go live

Files: `server.js` + `package.json` (the server), `index.html` (the game).

## 1. Server on Render (free)
1. Put `server.js` and `package.json` in a new GitHub repo.
2. render.com > New > Web Service > connect the repo.
3. Build command: `npm install`  Start command: `npm start`  Instance type: Free.
4. When it deploys you get a URL like `https://night-world.onrender.com`.
   Opening it in a browser should show "Players online: 0".

## 2. Point the game at it
In `index.html`, change this line near the multiplayer section:
`var WS_URL='wss://YOUR-APP.onrender.com';`
to your URL with `wss://` (e.g. `wss://night-world.onrender.com`).

## 3. Host the game page (free)
Upload `index.html` to GitHub Pages (or Cloudflare Pages). Share that link.

Note: Render's free plan sleeps after ~15 min with nobody connected,
so the first player after a quiet spell waits a few seconds.
