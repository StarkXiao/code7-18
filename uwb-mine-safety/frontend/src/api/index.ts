import { request } from './client';
import type { Alarm, Broadcast, Page, Person, Zone } from './types';

export const api = {
  login(username: string, password: string) {
    return request<{ accessToken: string; user: { id: string; username: string; displayName: string; role: string } }>(
      '/auth/login',
      { method: 'POST', body: { username, password }, auth: false },
    );
  },

  // 人员
  listPersons(query: Record<string, string | number | undefined> = {}) {
    return request<Page<Person>>('/persons', { query });
  },
  personSnapshot() {
    return request<{ items: Person[] }>('/persons/snapshot');
  },
  personTeams() {
    return request<{ items: string[] }>('/persons/teams');
  },
  personDetail(tagId: string) {
    return request<{ person: Person; recentAlarms: Alarm[] }>(`/persons/${encodeURIComponent(tagId)}`);
  },
  personTrack(tagId: string, minutes = 30) {
    return request<{ items: Array<{ x: number; y: number; z: number; measuredAt: string }> }>(
      `/persons/${encodeURIComponent(tagId)}/track`,
      { query: { minutes } },
    );
  },
  createPerson(body: Partial<Person> & { tagId: string; name: string }) {
    return request<Person>('/persons', { method: 'POST', body });
  },
  updatePerson(tagId: string, body: Partial<Person>) {
    return request<Person>(`/persons/${encodeURIComponent(tagId)}`, { method: 'PATCH', body });
  },
  deletePerson(tagId: string) {
    return request<void>(`/persons/${encodeURIComponent(tagId)}`, { method: 'DELETE' });
  },

  // 区域
  listZones() {
    return request<{ items: Zone[] }>('/zones');
  },
  createZone(body: Partial<Zone>) {
    return request<Zone>('/zones', { method: 'POST', body });
  },
  updateZone(id: string, body: Partial<Zone>) {
    return request<Zone>(`/zones/${id}`, { method: 'PATCH', body });
  },
  deleteZone(id: string) {
    return request<void>(`/zones/${id}`, { method: 'DELETE' });
  },

  // 告警
  listAlarms(query: Record<string, string | number | undefined> = {}) {
    return request<Page<Alarm>>('/alarms', { query });
  },
  openAlarmCount() {
    return request<{ active: number; acked: number; open: number; critical: number }>('/alarms/open-count');
  },
  ackAlarm(id: string) {
    return request<Alarm>(`/alarms/${id}/ack`, { method: 'POST' });
  },
  resolveAlarm(id: string, note?: string) {
    return request<Alarm>(`/alarms/${id}/resolve`, { method: 'POST', body: { note } });
  },

  // 广播
  listBroadcasts(query: Record<string, string | number | undefined> = {}) {
    return request<Page<Broadcast>>('/broadcasts', { query });
  },
  sendBroadcast(body: { content: string; targetGroup?: string | null }) {
    return request<Broadcast>('/broadcasts', { method: 'POST', body });
  },
  retryBroadcast(id: string) {
    return request<Broadcast>(`/broadcasts/${id}/retry`, { method: 'POST' });
  },

  // 统计
  overview() {
    return request<Overview>('/stats/overview');
  },
};

export interface Overview {
  persons: { total: number; active: number; stationary: number; offline: number };
  alarms: { open: number; criticalActive: number; todayResolved: number; byType: Record<string, number> };
  anchors: { total: number; online: number };
  personsByTeam: Array<{ team: string; count: number }>;
  generatedAt: string;
}
