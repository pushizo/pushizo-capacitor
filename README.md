# @pushizo/capacitor

Pushizo'nun Capacitor (Ionic) eklentisi. Native Pushizo Android (`com.pushizo:pushizo-android`) ve iOS (`Pushizo` pod / SPM) SDK'larını sarar; web platformunda `@pushizo/web` SDK'sına devreder. API yüzeyi plan 06 §6.1 ve eski sağlayıcı v5 ile uyumludur.

- Capacitor 6 ve 7, Android minSdk 23, iOS 15+
- Push aboneliği (FCM/APNs), izin istemi ve izin gözlemcisi
- Bildirim tıklaması (soğuk başlatma dahil), ön plan gösterimini engelleme/erteleme
- Kullanıcı: `login`/`logout` (identity verification `identityHash`), tag, alias, dil, e-posta ve SMS aboneliği
- In-app mesajlar (tetik, ekran, duraklatma, tıklama ve yaşam döngüsü olayları; native çizim)
- Bildirim kutusu (listeleme, okundu, tümünü okundu, arşiv, okunmamış sayısı)
- Konum paylaşımı (yalnızca ön plan, açıklama + izin istemi; web'de `@pushizo/web`)
- Özel olay (`Session.sendEvent`), KVKK/GDPR gizlilik onayı, günlük seviyesi, bildirim tepsisini temizleme

## Kurulum

```bash
npm install @pushizo/capacitor @pushizo/web
npx cap sync
```

`@pushizo/web` yalnızca uygulama web'de de çalışacaksa gereklidir; native derlemelerde yüklenmez (dinamik içe aktarma).

## Kullanım

```ts
import { Pushizo } from '@pushizo/capacitor';

await Pushizo.initialize('app_xxx', {
  apiUrl: 'https://api.pushizo.com', // kendi kurulumunuzun API adresi
  requiresPrivacyConsent: false,
  logLevel: 'warn',
});

// Tıklama dinleyicisini mümkün olduğunca erken ekleyin; uygulama bildirimden açıldıysa
// bekleyen tıklama ilk dinleyiciye teslim edilir.
Pushizo.Notifications.addClickListener((event) => {
  console.log(event.notification.title, event.result.actionId, event.result.url);
});

const granted = await Pushizo.Notifications.requestPermission();
await Pushizo.login('user_42');              // identity verification açıksa: login('user_42', identityHash)
await Pushizo.User.addTags({ plan: 'pro', level: 3 });
await Pushizo.User.addEmail('ali@example.com');
await Pushizo.User.addSms('+905551112233');
await Pushizo.Session.sendEvent('purchase', { sku: 'A1' }, 49.9);
```

### Ön planda gelen bildirim

```ts
Pushizo.Notifications.addForegroundLifecycleListener((event) => {
  if (event.notification.data.silent_in_app === '1') {
    event.preventDefault();          // gösterme
    // ... daha sonra göstermek için: await event.display();
  }
});
```

Dinleyici eklendiğinde native SDK gösterimi JS kararına kadar bekletir; hiçbir dinleyici `preventDefault()` çağırmazsa bildirim hemen gösterilir. iOS'ta engellenen bildirim en fazla 25 sn içinde `display()` ile gösterilebilir. Web'de engellenen bildirim sonradan gösterilemez.

### Abonelik ve izin gözlemcileri

```ts
const stop = Pushizo.User.pushSubscription.addObserver((state) => console.log(state.id, state.optedIn));
Pushizo.Notifications.addPermissionObserver(({ permission }) => console.log('izin', permission));
stop(); // aboneliği kaldırır
```

İzin olayı (`permissionChange`) yerel Android/iOS SDK izin gözlemcisinden gelir: izin isteği sonuçlandığında ve uygulama
ön plana döndüğünde izin ayarlardan değiştiyse yalnızca gerçek değişiklikte iletilir.

### In-app mesajlar

```ts
await Pushizo.InAppMessages.addTriggers({ level: 5, vip: true });
await Pushizo.InAppMessages.setScreen('checkout');
Pushizo.InAppMessages.addClickListener((e) => console.log(e.message.id, e.result.actionId, e.result.url));
Pushizo.InAppMessages.addLifecycleListener({ didDisplay: (e) => console.log('gösterildi', e.message.id) });
await Pushizo.InAppMessages.setPaused(true);
```

Mesajlar native SDK'nın kendi görünümüyle (Android Dialog, iOS UIWindow) çizilir.

### HTML in-app ve carousel

In-app mesajları yerel Android/iOS SDK'sı çizer; bu paket köprüdür. HTML in-app (sandbox'lı WebView, köprü
`close`/`click`/`addTag`/`trackEvent`) ve carousel blokları yerel SDK'dan olduğu gibi devralınır: ek kod veya
yapılandırma gerekmez, tıklama ve yaşam döngüsü olayları mevcut in-app dinleyicilerine gelir. Yetenek bildirimi
(`supports=html,carousel`) yerel SDK tarafından yapılır; desteklemeyen eski yerel sürümlere sunucu HTML mesaj göndermez
ve carousel bloklarını çıkarır (ADR-0027 §6–7).

### Bildirim kutusu

```ts
const page = await Pushizo.Inbox.list({ limit: 20 });
for (const item of page.items) console.log(item.title, item.read, new Date(item.createdAt ?? 0));
await Pushizo.Inbox.markRead(page.items[0].id);
const unread = await Pushizo.Inbox.markAllRead();
await Pushizo.Inbox.archive(page.items[0].id);
const next = page.hasMore ? await Pushizo.Inbox.list({ cursor: page.nextCursor! }) : null;
```

Bildirim kutusu kayıtlı bir kullanıcı ve abonelik ister; yoksa `NOT_READY` koduyla reddedilir.

### Bildirim tercihleri

```ts
const { preferences, categories } = await Pushizo.User.getPreferences();
for (const c of categories) console.log(c.key, c.name.tr ?? c.name.en, c.channels, c.defaultOptedIn);
// channel verilmezse (veya null) tüm kanallar; 1-100 kayıt. Güncel liste döner.
const updated = await Pushizo.User.setPreferences([
  { category: 'promo', optedIn: false },
  { category: 'news', channel: 'email', optedIn: true },
]);
```

Tercihler bir abonelik ister (yoksa `NOT_READY`); sahiplik kanıtı native SDK tarafından eklenir. Tanımsız kategori `HS_NOT_FOUND`, kategorinin kapsamadığı kanal `HS_VALIDATION_ERROR` ile reddedilir. `updatedAt` epoch milisaniyedir.

### JWT ile kimlik doğrulama

App ayarlarında kimlik doğrulama kipi (`identity_verification_mode`) `jwt` veya `both` ise kullanıcı, sunucunuzda
imzalanmış kısa ömürlü bir ES256 JWT ile kimliklendirilir (ADR-0023 §9; talepler: `sub` = external_id, `aud` = app_id, `exp`/`iat` zorunlu, en çok 24 saat, yalnızca ES256).

```ts
await Pushizo.login('user_42', { jwt: jwtFromBackend });                  // yalnızca JWT
await Pushizo.login('user_42', { identityHash: hmac, jwt: jwtFromBackend }); // both kipinde ikisi birlikte
await Pushizo.updateUserJwt(refreshedJwt); // süresi dolmadan yenileyin
await Pushizo.logout();
```

- JWT yerel SDK'da identity hash ile aynı kalıcı depoda saklanır ve tüm `/sdk/v1/...` isteklerinde
  `Authorization: Bearer <jwt>` başlığıyla gider; gövdeye/URL'ye yazılmaz, loglanmaz. `logout` belirteci siler.
- `/config` yanıtında `identity_verification_required` true ise login öncesi kanıt denetlenir: `jwt` kipinde JWT, `hmac`
  kipinde `identityHash` zorunludur, `both` kipinde biri yeter; eksikse `login` `NOT_READY` ile reddedilir. Alan gelmeyen
  eski sunucularda kip `hmac` sayılır; ikinci argümanı metin olan eski `login(id, identityHash)` çağrıları aynen çalışır.
- `updateUserJwt` giriş yapılmamışsa `NOT_READY` ile reddedilir; başarıda kuyrukta bekleyen işlemler yeni belirteçle
  yeniden denenir.
- Web platformunda çağrılar `@pushizo/web` SDK'sının `login(id, { identityHash, jwt })` ve `updateUserJwt` yöntemlerine
  iletilir.

### Live Activities (iOS)

Eklenti, iOS SDK'nın genel `PushizoDefaultLiveActivityAttributes` türünü kullanır (ADR-0024). Push-to-start (sunucudan
uzaktan başlatma) iOS 17.2+, yerel başlatma iOS 16.1+ ister; Android ve web'de çağrılar `PLATFORM_NOT_SUPPORTED` ile
reddedilir.

```ts
await Pushizo.initialize('app_…');
await Pushizo.LiveActivities.setupDefaultLiveActivity(); // her açılışta: belirteçler sunucuya kaydedilir
await Pushizo.LiveActivities.startDefaultLiveActivity('order_42', { title: 'Sipariş #42' }, { status: 'Yolda', eta: 12 });
```

1. `ios/App/App/Info.plist` dosyasına `NSSupportsLiveActivities = YES` ekleyin.
2. Xcode → **File → New → Target → Widget Extension** ("Include Live Activity" seçili). Widget hedefine SPM'de
   `PushizoExtension` ürününü ekleyip `import PushizoExtension`, CocoaPods'ta `pod 'Pushizo/Extension'` ekleyip
   `import Pushizo` yazın:

   ```swift
   ActivityConfiguration(for: PushizoDefaultLiveActivityAttributes.self) { context in
       VStack {
           Text(context.attributes.data["title"]?.stringValue ?? "")
           Text(context.state.data["status"]?.description ?? "")
       }
   } dynamicIsland: { context in
       DynamicIsland { DynamicIslandExpandedRegion(.center) { Text(context.state.data["status"]?.description ?? "") } }
           compactLeading: { EmptyView() } compactTrailing: { Text(context.state.data["eta"]?.description ?? "") } minimal: { EmptyView() }
   }
   ```

3. Dashboard'da (**App → Live Activities**) veya API'de tür adı tam olarak `PushizoDefaultLiveActivityAttributes`
   olarak tanımlanmalıdır. Sunucudan gönderim:
   `POST /v1/apps/{appId}/live-activities/PushizoDefaultLiveActivityAttributes/start` (`activity_id`, `attributes`,
   `content_state`, `target`), `…/update` ve `…/end` (`activity_id` ile).

- `activityId` 1-100 karakter (harf, rakam ve `_ . : -`); `attributes`/`contentState` düz nesnedir, anahtarlar 1-64
  karakter, değerler metin, sonlu sayı veya boolean'dır; `attributes` içinde `pushizo` anahtarı ayrılmıştır. Kurala
  uymayan girdi native'e gitmeden `TypeError` fırlatır.
- Ret kodları: `PLATFORM_NOT_SUPPORTED` (Android, web veya iOS 16.1 öncesi), `NOT_READY` (`initialize` çağrılmadı),
  `INVALID_ARGUMENT`, `LIVE_ACTIVITY_FAILED` (Live Activities kapalı, `NSSupportsLiveActivities` yok vb.).
- Kendi tip-güvenli `ActivityAttributes` türünüzü kullanmak isterseniz native tarafta (`AppDelegate`)
  `Pushizo.LiveActivities.register(MyAttributes.self)` çağırın; ayrıntı `docs/sdk/ios.md` → "Live Activities".

### Canlı sohbet

```ts
await Pushizo.Chat.start({ name: 'Ali' });
const config = await Pushizo.Chat.getConfig();          // online, offlineMessage, ek sınırları
const { messages } = await Pushizo.Chat.getMessages();
Pushizo.Chat.addEventListener('message', ({ message }) => render(message));
Pushizo.Chat.addEventListener('open', ({ conversationId }) => openChat(conversationId)); // bildirime tıklama
await Pushizo.Chat.startListening();                     // ekran açıkken; ayrılınca stopListening()
await Pushizo.Chat.sendMessage('Merhaba');               // bot hızlı yanıtı: sendMessage(label, { optionId })
await Pushizo.Chat.sendAttachment({ base64 }, { fileName: 'a.png', mimeType: 'image/png' });
await Pushizo.Chat.markRead(messages[messages.length - 1].seq);
```

Ziyaretçi kimliği, çevrimdışı kuyruk (aynı `client_message_id` ile yeniden deneme), canlı akış (SSE; koparsa üstel
geri çekilme + `after_seq` yoklaması) ve push ile gelen temsilci mesajları (`pushizo_chat`) yerel Android/iOS SDK'sındadır;
`start` sonrası login/logout ve push aboneliği değişince bağlama yerel SDK'da yenilenir, logout ziyaretçiyi sıfırlar.
Mesajlar `seq` ile sıralanır; ağ yokken gönderilen mesaj `pending` döner ve gönderilince olayla sunucu kopyası gelir.
Ayrıntı: `docs/sdk/android.md` / `docs/sdk/ios.md` → "Canlı sohbet" (ADR-0040).
Capacitor web'de sohbet `@pushizo/web` widget'ıyla sunulur; `Pushizo.Chat` çağrıları `PLATFORM_NOT_SUPPORTED` döner.

### Konum

Kullanıcı izin verirse cihazın konumu push aboneliğine yazılır (v2 Faz 17b); segmentlerde konuma göre hedefleme için
kullanılır. Paylaşım **yalnızca ön planda** çalışır (arka plan konumu yok): native SDK konumu oturum başında ve uygulama
ön plana döndüğünde en sık 5 dakikada bir gönderir. İzin yoksa veya gizlilik onayı (`requiresPrivacyConsent`)
verilmemişse hiçbir şey gönderilmez; tercih kalıcıdır.

```ts
const granted = await Pushizo.Location.requestPermission('Yakındaki mağazaları göstermek için konumunuzu kullanırız.');
if (granted) await Pushizo.Location.setShared(true);
const shared = await Pushizo.Location.isShared();         // kalıcı tercih (izin durumundan bağımsız)
await Pushizo.Location.setShared(false);                  // paylaşımı kapatır, sunucudaki konumu siler
```

- `requestPermission(rationale?)`: izin yoksa önce açıklama gösterilir (`rationale`; verilmezse SDK'nın Türkçe/İngilizce
  varsayılan metni), kullanıcı "Şimdi değil" derse sistem istemi açılmaz. İzin varsa veya verildiyse `true`; reddedildiyse,
  uygulama izni tanımlamadıysa ya da vazgeçildiyse `false`. `isShared()` native SDK'daki özelliğin asenkron karşılığıdır.
- `initialize` öncesinde `setShared`/`requestPermission` `NOT_READY` koduyla reddedilir.
- **KVKK:** sunucuya ulaşan ilk konum açık rıza kaydı olarak saklanır. Kullanıcıya konumun neden kullanıldığını
  açıklayın ve paylaşımı yalnızca onayıyla açın. `setShared(false)` sunucuya `location: null` gönderir; konum ve rıza
  kaydı silinir, henüz gönderilmemiş konum atılır.
- **iOS:** `ios/App/App/Info.plist` dosyasına `NSLocationWhenInUseUsageDescription` ekleyin (yoksa `requestPermission`
  `false` döner). Yalnızca "Uygulamayı Kullanırken" izni istenir; "Her Zaman" istenmez. Reddedilmiş izin yeniden
  sorulamaz, kullanıcı Ayarlar'a yönlendirilmelidir.
- **Android:** eklenti konum iznini manifest'e **otomatik eklemez**; `android/app/src/main/AndroidManifest.xml` dosyasına kendiniz ekleyin
  (yaklaşık konum yeterlidir, hassas konum isteğe bağlıdır):

  ```xml
  <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
  <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
  ```

  Yalnızca manifest'te tanımlı izinler istenir; hiçbiri yoksa uyarı loglanır ve `false` döner. Açıklama diyaloğu SDK'nın
  string kaynaklarını kullanır; sistem izni Capacitor izin API'siyle istenir ve sonuç SDK'ya iletilir.
- **Web:** çağrılar `@pushizo/web` `Location` yüzeyine iletilir (tarayıcı Geolocation izni; açıklama kutusu Web SDK
  tarafından gösterilir, `initialize` öncesinde Web SDK hatası döner).

### Gizlilik onayı (KVKK/GDPR)

`requiresPrivacyConsent: true` ile başlatıldığında `await Pushizo.setConsentGiven(true)` çağrılana kadar hiçbir ağ çağrısı yapılmaz.

### Diğer

```ts
await Pushizo.Notifications.clearAll();                    // tepsi/bildirim merkezi + rozet
await Pushizo.Notifications.removeGroupedNotifications('orders');
await Pushizo.Notifications.removeNotification(id);        // Android: notification.androidNotificationId; iOS: UNNotificationRequest.identifier (metin)
await Pushizo.Debug.setLogLevel('debug');
await Pushizo.logout();
```

Hatalar `code` alanı taşır: `INVALID_ARGUMENT` (geçersiz e-posta/telefon, eksik alan), `NOT_READY` (başlatılmadı/abonelik yok), `NOT_FOUND`, `UNAVAILABLE` (platformda yok), `PLATFORM_NOT_SUPPORTED` / `LIVE_ACTIVITY_FAILED` (Live Activities) veya sunucu hata kodu.

## Android kurulumu (FCM)

1. Firebase konsolunda Android uygulaması ekleyin, `google-services.json` dosyasını `android/app/` altına koyun. Capacitor şablonu `com.google.gms.google-services` eklentisini dosya varsa otomatik uygular.
2. Pushizo dashboard'unda uygulamanın Android (FCM) kimlik bilgisi adımında Firebase servis hesabı JSON'unu yükleyin; kayıt sonrası otomatik doğrulanır (kurulum sihirbazında **Capacitor/Ionic** seçilebilir).
3. Eklenti `com.pushizo:pushizo-android` artefaktına bağlıdır. Yayın öncesi monorepo kullanımında `sdk/android` içinde `gradle :pushizo:publishToMavenLocal` çalıştırın ve uygulamanın `android/build.gradle` dosyasındaki `allprojects.repositories` bloğuna `mavenLocal()` ekleyin. SDK sürümü `variables.gradle` içinde `pushizoAndroidVersion` ile değiştirilebilir.
4. Android 13+ bildirim izni `Notifications.requestPermission()` ile istenir. Bildirim ikonu için `AndroidManifest.xml` içinde `com.pushizo.sdk.default_notification_icon` meta-data'sı verilebilir.

Eklenti, JS ile yapılan ilk `initialize` ayarlarını (yalnızca uygulama kimliği ve herkese açık ayarlar) saklar; süreç bildirim tıklaması veya FCM mesajıyla yeniden başladığında SDK WebView yüklenmeden başlatılır, böylece tıklama ve `received` bildirimi kaybolmaz.

## iOS kurulumu (APNs)

1. Xcode'da **Signing & Capabilities** altında **Push Notifications** ve **Background Modes → Remote notifications** yeteneklerini ekleyin.
2. Pushizo dashboard'unda APNs `.p8` anahtarını (Key ID, Team ID, bundle id) veya `.p12` sertifikasını yükleyin; sandbox ve production için otomatik doğrulanır.
3. APNs token'ının eklentiye ulaşması için `ios/App/App/AppDelegate.swift` içine Capacitor bildirimlerini ekleyin:

```swift
func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
}

func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
}
```

4. CocoaPods: `ios/App/Podfile` içine `pod 'Pushizo'` ekleyin (CocoaPods trunk). SPM (Capacitor 7): paket `https://github.com/exec0de/pushizo-ios.git` deposundan çözülür.

Pushizo SDK'sı `UNUserNotificationCenter` delegesini üstlenir (ön plan gösterimi ve tıklama). Aynı uygulamada `@capacitor/push-notifications` kullanmayın.

### Notification Service Extension (zengin medya, teslim bildirimi)

Resimli bildirimler, rozet artışı ve uygulama kapalıyken `received` bildirimi için bir NSE hedefi ekleyin:

1. Xcode → **File → New → Target → Notification Service Extension** (ör. `PushizoNSE`), dağıtım hedefi iOS 15.
2. Podfile'a hedefi ekleyin:

```ruby
target 'PushizoNSE' do
  pod 'Pushizo/Extension'
end
```

3. `NotificationService.swift` içeriğini SDK yardımcısına devredin (CocoaPods'ta modül adı `Pushizo`, SPM'de `PushizoExtension`):

```swift
import UserNotifications
import Pushizo

class NotificationService: UNNotificationServiceExtension {
    let hs = PushizoNotificationServiceExtension(appId: "app_xxx", apiUrl: "https://api.pushizo.com",
                                                    appGroup: "group.com.example.app.pushizo")

    override func didReceive(_ request: UNNotificationRequest, withContentHandler handler: @escaping (UNNotificationContent) -> Void) {
        hs.didReceive(request, withContentHandler: handler)
    }

    override func serviceExtensionTimeWillExpire() { hs.serviceExtensionTimeWillExpire() }
}
```

4. Uygulama ve NSE hedeflerinde aynı **App Group** yeteneğini açın ve uygulamanın `Info.plist` dosyasına `PushizoAppGroup` anahtarıyla yazın (verilmezse `group.<bundle id>.pushizo` kullanılır); rozet sayacı bu grup üzerinden paylaşılır. Gönderilen bildirimde `mutable-content` Pushizo sunucusu tarafından ayarlanır.

## Web

Web platformunda `@pushizo/web` kullanılır: `PushizoSDKWorker.js` dosyasını sitenizin köküne koyun ve gerekirse `initialize(appId, { web: { serviceWorkerPath: '/PushizoSDKWorker.js' } })` verin. Web'de `removeNotification`, `User.getEmails` ve `User.getSmsNumbers` yoktur (`UNAVAILABLE`); `clearAll` service worker bildirimlerini kapatır. `User.setPreferences` web'de güncel listeyi okuyup kategori/kanalı denetler, yazmayı web SDK'nın çevrimdışı kuyruğuna verir ve yazma sonrası listeyi döndürür (istek arka planda gönderilir).

## Geliştirme

```bash
npm install
npm run typecheck
npm test        # vitest: cephe, web uygulaması ve native sözleşme denetimi
npm run build   # dist/esm
```

Örnek uygulama: `examples/ionic-capacitor`.
