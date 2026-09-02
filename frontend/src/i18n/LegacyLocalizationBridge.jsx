import { useEffect } from 'react';
import { translateLegacyPhrase } from './legacyPhrases.js';

const textState = new WeakMap();
const attributeState = new WeakMap();
const SKIP_SELECTOR = 'script,style,code,pre,textarea,[data-i18n-skip="true"]';
const TRANSLATABLE_ATTRIBUTES = ['title', 'placeholder', 'aria-label'];
let applying = false;

function preserveWhitespace(source, translated) {
  const leading = source.match(/^\s*/u)?.[0] || '';
  const trailing = source.match(/\s*$/u)?.[0] || '';
  return `${leading}${translated}${trailing}`;
}

function shouldSkip(node) {
  const parent = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  return !parent || Boolean(parent.closest(SKIP_SELECTOR));
}

function translateTextNode(node, locale) {
  if (shouldSkip(node)) return;
  const current = node.nodeValue || '';
  if (!current.trim()) return;
  let state = textState.get(node);
  if (!state || (current !== state.translated && current !== state.original)) state = { original: current, translated: current };
  const source = state.original;
  const translatedCore = translateLegacyPhrase(locale, source);
  const next = locale === 'de' ? source : preserveWhitespace(source, translatedCore);
  state.translated = next;
  textState.set(node, state);
  if (current !== next) node.nodeValue = next;
}

function translateAttributes(element, locale) {
  if (shouldSkip(element)) return;
  let states = attributeState.get(element) || new Map();
  for (const name of TRANSLATABLE_ATTRIBUTES) {
    if (!element.hasAttribute(name)) continue;
    const current = element.getAttribute(name) || '';
    let state = states.get(name);
    if (!state || (current !== state.translated && current !== state.original)) state = { original: current, translated: current };
    const next = locale === 'de' ? state.original : translateLegacyPhrase(locale, state.original);
    state.translated = next;
    states.set(name, state);
    if (current !== next) element.setAttribute(name, next);
  }
  attributeState.set(element, states);
}

function walk(root, locale) {
  if (!root || applying) return;
  applying = true;
  try {
    if (root.nodeType === Node.TEXT_NODE) {
      translateTextNode(root, locale);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    translateAttributes(root, locale);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node = walker.currentNode;
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) translateTextNode(node, locale);
      else translateAttributes(node, locale);
      node = walker.nextNode();
    }
  } finally {
    applying = false;
  }
}

export function LegacyLocalizationBridge({ locale }) {
  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return undefined;
    let scheduled = false;
    const schedule = (target = root) => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => { scheduled = false; walk(target?.isConnected ? target : root, locale); });
    };
    walk(root, locale);
    const originalConfirm = window.confirm.bind(window);
    const originalAlert = window.alert.bind(window);
    const originalPrompt = window.prompt.bind(window);
    window.confirm = (message) => originalConfirm(locale === 'de' ? message : translateLegacyPhrase(locale, message));
    window.alert = (message) => originalAlert(locale === 'de' ? message : translateLegacyPhrase(locale, message));
    window.prompt = (message, defaultValue) => originalPrompt(locale === 'de' ? message : translateLegacyPhrase(locale, message), defaultValue);
    const observer = new MutationObserver((mutations) => {
      if (applying) return;
      const target = mutations.find((mutation) => mutation.target?.isConnected)?.target || root;
      schedule(target.nodeType === Node.TEXT_NODE ? target.parentElement : target);
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: TRANSLATABLE_ATTRIBUTES });
    return () => {
      observer.disconnect();
      window.confirm = originalConfirm;
      window.alert = originalAlert;
      window.prompt = originalPrompt;
    };
  }, [locale]);
  return null;
}
