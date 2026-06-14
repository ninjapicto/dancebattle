# Dance Battle Scoring App

Real-time scoring app for live dance battles. Judges score on their phones, MC controls the flow, result displays on a big screen.

## Setup

```bash
npm install
npm start
```

Server runs on `http://localhost:3000`

## URLs

| Screen | URL | Who uses it |
|--------|-----|-------------|
| Judge  | `/judge.html` | Each judge on their phone |
| MC     | `/mc.html`    | The host / MC |
| Display | `/display.html` | Big screen / projector |

## How it works

1. MC opens `/mc.html`, sets event name and corner names
2. Judges open `/judge.html` on their phones and enter their name
3. Display screen opens `/display.html` (full screen on the TV)
4. MC clicks **Open voting** → judges see the scoring form
5. Judges score each criterion (1–5) for both Red and Blue corners
6. MC can see how many judges have submitted (dots light up)
7. MC clicks **Lock voting** when ready
8. MC clicks **Reveal result** → display screen flashes red or blue
9. MC clicks **Next round** to reset for the next battle

## Scoring

- 5 criteria: Musicality, Technique, Creativity, Execution, Performance
- Each scored 1–5 per corner
- Max score per judge: 25 per corner
- Max total: 75 per corner (3 judges)
- Tie only if final totals are exactly equal

## On the day (same WiFi)

To let judges and the display connect over your local network, find your machine's local IP:

```bash
# Mac/Linux
ifconfig | grep "inet "

# Windows
ipconfig
```

Then share `http://YOUR_IP:3000/judge.html` with judges (e.g. as a QR code).

## Deploy to the internet (Render)

1. Push this folder to a GitHub repo
2. Go to render.com → New Web Service → connect your repo
3. Build command: `npm install`
4. Start command: `npm start`
5. Done — share the Render URL with your judges

## Customise criteria

Edit the `CRITERIA` array in `server.js`:

```js
const CRITERIA = [
  'Musicality',
  'Technique', 
  'Creativity',
  'Execution',
  'Performance'
]
```
