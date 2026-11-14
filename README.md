# CricketStream — local scoreboard

A small native Node.js app for manual cricket scoring and a transparent OBS overlay. The server runs on your computer. Scoring and the overlay can open on separate devices on the same private network. No hosting, database account, internet connection, or npm package installation is needed.

Requires **Node.js 22 or later**. The application does not install anything, launch other programs, change OBS settings, register startup tasks, or contact external services.

## Run

On Windows, double-click **Start-Scoreboard-LAN.cmd** to allow scoring and OBS from other devices. Keep the terminal window open. It prints the scoring URL and your access code.

Or run from this folder:

```powershell
npm run start:lan
```

For access on this computer only, double-click **Start-Scoreboard.cmd** or run `npm start`. The default port is 5080; change it with `npm run start:lan -- --port 5081`. Stop the server with Ctrl+C.

If Windows asks for firewall access, allow **Private networks**. Use a trusted network, not public or guest Wi-Fi. Remote devices must use the server's LAN address, not `localhost`.

## Scoring and OBS

| Purpose | On the server computer | On another device |
| --- | --- | --- |
| Scoring desk | `http://127.0.0.1:5080/scoring` | `http://<server-IP>:5080/scoring` |
| OBS Browser Source | `http://127.0.0.1:5080/overlay` | `http://<server-IP>:5080/overlay` |

1. Open the scoring desk and enter the access code printed in the terminal.
2. In **Match setup**, enter the teams and playing XIs in batting order. Blank places get placeholder names. Start the match and select the opening bowler.
3. In OBS, add a **Browser Source** with the overlay URL, width **1920**, height **1080**. Place it above your HD8 camera/program source. The background is transparent.
4. Use **Overlay studio** to change colours, title, size, margins and visibility. It keeps the original Classic scorebar style.

Your existing ATEM HD8 switching, camera inputs, commentary audio and YouTube streaming remain in your production setup. This app supplies the graphics only. Multiple scoring tabs and overlay displays can connect independently. The overlay is read-only and needs no login; changing scores requires the access code.

## Scoring controls

- Runs, wides, no balls with runs off the bat, byes, leg byes, wickets and run outs with completed runs.
- Bowler selection after each over, changing the newly arrived batter, and manual strike swaps.
- **Undo last action** includes deliveries, bowler selections and innings changes. Select a recent ball to correct it. If a correction would invalidate later actions, undo those actions first.
- Two innings with an automatic target and win/tie result. Ending an innings manually assumes it is complete; it does not model abandonment.
- Concurrent submissions are checked against the saved revision. When another tab saves first, review the refreshed score before retrying.

This is a display scorer for standard limited-overs matches, not a complete laws engine. It has no DLS, free-hit enforcement, penalty runs, retirement workflows, or combined no-ball/byes/wicket entry. Keep an official scorebook for unusual cases.

## Saved matches and access code

Each accepted action is written to **.local-scoreboard/match.json** before the on-air state changes. Restarting resumes that match. Starting a new match archives the previous one under **.local-scoreboard/archives/**.

**Export** downloads a match backup. To restore it, stop the app, keep a copy of the existing `match.json`, replace it with the export and restart. Never replace the file while the server is running. A corrupt saved file stops startup rather than silently overwriting your match.

The random access code is stored in **.local-scoreboard/access-code.txt**. Protect this folder; it is excluded from Git. To rotate the code, stop the app, replace that file with a unique code of at least eight characters, and restart. You can instead set `SCOREBOARD_PASSWORD` in the server environment. `SCOREBOARD_DATA_DIR` selects a different writable data folder.

## Security

- Localhost is the default; LAN access is explicit. Do not forward port 5080 to the internet or expose it through a tunnel.
- LAN HTTP is unencrypted. A trusted private network and unique access code are essential. Use a normal user account, not Administrator.
- All scoring changes, appearance changes and exports require an authenticated session. Sessions expire after 12 hours or when the server restarts. Repeated incorrect logins are limited.
- Devices that can reach the server can read match data and the graphics without logging in. There are no separate scorer/admin roles.
- Browser controls use same-origin requests and display typed names as text. The server checks allowed hostnames, rejects cross-origin writes, limits request size, and stores no external account credentials.
- This code has automated tests, but that is not a guarantee against every vulnerability. Keep Node.js updated and back up important match data.

## Development

```powershell
npm test
npm run check
```

`local/server.cjs` serves the app and saves matches; `local/scoring.cjs` contains the scoring rules; `local/public/` contains the scoring page and overlay. Tests cover scoring, undo/correction, persistence, authentication, concurrent submissions and independent displays. No third-party runtime dependencies are used.

## Attribution and licence

Derived from [CricketStream Overlay by Bridestowe & Belstone CC](https://github.com/BridestoweBelstoneCC/Cricket-Live-Stream). The manual scoring rules were adapted from its Go scoring engine, and the graphics retain its Classic scorebar appearance. This modified edition replaces the original application with a focused local Node.js runtime; the old Go application, integrations, assets and documentation have been removed.

This edition remains licensed under **GPL-3.0**. Retain this attribution and the accompanying [LICENSE](LICENSE) when distributing it.
