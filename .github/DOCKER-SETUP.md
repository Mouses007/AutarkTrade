# Container-Image veröffentlichen (Maintainer)

Betrifft nur die Veröffentlichung des Images über GitHub Actions.
Wer den Container benutzt, liest [DOCKER.md](../DOCKER.md).

## Wohin

Ausschliesslich **`ghcr.io/mouses007/autarktrade`** — das Paket gehört zum privaten
Repo `Mouses007/AutarkTrade` und ist damit privat. Kein Docker Hub: ein öffentliches
Image wäre eine Weitergabe ohne Lizenz.

| Auslöser | Tags | Architekturen |
|---|---|---|
| Actions → **Docker publish** → *Run workflow* | `:edge` | amd64, arm64 |
| Tag `v4.1.0` pushen | `:4.1.0`, `:4.1`, `:latest` | amd64, arm64 |
| Tag mit Vorabkennung `v4.1.0-beta.1` | `:4.1.0-beta.1` (kein `:latest`) | amd64, arm64 |

Das Workflow-Token (`GITHUB_TOKEN`, `packages: write`) reicht zum Schreiben; es
braucht keine weiteren Geheimnisse.

## Ziehen

Wer ziehen will, braucht einen **klassischen** GitHub-Token mit `read:packages`
(fein granulierte Tokens können keine Pakete lesen):

```bash
echo "$TOKEN" | docker login ghcr.io -u <github-benutzer> --password-stdin
docker pull ghcr.io/mouses007/autarktrade:latest
```

Kunden bekommen diesen Zugang über das Feld `zugang` im Lizenzschlüssel
(`scripts/lizenz-ausstellen.mjs`); der Update-Knopf (`server/update-api.js`) meldet
sich damit an, ohne den Token auf die Befehlszeile zu legen. Er zieht das Image, mit
dem der Container läuft, und nur ein Release, das an oder vor `updatesBis` erschien.

## Release

1. `package.json` → `version` hochsetzen, committen, auf `master` pushen.
2. `git tag v4.1.0 && git push origin v4.1.0`.
3. Workflow abwarten (~5 min für beide Architekturen), dann auf GitHub ein Release
   zum Tag anlegen — die Update-Prüfung liest `releases/latest`, nicht die Tags.

## Testcontainer

`scripts/v2-container.sh` baut lokal `autarktrade:v2-test` und startet
`autarktrade-v2` auf Port 8091 gegen die Datenkopie, immer im Testbetrieb. Er braucht
die Registry nicht.
