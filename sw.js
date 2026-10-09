var CACHE = "souq-v42"; // كل ما تعدّل index.html/admin.html غيّر هذا الرقم (v4, v5...) عشان يجبر المتصفح ياخذ آخر نسخة فورًا
var ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

// يسمح للصفحة بإجبار نسخة SW الجديدة على التفعّل فوراً بدل انتظار إغلاق كل التبويبات
self.addEventListener("message", function (e) {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return; // بيانات الشيت دائماً مباشرة

  // صفحات HTML (index.html/admin.html نفسها): نجبرها تتجاوز كاش المتصفح العادي وتروح للشبكة فعليًا،
  // حتى لو السيرفر مُهيّأ يخزّنها لفترة — هذا كان السبب في ظهور نسخة قديمة رغم تحديث الملفات.
  var isPage = req.mode === "navigate" || (req.headers.get("accept") || "").indexOf("text/html") !== -1;
  var fetchReq = isPage ? new Request(req.url, { cache: "reload" }) : req;

  e.respondWith(
    fetch(fetchReq).then(function (res) {
      // نخزّن فقط الردود السليمة، حتى لا يُحفظ خطأ 404/500 ويظهر بدل الصفحة
      if (res && res.ok && res.type === "basic") {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (r) { return r || caches.match("./index.html"); });
    })
  );
});
