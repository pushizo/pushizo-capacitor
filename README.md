# @herosignal/capacitor

HeroSignal'in Capacitor (Ionic) eklentisi. Native HeroSignal Android (`com.herosignal:herosignal-android`) ve iOS (`HeroSignal` pod / SPM) SDK'larını sarar; web platformunda `@herosignal/web` SDK'sına devreder. API yüzeyi plan 06 §6.1 ve eski sağlayıcı v5 ile uyumludur.

- Capacitor 6 ve 7, Android minSdk 23, iOS 15+
- Push aboneliği (FCM/APNs), izin istemi ve izin gözlemcisi
- Bildirim tıklaması (soğuk başlatma dahil), ön plan gösterimini engelleme/erteleme
- Kullanıcı: `login`/`logout` (identity verification `identityHash`), tag, alias, dil, e-posta ve SMS aboneliği
- In-app mesajlar (tetik, ekran, duraklatma, tıklama ve yaşam döngüsü olayları; native çizim)
- Bildirim kutusu (listeleme, okundu, tümünü okundu, arşiv, okunmamış sayısı)
- Özel olay (`Session.sendEvent`), KVKK/GDPR gizlilik onayı, günlük seviyesi, bildirim tepsisini temizleme

## Kurulum

```bash
npm install @herosignal/capacitor @herosignal/web
npx cap sync
```

`@herosignal/web` yalnızca uygulama web'de de çalışacaksa gereklidir; native derlemelerde yüklenmez (dinamik içe aktarma).

## Kullanım

```ts
import { HeroSignal } from '@herosignal/capacitor';

await HeroSignal.initialize('app_xxx', {
  apiUrl: 'https://api.herosignal.dev', // kendi kurulumunuzun API adresi
  requiresPrivacyConsent: false,
  logLevel: 'warn',
});

// Tıklama dinleyicisini mümkün olduğunca erken ekleyin; uygulama bildirimden açıldıysa
// bekleyen tıklama ilk dinleyiciye teslim edilir.
HeroSignal.Notifications.addClickListener((event) => {
  console.log(event.notification.title, event.result.actionId, event.result.url);
});

const granted = await HeroSignal.Notifications.requestPermission();
await HeroSignal.login('user_42');              // identity verification açıksa: login('user_42', identityHash)
await HeroSignal.User.addTags({ plan: 'pro', level: 3 });
await HeroSignal.User.addEmail('ali@example.com');
await HeroSignal.User.addSms('+905551112233');
await HeroSignal.Session.sendEvent('purchase', { sku: 'A1' }, 49.9);
```

### Ön planda gelen bildirim

```ts
HeroSignal.Notifications.addForegroundLifecycleListener((event) => {
  if (event.notification.data.silent_in_app === '1') {
    event.preventDefault();          // gösterme
    // ... daha sonra göstermek için: await event.display();
  }
});
```

Dinleyici eklendiğinde native SDK gösterimi JS kararına kadar bekletir; hiçbir dinleyici `preventDefault()` çağırmazsa bildirim hemen gösterilir. iOS'ta engellenen bildirim en fazla 25 sn içinde `display()` ile gösterilebilir. Web'de engellenen bildirim sonradan gösterilemez.

### Abonelik ve izin gözlemcileri

```ts
const stop = HeroSignal.User.pushSubscription.addObserver((state) => console.log(state.id, state.optedIn));
HeroSignal.Notifications.addPermissionObserver(({ permission }) => console.log('izin', permission));
stop(); // aboneliği kaldırır
```

İzin olayı (`permissionChange`) yerel Android/iOS SDK izin gözlemcisinden gelir: izin isteği sonuçlandığında ve uygulama
ön plana döndüğünde izin ayarlardan değiştiyse yalnızca gerçek değişiklikte iletilir.

### In-app mesajlar

```ts
await HeroSignal.InAppMessages.addTriggers({ level: 5, vip: true });
await HeroSignal.InAppMessages.setScreen('checkout');
HeroSignal.InAppMessages.addClickListener((e) => console.log(e.message.id, e.result.actionId, e.result.url));
HeroSignal.InAppMessages.addLifecycleListener({ didDisplay: (e) => console.log('gösterildi', e.message.id) });
await HeroSignal.InAppMessages.setPaused(true);
```

Mesajlar native SDK'nın kendi görünümüyle (Android Dialog, iOS UIWindow) çizilir.

### Bildirim kutusu

```ts
const page = await HeroSignal.Inbox.list({ limit: 20 });
for (const item of page.items) console.log(item.title, item.read, new Date(item.createdAt ?? 0));
await HeroSignal.Inbox.markRead(page.items[0].id);
const unread = await HeroSignal.Inbox.markAllRead();
await HeroSignal.Inbox.archive(page.items[0].id);
const next = page.hasMore ? await HeroSignal.Inbox.list({ cursor: page.nextCursor! }) : null;
```

Bildirim kutusu kayıtlı bir kullanıcı ve abonelik ister; yoksa `NOT_READY` koduyla reddedilir.

### Bildirim tercihleri

```ts
const { preferences, categories } = await HeroSignal.User.getPreferences();
for (const c of categories) console.log(c.key, c.name.tr ?? c.name.en, c.channels, c.defaultOptedIn);
// channel verilmezse (veya null) tüm kanallar; 1-100 kayıt. Güncel liste döner.
const updated = await HeroSignal.User.setPreferences([
  { category: 'promo', optedIn: false },
  { category: 'news', channel: 'email', optedIn: true },
]);
```

Tercihler bir abonelik ister (yoksa `NOT_READY`); sahiplik kanıtı native SDK tarafından eklenir. Tanımsız kategori `HS_NOT_FOUND`, kategorinin kapsamadığı kanal `HS_VALIDATION_ERROR` ile reddedilir. `updatedAt` epoch milisaniyedir.

### Gizlilik onayı (KVKK/GDPR)

`requiresPrivacyConsent: true` ile başlatıldığında `await HeroSignal.setConsentGiven(true)` çağrılana kadar hiçbir ağ çağrısı yapılmaz.

### Diğer

```ts
await HeroSignal.Notifications.clearAll();                    // tepsi/bildirim merkezi + rozet
await HeroSignal.Notifications.removeGroupedNotifications('orders');
await HeroSignal.Notifications.removeNotification(id);        // Android: notification.androidNotificationId; iOS: UNNotificationRequest.identifier (metin)
await HeroSignal.Debug.setLogLevel('debug');
await HeroSignal.logout();
```

Hatalar `code` alanı taşır: `INVALID_ARGUMENT` (geçersiz e-posta/telefon, eksik alan), `NOT_READY` (başlatılmadı/abonelik yok), `NOT_FOUND`, `UNAVAILABLE` (platformda yok) veya sunucu hata kodu.

## Android kurulumu (FCM)

1. Firebase konsolunda Android uygulaması ekleyin, `google-services.json` dosyasını `android/app/` altına koyun. Capacitor şablonu `com.google.gms.google-services` eklentisini dosya varsa otomatik uygular.
2. HeroSignal dashboard'unda uygulamanın Android (FCM) kimlik bilgisi adımında Firebase servis hesabı JSON'unu yükleyin; kayıt sonrası otomatik doğrulanır (kurulum sihirbazında **Capacitor/Ionic** seçilebilir).
3. Eklenti `com.herosignal:herosignal-android` artefaktına bağlıdır. Yayın öncesi monorepo kullanımında `sdk/android` içinde `gradle :herosignal:publishToMavenLocal` çalıştırın ve uygulamanın `android/build.gradle` dosyasındaki `allprojects.repositories` bloğuna `mavenLocal()` ekleyin. SDK sürümü `variables.gradle` içinde `herosignalAndroidVersion` ile değiştirilebilir.
4. Android 13+ bildirim izni `Notifications.requestPermission()` ile istenir. Bildirim ikonu için `AndroidManifest.xml` içinde `com.herosignal.sdk.default_notification_icon` meta-data'sı verilebilir.

Eklenti, JS ile yapılan ilk `initialize` ayarlarını (yalnızca uygulama kimliği ve herkese açık ayarlar) saklar; süreç bildirim tıklaması veya FCM mesajıyla yeniden başladığında SDK WebView yüklenmeden başlatılır, böylece tıklama ve `received` bildirimi kaybolmaz.

## iOS kurulumu (APNs)

1. Xcode'da **Signing & Capabilities** altında **Push Notifications** ve **Background Modes → Remote notifications** yeteneklerini ekleyin.
2. HeroSignal dashboard'unda APNs `.p8` anahtarını (Key ID, Team ID, bundle id) veya `.p12` sertifikasını yükleyin; sandbox ve production için otomatik doğrulanır.
3. APNs token'ının eklentiye ulaşması için `ios/App/App/AppDelegate.swift` içine Capacitor bildirimlerini ekleyin:

```swift
func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
}

func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
}
```

4. CocoaPods: `HeroSignal` pod'u yayınlanana kadar `ios/App/Podfile` içine `pod 'HeroSignal', :path => '<repo>/sdk/ios'` ekleyin. SPM (Capacitor 7): paket `https://github.com/exec0de/herosignal-ios.git` deposundan çözülür.

HeroSignal SDK'sı `UNUserNotificationCenter` delegesini üstlenir (ön plan gösterimi ve tıklama). Aynı uygulamada `@capacitor/push-notifications` kullanmayın.

### Notification Service Extension (zengin medya, teslim bildirimi)

Resimli bildirimler, rozet artışı ve uygulama kapalıyken `received` bildirimi için bir NSE hedefi ekleyin:

1. Xcode → **File → New → Target → Notification Service Extension** (ör. `HeroSignalNSE`), dağıtım hedefi iOS 15.
2. Podfile'a hedefi ekleyin:

```ruby
target 'HeroSignalNSE' do
  pod 'HeroSignal/Extension', :path => '<repo>/sdk/ios'
end
```

3. `NotificationService.swift` içeriğini SDK yardımcısına devredin (CocoaPods'ta modül adı `HeroSignal`, SPM'de `HeroSignalExtension`):

```swift
import UserNotifications
import HeroSignal

class NotificationService: UNNotificationServiceExtension {
    let hs = HeroSignalNotificationServiceExtension(appId: "app_xxx", apiUrl: "https://api.herosignal.dev",
                                                    appGroup: "group.com.example.app.herosignal")

    override func didReceive(_ request: UNNotificationRequest, withContentHandler handler: @escaping (UNNotificationContent) -> Void) {
        hs.didReceive(request, withContentHandler: handler)
    }

    override func serviceExtensionTimeWillExpire() { hs.serviceExtensionTimeWillExpire() }
}
```

4. Uygulama ve NSE hedeflerinde aynı **App Group** yeteneğini açın ve uygulamanın `Info.plist` dosyasına `HeroSignalAppGroup` anahtarıyla yazın (verilmezse `group.<bundle id>.herosignal` kullanılır); rozet sayacı bu grup üzerinden paylaşılır. Gönderilen bildirimde `mutable-content` HeroSignal sunucusu tarafından ayarlanır.

## Web

Web platformunda `@herosignal/web` kullanılır: `HeroSignalSDKWorker.js` dosyasını sitenizin köküne koyun ve gerekirse `initialize(appId, { web: { serviceWorkerPath: '/HeroSignalSDKWorker.js' } })` verin. Web'de `removeNotification`, `User.getEmails` ve `User.getSmsNumbers` yoktur (`UNAVAILABLE`); `clearAll` service worker bildirimlerini kapatır. `User.setPreferences` web'de güncel listeyi okuyup kategori/kanalı denetler, yazmayı web SDK'nın çevrimdışı kuyruğuna verir ve yazma sonrası listeyi döndürür (istek arka planda gönderilir).

## Geliştirme

```bash
npm install
npm run typecheck
npm test        # vitest: cephe, web uygulaması ve native sözleşme denetimi
npm run build   # dist/esm
```

Örnek uygulama: `examples/ionic-capacitor`.
