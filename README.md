# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/CoffeeTea-VN/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/CoffeeTea-VN/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Peer Radar: a token launch radar that prices every rankable pre-token protocol in the snapshot off the tokened peers in its own category — implied value = TVL × the category's median market-cap/TVL × a growth factor × a maturity factor — and applies the watchlist's own product rule at every size, so wrapped, staked and bridged products of tokens that already trade are never ranked as launch candidates. All 198 rows carry their own arithmetic and a seven-step farm plan sized by the protocol's TVL, routed over the cheapest chain it runs on, and held for a window set by its age. The dashboard is sortable, filterable and deep-linkable, with a detail view that takes each price apart.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <dir holding snapshot.json>
```

Writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the output directory.

---

<sub>Entered on [make.fun](https://make.fun/?ref=cuteo&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
