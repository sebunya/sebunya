/**
 * GoldPlus first-party tracker.
 *
 * Sends server-side activity events to our own API — no third-party
 * cookies, pixels, or external trackers. The visitor id is a random
 * UUID kept in localStorage (first-party storage only) and the session
 * id lives in sessionStorage. Honours Do Not Track / Global Privacy
 * Control by sending nothing at all.
 */
(function () {
  'use strict';

  if (navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true) {
    return;
  }

  var script = document.currentScript;
  var apiBase = (script && script.getAttribute('data-api-base')) || '';
  if (!apiBase) return;

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'v-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function storedId(storage, key) {
    try {
      var id = storage.getItem(key);
      if (!id) {
        id = uuid();
        storage.setItem(key, id);
      }
      return id;
    } catch (e) {
      return uuid(); // storage blocked — fall back to per-page id
    }
  }

  var visitorId = storedId(window.localStorage, 'gp_vid');
  var sessionId = storedId(window.sessionStorage, 'gp_sid');

  function track(eventType, extra) {
    var payload = {
      visitorId: visitorId,
      sessionId: sessionId,
      eventType: eventType,
      path: location.pathname,
    };
    if (extra) {
      if (extra.entity) payload.entity = extra.entity;
      if (extra.entityId) payload.entityId = extra.entityId;
      if (extra.properties) payload.properties = extra.properties;
    }
    var body = JSON.stringify(payload);
    var url = apiBase + '/events/track';
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
      } else {
        fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true });
      }
    } catch (e) {
      /* tracking must never break the page */
    }
  }

  // Expose for feature code (e.g. add-to-cart buttons) to reuse.
  window.gpTrack = track;

  track('PAGE_VIEW');
})();
