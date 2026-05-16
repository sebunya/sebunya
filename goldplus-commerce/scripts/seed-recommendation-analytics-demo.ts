import fs from "fs";
import path from "path";
import crypto from "crypto";

// 1. ROBUST ENV LOADING (Dependency-free)
try {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, "utf-8");
    envFile.split("\n").forEach(line => {
      const parts = line.split("=");
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join("=").trim();
        if (key && !process.env[key]) {
          process.env[key] = value;
        }
      }
    });
  }
} catch (e) {
  // Ignore env loading errors
}

// 2. IMPORTS (After ENV loading to ensure db client has DATABASE_URL if needed)
import { db } from "../apps/api/src/infrastructure/db/client";
import { recommendationEvents } from "../apps/api/src/infrastructure/db/schema/recommendations";
import { identityLinks } from "../apps/api/src/infrastructure/db/schema/identity";

const uuidv4 = () => crypto.randomUUID();

// SEED CONFIGURATION
const TOTAL_IMPRESSIONS = 150;
const CLICK_RATE = 0.20; // 20%
const ATC_RATE = 0.08;   // 8%
const IDENTITY_LINK_COUNT = 20;

const PLACEMENTS = [
  "home_trending", 
  "product_related", 
  "cart_addon", 
  "category_popular", 
  "recently_viewed"
];

// Valid product IDs from database audit
const PRODUCT_IDS = [
  "27b396dd-55c1-4181-9772-aec1bf4a3dcf", // Wireless Earbuds
  "68001def-f81c-46e3-903e-c3b51e34e8b1", // Generic Fast Charger
  "9a7f612b-68e9-47d5-b9ea-442bc7690a02", // Reinforced USB-C Cable
  "bc1901fa-cfde-49ad-9ccf-818724bbdc6d", // Heavy Duty Power Bank
  "fa7e1a81-c640-4283-bd52-a5d4429ef1e1"  // Bluetooth Rugged Speaker
];

// Valid rule IDs from database audit
const RULE_IDS = [
  "4bf42da1-7a93-459f-a6d0-3280b51fc2b1", 
  "900bda2f-ccf3-4b2d-8134-f18752ebb0b9"
];

async function seed() {
  console.log("----------------------------------------------------------------");
  console.log("GoldPlus: Recommendation Analytics Demo Seed");
  console.log("----------------------------------------------------------------");
  
  if (process.env.NODE_ENV === "production") {
    console.error("CRITICAL ERROR: This script is restricted to local/demo environments only.");
    process.exit(1);
  }

  console.log("Clearing existing recommendation events and links (local only)...");
  // We don't delete existing data unless requested, but for a "clean" demo seed it might be useful.
  // However, the instructions don't say to clear. We will just append.

  const events: any[] = [];
  const links: any[] = [];

  console.log(`Generating ${TOTAL_IMPRESSIONS} impression signal chains...`);

  for (let i = 0; i < TOTAL_IMPRESSIONS; i++) {
    const anonymousId = `anon_${crypto.randomBytes(8).toString("hex")}`;
    const browserId = `browser_${crypto.randomBytes(8).toString("hex")}`;
    const placement = PLACEMENTS[Math.floor(Math.random() * PLACEMENTS.length)];
    const productId = PRODUCT_IDS[Math.floor(Math.random() * PRODUCT_IDS.length)];
    
    // 60% chance of being rule-assisted
    const ruleId = Math.random() > 0.4 ? RULE_IDS[Math.floor(Math.random() * RULE_IDS.length)] : null;
    const attributionId = uuidv4();
    
    // Spread events over the last 14 days
    const date = new Date();
    date.setDate(date.getDate() - Math.floor(Math.random() * 14));
    date.setHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 60));

    // 1. Impression
    events.push({
      id: uuidv4(),
      eventType: "RECOMMENDATION_IMPRESSION",
      anonymousId,
      browserId,
      placement,
      recommendationProductId: productId,
      ruleId,
      attributionId,
      createdAt: date,
      metadata: { demo: true }
    });

    // 2. Click (based on rate)
    if (Math.random() < CLICK_RATE) {
      const clickDate = new Date(date);
      clickDate.setMinutes(clickDate.getMinutes() + Math.floor(Math.random() * 5) + 1);
      
      events.push({
        id: uuidv4(),
        eventType: "RECOMMENDATION_CLICKED",
        anonymousId,
        browserId,
        placement,
        recommendationProductId: productId,
        ruleId,
        attributionId,
        createdAt: clickDate,
        metadata: { demo: true }
      });

      // 3. Add to Cart (based on rate, slightly higher if clicked)
      if (Math.random() < ATC_RATE * 3) {
        const atcDate = new Date(clickDate);
        atcDate.setMinutes(atcDate.getMinutes() + Math.floor(Math.random() * 10) + 2);
        
        events.push({
          id: uuidv4(),
          eventType: "RECOMMENDATION_ADD_TO_CART",
          anonymousId,
          browserId,
          placement,
          recommendationProductId: productId,
          ruleId,
          attributionId,
          cartId: uuidv4(),
          createdAt: atcDate,
          metadata: { demo: true }
        });
      }
    }
  }

  // 4. Generate Health Warning Examples (Missing Attribution)
  console.log("Generating health warning examples (missing attribution)...");
  for (let i = 0; i < 5; i++) {
    events.push({
      id: uuidv4(),
      eventType: "RECOMMENDATION_IMPRESSION",
      anonymousId: uuidv4(),
      placement: "home_trending",
      recommendationProductId: PRODUCT_IDS[0],
      // Missing attributionId and ruleId
      createdAt: new Date(),
      metadata: { demo: true, health_test: true }
    });
  }

  // 5. Generate Identity Links
  console.log(`Generating ${IDENTITY_LINK_COUNT} identity resolution links...`);
  for (let i = 0; i < IDENTITY_LINK_COUNT; i++) {
    const anonymousId = `anon_${crypto.randomBytes(8).toString("hex")}`;
    const isCustomer = Math.random() > 0.4;
    const leadId = !isCustomer ? uuidv4() : null;
    const customerId = isCustomer ? uuidv4() : null;
    
    links.push({
      id: uuidv4(),
      anonymousId,
      leadId,
      customerId,
      linkType: customerId ? "ANONYMOUS_TO_CUSTOMER" : "ANONYMOUS_TO_LEAD",
      linkConfidence: 100,
      createdAt: new Date(),
      metadata: { demo: true }
    });
  }

  console.log(`Inserting ${events.length} events and ${links.length} identity links into database...`);
  
  await db.insert(recommendationEvents).values(events);
  await db.insert(identityLinks).values(links);

  console.log("----------------------------------------------------------------");
  console.log("✅ Seed completed successfully.");
  console.log(`- Impressions: ${events.filter(e => e.eventType === "RECOMMENDATION_IMPRESSION").length}`);
  console.log(`- Clicks: ${events.filter(e => e.eventType === "RECOMMENDATION_CLICKED").length}`);
  console.log(`- Add-to-Carts: ${events.filter(e => e.eventType === "RECOMMENDATION_ADD_TO_CART").length}`);
  console.log(`- Identity Links: ${links.length}`);
  console.log("----------------------------------------------------------------");
  
  process.exit(0);
}

seed().catch(err => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
