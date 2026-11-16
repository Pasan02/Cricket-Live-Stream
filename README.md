# CricketStream — local scoreboard

A small native Node.js app for manual cricket scoring and a transparent OBS overlay. The server runs on your computer. Scoring and the overlay can open on separate devices on the same private network. No hosting, database account, internet connection, or npm package installation is needed.

Requires **Node.js 22 or later**. The application does not install anything, launch other programs, change OBS settings, register startup tasks, or contact external services.

## Run

On Windows, double-click **Start-Scoreboard-LAN.cmd** to allow scoring and OBS from other devices. Keep the terminal window open. It prints the scoring URL and your access code.

Or run from this folder:

```powershell
npm run start:lan
```

For access on this computer only, double-click **Start-Scoreboard.cmd** or run `npm start`. The default port is 5081; change it with `npm run start:lan -- --port 5082`. Stop the server with Ctrl+C.

If Windows asks for firewall access, allow **Private networks**. Use a trusted network, not public or guest Wi-Fi. Remote devices must use the server's LAN address, not `localhost`.

## Scoring and OBS

| Purpose | On the server computer | On another device |
| --- | --- | --- |
| Scoring desk | `http://127.0.0.1:5081/scoring` | `http://<server-IP>:5081/scoring` |
| OBS Browser Source | `http://127.0.0.1:5081/overlay` | `http://<server-IP>:5081/overlay` |

1. Open the scoring desk and enter the access code printed in the terminal.
2. In **Match setup**, enter the teams and playing XIs in batting order. Blank places get placeholder names. Start the match and select the opening bowler.
3. In OBS, add a **Browser Source** with the overlay URL, width **1920**, height **1080**. Place it above your HD8 camera/program source. The background is transparent.
4. Use **Overlay studio** to change colours, title, size, margins and visibility. It keeps the original Classic scorebar style.

In **Overlay studio → Team logos**, upload a PNG, JPEG, WebP, H.264 MP4 or VP8/VP9 WebM for each team (up to 5 MB). Images are resized to 256 × 256 with their proportions and transparency preserved, then saved inside your local match file. Logos update on connected displays immediately and follow the correct team when batting changes. Use **Replace logo** or **Remove** to change them. JSON match exports and archives include the logo media data; no separate media folder is needed.

The scorebar has larger team logo areas, with a default 56 px logo size and extra padding. Change **Team logo size** between 32 and 72 px to suit your artwork.

Under **Channel & sponsor logos**, upload separate images, H.264 MP4 or WebM videos for the **top-right channel** and **top-left sponsor** positions. Each has its own width, top margin, side margin and visibility setting in **Top corner logo placement**. Click **Apply to broadcast** to save those placement changes. Wide branding images keep their proportions; both corner logos are independent of the scorebar's size and visibility. They are also included in match exports and archives. After upgrading, refresh the OBS Browser Source once to load the new corner-logo elements.

Your existing ATEM HD8 switching, camera inputs, commentary audio and YouTube streaming remain in your production setup. This app supplies the graphics only. Multiple scoring tabs and overlay displays can connect independently. The overlay is read-only and needs no login; changing scores requires the access code.

Video logos play automatically, loop and stay muted in all four logo slots. Upload **H.264 MP4** or **VP8/VP9 WebM**, up to **5 MB**, **60 seconds** and **1920 x 1080**. WebM files must include duration metadata. Optional audio must be AAC for MP4 or Opus/Vorbis for WebM and is never played.

For transparent animated logos, upload a **WebM with an alpha channel**. The app saves and serves the original video bytes without conversion, resizing, padding or flattening. It adds no background to the video or its preview. An opaque background already encoded in a file remains. PNG and WebP also support transparent static artwork.

The server checks video container metadata, declared codecs, dimensions and duration, and serves videos locally with byte-range support. Keep clips small: embedded video data is included whenever the match is saved or exported. No FFmpeg or video conversion dependency is required. MOV uploads are not accepted; export your animation as WebM before uploading. After upgrading, restart the app and refresh scoring/OBS sources.

## Summary graphics

Add these **three separate Browser Sources** to three OBS scenes, each at **1920 x 1080**. Prefix each path with your server address, for example `http://192.168.1.10:5081`. The scoring desk has individual copy buttons.

| OBS scene | URL path | Graphic |
| --- | --- | --- |
| Innings scorecard | `/overlay?view=scorecard` | Batters, dismissals, runs, balls, boundaries, strike rate and bowling figures |
| Match summary | `/overlay?view=match` | Both innings, leading performers and the live situation or final result |
| Bowling analysis | `/overlay?view=bowling` | Overs, maidens, runs conceded, wickets and economy in bowling order |

Each URL stays on its own graphic; switch scenes or source visibility in OBS. The scorecard and bowling analysis follow the current innings independently of the main-source controls. Add `&innings=1` or `&innings=2` to pin a particular innings. An innings that has not begun shows a waiting message. Your existing live scorebar is still at `/overlay`.

Under **Optional: switch graphics on the main scorebar source**, you can change the main overlay instead. These buttons and the main-source innings selector do not change the three dedicated sources.

All three summary overlays use the original repository's **Franchise** styling: royal-purple gradients, gold totals and dividers, and **Barlow Condensed** typography. The existing two-innings match summary, full innings scorecard and bowling analysis keep their layouts and figures. Fonts are bundled locally with their SIL Open Font License, so OBS needs no internet font service. Team colours remain as small team accents; the scorebar panel/text colour controls apply to the live scorebar. Uploaded image, MP4 and WebM logos work on these graphics, with channel at the top right and sponsor at the top left. Refresh each OBS Browser Source after upgrading to load the new styles and fonts.

Labels use **Innings scorecard**, **Match summary** and **Bowling analysis**. Batters who have not appeared are **yet to bat** during the innings and **did not bat** after it ends. Bowling economy is runs conceded per over, calculated from legal balls. Figures update after corrections and undo.

This version uses port **5081** to avoid older instances still running on 5080. Update your OBS URL to `http://<server-IP>:5081/overlay`. Old scoring pages detect an incompatible server after refresh and open the new port. Close any old CricketStream terminals when convenient. Starting another copy on an occupied port is refused. Your existing `.local-scoreboard` match, logos and access code are preserved.

## Scoring controls

- Runs, wides, no balls with runs off the bat, byes, leg byes, wickets and run outs with completed runs.
- Bowler selection after each over, changing the newly arrived batter, and manual strike swaps.
- **Choose opening batters**, under the two current batters on the scoring desk, selects the striker (faces the first ball) and non-striker from the batting XI. Use it before the first delivery of either innings, including before any wides or no balls. The first two roster names remain the defaults. The remaining batting order is preserved, and opening selection can be undone.
- **Edit player names**, beside the opening-batter control, corrects all 11 names for either team at any stage, including after the match. Scores stay with the same players, and names update in batting, bowling, dismissals, saved deliveries and all overlays. Keep names unique within each team. These are name corrections; they do not reorder the players or reset the match. Scoring undo keeps corrected names; edit the names again to reverse a correction.
- **Undo last action** includes deliveries, bowler selections and innings changes. Select a recent ball to correct it. If a correction would invalidate later actions, undo those actions first.
- Two innings with an automatic target and win/tie result. Ending an innings manually assumes it is complete; it does not model abandonment.
- Concurrent submissions are checked against the saved revision. When another tab saves first, review the refreshed score before retrying.

This is a display scorer for standard limited-overs matches, not a complete laws engine. It has no DLS, free-hit enforcement, penalty runs, retirement workflows, or combined no-ball/byes/wicket entry. Keep an official scorebook for unusual cases.

## Saved matches and access code

Each accepted action is written to **.local-scoreboard/match.json** before the on-air state changes. Restarting resumes that match. Starting a new match archives the previous one under **.local-scoreboard/archives/**.

**Export** downloads a match backup. To restore it, stop the app, keep a copy of the existing `match.json`, replace it with the export and restart. Never replace the file while the server is running. A corrupt saved file stops startup rather than silently overwriting your match.

The random access code is stored in **.local-scoreboard/access-code.txt**. Protect this folder; it is excluded from Git. To rotate the code, stop the app, replace that file with a unique code of at least eight characters, and restart. You can instead set `SCOREBOARD_PASSWORD` in the server environment. `SCOREBOARD_DATA_DIR` selects a different writable data folder.

## Security

- Localhost is the default; LAN access is explicit. Do not forward port 5081 to the internet or expose it through a tunnel.
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
