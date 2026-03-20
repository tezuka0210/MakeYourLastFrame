<template>
  <div
    id="chart-wrapper"
    class="bg-white rounded shadow p-3 flex-1 min-h-0"
    style="position: relative;"
  >
    <svg ref="svgContainer" class="w-full h-full"></svg>
    <!-- 框选框（动态生成） -->
    <div
      v-if="selecting"
      class="selection-box"
      :style="{
        left: selectBox.left + 'px',
        top: selectBox.top + 'px',
        width: selectBox.width + 'px',
        height: selectBox.height + 'px'
      }"
    ></div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { workflowTypes } from '@/composables/useWorkflow'
import * as d3 from 'd3'

import {
  renderTree,
  updateVisibility,
  updateSelectionStyles
} from '@/lib/workflowGraph.js'

// ========== Props ==========
const props = defineProps({
  nodes: { type: Array, default: () => [] },
  selectedIds: { type: Array, default: () => [] }
})

// ========== Emits ==========
const emit = defineEmits([
  'update:selectedIds',
  'delete-node',
  'add-clip',
  'open-preview',
  'open-generation',
  'create-card',
  'toggle-collapse',
  'rename-node',
  'update-node-parameters',
  'refresh-node',
  'upload-media',
  'update-node-media-from-parent',
  'regenerate-node',
  'merge-nodes',
  'update:ungroup', // 新增：解组后更新节点列表
  'ungroup-node'    // 新增：解组事件
])

const graphEmit = (event, ...args) => {
  if (event === 'ungroup-node') {
    ungroupNodes(...args); // 解组事件直接触发拆分逻辑
  } else {
    emit(event, ...args);
  }
};

// ========== Refs ==========
const svgContainer = ref(null)
// 框选相关状态
const isCtrlPressed = ref(false) 
const selecting = ref(false) 
const selectBox = ref({ left: 0, top: 0, width: 0, height: 0 }) 
const selectStart = ref({ x: 0, y: 0 }) 

// 当前布局配置
const layoutConfig = ref({
  horizontalGap: 100,
  verticalGap: 120,
  colors: {
    image: null,
    video: null,
    audio: null
  }
})

// 提取 zoom/平移状态
function getCurrentViewState() {
  if (!svgContainer.value) return null

  const svg = d3.select(svgContainer.value)
  const zoomContainer = svg.select('.zoom-container')
  if (zoomContainer.empty()) return null

  const transform = zoomContainer.attr('transform')
  if (!transform) return null

  const scaleMatch = transform.match(/scale\(([^)]+)\)/)
  const translateMatch = transform.match(/translate\(([^,]+),([^)]+)\)/)

  if (scaleMatch && translateMatch) {
    return {
      k: parseFloat(scaleMatch[1]),
      x: parseFloat(translateMatch[1]),
      y: parseFloat(translateMatch[2])
    }
  }
  return null
}

// ========== 修复后的框选核心逻辑 ==========
// 1. 监听 Ctrl 键
function handleKeyDown(e) {
  if (e.ctrlKey) {
    isCtrlPressed.value = true
  }
}

function handleKeyUp(e) {
  if (!e.ctrlKey) {
    isCtrlPressed.value = false
    if (selecting.value) {
      handleMouseUp() // 松开Ctrl直接结束框选
    }
  }
}

// 2. 开始框选（绑定到整个SVG容器的mousedown，而非节点）
function handleSvgMouseDown(e) {
  // 只有按住Ctrl且是左键点击时，才触发框选
  if (isCtrlPressed.value && e.button === 0) {
    e.preventDefault() // 阻止默认拖拽/选中文本
    e.stopPropagation()

    // 记录起始坐标（相对于视口，不是SVG内部）
    selectStart.value = { x: e.clientX, y: e.clientY }
    // 初始化框选框位置
    selectBox.value = {
      left: selectStart.value.x,
      top: selectStart.value.y,
      width: 0,
      height: 0
    }
    selecting.value = true // 标记开始框选
  }
}

// 3. 拖动鼠标绘制框选框（绑定到window，避免鼠标移出SVG失效）
function handleWindowMouseMove(e) {
  if (!selecting.value) return

  e.preventDefault()
  // 实时计算框选框的位置和尺寸（兼容任意方向拖拽）
  const x = e.clientX
  const y = e.clientY
  selectBox.value.left = Math.min(x, selectStart.value.x)
  selectBox.value.top = Math.min(y, selectStart.value.y)
  selectBox.value.width = Math.abs(x - selectStart.value.x)
  selectBox.value.height = Math.abs(y - selectStart.value.y)
}

// 4. 结束框选（松开左键）
function handleMouseUp() {
  if (!selecting.value) return

  selecting.value = false
  // 检测框选范围内的节点
  const selectedNodeIds = getNodesInSelectionBox()
  
  console.log('[WorkflowTree] 框选节点ID：', selectedNodeIds) // 调试用

  if (selectedNodeIds.length > 0) {
    emit('update:selectedIds', selectedNodeIds)
    
    // 选中≥2个节点时触发合并
    if (selectedNodeIds.length >= 2) {
      mergeSelectedNodes(selectedNodeIds)
    }
  }
}

function getNodesInSelectionBox() {
  if (!svgContainer.value) return []

  const box = selectBox.value
  const selectedIds = []
  const svgEl = svgContainer.value

  // 选择所有带 data-id 的 .node 元素（精准匹配）
  const nodeElements = d3.select(svgEl).selectAll('.node[data-id]').nodes()

  nodeElements.forEach(el => {
    const rect = el.getBoundingClientRect()
    // 碰撞检测
    const isInBox = 
      rect.left < box.left + box.width &&
      rect.right > box.left &&
      rect.top < box.top + box.height &&
      rect.bottom > box.top

    if (isInBox) {
      // 直接从 data-id 提取 ID（和 workflowGraph.js 中的 d.id 一致）
      const nodeId = el.getAttribute('data-id')
      if (nodeId) {
        selectedIds.push(nodeId)
      }
    }
  })

  return selectedIds
}

// WorkflowTree.vue 中（mergeSelectedNodes 方法上方）
// 辅助方法：合并节点的 assets 字段（前端临时使用，不影响数据库）
function mergeNodeAssets(assetsList) {
  // 初始化合并后的 assets（适配你的数据结构）
  const mergedAssets = {
    input: { images: [], videos: [], audio: [] },
    output: { images: [], videos: [], audio: [] }
  };

  // 遍历所有选中节点的 assets，合并到一起
  assetsList.forEach(assets => {
    if (!assets) return;

    // 合并 input 部分
    if (assets.input) {
      mergedAssets.input.images = [...mergedAssets.input.images, ...(assets.input.images || [])];
      mergedAssets.input.videos = [...mergedAssets.input.videos, ...(assets.input.videos || [])];
      mergedAssets.input.audio = [...mergedAssets.input.audio, ...(assets.input.audio || [])];
    }

    // 合并 output 部分
    if (assets.output) {
      mergedAssets.output.images = [...mergedAssets.output.images, ...(assets.output.images || [])];
      mergedAssets.output.videos = [...mergedAssets.output.videos, ...(assets.output.videos || [])];
      mergedAssets.output.audio = [...mergedAssets.output.audio, ...(assets.output.audio || [])];
    }
  });

  return mergedAssets;
}

function mergeSelectedNodes(selectedNodeIds) {
  const selectedNodes = props.nodes.filter(node => 
    selectedNodeIds.includes(node.id)
  );

  if (selectedNodes.length < 2) return;

  // 1. 复用原节点的 originalParents（数据库字段）
  const originalParents = selectedNodes[0].originalParents || null;
  const allNodes = props.nodes;
  const inheritedChildIds = [];
  
  allNodes.forEach(node => {
    if (node.originalParents) {
      const hasParentInSelection = node.originalParents.some(pid => 
        selectedNodeIds.includes(pid)
      );
      if (hasParentInSelection) {
        inheritedChildIds.push(node.id);
      }
    }
  });
  const childrenIds = Array.from(new Set(inheritedChildIds));

  // 【关键补充】添加 combinedNodes 字段，存储原始节点完整数据
  const mergedNode = {
    id: `composite_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    originalParents: originalParents,
    module_id: 'composite',
    created_at: new Date().toISOString(),
    status: 'completed',
    media: null,
    parameters: {
      composite_nodes: selectedNodes, // 同步到 parameters
      global_context: ''
    },
    isComposite: true,
    sourceNodeIds: selectedNodeIds,
    combinedNodes: selectedNodes, // 【新增】存储原始节点完整数据
    childrenIds: childrenIds,
    label: `复合节点 (${selectedNodes.length}个节点)`,
    assets: mergeNodeAssets(selectedNodes.map(n => n.assets || {})),
    linkColor: '#409eff',
    _collapsed: false
  };

  emit('merge-nodes', {
    originalNodeIds: selectedNodeIds,
    mergedNode: mergedNode
  });

  emit('update:selectedIds', [mergedNode.id]);
}


function ungroupNodes(compositeNodeId) {
  // 1. 找到目标复合节点（原有逻辑保留）
  const compositeNode = props.nodes.find(node => node.id === compositeNodeId);
  console.log('待拆分的复合节点：', compositeNode);
  if (!compositeNode || compositeNode.isComposite !== true) {
    console.warn('无效的复合节点：', compositeNodeId);
    return;
  }

  // 2. 读取原始节点数据（原有逻辑保留）
  let originalNodes = compositeNode.combinedNodes || [];
  if (!originalNodes || originalNodes.length === 0) {
    originalNodes = compositeNode?.parameters?.composite_nodes || [];
  }
  if (!originalNodes || originalNodes.length === 0) {
    console.warn('复合节点无原始节点数据：', compositeNodeId);
    return;
  }
  const originalNodeIds = originalNodes.map(n => n.id);
  console.log('待恢复的原始节点ID：', originalNodeIds);

  // 3. 恢复原始节点状态（原有逻辑保留）
  const restoredNodes = originalNodes.map(node => ({
    ...node,
    isComposite: false, // 关键：取消「被组合」标记
    originalParents: node.originalParents || compositeNode.originalParents,
    childrenIds: node.childrenIds || compositeNode.childrenIds,
    calculatedWidth: node.calculatedWidth || compositeNode.calculatedWidth,
    calculatedHeight: node.calculatedHeight || compositeNode.calculatedHeight,
    _cardType: node._cardType || compositeNode._cardType
  }));

  // 4. 构造新的节点列表（原有逻辑保留）
  const newNodes = props.nodes
    .filter(node => node.id !== compositeNodeId) // 删除复合节点
    .map(node => {
      const restoredNode = restoredNodes.find(n => n.id === node.id);
      return restoredNode || node; // 覆盖原有节点（恢复 isCombined: false）
    })
    .concat(restoredNodes.filter(n => !props.nodes.some(node => node.id === n.id))); // 补充缺失的原始节点

  // ========== 新增：触发界面刷新 ==========
  if (svgContainer.value) {
    // 方式1：强制重新渲染（推荐，确保布局更新）
    const viewState = getCurrentViewState(); // 保留缩放/平移状态
    renderTree(
      svgContainer.value,
      newNodes, // 传入新的节点列表
      originalNodeIds, // 选中恢复后的原始节点
      graphEmit,
      workflowTypes,
      viewState,
      layoutConfig.value
    );
    // 方式2：兜底刷新可见性（备用）
    updateVisibility(svgContainer.value, newNodes);
  }

  // 5. 通知父组件更新（原有逻辑保留）
  emit('update:ungroup', {
    compositeNodeId,
    originalNodeIds,
    newNodes
  });
  emit('update:selectedIds', originalNodeIds);
}


// ========== 布局更新 + 生命周期 ==========
function handleLayoutUpdated(event) {
  const detail = event.detail || {}
  layoutConfig.value = {
    horizontalGap: detail.horizontalGap ?? layoutConfig.value.horizontalGap,
    verticalGap: detail.verticalGap ?? layoutConfig.value.verticalGap,
    colors: {
      image: detail.colors?.image ?? layoutConfig.value.colors.image,
      video: detail.colors?.video ?? layoutConfig.value.colors.video,
      audio: detail.colors?.audio ?? layoutConfig.value.colors.audio
    }
  }

  if (!svgContainer.value) return
  const viewState = getCurrentViewState()
  renderTree(
    svgContainer.value,
    props.nodes,
    props.selectedIds,
    graphEmit,
    workflowTypes,
    viewState,
    layoutConfig.value
  )
}

onMounted(() => {
  if (!svgContainer.value) return

  // 布局更新监听
  window.addEventListener('t2v-layout-updated', handleLayoutUpdated)
  
  // 键盘监听（Ctrl键）
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keyup', handleKeyUp)
  
  // ===== 修复核心：事件绑定到SVG容器，而非节点 =====
  const svgEl = svgContainer.value
  // 开始框选：绑定到整个SVG容器的mousedown
  svgEl.addEventListener('mousedown', handleSvgMouseDown)
  // 拖动绘制：绑定到window（避免鼠标移出SVG失效）
  window.addEventListener('mousemove', handleWindowMouseMove)
  // 结束框选：绑定到window（避免鼠标移出SVG失效）
  window.addEventListener('mouseup', handleMouseUp)

  // 初次渲染
  renderTree(
    svgContainer.value,
    props.nodes,
    props.selectedIds,
    graphEmit,
    workflowTypes,
    null,
    layoutConfig.value
  )
})

onBeforeUnmount(() => {
  // 移除所有监听，避免内存泄漏
  window.removeEventListener('t2v-layout-updated', handleLayoutUpdated)
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('keyup', handleKeyUp)
  
  if (svgContainer.value) {
    svgContainer.value.removeEventListener('mousedown', handleSvgMouseDown)
  }
  window.removeEventListener('mousemove', handleWindowMouseMove)
  window.removeEventListener('mouseup', handleMouseUp)
})

// ========== 原有Watcher逻辑（保留不变） ==========
function isAssetsEqual(newAssets, oldAssets) {
  if (!newAssets && !oldAssets) return true
  if (!newAssets || !oldAssets) return false
  const inputEqual = isMediaGroupEqual(newAssets.input, oldAssets.input)
  const outputEqual = isMediaGroupEqual(newAssets.output, oldAssets.output)
  return inputEqual && outputEqual
}

function isMediaGroupEqual(newGroup, oldGroup) {
  if (!newGroup && !oldGroup) return true
  if (!newGroup || !oldGroup) return false
  const imagesEqual = arraysEqual(newGroup.images || [], oldGroup.images || [])
  const videosEqual = arraysEqual(newGroup.videos || [], oldGroup.videos || [])
  const audioEqual = arraysEqual(newGroup.audio || [], oldGroup.audio || [])
  return imagesEqual && videosEqual && audioEqual
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

watch(
  () => props.nodes,
  (newNodes, oldNodes) => {
    if (!svgContainer.value) return
    let structureChanged = false
    if (!oldNodes || newNodes.length !== oldNodes.length) {
      structureChanged = true
    } else {
      const oldNodeMap = new Map(oldNodes.map(n => [n.id, n]))
      for (const newNode of newNodes) {
        if (!oldNodeMap.has(newNode.id)) {
          structureChanged = true
          break
        }
      }
      if (!structureChanged) {
        for (const newNode of newNodes) {
          const oldNode = oldNodeMap.get(newNode.id)
          if (!oldNode) {
            structureChanged = true
            break
          }
          if (newNode.module_id !== oldNode.module_id) {
            structureChanged = true
            break
          }
          if (!isAssetsEqual(newNode.assets, oldNode.assets)) {
            structureChanged = true
            break
          }
        }
      }
    }
    if (structureChanged) {
      const viewState = getCurrentViewState()
      renderTree(
        svgContainer.value,
        newNodes,
        props.selectedIds,
        graphEmit,
        workflowTypes,
        viewState,
        layoutConfig.value
      )
    } else {
      updateVisibility(svgContainer.value, newNodes)
    }
  },
  { deep: true }
)

watch(
  () => props.selectedIds,
  (ids) => {
    if (svgContainer.value) {
      updateSelectionStyles(svgContainer.value, ids)
    }
  },
  { deep: true }
)
</script>

<style scoped>
.selection-box {
  position: fixed;
  border: 1px solid #409eff;
  background-color: rgba(64, 158, 255, 0.1);
  pointer-events: none;
  z-index: 9999;
}

/* Ctrl按下时鼠标变成十字，提示可框选 */
svg {
  cursor: default;
}
svg:active:has(.selection-box),
svg:hover:has(.selection-box) {
  cursor: crosshair;
}
</style>