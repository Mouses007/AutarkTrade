# ── Build-Stage ──────────────────────────────────────────────
FROM node:20-slim AS builder

# Build-Tools für native Module (better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build
# Lizenztexte der Pakete, die wirklich im Image landen (vor dem prune: das Skript
# liest package-lock.json und node_modules, Dev-Pakete lässt es selbst aus).
RUN node scripts/drittlizenzen.mjs
RUN npm prune --omit=dev

# ── Production-Stage ────────────────────────────────────────
FROM node:20-slim

# Keine Schriftpakete mehr: die Share-Card setzt seit S10 der Browser zusammen
# (sharp/libvips ist raus, NOTICE.md).
LABEL org.opencontainers.image.title="AutarkTrade" \
      org.opencontainers.image.licenses="LicenseRef-AutarkTrade-proprietary" \
      org.opencontainers.image.source="https://github.com/Mouses007/AutarkTrade"

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
# Lizenzbedingungen, Hinweise und Drittlizenzen: Pflicht im Image, und der Dialog
# „Rechtliches" liest sie zur Laufzeit (server/rechtliches.js).
COPY LICENSE NOTICE.md HAFTUNGSAUSSCHLUSS.md ./
COPY --from=builder /app/THIRD-PARTY-NOTICES ./
# server/ gehört dem Dienstbenutzer: der Strategie-Baukasten legt dort
# erzeugte Strategien ab (strategy-builder.js). node_modules und dist bleiben
# root — die App liest sie nur.
COPY --chown=node:node server/ ./server/
# Von Server und Frontend gemeinsam genutzte Logik (Orderbuch-Sync, Preis-Binning)
COPY shared/ ./shared/
COPY src/assets/icon.png ./src/assets/icon.png
COPY index.mjs ./
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh \
    && mkdir -p /app/data && chown node:node /app /app/data

ENV AT_HOST=0.0.0.0
ENV AT_PORT=8080
# Erzwingt AT_SECRET (server/crypto.js bricht sonst ab): ohne gesetztes
# Secret wären die verschlüsselten API-Schlüssel an einen ableitbaren
# Maschinen-Fallback gebunden.
ENV NODE_ENV=production
EXPOSE 8080

# Die App läuft als `node` (uid 1000), nicht als root (Audit A2-10, F2
# 20.10.2026). Der Einstieg startet als root, nur um db-config.json zu
# schreiben und die Eigentümer eines BESTEHENDEN Datenvolumes nachzuziehen
# (ältere Installationen haben es als root angelegt — ohne das wäre die
# SQLite-Datei nach dem Update nicht mehr schreibbar), und gibt die Rechte dann
# per `setpriv` ab. Bewusst ohne `USER`-Zeile: sonst könnte der Einstieg ein
# altes Volume nicht übernehmen.
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "index.mjs"]
