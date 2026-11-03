/*
 * fonts.js — loads Google Fonts on demand.
 *   Folio.fonts.list            -> [{ family, category, weights }]
 *   Folio.fonts.ensure(family)  -> adds the Google Fonts <link> once
 *   Folio.fonts.stack(family)   -> CSS font-family value with a sensible fallback
 *   Folio.fonts.googleHref(families) -> a single Google Fonts URL (used by the HTML exporter)
 */
window.Folio = window.Folio || {};

(function () {
  // weights: either a "min..max" variable range or a list of fixed weights.
  const list = [
    { family: 'Inter', category: 'sans-serif', weights: '100..900' },
    { family: 'DM Sans', category: 'sans-serif', weights: '100..1000' },
    { family: 'Manrope', category: 'sans-serif', weights: '200..800' },
    { family: 'Space Grotesk', category: 'sans-serif', weights: '300..700' },
    { family: 'Montserrat', category: 'sans-serif', weights: '100..900' },
    { family: 'Poppins', category: 'sans-serif', weights: [100, 200, 300, 400, 500, 600, 700, 800, 900] },
    { family: 'Roboto', category: 'sans-serif', weights: [100, 300, 400, 500, 700, 900] },
    { family: 'Archivo', category: 'sans-serif', weights: '100..900' },
    { family: 'Bricolage Grotesque', category: 'sans-serif', weights: '200..800' },
    { family: 'Bebas Neue', category: 'display', weights: [400] },
    { family: 'Anton', category: 'display', weights: [400] },
    { family: 'Playfair Display', category: 'serif', weights: '400..900' },
    { family: 'Instrument Serif', category: 'serif', weights: [400] },
    { family: 'Lora', category: 'serif', weights: '400..700' },
    { family: 'Fraunces', category: 'serif', weights: '100..900' },
    { family: 'JetBrains Mono', category: 'monospace', weights: '100..800' },
    { family: 'Caveat', category: 'handwriting', weights: '400..700' },
  ];

  const loaded = new Set();
  const find = (family) => list.find((f) => f.family === family);

  function familyParam(family) {
    const f = find(family);
    const name = family.trim().replace(/\s+/g, '+');
    if (!f) return `family=${name}`; // custom font typed by the user: regular weight only
    if (typeof f.weights === 'string') return `family=${name}:wght@${f.weights}`;
    return `family=${name}:wght@${f.weights.join(';')}`;
  }

  function googleHref(families) {
    const uniq = [...new Set(families.filter(Boolean))];
    if (!uniq.length) return null;
    return `https://fonts.googleapis.com/css2?${uniq.map(familyParam).join('&')}&display=swap`;
  }

  /** Brand font tokens look like var(--font-heading); resolve them to a real family name. */
  function resolve(family) {
    if (family && family.startsWith('var(') && Folio.brand && Folio.brand.resolveFont) return Folio.brand.resolveFont(family);
    return family;
  }

  function ensure(family) {
    family = resolve(family);
    if (!family || family.startsWith('var(') || loaded.has(family)) return;
    loaded.add(family);
    const sys = ['system-ui', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Courier New'];
    if (sys.includes(family)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = googleHref([family]);
    link.dataset.font = family;
    document.head.appendChild(link);
  }

  function stack(family) {
    if (family && family.startsWith('var(')) return family; // brand token: the CSS variable holds the full stack
    const f = find(family);
    const cat = f ? f.category : 'sans-serif';
    const fallback =
      cat === 'serif' ? 'Georgia, serif' : cat === 'monospace' ? 'ui-monospace, monospace' : 'system-ui, sans-serif';
    return `"${family}", ${fallback}`;
  }

  /** Weights available for a family (for the weight dropdown). */
  function weightsOf(family) {
    family = resolve(family);
    const f = find(family);
    if (!f) return [400, 700];
    if (Array.isArray(f.weights)) return f.weights;
    const [min, max] = f.weights.split('..').map(Number);
    const out = [];
    for (let w = 100; w <= 900; w += 100) if (w >= min && w <= max) out.push(w);
    return out;
  }

  Folio.fonts = { list, ensure, stack, googleHref, weightsOf, resolve };
})();
