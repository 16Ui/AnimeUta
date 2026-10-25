#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo 'Run with sudo bash cloud-bootstrap.sh' >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get --with-new-pkgs upgrade -y
apt-get install -y ca-certificates curl xz-utils sqlite3 rsync

# Use an official Node release and verify its published checksum.
install -d -m 755 /opt/animeuta/tools /opt/animeuta/releases
work=$(mktemp -d /opt/animeuta/tools/node-install.XXXXXX)
trap 'rm -rf -- "$work"' EXIT
cd "$work"
curl --fail --location --retry 3 -o SHASUMS256.txt https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt
archive=$(awk '$2 ~ /^node-v22\.[0-9]+\.[0-9]+-linux-x64.tar.xz$/ {print $2}' SHASUMS256.txt)
test -n "$archive"
curl --fail --location --retry 3 -O "https://nodejs.org/dist/latest-v22.x/$archive"
grep " $archive$" SHASUMS256.txt | sha256sum --check -
tar -xJf "$archive" -C /opt/animeuta/tools
ln -sfn "/opt/animeuta/tools/${archive%.tar.xz}" /opt/animeuta/tools/node
ln -sfn /opt/animeuta/tools/node/bin/node /usr/local/bin/node
ln -sfn /opt/animeuta/tools/node/bin/npm /usr/local/bin/npm
ln -sfn /opt/animeuta/tools/node/bin/npx /usr/local/bin/npx

id animeuta >/dev/null 2>&1 || useradd --system --home-dir /opt/animeuta --shell /usr/sbin/nologin animeuta
install -d -o animeuta -g animeuta -m 750 /opt/animeuta/shared /opt/animeuta/shared/data /opt/animeuta/shared/media /opt/animeuta/shared/music /opt/animeuta/shared/dictionaries /opt/animeuta/backups

node --version
npm --version
node --input-type=module -e "import {DatabaseSync} from 'node:sqlite'; const db = new DatabaseSync(':memory:'); console.log(db.prepare('select 1 as sqlite_ready').get()); db.close();"
df -h /opt/animeuta
if [ -f /var/run/reboot-required ]; then echo REBOOT_REQUIRED; fi
echo ANIMEUTA_BASE_READY
