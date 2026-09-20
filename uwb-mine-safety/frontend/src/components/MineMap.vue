<template>
  <div class="mine-map">
    <svg :viewBox="`0 0 ${width} ${height}`" class="map-svg"
      @click="onSvgClick" @mousemove="onMouseMove">
      <!-- 网格 -->
      <defs>
        <pattern :id="gridId" width="50" height="50" patternUnits="userSpaceOnUse">
          <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#1b2a42" stroke-width="0.5" />
        </pattern>
        <pattern :id="gridIdMajor" width="100" height="100" patternUnits="userSpaceOnUse">
          <path d="M 100 0 L 0 0 0 100" fill="none" stroke="#243a5c" stroke-width="1" />
        </pattern>
      </defs>
      <rect :width="width" :height="height" :fill="`url(#${gridId})`" />
      <rect :width="width" :height="height" :fill="`url(#${gridIdMajor})`" />

      <!-- 巷道示意（井下主巷/回风巷底图） -->
      <g class="tunnels">
        <path d="M 30 40 L 880 40" />
        <path d="M 30 460 L 600 460 L 760 360 L 880 360" />
        <path d="M 150 40 L 150 460" />
        <path d="M 320 40 L 320 220" />
        <path d="M 600 40 L 600 460" />
        <path d="M 150 360 L 600 360" />
        <circle cx="30" cy="40" r="6" />
        <text x="42" y="36" class="tunnel-label">井口</text>
      </g>

      <!-- 轨迹 -->
      <polyline v-if="track.length > 1" :points="trackPoints" class="track-line" />

      <!-- 围栏 -->
      <g v-for="zone in zones" :key="zone.id">
        <polygon v-if="zone.polygon.length >= 3" :points="polygonPoints(zone.polygon)"
          :class="['zone', `zone-${zone.level}`, { inactive: !zone.isActive, selected: selectedZoneId === zone.id }]" />
        <text v-if="zoneLabel(zone)" :x="zoneLabel(zone)!.x" :y="zoneLabel(zone)!.y" class="zone-label"
          :class="`zone-label-${zone.level}`">{{ zone.name }}</text>
      </g>

      <!-- 编辑中围栏 -->
      <g v-if="editable">
        <polygon v-if="draft.length >= 3" :points="polygonPoints(draft)" class="zone zone-warning zone-draft" />
        <polyline v-else-if="draft.length >= 2" :points="polygonPoints(draft)" class="zone-draft-line" />
        <circle v-for="(p, i) in draft" :key="i" :cx="p.x" :cy="p.y" r="3.5" class="draft-handle" />
        <circle v-if="draft.length > 0 && hoverPoint" :cx="hoverPoint.x" :cy="hoverPoint.y" r="3" class="draft-hover" />
      </g>

      <!-- 人员 -->
      <g v-for="p in people" :key="p.tagId" class="person-g" @click.stop="$emit('select', p.tagId)">
        <circle v-if="p.sos || p.tagId === flashTagId" :cx="p.x" :cy="p.y" r="14" class="sos-ring" />
        <circle :cx="p.x" :cy="p.y" :r="selectedTag === p.tagId ? 8 : 6"
          :class="['person', `person-${p.status}`, { offline: p.status === 'offline' }]" />
        <text v-if="showLabels" :x="p.x + 9" :y="p.y + 4" class="person-label">{{ p.name }}</text>
      </g>
    </svg>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { PersonStatus, Point, Zone } from '../api/types';

interface MapPerson {
  tagId: string;
  name: string;
  status: PersonStatus;
  x: number;
  y: number;
  z: number;
  sos?: boolean;
}

const props = withDefaults(
  defineProps<{
    zones: Zone[];
    people: MapPerson[];
    width?: number;
    height?: number;
    showLabels?: boolean;
    selectedTag?: string | null;
    selectedZoneId?: string | null;
    track?: Point[];
    editable?: boolean;
    draft?: Point[];
    flashTagId?: string | null;
  }>(),
  { width: 920, height: 500, showLabels: true, selectedTag: null, selectedZoneId: null, track: () => [], editable: false, draft: () => [], flashTagId: null },
);

const emit = defineEmits<{
  select: [tagId: string];
  addPoint: [p: Point];
}>();

const gridId = `grid-${Math.random().toString(36).slice(2, 8)}`;
const gridIdMajor = `${gridId}-major`;
const mousePos = ref<Point | null>(null);
const hoverPoint = computed<Point | null>(() =>
  props.editable && props.draft.length > 0 ? mousePos.value : null,
);

function polygonPoints(poly: Point[]): string {
  return poly.map((p) => `${p.x},${p.y}`).join(' ');
}

const trackPoints = computed(() => props.track.map((p) => `${p.x},${p.y}`).join(' '));

function zoneLabel(zone: Zone): Point | null {
  if (zone.polygon.length === 0) return null;
  const xs = zone.polygon.map((p) => p.x);
  const ys = zone.polygon.map((p) => p.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

function svgPoint(ev: MouseEvent): Point {
  const svg = ev.currentTarget as SVGSVGElement;
  const rect = svg.getBoundingClientRect();
  return {
    x: ((ev.clientX - rect.left) / rect.width) * props.width,
    y: ((ev.clientY - rect.top) / rect.height) * props.height,
  };
}

function onSvgClick(ev: MouseEvent) {
  if (props.editable) {
    const p = svgPoint(ev);
    mousePos.value = p;
    emit('addPoint', p);
  }
}

function onMouseMove(ev: MouseEvent) {
  if (props.editable) mousePos.value = svgPoint(ev);
}
</script>

<style scoped>
.mine-map {
  width: 100%;
  background: #0a1322;
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
}
.map-svg {
  display: block;
  width: 100%;
  height: auto;
  cursor: crosshair;
}
.tunnels path {
  fill: none;
  stroke: #334d70;
  stroke-width: 10;
  stroke-linecap: round;
  opacity: 0.55;
}
.tunnels circle {
  fill: #4ea8ff;
}
.tunnel-label {
  fill: var(--text-dim);
  font-size: 12px;
}
.zone {
  stroke-width: 2;
  cursor: pointer;
  transition: opacity 0.2s;
}
.zone-restricted {
  fill: rgba(242, 73, 92, 0.16);
  stroke: var(--danger);
  stroke-dasharray: 8 4;
}
.zone-warning {
  fill: rgba(245, 165, 36, 0.14);
  stroke: var(--warn);
  stroke-dasharray: 6 3;
}
.zone-safe {
  fill: rgba(53, 211, 153, 0.1);
  stroke: var(--ok);
}
.zone.inactive {
  opacity: 0.35;
}
.zone.selected {
  stroke-width: 3;
}
.zone-label {
  text-anchor: middle;
  font-size: 12px;
  font-weight: 600;
  pointer-events: none;
  paint-order: stroke;
  stroke: #0a1322;
  stroke-width: 3px;
}
.zone-label-restricted {
  fill: #ff8a97;
}
.zone-label-warning {
  fill: #ffcf7a;
}
.zone-label-safe {
  fill: #7ee8bd;
}
.zone-draft {
  fill: rgba(78, 168, 255, 0.12);
  stroke: var(--info);
}
.zone-draft-line {
  fill: none;
  stroke: var(--info);
  stroke-dasharray: 4 3;
  stroke-width: 1.5;
}
.draft-handle {
  fill: var(--info);
}
.draft-hover {
  fill: none;
  stroke: var(--info);
  opacity: 0.6;
}
.track-line {
  fill: none;
  stroke: #4ea8ff;
  stroke-width: 2;
  opacity: 0.8;
  stroke-dasharray: 3 2;
}
.person-g {
  cursor: pointer;
}
.person {
  stroke: #0a1322;
  stroke-width: 1.5;
}
.person-active {
  fill: var(--ok);
}
.person-stationary {
  fill: var(--warn);
}
.person.offline {
  fill: #64748b;
}
.sos-ring {
  fill: none;
  stroke: var(--danger);
  stroke-width: 2;
  animation: sos-pulse 1.2s ease-out infinite;
}
@keyframes sos-pulse {
  0% {
    r: 7;
    opacity: 0.9;
  }
  100% {
    r: 22;
    opacity: 0;
  }
}
.person-label {
  fill: var(--text-main);
  font-size: 11px;
  paint-order: stroke;
  stroke: #0a1322;
  stroke-width: 3px;
  pointer-events: none;
}
</style>
