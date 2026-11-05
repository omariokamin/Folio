/*
 * prototype.js — clickable prototypes (SPEC "Prototyping (v0.11)").
 *
 *   Folio.prototype
 *     normalize(nodeId, list) -> { interactions, warnings }   THE validator for node.interactions
 *     bundleFor(pageId?)      -> { name, start, screens, interactions, hovers }  (never touches the document)
 *     fileFor(pageId?)        -> one self-contained HTML file with an inline player
 *     play(startId?) / stop() / isPlaying() / startOf(pageId?)
 */
window.Folio = window.Folio || {};

(function () {
  const store = Folio.store;

  // ---------- validation ----------
  const ACTIONS = ['navigate', 'back', 'url', 'overlay', 'close'];
  const TRANSITIONS = ['instant', 'dissolve', 'slide'];
  const DIRECTIONS = ['left', 'right', 'up', 'down'];
  const POSITIONS = ['center', 'top', 'bottom', 'left', 'right'];
  const BACKDROP = '#0f172a66';
  const URL_RE = /^(https?:\/\/[^\s<>"]+|mailto:[^\s<>"]+|tel:\+?[0-9][0-9 ().-]*)$/i;

  const safeUrl = (u) => typeof u === 'string' && URL_RE.test(u.trim());

  function transitionOf(t) {
    t = t && typeof t === 'object' ? t : {};
    const type = TRANSITIONS.includes(t.type) ? t.type : 'instant';
    const d = Number(t.duration);
    const out = { type, duration: Number.isFinite(d) ? Math.round(Math.max(0, Math.min(2000, d))) : 300 };
    if (type === 'slide') out.direction = DIRECTIONS.includes(t.direction) ? t.direction : 'left';
    return out;
  }

  /**
   * Validate and complete a node's interactions. Drops unknown actions, targets that are not
   * artboards on the node's page (or the node's own artboard for navigate) and unsafe URLs;
   * fills defaults. Returns { interactions, warnings } (warnings: plain-language strings).
   */
  function normalize(nodeId, list) {
    const warnings = [];
    const node = store.get(nodeId);
    if (!node) return { interactions: [], warnings: ['No layer with id "' + nodeId + '".'] };
    if (list != null && !Array.isArray(list)) {
      list = [list];
    }
    const page = store.pageOf(nodeId);
    const roots = page ? page.roots : [];
    const own = store.rootOf(nodeId);
    const out = [];
    (list || []).forEach((raw, i) => {
      const at = 'Interaction ' + (i + 1);
      if (!raw || typeof raw !== 'object') return warnings.push(at + ' is not an object; dropped.');
      if (raw.trigger != null && raw.trigger !== 'click') return warnings.push(`${at}: only "click" triggers are supported (got "${raw.trigger}"); dropped.`);
      if (!ACTIONS.includes(raw.action)) return warnings.push(`${at}: unknown action "${raw.action}"; dropped.`);
      const it = { trigger: 'click', action: raw.action };
      if (raw.action === 'navigate' || raw.action === 'overlay') {
        const t = raw.target;
        if (!t || !roots.includes(t)) return warnings.push(`${at}: target "${t}" is not an artboard on this page; dropped.`);
        if (raw.action === 'navigate' && t === own) return warnings.push(`${at}: can't navigate to the screen the layer is already on; dropped.`);
        it.target = t;
        it.transition = transitionOf(raw.transition);
        if (raw.action === 'overlay') {
          const o = raw.overlay && typeof raw.overlay === 'object' ? raw.overlay : {};
          it.overlay = {
            position: POSITIONS.includes(o.position) ? o.position : 'center',
            closeOnOutside: o.closeOnOutside !== false,
            backdrop: typeof o.backdrop === 'string' && o.backdrop.trim() && !/[;{}<>]/.test(o.backdrop) ? o.backdrop.trim() : BACKDROP,
          };
        }
      } else if (raw.action === 'url') {
        if (!safeUrl(raw.url)) return warnings.push(`${at}: "${raw.url}" is not an http(s), mailto or tel link; dropped.`);
        it.url = raw.url.trim();
      }
      out.push(it);
    });
    return { interactions: out, warnings };
  }

  Folio.prototype = { normalize, safeUrl };
})();
