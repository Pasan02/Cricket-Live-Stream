'use strict';
// All sources are validated, locally served logo URLs. Videos are always silent.
globalThis.createLogoMedia = (src, className = '') => {
  const video = /\.(mp4|webm)$/.test(src) || /^data:video\/(mp4|webm);/.test(src), element = document.createElement(video ? 'video' : 'img');
  element.className = className;
  if (video) {
    element.style.background = 'transparent';
    element.muted = true; element.defaultMuted = true; element.autoplay = true;
    element.loop = true; element.playsInline = true; element.preload = 'auto';
    element.disableRemotePlayback = true;
  } else element.alt = '';
  element.src = src; return element;
};
