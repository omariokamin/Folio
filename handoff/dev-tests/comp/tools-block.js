  // ---------- components (Folio.components, src/components.js) ----------
  const comps = () => (Folio.components && typeof Folio.components.list === 'function' ? Folio.components : null);
  const NO_COMPONENTS = 'Components are not available in this build of Folio (src/components.js is not loaded). Build repeated parts with create_nodes instead.';
  const errText = (e) => String((e && e.message) || e);
  const varText = (v) => (isObj(v) && Object.keys(v).length ? Object.keys(v).map((k) => `${k}=${v[k]}`).join(', ') : '');
  const compLabel = (c) => `${c.id} ${q(c.name)}${varText(c.variant) ? ' ' + varText(c.variant) : ''}`;

  /** Instance scope of a layer: null when it is not part of an instance; root = it is a direct instance root. */
  function instanceScope(id) {
    const C = comps();
    const ir = C && C.instanceRootOf(id);
    if (!ir) return null;
    return { root: C.isDirectInstance(id), instanceId: ir };
  }

  /** Short tag for get_document lists. */
  function compTag(n) {
    const C = comps();
    if (!C) return '';
    const c = n.component && C.componentOf(n.id);
    if (c) return ` [main component ${q(c.name)}${varText(c.variant) ? ' ' + varText(c.variant) : ''}]`;
    const ic = n.instance && C.get(n.instance.componentId);
    if (ic) return ` [instance of ${q(ic.name)}${varText(ic.variant) ? ' ' + varText(ic.variant) : ''}]`;
    return '';
  }

  /** { 'name/path': node } for a subtree, '' = root; first name wins (same rule as components.js). */
  function layerPaths(rootId) {
    const store = S();
    const out = {};
    const walk = (id, p) => {
      const n = store.get(id);
      if (!n) return;
      if (!own(out, p)) out[p] = n;
      n.children.forEach((c) => walk(c, p ? p + '/' + (store.get(c) || {}).name : (store.get(c) || {}).name));
    };
    walk(rootId, '');
    return out;
  }

  /** A sanitized patch → [field, value] pairs in components.js field names (text.content, style.border.color, …). */
  function patchFields(patch) {
    const out = [];
    Object.keys(patch).forEach((k) => {
      const v = patch[k];
      if (['style', 'text', 'image'].includes(k) && isObj(v))
        Object.keys(v).forEach((k2) => {
          if (k === 'style' && k2 === 'border' && isObj(v[k2])) Object.keys(v[k2]).forEach((k3) => out.push([`style.border.${k3}`, v[k2][k3]]));
          else out.push([`${k}.${k2}`, v[k2]]);
        });
      else out.push([k, v]);
    });
    return out;
  }
  function fieldsToPatch(fields) {
    const p = {};
    fields.forEach(([f, v]) => {
      const parts = f.split('.');
      let o = p;
      parts.slice(0, -1).forEach((k) => (o = o[k] = isObj(o[k]) ? o[k] : {}));
      o[parts[parts.length - 1]] = v;
    });
    return p;
  }
  const valueAt = (n, f) => f.split('.').reduce((o, k) => (o == null ? undefined : o[k]), n);
  const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  /** Keep only what an instance layer may change. Returns { patch, dropped: [fields that would really change] }. */
  function overridablePart(node, patch, isRoot) {
    const C = comps();
    const kept = [];
    const dropped = [];
    patchFields(patch).forEach(([f, v]) => {
      if (C.isOverridable(f, isRoot)) kept.push([f, v]);
      else if (!sameJson(valueAt(node, f), v)) dropped.push(f);
    });
    return { patch: fieldsToPatch(kept), dropped };
  }

  /** Overrides from the model ({ path: partial node }) → sanitized overrides for components.js, with warnings. */
  function cleanOverrides(raw, rootId, ctx) {
    if (raw == null) return undefined;
    if (!isObj(raw)) {
      ctx.warn('overrides must be an object keyed by layer path, e.g. {"Label": {"text": {"content": "Book a table"}}} — ignored');
      return undefined;
    }
    const paths = layerPaths(rootId);
    const out = {};
    Object.keys(raw).forEach((key) => {
      const path = key === '/' || key === '.' ? '' : String(key).replace(/^\/+|\/+$/g, '');
      const n = paths[path];
      if (!n) {
        const list = Object.keys(paths).filter(Boolean);
        return ctx.warn(`no layer ${q(key)} in this component — ignored. Layer paths: ${list.slice(0, 30).join(', ') || '(none)'}`);
      }
      if (!isObj(raw[key])) return ctx.warn(`override for ${q(key)} must be a partial layer like {"text": {"content": "…"}} — ignored`);
      const prevAt = ctx.at;
      ctx.at = (prevAt ? prevAt + ' ' : '') + (path || '(root)');
      const patch = sanitizeProps(raw[key], n.type, ctx, n);
      const part = overridablePart(n, patch, path === '');
      if (part.dropped.length) ctx.warn(`${part.dropped.join(', ')} can't be overridden (only text content/colour, fills, border colour, image src/fit and visible${path === '' ? ', plus the root\'s name, position, size and sizing' : ''}) — edit the main component or add a variant instead`);
      ctx.at = prevAt;
      if (Object.keys(part.patch).length) out[path] = part.patch;
    });
    return Object.keys(out).length ? out : undefined;
  }

  function instanceCounts() {
    const m = {};
    Object.values(S().doc.nodes).forEach((n) => n.instance && (m[n.instance.componentId] = (m[n.instance.componentId] || 0) + 1));
    return m;
  }

  /** Compact outline of a main: one string per layer, by name path (the paths overrides use). */
  function mainOutline(mainId) {
    const C = comps();
    const paths = layerPaths(mainId);
    const lines = [];
    Object.keys(paths).forEach((p) => {
      if (!p) return;
      const n = paths[p];
      if (lines.length >= 30) return;
      let s = `${p}: ${n.type}`;
      if (n.type === 'text') s += ` ${q(String((n.text && n.text.content) || '').replace(/\s+/g, ' ').slice(0, 40))}`;
      if (n.visible === false) s += ' (hidden)';
      const ic = n.instance && C.get(n.instance.componentId);
      if (ic) s += ` (instance of ${q(ic.name)}${varText(ic.variant) ? ' ' + varText(ic.variant) : ''})`;
      lines.push(s);
    });
    const total = Object.keys(paths).length - 1;
    if (total > lines.length) lines.push(`…${total - lines.length} more (get_tree ${mainId})`);
    return lines;
  }

  function componentsOutline(onlyIds) {
    const C = comps();
    const counts = instanceCounts();
    const pick = (c) => !onlyIds || onlyIds.includes(c.id);
    const sizeOfMain = (id) => renderedSize(id) || [Math.round((S().get(id) || {}).width || 0), Math.round((S().get(id) || {}).height || 0)];
    const sets = C.sets()
      .map((set) => {
        const members = C.list().filter((c) => c.setId === set.id);
        if (!members.some(pick) || !members.length) return null;
        const ordered = C.variantsOf(members[0].id);
        const first = mainOutline(ordered[0].mainId);
        return {
          id: set.id,
          name: set.name,
          frame: set.frameId,
          props: set.props,
          layers: first,
          variants: ordered.map((c) => {
            const v = { component: c.id, main: c.mainId, variant: c.variant, size: sizeOfMain(c.mainId) };
            const lines = mainOutline(c.mainId);
            if (!sameJson(lines, first)) v.layers = lines;
            if (counts[c.id]) v.instances = counts[c.id];
            return v;
          }),
        };
      })
      .filter(Boolean);
    const singles = C.list()
      .filter((c) => !(c.setId && C.getSet(c.setId)) && pick(c))
      .map((c) => {
        const o = { id: c.id, name: c.name, main: c.mainId, size: sizeOfMain(c.mainId), layers: mainOutline(c.mainId) };
        if (c.description) o.description = clip(c.description, 200);
        if (counts[c.id]) o.instances = counts[c.id];
        return o;
      });
    return { sets, components: singles };
  }

  function listComponents() {
    const C = comps();
    if (!C) return fail(NO_COMPONENTS, 'Components unavailable');
    C.flush();
    const out = componentsOutline();
    const n = C.list().length;
    if (!n) out.note = 'No components yet. Call add_starter_kit for ready-made Button, Badge, Card, Input, Nav bar and Avatar sets, or turn layers into one with create_component.';
    else out.note = 'Place them with create_instances (component = id or name, variant = {"Prop": "Value"}). Overrides are keyed by the layer paths above. Edit a main (update_nodes on its ids) to change every instance.';
    return result(out, `Read ${n} component${n === 1 ? '' : 's'}`, []);
  }

  /** component reference (id, main id, set id/frame or name) + optional variant → a component, or { error }. */
  function resolveComponent(ref, variant) {
    const C = comps();
    const store = S();
    const s = typeof ref === 'string' ? ref.trim().replace(/^["'“]|["'”]$/g, '') : '';
    if (!s) return { error: 'component is missing: give a component id (k_…), a main id or a component name' };
    let comp = C.get(s) || (store.get(s) && C.componentOf(s)) || null;
    let set = !comp ? C.getSet(s) || C.sets().find((x) => x.frameId === s) || null : null;
    if (!comp && !set) {
      const key = s.toLowerCase();
      set = C.sets().find((x) => String(x.name).toLowerCase() === key) || null;
      if (!set) comp = C.list().find((c) => String(c.name).toLowerCase() === key && !c.setId) || C.list().find((c) => String((store.get(c.mainId) || {}).name).toLowerCase() === key) || null;
    }
    if (!comp && !set) {
      const names = [...C.sets().map((x) => x.name), ...C.list().filter((c) => !c.setId).map((c) => c.name)];
      return { error: `No component ${q(s)}. ${names.length ? 'Components: ' + names.slice(0, 30).map((x) => q(x)).join(', ') + '.' : 'There are no components yet (add_starter_kit or create_component).'}` };
    }
    if (comp && comp.setId) set = C.getSet(comp.setId);
    if (!set) {
      if (isObj(variant) && Object.keys(variant).length) return { comp, note: `${q(comp.name)} has no variants — variant ignored` };
      return { comp };
    }
    const members = C.variantsOf((comp || C.list().find((c) => c.setId === set.id) || {}).id);
    if (!members.length) return { error: `The set ${q(set.name)} has no variants.` };
    if (variant != null && !isObj(variant)) return { error: `variant must be an object like {"${Object.keys(set.props)[0] || 'Style'}": "${(Object.values(set.props)[0] || ['…'])[0]}"}` };
    const want = {};
    const bad = [];
    Object.keys(variant || {}).forEach((k) => {
      const pk = Object.keys(set.props).find((p) => p.toLowerCase() === String(k).toLowerCase());
      const vals = pk ? set.props[pk] : null;
      const val = vals && vals.find((x) => x.toLowerCase() === String(variant[k]).toLowerCase());
      if (!pk) bad.push(`unknown property ${q(k)}`);
      else if (!val) bad.push(`${pk} has no value ${q(variant[k])} (values: ${vals.join(', ')})`);
      else want[pk] = val;
    });
    if (bad.length) return { error: `${q(set.name)}: ${bad.join('; ')}. Properties: ${Object.keys(set.props).map((k) => `${k} = ${set.props[k].join(' | ')}`).join('; ')}.` };
    const base = Object.assign({}, (comp || members[0]).variant, want);
    const hit = members.find((c) => Object.keys(base).every((k) => c.variant[k] === base[k])) || members.find((c) => Object.keys(want).every((k) => c.variant[k] === want[k]));
    if (!hit) return { error: `${q(set.name)} has no variant ${varText(want)}.` };
    return { comp: hit };
  }

  function rootFieldsOf(item, ctx) {
    const raw = {};
    ['name', 'width', 'height', 'sizing'].forEach((k) => item[k] !== undefined && (raw[k] = item[k]));
    if (!Object.keys(raw).length) return null;
    const p = sanitizeProps(raw, 'frame', ctx, null);
    ['w', 'h'].forEach((ax) => {
      const dim = ax === 'w' ? 'width' : 'height';
      if (p[dim] != null && !(p.sizing && p.sizing[ax])) p.sizing = Object.assign({}, p.sizing, { [ax]: 'fixed' });
    });
    return Object.keys(p).length ? p : null;
  }

  function createInstances(input) {
    const C = comps();
    if (!C) return fail(NO_COMPONENTS, 'Components unavailable');
    const store = S();
    const ctx = makeCtx('update');
    const notes = [];
    let items = input.items;
    if (items == null && input.component) items = [input];
    if (isObj(items)) items = [items];
    if (!Array.isArray(items) || !items.length) return fail('create_instances needs "items": [{"component": "Button", "variant": {"Style": "Primary"}, "parent_id": "n_…", "overrides": {"Label": {"text": {"content": "Book a table"}}}}].', 'Nothing to place');
    const errors = [];
    const created = [];
    const allIds = [];
    const roots = [];
    items.slice(0, 200).forEach((item, i) => {
      if (!isObj(item)) return errors.push(`items[${i}] is not an object`);
      const rc = resolveComponent(item.component != null ? item.component : item.component_id, item.variant);
      if (rc.error) return errors.push(`items[${i}]: ${rc.error}`);
      if (rc.note) notes.push(`items[${i}]: ${rc.note}`);
      const comp = rc.comp;
      let pid = item.parent_id !== undefined ? item.parent_id : item.parentId !== undefined ? item.parentId : input.parent_id;
      if (pid === undefined || pid === '' || pid === 'null' || pid === 'canvas') pid = null;
      if (pid !== null) {
        const pr = resolve(pid, notes);
        if (pr.error) return errors.push(`items[${i}]: ${pr.error}`);
        pid = pr.node.id;
      }
      ctx.at = `items[${i}] ${q(comp.name)}`;
      const overrides = cleanOverrides(item.overrides, comp.mainId, ctx) || {};
      const rootPatch = rootFieldsOf(item, ctx);
      if (rootPatch) overrides[''] = Object.assign({}, overrides[''], rootPatch);
      const opts = { parentId: pid, overrides };
      if (item.index != null && isFinite(Number(item.index))) opts.index = Math.max(0, Math.round(Number(item.index)));
      ['x', 'y'].forEach((k) => item[k] != null && (opts[k] = num(item[k], ctx, k, -1000000, 1000000)));
      try {
        const id = C.createInstance(comp.id, opts);
        const n = store.get(id);
        const p = store.getParent(id);
        created.push(`${id} ${q(n.name)} (${compLabel(comp)})${p ? ' in ' + q(p.name) + ' at index ' + p.children.indexOf(id) : ' on the canvas'}`);
        allIds.push(id, ...store.descendants(id));
        if (!p) roots.push(id);
      } catch (e) {
        errors.push(`items[${i}] ${q(comp.name)}: ${errText(e)}`);
      }
    });
    ctx.at = '';
    if (allIds.length) afterMutation(allIds, allIds.filter((id) => created.some((c) => c.startsWith(id + ' '))), roots.length ? roots : null);
    const out = { created };
    if (errors.length) out.errors = errors;
    const warnings = notes.concat(ctx.warnings());
    const hint = literalHint(ctx);
    if (hint) warnings.push(hint);
    if (warnings.length) out.warnings = warnings;
    const issues = layoutIssues(allIds);
    if (issues.length) out.layout = issues;
    return result(out, created.length ? `Placed ${created.length} instance${created.length === 1 ? '' : 's'}` : 'No instances placed', allIds, !created.length);
  }

  function updateInstances(input) {
    const C = comps();
    if (!C) return fail(NO_COMPONENTS, 'Components unavailable');
    const store = S();
    const ctx = makeCtx('update');
    const notes = [];
    let items = input.items;
    if (items == null && input.id) items = [input];
    if (isObj(items)) items = [items];
    if (!Array.isArray(items) || !items.length) return fail('update_instances needs "items": [{"id": "n_…", "variant"?: {…}, "overrides"?: {…}, "reset"?: true | ["Label"], "detach"?: true}].', 'Nothing to update');
    const errors = [];
    const updated = [];
    const changed = [];
    items.slice(0, 500).forEach((item, i) => {
      if (!isObj(item)) return errors.push(`items[${i}] is not {id, …}`);
      const r = resolve(item.id, notes);
      if (r.error) return errors.push(r.error);
      const n = r.node;
      if (!n.instance) {
        const ir = C.instanceRootOf(n.id);
        return errors.push(ir ? `${n.id} ${q(n.name)} is a layer inside the instance ${ir} ${q(store.get(ir).name)}: use that id and address the layer by its path (${q(C.pathOf(n.id, ir))}) in overrides` : `${n.id} ${q(n.name)} is not an instance${n.component ? ' (it is a main component: edit it with update_nodes)' : ''}`);
      }
      ctx.at = `${n.id} ${q(n.name)}`;
      const did = [];
      try {
        if (item.reset === true || item.reset === 'all') {
          C.resetOverrides(n.id);
          did.push('reset all overrides');
        } else if (item.reset != null) {
          const paths = [].concat(item.reset).map((p) => String(p));
          paths.forEach((p) => C.resetOverrides(n.id, p));
          did.push(`reset ${paths.map((p) => q(p)).join(', ')}`);
        }
        if (item.variant != null) {
          if (!isObj(item.variant)) throw new Error('variant must be an object like {"Style": "Secondary"}');
          C.setVariant(n.id, item.variant);
          const now = C.get(store.get(n.id).instance.componentId);
          did.push(`variant ${varText(now && now.variant) || varText(item.variant)}`);
        }
        if (item.overrides != null) {
          const ov = cleanOverrides(item.overrides, n.id, ctx);
          if (ov) {
            C.setOverrides(n.id, ov);
            did.push(`overrides on ${Object.keys(ov).map((p) => q(p || '(root)')).join(', ')}`);
          }
        }
        if (yes(item.detach)) {
          C.detach(n.id);
          did.push('detached (now plain layers)');
        }
      } catch (e) {
        errors.push(`${n.id} ${q(n.name)}: ${errText(e)}`);
      }
      if (did.length) {
        updated.push(`${n.id} ${q((store.get(n.id) || n).name)}: ${did.join('; ')}`);
        changed.push(n.id, ...store.descendants(n.id));
      }
    });
    ctx.at = '';
    if (changed.length) afterMutation(changed, [...new Set(changed.filter((id) => updated.some((u) => u.startsWith(id + ' '))))]);
    const out = { updated };
    const ovs = {};
    updated.forEach((u) => {
      const id = u.split(' ')[0];
      const o = store.get(id) && store.get(id).instance ? C.overridesOf(id) : null;
      if (o && Object.keys(o).length) ovs[id] = o;
    });
    if (Object.keys(ovs).length) out.overrides = ovs;
    if (errors.length) out.errors = errors;
    const warnings = notes.concat(ctx.warnings());
    if (warnings.length) out.warnings = warnings;
    const issues = layoutIssues(changed);
    if (issues.length) out.layout = issues;
    return result(out, updated.length ? `Updated ${updated.length} instance${updated.length === 1 ? '' : 's'}` : 'No instances updated', changed, !updated.length);
  }

  function combosOf(props) {
    return Object.keys(props).reduce((acc, k) => acc.flatMap((v) => props[k].map((val) => Object.assign({}, v, { [k]: val }))), [{}]);
  }

  function createComponent(input) {
    const C = comps();
    if (!C) return fail(NO_COMPONENTS, 'Components unavailable');
    const store = S();
    const notes = [];
    let ids = input.node_ids != null ? input.node_ids : input.ids != null ? input.ids : input.node_id;
    if (typeof ids === 'string') ids = [ids];
    if (!Array.isArray(ids) || !ids.length) return fail('create_component needs "node_ids": ["n_…"] and a "name".', 'Nothing to turn into a component');
    const nodes = [];
    for (const id of ids.slice(0, 100)) {
      const r = resolve(id, notes);
      if (r.error) return fail(r.error + ' Nothing was changed.', 'Layer not found');
      if (!nodes.includes(r.node.id)) nodes.push(r.node.id);
    }
    const name = input.name != null ? clipText(input.name, 120) : '';
    let props = null;
    if (input.variants != null) {
      if (!isObj(input.variants) || !Object.keys(input.variants).length) return fail('variants must be an object of property → values, e.g. {"Style": ["Primary", "Secondary", "Ghost"]}. Nothing was changed.', 'Bad variants');
      props = {};
      for (const k of Object.keys(input.variants).slice(0, 4)) {
        const vals = [...new Set([].concat(input.variants[k]).map((v) => String(v == null ? '' : v).trim()).filter(Boolean))];
        if (!vals.length) return fail(`variants.${k} needs at least one value. Nothing was changed.`, 'Bad variants');
        props[String(k).trim()] = vals;
      }
    }
    const combos = props ? combosOf(props) : [];
    if (combos.length > 36) return fail(`${combos.length} variant combinations is too many (36 at most). Use fewer properties or values. Nothing was changed.`, 'Too many variants');
    let setName = name || (store.get(nodes[0]) || {}).name || 'Component';
    try {
      // one main per layer (when there is one layer per combination), else one main from all layers
      let mains;
      if (combos.length > 1 && nodes.length === combos.length) {
        mains = nodes.map((id, i) => C.create([id], { name: `${setName} / __${i}` }));
      } else {
        const base = C.create(nodes, { name: name || undefined });
        mains = [base];
        setName = name || base.name;
        if (combos.length > 1) {
          C.update(base.id, { name: `${setName} / __0` });
          for (let i = 1; i < combos.length; i++) {
            const id = store.duplicate([base.mainId], 0)[0];
            mains.push(C.create([id], { name: `${setName} / __${i}` }));
          }
        }
      }
      let set = null;
      if (combos.length > 1) {
        const P = Object.keys(props);
        set = C.combineAsVariants(mains.map((m) => m.id), { name: setName, prop: P[0] });
        // every main now has a unique temporary value of P[0]; add the other properties, then assign real variants
        const tmp = { [P[0]]: mains.map((m) => C.get(m.id).variant[P[0]]) };
        P.slice(1).forEach((k) => (tmp[k] = props[k]));
        if (P.length > 1) C.setSetProps(set.id, tmp);
        mains.forEach((m, i) => C.setVariantOf(m.id, combos[i]));
        C.setSetProps(set.id, props);
      } else if (combos.length === 1) notes.push('only one variant combination, so a plain component was made (add values to build a set)');
      if (input.description != null && mains.length === 1) C.update(mains[0].id, { description: String(input.description) });
      const ids2 = mains.map((m) => m.id);
      const changed = [];
      ids2.forEach((cid) => {
        const c = C.get(cid);
        if (c) changed.push(c.mainId, ...store.descendants(c.mainId));
      });
      if (set) changed.unshift(set.frameId);
      afterMutation(changed, set ? [set.frameId] : [C.get(ids2[0]).mainId]);
      const out = componentsOutline(ids2);
      out.note = set
        ? 'Each variant main is a duplicate of the first: restyle the variants with update_nodes on their main ids, then place them with create_instances.'
        : 'Place it with create_instances; edit the main to change every instance.';
      if (nodes.length > 1 && !(combos.length > 1 && nodes.length === combos.length)) notes.push('the layers were wrapped in one frame that became the main');
      if (notes.length) out.notes = notes;
      return result(out, set ? `Made component set ${q(set.name)} (${mains.length} variants)` : `Made component ${q(C.get(ids2[0]).name)}`, changed);
    } catch (e) {
      return fail(`Could not create the component: ${errText(e)}`, 'Component not created');
    }
  }

  function addStarterKit() {
    const C = comps();
    if (!C || typeof C.addStarterKit !== 'function') return fail(NO_COMPONENTS, 'Components unavailable');
    const store = S();
    let ids;
    try {
      ids = C.addStarterKit() || [];
    } catch (e) {
      return fail(`Could not add the starter kit: ${errText(e)}`, 'Starter kit failed');
    }
    const board = store.doc.roots.map((id) => store.get(id)).find((n) => n && n.name === 'Components' && !n.instance && !n.component);
    const changed = board ? [board.id, ...store.descendants(board.id)] : [];
    if (changed.length) afterMutation(changed, [board.id], ids.length ? [board.id] : null);
    const out = componentsOutline();
    out.artboard = board ? `${board.id} ${q(board.name)}` : null;
    out.added = ids.length ? `${ids.length} component mains` : 'nothing new: the kit was already there';
    out.note = 'The kit follows the active brand kit. Restyle a main with update_nodes to change all its instances; place them with create_instances.';
    return result(out, ids.length ? `Added the starter kit (${ids.length} components)` : 'Starter kit already present', changed);
  }

