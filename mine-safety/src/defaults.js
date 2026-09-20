/**
 * 默认矿井底图与配置（坐标单位：米，局部坐标系，原点设在副井口）。
 * 实际部署可由管理接口维护并持久化，此处给出演示用的完整采区布局。
 */

export const defaultTracks = [
  {
    id: 'tr-main',
    name: '主运输大巷',
    path: [
      [0, 120],
      [40, 120],
      [80, 115],
      [130, 100],
      [170, 95],
      [220, 95],
      [260, 100],
    ],
  },
  {
    id: 'tr-west-cross',
    name: '西翼回风联巷',
    path: [
      [80, 115],
      [75, 150],
      [70, 180],
    ],
  },
  {
    id: 'tr-east-cross',
    name: '东翼轨道上山',
    path: [
      [170, 95],
      [165, 60],
      [160, 35],
    ],
  },
  {
    id: 'tr-heading',
    name: '1203 掘进工作面',
    path: [
      [220, 95],
      [240, 70],
      [258, 52],
      [266, 40],
    ],
  },
];

export const defaultZones = [
  {
    id: 'zone-goaf',
    name: '1101 采空区',
    level: 'danger',
    enabled: true,
    message: '采空区顶板冒落与有害气体风险，严禁人员进入',
    polygon: [
      [30, 145],
      [72, 130],
      [110, 140],
      [112, 185],
      [60, 195],
      [25, 180],
    ],
  },
  {
    id: 'zone-sealed',
    name: '盲巷（已封闭）',
    level: 'danger',
    enabled: true,
    message: '盲巷未通风，存在瓦斯积聚与窒息风险',
    polygon: [
      [138, 8],
      [185, 5],
      [190, 30],
      [172, 45],
      [142, 38],
    ],
  },
  {
    id: 'zone-substation',
    name: '中央变电所',
    level: 'warning',
    enabled: true,
    message: '带电设备硐室，非工作人员禁止入内',
    polygon: [
      [232, 118],
      [268, 112],
      [274, 142],
      [240, 150],
    ],
  },
];

export const defaultWorkers = [
  { tagId: 'T001', name: '李建国', dept: '综采一队', role: '采煤机司机' },
  { tagId: 'T002', name: '王海涛', dept: '综采一队', role: '支架工' },
  { tagId: 'T003', name: '张伟', dept: '掘进二队', role: '掘进机司机' },
  { tagId: 'T004', name: '刘强', dept: '掘进二队', role: '支护工' },
  { tagId: 'T005', name: '陈明亮', dept: '通风队', role: '瓦斯检查工' },
  { tagId: 'T006', name: '赵德胜', dept: '机电队', role: '变配电工' },
  { tagId: 'T007', name: '孙建军', dept: '运输队', role: '电机车司机' },
  { tagId: 'T008', name: '周永福', dept: '安全科', role: '安全员' },
  { tagId: 'T009', name: '吴长青', dept: '综采一队', role: '检修工' },
];
