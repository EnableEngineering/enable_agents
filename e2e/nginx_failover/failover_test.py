"""Traffic through nginx (GET + POST) while the stand-in backends are restarted.
Driven by scripts/test_nginx_failover.sh, which builds the stack.

Phase 1 (gating): the deploy protocol - drain a backend (scripts/nginx_backend_state.sh + graceful
reload), stop it, start it, wait until it listens, put it back. Must lose ZERO requests.
Phase 2 (informational): an unplanned crash - the backend is just killed. nginx fails over on its own,
but a POST already sent to the dying backend cannot be retried safely, so a few failures are expected.
"""
import collections
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

URL = "http://localhost:18080"
SITE_CONF = os.environ["SITE_CONF"]
STATE_SH = os.environ["STATE_SH"]
NX = os.environ.get("NX", "enable_nx")
B1, B2 = os.environ.get("B1", "enable_b1"), os.environ.get("B2", "enable_b2")
PORTS = {B1: 8000, B2: 8001}    # the stand-ins run inside nginx's network namespace, so these are its 127.0.0.1 ports


def dock(*a):
    subprocess.run(["docker", *a], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)


def state(port, s):
    subprocess.run(["bash", STATE_SH, SITE_CONF, str(port), s], check=True)
    time.sleep(0.3)
    dock("exec", NX, "nginx", "-s", "reload")     # graceful: in-flight requests finish
    time.sleep(0.7)


def wait_listening(port, deadline=40):
    end = time.time() + deadline
    while time.time() < end:
        r = subprocess.run(["docker", "exec", NX, "wget", "-qO-", "-T", "1", f"http://127.0.0.1:{port}/"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if r.returncode == 0:
            return
        time.sleep(0.3)
    raise SystemExit(f"backend on :{port} never came up")


def run_phase(name, script):
    results, lock, stop = [], threading.Lock(), threading.Event()
    t0 = time.time()

    def worker(kind):
        while not stop.is_set():
            t = time.time() - t0
            try:
                if kind == "GET":
                    r = urllib.request.urlopen(URL + "/ready", timeout=6)
                else:
                    r = urllib.request.urlopen(urllib.request.Request(URL + "/login", data=b"{}", method="POST"), timeout=6)
                status, body = r.status, r.read().decode()
            except urllib.error.HTTPError as e:
                status, body = e.code, ""
            except Exception as e:
                status, body = 0, type(e).__name__
            with lock:
                results.append((t, kind, status, body))
            time.sleep(0.02)

    threads = [threading.Thread(target=worker, args=(k,)) for k in ("GET", "GET", "GET", "POST", "POST")]
    [t.start() for t in threads]
    time.sleep(3)
    script()
    time.sleep(3)
    stop.set()
    [t.join() for t in threads]
    bad = [r for r in results if r[2] != 200]
    served = collections.Counter(r[3] for r in results if r[2] == 200)
    print(f"\n{name}: {len(results)} requests (GET {sum(1 for r in results if r[1] == 'GET')}, "
          f"POST {sum(1 for r in results if r[1] == 'POST')}), failed {len(bad)}, served by {dict(served)}")
    if bad:
        print("  failures:", collections.Counter((r[1], r[2]) for r in bad))
    return bad


def planned():
    for name in (B1, B2):
        port = PORTS[name]
        print(f"  drain {name} (:{port}) -> stop -> start -> undrain", flush=True)
        state(port, "down")
        time.sleep(1)                     # in-flight requests on it finish
        dock("stop", "-t", "0", name)
        time.sleep(2)
        dock("start", name)
        wait_listening(port)
        state(port, "up")
        time.sleep(2)


def unplanned():
    for name in (B1, B2):
        print(f"  kill {name} without draining", flush=True)
        dock("stop", "-t", "0", name)
        time.sleep(4)
        dock("start", name)
        wait_listening(PORTS[name])
        time.sleep(3)


wait_listening(8000)
wait_listening(8001)
for _ in range(60):                       # every nginx worker has to have seen both peers
    urllib.request.urlopen(URL + "/ready", timeout=3).read()

bad_planned = run_phase("PLANNED restart (the deploy protocol)", planned)
run_phase("UNPLANNED crash (informational)", unplanned)
print("\nRESULT:", "PASS - the deploy protocol lost no requests" if not bad_planned else f"FAIL - {len(bad_planned)} request(s) lost during planned restarts")
sys.exit(1 if bad_planned else 0)
