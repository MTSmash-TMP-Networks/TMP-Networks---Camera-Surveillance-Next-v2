import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSmbLocationText } from './smbLocation.js';

test('parses smb URI copied from a NAS', () => {
  assert.deepEqual(parseSmbLocationText('smb://192.168.10.20/recordings/TMP-Camera'), {
    host: '192.168.10.20', port: 445, share: 'recordings', basePath: 'TMP-Camera',
  });
});

test('parses Windows UNC path copied from Explorer', () => {
  assert.deepEqual(parseSmbLocationText('\\\\diskstation\\recordings\\archive'), {
    host: 'diskstation', port: 445, share: 'recordings', basePath: 'archive',
  });
});

test('parses custom SMB port and slash path', () => {
  assert.deepEqual(parseSmbLocationText('//nas.example.lan:1445/video/cameras'), {
    host: 'nas.example.lan', port: 1445, share: 'video', basePath: 'cameras',
  });
});

test('parses host:port but leaves a plain host untouched', () => {
  assert.deepEqual(parseSmbLocationText('192.168.1.20:445'), {
    host: '192.168.1.20', port: 445, share: '', basePath: '',
  });
  assert.equal(parseSmbLocationText('192.168.1.20'), null);
});
