import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import LoginPage from '../pages/LoginPage.vue';
import AppLayout from '../components/AppLayout.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: LoginPage, meta: { public: true } },
    {
      path: '/',
      component: AppLayout,
      children: [
        { path: '', redirect: '/dashboard' },
        { path: 'dashboard', component: () => import('../pages/DashboardPage.vue'), meta: { title: '调度大屏' } },
        { path: 'alarms', component: () => import('../pages/AlarmsPage.vue'), meta: { title: '告警处置' } },
        { path: 'persons', component: () => import('../pages/PersonsPage.vue'), meta: { title: '井下人员' } },
        { path: 'persons/:tagId', component: () => import('../pages/PersonDetailPage.vue'), meta: { title: '人员详情' } },
        { path: 'zones', component: () => import('../pages/ZonesPage.vue'), meta: { title: '电子围栏' } },
        { path: 'broadcasts', component: () => import('../pages/BroadcastsPage.vue'), meta: { title: '广播联动' } },
      ],
    },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (auth.token && !auth.user) await auth.restore();
  if (!to.meta.public && !auth.isLoggedIn) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }
  if (to.path === '/login' && auth.isLoggedIn) return { path: '/dashboard' };
  return true;
});
