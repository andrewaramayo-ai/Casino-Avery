# Casino Avery — Live Multiplayer Update

One shared live blackjack table for up to six seated players, plus spectators. The dealer and the deck run on the Node.js server. Virtual chips only: **no real money, prizes, or cashouts**.

## Update your existing GitHub + Render website (same URL)

1. Download and extract the ZIP. Open the `casino-avery-online` folder.
2. Open your existing **Casino-Avery** GitHub repository and click **Add file → Upload files**.
3. Drag in the **contents** of the extracted folder, preserving the `public/` folder and its contents. Replace the existing `server.js`, `public/index.html`, and `README.md` files. If GitHub's web uploader doesn't conveniently replace files, open each existing file, click **Edit** (pencil), paste the updated file contents, and **Commit changes**. Alternatively use GitHub Desktop to copy the updated files into your repository and **Commit → Push**.
4. Render should deploy the new `main` commit automatically if auto-deploy is enabled. Otherwise, open your existing Render service and select **Manual Deploy → Deploy latest commit**.
5. Wait for **Live**, refresh your original site (hard refresh: Ctrl+Shift+R), and ask friends to refresh. **Do not create another Render service.**

For easier ongoing updates, **GitHub Desktop** (https://desktop.github.com/) is recommended: clone the repository, overwrite the changed files in that local folder, commit, then push.

### Important

A deployment restarts the running Node service: active hands, seats, and virtual balances reset. Warn friends and deploy between games. The software is not yet backed by a database.

## New table features

- **30-second turn countdown**. Timer resets each time a player hits without busting, and at every new turn. On expiry the server automatically stands.
- **Disconnected players:** their active-turn timer is shortened to at most 8 seconds. Reconnecting with the same browser token resumes their seat.
- **Host controls:** first seated connected player becomes host. Host can remove a player **between rounds**. Host role transfers to another connected seated player if the host disconnects.
- **S17/H17 switch:** host chooses whether the dealer **stands on soft 17** (default) or **hits soft 17**, between rounds.
- **Perfect Pairs** side bet: based on each player's first two cards, paying 6:1 mixed suit color, 12:1 same color, or 25:1 identical rank/suit.
- **21+3** side bet: player's first two cards + dealer's upcard. Flush pays 5:1, straight 10:1, three of a kind 30:1, straight flush 40:1. Highest qualifying category only. A-2-3 and Q-K-A straights are supported.
- Side bets are optional whole-dollar amounts from $0 to $500 each and are deducted and settled independently of the main hand. Winnings return the original side-bet stake in addition to the listed odds.

## Existing game rules

- Six-deck shoe, blackjack pays 3:2, dealer hits through 16.
- Double down on any first two cards; split equal-rank pairs up to four hands per player. Split aces receive one card each and split 21 is not a natural blackjack.
- One public shared table; each seat has its own temporary bankroll.

## Running locally

```sh
npm install
npm start
```

Open http://localhost:3000. The public website requires a Node.js host with WebSocket support (such as Render). Voice uses device text-to-speech and may not sound like the portrait subject.
