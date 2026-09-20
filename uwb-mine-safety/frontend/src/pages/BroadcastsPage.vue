<template>
  <div>
    <div class="card compose">
      <div class="panel-title">手动广播</div>
      <div class="compose-body">
        <el-select v-model="targetGroup" placeholder="广播范围" style="width: 220px" clearable>
          <el-option label="全矿广播（默认）" :value="''" />
          <el-option v-for="z in zones" :key="z.id"
            :label="`${z.name}（${z.speakerGroup ?? '继承全矿'}）`" :value="z.speakerGroup ?? ''" />
        </el-select>
        <el-input v-model="content" type="textarea" :rows="2" maxlength="500" show-word-limit
          placeholder="输入喊话内容，通过 IP 网络音箱 TTS 播报" />
        <el-button type="warning" :disabled="!auth.canDispatch || !content.trim()" :loading="sending" @click="send">
          <el-icon><Microphone /></el-icon> 立即播报
        </el-button>
      </div>
      <div class="dim small">
        告警联动规则：闯入危险区域 / 长时间静止 / SOS 触发时自动播报；低电量与离线仅在调度台提示，不占用广播频道。
      </div>
    </div>

    <el-table :data="items" v-loading="loading" class="table mt" stripe>
      <el-table-column label="时间" width="170">
        <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="来源" width="110">
        <template #default="{ row }">
          <el-tag :type="row.triggerType === 'auto' ? 'danger' : 'primary'" size="small" effect="plain">
            {{ row.triggerType === 'auto' ? '告警联动' : '手动' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="范围" width="140">
        <template #default="{ row }">{{ row.targetGroup || '全矿' }}</template>
      </el-table-column>
      <el-table-column label="播报内容" prop="content" min-width="320" show-overflow-tooltip />
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <el-tag :type="row.status === 'sent' ? 'success' : row.status === 'failed' ? 'danger' : 'warning'" size="small">
            {{ broadcastStatusLabel(row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="100">
        <template #default="{ row }">
          <el-button v-if="row.status === 'failed'" link type="primary"
            :disabled="!auth.canDispatch" @click="retry(row)">重发</el-button>
          <span v-else class="dim small">{{ row.error || '' }}</span>
        </template>
      </el-table-column>
    </el-table>

    <div class="pager">
      <el-pagination background layout="total, prev, pager, next" :total="total" :page-size="pageSize"
        :current-page="page" @current-change="onPage" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../api';
import type { Broadcast, Zone } from '../api/types';
import { broadcastStatusLabel, fmtTime } from '../config/labels';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const items = ref<Broadcast[]>([]);
const zones = ref<Zone[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loading = ref(false);
const content = ref('');
const targetGroup = ref('');
const sending = ref(false);

async function load() {
  loading.value = true;
  try {
    const [list, z] = await Promise.all([
      api.listBroadcasts({ page: page.value, pageSize }),
      api.listZones(),
    ]);
    items.value = list.items;
    total.value = list.total;
    zones.value = z.items;
  } finally {
    loading.value = false;
  }
}

function onPage(p: number) {
  page.value = p;
  void load();
}

async function send() {
  sending.value = true;
  try {
    await api.sendBroadcast({ content: content.value.trim(), targetGroup: targetGroup.value || null });
    ElMessage.success('广播已下发');
    content.value = '';
    page.value = 1;
    void load();
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '广播失败');
  } finally {
    sending.value = false;
  }
}

async function retry(row: Broadcast) {
  try {
    await api.retryBroadcast(row.id);
    ElMessage.success('已重发');
    void load();
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '重发失败');
  }
}

onMounted(load);
</script>

<style scoped>
.panel-title {
  font-weight: 600;
  margin-bottom: 10px;
}
.compose-body {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.compose-body .el-textarea {
  flex: 1;
}
.mt {
  margin-top: 14px;
}
.pager {
  margin-top: 14px;
  display: flex;
  justify-content: flex-end;
}
.small {
  font-size: 12px;
}
.dim {
  color: var(--text-dim);
}
</style>
