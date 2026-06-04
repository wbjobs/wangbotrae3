import { createRouter, createWebHistory } from 'vue-router'
import WorkspacePage from '@/pages/WorkspacePage.vue'
import HistoryPage from '@/pages/HistoryPage.vue'

const routes = [
  {
    path: '/',
    name: 'workspace',
    component: WorkspacePage,
  },
  {
    path: '/history',
    name: 'history',
    component: HistoryPage,
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
