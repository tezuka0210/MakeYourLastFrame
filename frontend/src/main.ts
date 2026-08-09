import './style.css'
import { createApp } from 'vue'
import App from './App.vue'
// 构图记录上报（附加功能，删掉这两行即可完全回退）
import { installCompositionRecorder } from './lib/compositionRecorder'

installCompositionRecorder()

createApp(App).mount('#app')
