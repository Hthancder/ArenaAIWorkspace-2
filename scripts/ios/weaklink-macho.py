#!/usr/bin/env python3
"""Report (and fix) what an app-extension binary needs from iOS before it can even start.

dyld refuses to launch a binary whose *strongly* linked library is missing on the device. For a
WidgetKit extension that means iOS can't ask it for its widgets, so HolySic silently never shows
up in the widget gallery. A new Xcode can strongly link frameworks that only exist on iOS 16/17+
(AppIntents, DeveloperToolsSupport, SwiftUICore, …) even when the code only uses them behind
`if #available`.

This turns every load command for a library that is NOT known to ship with iOS 15 into a weak
load (LC_LOAD_DYLIB → LC_LOAD_WEAK_DYLIB: same struct, only the command id changes). A weak
library that exists loads exactly as before; a missing one just binds to nil. Re-sign afterwards.

usage: weaklink-macho.py <binary> [--check]      (--check: report only, exit 1 if risky)
"""
import struct
import sys

LC_REQ_DYLD = 0x80000000
LC_LOAD_DYLIB = 0xC
LC_LOAD_WEAK_DYLIB = 0x18 | LC_REQ_DYLD
LC_REEXPORT_DYLIB = 0x1F | LC_REQ_DYLD
LC_LAZY_LOAD_DYLIB = 0x20
LC_VERSION_MIN_IPHONEOS = 0x25
LC_BUILD_VERSION = 0x32

# Present on every iOS 15.0 device (anything else is made weak — harmless if it does exist).
IOS15_FRAMEWORKS = {
    'Foundation', 'CoreFoundation', 'UIKit', 'SwiftUI', 'WidgetKit', 'Combine', 'CoreGraphics',
    'QuartzCore', 'CoreText', 'CoreImage', 'ImageIO', 'Security', 'CFNetwork', 'Intents',
    'AVFoundation', 'CoreMedia', 'CoreVideo', 'CoreAudio', 'AudioToolbox', 'MediaPlayer', 'Metal',
    'MobileCoreServices', 'UniformTypeIdentifiers', 'CoreServices', 'Accelerate', 'Network',
    'SystemConfiguration', 'CoreLocation', 'MapKit', 'Photos', 'UserNotifications', 'WebKit',
    'CoreData', 'CloudKit', 'OSLog', 'os', 'IOSurface', 'CoreHaptics', 'CryptoKit',
}
IOS15_DYLIBS = {
    'libSystem.B.dylib', 'libobjc.A.dylib', 'libc++.1.dylib', 'libz.1.dylib', 'libsqlite3.dylib',
    'libswiftCore.dylib', 'libswiftFoundation.dylib', 'libswiftDarwin.dylib',
    'libswiftDispatch.dylib', 'libswiftObjectiveC.dylib', 'libswiftCoreFoundation.dylib',
    'libswiftCoreGraphics.dylib', 'libswiftUIKit.dylib', 'libswiftos.dylib',
    'libswift_Concurrency.dylib', 'libswiftQuartzCore.dylib', 'libswiftCoreImage.dylib',
    'libswiftMetal.dylib', 'libswiftsimd.dylib', 'libswiftNetwork.dylib',
    'libswiftCoreMedia.dylib', 'libswiftAVFoundation.dylib', 'libswiftCoreAudio.dylib',
    'libswiftCoreLocation.dylib', 'libswiftIntents.dylib', 'libswiftContacts.dylib',
    'libswiftCompatibility56.dylib', 'libswiftUniformTypeIdentifiers.dylib',
    'libswiftCoreData.dylib', 'libswiftNaturalLanguage.dylib', 'libswiftAccelerate.dylib',
    'libswiftCryptoTokenKit.dylib', 'libswiftMapKit.dylib', 'libswiftPhotos.dylib',
}


def known_on_ios15(path):
    name = path.rsplit('/', 1)[-1]
    if '.framework/' in path:
        fw = path.split('.framework/')[0].rsplit('/', 1)[-1]
        return fw in IOS15_FRAMEWORKS
    if path.startswith('@'):
        return True  # embedded in the bundle
    return name in IOS15_DYLIBS


def fmt_ver(v):
    return f'{v >> 16}.{(v >> 8) & 0xFF}.{v & 0xFF}'


def walk_thin(buf, base, patch, report):
    magic = struct.unpack_from('<I', buf, base)[0]
    if magic != 0xFEEDFACF:
        report.append(f'  (slice at {base}: not a 64-bit Mach-O, skipped)')
        return 0
    cputype, _, _, ncmds, _, _, _ = struct.unpack_from('<iiIIIII', buf, base + 4)
    off = base + 32
    risky = 0
    for _ in range(ncmds):
        cmd, size = struct.unpack_from('<II', buf, off)
        if cmd in (LC_LOAD_DYLIB, LC_LOAD_WEAK_DYLIB, LC_REEXPORT_DYLIB, LC_LAZY_LOAD_DYLIB):
            name_off = struct.unpack_from('<I', buf, off + 8)[0]
            raw = bytes(buf[off + name_off: off + size])
            path = raw.split(b'\0', 1)[0].decode('utf-8', 'replace')
            weak = cmd == LC_LOAD_WEAK_DYLIB
            ok = known_on_ios15(path)
            tag = 'weak  ' if weak else 'strong'
            note = ''
            if cmd == LC_LOAD_DYLIB and not ok:
                risky += 1
                if patch:
                    struct.pack_into('<I', buf, off, LC_LOAD_WEAK_DYLIB)
                    note = '  → made weak (not on iOS 15)'
                else:
                    note = '  ⚠ strong link to a library iOS 15 may not have'
            report.append(f'  {tag} {path}{note}')
        elif cmd == LC_BUILD_VERSION:
            platform, minos, sdk = struct.unpack_from('<III', buf, off + 8)
            report.append(f'  build: platform {platform} minos {fmt_ver(minos)} sdk {fmt_ver(sdk)}')
        elif cmd == LC_VERSION_MIN_IPHONEOS:
            v, sdk = struct.unpack_from('<II', buf, off + 8)
            report.append(f'  version-min iOS {fmt_ver(v)} sdk {fmt_ver(sdk)}')
        off += size
    return risky


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    path = sys.argv[1]
    check_only = '--check' in sys.argv
    with open(path, 'rb') as f:
        buf = bytearray(f.read())
    report = []
    risky = 0
    magic = struct.unpack_from('>I', buf, 0)[0]
    if magic in (0xCAFEBABE, 0xCAFEBABF):
        n = struct.unpack_from('>I', buf, 4)[0]
        is64 = magic == 0xCAFEBABF
        for i in range(n):
            if is64:
                _, _, offset, _, _, _ = struct.unpack_from('>iiQQII', buf, 8 + i * 32)
            else:
                _, _, offset, _, _ = struct.unpack_from('>iiIII', buf, 8 + i * 20)
            report.append(f' slice {i}:')
            risky += walk_thin(buf, offset, not check_only, report)
    else:
        risky += walk_thin(buf, 0, not check_only, report)
    print('\n'.join(report))
    if not check_only and risky:
        with open(path, 'wb') as f:
            f.write(buf)
        print(f'patched {risky} load command(s)')
    elif risky:
        sys.exit(1)
    else:
        print('nothing to patch')


if __name__ == '__main__':
    main()
