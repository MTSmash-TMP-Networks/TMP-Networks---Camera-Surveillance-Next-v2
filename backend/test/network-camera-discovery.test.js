import { describe, expect, it } from 'vitest';
import {
  cameraDiscoveryDefaults,
  classifyHostFingerprint,
  expandAutomaticTargets,
  expandScanTargets,
  isSafeSsdpLocation,
  parseSadpPacket,
  preferredCameraPort,
} from '../src/services/NetworkCameraDiscovery.js';
import { CAMERA_PORT_DEFINITIONS } from '../src/services/media/CameraPortCatalog.js';
import { hasCameraIdentityText } from '../src/services/media/CameraHostClassifier.js';

describe('NetworkCameraDiscovery', () => {
  it('erweitert CIDR- und Kurzbereiche ohne Netz- und Broadcastadresse', () => {
    expect(expandScanTargets(['192.168.1.0/30'])).toEqual(['192.168.1.1', '192.168.1.2']);
    expect(expandScanTargets('192.168.1.10-12')).toEqual(['192.168.1.10', '192.168.1.11', '192.168.1.12']);
  });

  it('kombiniert mehrere Host-/VPN-Netze ohne das Adresslimit zu überschreiten', () => {
    const targets = expandAutomaticTargets(['192.168.1.0/24', '10.20.30.0/24']);
    expect(targets).toHaveLength(508);
    expect(targets).toContain('192.168.1.1');
    expect(targets).toContain('10.20.30.254');
  });

  it('liest Hikvision SADP ProbeMatch inklusive SDK-Ports', () => {
    const device = parseSadpPacket(`<?xml version="1.0"?><ProbeMatch><DeviceType>DS-2CD2385FWD-I</DeviceType><DeviceDescription>Hikvision IP Camera</DeviceDescription><DeviceSN>ABC123</DeviceSN><MAC>AA-BB-CC-DD-EE-FF</MAC><IPv4Address>192.168.1.86</IPv4Address><CommandPort>8000</CommandPort><HttpPort>80</HttpPort><SDKOverTLSPort>8443</SDKOverTLSPort><SoftwareVersion>V5.6.820</SoftwareVersion><Activated>true</Activated></ProbeMatch>`);
    expect(device).toMatchObject({ ip: '192.168.1.86', manufacturer: 'Hikvision', model: 'DS-2CD2385FWD-I', serialNumber: 'ABC123' });
    expect(device.openPorts).toEqual(expect.arrayContaining([80, 8000, 8443]));
    expect(device.discoveryMethods).toContain('sadp');
  });

  it('führt einen normalen Webserver auf Port 80 nicht als Kamera', () => {
    const result = classifyHostFingerprint({
      openPorts: [80],
      pages: [{
        statusCode: 200,
        url: 'http://192.168.1.20:80/',
        headers: { server: 'nginx', 'content-type': 'text/html' },
        body: '<html><title>Firmenportal</title><h1>Webserver</h1></html>',
      }],
    });
    expect(result).toMatchObject({ candidate: false, likelyCamera: false, verified: false, confidence: 0 });
  });

  it('wertet einen blossen VIGI-Markennamen nicht als Kameranachweis', () => {
    expect(hasCameraIdentityText('TP-Link VIGI Business Surveillance')).toBe(false);
    expect(hasCameraIdentityText('TP-Link VIGI IP Camera C540')).toBe(true);
  });

  it('filtert einen TP-Link-Router mit ausschliesslich Port 80 aus', () => {
    const result = classifyHostFingerprint({
      openPorts: [80],
      pages: [{ statusCode: 200, url: 'http://192.168.1.1:80/', headers: { server: 'TP-LINK Router' }, body: '<html><title>TP-Link Wireless Router</title><h1>Archer Internet Gateway</h1></html>' }],
    });
    expect(result).toMatchObject({ candidate: false, likelyCamera: false, verified: false, confidence: 0 });
  });

  it('filtert eine Ubiquiti-Netzwerkoberflaeche mit ausschliesslich Port 80 aus', () => {
    const result = classifyHostFingerprint({
      openPorts: [80],
      pages: [{ statusCode: 200, url: 'http://192.168.1.2:80/', headers: { server: 'UBNT' }, body: '<html><title>UniFi Network</title><h1>Ubiquiti Security Gateway</h1></html>' }],
    });
    expect(result).toMatchObject({ candidate: false, likelyCamera: false, verified: false, confidence: 0 });
  });

  it('filtert einen Managed Switch auch bei einem Kamera-Hinweistext aus', () => {
    const result = classifyHostFingerprint({
      openPorts: [80],
      pages: [{ statusCode: 200, url: 'http://192.168.1.3:80/', headers: { server: 'embedded-web' }, body: '<html><title>Managed Ethernet Switch</title><p>VLAN profile for IP camera traffic</p></html>' }],
    });
    expect(result).toMatchObject({ candidate: false, likelyCamera: false, verified: false, confidence: 0 });
  });


  it('filtert die eigene TMP-Router-Management-Oberflaeche trotz Kamera-Texten und Port 7681 aus', () => {
    const result = classifyHostFingerprint({
      openPorts: [80, 443, 7681],
      pages: [{
        statusCode: 200,
        url: 'http://192.168.3.1:80/',
        headers: { server: 'nginx' },
        body: '<html><title>TMP Router Management</title><script>Hikvision Network Camera Netzwerkkamera RTSP ONVIF</script></html>',
      }],
    });
    expect(result).toMatchObject({ candidate: false, likelyCamera: false, verified: false, manufacturer: null, managementUi: true });
  });

  it('wertet einen allgemeinen Hikvision-Hinweis in einem Router-UI nicht als Kamera', () => {
    const result = classifyHostFingerprint({
      openPorts: [80],
      pages: [{ statusCode: 200, url: 'http://192.168.3.2:80/', headers: {}, body: '<html><title>Router Management</title><p>Hikvision Portprofil fuer VLANs</p></html>' }],
    });
    expect(result).toMatchObject({ candidate: false, likelyCamera: false, verified: false, manufacturer: null });
  });

  it('wertet selbst eine Kamera-Webseite auf einem reinen Webhost nicht ohne Kamera-API als Gerät', () => {
    const result = classifyHostFingerprint({
      openPorts: [80],
      pages: [{ statusCode: 200, url: 'http://192.168.3.30:80/', headers: {}, body: '<html><title>Hikvision Network Camera</title><h1>Live View</h1></html>' }],
    });
    expect(result).toMatchObject({ candidate: false, likelyCamera: false, verified: false, manufacturer: null, genericWebOnly: true });
  });

  it('erkennt eine Web-only-Kamera weiterhin, wenn eine konkrete Kamera-API antwortet', () => {
    const result = classifyHostFingerprint({
      openPorts: [80],
      pages: [
        { statusCode: 200, url: 'http://192.168.3.31:80/', headers: {}, body: '<html><title>Hikvision Network Camera</title></html>' },
        { statusCode: 200, url: 'http://192.168.3.31:80/ISAPI/System/deviceInfo', headers: { 'content-type': 'application/xml' }, body: '<DeviceInfo><deviceName>Hikvision Network Camera</deviceName><model>DS-2CD2385FWD-I</model><serialNumber>ABC123</serialNumber></DeviceInfo>' },
      ],
    });
    expect(result).toMatchObject({ candidate: true, likelyCamera: true, verified: true, manufacturer: 'Hikvision', vendorEndpointEvidence: true });
  });

  it('filtert eine allgemeine VIGI-Switch-Oberflaeche trotz Markenhinweis aus', () => {
    const result = classifyHostFingerprint({
      openPorts: [80],
      pages: [{ statusCode: 200, url: 'http://192.168.1.41:80/', headers: {}, body: '<html><title>VIGI PoE Switch</title><h1>Switch Management</h1></html>' }],
    });
    expect(result).toMatchObject({ candidate: false, likelyCamera: false, verified: false, manufacturer: null });
  });

  it('filtert auch eine VIGI-Kamera-Webseite auf reinem Port 80 ohne Kamera-API aus', () => {
    const result = classifyHostFingerprint({
      openPorts: [80],
      pages: [{ statusCode: 200, url: 'http://192.168.1.40:80/', headers: { server: 'embedded' }, body: '<html><title>VIGI Network Camera Login</title><h1>Live View</h1></html>' }],
    });
    expect(result).toMatchObject({ candidate: false, likelyCamera: false, verified: false, manufacturer: null });
  });

  it('filtert eine Kamera-aehnliche Weboberflaeche auf Port 8080 ohne Protokollnachweis aus', () => {
    const result = classifyHostFingerprint({
      openPorts: [8080],
      pages: [{
        statusCode: 200,
        url: 'http://192.168.1.21:8080/',
        headers: { server: 'embedded' },
        body: '<html><title>IP Camera Login</title><form>Network Camera</form></html>',
      }],
    });
    expect(result).toMatchObject({ candidate: false, likelyCamera: false, verified: false, confidence: 0 });
  });

  it('erkennt Web plus RTSP plus RTMP als starke Video-Appliance-Kamerasignatur', () => {
    const result = classifyHostFingerprint({ openPorts: [80, 554, 1935, 8080] });
    expect(result).toMatchObject({ candidate: true, likelyCamera: true, verified: false, strongPortCombinationEvidence: true });
    expect(result.confidence).toBeGreaterThanOrEqual(88);
  });

  it('erkennt die typische Hikvision-WebSocket-SDK-RTSP-Portkombination als Kamera', () => {
    const result = classifyHostFingerprint({ openPorts: [80, 443, 554, 7681, 8000, 8443] });
    expect(result).toMatchObject({ candidate: true, likelyCamera: true, verified: false, manufacturer: 'Hikvision', strongPortCombinationEvidence: true });
    expect(result.confidence).toBeGreaterThanOrEqual(94);
  });

  it('filtert reine Webdienste auf 80 und 443 konsequent aus', () => {
    const result = classifyHostFingerprint({ openPorts: [80, 443] });
    expect(result).toMatchObject({ candidate: false, likelyCamera: false, verified: false, confidence: 0, genericWebOnly: true });
  });

  it('filtert reine Webdienste auf 443 und 8888 konsequent aus', () => {
    const result = classifyHostFingerprint({ openPorts: [443, 8888] });
    expect(result).toMatchObject({ candidate: false, likelyCamera: false, verified: false, confidence: 0, genericWebOnly: true });
  });

  it('stuft Web plus nur offenen, aber nicht bestätigten RTSP-Port nicht als Kamera ein', () => {
    const result = classifyHostFingerprint({
      openPorts: [80, 554],
      pages: [{ statusCode: 200, url: 'http://192.168.1.23:80/', headers: { server: 'nginx' }, body: '<title>Portal</title>' }],
      rtspServices: [{ port: 554, confirmed: false }],
    });
    expect(result.candidate).toBe(false);
    expect(result.likelyCamera).toBe(false);
    expect(result.verified).toBe(false);
  });

  it('bewertet eine Dahua-Portkombination mit bestätigtem RTSP als Kamera', () => {
    const result = classifyHostFingerprint({
      openPorts: [80, 554, 37777],
      pages: [{ statusCode: 200, url: 'http://192.168.1.22:80/', headers: {}, body: '<title>Login</title>' }],
      rtspServices: [{ port: 554, confirmed: true }],
    });
    expect(result).toMatchObject({ candidate: true, likelyCamera: true, verified: true, manufacturer: 'Dahua' });
    expect(result.confidence).toBeGreaterThanOrEqual(95);
  });

  it('stuft einen alleinigen RTSP-Dienst nicht mehr als Kamera ein', () => {
    const result = classifyHostFingerprint({
      openPorts: [554],
      rtspServices: [{ port: 554, confirmed: true }],
    });
    expect(result).toMatchObject({ candidate: false, likelyCamera: false, verified: false, confidence: 0, rtspOnly: true });
  });

  it('filtert einen allgemeinen RTSP-Medienserver mit generischem Web-UI aus', () => {
    const result = classifyHostFingerprint({
      openPorts: [80, 554],
      pages: [{ statusCode: 200, url: 'http://192.168.1.60:80/', headers: { server: 'nginx' }, body: '<title>Streaming Media Server</title>' }],
      rtspServices: [{ port: 554, confirmed: true }],
    });
    expect(result).toMatchObject({ candidate: false, likelyCamera: false, verified: false, confidence: 0 });
  });

  it('wertet Kamera-SDK-Port 8000 plus generischen Webdienst allein nicht als Kamera', () => {
    const result = classifyHostFingerprint({
      openPorts: [8000, 8080],
      pages: [{ statusCode: 200, url: 'http://192.0.2.50:8080/', headers: {}, body: '<title>Login</title>' }],
    });
    expect(result).toMatchObject({ candidate: false, likelyCamera: false, verified: false, manufacturer: null });
    expect(result.confidence).toBe(0);
  });

  it('akzeptiert SSDP-Beschreibungen nur vom antwortenden privaten Host', () => {
    expect(isSafeSsdpLocation('http://192.168.1.50:8080/device.xml', '192.168.1.50')).toBe(true);
    expect(isSafeSsdpLocation('http://192.168.1.51/device.xml', '192.168.1.50')).toBe(false);
    expect(isSafeSsdpLocation('http://203.0.113.10/device.xml', '203.0.113.10')).toBe(false);
    expect(isSafeSsdpLocation('http://user:secret@192.168.1.50/device.xml', '192.168.1.50')).toBe(false);
    expect(isSafeSsdpLocation('file:///etc/passwd', '192.168.1.50')).toBe(false);
  });

  it('wählt einen erkannten ONVIF-Port vor allgemeinen Webports', () => {
    expect(preferredCameraPort([80, 554, 8899], 8899)).toBe(8899);
    expect(preferredCameraPort([554, 8080])).toBe(8080);
  });

  it('enthält die verbreiteten Hersteller- und Alternativports im Standardscan', () => {
    const required = [80, 443, 554, 8080, 8443, 8554, 10554, 1935, 2020, 8000, 8800, 9000, 34567, 37777];
    expect(cameraDiscoveryDefaults.ports).toEqual(expect.arrayContaining(required));
    expect(CAMERA_PORT_DEFINITIONS).toHaveLength(cameraDiscoveryDefaults.ports.length);
    expect(cameraDiscoveryDefaults.ports.length).toBeLessThanOrEqual(40);
  });
});
