"""Resumable encrypted upload to the existing AnimeUta host (password stays in memory)."""
import concurrent.futures
import getpass
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.runtime/cloud-python'))
import paramiko

source = Path(sys.argv[1]).resolve()
workers = int(sys.argv[2]) if len(sys.argv) > 2 else 8
chunk_size = 32 * 1024 * 1024
size = source.stat().st_size
remote = '/home/ubuntu/animeuta-incoming/' + source.name + '.parts'
password = getpass.getpass('Server password: ')
progress = [0]
lock = threading.Lock()
handshakes = threading.BoundedSemaphore(3)
started = time.monotonic()

def connect():
    client = paramiko.SSHClient()
    client.load_host_keys(str(ROOT / '.runtime/cloud-known-hosts'))
    with handshakes:
        client.connect('server.example.invalid', username='ubuntu', password=password, timeout=30,
                       allow_agent=False, look_for_keys=False)
    client.get_transport().set_keepalive(20)
    return client

client = connect()
sftp = client.open_sftp()
try:
    sftp.mkdir('/home/ubuntu/animeuta-incoming', 0o700)
except OSError:
    sftp.stat('/home/ubuntu/animeuta-incoming')
try:
    sftp.mkdir(remote, 0o700)
except OSError:
    sftp.stat(remote)
sftp.close()
client.close()

def upload(index):
    offset = index * chunk_size
    count = min(chunk_size, size - offset)
    path = remote + f'/part-{index:05d}'
    for attempt in range(5):
        client = None
        try:
            client = connect()
            sftp = client.open_sftp()
            try:
                done = sftp.stat(path).st_size
            except OSError:
                done = 0
            if done != count:
                if done > count:
                    raise RuntimeError('Remote part exceeds expected size')
                with source.open('rb') as local, sftp.open(path, 'ab') as dest:
                    dest.set_pipelined(True)
                    local.seek(offset + done)
                    remaining = count - done
                    while remaining:
                        data = local.read(min(262144, remaining))
                        if not data:
                            raise RuntimeError('Unexpected EOF')
                        dest.write(data)
                        remaining -= len(data)
                if sftp.stat(path).st_size != count:
                    raise RuntimeError('Incomplete remote part')
            sftp.close()
            with lock:
                progress[0] += count
                print(json.dumps({'completeMiB': round(progress[0]/1024**2), 'totalMiB': round(size/1024**2),
                                  'averageMiBps': round(progress[0]/1024**2/(time.monotonic()-started), 2)}), flush=True)
            return
        except Exception:
            if attempt == 4:
                raise
            time.sleep(2 * (attempt + 1))
        finally:
            if client:
                client.close()

with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
    list(pool.map(upload, range(math.ceil(size/chunk_size))))
hash_value = hashlib.sha256()
with source.open('rb') as stream:
    for data in iter(lambda: stream.read(1024*1024), b''):
        hash_value.update(data)
client = connect()
command = f"cat {remote}/part-* > {remote}.complete && sha256sum {remote}.complete"
_, stdout, stderr = client.exec_command(command, timeout=300)
output = stdout.read().decode().strip()
status = stdout.channel.recv_exit_status()
if status or output.split()[0] != hash_value.hexdigest():
    raise RuntimeError('Remote archive verification failed')
client.close()
print(json.dumps({'verified': True, 'remoteArchive': remote + '.complete', 'sha256': hash_value.hexdigest()}), flush=True)
