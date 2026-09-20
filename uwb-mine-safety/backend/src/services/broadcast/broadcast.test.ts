import { describe, expect, it } from 'vitest';
import { renderTemplate } from './index.js';

describe('renderTemplate', () => {
  it('替换已知占位符', () => {
    const out = renderTemplate(
      '警告：{name}（{team}）进入{zone}',
      { name: '王大力', team: '综采一队', zone: '中央变电所' },
      'fallback',
    );
    expect(out).toBe('警告：王大力（综采一队）进入中央变电所');
  });

  it('模板为空时使用兜底文案', () => {
    expect(renderTemplate(null, {}, '默认喊话')).toBe('默认喊话');
    expect(renderTemplate(undefined, { a: 'b' }, '兜底')).toBe('兜底');
  });

  it('未知占位符替换为空串而不是保留花括号', () => {
    expect(renderTemplate('{name}-{unknown}', { name: '李' }, 'x')).toBe('李-');
  });
});
