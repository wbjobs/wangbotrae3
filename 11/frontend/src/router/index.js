import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'Home',
    component: () => import('@/views/HomeView.vue')
  },
  {
    path: '/host',
    name: 'Host',
    component: () => import('@/views/HostView.vue')
  },
  {
    path: '/host/room/:roomId',
    name: 'HostRoom',
    component: () => import('@/views/HostRoomView.vue')
  },
  {
    path: '/viewer',
    name: 'Viewer',
    component: () => import('@/views/ViewerView.vue')
  },
  {
    path: '/viewer/room/:roomId',
    name: 'ViewerRoom',
    component: () => import('@/views/ViewerRoomView.vue')
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
