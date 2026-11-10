// Finds the page text to analyze and describes where each text node sits
// (heading, link, caption, comment, protected text). Owns the per-pass cache
// of element contexts.
import { classifyPageContext } from '../core/contextual.js';

const SKIP_TAGS_SELECTOR = 'script,style,noscript,textarea,input,code,pre,kbd,samp';
const MEDIA_UI_SELECTOR = '.ytp-caption-window-container,.ytp-caption-segment,.caption-window,.vjs-text-track-display,.jw-captions,.jw-text-track-display,.plyr__captions,.ytp-chrome-controls,.vjs-control-bar,.jw-controlbar,.plyr__controls,[data-testid=video-subtitles]';
// Captions, photo credits, and section labels set in capitals by design.
const CAPS_LABEL_SELECTOR = 'figcaption,[class*=caption],[class*=credit],[class*=kicker],[class*=eyebrow],[class*=badge],[class*=label]';
const PROTECTED_TEXT_SELECTOR = 'ytd-transcript-segment-renderer,ytd-transcript-segment-list-renderer,.ytd-transcript-segment-renderer,yt-live-chat-app,yt-live-chat-renderer,[aria-live=polite],[aria-live=assertive],[role=status],[role=alert]';
const SKIP_SELECTOR = `nav,button,select,option,[role=navigation],[role=menu],[aria-hidden=true],#cf-tooltip,#cf-suggestion,${MEDIA_UI_SELECTOR}`;
const SKIP_ELEMENT_SELECTOR = `${SKIP_TAGS_SELECTOR},${SKIP_SELECTOR}`;
const HEADING_SELECTOR = 'h1,h2,h3,[role=heading],[slot=title],a#video-title,[class*=headline],[class*=title]';
const LINK_EXCLUDED_SELECTOR = 'nav,footer,[role=navigation],[class*=share],[class*=comment]';
const EMPHASIS_SELECTOR = 'strong,b,[class*=pufftext],[data-headline]';
const CONVERSATIONAL_SELECTOR = 'shreddit-comment,[data-testid*=comment],ytd-comment-thread-renderer,ytd-comments,#comments';
export const PAGE_CONTEXT = classifyPageContext(location.hostname);

const ROOT_CONTEXT = { skip: false, heading: false, navLike: false, link: null, linkExcluded: false, emphasis: false, conversational: false, preserveText: false, capsLabel: false };
/** @type {Map<Element, any>} getElementContext cache, emptied after each pass. */
const elementContexts = new Map();

// Each flag is true when the element or an ancestor matches, as closest()
// would report, but every element is matched once per pass instead of once
// per text node and selector.
/** @param {Element | null} element @returns {typeof ROOT_CONTEXT} */
export function getElementContext(element) {
  if (!element) return ROOT_CONTEXT;
  let context = elementContexts.get(element);
  if (context) return context;
  const parent = getElementContext(element.parentElement);
  if (parent.skip) context = parent;
  else {
    const isLink = element.matches('a[href]');
    const navLike = parent.navLike || element.matches(LINK_EXCLUDED_SELECTOR);
    context = {
      skip: element.matches(SKIP_ELEMENT_SELECTOR),
      heading: parent.heading || element.matches(HEADING_SELECTOR),
      navLike,
      link: isLink ? element : parent.link,
      linkExcluded: isLink ? navLike : parent.linkExcluded,
      emphasis: parent.emphasis || element.matches(EMPHASIS_SELECTOR),
      conversational: parent.conversational || element.matches(CONVERSATIONAL_SELECTOR),
      preserveText: parent.preserveText || element.matches(PROTECTED_TEXT_SELECTOR),
      capsLabel: parent.capsLabel || element.matches(CAPS_LABEL_SELECTOR),
    };
  }
  elementContexts.set(element, context);
  return context;
}

// The cache is only valid while the page cannot change, so callers clear it
// before and after each pass.
export function clearElementContexts() {
  elementContexts.clear();
}

export function isProcessableNode(node) {
  const parent = node.parentElement;
  return !!parent && !parent.isContentEditable && !getElementContext(parent).skip;
}

export function isLikelyHeadline(context, text) {
  if (context.heading) return true;
  if (PAGE_CONTEXT !== 'publication' || text.trim().length < 20) return false;
  if (!context.link || context.linkExcluded) return false;
  return context.emphasis || context.link.getAttribute('itemprop') === 'url';
}

export function getTextTargets(root) {
  if (!root || getElementContext(root).skip) return [];
  const targets = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = /** @type {Text} */ (walker.currentNode);
    if ((node.nodeValue || '').trim().length >= 2 && isProcessableNode(node)) targets.push(node);
  }
  return targets;
}
