<template>
  <div class="zones">
    <div class="card list">
      <div class="panel-head">
        <div class="panel-title">危险区域（{{ items.length }}）</div>
        <el-button v-if="auth.isAdmin" type="primary" size="small" @click="startCreate">
          <el-icon><Plus /></el-icon> 新建围栏
        </el-button>
      </div>
      <div class="zone-items">
        <div v-for="z in items" :key="z.id" :class="['zone-item', { active: current?.id === z.id }]"
          @click="selectZone(z)">
          <div class="zi-top">
            <span class="zi-name">{{ z.name }}</span>
            <el-tag :type="levelType(z.level)" size="small">{{ ZONE_LEVEL_LABELS[z.level] }}</el-tag>
          </div>
          <div class="dim small">
            {{ z.code }} · {{ z.polygon.length }} 个顶点 · 水平 z={{ z.floor }}
            <el-tag v-if="!z.isActive" size="small" type="info" effect="plain" class="ml">停用</el-tag>
          </div>
          <div class="dim small" v-if="z.remark">{{ z.remark }}</div>
          <div v-if="auth.isAdmin && current?.id === z.id" class="zi-actions">
            <el-button size="small" @click="startEdit(z)">在图上编辑</el-button>
            <el-button size="small" type="danger" plain @click="remove(z)">删除</el-button>
          </div>
        </div>
        <el-empty v-if="items.length === 0" :image-size="70" description="还没有围栏" />
      </div>
    </div>

    <div class="card editor">
      <div class="panel-head">
        <div class="panel-title">{{ editing ? `绘制围栏：${form.name || '未命名'}` : '围栏预览' }}</div>
        <div v-if="editing" class="edit-tip dim">在图上依次点击添加顶点（≥3），也可直接修改下方坐标表</div>
      </div>

      <MineMap :zones="editing ? previewZones : items" :people="[]" :editable="editing"
        :draft="editing ? form.polygon : []" :selected-zone-id="current?.id" @add-point="addVertex" />

      <div v-if="editing" class="edit-form">
        <el-form :model="form" label-width="90px" size="small" class="form-grid">
          <el-form-item label="区域编号"><el-input v-model="form.code" /></el-form-item>
          <el-form-item label="区域名称"><el-input v-model="form.name" /></el-form-item>
          <el-form-item label="危险级别">
            <el-select v-model="form.level" style="width: 100%">
              <el-option label="禁止进入（闯入即紧急告警）" value="restricted" />
              <el-option label="谨慎进入（警告）" value="warning" />
              <el-option label="安全区域（仅展示）" value="safe" />
            </el-select>
          </el-form-item>
          <el-form-item label="所在水平 z"><el-input-number v-model="form.floor" :step="10" style="width: 100%" /></el-form-item>
          <el-form-item label="音箱分组">
            <el-input v-model="form.speakerGroup" placeholder="如 zone-001，空=全矿广播" />
          </el-form-item>
          <el-form-item label="启用围栏"><el-switch v-model="form.isActive" /></el-form-item>
          <el-form-item label="TTS 模板" class="span2">
            <el-input v-model="form.broadcastTpl" type="textarea" :rows="2"
              placeholder="支持占位符 {name} {team} {zone}，例：警告：{name} 已进入{zone}，请立即撤离" />
          </el-form-item>
          <el-form-item label="备注" class="span2">
            <el-input v-model="form.remark" type="textarea" :rows="1" />
          </el-form-item>
        </el-form>

        <div v-if="form.polygon.length > 0" class="vertex-table">
          <div class="dim small">顶点坐标（米）：</div>
          <div class="vertices">
            <el-tag v-for="(p, i) in form.polygon" :key="i" closable size="small" class="vertex"
              @close="removeVertex(i)">{{ i + 1 }}: {{ p.x.toFixed(0) }}, {{ p.y.toFixed(0) }}</el-tag>
          </div>
        </div>

        <div class="edit-actions">
          <el-button @click="undoVertex" :disabled="form.polygon.length === 0">撤销顶点</el-button>
          <el-button @click="clearVertices">清空</el-button>
          <el-button type="info" plain @click="cancelEdit">取消</el-button>
          <el-button type="primary" @click="save" :disabled="form.polygon.length < 3">保存围栏</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import MineMap from '../components/MineMap.vue';
import { api } from '../api';
import type { Point, Zone, ZoneLevel } from '../api/types';
import { ZONE_LEVEL_LABELS } from '../config/labels';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const items = ref<Zone[]>([]);
const current = ref<Zone | null>(null);
const editing = ref(false);
const editingId = ref<string | null>(null);

const form = reactive({
  code: '',
  name: '',
  level: 'restricted' as ZoneLevel,
  polygon: [] as Point[],
  floor: 0,
  speakerGroup: '',
  broadcastTpl: '',
  isActive: true,
  remark: '',
});

const previewZones = computed<Zone[]>(() =>
  items.value.filter((z) => z.id !== editingId.value),
);

function levelType(level: ZoneLevel): 'danger' | 'warning' | 'success' {
  const map: Record<ZoneLevel, 'danger' | 'warning' | 'success'> = {
    restricted: 'danger',
    warning: 'warning',
    safe: 'success',
  };
  return map[level];
}

async function load() {
  const res = await api.listZones();
  items.value = res.items;
  if (!current.value && items.value[0]) current.value = items.value[0];
}

function selectZone(z: Zone) {
  if (!editing.value) current.value = z;
}

function startCreate() {
  editing.value = true;
  editingId.value = null;
  Object.assign(form, {
    code: `Z-${String(items.value.length + 1).padStart(3, '0')}`,
    name: '', level: 'restricted', polygon: [], floor: 0,
    speakerGroup: '', broadcastTpl: '', isActive: true, remark: '',
  });
}

function startEdit(z: Zone) {
  editing.value = true;
  editingId.value = z.id;
  Object.assign(form, {
    code: z.code, name: z.name, level: z.level,
    polygon: z.polygon.map((p) => ({ ...p })),
    floor: z.floor, speakerGroup: z.speakerGroup ?? '',
    broadcastTpl: z.broadcastTpl ?? '', isActive: z.isActive, remark: z.remark ?? '',
  });
}

function cancelEdit() {
  editing.value = false;
  editingId.value = null;
}

function addVertex(p: Point) {
  form.polygon.push({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });
}
function undoVertex() {
  form.polygon.pop();
}
function clearVertices() {
  form.polygon = [];
}
function removeVertex(i: number) {
  form.polygon.splice(i, 1);
}

async function save() {
  if (form.polygon.length < 3) {
    ElMessage.warning('围栏至少需要 3 个顶点');
    return;
  }
  if (!form.code || !form.name) {
    ElMessage.warning('编号和名称必填');
    return;
  }
  const payload = {
    code: form.code,
    name: form.name,
    level: form.level,
    polygon: form.polygon,
    floor: form.floor,
    speakerGroup: form.speakerGroup || null,
    broadcastTpl: form.broadcastTpl || null,
    isActive: form.isActive,
    remark: form.remark || null,
  };
  try {
    if (editingId.value) await api.updateZone(editingId.value, payload);
    else await api.createZone(payload);
    ElMessage.success('围栏已保存，规则立即生效');
    cancelEdit();
    await load();
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '保存失败');
  }
}

async function remove(z: Zone) {
  try {
    await ElMessageBox.confirm(`删除围栏「${z.name}」？未解除的相关告警需先处置。`, '删除围栏', { type: 'warning' });
    await api.deleteZone(z.id);
    if (current.value?.id === z.id) current.value = null;
    ElMessage.success('已删除');
    await load();
  } catch (err) {
    if (err !== 'cancel') ElMessage.error(err instanceof Error ? err.message : '删除失败');
  }
}

onMounted(load);
</script>

<style scoped>
.zones {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 14px;
  align-items: start;
}
.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.panel-title {
  font-weight: 600;
}
.zone-items {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 72vh;
  overflow-y: auto;
}
.zone-item {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px;
  cursor: pointer;
  background: var(--panel-2);
}
.zone-item.active {
  border-color: var(--info);
}
.zi-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.zi-name {
  font-weight: 600;
}
.zi-actions {
  margin-top: 8px;
  display: flex;
  gap: 6px;
}
.edit-tip {
  font-size: 12px;
}
.edit-form {
  margin-top: 14px;
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 16px;
}
.form-grid .span2 {
  grid-column: span 2;
}
.vertex-table {
  margin: 8px 0;
}
.vertices {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}
.vertex {
  font-family: Consolas, monospace;
}
.edit-actions {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.ml {
  margin-left: 6px;
}
.small {
  font-size: 12px;
}
.dim {
  color: var(--text-dim);
}
</style>
