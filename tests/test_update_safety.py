"""Exercise the downloader's fail-closed control flow without a network request."""
import ast
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock
from urllib.parse import urljoin

SOURCE = Path(__file__).resolve().parents[1] / 'scripts/fetch_updates/fetch_updates.py'


class UpdateSafety(unittest.TestCase):
    def setUp(self):
        tree = ast.parse(SOURCE.read_text(encoding='utf-8'))
        selected = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                    and node.name in ('safe_path_component', 'download_enclosure', 'sparkle_name')]
        response = Mock(content=b'archive')
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        self.verify = Mock()
        self.ns = dict(Path=Path, etree=Mock(), requests=Mock(), urljoin=urljoin,
                       APPCAST_URL='https://example.test/appcast.xml', verify_sparkle_signature=self.verify)
        self.ns['requests'].get.return_value = response
        exec(compile(ast.Module(body=selected, type_ignores=[]), str(SOURCE), 'exec'), self.ns)

    def test_invalid_signature_does_not_publish_download(self):
        self.verify.side_effect = RuntimeError('invalid signature')
        enclosure = Mock(attrib={'url':'update.zip', self.ns['sparkle_name']('edSignature'):'signature'})
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / 'new-release' / 'update.zip'
            with self.assertRaisesRegex(RuntimeError, 'invalid signature'):
                self.ns['download_enclosure'](enclosure, target)
            self.assertFalse(target.parent.exists())

    def test_cross_platform_path_components_fail_closed(self):
        for value in ['', '.', '..', '../x', 'x/y', 'x\\y', 'C:target', 'x\0y']:
            with self.assertRaises(ValueError): self.ns['safe_path_component'](value)
        self.assertEqual(self.ns['safe_path_component']('26.1021.31345'), '26.1021.31345')


if __name__ == '__main__': unittest.main()
