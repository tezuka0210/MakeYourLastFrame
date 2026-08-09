// 构图记录上报（附加功能）
//
// 监听 canvasDrag 在导出取景框时派发的 canvas-composition-record 事件，
// 把构图记录发到后端 /api/composition/record 存档。
//
// 完全独立：删除本文件与 main.ts 中的那两行，系统行为与之前一致。
// 上报失败只在控制台留一条警告，不影响导出、不影响 buffer、不阻塞界面。

interface CompositionRecordDetail {
  bufferNodeId?: string;
  nodeId?: string;
  imageUrl?: string;
  composition?: unknown;
}

interface RecorderOptions {
  getTreeId?: () => number | null;
}

const API_BASE: string =
  (typeof window !== 'undefined' && (window as any).API_BASE) || 'http://localhost:5005';

let installed = false;

export function installCompositionRecorder(options: RecorderOptions = {}): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const getTreeId = typeof options.getTreeId === 'function' ? options.getTreeId : () => null;

  window.addEventListener('canvas-composition-record', (event: Event) => {
    const detail = (event as CustomEvent<CompositionRecordDetail>).detail;
    if (!detail?.composition) return;

    const body = {
      tree_id: getTreeId(),
      node_id: detail.nodeId ?? null,
      buffer_node_id: detail.bufferNodeId ?? null,
      // 不回传 dataURL 图片本体，避免请求过大；只记录构图结构
      image_url: null,
      composition: detail.composition
    };

    fetch(`${API_BASE}/api/composition/record`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true
    }).catch(err => {
      console.warn('Failed to report composition record (export is unaffected):', err);
    });
  });
}
