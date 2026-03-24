export function initCanvasDrag() {
  const drawingBoard = document.getElementById('drawing-board');
  if (!drawingBoard) return;

  // 关键：让 drawingBoard 自己成为绝对定位子元素的参照物
  drawingBoard.style.position = 'relative';
  drawingBoard.style.overflow = 'hidden';

  if (drawingBoard.parentElement) {
    drawingBoard.parentElement.style.position = 'relative';
  }

  let droppedImages = [];
  let draggingImg = null;
  let currentSelectedItem = null;
  let layerMenu = null;
  let dragCandidate = null;
  const DRAG_THRESHOLD = 4;
  let layerMenuTarget = null;
  let layerSeed = 0;
  const MIN_SCALE = 0.6;
  const MAX_SCALE = 4;

  let dragStartMouse = { x: 0, y: 0 };
  let dragStartPos = { x: 0, y: 0 };
  let dragRAF = null;
  let pendingDragPos = null;

  const SCREEN_DPR = window.devicePixelRatio || 4;

  // mask 画布分辨率，建议至少 2
  const MASK_DPR = Math.max(2, SCREEN_DPR);

  // 导出最大倍率，防止太大爆内存
  const MAX_EXPORT_SCALE = 8;

  const ENABLE_LIGHT_SR = true;

  // 最多把原图先放大到原始尺寸的多少倍，参数可改
  const SR_MAX_SOURCE_UPSCALE = 2.5;
  // 分步放大倍率，1.4~1.8 比较稳
  const SR_STEP_RATIO = 1.6;
  // 锐化强度，0.25~0.55 比较自然
  const SR_SHARPEN_AMOUNT = 0.42;
  // 低于这个差值的细节不增强，防止噪点
  const SR_EDGE_THRESHOLD = 4;
  // 缓存，避免重复导出反复算
  const srCache = new Map();

function createWorkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function loadImageAsync(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function progressiveUpscale(source, targetW, targetH) {
  const srcW = source.naturalWidth || source.width;
  const srcH = source.naturalHeight || source.height;

  let current = createWorkCanvas(srcW, srcH);
  let ctx = current.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, srcW, srcH);

  while (current.width < targetW || current.height < targetH) {
    const nextW = Math.min(
      targetW,
      Math.max(current.width + 1, Math.round(current.width * SR_STEP_RATIO))
    );
    const nextH = Math.min(
      targetH,
      Math.max(current.height + 1, Math.round(current.height * SR_STEP_RATIO))
    );

    const next = createWorkCanvas(nextW, nextH);
    const nctx = next.getContext('2d', { willReadFrequently: true });
    nctx.imageSmoothingEnabled = true;
    nctx.imageSmoothingQuality = 'high';
    nctx.drawImage(current, 0, 0, current.width, current.height, 0, 0, nextW, nextH);
    current = next;
  }

  return current;
}

function applyLumaUnsharp(canvas, amount = SR_SHARPEN_AMOUNT, threshold = SR_EDGE_THRESHOLD) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  const size = width * height;
  const luma = new Float32Array(size);
  const blur = new Float32Array(size);

  // 亮度
  for (let i = 0, p = 0; i < size; i++, p += 4) {
    luma[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }

  // 很轻的 3x3 平滑
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;

      for (let ky = -1; ky <= 1; ky++) {
        const yy = Math.max(0, Math.min(height - 1, y + ky));
        for (let kx = -1; kx <= 1; kx++) {
          const xx = Math.max(0, Math.min(width - 1, x + kx));
          sum += luma[yy * width + xx];
          count++;
        }
      }

      blur[y * width + x] = sum / count;
    }
  }

  // 仅增强亮度边缘，减少彩边
  for (let i = 0, p = 0; i < size; i++, p += 4) {
    const diff = luma[i] - blur[i];
    if (Math.abs(diff) < threshold) continue;

    const boost = diff * amount;
    data[p] = Math.max(0, Math.min(255, data[p] + boost));
    data[p + 1] = Math.max(0, Math.min(255, data[p + 1] + boost));
    data[p + 2] = Math.max(0, Math.min(255, data[p + 2] + boost));
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

async function buildLightSRSource(item, scale) {
  const src = item.originalSrc || item.element.src;

  const displayW = item.element.offsetWidth || parseFloat(item.element.style.width) || 100;
  const displayH = item.element.offsetHeight || (
    item.element.naturalWidth
      ? displayW * item.element.naturalHeight / item.element.naturalWidth
      : 100
  );

  const targetPxW = Math.max(1, Math.round(displayW * scale));
  const targetPxH = Math.max(1, Math.round(displayH * scale));

  const cacheKey = `${src}__${targetPxW}x${targetPxH}`;
  if (srCache.has(cacheKey)) {
    return srCache.get(cacheKey);
  }

  const img = await loadImageAsync(src);

  const naturalW = img.naturalWidth || img.width;
  const naturalH = img.naturalHeight || img.height;

  // 如果原图已经足够，不做 SR，直接返回原图
  if (targetPxW <= naturalW && targetPxH <= naturalH) {
    srCache.set(cacheKey, img);
    return img;
  }

  // 轻量策略：只先放大到原图的有限倍数
  const srW = Math.min(targetPxW, Math.round(naturalW * SR_MAX_SOURCE_UPSCALE));
  const srH = Math.min(targetPxH, Math.round(naturalH * SR_MAX_SOURCE_UPSCALE));

  let work = progressiveUpscale(img, srW, srH);
  work = applyLumaUnsharp(work);

  srCache.set(cacheKey, work);
  return work;
}

async function drawExportItem(ctx, item, clip, scale) {
  try {
    const renderable = ENABLE_LIGHT_SR
      ? await buildLightSRSource(item, scale)
      : await loadImageAsync(item.originalSrc || item.element.src);

    const pos = getImagePosition(item.element);
    const x = pos.x - clip.x;
    const y = pos.y - clip.y;
    const w = item.element.offsetWidth;
    const h = item.element.offsetHeight;

    ctx.drawImage(renderable, x, y, w, h);
  } catch (err) {
    console.error('导出图片处理失败:', err);
  }
}

  function setImagePosition(img, x, y) {
    img.dataset.x = String(x);
    img.dataset.y = String(y);
    img.style.transform = `translate3d(${x}px, ${y}px, 0)`;

    const item = getItemByElement(img);
    if (item) {
      updateLabelPosition(item);
    }
  }

  function getImagePosition(img) {
    return {
      x: parseFloat(img.dataset.x || '0'),
      y: parseFloat(img.dataset.y || '0')
    };
  }

  function getImageRenderSize(img) {
    const w = img.offsetWidth || parseFloat(img.style.width) || 100;
    const h = img.offsetHeight || (
      img.naturalWidth ? (w * img.naturalHeight / img.naturalWidth) : 100
    );
    return { w, h };
  }

  function clampImagePosition(img, x, y) {
    const boardRect = drawingBoard.getBoundingClientRect();
    const { w, h } = getImageRenderSize(img);

    return {
      x: Math.max(0, Math.min(boardRect.width - w, x)),
      y: Math.max(0, Math.min(boardRect.height - h, y))
    };
  }

  let drawSubCanvasMode = false;
  let subCanvases = [];
  let subCanvasStart = { x: 0, y: 0 };
  let tempDrawRect = null;
  let activeRegionId = null;
  let canvasExportImg = null;

  let paintMode = false;
  let isPainting = false;
  let maskCanvas;
  let maskCtx;
  let brushSize = 10;

  let lastDragData = null;

// 如果你的前后端不是同域，把这里改成你的后端地址
const API_BASE = window.API_BASE || '';

function normalizeImageUrl(url) {
  if (!url) return '';
  if (/^(data:|blob:|https?:)/i.test(url)) return url;

  if (API_BASE) {
    if (url.startsWith('/')) return `${API_BASE}${url}`;
    return `${API_BASE}/${url}`;
  }

  return url;
}

function extractDragData(e) {
  const dt = e.dataTransfer;
  if (!dt) return lastDragData;

  const rawJson = dt.getData('application/json');
  const rawPlain = dt.getData('text/plain');
  const rawUri = dt.getData('text/uri-list');

  const raw = rawJson || rawPlain || rawUri;

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.url) {
        return {
          ...parsed,
          url: normalizeImageUrl(parsed.url)
        };
      }
    } catch (_) {
      return { url: normalizeImageUrl(raw.trim()) };
    }
  }

  return lastDragData;
}

function getItemByElement(el) {
  return droppedImages.find(item => item.element === el);
}

function getSortedItems() {
  return [...droppedImages].sort((a, b) => a.zIndex - b.zIndex);
}

function applyItemVisualLayer(item) {
  if (!item) return;
  item.element.style.zIndex = String(item.zIndex * 2);
  if (item.labelEl) {
    item.labelEl.style.zIndex = String(item.zIndex * 2 + 1);
  }
}


function normalizeLayerOrder() {
  droppedImages = getSortedItems();
  droppedImages.forEach((item, index) => {
    item.zIndex = index + 1;
    applyItemVisualLayer(item);
    updateLabelPosition(item);
  });
  layerSeed = droppedImages.length;
}

function selectItem(item) {
  currentSelectedItem = item;
  droppedImages.forEach(it => {
    it.element.style.outline = 'none';
    it.element.style.boxShadow = it === item
      ? '0 0 0 1.5px rgba(148,163,184,0.72), 0 8px 18px rgba(15,23,42,0.12)'
      : '0 1px 3px rgba(15,23,42,0.10)';

    if (it.labelEl) {
      it.labelEl.style.boxShadow = it === item
        ? '0 0 0 1.5px rgba(148,163,184,0.20), 0 1px 3px rgba(0,0,0,0.08)'
        : '0 1px 3px rgba(0,0,0,0.08)';
    }
  });
}

function clearSelection() {
  currentSelectedItem = null;
  droppedImages.forEach(it => {
    it.element.style.outline = 'none';
    it.element.style.boxShadow = '0 1px 3px rgba(15,23,42,0.10)';
    if (it.labelEl) {
      it.labelEl.style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)';
    }
  });
}

function updateLabelPosition(item) {
  if (!item || !item.labelEl) return;

  const pos = getImagePosition(item.element);
  const labelEl = item.labelEl;

  labelEl.style.left = `${pos.x}px`;
  labelEl.style.maxWidth = `${Math.max(120, item.element.offsetWidth)}px`;

  const labelH = labelEl.offsetHeight || 24;
  labelEl.style.top = `${Math.max(0, pos.y - labelH - 6)}px`;

  applyItemVisualLayer(item);
}

function setItemLabel(item, text) {
  const next = (text || '').trim();
  item.label = next;

  if (!next) {
    if (item.labelEl) {
      item.labelEl.remove();
      item.labelEl = null;
    }
    return;
  }

  if (!item.labelEl) {
    const labelEl = document.createElement('div');
    labelEl.className = 'canvas-image-label';
    labelEl.style.cssText = `
      position:absolute;
      padding:4px 8px;
      background:rgba(255,255,255,0.92);
      border:1px solid #93c5fd;
      border-radius:6px;
      font-size:12px;
      line-height:1.35;
      color:#0f172a;
      pointer-events:none;
      white-space:normal;
      word-break:break-word;
      box-shadow:0 1px 3px rgba(0,0,0,0.08);
    `;
    drawingBoard.appendChild(labelEl);
    item.labelEl = labelEl;
  }

  item.labelEl.textContent = next;
  updateLabelPosition(item);
}

function createRegionBox(l, t, w, h) {
  const region = document.createElement('div');
  const id = `region_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  region.dataset.regionId = id;
  region.style.cssText = `
    position:absolute;
    left:${l}px;
    top:${t}px;
    width:${w}px;
    height:${h}px;
    border:2px solid #ef4444;
    background:transparent;
    pointer-events:none;
    z-index:1;
  `;

  drawingBoard.appendChild(region);

  const item = { id, element: region, x: l, y: t, w, h };
  subCanvases.push(item);
  activeRegionId = id;

  return item;
}

function createLayerMenu() {
  if (layerMenu) return;

  layerMenu = document.createElement('div');
  layerMenu.id = 'canvas-layer-menu';
  layerMenu.style.cssText = `
    position:fixed;
    display:none;
    min-width:140px;
    background:#ffffff;
    border:1px solid #dbeafe;
    border-radius:8px;
    box-shadow:0 8px 24px rgba(0,0,0,0.12);
    padding:6px;
    z-index:99999;
  `;

  layerMenu.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  layerMenu.addEventListener('mousedown', (e) => {
    e.stopPropagation();
  });

  const actions = [
    { key: 'bring-front', label: 'Bring to Front' },
    { key: 'forward-one', label: 'Bring Forward' },
    { key: 'backward-one', label: 'Send Backward' },
    { key: 'send-back', label: 'Send to Back' },
    { key: 'edit-label', label: 'Edit Label' }
  ];

  actions.forEach(action => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.action = action.key;
    btn.textContent = action.label;
    btn.style.cssText = `
      width:100%;
      display:block;
      border:none;
      background:transparent;
      text-align:left;
      padding:8px 10px;
      border-radius:6px;
      cursor:pointer;
      font-size:13px;
    `;
    btn.onmouseenter = () => btn.style.background = '#eff6ff';
    btn.onmouseleave = () => btn.style.background = 'transparent';
    layerMenu.appendChild(btn);
  });

  layerMenu.addEventListener('click', (e) => {
    const action = e.target?.dataset?.action;
    if (!action || !layerMenuTarget) return;

    handleLayerAction(layerMenuTarget, action);
    hideLayerMenu();
  });

  document.body.appendChild(layerMenu);

  document.addEventListener('click', hideLayerMenu);
  window.addEventListener('blur', hideLayerMenu);
  document.addEventListener('scroll', hideLayerMenu, true);
}

function showLayerMenu(x, y, item) {
  if (!layerMenu) return;

  layerMenuTarget = item;
  selectItem(item);

  layerMenu.style.display = 'block';

  const menuW = layerMenu.offsetWidth || 140;
  const menuH = layerMenu.offsetHeight || 180;
  const left = Math.min(x, window.innerWidth - menuW - 8);
  const top = Math.min(y, window.innerHeight - menuH - 8);

  layerMenu.style.left = `${Math.max(8, left)}px`;
  layerMenu.style.top = `${Math.max(8, top)}px`;
}

function hideLayerMenu() {
  if (!layerMenu) return;
  layerMenu.style.display = 'none';
  layerMenuTarget = null;
}

function handleLayerAction(item, action) {
  const sorted = getSortedItems();
  const idx = sorted.findIndex(it => it === item);

  if (idx === -1) return;

  if (action === 'bring-front') {
    item.zIndex = Math.max(...sorted.map(it => it.zIndex)) + 1;
    normalizeLayerOrder();
    selectItem(item);
    return;
  }

  if (action === 'send-back') {
    item.zIndex = Math.min(...sorted.map(it => it.zIndex)) - 1;
    normalizeLayerOrder();
    selectItem(item);
    return;
  }

  if (action === 'forward-one' && idx < sorted.length - 1) {
    const next = sorted[idx + 1];
    const tmp = item.zIndex;
    item.zIndex = next.zIndex;
    next.zIndex = tmp;
    normalizeLayerOrder();
    selectItem(item);
    return;
  }

  if (action === 'backward-one' && idx > 0) {
    const prev = sorted[idx - 1];
    const tmp = item.zIndex;
    item.zIndex = prev.zIndex;
    prev.zIndex = tmp;
    normalizeLayerOrder();
    selectItem(item);
    return;
  }

  if (action === 'edit-label') {
    const text = prompt('请输入图片语义标注', item.label || '');
    if (text !== null) {
      setItemLabel(item, text);
    }
  }
}

function splitLabelLines(ctx, text, maxWidth) {
  const chars = Array.from(text || '');
  const lines = [];
  let current = '';

  chars.forEach(ch => {
    const test = current + ch;
    if (current && ctx.measureText(test).width > maxWidth) {
      lines.push(current);
      current = ch;
    } else {
      current = test;
    }
  });

  if (current) lines.push(current);
  return lines;
}

function drawLabelsToCanvas(ctx, items, clip) {
  items.forEach(item => {
    if (!item.label) return;

    const pos = getImagePosition(item.element);
    const x = pos.x - clip.x;
    const y = pos.y - clip.y;

    ctx.save();
    ctx.font = '600 13px sans-serif';

    const maxWidth = Math.max(120, item.element.offsetWidth);
    const lines = splitLabelLines(ctx, item.label, maxWidth - 16);
    const lineHeight = 18;
    const textWidth = Math.max(...lines.map(line => ctx.measureText(line).width), 40);

    const boxW = Math.min(maxWidth, textWidth + 16);
    const boxH = lines.length * lineHeight + 10;
    const boxX = x;
    const boxY = Math.max(0, y - boxH - 6);

    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillRect(boxX, boxY, boxW, boxH);

    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 1;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    ctx.fillStyle = '#0f172a';
    lines.forEach((line, i) => {
      ctx.fillText(line, boxX + 8, boxY + 18 + i * lineHeight);
    });

    ctx.restore();
  });
}

async function drawExportItemsInOrder(ctx, items, clip, scale) {
  for (const item of items) {
    await drawExportItem(ctx, item, clip, scale);
  }
}

  initMaskCanvas();
  initTools();
  bindEvents();

  function initMaskCanvas() {
    maskCanvas = document.createElement('canvas');
    maskCanvas.id = 'mask-canvas';
    maskCanvas.style.cssText = `
      position:absolute;
      top:0;
      left:0;
      z-index:999;
      pointer-events:none;
    `;
    drawingBoard.appendChild(maskCanvas);

    resizeMaskCanvas();
    window.addEventListener('resize', resizeMaskCanvas);
  }

  function resizeMaskCanvas() {
    const r = drawingBoard.getBoundingClientRect();

    // 保留旧内容
    const prev = document.createElement('canvas');
    if (maskCanvas.width && maskCanvas.height) {
      prev.width = maskCanvas.width;
      prev.height = maskCanvas.height;
      const prevCtx = prev.getContext('2d');
      prevCtx.drawImage(maskCanvas, 0, 0);
    }

    maskCanvas.width = Math.max(1, Math.round(r.width * MASK_DPR));
    maskCanvas.height = Math.max(1, Math.round(r.height * MASK_DPR));
    maskCanvas.style.width = `${r.width}px`;
    maskCanvas.style.height = `${r.height}px`;

    maskCtx = maskCanvas.getContext('2d');
    maskCtx.setTransform(MASK_DPR, 0, 0, MASK_DPR, 0, 0);
    maskCtx.imageSmoothingEnabled = true;
    maskCtx.imageSmoothingQuality = 'high';

    // 恢复旧内容
    if (prev.width && prev.height) {
      maskCtx.drawImage(
        prev,
        0, 0, prev.width, prev.height,
        0, 0, r.width, r.height
      );
    }
  }

  function setToolbarButtonActive(btn, active) {
    if (!btn) return;
    btn.classList.toggle('is-active', !!active);
  }

  function syncToolbarState() {
    const selectBtn = document.getElementById('tool-select-btn');
    const regionBtn = document.getElementById('tool-region-btn');
    const paintBtn = document.getElementById('tool-paint-btn');

    setToolbarButtonActive(selectBtn, !drawSubCanvasMode && !paintMode);
    setToolbarButtonActive(regionBtn, drawSubCanvasMode);
    setToolbarButtonActive(paintBtn, paintMode);
  }

  function deactivatePaintMode() {
    paintMode = false;
    if (maskCanvas) maskCanvas.style.pointerEvents = 'none';
    drawingBoard.style.cursor = 'default';
    droppedImages.forEach(i => {
      if (i.element) i.element.style.pointerEvents = 'auto';
    });
  }

  function deactivateRegionMode() {
    drawSubCanvasMode = false;
    drawingBoard.style.cursor = 'default';

    if (tempDrawRect && tempDrawRect.parentNode) {
      tempDrawRect.parentNode.removeChild(tempDrawRect);
    }
    tempDrawRect = null;
  }

  function bindToolbarControls() {
    const selectBtn = document.getElementById('tool-select-btn');
    const regionBtn = document.getElementById('tool-region-btn');
    const paintBtn = document.getElementById('tool-paint-btn');
    const labelBtn = document.getElementById('tool-label-btn');
    const layerBtn = document.getElementById('tool-layer-btn');

    const collectBufferBtn = document.getElementById('collect-buffer-btn');
    const exportMaskBtn = document.getElementById('export-mask-btn');
    const exportCompositeBtn = document.getElementById('export-composite-btn');

    if (selectBtn) {
      selectBtn.onclick = () => {
        deactivateRegionMode();
        deactivatePaintMode();
        syncToolbarState();
      };
    }

    if (regionBtn) {
      regionBtn.onclick = () => {
        if (paintMode) deactivatePaintMode();
        drawSubCanvasMode = !drawSubCanvasMode;
        drawingBoard.style.cursor = drawSubCanvasMode ? 'crosshair' : 'default';
        syncToolbarState();
      };
    }

    if (paintBtn) {
      paintBtn.onclick = () => {
        if (drawSubCanvasMode) deactivateRegionMode();

        paintMode = !paintMode;
        if (paintMode) {
          maskCanvas.style.pointerEvents = 'auto';
          drawingBoard.style.cursor = 'crosshair';
          droppedImages.forEach(i => i.element.style.pointerEvents = 'none');
        } else {
          deactivatePaintMode();
        }

        syncToolbarState();
      };
    }

    if (labelBtn) {
      labelBtn.onclick = () => {
        if (!currentSelectedItem) return;
        const text = prompt('Enter image label', currentSelectedItem.label || '');
        if (text !== null) {
          setItemLabel(currentSelectedItem, text);
        }
      };
    }

    if (layerBtn) {
      layerBtn.onclick = (e) => {
        if (!currentSelectedItem) return;
        const rect = e.currentTarget.getBoundingClientRect();
        showLayerMenu(rect.left, rect.bottom + 6, currentSelectedItem);
      };
    }

    if (collectBufferBtn) {
      collectBufferBtn.onclick = () => {
        exportCanvasToImage('combined', {
          download: false,
          toBuffer: true,
          previewText: 'Canvas'
        });
      };
    }

    if (exportMaskBtn) {
      exportMaskBtn.onclick = () => {
        exportCanvasToImage('mask', {
          download: true,
          toBuffer: false,
          previewText: 'Mask'
        });
      };
    }

    if (exportCompositeBtn) {
      exportCompositeBtn.onclick = () => {
        exportCanvasToImage('combined', {
          download: true,
          toBuffer: false,
          previewText: 'Composite'
        });
      };
    }

    syncToolbarState();
  }

  function initTools() {
    bindToolbarControls();
    createLayerMenu();
    bindClearButton();
  }

  // function createDrawButton() {
  //   let wrap = document.getElementById('canvas-tool-btns');
  //   if (!wrap) {
  //     wrap = document.createElement('div');
  //     wrap.id = 'canvas-tool-btns';
  //     wrap.style.cssText = 'position:absolute;top:10px;left:10px;z-index:1000;display:flex;gap:8px;';
  //     drawingBoard.parentElement.style.position = 'relative';
  //     drawingBoard.parentElement.appendChild(wrap);
  //   }

  //   const btn = document.createElement('button');
  //   btn.innerHTML = '📏';
  //   btn.style.cssText = 'width:32px;height:32px;border:none;border-radius:4px;background:#ef4444;color:white;cursor:pointer;';
  //   btn.onclick = () => {
  //     if (paintMode) {
  //       paintMode = false;
  //       const pb = document.querySelector('#canvas-tool-btns button:nth-child(2)');
  //       if (pb) pb.style.background = '#10b981';
  //       maskCanvas.style.pointerEvents = 'none';
  //       droppedImages.forEach(i => i.element.style.pointerEvents = 'auto');
  //     }
  //     drawSubCanvasMode = !drawSubCanvasMode;
  //     drawingBoard.style.cursor = drawSubCanvasMode ? 'crosshair' : 'default';
  //     btn.style.background = drawSubCanvasMode ? '#dc2626' : '#ef4444';
  //     if (!drawSubCanvasMode && tempDrawRect) {
  //       drawingBoard.removeChild(tempDrawRect);
  //       tempDrawRect = null;
  //     }
  //   };
  //   wrap.appendChild(btn);
  // }

  // function createPaintButton() {
  //   const wrap = document.getElementById('canvas-tool-btns');
  //   const btn = document.createElement('button');
  //   btn.innerHTML = '🖌️';
  //   btn.style.cssText = 'width:32px;height:32px;border:none;border-radius:4px;background:#10b981;color:white;cursor:pointer;';
  //   btn.onclick = () => {
  //     if (drawSubCanvasMode) {
  //       drawSubCanvasMode = false;
  //       const db = document.querySelector('#canvas-tool-btns button:first-child');
  //       if (db) db.style.background = '#ef4444';
  //       if (tempDrawRect) {
  //         drawingBoard.removeChild(tempDrawRect);
  //         tempDrawRect = null;
  //       }
  //     }
  //     paintMode = !paintMode;
  //     if (paintMode) {
  //       maskCanvas.style.pointerEvents = 'auto';
  //       drawingBoard.style.cursor = 'crosshair';
  //       btn.style.background = '#059669';
  //       droppedImages.forEach(i => i.element.style.pointerEvents = 'none');
  //     } else {
  //       maskCanvas.style.pointerEvents = 'none';
  //       drawingBoard.style.cursor = 'default';
  //       btn.style.background = '#10b981';
  //       droppedImages.forEach(i => i.element.style.pointerEvents = 'auto');
  //     }
  //   };

  //   const clearBtn = document.createElement('button');
  //   clearBtn.innerHTML = '🧹';
  //   clearBtn.style.cssText = 'width:32px;height:32px;border:none;border-radius:4px;background:#f59e0b;color:white;cursor:pointer;';
  //   clearBtn.onclick = () => {
  //     maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
  //   };

  //   wrap.appendChild(btn);
  //   wrap.appendChild(clearBtn);
  // }

  // function createExportButton() {
  //   const box = document.querySelector('.col-right .mt-2.flex');
  //   if (!box) return;

  //   const btn1 = document.createElement('button');
  //   btn1.className = 'text-xs px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600';
  //   btn1.innerText = 'Export Composite';
  //   btn1.onclick = () => exportCanvasToImage('combined');
  //   box.appendChild(btn1);

  //   const btn2 = document.createElement('button');
  //   btn2.className = 'text-xs px-2 py-1 bg-purple-500 text-white rounded hover:bg-purple-600';
  //   btn2.innerText = 'Export Mask';
  //   btn2.onclick = () => exportCanvasToImage('mask');
  //   box.appendChild(btn2);

  //   const btn3 = document.createElement('button');
  //   btn3.className = 'text-xs px-2 py-1 bg-green-500 text-white rounded hover:bg-green-600';
  //   btn3.innerText = 'Export Source';
  //   btn3.onclick = () => exportCanvasToImage('origin');
  //   box.appendChild(btn3);
  // }

  // function createDragContainer() {
  //   let el = document.getElementById('canvas-drag-container');
  //   if (!el) {
  //     el = document.createElement('div');
  //     el.id = 'canvas-drag-container';
  //     el.style.cssText = `
  //       margin-top:8px;
  //       padding:8px;
  //       border:1px dashed #3B82F6;
  //       border-radius:6px;
  //       text-align:center;
  //       background:#f0f9ff;
  //       min-height:80px;
  //     `;
  //     drawingBoard.parentElement.appendChild(el);
  //   }

  //   el.innerHTML = `
  //     <div style="font-size:12px;color:#2563eb;">Export to enable drag</div>
  //   `;
  // }
  function bindClearButton() {
    const btn = document.getElementById('clear-canvas-btn');
    if (!btn) return;
    btn.onclick = () => {
      droppedImages.forEach(item => {
        if (item.element && item.element.parentNode) item.element.parentNode.removeChild(item.element);
        if (item.labelEl && item.labelEl.parentNode) item.labelEl.parentNode.removeChild(item.labelEl);
      });

      droppedImages = [];
      srCache.clear();
      layerSeed = 0;
      clearSelection();
      hideLayerMenu();

      if (maskCtx) {
        maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
      }

      subCanvases.forEach(region => {
        if (region.element && region.element.parentNode) {
          region.element.parentNode.removeChild(region.element);
        }
      });
      subCanvases = [];
      activeRegionId = null;

      if (tempDrawRect && tempDrawRect.parentNode) {
        tempDrawRect.parentNode.removeChild(tempDrawRect);
      }
      tempDrawRect = null;
      drawSubCanvasMode = false;
      deactivatePaintMode();
      syncToolbarState();
      drawingBoard.classList.remove('dragover');
    };

    drawingBoard.classList.remove('dragover');
  }

  function bindEvents() {
    drawingBoard.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
    drawingBoard.addEventListener('dragover', (e) => {
      e.preventDefault();
      drawingBoard.classList.add('dragover');
    });

    drawingBoard.addEventListener('dragleave', (e) => {
      if (e.relatedTarget && drawingBoard.contains(e.relatedTarget)) return;
      drawingBoard.classList.remove('dragover');
    });

    drawingBoard.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      drawingBoard.classList.remove('dragover');

      const data = extractDragData(e);

      if (!data || !data.url) {
        console.warn('drop 没拿到有效图片地址', e.dataTransfer?.types);
        return;
      }

      const r = drawingBoard.getBoundingClientRect();
      const x = Math.max(0, Math.min(r.width - 100, e.clientX - r.left - 50));
      const y = Math.max(0, Math.min(r.height - 100, e.clientY - r.top - 50));

      const img = new Image();
      img.onload = () => {
        img.style.cssText = `
          position:absolute;
          left:0;
          top:0;
          width:100px;
          height:auto;
          display:block;
          border:none;
          border-radius:6px;
          background:transparent;
          box-shadow:0 1px 3px rgba(15,23,42,0.10);
          cursor:grab;
          z-index:10;
          user-select:none;
          will-change:transform;
          transform:translate3d(0,0,0);
        `;
        img.dataset.scale = '1';
        img.dataset.x = '0';
        img.dataset.y = '0';
        img.draggable = false;

        drawingBoard.appendChild(img);

        const item = {
          id: `canvas_item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          element: img,
          originalSrc: normalizeImageUrl(data.url),
          zIndex: ++layerSeed,
          label: '',
          labelEl: null
        };

        droppedImages.push(item);
        applyItemVisualLayer(item);

        const pos = clampImagePosition(img, x, y);
        setImagePosition(img, pos.x, pos.y);

        img.addEventListener('click', (ev) => {
          ev.stopPropagation();
          selectItem(item);
          hideLayerMenu();
        });

        img.addEventListener('contextmenu', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          showLayerMenu(ev.clientX, ev.clientY, item);
        });

        img.addEventListener('dblclick', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const text = prompt('Enter image label', item.label || '')
          if (text !== null) {
            setItemLabel(item, text);
          }
        });

        img.addEventListener('mousedown', (ev) => {
          if (paintMode) return;

          if (ev.button !== 0) return;

          selectItem(item);

          dragCandidate = {
            item,
            img,
            startMouse: { x: ev.clientX, y: ev.clientY },
            startPos: getImagePosition(img)
          };
        });

        img.addEventListener('wheel', (ev) => {
          if (paintMode) return;
          ev.preventDefault();

          let scale = parseFloat(img.dataset.scale || '1');
          scale += ev.deltaY > 0 ? -0.1 : 0.1;
          scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
          img.dataset.scale = scale;
          img.style.width = 100 * scale + 'px';

          const current = getImagePosition(img);
          const clamped = clampImagePosition(img, current.x, current.y);
          setImagePosition(img, clamped.x, clamped.y);
        });

        selectItem(item);
        console.log('图片已成功添加到画布:', data.url);
      };

      img.onerror = () => {
        console.error('图片加载失败:', data.url);
      };

      img.src = normalizeImageUrl(data.url);
    });

    drawingBoard.addEventListener('mousedown', e => {
      if (!drawSubCanvasMode) return;
      e.preventDefault();
      const r = drawingBoard.getBoundingClientRect();
      subCanvasStart = { x: e.clientX - r.left, y: e.clientY - r.top };
      tempDrawRect = document.createElement('div');
      tempDrawRect.style.cssText = `
        position:absolute;
        left:${subCanvasStart.x}px;top:${subCanvasStart.y}px;
        width:0;height:0;
        border:2px dashed #ef4444;background:rgba(239,68,68,0.05);
        pointer-events:none;z-index:999;
      `;
      drawingBoard.appendChild(tempDrawRect);
    });

    drawingBoard.addEventListener('mousemove', e => {
      if (!tempDrawRect) return;
      const r = drawingBoard.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const l = Math.min(subCanvasStart.x, x);
      const t = Math.min(subCanvasStart.y, y);
      const w = Math.abs(x - subCanvasStart.x);
      const h = Math.abs(y - subCanvasStart.y);
      tempDrawRect.style.left = l + 'px';
      tempDrawRect.style.top = t + 'px';
      tempDrawRect.style.width = w + 'px';
      tempDrawRect.style.height = h + 'px';
    });

    drawingBoard.addEventListener('mouseup', e => {
      if (!tempDrawRect) return;
      const r = drawingBoard.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const l = Math.min(subCanvasStart.x, x);
      const t = Math.min(subCanvasStart.y, y);
      const w = Math.abs(x - subCanvasStart.x);
      const h = Math.abs(y - subCanvasStart.y);

      if (w < 50 || h < 50) {
        drawingBoard.removeChild(tempDrawRect);
        tempDrawRect = null;
        return;
      }
      createRegionBox(l, t, w, h);
      drawingBoard.removeChild(tempDrawRect);
      tempDrawRect = null;
      drawingBoard.style.cursor = 'crosshair';
    });

    document.addEventListener('mousemove', (e) => {
      if (paintMode) return;

      // 还没真正进入拖拽，只是候选阶段
      if (!draggingImg && dragCandidate) {
        const dx0 = e.clientX - dragCandidate.startMouse.x;
        const dy0 = e.clientY - dragCandidate.startMouse.y;
        const moved = Math.hypot(dx0, dy0);

        if (moved >= DRAG_THRESHOLD) {
          draggingImg = dragCandidate.img;
          dragStartMouse = { ...dragCandidate.startMouse };
          dragStartPos = { ...dragCandidate.startPos };

          document.body.style.userSelect = 'none';
          document.body.style.webkitUserSelect = 'none';

          draggingImg.style.pointerEvents = 'none';
          draggingImg.style.cursor = 'grabbing';
        }
      }

      if (!draggingImg) return;

      const dx = e.clientX - dragStartMouse.x;
      const dy = e.clientY - dragStartMouse.y;

      const next = clampImagePosition(
        draggingImg,
        dragStartPos.x + dx,
        dragStartPos.y + dy
      );

      pendingDragPos = next;

      if (dragRAF) return;

      dragRAF = requestAnimationFrame(() => {
        if (draggingImg && pendingDragPos) {
          setImagePosition(draggingImg, pendingDragPos.x, pendingDragPos.y);
        }
        dragRAF = null;
      });
    });

    document.addEventListener('mouseup', () => {
      if (dragRAF) {
        cancelAnimationFrame(dragRAF);
        dragRAF = null;
      }

      if (draggingImg) {
        draggingImg.style.pointerEvents = 'auto';
        draggingImg.style.cursor = 'grab';
      }

      document.body.style.userSelect = '';
      document.body.style.webkitUserSelect = '';

      draggingImg = null;
      dragCandidate = null;
      pendingDragPos = null;
      isPainting = false;
    });

    maskCanvas.addEventListener('mousedown', e => {
      if (!paintMode) return;
      isPainting = true;
      const r = maskCanvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      maskCtx.beginPath();
      maskCtx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      maskCtx.fillStyle = 'white';
      maskCtx.fill();
      maskCtx.beginPath();
      maskCtx.moveTo(x, y);
    });

    maskCanvas.addEventListener('mousemove', e => {
      if (!isPainting) return;
      const r = maskCanvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      maskCtx.lineTo(x, y);
      maskCtx.lineWidth = brushSize;
      maskCtx.lineCap = 'round';
      maskCtx.strokeStyle = 'white';
      maskCtx.stroke();
      maskCtx.beginPath();
      maskCtx.moveTo(x, y);
    });

    maskCanvas.addEventListener('mouseup', () => isPainting = false);
    maskCanvas.addEventListener('mouseleave', () => isPainting = false);

    drawingBoard.addEventListener('click', (e) => {
      if (e.target === drawingBoard || e.target === maskCanvas) {
        clearSelection();
        hideLayerMenu();
      }
    });
  }

  function getRecommendedExportScale() {
    const base = Math.max(2, SCREEN_DPR);

    const ratios = droppedImages.map(({ element }) => {
      const displayW = element.offsetWidth || parseFloat(element.style.width) || 100;
      const naturalW = element.naturalWidth || displayW;
      return naturalW / displayW;
    }).filter(v => Number.isFinite(v) && v > 0);

    return Math.min(MAX_EXPORT_SCALE, Math.max(base, ...ratios));
  }

  function createExportCanvas(clip, scale = getRecommendedExportScale()) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(clip.w * scale));
    c.height = Math.max(1, Math.round(clip.h * scale));
    c.style.width = `${clip.w}px`;
    c.style.height = `${clip.h}px`;

    const ctx = c.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    return { c, ctx, scale };
  }

  async function exportCanvasToImage(type, options = {}) {
    const resolvedOptions = {
      download: true,
      toBuffer: false,
      previewText: type === 'mask' ? 'Mask' : type === 'combined' ? 'Composite' : 'Source',
      ...options
    };

    if (subCanvases.length > 0) {
      for (let i = 0; i < subCanvases.length; i++) {
        const clip = getClipFromRegion(subCanvases[i]);
        await exportSingleClip(type, clip, i, resolvedOptions);
      }
      return;
    }

    const fullClip = {
      x: 0,
      y: 0,
      w: drawingBoard.offsetWidth,
      h: drawingBoard.offsetHeight
    };

    await exportSingleClip(type, fullClip, null, resolvedOptions);
  }
  function getClipFromRegion(region) {
    return {
      x: region.x,
      y: region.y,
      w: region.w,
      h: region.h
    };
  }


  async function exportSingleClip(type, clip, index = null, options = {}) {
    const { c, ctx, scale } = createExportCanvas(clip);

    const finish = (filename, previewText) => {
      const url = c.toDataURL('image/png');
      const suffix = index !== null ? `_${index + 1}` : '';
      const label = `${previewText}${suffix}`;

      if (options.download) {
        download(url, `${filename}${suffix}_${Date.now()}.png`);
      }
      if (options.toBuffer) {
        emitExportToBuffer(url, label, clip, type, index);
      }
    };

    if (type === 'origin') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, clip.w, clip.h);
      const sortedItems = getSortedItems();
      await drawExportItemsInOrder(ctx, sortedItems, clip, scale);
      drawLabelsToCanvas(ctx, sortedItems, clip);
      finish('source', options.previewText || 'Source');
      return;
    }

    if (type === 'mask') {
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, clip.w, clip.h);
      ctx.drawImage(
        maskCanvas,
        clip.x * MASK_DPR,
        clip.y * MASK_DPR,
        clip.w * MASK_DPR,
        clip.h * MASK_DPR,
        0, 0, clip.w, clip.h
      );
      finish('mask', options.previewText || 'Mask');
      return;
    }

    if (type === 'combined') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, clip.w, clip.h);
      const sortedItems = getSortedItems();
      await drawExportItemsInOrder(ctx, sortedItems, clip, scale);

      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.drawImage(
        maskCanvas,
        clip.x * MASK_DPR,
        clip.y * MASK_DPR,
        clip.w * MASK_DPR,
        clip.h * MASK_DPR,
        0, 0, clip.w, clip.h
      );
      ctx.restore();

      drawLabelsToCanvas(ctx, sortedItems, clip);
      finish('composite', options.previewText || 'Composite');
    }
  }

  function emitExportToBuffer(url, previewText, clip, type, index = null) {
    const suffix = index !== null ? `_${index + 1}` : '';
    const ts = Date.now();

    const exportW = Math.max(1, Math.round(clip.w));
    const exportH = Math.max(1, Math.round(clip.h));

    const bufferClip = {
      nodeId: `canvas-export-${type}-${ts}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'image',
      thumbnailUrl: url,
      mediaUrl: url,
      filename: `${previewText}${suffix}`,
      name: `${previewText}${suffix}`,
      width: exportW,
      height: exportH,
      aspectRatio: exportW / exportH,
      source: 'canvas-export',
      exportType: type,
      createdAt: ts
    };

    window.dispatchEvent(
      new CustomEvent('canvas-export-to-buffer', {
        detail: { clips: [bufferClip] }
      })
    );
  }

  function download(url, name) {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

}

window.initCanvasDrag = initCanvasDrag;