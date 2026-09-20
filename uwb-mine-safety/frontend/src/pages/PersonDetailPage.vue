<template>
  <div v-if="person" class="detail">
    <el-page-header @back="$router.back()" class="back">
      <template #content>
        <span class="title">{{ person.name }}</span>
        <el-tag size="small" class="ml">{{ person.team ?? '未分班' }}</el-tag>
        <el-tag size="small" effect="plain" class="ml">{{ person.jobTitle ?? '—' }}</el-tag>
        <span :class="['status-dot', `status-${person.status}`, 'ml']" />
        {{ STATUS_LABELS[person.status] }}
      </template>
    </el-page-header>

    <div class="grid">
      <div class="card">
        <el-descriptions :column="2" size="small" border>
          <el-descriptions-item label="标签号">{{ person.tagId }}</el-descriptions-item>
          <el-descriptions-item label="工号">{{ person.employeeNo ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="电话">{{ person.phone ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="电量">
            <el-tag :type="batteryType(person.batteryPct)" size="small">{{ person.batteryPct ?? '—' }}%</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="最近上报">{{ fmtTime(person.lastSeenAt) }}（{{ fmtRelative(person.lastSeenAt) }}）</el-descriptions-item>
          <el-descriptions-item label="当前坐标">
            <span v-if="person.lastPos" class="mono">
              ({{ person.lastPos.x.toFixed(1) }}, {{ person.lastPos.y.toFixed(1) }}, {{ person.lastPos.z.toFixed(1) }})
            </span>
            <span v-else>—</span>
          </el-descriptions-item>
        </el-descriptions>

        <div class="track-head">
          <span class="panel-title">历史轨迹</span>
          <el-radio-group v-model="minutes" size="small" @change="loadTrack">
            <el-radio-button :value="15">15 分钟</el-radio-button>
            <el-radio-button :value="30">30 分钟</el-radio-button>
            <el-radio-button :value="60">1 小时</el-radio-button>
            <el-radio-button :value="120">2 小时</el-radio-button>
          </el-radio-group>
          <span class="dim small">共 {{ track.length }} 个定位点</span>
        </div>

        <MineMap :zones="zones" :people="mapPeople" :track="track" :selected-tag="tagId" :show-labels="false" />
      </div>

      <div class="card">
        <div class="panel-title">近期告警</div>
        <el-timeline class="timeline">
          <el-timeline-item v-for="a in alarms" :key="a.id" :type="sevType(a.severity)"
            :timestamp="fmtTime(a.createdAt)" placement="top">
            <div class="al-title">
              {{ typeLabel(a.type) }}
              <el-tag :type="statusType(a.status)" size="small" class="ml">{{ statusLabel(a.status) }}</el-tag>
            </div>
            <div class="al-msg">{{ a.message }}</div>
            <div class="dim small" v-if="a.zone?.name">区域：{{ a.zone.name }}</div>
          </el-timeline-item>
        </el-timeline>
        <el-empty v-if="alarms.length === 0" description="近期无告警" :image-size="60" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import MineMap from '../components/MineMap.vue';
import { api } from '../api';
import type { Alarm, Person, PersonStatus, Point, Zone } from '../api/types';
import { STATUS_LABELS, batteryType, fmtRelative, fmtTime, sevType, statusLabel, statusType, typeLabel } from '../config/labels';
import { useRealtimeStore } from '../stores/realtime';

const route = useRoute();
const tagId = route.params.tagId as string;
const realtime = useRealtimeStore();

const person = ref<Person | null>(null);
const alarms = ref<Alarm[]>([]);
const zones = ref<Zone[]>([]);
const track = ref<Point[]>([]);
const minutes = ref(30);

const mapPeople = computed(() => {
  const live = realtime.positions.get(tagId);
  if (!live || !person.value) return [];
  return [{
    tagId,
    name: person.value.name,
    status: person.value.status,
    x: live.x,
    y: live.y,
    z: live.z,
  }];
});

async function loadAll() {
  const [detail, z] = await Promise.all([api.personDetail(tagId), api.listZones()]);
  person.value = detail.person;
  alarms.value = detail.recentAlarms;
  zones.value = z.items;
}

async function loadTrack() {
  const res = await api.personTrack(tagId, minutes.value);
  track.value = res.items.map((p) => ({ x: p.x, y: p.y }));
}

let timer: ReturnType<typeof setInterval> | null = null;
onMounted(async () => {
  await Promise.all([loadAll(), loadTrack()]);
  realtime.connect();
  timer = setInterval(() => void loadAll(), 10_000);
});
</script>

<style scoped>
.back {
  margin-bottom: 14px;
}
.title {
  font-weight: 700;
  font-size: 16px;
}
.ml {
  margin-left: 8px;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 340px;
  gap: 14px;
}
.track-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 16px 0 10px;
}
.panel-title {
  font-weight: 600;
}
.small {
  font-size: 12px;
}
.dim {
  color: var(--text-dim);
}
.mono {
  font-family: Consolas, monospace;
}
.timeline {
  margin-top: 12px;
  max-height: 60vh;
  overflow-y: auto;
}
.al-title {
  font-weight: 600;
  font-size: 13px;
}
.al-msg {
  font-size: 13px;
  margin: 2px 0;
  color: var(--text-main);
}
</style>
