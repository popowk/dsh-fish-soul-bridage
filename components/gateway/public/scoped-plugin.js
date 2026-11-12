/* Fish-soul native plugin adapter; only its approved API namespace is routed. */
(()=>{
  'use strict';
  const mount=new URL('./',document.baseURI);
  function scoped(input){
    if(typeof input !== 'string')return input;
    if(!input.startsWith('/api/plugins/fish-soul/'))return input;
    return new URL(input.slice(1),mount).href;
  }
  const originalFetch=window.fetch.bind(window);
  window.fetch=function(input,options){
    if(typeof Request!=='undefined'&&input instanceof Request){
      const next=scoped(input.url);
      if(next!==input.url)input=new Request(next,input);
    }else input=scoped(input);
    return originalFetch(input,options);
  };
  const originalOpen=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(method,url,...rest){
    return originalOpen.call(this,method,scoped(url),...rest);
  };
})();
