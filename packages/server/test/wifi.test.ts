import { describe, expect, it } from 'vitest';
import {
  parseNmcliTerseRow,
  parseWifiNetworks,
  validateSsid,
  wifiSecurityDetails,
} from '../src/system/wifi';

describe('WiFi nmcli parsing', () => {
  it('unescapes colons and trailing backslashes without losing field boundaries', () => {
    expect(parseNmcliTerseRow(String.raw`Cafe\:North\\:71:WPA2:*`)).toEqual([
      'Cafe:North\\',
      '71',
      'WPA2',
      '*',
    ]);
  });

  it('deduplicates SSIDs, keeps the strongest access point, and puts the current network first', () => {
    const networks = parseWifiNetworks(
      [
        String.raw`Cafe\:North\\:41:WPA2:`,
        String.raw`Cafe\:North\\:82:WPA2:*`,
        'Guest:63:--:',
        'Corp:50:WPA2 802.1X:',
      ].join('\n'),
    );

    expect(networks.map((network) => network.ssid)).toEqual(['Cafe:North\\', 'Guest', 'Corp']);
    expect(networks[0]).toMatchObject({ signal: 82, current: true, requiresPassword: true });
    expect(networks[1]).toMatchObject({ secured: false, requiresPassword: false, supported: true });
    expect(networks[2]).toMatchObject({ secured: true, supported: false });
  });

  it('treats enhanced-open WiFi as passwordless and enterprise WiFi as unsupported', () => {
    expect(wifiSecurityDetails('OWE')).toMatchObject({
      secured: true,
      requiresPassword: false,
      supported: true,
    });
    expect(wifiSecurityDetails('WPA2 802.1X')).toMatchObject({
      requiresPassword: false,
      supported: false,
    });
  });
});

describe('WiFi SSID validation', () => {
  it('accepts ordinary Unicode SSIDs up to the 32-byte protocol limit', () => {
    expect(validateSsid('Café WiFi')).toBeNull();
    expect(validateSsid('😀'.repeat(8))).toBeNull();
  });

  it('rejects empty, overlong, and control-character SSIDs', () => {
    expect(validateSsid('')).toMatch(/1 and 32 bytes/);
    expect(validateSsid('😀'.repeat(9))).toMatch(/1 and 32 bytes/);
    expect(validateSsid('bad\nname')).toMatch(/control characters/);
  });
});
