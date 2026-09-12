# Chain Reaction — Firebase version (no server, no npm)

## File names
```
chain-reaction-firebase/
├── index.html
├── style.css
└── script.js
```
Keep these three files in the same folder together.

## One-time setup (about 5 minutes, all in your browser)

1. **Create a free Firebase project**
   Go to https://console.firebase.google.com → "Add project" → give it any name → you can turn off Google Analytics (not needed) → Create.

2. **Turn on the Realtime Database**
   In the left sidebar: **Build → Realtime Database → Create Database**. Pick any region → start in **test mode** (we'll replace the rules next).

3. **Open up the database rules for this project**
   Still in Realtime Database, click the **Rules** tab and replace the contents with:
   ```json
   {
     "rules": {
       "rooms": {
         "$code": {
           ".read": true,
           ".write": true
         }
       }
     }
   }
   ```
   Click **Publish**. (Heads-up: this makes any room readable/writable by anyone who has the exact 4-letter code — fine for a casual game with friends, but don't store anything sensitive here.)

4. **Register a Web App to get your config**
   Click the gear icon next to "Project Overview" → **Project settings** → scroll to "Your apps" → click the **</>** (web) icon → give it any nickname → **Register app**. You do *not* need Firebase Hosting.
   You'll see a code block with a `firebaseConfig` object like:
   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "your-project.firebaseapp.com",
     databaseURL: "https://your-project-default-rtdb.firebaseio.com",
     projectId: "your-project",
     storageBucket: "your-project.appspot.com",
     messagingSenderId: "...",
     appId: "..."
   };
   ```

5. **Paste it into `script.js`**
   Open `script.js` in VS Code. Near the top you'll see `FIREBASE_CONFIG` with placeholder text — replace those placeholder values with the real ones from step 4.

## Running it
No terminal needed at all:
- **Easiest:** double-click `index.html` and it opens in your browser.
- **Or in VS Code:** install the "Live Server" extension, right-click `index.html` → "Open with Live Server".

Create a room, send the 4-letter code to a friend, they open the same page (from anywhere — this isn't limited to your Wi-Fi, since Firebase is a real cloud backend), and enter the code to join.

## Why this is smoother than the Node version
- Nothing to install locally — Firebase is loaded from a CDN link already in `index.html`.
- No port/localhost issues, no "npm not recognized," no installer errors.
- Firebase's `transaction()` safely resolves two players acting at the same moment (e.g. clicking at the exact same time), so moves can't corrupt each other.
- Reconnects automatically if the internet blips, and marks a player "offline" in the lobby/board if their tab closes, using Firebase's built-in presence detection.
- Refreshing the page mid-game rejoins you automatically (your name + room are remembered).

## If something doesn't work
- **Nothing loads / stuck on "Connecting…":** double-check every value in `FIREBASE_CONFIG` was copied exactly, including the `https://` on `databaseURL`.
- **"No room found with that code":** codes are case-insensitive but must match exactly, and both people need the *same* Firebase project's config in their `script.js` — if you deploy this for friends, send them the whole folder (with your filled-in config), not just the room code.
