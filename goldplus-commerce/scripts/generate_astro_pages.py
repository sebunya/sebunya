import os
import textwrap

def write_file(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        f.write(textwrap.dedent(content).strip() + '\n')

BASE_WEB = "apps/web/src/pages"

# ==========================================
# 1. Admin Dashboards (Shells)
# ==========================================

pages = {
    'admin/products/index.astro': 'Product Admin Shell',
    'admin/categories/index.astro': 'Category Admin Shell',
    'admin/orders/index.astro': 'Order Admin Shell',
    'admin/payments/index.astro': 'Payment Admin Shell',
    'admin/dealers/index.astro': 'Dealer Applications Admin Shell',
    'admin/quotes/index.astro': 'Quote Admin Shell',
    'admin/campaigns/index.astro': 'Campaign Admin Shell',
    'admin/utm-builder/index.astro': 'UTM Builder Shell',
    'admin/feeds/index.astro': 'Product Feeds Admin Shell',
    'admin/notifications/index.astro': 'Notification Logs Admin Shell',
    'admin/audit/index.astro': 'Audit Logs Admin Shell',
    'admin/reports/index.astro': 'Reports Shell',
    
    # CMS/AEO/Public routes
    'cart.astro': 'Cart',
    'checkout.astro': 'Checkout',
    'support/index.astro': 'Support & Issue Reports',
    'verification/index.astro': 'Product Verification',
    'dealers/apply.astro': 'Dealer Application',
}

for route, title in pages.items():
    write_file(f"{BASE_WEB}/{route}", f"""
    ---
    import BaseLayout from '../../../layouts/BaseLayout.astro';
    ---
    
    <BaseLayout title="{title}">
      <div class="py-8">
        <h1 class="text-3xl font-bold mb-6">{title}</h1>
        <div class="bg-yellow-50 border-l-4 border-yellow-400 p-4">
          <div class="flex">
            <div class="ml-3">
              <p class="text-sm text-yellow-700">
                This is a Phase 1 module shell. Future implementation goes here.
              </p>
            </div>
          </div>
        </div>
      </div>
    </BaseLayout>
    """)

print("Successfully generated all required frontend module shells!")
