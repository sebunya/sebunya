import { AutomationActionConfig } from '../../domain/automation/Automation';
import { IAutomationInternalActionExecutor, AutomationInternalActionExecutionResult } from '../../application/ports/IAutomationActionRepository';
import { IOrderRepository } from '../../application/use-cases/commerce/CheckoutUseCase';
import { CreateFulfilmentTaskOnOrderPlacedUseCase } from '../../application/use-cases/fulfilment/CreateFulfilmentTaskOnOrderPlacedUseCase';

/** Bounded bridge to existing idempotent internal use cases; unsupported families fail closed. */
export class AutomationInternalActionExecutor implements IAutomationInternalActionExecutor {
  constructor(
    private readonly orders: IOrderRepository,
    private readonly createFulfilmentTask: CreateFulfilmentTaskOnOrderPlacedUseCase
  ) {}

  async isConfigured(action: AutomationActionConfig): Promise<boolean> {
    if (action.family !== 'CREATE_FULFILMENT_TASK') return false;
    const orderId = action.config.orderId;
    if (typeof orderId !== 'string' || !orderId) return false;
    return (await this.orders.findById(orderId)) !== null;
  }

  async execute(action: AutomationActionConfig): Promise<AutomationInternalActionExecutionResult> {
    if (action.family !== 'CREATE_FULFILMENT_TASK') throw new Error('AUTOMATION_INTERNAL_ACTION_NOT_CONFIGURED');
    const orderId = action.config.orderId;
    if (typeof orderId !== 'string' || !orderId) throw new Error('AUTOMATION_FULFILMENT_ORDER_ID_REQUIRED');
    const order = await this.orders.findById(orderId);
    if (!order) throw new Error('AUTOMATION_FULFILMENT_ORDER_NOT_FOUND');
    const result = await this.createFulfilmentTask.execute(order);
    return { effectId: result.taskId, idempotentReplay: !result.created };
  }
}
