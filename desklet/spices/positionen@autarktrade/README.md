# AutarkTrade-Desklet (Positionen)

Shows your open positions and running bots from a self-hosted
AutarkTrade
instance directly on your desktop, with live PnL — grouped by exchange.

## Features
- Open futures positions from **Bitunix** and **Bitget**, plus running **Pionex** bots
- Grouped per exchange with a per-broker summed PnL
- Per position: symbol, side (LONG/SHORT/NEUTRAL), leverage, entry/mark price,
  unrealized & realized PnL; bots show entry/liquidation and PnL in the margin coin
- Auto-refreshes on a configurable interval (default 30 s)
- Adjustable font sizes, background opacity and width

## Requirements
- A running **AutarkTrade** instance reachable from this machine
  (LAN or VPN).
- An **ESP32 API key** from AutarkTrade: open **Settings → External displays
  (ESP32 / Widget / Desklet)** and generate a key. The desklet uses AutarkTrade's
  read-only, key-authenticated endpoint, so it keeps working even when the
  app's optional password protection is enabled.

## Setup
1. Add the desklet to your desktop (right-click desktop → *Add Desklets*).
2. Right-click the desklet → *Configure* and enter:
   - **Server host / IP** (e.g. `192.168.178.100`) and **port** (default `8080`)
   - **ESP32 API key** (from the AutarkTrade settings above)
   - Optional: refresh interval, which columns to show, font sizes, opacity, width
3. **Encrypted (HTTPS, port 8443)** is on by default. Pair once:
   press **1. Fetch server certificate** — the desklet fetches the AutarkTrade CA over
   `http://host:8080/api/esp32/ca` and shows its SHA-256 fingerprint. Compare it with
   **Settings › General › HTTPS** in the AutarkTrade web app; only if it matches press
   **2. Fingerprint matches — pair**. The certificate is stored (mode 0600) next to the
   desklet settings, and from then on the desklet talks HTTPS to port 8443 and trusts
   only that certificate — never the system CAs, and never falling back to plain HTTP.
   If the server's certificate changes, the desklet says „Certificate does not match —
   pair again"; repeat the two steps. Switching HTTPS off sends the API key unencrypted
   (only for a trusted LAN/VPN).

## Licence
MIT (`LICENSE` in the desklet folder). The desklet is a separate program; AutarkTrade itself is under its own licence.
