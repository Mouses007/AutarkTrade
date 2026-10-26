# ── Build-Stage ──────────────────────────────────────────────
# Node 22 LTS (Audit SEC-OPS-001: Node 20 ist seit 30.04.2026 ohne Sicherheitsupdates).
# better-sqlite3 wird hier per `npm ci` gegen genau diese Node-Version gebaut.
FROM node:22-slim AS builder

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
FROM node:22-slim

# Keine Schriftpakete mehr: die Share-Card setzt seit S10 der Browser zusammen
# (sharp/libvips ist raus, NOTICE.md).
LABEL org.opencontainers.image.title="AutarkTrade" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.source="https://github.com/Mouses007/AutarkTrade"

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
# Lizenzbedingungen, Hinweise und Drittlizenzen: Pflicht im Image, und der Dialog
# „Rechtliches" liest sie zur Laufzeit (server/rechtliches.js).
COPY LICENSE NOTICE.md HAFTUNGSAUSSCHLUSS.md ./
COPY --from=builder /app/THIRD-PARTY-NOTICES ./
# Alles unter /app gehört root, die App liest es nur (Audit SEC-OPS-004: gehörte
# /app dem Dienstbenutzer, könnte er jeden Eintrag ersetzen — auch den Einstieg,
# der beim nächsten Start als root läuft). Schreibbar für `node` sind nur
# /app/data und server/strategies (der Strategie-Baukasten legt dort erzeugte
# Strategien ab, strategy-builder.js).
COPY server/ ./server/
# Von Server und Frontend gemeinsam genutzte Logik (Orderbuch-Sync, Preis-Binning)
COPY shared/ ./shared/
COPY src/assets/icon.png ./src/assets/icon.png
COPY index.mjs ./
COPY docker-entrypoint.sh ./
# db-config.json und die SQLite-Dateien liegen im Datenordner; die Verweise im
# Projektordner gehören root, damit server/db-config.js die gewohnten Pfade
# behält und `node` die Dateien dort trotzdem schreiben kann. SQLite löst den
# Verweis auf (-wal/-shm entstehen im Datenordner).
RUN chmod 755 docker-entrypoint.sh \
    && mkdir -p /app/data \
    && chown root:root /app && chmod 755 /app \
    && chown node:node /app/data /app/server/strategies \
    && ln -s /app/data/db-config.json /app/db-config.json \
    && ln -s /app/data/autarktrade.db /app/autarktrade.db \
    && ln -s /app/data/tradenote.db /app/tradenote.db

ENV AT_HOST=0.0.0.0
ENV AT_PORT=8080
# Erzwingt AT_SECRET (server/crypto.js bricht sonst ab): ohne gesetztes
# Secret wären die verschlüsselten API-Schlüssel an einen ableitbaren
# Maschinen-Fallback gebunden.
ENV NODE_ENV=production
EXPOSE 8080 8443

# Die App läuft als `node` (uid 1000), nicht als root (Audit A2-10, F2
# 20.10.2026). Der Einstieg startet als root, nur um db-config.json zu
# schreiben und die Eigentümer eines BESTEHENDEN Datenvolumes nachzuziehen
# (ältere Installationen haben es als root angelegt — ohne das wäre die
# SQLite-Datei nach dem Update nicht mehr schreibbar), und gibt die Rechte dann
# per `setpriv` ab. Bewusst ohne `USER`-Zeile: sonst könnte der Einstieg ein
# altes Volume nicht übernehmen.
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "index.mjs"]
