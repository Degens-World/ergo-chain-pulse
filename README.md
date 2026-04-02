# 💓 Ergo Chain Pulse

## Live Demo

**[https://ad-ergo-chain-pulse-1775099458942.vercel.app](https://ad-ergo-chain-pulse-1775099458942.vercel.app)**

## Features

- **EKG heartbeat canvas** — animated waveform showing recent block times; each spike = one block
- **Network health score** — composite 0–100 score across regularity, freshness, throughput, and consistency
- **Live stats** — block height, avg block time, estimated hashrate, difficulty, tx count, ERG price
- **Recent blocks table** — last 15 blocks with timing, tx count, size, and miner info
- **Auto-refresh** every 30 seconds with animated status dot

## Data Sources

- [Ergo Explorer API](https://api.ergoplatform.com) — blocks, difficulty, transactions
- [CoinGecko](https://coingecko.com) — ERG/USD price

## Usage

Open `index.html` in any modern browser. No build step, no API key required.

## Health Score Breakdown

| Component | Weight | Meaning |
|-----------|--------|---------|
| Regularity | /35 | How close avg block time is to 120s target |
| Freshness | /25 | How recently the last block arrived |
| Throughput | /20 | Transactions per block |
| Consistency | /20 | Low variance in block times |

## Tech Stack

Plain HTML / CSS / Canvas — zero dependencies.
