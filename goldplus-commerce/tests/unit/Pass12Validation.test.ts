import { describe, it, expect, vi } from 'vitest';
import { isValidUgandanPhone, normalizePhone } from '../../apps/api/src/application/services/validationHelpers';
import { OpenSupportTicketUseCase } from '../../apps/api/src/application/use-cases/governance/OpenSupportTicketUseCase';
import { ReportFakeProductUseCase } from '../../apps/api/src/application/use-cases/governance/ReportFakeProductUseCase';

describe('Validation Utility Functions', () => {
  it('should recognize and normalize valid Ugandan formats', () => {
    const examples = ['0700111222', '256700111222', '+256 700 111 222', '700111222'];
    examples.forEach(e => {
      expect(isValidUgandanPhone(e)).toBe(true);
      expect(normalizePhone(e)).toBe('+256700111222');
    });
    expect(isValidUgandanPhone('071122334455')).toBe(false);
    expect(isValidUgandanPhone('123456789')).toBe(false);
  });
});

describe('Form Use Cases (Validation)', () => {
  it('OpenSupportTicket requires a phone; email is optional but checked if given', async () => {
    const repo: any = { save: vi.fn() };
    const uc = new OpenSupportTicketUseCase(repo);

    // Phone is the channel we reply on, so it is the one that is required.
    const noPhone = await uc.execute({
      subject: 'Hi',
      description: 'Need assistance urgently please help me.',
      email: 'user@test.com',
      phone: '123'
    });
    expect(noPhone.ok).toBe(false);
    expect(noPhone.message).toContain('phone number');

    // A malformed email is still refused — silently dropping it would lose a
    // contact the customer meant to give.
    const badRes = await uc.execute({
      subject: 'Hi',
      description: 'Need assistance urgently please help me.',
      email: 'invalid',
      phone: '0770123456'
    });
    expect(badRes.ok).toBe(false);
    expect(badRes.message).toContain('email address');

    // No email at all is fine.
    const noEmail = await uc.execute({
      subject: 'Valid title here',
      description: 'A very detailed descriptive issue that exceeds minimum required chars.',
      email: '',
      phone: '0770123456'
    });
    expect(noEmail.ok).toBe(true);

    const okRes = await uc.execute({
      subject: 'Valid title here',
      description: 'A very detailed descriptive issue that exceeds minimum required chars.',
      email: 'user@test.com',
      phone: '0770123456'
    });
    
    expect(okRes.ok).toBe(true);
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        email: 'user@test.com',
        phone: '+256770123456'
      })
    }));
  });

  it('ReportFakeProduct should require reporter splits and format them securely', async () => {
    const repo: any = { save: vi.fn() };
    const uc = new ReportFakeProductUseCase(repo);

    const result = await uc.execute({
      locationFound: 'Kampala Central',
      productDescription: 'Cheap box looks bad',
      reporterEmail: 'snitch@fake.co',
      reporterPhone: '0700999888'
    });

    expect(result.ok).toBe(true);
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({
      reporterContact: 'Email: snitch@fake.co | Phone: +256700999888'
    }));
  });
});
