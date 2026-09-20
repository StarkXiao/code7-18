<template>
  <div class="login-wrap">
    <div class="login-card">
      <div class="brand">
        <el-icon :size="34" color="#4ea8ff"><Aim /></el-icon>
        <h1>井下人员定位安全系统</h1>
        <p>UWB 精确定位 · 电子围栏 · 静止监测 · 广播联动</p>
      </div>

      <el-form :model="form" @submit.prevent="submit" class="form">
        <el-form-item>
          <el-input v-model="form.username" placeholder="用户名" size="large" :prefix-icon="User" />
        </el-form-item>
        <el-form-item>
          <el-input v-model="form.password" type="password" placeholder="密码" size="large" show-password
            :prefix-icon="Lock" @keyup.enter="submit" />
        </el-form-item>
        <el-button type="primary" size="large" class="submit" :loading="loading" @click="submit">
          登 录
        </el-button>
      </el-form>

      <div class="hint">
        演示账号：admin / dispatcher / viewer，密码均为 <code>admin123</code>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { User, Lock } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const loading = ref(false);
const form = reactive({ username: '', password: '' });

async function submit() {
  if (!form.username || !form.password) {
    ElMessage.warning('请输入用户名和密码');
    return;
  }
  loading.value = true;
  try {
    await auth.login(form.username, form.password);
    ElMessage.success(`欢迎，${auth.user?.displayName ?? ''}`);
    const redirect = (route.query.redirect as string) || '/dashboard';
    void router.push(redirect);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '登录失败');
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-wrap {
  height: 100vh;
  display: grid;
  place-items: center;
  background:
    radial-gradient(1200px 500px at 50% -10%, rgba(78, 168, 255, 0.18), transparent),
    var(--bg-dark);
}
.login-card {
  width: 400px;
  padding: 36px 34px 26px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 14px;
}
.brand {
  text-align: center;
  margin-bottom: 24px;
}
.brand h1 {
  font-size: 20px;
  margin: 12px 0 6px;
}
.brand p {
  color: var(--text-dim);
  font-size: 12px;
  margin: 0;
}
.submit {
  width: 100%;
}
.hint {
  margin-top: 16px;
  text-align: center;
  font-size: 12px;
  color: var(--text-dim);
}
.hint code {
  color: var(--info);
  background: rgba(78, 168, 255, 0.1);
  padding: 1px 6px;
  border-radius: 4px;
}
</style>
