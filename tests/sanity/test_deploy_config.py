"""Sanity checks on the deploy topology: two backends behind host nginx, drained
one at a time by scripts/deploy_remote.sh. These are text/config invariants - the
behavior is proven by scripts/test_nginx_failover.sh (needs docker) and, after a
deploy, by ./scripts/e2e.sh."""
import re
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NGINX_CONF = ROOT / "deploy" / "nginx" / "host-agents.enableyou.co.conf"
STATE_SH = ROOT / "scripts" / "nginx_backend_state.sh"


class DeployConfigSanityTests(unittest.TestCase):
    def test_every_backend_route_goes_through_the_two_backend_upstream(self):
        conf = NGINX_CONF.read_text()
        self.assertNotIn("127.0.0.1:8000;", conf.replace("server 127.0.0.1:8000", ""),
                         "a proxy_pass still points at a single hard-coded backend")
        passes = re.findall(r"proxy_pass\s+([^;]+);", conf)
        self.assertGreater(len(passes), 3)
        self.assertEqual(set(passes), {"http://enable_agents_backend"})
        block = re.search(r"upstream enable_agents_backend \{(.*?)\}", conf, re.S).group(1)
        self.assertIn("server 127.0.0.1:8000 ", block)
        self.assertIn("server 127.0.0.1:8001 ", block)

    def test_nginx_retries_and_fails_over_quickly(self):
        conf = NGINX_CONF.read_text()
        self.assertIn("proxy_next_upstream error timeout http_502 http_503;", conf)
        self.assertIn("proxy_connect_timeout", conf)
        # never retry a POST that already reached a backend (it could double-submit an email)
        self.assertNotIn("non_idempotent", conf)
        # a recovered backend must rejoin quickly (see the comment in the conf)
        for m in re.finditer(r"fail_timeout=(\d+)s", conf):
            self.assertLessEqual(int(m.group(1)), 5)

    def test_compose_defines_the_second_backend_on_8001(self):
        compose = (ROOT / "docker-compose.yml").read_text()
        self.assertIn("backend-remote-b:", compose)
        self.assertIn('"8001:8000"', compose)
        self.assertIn("enable_agents_backend_remote_b", compose)
        self.assertGreaterEqual(compose.count("--graceful-timeout 70"), 2)   # both remote backends drain in-flight requests
        self.assertIn("stop_grace_period: 75s", compose)

    def test_deploy_script_rolls_and_drains(self):
        deploy = (ROOT / "scripts" / "deploy_remote.sh").read_text()
        for needle in ("roll backend-remote-b", "roll backend-remote ", "drain \"$3\" down", "nginx_backend_state.sh",
                       "DEPLOY_ROLLING", "DEPLOY_MIN_FREE_MB"):
            self.assertIn(needle, deploy)
        self.assertLess(deploy.index("roll backend-remote-b"), deploy.index("roll backend-remote "),
                        "backend-remote-b must be restarted first")
        for script in ("deploy_remote.sh", "nginx_backend_state.sh", "test_nginx_failover.sh", "e2e.sh"):
            result = subprocess.run(["bash", "-n", str(ROOT / "scripts" / script)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, f"{script}: {result.stderr}")

    def test_drain_script_edits_only_the_named_backend_and_is_idempotent(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            conf = Path(tmp) / "agents.conf"
            shutil.copy(NGINX_CONF, conf)

            def lines():
                return {int(m.group(1)): m.group(0) for m in re.finditer(r"server 127\.0\.0\.1:(\d+)[^;]*;", conf.read_text())}

            def run(port, state):
                subprocess.run(["bash", str(STATE_SH), str(conf), port, state], check=True)

            run("8001", "down")
            self.assertNotIn(" down", lines()[8000])
            self.assertIn("server 127.0.0.1:8001 down ", lines()[8001])
            run("8001", "down")                                   # idempotent: never "down down"
            self.assertEqual(lines()[8001].count("down"), 1)
            run("8000", "down")
            self.assertIn(" down", lines()[8000]) and self.assertIn(" down", lines()[8001])
            run("all", "up")
            self.assertNotIn("down", lines()[8000] + lines()[8001])
            self.assertEqual(conf.read_text(), NGINX_CONF.read_text())   # up restores the tracked file byte for byte
            self.assertFalse(Path(str(conf) + ".bak").exists())
            self.assertNotEqual(subprocess.run(["bash", str(STATE_SH), str(conf), "8000", "sideways"],
                                               capture_output=True).returncode, 0)


if __name__ == "__main__":
    unittest.main()
