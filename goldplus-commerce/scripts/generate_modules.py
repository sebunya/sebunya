import os
import textwrap

def write_file(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        f.write(textwrap.dedent(content).strip() + '\n')

BASE_API = "apps/api/src"

# ==========================================
# 1. Identity & Auth & Roles
# ==========================================
write_file(f"{BASE_API}/domain/identity/UserEntity.ts", """
export class UserEntity {
  constructor(
    public readonly id: string,
    public readonly email: string,
    public readonly isActive: boolean
  ) {}
}
""")

write_file(f"{BASE_API}/application/use-cases/identity/AuthenticateUserUseCase.ts", """
import { DOMAIN_EVENTS } from '@goldplus/shared';
export class AuthenticateUserUseCase {
  constructor(private readonly eventPublisher: any) {}
  async execute(email: string) {
    if(!email) throw new Error("Email required");
    return { token: "mock-token" };
  }
}
""")

write_file(f"{BASE_API}/interfaces/http/routes/auth.ts", """
import { Hono } from 'hono';
export const authRouter = new Hono();
authRouter.post('/login', async (c) => {
  return c.json({ success: true, token: "mock-token" });
});
""")

# ==========================================
# 2. Audit Logs
# ==========================================
write_file(f"{BASE_API}/domain/audit/AuditLogEntity.ts", """
export class AuditLogEntity {
  constructor(
    public readonly id: string,
    public readonly action: string,
    public readonly entityId: string
  ) {}
}
""")

write_file(f"{BASE_API}/application/use-cases/audit/CreateAuditLogUseCase.ts", """
export class CreateAuditLogUseCase {
  async execute(payload: any) {
    // Write to audit_logs table
  }
}
""")

# ==========================================
# 3. Product Catalog (Attributes, Governance, Images, Prices)
# ==========================================
write_file(f"{BASE_API}/domain/products/CategoryEntity.ts", """
export class CategoryEntity {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly isOther: boolean
  ) {}
  
  public canBeAdvertised(): boolean {
    return !this.isOther;
  }
}
""")

write_file(f"{BASE_API}/domain/products/ProductSearchService.ts", """
export class ProductSearchService {
  search(query: string) {
    if (!query) throw new Error("Query required");
    return [];
  }
}
""")

write_file(f"{BASE_API}/domain/products/ProductComparisonService.ts", """
export class ProductComparisonService {
  compare(productIds: string[]) {
    if (productIds.length < 2) throw new Error("Need at least 2 products to compare");
    return [];
  }
}
""")

# ==========================================
# 4. Cart & Checkout
# ==========================================
write_file(f"{BASE_API}/domain/cart/CartEntity.ts", """
export class CartEntity {
  constructor(public id: string, public items: any[]) {}
  public calculateTotal(): number {
    return this.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  }
}
""")

write_file(f"{BASE_API}/application/use-cases/checkout/StartCheckoutUseCase.ts", """
export class StartCheckoutUseCase {
  async execute(cartId: string) {
    if (!cartId) throw new Error("Cart ID required");
    return { checkoutSessionId: "sess-123" };
  }
}
""")

# ==========================================
# 5. Orders & Payment State Machine
# ==========================================
write_file(f"{BASE_API}/domain/orders/OrderEntity.ts", """
export class OrderEntity {
  constructor(
    public readonly id: string,
    public status: 'PENDING_PAYMENT' | 'PAID' | 'CANCELLED'
  ) {}
  
  public markAsPaid() {
    if(this.status !== 'PENDING_PAYMENT') throw new Error("Cannot pay an order not in pending state");
    this.status = 'PAID';
  }
}
""")

write_file(f"{BASE_API}/domain/payments/PaymentStateMachine.ts", """
export class PaymentStateMachine {
  public static transition(currentState: string, event: string): string {
    if (currentState === 'PENDING' && event === 'SUCCESS') return 'PAID';
    if (currentState === 'PENDING' && event === 'FAILED') return 'FAILED';
    throw new Error(`Invalid transition from ${currentState} with event ${event}`);
  }
}
""")

# ==========================================
# 6. Notification Ports & Adapters
# ==========================================
write_file(f"{BASE_API}/application/ports/INotificationProvider.ts", """
export interface INotificationProvider {
  send(recipient: string, message: string): Promise<boolean>;
}
""")

write_file(f"{BASE_API}/infrastructure/notifications/whatsapp/WhatsAppAdapter.ts", """
import { INotificationProvider } from '../../../application/ports/INotificationProvider';
export class WhatsAppAdapter implements INotificationProvider {
  async send(recipient: string, message: string): Promise<boolean> {
    console.log(`WhatsApp integration not configured. Simulating send to ${recipient}`);
    return true;
  }
}
""")

write_file(f"{BASE_API}/infrastructure/notifications/zeptomail/ZeptoMailAdapter.ts", """
import { INotificationProvider } from '../../../application/ports/INotificationProvider';
export class ZeptoMailAdapter implements INotificationProvider {
  async send(recipient: string, message: string): Promise<boolean> {
    console.log(`ZeptoMail integration not configured. Simulating send to ${recipient}`);
    return true;
  }
}
""")

write_file(f"{BASE_API}/infrastructure/notifications/sms/DisabledSmsAdapter.ts", """
import { INotificationProvider } from '../../../application/ports/INotificationProvider';
export class DisabledSmsAdapter implements INotificationProvider {
  async send(recipient: string, message: string): Promise<boolean> {
    throw new Error('SMS Provider is disabled for Phase 1');
  }
}
""")

# ==========================================
# 7. Transactional Outbox
# ==========================================
write_file(f"{BASE_API}/infrastructure/outbox/OutboxProcessor.ts", """
export class OutboxProcessor {
  async processPendingEvents() {
    // Read from outbox_events where isProcessed = false
    console.log('Processing outbox events...');
  }
}
""")

# ==========================================
# 8. Dealers, Quotes, Leads
# ==========================================
write_file(f"{BASE_API}/application/use-cases/quotes/RequestQuoteUseCase.ts", """
export class RequestQuoteUseCase {
  async execute(dto: { isCorporate: boolean, products: any[] }) {
    if(dto.products.length === 0) throw new Error("Cannot request quote for empty product list");
    return { quoteId: "q-123" };
  }
}
""")

write_file(f"{BASE_API}/application/use-cases/leads/CreateLeadUseCase.ts", """
export class CreateLeadUseCase {
  async execute(dto: any) {
    return { leadId: "l-123" };
  }
}
""")

# ==========================================
# 9. Verification & Fake Reports
# ==========================================
write_file(f"{BASE_API}/application/use-cases/verification/ReportFakeProductUseCase.ts", """
export class ReportFakeProductUseCase {
  async execute(dto: { code: string, reason: string }) {
    if(!dto.code) throw new Error("Code is required");
    // Persist fake product report
  }
}
""")

# ==========================================
# 10. SEO, AEO, CMS Foundation
# ==========================================
write_file(f"{BASE_API}/domain/cms/SeoMetadataService.ts", """
export class SeoMetadataService {
  generate(productName: string) {
    return { title: `${productName} | GoldPlus`, description: `Buy original ${productName} in Uganda` };
  }
}
""")

# ==========================================
# 11. Advertising, Tracking, Campaigns
# ==========================================
write_file(f"{BASE_API}/domain/advertising/CampaignReadinessScorer.ts", """
export class CampaignReadinessScorer {
  score(campaign: any, product: any) {
    let score = 100;
    if(!product.hasImage) score -= 20;
    if(!product.hasRetailPrice) score -= 30;
    if(product.stockQuantity === 0) score -= 50;
    return score;
  }
}
""")

write_file(f"{BASE_API}/application/use-cases/advertising/CreateAttributionEventUseCase.ts", """
export class CreateAttributionEventUseCase {
  async execute(payload: any) {
    if (!payload.utmSource) throw new Error("Missing UTM Source");
    // Save attribution
  }
}
""")

print("Successfully generated all required module domains, use-cases, and adapters!")
