"""Backend integration tests use an isolated directory and fake DS HTTP responses.

These tests do not claim that the ONLYOFFICE editor or Automation API works.
"""
import io
import zipfile
from urllib.parse import urlsplit

import httpx
import pytest
from fastapi.testclient import TestClient

import app as module
from samples import sample_docx


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(module, "DATA", tmp_path)
    monkeypatch.setattr(module, "APP_SECRET", "test-signing-secret-" * 3)
    monkeypatch.setattr(module, "JWT_ENABLED", False)
    monkeypatch.setattr(module, "OUTBOX_ENABLED", False)
    module.locks.clear()
    with TestClient(module.app) as test_client:
        yield test_client


def first(client):
    return client.get('/api/documents').json()[0]


def callback_path(doc, key=None):
    key = key or doc['doc_key']
    token = module.ticket('callback', doc['id'] + ':' + key)
    return f"/api/onlyoffice/callback/{doc['id']}/{key}?ticket={token}"


def fake_download(monkeypatch, content):
    class FakeAsyncClient:
        def __init__(self, **kwargs):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            pass
        async def get(self, url):
            return httpx.Response(200, content=content, request=httpx.Request('GET', url))
    monkeypatch.setattr(module.httpx, 'AsyncClient', FakeAsyncClient)


def test_upload_and_signed_file_access(client):
    data = sample_docx()
    result = client.post('/api/documents/upload', files={'file':('sample.docx', data)})
    assert result.status_code == 200
    doc = result.json()
    config = client.get(f"/api/documents/{doc['id']}/config").json()['config']
    source = urlsplit(config['document']['url'])
    assert client.get(source.path + '?' + source.query).content == data
    assert client.get(source.path + '?ticket=invalid').status_code == 403
    assert client.post('/api/documents/upload', files={'file':('bad.docx', b'not zip')}).status_code == 400


def test_macro_file_rejected(client):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w') as archive:
        archive.writestr('word/document.xml', '<xml/>')
        archive.writestr('word/vbaProject.bin', 'macro')
    assert client.post('/api/documents/upload', files={'file':('macro.docx', stream.getvalue())}).status_code == 400


def test_callback_requires_ticket_and_rejects_mismatched_key(client):
    doc = first(client)
    assert client.post(callback_path(doc).split('?')[0]+'?ticket=bad', json={'key':doc['doc_key'],'status':4}).status_code == 403
    assert client.post(callback_path(doc), json={'key':'other','status':4}).status_code == 409


def test_callback_persists_and_completes_save_request(client, monkeypatch):
    doc = first(client)
    async def accepted(*args):
        return {'error':0}
    monkeypatch.setattr(module, 'ds_post', accepted)
    request = client.post(f"/api/documents/{doc['id']}/save", json={'label':'checkpoint'}).json()
    data = sample_docx()
    fake_download(monkeypatch, data)
    response = client.post(callback_path(doc), json={'key':doc['doc_key'],'status':6,'url':module.DS+'/cache/result.docx','userdata':request['id']})
    assert response.json() == {'error':0}
    state = client.get('/api/save-requests/'+request['id']).json()
    assert state['state'] == 'saved'
    assert client.get('/api/versions/'+state['version_id']+'/download').content == data
    assert client.get(f"/api/documents/{doc['id']}/versions").json()[0]['label'] == 'checkpoint'


def test_stale_callback_never_overwrites_document(client):
    doc = first(client)
    before = client.get(f"/api/documents/{doc['id']}/download").content
    result = client.post(callback_path(doc, 'old-session'), json={'key':'old-session','status':6,'url':'http://example.com/evil'})
    assert result.json() == {'error':0}
    assert client.get(f"/api/documents/{doc['id']}/download").content == before


def test_callback_download_origin_is_restricted(client):
    doc = first(client)
    result = client.post(callback_path(doc), json={'key':doc['doc_key'],'status':6,'url':'http://example.com/private'})
    assert result.json() == {'error':1}
    assert len(client.get(f"/api/documents/{doc['id']}/versions").json()) == 1


def test_unchanged_is_not_reported_as_new_editor_save(client, monkeypatch):
    doc = first(client)
    async def unchanged(*args):
        return {'error':4}
    monkeypatch.setattr(module, 'ds_post', unchanged)
    request = client.post(f"/api/documents/{doc['id']}/save", json={}).json()
    state = client.get('/api/save-requests/'+request['id']).json()
    assert state['state'] == 'unchanged'
    assert client.get(f"/api/documents/{doc['id']}/versions").json()[0]['source'] == 'snapshot'


def test_restore_creates_copy_and_enforces_document_ownership(client):
    doc = first(client)
    version = client.get(f"/api/documents/{doc['id']}/versions").json()[0]
    copy = client.post(f"/api/documents/{doc['id']}/versions/{version['id']}/restore-copy").json()
    assert copy['id'] != doc['id'] and copy['doc_key'] != doc['doc_key']
    assert client.get(f"/api/documents/{copy['id']}/config?version={version['id']}").status_code == 404
    assert client.post(f"/api/documents/{copy['id']}/export/pdf?version={version['id']}").status_code == 404


def test_report_and_bundle_are_valid_documents(client):
    doc = first(client)
    assert client.post('/api/results', json={'document_id':doc['id'],'test_id':'connection','status':'untested','details':'Editor is unavailable','evidence_type':'manual'}).status_code == 200
    report = client.get('/api/results/report.docx')
    with zipfile.ZipFile(io.BytesIO(report.content)) as archive:
        assert b'Editor is unavailable' in archive.read('word/document.xml')
    bundle = client.get(f"/api/documents/{doc['id']}/attachments.zip")
    with zipfile.ZipFile(io.BytesIO(bundle.content)) as archive:
        assert set(archive.namelist()) == {'document.docx','demo-certificate.png','README.txt'}
