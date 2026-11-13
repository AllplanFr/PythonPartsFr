import tempfile
import unittest
from pathlib import Path
from application.core.allplan.paths import AllplanPaths, resolve_paths
from application.plugins.vob_editor.allplan import VobEditorAllplanDatas
from application.core.catalog import resolve_url, PLUGINS
from application.plugins.vob_editor.application import VobEditorApp


class Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory();
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name);
        self.paths = {}
        for n in ('ETC', 'PRG', 'STD', 'PRJ', 'USR', 'TMP'):
            p = self.root / n;
            p.mkdir();
            self.paths[n] = p
        self.catalog = self.root / 'catalog';
        self.catalog.mkdir()

    def app(self, year, country='FRA', catalog=None):
        return VobEditorAllplanDatas(AllplanPaths(str(year), country, paths=self.paths), catalog_user_path=catalog)

    def test_old(self):
        (self.paths['ETC'] / 'vo2.dat').write_bytes(b'x')
        (self.paths['STD'] / 'vob.dat').write_bytes(b'x')
        self.assertEqual(len(self.app(2026).list_vob_files()['files']), 1)

    def test_no_recursion(self):
        d = self.paths['ETC'] / 'sub';
        d.mkdir();
        (d / 'vob.dat').write_bytes(b'x')
        self.assertEqual(self.app(2026).list_vob_files()['files'], [])

    def test_new(self):
        for p in (self.catalog, self.paths['STD'], self.paths['ETC']): (p / 'vob_FRA.dat').write_bytes(b'x')
        self.assertEqual([x['root'] for x in self.app(2027, catalog=self.catalog).list_vob_files()['files']],
                         ['project', 'std', 'etc'])

    def test_country(self):
        self.assertTrue(self.app(2027, country='').list_vob_files()['warnings'])

    def test_no_prj_fallback(self):
        (self.paths['PRJ'] / 'vob_FRA.dat').write_bytes(b'x')
        self.assertEqual(self.app(2027).list_vob_files()['files'], [])

    def test_read(self):
        p = self.paths['ETC'] / 'vob.dat';
        p.write_bytes(b'abc')
        self.assertEqual(self.app(2026).read_vob_bytes(p), b'abc')

    def test_outside(self):
        p = self.paths['STD'] / 'vob.dat';
        p.write_bytes(b'x')
        with self.assertRaises(ValueError): self.app(2026).read_vob_bytes(p)

    def test_explicit(self):
        self.assertTrue(resolve_paths('2026', overrides=self.paths).to_dict()['complete'])

    def test_bad_explicit(self):
        self.assertIsNone(resolve_paths('2026', overrides=dict(self.paths, STD='relative')).paths['STD'])

    def test_version(self):
        with self.assertRaises(ValueError): resolve_paths('latest')

    def test_registry(self):
        for plugin in PLUGINS.values(): self.assertIs(resolve_url(plugin.url), plugin)

    def test_http(self):
        with self.assertRaises(ValueError): resolve_url('http://allplan-tools.lovable.app/information-manager')

    def test_fake_domain(self):
        with self.assertRaises(ValueError): resolve_url('https://allplan-tools.lovable.app.evil.com/information-manager')

    def test_bridge_payload(self):
        from application.core.configuration import SettingsStore
        app = VobEditorApp(
            self.root / 'data', allplan_datas=self.app(2026),
            settings_store=SettingsStore(self.root / 'settings.json'),
        )
        self.addCleanup(app._close)
        self.assertIn('files', app.get_initial_data())


if __name__ == '__main__': unittest.main()
