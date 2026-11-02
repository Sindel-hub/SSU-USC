"""Uses disposable local files only; no production token or secret is loaded."""
import pathlib
import re
import stat
import subprocess
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / 'scripts/prepare-gmail-login-secret.py'


class SecretPreparation(unittest.TestCase):
    def test_private_value_not_printed(self):
        with tempfile.TemporaryDirectory() as root:
            dest = pathlib.Path(root) / 'secret.env'
            result = subprocess.run(['python3', str(SCRIPT), '--output', str(dest)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0)
            content = dest.read_text()
            self.assertTrue(bool(re.fullmatch(r'GMAIL_LOGIN_RATE_LIMIT_SECRET=[a-f0-9]{64}\n', content)), 'Secret format invalid (value redacted)')
            self.assertEqual(stat.S_IMODE(dest.stat().st_mode), 0o600)
            self.assertTrue(content.strip().split('=', 1)[1] not in result.stdout + result.stderr, 'Secret output detected (value redacted)')

    def test_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as root:
            dest = pathlib.Path(root) / 'secret.env'
            dest.write_text('synthetic-existing-key')
            result = subprocess.run(['python3', str(SCRIPT), '--output', str(dest)], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertTrue(dest.read_text() == 'synthetic-existing-key', 'Existing file changed')

    def test_refuses_repository_output(self):
        with tempfile.TemporaryDirectory(dir=SCRIPT.parent) as root:
            dest = pathlib.Path(root) / 'secret.env'
            result = subprocess.run(['python3', str(SCRIPT), '--output', str(dest)], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(dest.exists())

    def test_refuses_symlink(self):
        with tempfile.TemporaryDirectory() as root:
            target = pathlib.Path(root) / 'target'
            target.write_text('preserved')
            dest = pathlib.Path(root) / 'secret.env'
            dest.symlink_to(target)
            result = subprocess.run(['python3', str(SCRIPT), '--output', str(dest)], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertTrue(target.read_text() == 'preserved', 'Symlink target changed')


if __name__ == '__main__':
    unittest.main()
