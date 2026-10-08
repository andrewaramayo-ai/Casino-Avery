# Casino Avery — one live online table

One shared blackjack table for everyone visiting the same website URL, with up to 6 occupied seats and any number of spectators. Everyone has an independent virtual bankroll. The dealer, deck, actions, and payouts are controlled by the Node.js server and broadcast in real time over WebSockets.

## Deploy on Render (not Netlify Drop)

1. Extract the ZIP. Upload **the files inside `casino-avery-online`** to a new GitHub repository (you should see `server.js`, `package.json`, and `public/` at its root).
2. At https://dashboard.render.com, create a **New > Web Service** and connect the GitHub repository.
3. Choose **Node**, **Build Command: `npm install`**, **Start Command: `npm start`**. Leave the default root directory blank if you uploaded the files at the repository root.
4. Create the service, wait for deployment, then share the single Render HTTPS URL. The WebSocket connection is on the same domain, so no additional configuration is needed.

You can choose another Node.js hosting provider that supports persistent WebSocket connections. Plans and pricing vary by provider.

## Run locally

```sh
npm install
npm start
```
Open http://localhost:3000 on your own computer. Friends on other networks cannot reach your localhost; you need to deploy the Node server for online play.

## How to play

- Enter a display name, then choose an available seat.
- Set an affordable virtual wager for your seat.
- Anyone seated can select **Deal everyone in** once at least one valid wager has been placed.
- On your turn, use Hit / Stand / Double / Split. Everyone sees the same cards and outcomes.
- When the round finishes, anyone seated can open the next round. You can reset your own bankroll between rounds.
- If you disconnect, your seat is kept for approximately 90 seconds so you can reconnect from the same browser. If you disconnect during an active round, the server keeps your seat until the round finishes.

## Limitations

- No real-money betting, prizes, accounts, or payouts.
- The server holds table state in memory. **Restarting the server resets everyone's bankroll, seating, and current hand.** Persistent storage can be added later.
- One shared table only, with a maximum of six seated players. No private rooms.
- Voice lines use browser text-to-speech when enabled; they are not recordings of the person in the picture.
- Browser audio generally needs a click before it will play.
- Deploying to a public host requires your own hosting/GitHub accounts. This ZIP is not itself a live public URL.
