<template>
  <!-- 外层容器 -->
  <div class="container">
    <section class="session-card">
      <!-- 头部区域 -->
      <div class="card-header">
        <div class="header-top">
          <h2 class="header-title">
            Projects
          </h2>
          <span class="session-count">{{ sessions.length }} {{ sessions.length === 1 ? 'session' : 'sessions' }}</span>
        </div>

        <!-- 新建按钮 - 添加点击状态绑定 -->
        <button
          @click="() => { createNewSession(); isNewSessionBtnClicked = true; }"
          type="button"
          class="new-session-btn"
          :class="{ 'clicked': isNewSessionBtnClicked }"
          title="New Project"
        >
          <div class="btn-content">
            <svg class="btn-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14M5 12h14"></path>
            </svg>
            <span class="btn-text">New Project</span>
          </div>
        </button>
      </div>

      <!-- 列表区域 -->
      <div class="session-list">
        <!-- 无数据状态 -->
        <div class="empty-state" v-if="sessions.length === 0">
          <svg class="empty-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path>
          </svg>
          <p class="empty-title">No sessions yet</p>
          <p class="empty-desc">Click "New Session" to create your first session</p>
        </div>

        <!-- 会话列表项 -->
        <div
          v-for="session in sessions"
          :key="session.id"
          @click="selectSession(session.id)"
          :class="['session-item', { 'active': currentSessionId === session.id }]"
        >
          <span class="status-dot"></span>
          <p class="session-title">{{ session.title }}</p>
          <span 
            class="delete-btn"
            @click.stop="deleteSession(session.id)"
            title="Delete session"
          >
            <svg class="delete-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
            </svg>
          </span>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

// 定义会话类型接口
interface Session {
  id: number;
  title: string;
}

// 模拟数据
const sessions = ref<Session[]>([
  { id: 1, title: 'New Session'},
  { id: 2, title: 'Guqin' },
  { id: 3, title: 'Three colored camel figurines carrying music' }
  //{ id: 3, title: 'New Exploration' }
])

const currentSessionId = ref<number>(1)
// 添加按钮点击状态
const isNewSessionBtnClicked = ref<boolean>(false)

// 选择会话
function selectSession(id: number) {
  currentSessionId.value = id
}

// 创建新会话
function createNewSession() {
  const newId = Date.now()
  sessions.value.unshift({
    id: newId,
    title: 'New Session'
  })
  currentSessionId.value = newId
  console.log(`createNewSession`,sessions.value)
  
  // 滚动到顶部
  setTimeout(() => {
    const container = document.querySelector('.session-list')
    if (container) {
      container.scrollTop = 0
    }
  }, 100)
}

// 删除会话
function deleteSession(id: number) {
  // 不能删除最后一个会话
  if (sessions.value.length <= 1) return
  
  const index = sessions.value.findIndex(session => session.id === id)
  if (index !== -1) {
    sessions.value.splice(index, 1)
    
    if (currentSessionId.value === id && sessions.value.length > 0) {
      const firstSession = sessions.value[0]
      if (firstSession) {
        currentSessionId.value = firstSession.id
      }
    }
  }
}
</script>

<style scoped>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  font-family: Inter, "SF Pro Text", "Segoe UI", Roboto, Arial, sans-serif;
}

.container {
  width: 100%;
  height: 100%;
  min-height: 0;
}

.session-card {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #f7f7f8;
  border: 1px solid #e5e7eb;
  border-radius: 16px;
  overflow: hidden;
}

.card-header {
  padding: 12px 12px 10px;
  border-bottom: 1px solid #eceef1;
  background: #f7f7f8;
}

.header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.header-title {
  font-size: 13px;
  font-weight: 700;
  color: #2f3946;
}

.session-count {
  font-size: 11px;
  font-weight: 600;
  color: #8b95a5;
  background: #f1f3f5;
  border: 1px solid #e3e7ec;
  padding: 3px 8px;
  border-radius: 999px;
}

.new-session-btn {
  width: 100%;
  min-height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #d9dee5;
  border-radius: 12px;
  background: #fbfbfc;
  color: #5b6575;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.new-session-btn:hover {
  background: #ffffff;
  border-color: #cfd6de;
}

.btn-content {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-icon {
  width: 15px;
  height: 15px;
  color: #7b8798;
}

.btn-text {
  font-size: 13px;
  font-weight: 600;
}

.session-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.session-list::-webkit-scrollbar {
  width: 6px;
}

.session-list::-webkit-scrollbar-track {
  background: transparent;
}

.session-list::-webkit-scrollbar-thumb {
  background: #d2d7de;
  border-radius: 999px;
}

.session-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 36px;
  padding: 8px 10px;
  border-radius: 10px;
  border: none;
  background: transparent;
  color: #6b7280;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.session-item:hover {
  background: #f0f2f5;
}

.session-item.active {
  background: #ececec;
  color: #1f2937;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #c7ced8;
  flex-shrink: 0;
}

.session-item.active .status-dot {
  background: #4b5563;
}

.session-title {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.35;
  word-break: break-word;
}

.delete-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  opacity: 0;
  color: #8a94a6;
  background: transparent;
  transition: opacity 0.15s ease, background 0.15s ease;
}

.session-item:hover .delete-btn,
.session-item.active .delete-btn {
  opacity: 1;
}

.delete-btn:hover {
  background: #e8ebef;
}

.delete-icon {
  width: 14px;
  height: 14px;
}

.empty-state {
  min-height: 96px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: #9aa3b2;
  text-align: center;
  padding: 12px;
}

.empty-icon {
  width: 24px;
  height: 24px;
  margin-bottom: 6px;
  opacity: 0.65;
}

.empty-title {
  font-size: 12px;
  font-weight: 600;
}

.empty-desc {
  margin-top: 4px;
  font-size: 11px;
  line-height: 1.35;
}
</style>