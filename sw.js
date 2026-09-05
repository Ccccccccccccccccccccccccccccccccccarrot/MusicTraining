
const CACHE="notetrainer-v01-cache-3";
const ASSETS=["./","./index.html","./style.css","./app.js","./manifest.json","./icons/icon-192.png","./icons/icon-512.png"];
self.addEventListener("install",e=>e.waitUntil(
  caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())
));
self.addEventListener("activate",e=>e.waitUntil(
  caches.keys()
    .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim())
));
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET") return;
  e.respondWith((async()=>{
    try{
      const resp=await fetch(e.request);
      if(resp.ok && new URL(e.request.url).origin===self.location.origin){
        const cache=await caches.open(CACHE);
        await cache.put(e.request,resp.clone());
      }
      return resp;
    }catch{
      const cached=await caches.match(e.request,{ignoreSearch:true});
      if(cached) return cached;
      if(e.request.mode==="navigate") return caches.match("./index.html");
      return Response.error();
    }
  })());
});
