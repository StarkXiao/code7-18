<template>
  <el-container class="layout">
    <el-aside width="210px" class="sidebar">
      <div class="logo">
        <el-icon :size="22" color="#4ea8ff"><Aim /></el-icon>
        <div>
          <div class="logo-title">井下定位安全</div>
          <div class="logo-sub">UWB SAFETY</div>
        </div>
      </div>
      <el-menu :default-active="route.path" router class="menu" background-color="transparent" text-color="#b6c6dd"
        active-text-color="#4ea8ff">
        <el-menu-item index="/dashboard"><el-icon><Monitor /></el-icon><span>调度大屏</span></el-menu-item>
        <el-menu-item index="/alarms">
          <el-icon><BellFilled /></el-icon><span>告警处置</span>
          <el-badge v-if="openCount > 0" :value="openCount" class="menu-badge" type="danger" />
        </el-menu-item>
        <el-menu-item index="/persons"><el-icon><User /></el-icon><span>井下人员</span></el-menu-item>
        <el-menu-item index="/zones"><el-icon><WarnTriangleFilled /></el-icon><span>电子围栏</span></el-menu-item>
        <el-menu-item index="/broadcasts"><el-icon><Microphone /></el-icon><span>广播联动</span></el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="header">
        <div class="header-title">{{ route.meta.title ?? '' }}</div>
        <div class="header-right">
          <el-tag :type="wsTagType" effect="dark" size="small" disable-transitions>
            <span class="ws-dot" :class="wsClass" />
            {{ wsText }}
          </el-tag>
          <el-dropdown @command="onCommand">
            <span class="user-chip">
              <el-icon><Avatar /></el-icon>
              {{ auth.user?.displayName ?? '未登录' }}
              <el-tag size="small" effect="plain" class="role-tag">{{ roleLabel }}</el-tag>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="logout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { useAuthStore } from '../stores/auth';
import { useRealtimeStore } from '../stores/realtime';
import { api } from '../api';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const realtime = useRealtimeStore();

const openCount = ref(0);

const roleLabel = computed(() => ({ admin: '管理员', dispatcher: '调度员', viewer: '只读' }[auth.user?.role ?? 'viewer'] ?? ''));
const wsText = computed(() => ({ open: '实时在线', connecting: '连接中…', closed: '连接断开' }[realtime.wsState]));
const wsTagType = computed(() => (realtime.wsState === 'open' ? 'success' : realtime.wsState === 'connecting' ? 'warning' : 'danger'));
const wsClass = computed(() => `ws-${realtime.wsState}`);

async function refreshCount() {
  try {
    const c = await api.openAlarmCount();
    openCount.value = c.open;
  } catch { /* ignore */ }
}

function onCommand(cmd: string) {
  if (cmd === 'logout') {
    auth.logout();
    void router.push('/login');
  }
}

onMounted(async () => {
  await auth.restore();
  await refreshCount();
  realtime.connect();
  setInterval(refreshCount, 10_000);
});
</script>

<style scoped>
.layout {
  height: 100vh;
}
.sidebar {
  background: var(--panel);
  border-right: 1px solid var(--line);
  padding: 12px 8px;
}
.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px 18px;
}
.logo-title {
  font-weight: 700;
  font-size: 15px;
}
.logo-sub {
  font-size: 10px;
  letter-spacing: 2px;
  color: var(--text-dim);
}
.menu {
  border-right: none;
}
.menu-badge {
  margin-left: auto;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--panel);
  border-bottom: 1px solid var(--line);
}
.header-title {
  font-size: 16px;
  font-weight: 600;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 18px;
}
.ws-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-right: 5px;
}
.ws-open {
  background: var(--ok);
}
.ws-connecting {
  background: var(--warn);
}
.ws-closed {
  background: var(--danger);
}
.user-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: var(--text-main);
  outline: none;
}
.role-tag {
  margin-left: 4px;
}
.main {
  background: var(--bg-dark);
  padding: 18px;
}
</style>
