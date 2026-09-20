<template>
  <div class="dashboard">
    <!-- 顶部统计 -->
    <div class="stats">
      <div class="stat-card" v-for="c in cards" :key="c.label" :style="{ '--accent': c.color }">
        <div class="stat-value">{{ c.value }}</div>
        <div class="stat-label">{{ c.label }}</div>
      </div>
    </div>

    <div class="body">
      <!-- 矿图 -->
      <div class="map-panel card">
        <div class="panel-head">
          <div class="panel-title">井下实时分布（局部坐标，米）</div>
          <div class="legend">
            <span><i class="dot active" />正常</span>
            <span><i class="dot stationary" />静止</span>
            <span><i class="dot offline" />离线</span>
            <el-divider direction="vertical" />
            <span><i class="box restricted" />禁区</span>
            <span><i class="box warning" />警告区</span>
          </div>
        </div>

        <MineMap :zones="zones" :people="mapPeople" :flash-tag-id="realtime.flashTagId"
          @select="goDetail" />

        <div class="map-foot dim">
          在线人员 {{ onlinePeople.length }} / {{ overview?.persons.total ?? 0 }}
          <el-divider direction="vertical" />
          班组：
          <el-tag v-for="t in overview?.personsByTeam ?? []" :key="t.team" size="small" effect="plain" class="team-tag">
            {{ t.team }} {{ t.count }}
          </el-tag>
        </div>
      </div>

      <!-- 右侧实时告警流 -->
      <div class="side">
        <div class="card alarm-feed">
          <div class="panel-head">
            <div class="panel-title">
              实时告警
              <el-badge v-if="openTotal > 0" :value="openTotal" type="danger" class="feed-badge" />
            </div>
            <el-button link type="primary" size="small" @click="$router.push('/alarms')">处置台 →</el-button>
          </div>
          <div class="feed-list">
            <div v-for="a in realtime.latestAlarms.slice(0, 12)" :key="a.id"
              :class="['feed-item', `sev-${a.severity}`, { resolved: a.status === 'resolved' }]"
              @click="$router.push('/alarms')">
              <div class="feed-top">
                <el-tag :type="sevType(a.severity)" size="small" effect="dark">{{ typeLabel(a.type) }}</el-tag>
                <el-tag :type="statusType(a.status)" size="small" effect="plain">{{ statusLabel(a.status) }}</el-tag>
                <span v-if="a.repeatCount > 1" class="repeat">×{{ a.repeatCount }}</span>
                <span class="time dim">{{ fmt(a.lastFiredAt) }}</span>
              </div>
              <div class="feed-msg">{{ a.message }}</div>
            </div>
            <el-empty v-if="realtime.latestAlarms.length === 0" description="暂无告警，系统运行正常" :image-size="70" />
          </div>
        </div>

        <div class="card quick">
          <div class="panel-title">快捷广播</div>
          <el-input v-model="quickText" type="textarea" :rows="2" placeholder="输入全矿广播内容，调度员/管理员可发送" />
          <el-button type="warning" class="quick-btn" :disabled="!auth.canDispatch" :loading="sending"
            @click="sendQuick">
            <el-icon><Microphone /></el-icon> 全矿广播
          </el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import MineMap from '../components/MineMap.vue';
import { api, type Overview } from '../api';
import type { PersonStatus, Zone } from '../api/types';
import { useAuthStore } from '../stores/auth';
import { useRealtimeStore } from '../stores/realtime';
import { ALARM_LABELS, fmtTime, sevType, statusLabel, statusType, typeLabel } from '../config/labels';

void ALARM_LABELS;

const router = useRouter();
const auth = useAuthStore();
const realtime = useRealtimeStore();

const overview = ref<Overview | null>(null);
const zones = ref<Zone[]>([]);
const persons = ref<Array<{ tagId: string; name: string; team?: string | null; status: PersonStatus; batteryPct?: number | null; lastPos?: { x: number; y: number; z: number } | null }>>([]);
const openTotal = ref(0);
const quickText = ref('');
const sending = ref(false);

let timer: ReturnType<typeof setInterval> | null = null;

const mapPeople = computed(() =>
  realtime.positionList.map((p) => ({
    tagId: p.tagId,
    name: p.name,
    status: statusOf(p.tagId),
    x: p.x,
    y: p.y,
    z: p.z,
    sos: p.sos,
  })),
);

const onlinePeople = computed(() => mapPeople.value.filter((p) => p.status !== 'offline'));

function statusOf(tagId: string): PersonStatus {
  return persons.value.find((p) => p.tagId === tagId)?.status ?? 'active';
}

const cards = computed(() => [
  { label: '井下总人数', value: overview.value?.persons.total ?? '-', color: '#4ea8ff' },
  { label: '正常活动', value: overview.value?.persons.active ?? '-', color: 'var(--ok)' },
  { label: '静止观察', value: overview.value?.persons.stationary ?? '-', color: 'var(--warn)' },
  { label: '信号离线', value: overview.value?.persons.offline ?? '-', color: '#94a3b8' },
  { label: '未决告警', value: openTotal.value, color: 'var(--danger)' },
  { label: '基站在线', value: `${overview.value?.anchors.online ?? 0}/${overview.value?.anchors.total ?? 0}`, color: '#7ee8bd' },
]);

async function load() {
  const [snap, z, ov, count] = await Promise.all([
    api.personSnapshot(),
    api.listZones(),
    api.overview(),
    api.openAlarmCount(),
  ]);
  persons.value = snap.items;
  zones.value = z.items;
  overview.value = ov;
  openTotal.value = count.open;
  realtime.seedPositions(
    snap.items.map((p) => ({
      tagId: p.tagId,
      name: p.name,
      team: p.team,
      batteryPct: p.batteryPct,
      lastPos: p.lastPos,
      lastSeenAt: p.lastSeenAt,
    })),
  );
}

async function sendQuick() {
  if (!quickText.value.trim()) {
    ElMessage.warning('请输入广播内容');
    return;
  }
  sending.value = true;
  try {
    await api.sendBroadcast({ content: quickText.value.trim() });
    ElMessage.success('广播已下发');
    quickText.value = '';
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '广播失败');
  } finally {
    sending.value = false;
  }
}

function goDetail(tagId: string) {
  void router.push(`/persons/${tagId}`);
}

function fmt(v: string) {
  return fmtTime(v);
}

onMounted(async () => {
  await load().catch(() => undefined);
  realtime.connect();
  timer = setInterval(() => void load(), 15_000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<style scoped>
.stats {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 14px;
  margin-bottom: 14px;
}
.stat-card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-left: 3px solid var(--accent);
  border-radius: 10px;
  padding: 14px 18px;
}
.stat-value {
  font-size: 28px;
  font-weight: 700;
  color: var(--accent);
  font-family: Consolas, monospace;
}
.stat-label {
  color: var(--text-dim);
  font-size: 13px;
  margin-top: 2px;
}
.body {
  display: grid;
  grid-template-columns: 1fr 380px;
  gap: 14px;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.panel-title {
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}
.legend {
  font-size: 12px;
  color: var(--text-dim);
  display: flex;
  align-items: center;
  gap: 10px;
}
.legend .dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  margin-right: 3px;
}
.dot.active { background: var(--ok); }
.dot.stationary { background: var(--warn); }
.dot.offline { background: #64748b; }
.legend .box {
  display: inline-block;
  width: 12px;
  height: 9px;
  border-radius: 2px;
  margin-right: 3px;
}
.box.restricted { background: rgba(242, 73, 92, 0.4); border: 1px solid var(--danger); }
.box.warning { background: rgba(245, 165, 36, 0.4); border: 1px solid var(--warn); }
.map-foot {
  margin-top: 10px;
  font-size: 12px;
}
.team-tag {
  margin-right: 6px;
}
.side {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.alarm-feed {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.feed-list {
  overflow-y: auto;
  max-height: 52vh;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.feed-item {
  border: 1px solid var(--line);
  border-left: 3px solid var(--info);
  border-radius: 8px;
  padding: 8px 10px;
  cursor: pointer;
  background: var(--panel-2);
}
.feed-item.sev-warning { border-left-color: var(--warn); }
.feed-item.sev-critical { border-left-color: var(--danger); }
.feed-item.resolved { opacity: 0.5; }
.feed-top {
  display: flex;
  align-items: center;
  gap: 6px;
}
.repeat {
  color: var(--warn);
  font-size: 12px;
}
.time {
  margin-left: auto;
  font-size: 11px;
}
.feed-msg {
  margin-top: 5px;
  font-size: 13px;
  line-height: 1.4;
}
.quick-btn {
  width: 100%;
  margin-top: 10px;
}
</style>
