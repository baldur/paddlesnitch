// @vitest-environment node
// Tracker security settings that live in firmware source and have no host test
// of their own (security audit 2026-09).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { X509Certificate } from 'crypto'
import path from 'path'

const fw = path.resolve(__dirname, '../../../../firmware')
const read = (f: string) => readFileSync(path.join(fw, f), 'utf8')

describe('tracker TLS trust', () => {
  // Published by Amazon at https://www.amazontrust.com/repository/
  const AMAZON_ROOTS = {
    'Amazon Root CA 1': '8E:CD:E6:88:4F:3D:87:B1:12:5B:A3:1A:C3:FC:B1:3D:70:16:DE:7F:57:CC:90:4F:E1:CB:97:C6:AE:98:19:6E',
    'Amazon Root CA 2': '1B:A5:B2:AA:8C:65:40:1A:82:96:01:18:F8:0B:EC:4F:62:30:4D:83:CE:C4:71:3A:19:C3:9C:01:1E:A4:6D:B4',
    'Amazon Root CA 3': '18:CE:6C:FE:7B:F1:4E:60:B2:E3:47:B8:DF:E8:68:CB:31:D0:2E:BB:3A:DA:27:15:69:F5:03:43:B4:6D:B3:A4',
    'Amazon Root CA 4': 'E3:5D:28:41:9E:D0:20:25:CF:A6:90:38:CD:62:39:62:45:8D:A5:C6:95:FB:DE:A3:C2:2B:0B:FB:25:89:70:92',
  }

  it('trusts exactly Amazon Root CA 1-4, byte for byte', () => {
    const src = read('include/root_ca.h')
    const pems = [...src.matchAll(/"(-----BEGIN CERTIFICATE-----\\n"[\s\S]*?"-----END CERTIFICATE-----)\\n"/g)]
      .map(m => m[1].replace(/\\n"\s*\n"/g, '\n').replace(/^"|"$/g, '') + '\n')
    const seen = Object.fromEntries(pems.map(p => { const c = new X509Certificate(p); return [c.subject.split('\n').find(l => l.startsWith('CN='))!.slice(3), c.fingerprint256] }))
    expect(seen).toEqual(AMAZON_ROOTS)
  })

  it('both TLS clients use the bundle and never skip verification', () => {
    for (const f of ['src/uplink.cpp', 'src/ota.cpp']) {
      const code = read(f).split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
      expect(code, f).toContain('setCACert(AMAZON_ROOT_CAS)')
      expect(code, f).not.toMatch(/setInsecure\(/)
    }
  })
})

describe('tracker privacy', () => {
  it('does not broadcast its position over LoRa unless a build asks for it', () => {
    expect(read('src/main_tracker.cpp')).toMatch(/#define LORA_TX 0/)
    const trackerEnv = read('platformio.ini').split('[env:tracker]')[1].split('\n[')[0]
    expect(trackerEnv).not.toMatch(/LORA_TX=1/)
  })

  it('the setup page has no server field', () => {
    expect(read('src/netcfg.cpp')).not.toMatch(/name=url/)
  })
})
