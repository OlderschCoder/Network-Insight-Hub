"""Synthetic filesystem validation. Never imports live CLI state, contacts HTTP, or restarts a service."""
import ast
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).with_name('release-bulk-enrollment.py')
tree = ast.parse(SOURCE.read_text())
definitions = []
for node in tree.body:
    if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'parser' for target in node.targets): break
    definitions.append(node)
module = {}
exec(compile(ast.Module(body=definitions, type_ignores=[]), str(SOURCE), 'exec'), module)

class ReleaseGuards(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.app, self.release = self.root/'app', self.root/'release'
        self.app.mkdir(); self.release.mkdir()
        module['APP'] = self.app
        self.write(self.app/'src/old.ts', 'new-source')
        self.write(self.app/'src/new.ts', 'new-module')
        self.write(self.app/module['PUBLIC']/'index.html', 'new-index')
        self.write(self.app/module['PUBLIC']/'downloads/receiver.msi', 'existing-download')
        self.write(self.app/module['API_DIST']/'index.mjs', 'new-api')
        self.write(self.release/'backup/source/src/old.ts', 'old-source')
        self.write(self.release/'backup/index.html', 'old-index')
        self.write(self.release/'api-original/index.mjs', 'old-api')
        digest = module['digest']
        self.manifest = {'oldSources': {'src/old.ts': digest(self.release/'backup/source/src/old.ts'), 'src/new.ts': None}, 'newSources': {'src/old.ts': digest(self.app/'src/old.ts'), 'src/new.ts': digest(self.app/'src/new.ts')}, 'oldIndex': digest(self.release/'backup/index.html'), 'newIndex': digest(self.app/module['PUBLIC']/'index.html'), 'oldApi': module['tree'](self.release/'api-original'), 'newApi': module['tree'](self.app/module['API_DIST'])}
        self.restarts = []
        self.run_patch = patch.object(module['subprocess'], 'run', lambda *a, **k: self.restarts.append(a))
        self.run_patch.start()
        self.original_boundary = module['boundary_check']
        module['boundary_check'] = lambda **kwargs: None
    def tearDown(self):
        module['boundary_check'] = self.original_boundary
        self.run_patch.stop(); self.temp.cleanup()
    @staticmethod
    def write(path, text):
        path.parent.mkdir(parents=True, exist_ok=True); path.write_text(text)
    def unchanged_failure(self):
        before = module['tree'](self.app)
        with self.assertRaises(RuntimeError): module['restore'](self.release, self.manifest)
        self.assertEqual(before, module['tree'](self.app)); self.assertEqual([], self.restarts)
    def test_corrupt_source_backup_stops_before_any_write(self):
        self.write(self.release/'backup/source/src/old.ts', 'corrupted')
        self.unchanged_failure()
    def test_corrupt_frontend_backup_stops_before_any_write(self):
        self.write(self.release/'backup/index.html', 'corrupted')
        self.unchanged_failure()
    def test_missing_api_original_stops_before_any_write(self):
        (self.release/'api-original/index.mjs').unlink(); (self.release/'api-original').rmdir()
        self.unchanged_failure()
    def test_outside_source_change_is_preserved(self):
        self.write(self.app/'src/old.ts', 'other-authorized-deployment')
        self.unchanged_failure()
    def test_complete_rollback_restores_hashes_and_preserves_downloads(self):
        module['restore'](self.release, self.manifest)
        self.assertEqual('old-source', (self.app/'src/old.ts').read_text())
        self.assertFalse((self.app/'src/new.ts').exists())
        self.assertEqual(self.manifest['oldApi'], module['tree'](self.app/module['API_DIST']))
        self.assertEqual('old-index', (self.app/module['PUBLIC']/'index.html').read_text())
        self.assertEqual('existing-download', (self.app/module['PUBLIC']/'downloads/receiver.msi').read_text())
        self.assertEqual(1, len(self.restarts))
    def test_rollback_waits_for_actual_startup_readiness(self):
        attempts = []
        def boundary(**kwargs):
            attempts.append(True)
            if len(attempts) == 1: raise RuntimeError('synthetic startup not ready yet')
        module['boundary_check'] = boundary
        with patch.object(module['time'], 'sleep', lambda _: None): module['restore'](self.release, self.manifest)
        self.assertEqual(2, len(attempts))
    def test_apply_permission_preflight_refuses_nonroot_before_writes(self):
        before=module['tree'](self.app)
        with patch.object(module['os'],'geteuid',lambda:1000,create=True):
            with self.assertRaisesRegex(RuntimeError,'euid=0'): module['permission_preflight']({},require_root=True)
        self.assertEqual(before,module['tree'](self.app)); self.assertEqual([],self.restarts)
    def test_restore_preserves_original_file_permissions(self):
        module['os'].chmod(self.app/'src/old.ts',0o640)
        original=module['metadata'](self.app/'src/old.ts')
        self.manifest['oldSourceMetadata']={'src/old.ts':original,'src/new.ts':None}
        module['restore'](self.release,self.manifest)
        self.assertEqual(original,module['metadata'](self.app/'src/old.ts'))

if __name__ == '__main__': unittest.main()
