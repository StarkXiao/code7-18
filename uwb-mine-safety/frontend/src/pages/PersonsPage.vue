<template>
  <div>
    <div class="toolbar card">
      <el-input v-model="keyword" placeholder="搜索姓名 / 标签号 / 工号 / 班组" clearable style="width: 280px"
        @keyup.enter="search" @clear="search" />
      <el-select v-model="status" placeholder="状态" clearable style="width: 130px" @change="search">
        <el-option label="正常" value="active" />
        <el-option label="静止" value="stationary" />
        <el-option label="离线" value="offline" />
      </el-select>
      <el-button type="primary" @click="search">查询</el-button>
      <div class="spacer" />
      <el-button v-if="auth.isAdmin" type="success" @click="openCreate">
        <el-icon><Plus /></el-icon> 登记人员
      </el-button>
    </div>

    <el-table :data="items" v-loading="loading" class="table" stripe @row-click="(r: Person) => $router.push(`/persons/${r.tagId}`)">
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <span :class="['status-dot', `status-${row.status}`]" />
          {{ STATUS_LABELS[row.status as PersonStatus] }}
        </template>
      </el-table-column>
      <el-table-column label="姓名" prop="name" width="110" />
      <el-table-column label="标签号" prop="tagId" width="120" class="mono" />
      <el-table-column label="工号" prop="employeeNo" width="110" />
      <el-table-column label="职务" prop="jobTitle" width="110" />
      <el-table-column label="班组" prop="team" width="120" />
      <el-table-column label="电量" width="110">
        <template #default="{ row }">
          <el-progress v-if="row.batteryPct !== null" :percentage="row.batteryPct"
            :status="batteryType(row.batteryPct) === 'danger' ? 'exception' : undefined"
            :stroke-width="8" />
          <span v-else class="dim">—</span>
        </template>
      </el-table-column>
      <el-table-column label="最近上报" width="160">
        <template #default="{ row }">{{ fmtRelative(row.lastSeenAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click.stop="$router.push(`/persons/${row.tagId}`)">详情/轨迹</el-button>
          <el-button v-if="auth.isAdmin" link type="danger" @click.stop="remove(row)">注销</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pager">
      <el-pagination background layout="total, prev, pager, next" :total="total" :page-size="pageSize"
        :current-page="page" @current-change="onPage" />
    </div>

    <el-dialog v-model="formVisible" :title="editing ? '编辑人员' : '登记人员'" width="480px">
      <el-form :model="form" label-width="80px">
        <el-form-item label="标签号" required>
          <el-input v-model="form.tagId" :disabled="editing" placeholder="UWB 标签硬件 ID，如 TAG-013" />
        </el-form-item>
        <el-form-item label="姓名" required><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="工号"><el-input v-model="form.employeeNo" /></el-form-item>
        <el-form-item label="职务"><el-input v-model="form.jobTitle" /></el-form-item>
        <el-form-item label="班组"><el-input v-model="form.team" /></el-form-item>
        <el-form-item label="电话"><el-input v-model="form.phone" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';
import type { Person, PersonStatus } from '../api/types';
import { STATUS_LABELS, batteryType, fmtRelative } from '../config/labels';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const items = ref<Person[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loading = ref(false);
const keyword = ref('');
const status = ref('');

const formVisible = ref(false);
const editing = ref(false);
const form = reactive({ tagId: '', name: '', employeeNo: '', jobTitle: '', team: '', phone: '' });

async function load() {
  loading.value = true;
  try {
    const res = await api.listPersons({ page: page.value, pageSize, keyword: keyword.value, status: status.value || undefined });
    items.value = res.items;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}

function search() {
  page.value = 1;
  void load();
}
function onPage(p: number) {
  page.value = p;
  void load();
}

function openCreate() {
  editing.value = false;
  Object.assign(form, { tagId: '', name: '', employeeNo: '', jobTitle: '', team: '', phone: '' });
  formVisible.value = true;
}

async function save() {
  if (!form.tagId || !form.name) {
    ElMessage.warning('标签号和姓名必填');
    return;
  }
  try {
    if (editing.value) {
      await api.updatePerson(form.tagId, {
        name: form.name, employeeNo: form.employeeNo || null, jobTitle: form.jobTitle || null,
        team: form.team || null, phone: form.phone || null,
      });
    } else {
      await api.createPerson({
        tagId: form.tagId, name: form.name,
        employeeNo: form.employeeNo || null, jobTitle: form.jobTitle || null,
        team: form.team || null, phone: form.phone || null,
      });
    }
    ElMessage.success('已保存');
    formVisible.value = false;
    void load();
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '保存失败');
  }
}

async function remove(row: Person) {
  try {
    await ElMessageBox.confirm(`注销后 ${row.name} 的定位将不再入库（历史记录保留），确认？`, '注销人员', { type: 'warning' });
    await api.deletePerson(row.tagId);
    ElMessage.success('已注销');
    void load();
  } catch (err) {
    if (err !== 'cancel') ElMessage.error(err instanceof Error ? err.message : '操作失败');
  }
}

onMounted(load);
</script>

<style scoped>
.toolbar {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}
.spacer {
  flex: 1;
}
.pager {
  margin-top: 14px;
  display: flex;
  justify-content: flex-end;
}
.mono {
  font-family: Consolas, monospace;
}
</style>
