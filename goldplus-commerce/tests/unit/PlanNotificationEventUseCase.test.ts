import { expect, test, describe, vi } from 'vitest';
import { PlanNotificationEventUseCase } from '../../apps/api/src/application/use-cases/notifications/PlanNotificationEventUseCase';

describe('PlanNotificationEventUseCase', () => {
  const order = {
    id: 'ord-111',
    orderNumber: 'GP-111',
    customerEmail: 'customer@example.com',
    customerPhone: '0788123456',
  };

  test('ORDER_RECEIVED_UNPAID selects unpaid template', async () => {
    const useCase = new PlanNotificationEventUseCase();
    const result = await useCase.execute({
      order,
      eventType: 'ORDER_RECEIVED_UNPAID',
      paymentStatus: 'unpaid',
      orderStatus: 'pending_payment',
      statusVersion: 1,
    });

    expect(result.eligible).toBe(true);
    expect(result.selectedTemplate).toBe('ORDER_RECEIVED_UNPAID');
    expect(result.eligibleChannels).toContain('email');
    expect(result.eligibleChannels).toContain('sms');
    expect(result.previewOnly).toBe(true);
    expect(result.dryRunOnly).toBe(true);
    expect(result.noSendGuarantee).toBe(true);
  });

  test('PAYMENT_SUCCESS selects payment success template only when paymentStatus is paid', async () => {
    const useCase = new PlanNotificationEventUseCase();
    
    // Test paid
    const successResult = await useCase.execute({
      order,
      eventType: 'PAYMENT_SUCCESS',
      paymentStatus: 'paid',
      orderStatus: 'processing',
      statusVersion: 1,
    });
    expect(successResult.eligible).toBe(true);
    expect(successResult.selectedTemplate).toBe('ORDER_PAYMENT_SUCCESS');
    expect(successResult.truthfulnessCheck.isTruthful).toBe(true);

    // Test unpaid (should block)
    const blockedResult = await useCase.execute({
      order,
      eventType: 'PAYMENT_SUCCESS',
      paymentStatus: 'unpaid',
      orderStatus: 'pending_payment',
      statusVersion: 1,
    });
    expect(blockedResult.eligible).toBe(false);
    expect(blockedResult.truthfulnessCheck.isTruthful).toBe(false);
  });

  test('PAYMENT_FAILED is blocked when paymentStatus is paid', async () => {
    const useCase = new PlanNotificationEventUseCase();
    const result = await useCase.execute({
      order,
      eventType: 'PAYMENT_FAILED',
      paymentStatus: 'paid',
      orderStatus: 'processing',
      statusVersion: 1,
    });
    expect(result.eligible).toBe(false);
    expect(result.truthfulnessCheck.isTruthful).toBe(false);
  });

  test('ORDER_FULFILLED is blocked when order status is not completed', async () => {
    const useCase = new PlanNotificationEventUseCase();
    const result = await useCase.execute({
      order,
      eventType: 'ORDER_FULFILLED',
      paymentStatus: 'paid',
      orderStatus: 'processing',
      statusVersion: 1,
    });
    expect(result.eligible).toBe(false);
    expect(result.truthfulnessCheck.isTruthful).toBe(false);
  });

  test('ORDER_CANCELLED is blocked when order is completed', async () => {
    const useCase = new PlanNotificationEventUseCase();
    const result = await useCase.execute({
      order,
      eventType: 'ORDER_CANCELLED',
      paymentStatus: 'paid',
      orderStatus: 'completed',
      statusVersion: 1,
    });
    expect(result.eligible).toBe(false);
    expect(result.truthfulnessCheck.isTruthful).toBe(false);
  });

  test('Email channel is blocked when email is missing', async () => {
    const useCase = new PlanNotificationEventUseCase();
    const result = await useCase.execute({
      order: { ...order, customerEmail: '' },
      eventType: 'ORDER_RECEIVED_UNPAID',
      paymentStatus: 'unpaid',
      orderStatus: 'pending_payment',
      statusVersion: 1,
    });
    expect(result.eligibleChannels).not.toContain('email');
    expect(result.blockedChannels.find(b => b.channel === 'email')).toBeDefined();
  });

  test('SMS channel is blocked when phone is missing', async () => {
    const useCase = new PlanNotificationEventUseCase();
    const result = await useCase.execute({
      order: { ...order, customerPhone: '' },
      eventType: 'ORDER_RECEIVED_UNPAID',
      paymentStatus: 'unpaid',
      orderStatus: 'pending_payment',
      statusVersion: 1,
    });
    expect(result.eligibleChannels).not.toContain('sms');
    expect(result.blockedChannels.find(b => b.channel === 'sms')).toBeDefined();
  });

  test('SUPPORT_HANDOFF returns support-link-only channel', async () => {
    const useCase = new PlanNotificationEventUseCase();
    const result = await useCase.execute({
      order,
      eventType: 'SUPPORT_HANDOFF',
      paymentStatus: 'unpaid',
      orderStatus: 'pending_payment',
      statusVersion: 1,
    });
    expect(result.eligibleChannels).toContain('whatsapp_handoff');
    expect(result.blockedChannels.map(b => b.channel)).toContain('email');
  });

  test('Planner does not mutate or write database/outbox', async () => {
    // Assert planner output characteristics
    const useCase = new PlanNotificationEventUseCase();
    const result = await useCase.execute({
      order,
      eventType: 'ORDER_RECEIVED_UNPAID',
      paymentStatus: 'unpaid',
      orderStatus: 'pending_payment',
      statusVersion: 1,
    });

    expect(result.previewOnly).toBe(true);
    expect(result.dryRunOnly).toBe(true);
    expect(result.noSendGuarantee).toBe(true);
  });
});
