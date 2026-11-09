import { describe, expect, it } from 'vitest';
import {
  DataRoutingError,
  assertOutboundAllowed,
  classifyData,
  detectSensitive,
  maskSensitive,
} from '../server/core/routing';
import { AuditLog } from '../server/core/audit';

describe('A6 数据分级路由', () => {
  it('绝密标识 / 身份证 / 银行账号归为 A 类', () => {
    expect(classifyData('本材料为绝密项目资料')).toBe('A');
    expect(classifyData('身份证号：110101199003072316')).toBe('A');
    expect(classifyData('账号 6222020200001234567')).toBe('A');
  });

  it('客户信息 / 金额 / 案卷材料归为 B 类，普通问题归为 C 类', () => {
    expect(classifyData('客户：某某有限公司，合同金额 500000 元')).toBe('B');
    expect(classifyData('格式条款如何尽提示说明义务？')).toBe('C');
  });

  it('A 类数据禁止外部模型调用，本地放行', () => {
    expect(() => assertOutboundAllowed('A', 'cloud')).toThrow(DataRoutingError);
    expect(() => assertOutboundAllowed('A', 'local')).not.toThrow();
    expect(() => assertOutboundAllowed('B', 'cloud')).not.toThrow();
  });

  it('敏感信息可被检测与遮蔽', () => {
    const text = '联系人手机 13812345678，身份证 110101199003072316';
    expect(detectSensitive(text).length).toBeGreaterThan(0);
    const masked = maskSensitive(text);
    expect(masked).not.toContain('13812345678');
    expect(masked).toContain('****');
  });
});

describe('A5 审计事件日志', () => {
  it('append-only，可导出 JSONL 与人类可读报告', () => {
    const log = new AuditLog();
    log.record({ who: '张律师', dataClass: 'B', action: 'chat_start' });
    log.record({ who: '张律师', tool: 'verify_citations', dataClass: 'B', action: 'verification', citation: '《中华人民共和国民法典》第496条', verification: 'demo_only' });
    expect(log.size()).toBe(2);
    expect(log.all()[0].ts).toBeTruthy();
    expect(JSON.parse(log.toJsonl().split('\n')[1]).verification).toBe('demo_only');
    expect(log.toReport()).toContain('执行链审计报告');
    expect(log.toReport()).toContain('verify_citations');
  });
});
