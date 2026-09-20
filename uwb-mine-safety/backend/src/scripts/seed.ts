import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash('admin123', 12);

  // ---- 用户 ----
  const users = [
    { username: 'admin', displayName: '系统管理员', role: 'admin' as const },
    { username: 'dispatcher', displayName: '王调度', role: 'dispatcher' as const },
    { username: 'viewer', displayName: '值班长（只读）', role: 'viewer' as const },
  ];
  for (const u of users) {
    await prisma.user.upsert({
      where: { username: u.username },
      update: {},
      create: { ...u, passwordHash },
    });
  }

  // ---- 区域（矿井局部坐标，米；z=0 表示 -520m 水平） ----
  const zones = [
    {
      code: 'Z-001',
      name: '中央变电所',
      level: 'restricted' as const,
      floor: 0,
      polygon: [
        { x: 320, y: 80 },
        { x: 420, y: 80 },
        { x: 420, y: 160 },
        { x: 320, y: 160 },
      ],
      speakerGroup: 'zone-001',
      broadcastTpl: '警告：{name}（{team}）已进入{zone}，请立即撤离！',
      remark: '高压设备，非电工禁止入内',
    },
    {
      code: 'Z-002',
      name: '采空区边缘',
      level: 'restricted' as const,
      floor: 0,
      polygon: [
        { x: 700, y: 300 },
        { x: 820, y: 300 },
        { x: 840, y: 420 },
        { x: 720, y: 440 },
      ],
      speakerGroup: 'zone-002',
      broadcastTpl: '危险：{name} 已接近{zone}，禁止越过警戒线！',
      remark: '顶板不稳定，严禁进入',
    },
    {
      code: 'Z-003',
      name: '瓦斯巡检巷',
      level: 'warning' as const,
      floor: 0,
      polygon: [
        { x: 150, y: 320 },
        { x: 260, y: 320 },
        { x: 260, y: 420 },
        { x: 150, y: 420 },
      ],
      speakerGroup: 'zone-003',
      broadcastTpl: '提醒：{name} 进入{zone}，请携带便携仪并加强观察。',
      remark: '瓦斯异常区，进入需巡检资质',
    },
  ];
  for (const z of zones) {
    await prisma.zone.upsert({ where: { code: z.code }, update: {}, create: z });
  }

  // ---- 基站 ----
  const anchors = [
    { code: 'A-01', name: '井口基站', x: 40, y: 40 },
    { code: 'A-02', name: '主巷 200m', x: 200, y: 40 },
    { code: 'A-03', name: '主巷 400m', x: 400, y: 40 },
    { code: 'A-04', name: '变电所门口', x: 300, y: 120 },
    { code: 'A-05', name: '回风巷口', x: 150, y: 300 },
    { code: 'A-06', name: '工作面基站', x: 600, y: 380 },
    { code: 'A-07', name: '采空区警戒', x: 700, y: 280 },
  ];
  for (const a of anchors) {
    await prisma.anchor.upsert({ where: { code: a.code }, update: {}, create: a });
  }

  // ---- 人员 ----
  const people = [
    { tagId: 'TAG-001', name: '李矿生', employeeNo: 'M1001', jobTitle: '采煤工', team: '综采一队', phone: '13800000001' },
    { tagId: 'TAG-002', name: '张安全', employeeNo: 'M1002', jobTitle: '安全员', team: '安检科', phone: '13800000002' },
    { tagId: 'TAG-003', name: '王大力', employeeNo: 'M1003', jobTitle: '采煤工', team: '综采一队' },
    { tagId: 'TAG-004', name: '赵电工', employeeNo: 'M1004', jobTitle: '电工', team: '机电队' },
    { tagId: 'TAG-005', name: '刘巡检', employeeNo: 'M1005', jobTitle: '瓦斯检查工', team: '通风队' },
    { tagId: 'TAG-006', name: '陈运输', employeeNo: 'M1006', jobTitle: '电机车司机', team: '运输队' },
    { tagId: 'TAG-007', name: '孙立柱', employeeNo: 'M1007', jobTitle: '支护工', team: '掘进二队' },
    { tagId: 'TAG-008', name: '周通风', employeeNo: 'M1008', jobTitle: '测风工', team: '通风队' },
    { tagId: 'TAG-009', name: '吴机修', employeeNo: 'M1009', jobTitle: '机修工', team: '机电队' },
    { tagId: 'TAG-010', name: '郑放炮', employeeNo: 'M1010', jobTitle: '爆破工', team: '掘进二队' },
    { tagId: 'TAG-011', name: '冯班长', employeeNo: 'M1011', jobTitle: '班长', team: '综采一队' },
    { tagId: 'TAG-012', name: '蒋抽水', employeeNo: 'M1012', jobTitle: '排水工', team: '机电队' },
  ];
  for (const p of people) {
    await prisma.person.upsert({ where: { tagId: p.tagId }, update: {}, create: p });
  }

  // ---- 接入凭证（固定一个，重复执行 seed 保持 key 不变，方便模拟器使用） ----
  const key = 'uwb_dev_ingest_key_change_me_in_production_0001';
  await prisma.ingestKey.upsert({
    where: { key },
    update: { isActive: true },
    create: { name: '种子接入凭证（模拟器/网关用）', key },
  });

  console.log('\n========== 种子数据完成 ==========');
  console.log('后台账号（密码均为 admin123）:');
  for (const u of users) console.log(`  ${u.username.padEnd(12)} / admin123  [${u.role}]`);
  console.log('\n设备接入 X-Ingest-Key:');
  console.log(`  ${key}`);
  console.log('==================================\n');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
