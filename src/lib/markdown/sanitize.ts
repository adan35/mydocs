import DOMPurify from 'dompurify';

let configured = false;

/** CSS properties that could be used to overlay or spoof the app's UI. */
const UNSAFE_STYLE =
  /(position|url\s*\(|expression|behavio(u)?r|-moz-binding|@import|z-index|\\|\/\*)/i;
/**
 * Plain `position: relative` is allowed (KaTeX uses it for operator limits); it can't
 * escape the preview's scroll clip. It's removed before the check above.
 */
const RELATIVE = /(^|;)\s*position\s*:\s*relative\s*(?=;|$)/gi;

function configure() {
  if (configured) return;
  configured = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node instanceof HTMLAnchorElement && node.hasAttribute('href')) {
      const href = node.getAttribute('href') ?? '';
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer nofollow');
      } else {
        node.removeAttribute('target');
      }
    }
    if (node instanceof HTMLInputElement && node.type !== 'checkbox') {
      node.remove();
      return;
    }
    if (node instanceof Element && node.hasAttribute('style')) {
      const style = node.getAttribute('style') ?? '';
      if (UNSAFE_STYLE.test(style.replace(RELATIVE, '$1'))) node.removeAttribute('style');
    }
  });
}

/** Sanitizes rendered Markdown HTML. Every byte of document content is untrusted. */
export function sanitizeHtml(html: string): string {
  configure();
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, mathMl: true },
    ADD_ATTR: [
      'data-line',
      'data-line-end',
      'data-inline',
      'data-heading',
      'data-wiki',
      'data-fragment',
      'aria-hidden',
      'target',
      // KaTeX keeps the TeX source in a MathML annotation; rich editing reads it back.
      'encoding',
    ],
    ADD_TAGS: ['semantics', 'annotation'],
    FORBID_TAGS: [
      'style',
      'form',
      'iframe',
      'frame',
      'object',
      'embed',
      'base',
      'meta',
      'link',
      'script',
      'textarea',
      'select',
      'dialog',
    ],
    FORBID_ATTR: ['formaction', 'srcset', 'ping', 'autofocus'],
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  });
}
