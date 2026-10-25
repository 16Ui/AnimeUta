#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" -eq 0
base=/opt/animeuta
incoming=/home/ubuntu/animeuta-incoming
release=$base/releases/initial-20261024
test ! -e "$base/shared/data/animeuta.sqlite" || { echo 'Refusing to overwrite existing cloud database'; exit 1; }
test ! -e "$release"
install -d -m 700 "$incoming/extracted"
tar -xzf "$incoming/app-data-20261024.tar.gz.parts.complete" -C "$incoming/extracted"
node --input-type=module - "$incoming/extracted" <<'JS'
import {readFileSync, createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const root=process.argv[2];
const manifest=JSON.parse(readFileSync(join(root,'manifest.json')));
for(const f of manifest.files) {
  if(f.path.startsWith('shared/music/') || f.path.startsWith('shared/dictionaries/')) continue;
  const hash=createHash('sha256');
  for await(const part of createReadStream(join(root,f.path))) hash.update(part);
  if(hash.digest('hex')!==f.sha256) throw new Error('Checksum mismatch: '+f.path);
}
console.log('Core data checksums verified');
JS
mv "$incoming/extracted/release" "$release"
rsync -a "$incoming/extracted/shared/" "$base/shared/"
install -m 600 "$incoming/extracted/manifest.json" "$base/backups/initial-manifest.json"
cp "$base/shared/data/animeuta.sqlite" "$base/backups/before-first-start.sqlite"
cd "$release/backend"
npm ci --omit=dev --no-audit --no-fund
chown -R root:animeuta "$release"
chmod -R g+rX,o+rX "$release"
chown -R animeuta:animeuta "$base/shared/data" "$base/shared/media"
chown root:animeuta "$base/shared/backend.env"
chmod 640 "$base/shared/backend.env"
ln -s "$release" "$base/current"
install -m 644 "$release/deploy/animeuta.service" /etc/systemd/system/animeuta.service
install -m 644 "$release/deploy/nginx-local.conf" /etc/nginx/sites-available/animeuta-local
if [ -L /etc/nginx/sites-enabled/default ]; then unlink /etc/nginx/sites-enabled/default; fi
ln -sfn /etc/nginx/sites-available/animeuta-local /etc/nginx/sites-enabled/animeuta-local
nginx -t
systemctl daemon-reload
systemctl unmask nginx
systemctl enable --now animeuta nginx
for attempt in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:8090/health; then echo CORE_DEPLOYED; exit 0; fi
  sleep 2
done
exit 1
