import unittest
from pathlib import Path


class RepositorySanityTests(unittest.TestCase):
    def setUp(self):
        self.repo_root = Path(__file__).resolve().parents[2]

    def test_shell_scripts_are_in_scripts_folder(self):
        # Only the repo's own files count: skip vendored/generated trees and
        # hidden dirs (.git, local .repo-agent worktrees - other checkouts of
        # this repo, not part of it). The root run.sh is a documented
        # one-line wrapper that execs scripts/run.sh.
        vendored = {"venv", "node_modules", "build"}
        shell_files = []
        for path in self.repo_root.rglob("*.sh"):
            parts = path.relative_to(self.repo_root).parts
            if vendored.intersection(parts) or any(part.startswith(".") for part in parts):
                continue
            if path == self.repo_root / "run.sh":
                continue
            shell_files.append(path)
        self.assertGreater(len(shell_files), 0, "Expected at least one shell script.")
        # scripts/ at any depth (scripts/lib/common.sh is shared helper code).
        non_scripts_dir = [
            path for path in shell_files
            if "scripts" not in path.relative_to(self.repo_root).parts[:-1]
        ]
        self.assertEqual(
            non_scripts_dir,
            [],
            f"Shell files outside scripts/: {non_scripts_dir}",
        )

    def test_required_docs_exist(self):
        self.assertTrue((self.repo_root / "README.md").exists())
        self.assertTrue((self.repo_root / "docs" / "context.md").exists())
        self.assertTrue((self.repo_root / "docs" / "todo.md").exists())

    def test_run_script_exists(self):
        self.assertTrue((self.repo_root / "scripts" / "run.sh").exists())

    def test_canonical_env_templates_exist(self):
        self.assertTrue((self.repo_root / ".env.example").exists())
        self.assertTrue((self.repo_root / ".env.docker.example").exists())

    def test_legacy_env_templates_removed(self):
        self.assertFalse((self.repo_root / ".env.development").exists())
        self.assertFalse((self.repo_root / ".env.production").exists())
        self.assertFalse((self.repo_root / "agent-app" / ".env.example").exists())

    def test_backend_folder_exists(self):
        self.assertTrue((self.repo_root / "backend").is_dir())
        self.assertFalse(
            (self.repo_root / "tools").exists(),
            "tools/ should have been renamed to backend/",
        )

    def test_frontend_folder_exists(self):
        self.assertTrue((self.repo_root / "frontend").is_dir())
        self.assertFalse(
            (self.repo_root / "agent-app").exists(),
            "agent-app/ should have been renamed to frontend/",
        )

    def test_docker_compose_has_profiles(self):
        compose_file = self.repo_root / "docker-compose.yml"
        self.assertTrue(compose_file.exists())
        content = compose_file.read_text()
        self.assertIn('profiles: ["dev"]', content, "docker-compose.yml must define a dev profile")
        self.assertIn('profiles: ["prod"]', content, "docker-compose.yml must define a prod profile")

    def test_run_script_supports_dev_prod(self):
        run_sh = (self.repo_root / "scripts" / "run.sh").read_text()
        self.assertIn("dev)", run_sh)
        self.assertIn("prod)", run_sh)


if __name__ == "__main__":
    unittest.main()
