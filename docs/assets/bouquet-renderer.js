(function (global) {
  'use strict';

  const GOLDEN_ANGLE = 2.399963229728653;

  function hash(value) {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
    return result >>> 0;
  }

  function random01(value) {
    return (hash(value) % 10000) / 10000;
  }

  function gradient(color, id) {
    return '<radialGradient id="' + id + '" cx="36%" cy="28%" r="76%"><stop offset="0" stop-color="#fffaf3" stop-opacity=".9"/><stop offset=".4" stop-color="' + color + '"/><stop offset="1" stop-color="' + color + '" stop-opacity=".72"/></radialGradient>';
  }

  function petalRing(count, rx, ry, radius, offset, colorId, opacity, rotation) {
    const petals = [];
    for (let index = 0; index < count; index += 1) {
      const angle = rotation + index * 360 / count;
      petals.push('<ellipse cx="0" cy="-' + radius + '" rx="' + rx + '" ry="' + ry + '" transform="rotate(' + angle + ')" fill="url(#' + colorId + ')" opacity="' + opacity + '"/>');
    }
    return '<g transform="translate(0 ' + offset + ')">' + petals.join('') + '</g>';
  }

  function curledPetals(count, colorId, opacity, scale, rotation) {
    const petals = [];
    const path = 'M0 7 C-10 4 -15 -4 -11 -13 C-8 -21 -1 -20 2 -10 C6 -20 15 -18 17 -9 C19 0 10 8 0 7Z';
    for (let index = 0; index < count; index += 1) {
      const angle = rotation + index * 360 / count;
      petals.push('<path d="' + path + '" transform="rotate(' + angle + ')" fill="url(#' + colorId + ')" fill-opacity="' + opacity + '" stroke="#fff8f1" stroke-opacity=".34" stroke-width="1.2" stroke-linejoin="round"/>');
    }
    return '<g transform="scale(' + scale + ')">' + petals.join('') + '</g>';
  }

  function flowerHead(item, def, x, y, size, angle, index, selected, meta) {
    const color = item.colorHex || def.swatch || '#cf8e91';
    const prefix = 'petal-' + index;
    const id = def.id;
    const variation = random01(id + item.color + index);
    const scale = size * (.91 + variation * .17) * (meta && meta.scale || 1);
    const finalAngle = angle + (meta && meta.rotation || 0);
    let artwork = '';

    if (id === 'tulip') {
      artwork = '<path d="M0 17 C-26 4 -27 -22 -13 -37 C-6 -39 -2 -29 1 -21 C5 -36 13 -41 20 -33 C34 -11 18 8 0 17Z" fill="url(#' + prefix + ')" stroke="rgba(103,70,62,.18)" stroke-width="1.1"/><path d="M-4 12 C-12 -2 -11 -20 -5 -31 M4 11 C14 -1 12 -17 8 -29" fill="none" stroke="#fff8e9" stroke-opacity=".48" stroke-width="2" stroke-linecap="round"/>';
    } else if (id === 'lily') {
      artwork = petalRing(6, 8.5, 23, 12, 0, prefix, .93, variation * 14) + '<circle r="7" fill="#e7c784"/><path d="M0 0 L16 -20 M0 0 L-18 -18 M0 0 L20 10" stroke="#967448" stroke-width="1.3" stroke-linecap="round"/>';
    } else if (id === 'sunflower') {
      artwork = petalRing(14, 5.8, 20, 14, 0, prefix, .96, variation * 8) + '<circle r="13" fill="#695039"/><circle r="9" fill="#8b6337"/><circle r="5" fill="#5a422e" opacity=".82"/>';
    } else if (id === 'gerbera' || id === 'chamomile') {
      artwork = petalRing(id === 'gerbera' ? 14 : 11, 4.3, 15, 11, 0, prefix, .94, variation * 12) + '<circle r="8" fill="' + (id === 'chamomile' ? '#d4b769' : '#806248') + '"/><circle r="4" fill="#a77e51" opacity=".72"/>';
    } else if (id === 'anthurium') {
      artwork = '<path d="M-2 18 C-24 4 -31 -15 -17 -31 C-6 -43 3 -30 7 -24 C18 -37 30 -27 26 -12 C23 4 11 14 -2 18Z" fill="url(#' + prefix + ')" stroke="rgba(81,48,47,.18)" stroke-width="1.1"/><path d="M6 -2 C12 -7 15 -14 15 -22" stroke="#f1d8ab" stroke-width="3" stroke-linecap="round"/><ellipse cx="16" cy="-25" rx="3" ry="5" fill="#e9c887"/>';
    } else if (id === 'calla') {
      artwork = '<path d="M-3 18 C-23 6 -29 -13 -16 -28 C-5 -40 17 -37 24 -20 C27 -10 22 1 11 9 C4 14 0 17 -3 18Z" fill="url(#' + prefix + ')"/><path d="M-4 17 C7 7 11 -9 11 -25 C22 -17 22 -4 14 7 C8 14 1 17 -4 17Z" fill="#fff8ed" fill-opacity=".34"/><path d="M-1 15 Q2 -2 16 -16" stroke="#d5ad6d" stroke-width="3" stroke-linecap="round"/>';
    } else if (id === 'hydrangea') {
      const little = [];
      for (let petal = 0; petal < 4; petal += 1) {
        const a = (petal * 90 + variation * 34) * Math.PI / 180;
        const px = Math.cos(a) * 12;
        const py = Math.sin(a) * 11;
        little.push('<g transform="translate(' + px.toFixed(1) + ' ' + py.toFixed(1) + ')">' + petalRing(4, 4.2, 7, 5, 0, prefix, .9, 0) + '<circle r="2.2" fill="#d8c88c"/></g>');
      }
      artwork = little.join('');
    } else if (id === 'baby' || id === 'waxflower') {
      const little = [];
      for (let bloom = 0; bloom < 5; bloom += 1) {
        const a = bloom * GOLDEN_ANGLE + variation;
        const px = Math.cos(a) * 11;
        const py = Math.sin(a) * 9;
        little.push('<g transform="translate(' + px.toFixed(1) + ' ' + py.toFixed(1) + ')">' + petalRing(5, 2.4, 4.3, 3, 0, prefix, .95, bloom * 13) + '<circle r="1.8" fill="#d8bc83"/></g>');
      }
      artwork = little.join('');
    } else if (id === 'rose' || id === 'peony' || id === 'ranunculus') {
      const outerCount = id === 'rose' ? 9 : id === 'peony' ? 11 : 12;
      artwork = curledPetals(outerCount, prefix, .78, 1, variation * 12)
        + curledPetals(7, prefix, .9, .66, 18 + variation * 18)
        + curledPetals(5, prefix, .98, .38, variation * 24)
        + '<path d="M-4 3 C-9 -1 -7 -8 -2 -9 C4 -11 8 -5 4 -1 C1 2 1 5 5 7" fill="none" stroke="#935c58" stroke-opacity=".64" stroke-width="1.7" stroke-linecap="round"/>';
    } else {
      const count = 12;
      artwork = petalRing(count, size * .22, size * .38, size * .43, 0, prefix, .75, variation * 18)
        + petalRing(Math.max(5, count - 2), size * .17, size * .27, size * .27, 0, prefix, .89, 18 + variation * 16)
        + petalRing(5, size * .13, size * .18, size * .13, 0, prefix, .99, variation * 28)
        + '<path d="M-4 2 C-8 -5 -3 -11 2 -10 C7 -9 8 -3 3 0 C0 2 -1 5 2 6" fill="none" stroke="#8e5157" stroke-opacity=".56" stroke-width="1.8" stroke-linecap="round"/>';
    }

    const flip = variation > .52 ? -1 : 1;
    const unitScale = (scale / 44).toFixed(3);
    const dataAttrs = meta ? ' data-flower-index="' + meta.flowerIndex + '" data-instance-index="' + meta.instanceIndex + '"' : '';
    const selectionBox = selected ? '<rect x="-27" y="-32" width="54" height="64" rx="3" fill="none" stroke="#395c43" stroke-width="1.5" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>' : '';
    return '<defs>' + gradient(color, prefix) + '</defs><g class="flower-instance"' + dataAttrs + ' transform="translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ') rotate(' + finalAngle.toFixed(1) + ') scale(' + (Number(unitScale) * flip).toFixed(3) + ' ' + unitScale + ')" filter="url(#petal-shadow)">' + artwork + selectionBox + '</g>';
  }

  function leafSprig(x, y, scale, color, direction, index, selected, meta) {
    const sign = direction < 0 ? -1 : 1;
    const attrs = meta ? ' data-flower-index="' + meta.flowerIndex + '" data-instance-index="' + meta.instanceIndex + '"' : '';
    let leaves = '';
    for (let i = 0; i < 5; i += 1) {
      const py = y + i * 13 * scale;
      const px = x + sign * (i % 2 ? 13 : 21) * scale;
      const side = i % 2 ? -1 : 1;
      leaves += '<ellipse cx="' + px.toFixed(1) + '" cy="' + py.toFixed(1) + '" rx="' + (11 * scale).toFixed(1) + '" ry="' + (5.2 * scale).toFixed(1) + '" transform="rotate(' + (side * sign * 35) + ' ' + px.toFixed(1) + ' ' + py.toFixed(1) + ')" fill="' + color + '" stroke="#536c52" stroke-opacity=".35" stroke-width=".8"/>';
    }
    const selection = selected ? '<rect x="' + (x - 29).toFixed(1) + '" y="' + (y - 18).toFixed(1) + '" width="58" height="90" rx="3" fill="none" stroke="#395c43" stroke-width="1.5" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>' : '';
    return '<g class="flower-instance"' + attrs + ' opacity=".95" transform="rotate(' + ((meta && meta.rotation) || 0) + ' ' + x.toFixed(1) + ' ' + y.toFixed(1) + ')"><path d="M300 366 Q' + (300 + sign * 22 * scale).toFixed(1) + ' ' + (y + 50 * scale).toFixed(1) + ' ' + x.toFixed(1) + ' ' + (y - 7 * scale).toFixed(1) + '" fill="none" stroke="#667e5e" stroke-width="2.4" stroke-linecap="round"/>' + leaves + selection + '</g>';
  }

  function packageArtwork(recipe) {
    const color = recipe.wrapColorHex || '#eee5d7';
    const style = recipe.wrappingStyle || 'korean-double';
    const paper = color;
    const left = style === 'round' ? '<path d="M197 296 Q211 276 237 289 L298 316 L270 411 Q226 397 189 362Z" fill="url(#paper-back)" opacity=".75"/>' : '<path d="M207 286 Q240 304 300 311 L259 422 Q219 398 190 340Z" fill="url(#paper-back)" opacity=".8"/>';
    const right = style === 'round' ? '<path d="M403 296 Q389 276 363 289 L302 316 L330 411 Q374 397 411 362Z" fill="url(#paper-back)" opacity=".7"/>' : '<path d="M393 286 Q360 304 300 311 L341 422 Q381 398 410 340Z" fill="url(#paper-back)" opacity=".8"/>';
    let front;
    if (style === 'single') front = '<path d="M226 293 Q300 323 374 293 L340 410 Q300 434 260 410Z" fill="url(#paper-front)"/>';
    else if (style === 'natural') front = '<path d="M202 294 Q247 317 300 306 Q353 317 398 294 L355 421 Q300 441 245 421Z" fill="url(#paper-front)"/>';
    else if (style === 'kraft') front = '<path d="M204 290 Q248 318 300 309 Q352 318 396 290 L356 425 Q300 443 244 425Z" fill="url(#paper-front)"/>';
    else if (style === 'round') front = '<path d="M216 302 Q300 327 384 302 Q365 374 340 416 Q300 437 260 416 Q235 374 216 302Z" fill="url(#paper-front)"/>';
    else front = '<path d="M199 287 Q245 313 300 309 Q355 313 401 287 L359 421 Q300 446 241 421Z" fill="url(#paper-front)"/>';
    const folds = '<path d="M242 307 L276 419 M358 307 L324 419 M300 314 L300 433" stroke="#fffaf2" stroke-opacity=".44" stroke-width="2" fill="none"/>';
    const card = recipe.decorationCard ? '<g transform="translate(366 326) rotate(11)"><path d="M0 0 H39 V54 H0Z" fill="#fffdf8" stroke="#d5d8cf"/><path d="M7 12 H32 M7 18 H27" stroke="#82917d" stroke-width="1.3"/><circle cx="19" cy="33" r="5" fill="#d88b92"/></g>' : '';
    const pearls = recipe.decorationPearls ? '<g fill="#fffdf4" stroke="#d8ccb5" stroke-width="1"><circle cx="233" cy="299" r="5"/><circle cx="370" cy="301" r="4"/><circle cx="261" cy="316" r="3.6"/><circle cx="346" cy="318" r="4.4"/></g>' : '';
    return '<defs><linearGradient id="paper-front" x1="0" x2="1" y1="0" y2="1"><stop stop-color="' + paper + '"/><stop offset=".48" stop-color="' + paper + '" stop-opacity=".94"/><stop offset="1" stop-color="#8d775f" stop-opacity=".22"/></linearGradient><linearGradient id="paper-back" x1="0" x2="1" y1="0" y2="0"><stop stop-color="#fffdf8" stop-opacity=".7"/><stop offset="1" stop-color="' + paper + '"/></linearGradient></defs>' + left + right + front + folds + card + pearls;
  }

  function defaultPosition(category, index, count, item) {
    if (category === 'foliage') {
      const sign = index % 2 === 0 ? -1 : 1;
      return { x: 300 + sign * (92 + (index % 3) * 19), y: 198 + (index % 4) * 19, scale: .72 + random01(item.id + index) * .36, rotation: 0 };
    }
    const config = { main: { x: 112, y: 174 }, secondary: { x: 153, y: 213 }, filler: { x: 166, y: 236 } }[category];
    const seed = hash(item.id + item.color + index);
    const theta = index * GOLDEN_ANGLE + ({ main: 3, secondary: 2, filler: 1 }[category]) * 1.12 + (seed % 41) / 100;
    const radius = count <= 1 ? .18 : Math.sqrt((index + .5) / count);
    const x = 300 + Math.cos(theta) * config.x * radius;
    const y = config.y + Math.sin(theta) * config.y * .42 * radius + (category === 'main' ? 0 : index % 2 * 8);
    return { x: x, y: y, scale: 1, rotation: (random01(item.id + '-angle-' + index) - .5) * 36 };
  }

  function prepare(recipe, flowers) {
    ['foliage', 'filler', 'secondary', 'main'].forEach(function (category) {
      const group = [];
      (recipe.flowers || []).forEach(function (item) {
        const def = flowers.find(function (candidate) { return candidate.id === item.id; });
        if (!def || def.category !== category) return;
        item.positions = Array.isArray(item.positions) ? item.positions : [];
        for (let local = 0; local < Math.max(0, Math.min(18, Number(item.quantity) || 0)); local += 1) group.push({ item: item, local: local });
      });
      group.forEach(function (instance, index) {
        if (!instance.item.positions[instance.local]) {
          const point = defaultPosition(category, index, group.length, instance.item);
          instance.item.positions[instance.local] = { x: (point.x - 100) / 400, y: (point.y - 60) / 420, scale: point.scale || 1, rotation: point.rotation || 0 };
        }
        instance.item.positions.length = Math.max(instance.item.positions.length, Number(instance.item.quantity) || 0);
      });
      group.forEach(function (instance) { instance.item.positions.length = Math.max(0, Math.min(18, Number(instance.item.quantity) || 0)); });
    });
    return recipe;
  }

  function render(recipe, flowers, selected) {
    prepare(recipe, flowers);
    const stemItems = [];
    const blooms = { main: [], secondary: [], filler: [] };
    const foliage = [];
    const layout = {
      main: { x: 112, y: 174, size: 58 },
      secondary: { x: 153, y: 213, size: 44 },
      filler: { x: 166, y: 236, size: 24 }
    };

    ['foliage', 'filler', 'secondary', 'main'].forEach(function (category, categoryIndex) {
      const instances = [];
      (recipe.flowers || []).forEach(function (item, itemIndex) {
        const def = flowers.find(function (candidate) { return candidate.id === item.id; });
        if (!def || def.category !== category) return;
        for (let count = 0; count < Math.max(0, Math.min(18, Number(item.quantity) || 0)); count += 1) instances.push({ item: item, def: def, itemIndex: itemIndex, local: count });
      });
      if (category === 'foliage') {
        instances.forEach(function (instance, index) {
          const position = instance.item.positions[instance.local];
          const x = 100 + position.x * 400;
          const y = 60 + position.y * 420;
          const sign = x < 300 ? -1 : 1;
          const isSelected = !!selected && selected.flowerIndex === instance.itemIndex && selected.instanceIndex === instance.local;
          const meta = { flowerIndex: instance.itemIndex, instanceIndex: instance.local, rotation: position.rotation || 0 };
          foliage.push(leafSprig(x, y, position.scale || .9, instance.item.colorHex || instance.def.swatch, sign, index, isSelected, meta));
        });
        return;
      }
      const config = layout[category];
      instances.forEach(function (instance, index) {
        const position = instance.item.positions[instance.local];
        const wobble = random01(instance.item.id + '-shape-' + index);
        const x = 100 + position.x * 400;
        const y = 60 + position.y * 420;
        const scale = config.size * (.88 + wobble * .22) * (position.scale || 1);
        const angle = position.rotation || 0;
        const item = Object.assign({}, instance.item, { colorHex: instance.item.colorHex || instance.def.colorHex || instance.def.swatch });
        stemItems.push('<path d="M' + x.toFixed(1) + ' ' + (y + scale * .22).toFixed(1) + ' Q' + (300 + (x - 300) * .7).toFixed(1) + ' 330 300 465" fill="none" stroke="#637957" stroke-width="' + (category === 'filler' ? '1.7' : '2.5') + '" stroke-linecap="round" opacity=".76"/>');
        const isSelected = !!selected && selected.flowerIndex === instance.itemIndex && selected.instanceIndex === instance.local;
        blooms[category].push(flowerHead(item, instance.def, x, y, scale, angle, category + '-' + index, isSelected, { flowerIndex: instance.itemIndex, instanceIndex: instance.local }));
      });
    });

    const ribbon = recipe.ribbonStyle || 'bow';
    const ribbonColor = recipe.ribbonColorHex || '#e7dfd0';
    let ribbonArt = '';
    if (ribbon === 'bow') ribbonArt = '<g fill="' + ribbonColor + '" stroke="rgba(83,65,53,.17)" stroke-width="1"><path d="M286 350 C251 326 226 339 238 357 C250 373 273 366 296 359Z"/><path d="M314 350 C349 326 374 339 362 357 C350 373 327 366 304 359Z"/><path d="M293 359 L279 395 L300 382 L321 395 L307 359Z"/><ellipse cx="300" cy="356" rx="10" ry="9" fill="#fff" fill-opacity=".18"/></g>';
    else if (ribbon === 'narrow') ribbonArt = '<path d="M288 349 Q300 360 312 349 L324 397 L306 384 L300 420 L294 384 L276 397Z" fill="' + ribbonColor + '"/><path d="M288 349 Q300 360 312 349 L310 362 Q300 368 290 362Z" fill="#fff" fill-opacity=".26"/>';
    else if (ribbon === 'draped') ribbonArt = '<path d="M284 345 Q300 359 316 345 L352 422 Q333 428 319 411 L302 375 L282 425 Q268 423 256 414Z" fill="' + ribbonColor + '" opacity=".94"/><ellipse cx="300" cy="352" rx="13" ry="8" fill="' + ribbonColor + '"/>';

    const wrap = packageArtwork(recipe);
    const flowersSvg = blooms.filler.concat(blooms.secondary, blooms.main).join('');
    const hasFlowers = (recipe.flowers || []).some(function (item) { return item.category !== 'foliage' && item.quantity > 0; });
    const placeholder = hasFlowers ? '' : '<g opacity=".26"><path d="M300 284 C277 229 261 191 246 159 M300 284 C325 225 341 190 360 160 M300 284 C300 218 300 180 300 145" fill="none" stroke="#788878" stroke-width="3" stroke-linecap="round"/><circle cx="246" cy="158" r="22" fill="#e8dfd5"/><circle cx="300" cy="145" r="24" fill="#e8dfd5"/><circle cx="360" cy="158" r="22" fill="#e8dfd5"/><text x="300" y="262" text-anchor="middle" fill="#5e6d61" font-family="sans-serif" font-size="13">先从主花开始，花束会自动成形</text></g>';
    return '<svg class="bouquet-artwork" xmlns="http://www.w3.org/2000/svg" viewBox="100 60 400 420" role="img" aria-label="根据所选花材自动排版的花束实时预览"><defs><filter id="petal-shadow" x="-60%" y="-60%" width="220%" height="220%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#534439" flood-opacity=".14"/></filter><linearGradient id="bouquet-stem" x1="0" x2="1"><stop stop-color="#789069"/><stop offset="1" stop-color="#4e6948"/></linearGradient><radialGradient id="stage-shadow"><stop stop-color="#c9c6b9" stop-opacity=".34"/><stop offset="1" stop-color="#c9c6b9" stop-opacity="0"/></radialGradient></defs><ellipse cx="300" cy="446" rx="194" ry="24" fill="url(#stage-shadow)"/><g>' + stemItems.join('') + foliage.join('') + '</g>' + wrap + flowersSvg + ribbonArt + placeholder + '</svg>';
  }

  function toDataUri(svg) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function speciesIcon(def, color) {
    const item = { id: def.id, color: def.color, colorHex: color || def.swatch };
    return '<svg class="species-icon-art" viewBox="-30 -30 60 60" aria-hidden="true">' + flowerHead(item, def, 0, 0, 31, 0, 'icon') + '</svg>';
  }

  global.FloraBouquetRenderer = { render: render, prepare: prepare, toDataUri: toDataUri, speciesIcon: speciesIcon };
}(window));
