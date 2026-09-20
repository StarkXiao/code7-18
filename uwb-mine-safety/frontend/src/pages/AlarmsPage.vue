<template>
  <div>
    <div class="filters card">
      <el-radio-group v-model="filters.status" @change="reload">
        <el-radio-button value="">全部</el-radio-button>
        <el-radio-button value="active">待确认</el-radio-button>
        <el-radio-button value="acked">处置中</el-radio-button>
        <el-radio-button value="resolved">已解除</el-radio-button>
      </el-radio-group>

      <el-select v-model="filters.type" placeholder="类型" clearable style="width: 150px" @change="reload">
        <el-option v-for="(label, value) in ALARM_LABELS" :key="value" :label="label" :value="value" />
      </el-select>
      <el-select v-model="filters.severity" placeholder="级别" clearable style="width: 130px" @change="reload">
        <el-option label="紧急" value="critical" />
        <el-option label="警告" value="warning" />
        <el-option label="提示" value="info" />
      </el-select>
    </div>

    <el-table :data="items" v-loading="loading" class="table" stripe @row-click="openDetail">
      <el-table-column label="级别" width="90">
        <template #default="{ row }">
          <el-tag :type="sevType(row.severity)" effect="dark" size="small">
            {{ severityLabel(row.severity) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="类型" width="130">
        <template #default="{ row }">{{ typeLabel(row.type) }}</template>
      </el-table-column>
      <el-table-column label="人员 / 班组" width="170">
        <template #default="{ row }">
          <div>{{ row.person?.name ?? row.personId }}</div>
          <div class="dim small">{{ row.person?.team ?? '—' }}</div>
        </template>
      </el-table-column>
      <el-table-column label="告警内容" prop="message" min-width="280" show-overflow-tooltip />
      <el-table-column label="次数" width="70" align="center">
        <template #default="{ row }">
          <el-tag v-if="row.repeatCount > 1" size="small" type="warning">{{ row.repeatCount }}</el-tag>
          <span v-else class="dim">1</span>
        </template>
      </el-table-column>
      <el-table-column label="最近触发" width="160">
        <template #default="{ row }">{{ fmtTime(row.lastFiredAt) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="190" fixed="right">
        <template #default="{ row }">
          <template v-if="row.status !== 'resolved'">
            <el-button v-if="row.status === 'active'" size="small" type="primary" plain
              :disabled="!auth.canDispatch" @click.stop="ack(row)">确认</el-button>
            <el-button size="small" type="success" plain :disabled="!auth.canDispatch"
              @click.stop="askResolve(row)">解除</el-button>
          </template>
          <span v-else class="dim small">{{ row.resolveNote ?? '已解除' }}</span>
        </template>
      </el-table-column>
    </el-table>

    <div class="pager">
      <el-pagination background layout="total, prev, pager, next" :total="total" :page-size="pageSize"
        :current-page="page" @current-change="onPage" />
    </div>

    <el-drawer v-model="detailVisible" size="440px" title="告警详情">
      <template v-if="current">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="类型">{{ typeLabel(current.type) }}</el-descriptions-item>
          <el-descriptions-item label="级别">
            <el-tag :type="sevType(current.severity)" size="small">{{ current.severity }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="人员">
            {{ current.person?.name }}（{{ current.person?.jobTitle ?? '—' }}，{{ current.person?.team ?? '—' }}）
            <el-link v-if="current.person?.phone" class="phone" type="primary"
              :href="`tel:${current.person.phone}`">{{ current.person.phone }}</el-link>
          </el-descriptions-item>
          <el-descriptions-item label="区域">{{ current.zone?.name ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="内容">{{ current.message }}</el-descriptions-item>
          <el-descriptions-item label="触发坐标">
            <span v-if="current.position" class="mono">
              ({{ current.position.x.toFixed(1) }}, {{ current.position.y.toFixed(1) }}, {{ current.position.z.toFixed(1) }})
            </span>
            <span v-else>—</span>
          </el-descriptions-item>
          <el-descriptions-item label="首次/最近">
            {{ fmtTime(current.firstFiredAt) }} ｜ {{ fmtTime(current.lastFiredAt) }}
          </el-descriptions-item>
          <el-descriptions-item label="重复次数">{{ current.repeatCount }}</el-descriptions-item>
          <el-descriptions-item label="确认人">{{ current.ackedByName ?? '—' }}</el-descriptions-item>
          <el-descriptions-item v-if="current.escalatedAt" label="升级时间">{{ fmtTime(current.escalatedAt) }}</el-descriptions-item>
          <el-descriptions-item label="解除备注">{{ current.resolveNote ?? '—' }}</el-descriptions-item>
        </el-descriptions>

        <div v-if="current.status !== 'resolved'" class="drawer-actions">
          <el-button v-if="current.status === 'active'" type="primary" :disabled="!auth.canDispatch" @click="ack(current)">
            确认告警
          </el-button>
          <el-button type="success" :disabled="!auth.canDispatch" @click="askResolve(current)">现场核实并解除</el-button>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';
import type { Alarm } from '../api/types';
import { ALARM_LABELS, fmtTime, severityLabel, sevType, statusLabel, statusType, typeLabel } from '../config/labels';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const items = ref<Alarm[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loading = ref(false);
const filters = reactive<{ status: string; type: string; severity: string }>({ status: 'active', type: '', severity: '' });
const detailVisible = ref(false);
const current = ref<Alarm | null>(null);

async function reload() {
  loading.value = true;
  try {
    const res = await api.listAlarms({
      page: page.value,
      pageSize,
      status: filters.status || undefined,
      type: filters.type || undefined,
      severity: filters.severity || undefined,
    });
    items.value = res.items;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}

function onPage(p: number) {
  page.value = p;
  void reload();
}

async function ack(row: Alarm) {
  try {
    await api.ackAlarm(row.id);
    ElMessage.success('已确认，进入处置中');
    void reload();
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '确认失败');
  }
}

async function askResolve(row: Alarm) {
  try {
    const { value } = await ElMessageBox.prompt('请填写现场处置情况（解除原因）', '解除告警', {
      confirmButtonText: '确认解除',
      cancelButtonText: '取消',
      inputValue: '现场已核实安全',
      inputValidator: (v) => (v && v.trim().length > 0) || '请填写处置说明',
    });
    await api.resolveAlarm(row.id, value);
    ElMessage.success('告警已解除');
    if (current.value?.id === row.id) current.value = { ...row, status: 'resolved' };
    void reload();
  } catch (err) {
    if (err !== 'cancel' && err instanceof Error) ElMessage.error(err.message);
  }
}

async function openDetail(row: Alarm) {
  try {
    current.value = await requestAlarm(row.id);
    detailVisible.value = true;
  } catch {
    current.value = row;
    detailVisible.value = true;
  }
}

async function requestAlarm(id: string): Promise<Alarm> {
  // 列表项信息已较全；这里简单回填，详情字段（phone/坐标）来自列表时部分可空
  const res = await fetch(`${import.meta.env.VITE_API_BASE ?? '/api/v1'}/alarms/${id}`, {
    headers: { authorization: `Bearer ${localStorage.getItem('uwb_token')}` },
  });
  return (await res.json()) as Alarm;
}

onMounted(reload);
</script>

<style scoped>
.filters {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}
.small {
  font-size: 12px;
}
.dim {
  color: var(--text-dim);
}
.pager {
  margin-top: 14px;
  display: flex;
  justify-content: flex-end;
}
.phone {
  margin-left: 8px;
}
.drawer-actions {
  margin-top: 20px;
  display: flex;
  gap: 10px;
}
</style>
