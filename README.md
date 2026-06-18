# Dance Battle Scoring App

Real-time scoring app for live dance battles. Judges score on their phones, MC controls the flow, results display on a big screen.

## Setup

```bash
npm install
node server.js
```

Server runs on `http://localhost:3000`

## URLs

| Screen     | URL                | Who uses it                |
|------------|---------------------|-----------------------------|
| Judge      | `/judge.html`        | Each judge, on their phone |
| MC         | `/mc.html`           | The host / MC               |
| Display    | `/display.html`      | Big screen / projector      |
| Scorecards | `/scorecards.html`   | Full historical breakdown   |

## How it works

1. MC opens `/mc.html`, sets event name, corner names, number of judges, optional password, and whether round winners should flash on the display
2. Judges open `/judge.html`, enter their name (and password if set) — no more than the configured number of judges can connect
3. MC can't open voting until all judge slots show as connected
4. MC clicks **Open Voting** — judges see the scoring form
5. Judges score 1–5 for each criterion, for both corners — they can amend their scores any time before the MC locks voting
6. MC can't reveal results until all judges have submitted
7. MC clicks **Lock Voting**, then **Reveal Result**
8. MC clicks **Next Round** for another round in the same battle
9. Once all rounds in the battle are played, MC clicks **Reveal Battle Winner** to show the combined result across all rounds
10. MC clicks **New Battle** when two new dancers step up — resets the round counter and battle tally, keeps all history

## Scoring

- 5 criteria: Musicality, Technique, Creativity, Execution, Performance
- Each scored 1–5 per corner, per judge
- Tie only if final totals are exactly equal
- All scores are saved permanently — view them anytime on the Round History or Scorecards page

## Multi-round battles

Set "Rounds in This Battle" on the New Battle card (1–5). After each round is revealed, its score is added to a running Battle Tally shown on the MC panel. Once all rounds are complete, click **Reveal Battle Winner** to show the cumulative winner on the display.

Toggle "Show Round Winners on Display" off if you want to build suspense — the display will just say "Round X Complete" after each round instead of revealing who won, saving the big reveal for the final battle winner.

## Judge slots

Setting "Number of Judges" to 3 means exactly 3 judges can connect — no more, no less. A 4th person trying to join sees "All Judge Slots Are Full." The MC cannot open voting until all 3 slots show as connected.

## On the day (same WiFi)

Find your machine's local IP:

```bash
# Mac/Linux
ifconfig | grep "inet "
# Windows
ipconfig
```

Share `http://YOUR_IP:3000/judge.html` with judges, e.g. as a QR code.

## Deploy to the internet (Render)

1. Push this folder to a GitHub repo
2. Go to render.com → New Web Service → connect your repo
3. Build command: `npm install`
4. Start command: `node server.js`
5. Share the Render URL with your judges

## Customise criteria

Edit the `CRITERIA` array near the top of `server.js`:

```js
const CRITERIA = [
  'Musicality',
  'Technique',
  'Creativity',
  'Execution',
  'Performance'
]
```
