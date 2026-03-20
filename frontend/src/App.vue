<template>
  <div class="app-container">
    <!-- 顶部标题栏 -->
    <header class="title-bar">
      <div class="title-main">
        <h1>T2VTree Visual Analytics System</h1>
      </div>
    </header>

    <!-- 三列外壳 -->
    <div class="app-shell">
      <!-- 左列：会话 + 全局参数 -->
      <aside class="col col-left">
        <LeftPane />
      </aside>

      <!-- 中列：上树，下拼接 -->
      <main class="col col-center">
        <div class="center-top">
          <WorkflowTree
            class="tree-wrapper"
            :nodes="viewNodes"
            v-model:selectedIds="selectedParentIds"
            @delete-node="handleDeleteNode"
            @add-clip="addClipToStitch"
            @open-preview="openPreview"
            @open-generation="handleOpenGenerationPopover"
            @toggle-collapse="toggleNodeCollapse"
            @create-card="createCard"
            @refresh-node="handleRefreshNode"
            @upload-media="updateNodeMedia"
            @regenerate-node="handleGenerate"
            @merge-nodes="handleMergeNodes"
            @update:ungroup="handleUngroup"
          />
        </div>

        <div class="center-bottom">
          <StitchingPanel
            :clips="stitchingClips"
            :audioClips="audioClips"
            :bufferClips="bufferClips"
            :is-stitching="isStitching"
            :stitch-result-url="stitchResultUrl"
            @update:clips="handleClipsUpdate"
            @update:bufferClips="handleBufferUpdate"
            @update:audioClips="handleAudioUpdate"
            @remove-clip="removeClipFromStitch"
            @remove-audio-clip="removeClipFromAudio"
            @stitch="onStitchRequest"
          />
        </div>
      </main>

      <!-- 右列：显示绘画面板（核心修改：宽度从 0 改为 360px） -->
      <aside class="col col-right">
        <RightPane />
      </aside>
    </div>

    <!-- 预览弹窗 -->
    <PreviewModal
      v-if="isPreviewOpen"
      :url="previewMedia.url"
      :type="previewMedia.type"
      @close="closePreview"
    />

    <!-- 生成配置弹窗 -->
    <GenerationPopover
      v-if="isGenerationPopoverOpen"
      :selected-ids="selectedParentIds"
      :is-generating="isGenerating"
      :initial-module-id="initialModuleIdForPopover"
      :initial-workflow-type="initialWorkflowTypeForPopover"
      @close="isGenerationPopoverOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch, computed } from 'vue'

import {
  useWorkflow,
  type AppNode,
  type CompositeNode,
  type StitchingClip,
  type BufferClip,     
  type AudioClip      
} from '@/composables/useWorkflow'

import { buildWorkflowView } from '@/lib/workflowLayout'

import WorkflowTree from './components/WorkflowTree.vue'
import StitchingPanel from './components/StitchingPanel.vue'
import PreviewModal from './components/PreviewModal.vue'
import GenerationPopover from './components/GenerationPopover.vue'

import LeftPane from './components/LeftPane.vue'
import RightPane from './components/RightPane.vue'

// ===== 先补充类型定义（放在 script 开头）=====
interface MergeNodesPayload {
  originalNodeIds: string[]; // 要删除的原节点ID
  mergedNode: AppNode;       // 合并后的新节点
}

// 补充复合节点的类型定义（适配你的 AppNode）
interface CompositeNode extends AppNode {
  isComposite: boolean;
  sourceNodeIds: string[];
  parentId: string | null;
  childrenIds: string[];
}


const {
  statusText,
  allNodes,
  selectedParentIds,
  stitchingClips,
  audioClips,
  bufferClips,
  isGenerating,
  isStitching,
  isPreviewOpen,
  previewMedia,

  loadAndRender,
  handleGenerate,
  handleFileUpload,
  handleDeleteNode,
  addClipToStitch,
  removeClipFromStitch,
  removeClipFromAudio,
  handleStitchRequest,
  openPreview,
  closePreview,
  toggleNodeCollapse,
  updateNodeMedia,
} = useWorkflow()

// ⭐ 把 AppNode[] → ViewNode[]（带 cardType/title/isInit 的视图节点）
const viewNodes = computed(() => buildWorkflowView(allNodes.value))

function handleClipsUpdate(newList: StitchingClip[]) {
  stitchingClips.splice(0, stitchingClips.length, ...newList)
}

function handleBufferUpdate(newList: BufferClip[]) {
  bufferClips.splice(0, bufferClips.length, ...newList)
}

function handleAudioUpdate(newList: AudioClip[]) {
  audioClips.splice(0, audioClips.length, ...newList)
}



watch(
  selectedParentIds,
  (newIds) => {
    console.log(
      '%c[App] selectedParentIds updated',
      'color:#FF69B4;font-weight:bold;',
      newIds,
    )
  },
  { deep: true }
)

const stitchResultUrl = ref<string | null>(null)

async function onStitchRequest() {
  stitchResultUrl.value = null
  const resultUrl = await handleStitchRequest()
  if (resultUrl) {
    stitchResultUrl.value = resultUrl
  }
}

/**
 * 处理 Init 节点的直接生成请求
 * @param {Object} parentNode - Init 节点对象
 * @param {String} moduleId - 要生成的模块ID (这里是 'textFull')
 */
const createCard = async (parentNode: AppNode, moduleId: string) => {
  console.log(`[App] 收到直接生成请求: Parent=${parentNode.id}, Module=${moduleId}`);
  const newNodeId = crypto.randomUUID();
  selectedParentIds.value = [parentNode.id];
  const defaultParams = {};
  await handleGenerate(newNodeId,moduleId, defaultParams,moduleId);
  selectedParentIds.value = []; 
}

const handleRefreshNode = (nodeId: string, newModuleId: string, updatedParams: Record<string, any>,title: Record<string, any>) => {
  // 找到需要刷新的节点并修改其数据（触发响应式更新）
  allNodes.value = allNodes.value.map(node => {
    if (node.id === nodeId) {
      // 同时更新模块ID和参数
      return {
        ...node,
        module_id: newModuleId,       // 更新模块类型
        title:title,
        parameters: updatedParams  // 更新参数
      };
    }
    return node;
  });
};

const isGenerationPopoverOpen = ref(false)
const initialModuleIdForPopover = ref<string | null>(null)
const initialWorkflowTypeForPopover = ref<'preprocess' | 'image' | 'video' | null>(null)

function handleOpenGenerationPopover(
  node: AppNode,
  defaultModuleId: string,
  workflowType: 'preprocess' | 'image' | 'video'
) {
  if (!selectedParentIds.value.includes(node.id)) {
    if (selectedParentIds.value.length < 2) {
      selectedParentIds.value = [...selectedParentIds.value, node.id]
    } else {
      alert('Max 2 parents selected. Opening popover with current selection.')
    }
  }
  initialModuleIdForPopover.value = defaultModuleId
  initialWorkflowTypeForPopover.value = workflowType
  isGenerationPopoverOpen.value = true
}

// 1. 确保定义响应式的 selectedIds（如果未定义，补充这行）
const selectedIds = ref([]); 


function handleMergeNodes({ originalNodeIds, mergedNode }: MergeNodesPayload) {
  // 1. 删除原节点
  allNodes.value = allNodes.value.filter(node => !originalNodeIds.includes(node.id));

  // 2. 更新父节点的 childrenIds（前端临时字段，不碰数据库）
  if (mergedNode.originalParents && mergedNode.originalParents.length > 0) {
    mergedNode.originalParents.forEach(parentId => {
      const parentNode = allNodes.value.find(n => n.id === parentId);
      if (parentNode) {
        parentNode.childrenIds = parentNode.childrenIds || [];
        parentNode.childrenIds = parentNode.childrenIds
          .filter(id => !originalNodeIds.includes(id)) // 删掉原节点
          .concat(mergedNode.id); // 加上复合节点
      }
    });
  }

  // 3. 【关键】更新子节点的 originalParents（数据库字段，前端内存修改）
  if (mergedNode.childrenIds && mergedNode.childrenIds.length > 0) {
    allNodes.value = allNodes.value.map(node => {
      if (mergedNode.childrenIds.includes(node.id)) {
        // 子节点的父节点 → 改为复合节点ID
        return {
          ...node,
          originalParents: [mergedNode.id] // 完全对齐数据库字段结构
        };
      }
      return node;
    });
  }

  // 4. 添加复合节点
  allNodes.value.push(mergedNode);
  selectedParentIds.value = [mergedNode.id];

  console.log('✅ 复合节点：', mergedNode.id, '子节点：', mergedNode.childrenIds);
}



// App.vue 中的 handleUngroup 函数
const handleUngroup = (compositeNode) => {
  console.log('开始拆分复合节点:', compositeNode.id);

  // 1. 获取原 Group 内部的节点 ID 列表
  // 假设你的复合节点对象里存了原始节点 ID，比如在 combinedNodes 属性里
  const innerNodeIds = compositeNode.combinedNodes || []; 

  // 2. 核心修复：遍历所有节点，修复类别 3 节点的父引用
  viewNodes.value.forEach(node => {
    if (node.originalParents && node.originalParents.includes(compositeNode.id)) {
      // 将父引用从 'composite_xxx' 替换回原来的节点 ID
      // 注意：这里需要知道该子节点原本是连在 Group 内哪个具体节点上的
      // 如果你的数据结构里没存，最简单的方法是找到原本指向 compositeNode 的位置并更新它
      
      node.originalParents = node.originalParents.map(pId => {
        if (pId === compositeNode.id) {
          // 这里需要逻辑找到原始父节点。
          // 如果 compositeNode 记录了它的“出口节点”（Last Node），就换成那个 ID
          // 如果逻辑较复杂，可以临时恢复为 innerNodeIds 的最后一个
          return compositeNode.lastInternalNodeId || innerNodeIds[innerNodeIds.length - 1];
        }
        return pId;
      });
    }
  });

  // 3. 将内部节点的 isCombined 状态设为 false，让它们重新显示
  viewNodes.value.forEach(node => {
    if (innerNodeIds.includes(node.id)) {
      node.isComposite = false;
      // 如果你在 Group 时修改了内部节点的 parents，也要在这里恢复
    }
  });

  // 4. 从列表中移除复合节点
  viewNodes.value = viewNodes.value.filter(n => n.id !== compositeNode.id);
  
  console.log('解组完成，节点指向已修复');
};

onMounted(() => {
  loadAndRender()
})
</script>

<style>
html, body, #app {
  height: 100%;
  margin: 0;
  background: #f3f4f6;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
}

:root {
  --shell-gap: 8px;
  --left-col-w: 320px;
  /* 核心修改：右侧列宽度从 0px 改为 360px（可根据需要调整） */
  --right-col-w: 360px; 
}

.app-container {
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* 顶部：固定占 4% 高度 */
.title-bar {
  flex: 0 0 4%;
  min-height: 32px;          /* 避免窗口太小的时候压扁 */
  max-height: 56px;          /* 不要太高 */
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  box-sizing: border-box;
  background: #ffffffee;
  border-bottom: 1px solid #e5e7eb;
  backdrop-filter: blur(8px);
}

.title-main h1 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;

  background-image: linear-gradient(
    80deg,
    #5A8CCD,  /* 深蓝（Image） */
    #4FB488,  /* 深青绿（Video） */
    #F3A953,  /* 深橙黄（Text） */
    #D87474   /* 深玫瑰红（Audio） */
  );
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  text-shadow: 0 0 1px rgba(0,0,0,0.15);
}

.title-main p {
  margin: 0;
  font-size: 11px;
  color: #9ca3af;
}

/* 下方三列区域：占剩余 96% 高度 */
.app-shell {
  flex: 1 1 96%;
  min-height: 0; /* 允许内部滚动 */
  display: grid;
  grid-template-columns: var(--left-col-w) minmax(0, 1fr) var(--right-col-w);
  gap: var(--shell-gap);
  padding: var(--shell-gap);
  box-sizing: border-box;
  align-items: stretch;
  overflow: hidden;
}

/* 三列通用卡片样式 */
.col {
  background: #ffffff;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.04), 0 8px 18px rgba(15, 23, 42, 0.06);
}

.col-left {
  box-sizing: border-box;
}

.col-center {
  padding: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* 中间列上下区域 */
.center-top {
  flex: 1 1 0;
  min-height: 0;
  padding: 8px 8px 6px;
  box-sizing: border-box;
  border-bottom: 1px solid #f3f4f6;
  display: flex;
  flex-direction: column;
}

.tree-wrapper {
  flex: 1;
  min-height: 0;
}

.center-bottom {
  padding: 4px 8px;
  box-sizing: border-box;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* 补充：右侧列样式，确保内部内容能滚动 */
.col-right {
  box-sizing: border-box;
  padding: 0; /* 让 RightPane 自己控制内边距 */
  overflow-y: auto; /* 内容超出时滚动 */
}
</style>