import { expect, test, describe } from 'vitest';
import { SupportTicket } from '../../apps/api/src/domain/support/SupportTicket';
import { VerificationAudit } from '../../apps/api/src/domain/support/VerificationAudit';

describe('SupportTicket Domain Entity', () => {
  test('Should create ticket with correct priority based on type', () => {
    const issueTicket = SupportTicket.create('t1', null, 'Issue', 'Desc', 'issue');
    expect(issueTicket.priority).toBe('medium');

    const fakeReport = SupportTicket.create('t2', null, 'Fake', 'Desc', 'fake_report');
    expect(fakeReport.priority).toBe('high');
  });

  test('Should default to open status', () => {
    const ticket = SupportTicket.create('t1', null, 'Sub', 'Desc', 'inquiry');
    expect(ticket.status).toBe('open');
  });
});

describe('VerificationAudit Domain Entity', () => {
  test('Should log verification result correctly', () => {
    const audit = VerificationAudit.log('a1', 'p1', 'GP-123', 'success');
    expect(audit.result).toBe('success');
    expect(audit.inputCode).toBe('GP-123');
  });
});
