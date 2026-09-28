"""LAN bootstrap checks: isolated paths; never read the real .env or Docker."""
import importlib.util
import sys
from pathlib import Path
from dotenv import dotenv_values


def configuration_module():
    spec = importlib.util.spec_from_file_location('demo_configure', Path(__file__).resolve().parents[1] / 'scripts' / 'configure.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_lan_configuration_has_no_ai_credentials_or_docker_dependency(tmp_path, monkeypatch):
    module = configuration_module()
    module.ROOT = tmp_path
    (tmp_path / 'backend').mkdir()
    monkeypatch.setattr(sys, 'argv', ['configure.py', '--backend-host', '10.174.202.100'])
    monkeypatch.setattr(module.subprocess, 'run', lambda *a, **kw: (_ for _ in ()).throw(AssertionError('Docker must not run')))
    module.main()
    env = dotenv_values(tmp_path / 'backend' / '.env')
    assert env['ONLYOFFICE_URL'] == 'http://10.174.202.82:9898'
    assert env['BACKEND_CONTAINER_URL'] == 'http://10.174.202.100:8010'
    assert len(env['APP_SIGNING_SECRET']) >= 48
    assert all(env[k] == '' for k in ('BID_AI_BASE_URL','BID_AI_MODEL','BID_AI_API_KEY'))
    assert env['ONLYOFFICE_JWT_ENABLED'] == 'false'


def test_existing_configuration_is_never_overwritten(tmp_path, monkeypatch):
    module = configuration_module()
    module.ROOT = tmp_path
    (tmp_path / 'backend').mkdir()
    env = tmp_path / 'backend' / '.env'
    env.write_text('BID_AI_API_KEY=local-test-value\n', encoding='utf-8')
    monkeypatch.setattr(sys, 'argv', ['configure.py'])
    monkeypatch.setattr(module, 'lan_address', lambda *a: (_ for _ in ()).throw(AssertionError('Should not detect addresses')))
    module.main()
    assert env.read_text(encoding='utf-8') == 'BID_AI_API_KEY=local-test-value\n'
