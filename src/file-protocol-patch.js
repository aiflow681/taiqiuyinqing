(function () {
  if (location.protocol !== 'file:') {
    return;
  }

  var fileMap = window.__LOCAL_FILE_B64__ || {};
  var decodedCache = Object.create(null);
  var rootUrl = new URL('./', location.href);

  function toRelativePath(input) {
    try {
      var targetUrl = new URL(typeof input === 'string' ? input : String(input.url || ''), rootUrl);
      if (targetUrl.protocol !== 'file:' || targetUrl.pathname.indexOf(rootUrl.pathname) !== 0) {
        return null;
      }
      return decodeURIComponent(targetUrl.pathname.slice(rootUrl.pathname.length));
    } catch (e) {
      return null;
    }
  }

  function base64ToBytes(base64) {
    var cached = decodedCache[base64];
    if (cached) {
      return cached;
    }
    var binary = atob(base64);
    var len = binary.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    decodedCache[base64] = bytes;
    return bytes;
  }

  function bytesToText(bytes) {
    if (window.TextDecoder) {
      return new TextDecoder('utf-8').decode(bytes);
    }
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      out += String.fromCharCode(bytes[i]);
    }
    return out;
  }

  function safeDefine(obj, key, value) {
    try {
      Object.defineProperty(obj, key, { value: value, configurable: true });
    } catch (e) {
      try {
        obj[key] = value;
      } catch (err) {
        // ignore
      }
    }
  }

  function createResponse(entry) {
    var bytes = base64ToBytes(entry.data);
    var body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return new Response(body, {
      status: 200,
      statusText: 'OK',
      headers: {
        'Content-Type': entry.mime || 'application/octet-stream'
      }
    });
  }

  var originalFetch = window.fetch && window.fetch.bind(window);
  if (originalFetch) {
    window.fetch = function (input, init) {
      var relativePath = toRelativePath(input);
      if (relativePath && Object.prototype.hasOwnProperty.call(fileMap, relativePath)) {
        return Promise.resolve(createResponse(fileMap[relativePath]));
      }
      return originalFetch(input, init);
    };
  }

  if (window.XMLHttpRequest) {
    var originalOpen = window.XMLHttpRequest.prototype.open;
    var originalSend = window.XMLHttpRequest.prototype.send;

    window.XMLHttpRequest.prototype.open = function (method, url) {
      this.__fileRelativePath = toRelativePath(url);
      this.__fileMethod = method;
      return originalOpen.apply(this, arguments);
    };

    window.XMLHttpRequest.prototype.send = function () {
      var relativePath = this.__fileRelativePath;
      if (!relativePath || !Object.prototype.hasOwnProperty.call(fileMap, relativePath)) {
        return originalSend.apply(this, arguments);
      }

      var entry = fileMap[relativePath];
      var bytes = base64ToBytes(entry.data);
      var responseType = this.responseType || '';
      var response;

      if (responseType === 'arraybuffer') {
        response = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      } else if (responseType === 'blob') {
        response = new Blob([bytes], { type: entry.mime || 'application/octet-stream' });
      } else if (responseType === 'json') {
        response = JSON.parse(bytesToText(bytes));
      } else {
        response = bytesToText(bytes);
      }

      safeDefine(this, 'status', 200);
      safeDefine(this, 'statusText', 'OK');
      safeDefine(this, 'response', response);
      safeDefine(this, 'responseText', typeof response === 'string' ? response : '');

      var self = this;
      setTimeout(function () {
        if (typeof self.onload === 'function') {
          self.onload();
        }
        if (typeof self.onreadystatechange === 'function') {
          safeDefine(self, 'readyState', 4);
          self.onreadystatechange();
        }
      }, 0);
    };
  }
})();
