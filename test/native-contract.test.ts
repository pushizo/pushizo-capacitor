/*
 * Native köprü sözleşmesi: TS eklenti arayüzündeki her metodun Android (@PluginMethod) ve iOS
 * (CAPPluginMethod + @objc) karşılığı ve çekirdek işleyicisi olmalı. Native kod bu ortamda derlenemediğinden
 * kaynak metni üzerinden doğrulanır.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/** `HeroSignalPlugin` arayüzündeki metot adları (dinleyici yönetimi hariç). */
function pluginMethods(): string[] {
  const src = read('src/definitions.ts');
  const body = src.slice(src.indexOf('export interface HeroSignalPlugin'));
  return [...new Set([...body.matchAll(/^\s{2}([a-zA-Z]+)\(/gm)].map((m) => m[1]))].filter(
    (m) => m !== 'addListener' && m !== 'removeAllListeners',
  );
}

describe('native sözleşme', () => {
  const methods = pluginMethods();
  const adapterHandled = new Set(['requestPermission']);

  it('cephenin çağırdığı her metot eklenti arayüzünde var', () => {
    const core = read('src/core.ts');
    const called = new Set([...core.matchAll(/bridge\.call(?:<[^>]*>)?\('([A-Za-z]+)'/g)].map((m) => m[1]));
    expect(methods.length).toBeGreaterThan(30);
    for (const m of called) expect(methods, m).toContain(m);
  });

  it('Android: her metot @PluginMethod ve çekirdek işleyicisine sahip', () => {
    const plugin = read('android/src/main/java/com/herosignal/capacitor/HeroSignalPlugin.kt');
    const annotated = new Set([...plugin.matchAll(/@PluginMethod\s+fun ([A-Za-z]+)\(/g)].map((m) => m[1]));
    const core = read('android/src/main/java/com/herosignal/capacitor/HeroSignalBridgeCore.kt');
    const handled = new Set([...core.matchAll(/^\s+"([A-Za-z]+)" ->/gm)].map((m) => m[1]));
    for (const m of methods) {
      expect(annotated.has(m), `@PluginMethod ${m}`).toBe(true);
      expect(handled.has(m) || adapterHandled.has(m), `çekirdek ${m}`).toBe(true);
    }
  });

  it('iOS: her metot CAPPluginMethod, @objc fonksiyon ve çekirdek işleyicisine sahip', () => {
    const plugin = read('ios/Sources/HeroSignalPlugin/HeroSignalPlugin.swift');
    const declared = new Set([...plugin.matchAll(/CAPPluginMethod\(name: "([A-Za-z]+)"/g)].map((m) => m[1]));
    const objc = new Set([...plugin.matchAll(/@objc(?:\(([A-Za-z]+):\))? func ([A-Za-z]+)\(_ call: CAPPluginCall\)/g)].map((m) => m[1] ?? m[2]));
    const core = read('ios/Sources/HeroSignalPlugin/HeroSignalBridgeCore.swift');
    const handled = new Set([...core.matchAll(/case ((?:"[A-Za-z]+"(?:, )?)+):/g)].flatMap((m) => [...m[1].matchAll(/"([A-Za-z]+)"/g)].map((x) => x[1])));
    for (const m of methods) {
      expect(declared.has(m), `CAPPluginMethod ${m}`).toBe(true);
      expect(objc.has(m), `@objc ${m}`).toBe(true);
      expect(handled.has(m), `çekirdek ${m}`).toBe(true);
    }
    expect(plugin).toContain('public let jsName = "HeroSignal"');
  });

  it('package.json dosya listesi ve native paket tanımları tutarlı', () => {
    const pkg = JSON.parse(read('package.json')) as { files: string[] };
    for (const f of pkg.files.filter((x) => x !== 'dist/')) expect(existsSync(join(root, f)), f).toBe(true);
    expect(read('HerosignalCapacitor.podspec')).toContain("s.source_files     = 'ios/Sources/**/*.{swift,h,m}'");
    expect(read('Package.swift')).toContain('path: "ios/Sources/HeroSignalPlugin"');
    expect(read('android/src/main/java/com/herosignal/capacitor/HeroSignalPlugin.kt')).toContain('name = "HeroSignal"');
  });
});
