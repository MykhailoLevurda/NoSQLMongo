#!/bin/bash
# init-keyfile.sh
# Generuje náhodný MongoDB keyfile pro interní autentizaci členů clusteru.
# Keyfile se uloží do sdíleného volume /keyfile.
# Spouští se jednou jako init kontejner před startem všech MongoDB uzlů.

set -e

KEYFILE_PATH="/keyfile/mongo-keyfile"

echo "[keyfile-init] Generuji MongoDB keyfile..."

# openssl rand -base64 756 vytváří kryptograficky bezpečný 756-bajtový keyfile
# (MongoDB vyžaduje délku 6–1024 bajtů, doporučeno 756)
openssl rand -base64 756 > "$KEYFILE_PATH"

# MongoDB vyžaduje oprávnění 400 (pouze vlastník může číst)
chmod 400 "$KEYFILE_PATH"

# UID 999 = uživatel mongodb v oficiálním mongo obrazu
chown 999:999 "$KEYFILE_PATH"

echo "[keyfile-init] Keyfile úspěšně vygenerován: $KEYFILE_PATH"
echo "[keyfile-init] Oprávnění: $(stat -c '%a %U' $KEYFILE_PATH)"
