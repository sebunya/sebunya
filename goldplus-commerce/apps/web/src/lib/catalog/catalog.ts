import type { ProductPublicDto } from '@goldplus/shared';

/**
 * 1. Resilient Fallback Payload matching the 8 authoritative seeded products
 */
export const LOCAL_SEED_PRODUCTS: ProductPublicDto[] = [
  {
    id: 'b1f8e123-1a2b-4c3d-8e5f-1a2b3c4d5e6f',
    slug: 'goldplus-built-in-cable-power-bank-gp-pd-w3',
    name: 'GoldPlus Built-In Cable Power Bank',
    categoryName: 'Power Devices',
    sku: 'GP-PD-W3',
    modelNumber: 'GP-PD-W3',
    retailPriceUgx: 18000,
    availability: { kind: 'in_stock', quantity: 100 },
    hasImage: true,
    primaryImageUrl: '/products/goldplus-built-in-cable-power-bank-gp-pd-w3.webp',
    verifiedSpecs: {
      capacity: 'Confirm from packaging / official product sheet',
      inputOutputRatings: 'Confirm from packaging / official product sheet',
      connectorTypes: 'Confirm from packaging / official product sheet',
      warranty: 'Confirm from GoldPlus policy'
    },
    hasMissingSpecs: true,
    images: [{ url: '/products/goldplus-built-in-cable-power-bank-gp-pd-w3.webp', alt: 'GoldPlus Built-In Cable Power Bank' }],
    attributeValues: []
  },
  {
    id: 'c2d9f345-2b3c-4d5e-9f0a-2b3c4d5e6f7a',
    slug: 'goldplus-100w-portable-power-station-gp-09',
    name: 'GoldPlus 100W Portable Power Station',
    categoryName: 'Power Devices',
    sku: 'GP-09',
    modelNumber: 'GP-09',
    retailPriceUgx: 18000,
    availability: { kind: 'in_stock', quantity: 100 },
    hasImage: true,
    primaryImageUrl: '/products/goldplus-100w-portable-power-station-gp-09.webp',
    verifiedSpecs: {
      visibleMarking: '100W, confirm technical meaning from packaging',
      capacity: 'Confirm from packaging / official product sheet',
      acDcUsbOutput: 'Confirm from packaging / official product sheet',
      inputRating: 'Confirm from packaging / official product sheet',
      warranty: 'Confirm from GoldPlus policy'
    },
    hasMissingSpecs: true,
    images: [{ url: '/products/goldplus-100w-portable-power-station-gp-09.webp', alt: 'GoldPlus 100W Portable Power Station' }],
    attributeValues: []
  },
  {
    id: 'd3e0a456-3c4d-5e6f-0a1b-3c4d5e6f7a8b',
    slug: 'goldplus-digital-display-power-bank-gp-p07',
    name: 'GoldPlus Digital Display Power Bank',
    categoryName: 'Power Devices',
    sku: 'GP-P07',
    modelNumber: 'GP-P07',
    retailPriceUgx: 18000,
    availability: { kind: 'in_stock', quantity: 100 },
    hasImage: true,
    primaryImageUrl: '/products/goldplus-digital-display-power-bank-gp-p07.webp',
    verifiedSpecs: {
      capacity: 'Confirm from packaging / official product sheet',
      inputOutputRatings: 'Confirm from packaging / official product sheet',
      portTypes: 'Confirm from packaging / official product sheet',
      warranty: 'Confirm from GoldPlus policy'
    },
    hasMissingSpecs: true,
    images: [{ url: '/products/goldplus-digital-display-power-bank-gp-p07.webp', alt: 'GoldPlus Digital Display Power Bank' }],
    attributeValues: []
  },
  {
    id: 'e4f1b567-4d5e-6f7a-1b2c-4d5e6f7a8b9c',
    slug: 'goldplus-magnetic-power-bank-gp-03',
    name: 'GoldPlus Magnetic Power Bank',
    categoryName: 'Power Devices',
    sku: 'GP-03',
    modelNumber: 'GP-03',
    retailPriceUgx: 18000,
    availability: { kind: 'in_stock', quantity: 100 },
    hasImage: true,
    primaryImageUrl: '/products/goldplus-magnetic-power-bank-gp-03.webp',
    verifiedSpecs: {
      capacity: 'Confirm from packaging / official product sheet',
      wirelessChargingSupport: 'Confirm from packaging / official product sheet',
      magneticCompatibility: 'Confirm from packaging / official product sheet',
      inputOutputRatings: 'Confirm from packaging / official product sheet',
      warranty: 'Confirm from GoldPlus policy'
    },
    hasMissingSpecs: true,
    images: [{ url: '/products/goldplus-magnetic-power-bank-gp-03.webp', alt: 'GoldPlus Magnetic Power Bank' }],
    attributeValues: []
  },
  {
    id: 'f5a2c678-5e6f-7a8b-2c3d-5e6f7a8b9c0d',
    slug: 'goldplus-power-bank-with-handle-gp-x03',
    name: 'GoldPlus Power Bank with Handle',
    categoryName: 'Power Devices',
    sku: 'GP-X03',
    modelNumber: 'GP-X03',
    retailPriceUgx: 18000,
    availability: { kind: 'in_stock', quantity: 100 },
    hasImage: true,
    primaryImageUrl: '/products/goldplus-power-bank-with-handle-gp-x03.webp',
    verifiedSpecs: {
      visibleMarking: '100W, confirm technical meaning from packaging',
      capacity: 'Confirm from packaging / official product sheet',
      inputOutputRatings: 'Confirm from packaging / official product sheet',
      ledLightFeature: 'Confirm from packaging / official product sheet',
      warranty: 'Confirm from GoldPlus policy'
    },
    hasMissingSpecs: true,
    images: [{ url: '/products/goldplus-power-bank-with-handle-gp-x03.webp', alt: 'GoldPlus Power Bank with Handle' }],
    attributeValues: []
  },
  {
    id: 'a6b3d789-6f7a-8b9c-3d4e-6f7a8b9c0d1e',
    slug: 'goldplus-slim-power-bank-gp-04',
    name: 'GoldPlus Slim Power Bank',
    categoryName: 'Power Devices',
    sku: 'GP-04',
    modelNumber: 'GP-04',
    retailPriceUgx: 18000,
    availability: { kind: 'in_stock', quantity: 100 },
    hasImage: true,
    primaryImageUrl: '/products/goldplus-slim-power-bank-gp-04.webp',
    verifiedSpecs: {
      capacity: 'Confirm from packaging / official product sheet',
      portTypes: 'Confirm from packaging / official product sheet',
      inputOutputRatings: 'Confirm from packaging / official product sheet',
      warranty: 'Confirm from GoldPlus policy'
    },
    hasMissingSpecs: true,
    images: [{ url: '/products/goldplus-slim-power-bank-gp-04.webp', alt: 'GoldPlus Slim Power Bank' }],
    attributeValues: []
  },
  {
    id: 'str-01-gp-usb-16',
    slug: 'goldplus-16gb-usb-flash-drive',
    name: 'GoldPlus 16GB USB Flash Drive',
    categoryName: 'Storage Devices',
    sku: 'Needs Business Confirmation',
    modelNumber: 'Needs Business Confirmation',
    retailPriceUgx: 18000,
    availability: { kind: 'in_stock', quantity: 100 },
    hasImage: true,
    primaryImageUrl: '/products/goldplus-16gb-usb-flash-drive.webp',
    verifiedSpecs: {
      capacity: '16GB',
      connector: 'USB-A, based on image',
      finish: 'Metal-style finish, based on image'
    },
    hasMissingSpecs: true,
    images: [{ url: '/products/goldplus-16gb-usb-flash-drive.webp', alt: 'GoldPlus 16GB USB Flash Drive' }],
    attributeValues: [
      { name: 'Badge', value: '16GB Storage', unit: null, isVerified: true },
      { name: 'CardShortDescription', value: 'Compact USB storage for everyday files, photos and documents.', unit: null, isVerified: true }
    ]
  },
  {
    id: 'str-02-gp-sd-32',
    slug: 'goldplus-32gb-memory-card',
    name: 'GoldPlus 32GB Memory Card',
    categoryName: 'Storage Devices',
    sku: 'Needs Business Confirmation',
    modelNumber: 'Needs Business Confirmation',
    retailPriceUgx: 18000,
    availability: { kind: 'in_stock', quantity: 100 },
    hasImage: true,
    primaryImageUrl: '/products/goldplus-32gb-memory-card.webp',
    verifiedSpecs: {
      capacity: '32GB',
      productType: 'Memory Card / microSD Card'
    },
    hasMissingSpecs: true,
    images: [{ url: '/products/goldplus-32gb-memory-card.webp', alt: 'GoldPlus 32GB Memory Card' }],
    attributeValues: [
      { name: 'Badge', value: '32GB Storage', unit: null, isVerified: true },
      { name: 'CardShortDescription', value: 'Compact memory card storage for phones, cameras and compatible devices.', unit: null, isVerified: true }
    ]
  },
  {
    id: 'pc-01-gp-mouse',
    slug: 'goldplus-usb-mouse',
    name: 'GoldPlus USB Mouse',
    categoryName: 'PC Accessories',
    sku: 'Needs Business Confirmation',
    modelNumber: 'Needs Business Confirmation',
    retailPriceUgx: 18000,
    availability: { kind: 'in_stock', quantity: 100 },
    hasImage: true,
    primaryImageUrl: '/products/goldplus-usb-mouse.webp',
    verifiedSpecs: {
      connection: 'USB',
      colour: 'Confirm from image/catalogue',
      dpi: 'Confirm before publishing'
    },
    hasMissingSpecs: true,
    images: [{ url: '/products/goldplus-usb-mouse.webp', alt: 'GoldPlus USB Mouse' }],
    attributeValues: [
      { name: 'Badge', value: 'USB Mouse', unit: null, isVerified: true },
      { name: 'CardShortDescription', value: 'Smooth everyday control for laptops, desktops and workstations.', unit: null, isVerified: true }
    ]
  },
  {
    id: 'pc-02-gp-soundcard',
    slug: 'goldplus-usb-sound-card',
    name: 'GoldPlus USB Sound Card',
    categoryName: 'PC Accessories',
    sku: 'Needs Business Confirmation',
    modelNumber: 'Needs Business Confirmation',
    retailPriceUgx: 18000,
    availability: { kind: 'in_stock', quantity: 100 },
    hasImage: true,
    primaryImageUrl: '/products/goldplus-usb-sound-card.webp',
    verifiedSpecs: {
      connection: 'USB-A, based on image',
      controls: 'Visible buttons/indicators, based on image',
      useCase: 'DJs, music producers and computer audio setups'
    },
    hasMissingSpecs: true,
    images: [{ url: '/products/goldplus-usb-sound-card.webp', alt: 'GoldPlus USB Sound Card' }],
    attributeValues: [
      { name: 'Badge', value: 'USB Audio', unit: null, isVerified: true },
      { name: 'CardShortDescription', value: 'USB audio support for DJs, music producers and computer audio setups.', unit: null, isVerified: true }
    ]
  },
  {
    id: 'snd-01-gp-001',
    slug: 'goldplus-wireless-earbuds-gp-001',
    name: 'GoldPlus Wireless Earbuds GP-001',
    categoryName: 'Sound Devices',
    sku: 'Needs Business Confirmation',
    modelNumber: 'GP-001',
    retailPriceUgx: 18000,
    availability: { kind: 'in_stock', quantity: 100 },
    hasImage: true,
    primaryImageUrl: '/products/goldplus-wireless-earbuds-gp-001.webp',
    verifiedSpecs: {
      chargingCase: 'Yes, based on image',
      colour: 'Confirm from image/catalogue',
      bluetoothVersion: 'Confirm before publishing'
    },
    hasMissingSpecs: true,
    images: [{ url: '/products/goldplus-wireless-earbuds-gp-001.webp', alt: 'GoldPlus Wireless Earbuds GP-001' }],
    attributeValues: [
      { name: 'Badge', value: 'Wireless Sound', unit: null, isVerified: true },
      { name: 'CardShortDescription', value: 'Wireless earbuds for music, calls and everyday listening.', unit: null, isVerified: true }
    ]
  },
  {
    id: 'snd-02-gp-002',
    slug: 'goldplus-wireless-earbuds-gp-002',
    name: 'GoldPlus Wireless Earbuds GP-002',
    categoryName: 'Sound Devices',
    sku: 'Needs Business Confirmation',
    modelNumber: 'GP-002',
    retailPriceUgx: 18000,
    availability: { kind: 'in_stock', quantity: 100 },
    hasImage: true,
    primaryImageUrl: '/products/goldplus-wireless-earbuds-gp-002.webp',
    verifiedSpecs: {
      chargingCase: 'Yes, based on image',
      colour: 'Confirm from image/catalogue',
      bluetoothVersion: 'Confirm before publishing'
    },
    hasMissingSpecs: true,
    images: [{ url: '/products/goldplus-wireless-earbuds-gp-002.webp', alt: 'GoldPlus Wireless Earbuds GP-002' }],
    attributeValues: [
      { name: 'Badge', value: 'Everyday Audio', unit: null, isVerified: true },
      { name: 'CardShortDescription', value: 'Wireless earbuds for music, calls and everyday listening.', unit: null, isVerified: true }
    ]
  },
  {
    id: 'snd-03-gp-003',
    slug: 'goldplus-wireless-earbuds-gp-003',
    name: 'GoldPlus Wireless Earbuds GP-003',
    categoryName: 'Sound Devices',
    sku: 'Needs Business Confirmation',
    modelNumber: 'GP-003',
    retailPriceUgx: 18000,
    availability: { kind: 'in_stock', quantity: 100 },
    hasImage: true,
    primaryImageUrl: '/products/goldplus-wireless-earbuds-gp-003.webp',
    verifiedSpecs: {
      chargingCase: 'Yes, based on image',
      colour: 'Confirm from image/catalogue',
      bluetoothVersion: 'Confirm before publishing'
    },
    hasMissingSpecs: true,
    images: [{ url: '/products/goldplus-wireless-earbuds-gp-003.webp', alt: 'GoldPlus Wireless Earbuds GP-003' }],
    attributeValues: [
      { name: 'Badge', value: 'TWS Earbuds', unit: null, isVerified: true },
      { name: 'CardShortDescription', value: 'Wireless earbuds for music, calls and everyday listening.', unit: null, isVerified: true }
    ]
  },
  {
    id: 'snd-04-gp-004',
    slug: 'goldplus-wireless-earbuds-gp-004',
    name: 'GoldPlus Wireless Earbuds GP-004',
    categoryName: 'Sound Devices',
    sku: 'Needs Business Confirmation',
    modelNumber: 'GP-004',
    retailPriceUgx: 18000,
    availability: { kind: 'in_stock', quantity: 100 },
    hasImage: true,
    primaryImageUrl: '/products/goldplus-wireless-earbuds-gp-004.webp',
    verifiedSpecs: {
      chargingCase: 'Yes, based on image',
      colour: 'Confirm from image/catalogue',
      bluetoothVersion: 'Confirm before publishing'
    },
    hasMissingSpecs: true,
    images: [{ url: '/products/goldplus-wireless-earbuds-gp-004.webp', alt: 'GoldPlus Wireless Earbuds GP-004' }],
    attributeValues: [
      { name: 'Badge', value: 'Compact Case', unit: null, isVerified: true },
      { name: 'CardShortDescription', value: 'Wireless earbuds for music, calls and everyday listening.', unit: null, isVerified: true }
    ]
  },
  {
    id: 'snd-05-gp-007',
    slug: 'goldplus-wireless-earbuds-gp-007',
    name: 'GoldPlus Wireless Earbuds GP-007',
    categoryName: 'Sound Devices',
    sku: 'Needs Business Confirmation',
    modelNumber: 'GP-007',
    retailPriceUgx: 18000,
    availability: { kind: 'in_stock', quantity: 100 },
    hasImage: true,
    primaryImageUrl: '/products/goldplus-wireless-earbuds-gp-007.webp',
    verifiedSpecs: {
      chargingCase: 'Yes, based on image',
      colour: 'Confirm from image/catalogue',
      bluetoothVersion: 'Confirm before publishing'
    },
    hasMissingSpecs: true,
    images: [{ url: '/products/goldplus-wireless-earbuds-gp-007.webp', alt: 'GoldPlus Wireless Earbuds GP-007' }],
    attributeValues: [
      { name: 'Badge', value: 'Wireless Sound', unit: null, isVerified: true },
      { name: 'CardShortDescription', value: 'Wireless earbuds for music, calls and everyday listening.', unit: null, isVerified: true }
    ]
  },
  {
    id: 'chg-01-gp-101',
    slug: 'goldplus-usb-wall-charger',
    name: 'GoldPlus USB Wall Charger',
    categoryName: 'Power Devices',
    sku: 'GP-101',
    modelNumber: 'GP-101',
    retailPriceUgx: 18000,
    availability: { kind: 'in_stock', quantity: 100 },
    hasImage: true,
    primaryImageUrl: '/products/goldplus-charger-gp-101.webp',
    verifiedSpecs: {
      portConfiguration: 'Confirm from packaging / official product sheet',
      outputRating: 'Confirm from packaging / official product sheet',
      plugType: 'Confirm from packaging / official product sheet',
      cableIncluded: 'Confirm from packaging / official product sheet',
      warranty: 'Confirm from GoldPlus policy'
    },
    hasMissingSpecs: true,
    images: [{ url: '/products/goldplus-charger-gp-101.webp', alt: 'GoldPlus USB Wall Charger' }],
    attributeValues: [
      { name: 'Badge', value: 'USB Charging', unit: null, isVerified: true },
      { name: 'CardShortDescription', value: 'Reliable plug-in charging for everyday USB devices.', unit: null, isVerified: true }
    ]
  },
  {
    id: 'chg-02-gp-103',
    slug: 'goldplus-dual-usb-charger',
    name: 'GoldPlus Dual USB Charger',
    categoryName: 'Power Devices',
    sku: 'GP-103',
    modelNumber: 'GP-103',
    retailPriceUgx: 18000,
    availability: { kind: 'in_stock', quantity: 100 },
    hasImage: true,
    primaryImageUrl: '/products/goldplus-dual-usb-wall-charger-gp-103.webp',
    verifiedSpecs: {
      portConfiguration: 'Dual USB ports visible; confirm exact type from packaging',
      outputRating: 'Confirm from packaging / official product sheet',
      plugType: 'Confirm from packaging / official product sheet',
      cableIncluded: 'Confirm from packaging / official product sheet',
      warranty: 'Confirm from GoldPlus policy'
    },
    hasMissingSpecs: true,
    images: [{ url: '/products/goldplus-dual-usb-wall-charger-gp-103.webp', alt: 'GoldPlus Dual USB Charger' }],
    attributeValues: [
      { name: 'Badge', value: 'Dual USB', unit: null, isVerified: true },
      { name: 'CardShortDescription', value: 'Simple two-port charging for everyday devices.', unit: null, isVerified: true }
    ]
  },
  {
    id: 'chg-03-gp-104',
    slug: 'goldplus-usb-c-charger-set',
    name: 'GoldPlus USB-C Charger Set',
    categoryName: 'Power Devices',
    sku: 'GP-104',
    modelNumber: 'GP-104',
    retailPriceUgx: 18000,
    availability: { kind: 'in_stock', quantity: 100 },
    hasImage: true,
    primaryImageUrl: '/products/goldplus-usb-c-charger-kit-gp-104.webp',
    verifiedSpecs: {
      cableIncluded: 'USB-C cable visible; confirm exact cable type from packaging',
      outputRating: 'Confirm from packaging / official product sheet',
      portType: 'Confirm from packaging / official product sheet',
      plugType: 'Confirm from packaging / official product sheet',
      warranty: 'Confirm from GoldPlus policy'
    },
    hasMissingSpecs: true,
    images: [{ url: '/products/goldplus-usb-c-charger-kit-gp-104.webp', alt: 'GoldPlus USB-C Charger Set' }],
    attributeValues: [
      { name: 'Badge', value: 'Cable Included', unit: null, isVerified: true },
      { name: 'CardShortDescription', value: 'Wall charger and USB-C cable for easy daily charging.', unit: null, isVerified: true }
    ]
  },
  {
    id: 'chg-04-gp-105',
    slug: 'goldplus-50w-metal-charger',
    name: 'GoldPlus 50W Metal Charger',
    categoryName: 'Power Devices',
    sku: 'GP-105',
    modelNumber: 'GP-105',
    retailPriceUgx: 18000,
    availability: { kind: 'in_stock', quantity: 100 },
    hasImage: true,
    primaryImageUrl: '/products/goldplus-50w-pd-charger-kit-gp-105.webp',
    verifiedSpecs: {
      visibleMarking: '50W / PD-style marking visible; confirm technical meaning from packaging',
      cableIncluded: 'USB-C cable visible; confirm exact cable type from packaging',
      outputRating: 'Confirm from packaging / official product sheet',
      portConfiguration: 'Confirm from packaging / official product sheet',
      warranty: 'Confirm from GoldPlus policy'
    },
    hasMissingSpecs: true,
    images: [{ url: '/products/goldplus-50w-pd-charger-kit-gp-105.webp', alt: 'GoldPlus 50W Metal Charger' }],
    attributeValues: [
      { name: 'Badge', value: '50W Fast Charge', unit: null, isVerified: true },
      { name: 'CardShortDescription', value: 'Premium high-speed charging with USB-C PD and USB output.', unit: null, isVerified: true }
    ]
  },
  {
    id: 'chg-05-gp-106',
    slug: 'goldplus-compact-charger',
    name: 'GoldPlus Compact Charger',
    categoryName: 'Power Devices',
    sku: 'GP-106',
    modelNumber: 'GP-106',
    retailPriceUgx: 18000,
    availability: { kind: 'in_stock', quantity: 100 },
    hasImage: true,
    primaryImageUrl: '/products/goldplus-compact-usb-wall-charger-gp-106.webp',
    verifiedSpecs: {
      portType: 'Confirm from packaging / official product sheet',
      outputRating: 'Confirm from packaging / official product sheet',
      plugType: 'Confirm from packaging / official product sheet',
      cableIncluded: 'Confirm from packaging / official product sheet',
      warranty: 'Confirm from GoldPlus policy'
    },
    hasMissingSpecs: true,
    images: [{ url: '/products/goldplus-compact-usb-wall-charger-gp-106.webp', alt: 'GoldPlus Compact Charger' }],
    attributeValues: [
      { name: 'Badge', value: 'Everyday Charge', unit: null, isVerified: true },
      { name: 'CardShortDescription', value: 'Compact everyday charging for phones and accessories.', unit: null, isVerified: true }
    ]
  },
  {
    id: 'chg-06-gp-107',
    slug: 'goldplus-50w-pps-charger',
    name: 'GoldPlus 50W PPS Charger',
    categoryName: 'Power Devices',
    sku: 'GP-107',
    modelNumber: 'GP-107',
    retailPriceUgx: 18000,
    availability: { kind: 'in_stock', quantity: 100 },
    hasImage: true,
    primaryImageUrl: '/products/goldplus-50w-pps-charger-kit-gp-107.webp',
    verifiedSpecs: {
      visibleMarking: '50W PPS visible; confirm technical meaning from packaging',
      cableIncluded: 'USB-C cable visible; confirm exact cable type from packaging',
      outputRating: 'Confirm from packaging / official product sheet',
      portConfiguration: 'Confirm from packaging / official product sheet',
      warranty: 'Confirm from GoldPlus policy'
    },
    hasMissingSpecs: true,
    images: [{ url: '/products/goldplus-50w-pps-charger-kit-gp-107.webp', alt: 'GoldPlus 50W PPS Charger' }],
    attributeValues: [
      { name: 'Badge', value: '50W PPS', unit: null, isVerified: true },
      { name: 'CardShortDescription', value: 'High-speed PD and PPS charging for compatible devices.', unit: null, isVerified: true }
    ]
  },
  {
    id: 'chg-07-gp-108',
    slug: 'goldplus-pd-fast-charger',
    name: 'GoldPlus PD Fast Charger',
    categoryName: 'Power Devices',
    sku: 'GP-108',
    modelNumber: 'GP-108',
    retailPriceUgx: 18000,
    availability: { kind: 'in_stock', quantity: 100 },
    hasImage: true,
    primaryImageUrl: '/products/goldplus-super-fast-charger-kit-gp-108.webp',
    verifiedSpecs: {
      visibleMarking: 'Super Fast Charging and multi-output markings visible; confirm technical meaning from packaging',
      cableIncluded: 'Braided USB-C cable visible; confirm exact cable type from packaging',
      outputRating: 'Confirm from packaging / official product sheet',
      portConfiguration: 'Confirm from packaging / official product sheet',
      warranty: 'Confirm from GoldPlus policy'
    },
    hasMissingSpecs: true,
    images: [{ url: '/products/goldplus-super-fast-charger-kit-gp-108.webp', alt: 'GoldPlus PD Fast Charger' }],
    attributeValues: [
      { name: 'Badge', value: 'PD Charging', unit: null, isVerified: true },
      { name: 'CardShortDescription', value: 'Fast dual-port charging with USB-C and USB output.', unit: null, isVerified: true }
    ]
  },
  {
    id: 'car-01-gp-ca03',
    slug: 'goldplus-dual-usb-car-charger-gp-ca03',
    name: 'GoldPlus Dual USB Car Charger',
    categoryName: 'Car Accessories',
    sku: null,
    modelNumber: 'GP-CA03',
    retailPriceUgx: 18000,
    availability: { kind: 'in_stock', quantity: 100 },
    hasImage: true,
    primaryImageUrl: '/products/goldplus-dual-usb-car-charger-gp-ca03.webp',
    verifiedSpecs: {
      ports: '2 USB-A ports, based on image',
      colour: 'Black / White, based on image',
      powerInput: 'Confirm before publishing',
      outputWattage: 'Confirm before publishing',
      fastCharging: 'Confirm before publishing'
    },
    hasMissingSpecs: true,
    images: [{ url: '/products/goldplus-dual-usb-car-charger-gp-ca03.webp', alt: 'GoldPlus Dual USB Car Charger' }],
    attributeValues: [
      { name: 'Badge', value: 'Dual USB', unit: null, isVerified: true },
      { name: 'CardShortDescription', value: 'Two-port USB charging for phones and devices on the road.', unit: null, isVerified: true }
    ]
  }
];

/**
 * 2. Storefront Normalizer for category mapping and inference.
 * Unifies the internal database categories into the 5 approved storefront categories:
 *  - Power Devices
 *  - Sound Devices
 *  - Storage Devices
 *  - Car Accessories
 *  - PC Accessories
 */
export function normalizeProductCategory(product: ProductPublicDto): ProductPublicDto {
  const nameLower = product.name.toLowerCase();
  const rawCat = product.categoryName;

  let inferredCategory = rawCat;

  if (rawCat === 'Power Devices') {
    inferredCategory = 'Power Devices';
  } else if (rawCat === 'Sound Devices') {
    inferredCategory = 'Sound Devices';
  } else {
    // Check keyword patterns for category inference on general/other categories
    const isStorage = /\b(flash|drive|usb|sd|storage|microsd)\b/i.test(product.name);
    const isCar = /\b(car|mount|vehicle)\b/i.test(product.name);
    const isPc = /\b(mouse|mice|sound card|audio card)\b/i.test(product.name);

    if (isPc) {
      inferredCategory = 'PC Accessories';
    } else if (isCar) {
      inferredCategory = 'Car Accessories';
    } else if (isStorage) {
      inferredCategory = 'Storage Devices';
    }
  }

  return {
    ...product,
    categoryName: inferredCategory
  };
}

/**
 * Approved storefront short category label translation maps
 */
export const CATEGORY_SLUG_TO_NAME: Record<string, string> = {
  'power': 'Power Devices',
  'sound': 'Sound Devices',
  'storage': 'Storage Devices',
  'car': 'Car Accessories',
  'pc': 'PC Accessories'
};

export const CATEGORY_NAME_TO_SLUG: Record<string, string> = {
  'Power Devices': 'power',
  'Sound Devices': 'sound',
  'Storage Devices': 'storage',
  'Car Accessories': 'car',
  'PC Accessories': 'pc'
};

/**
 * 3. Query Intent Inference Engine mapping query aliases to approved categories
 */
const QUERY_TO_CATEGORY_MAP: Record<string, string> = {
  // Power Devices
  'charger': 'Power Devices',
  'chargers': 'Power Devices',
  'adapter': 'Power Devices',
  'wall adapter': 'Power Devices',
  'charging brick': 'Power Devices',
  'charging cable': 'Power Devices',
  'cable': 'Power Devices',
  'power bank': 'Power Devices',
  'powerbank': 'Power Devices',
  'fast charger': 'Power Devices',

  // Sound Devices
  'earbuds': 'Sound Devices',
  'earphones': 'Sound Devices',
  'headphones': 'Sound Devices',
  'speaker': 'Sound Devices',
  'speakers': 'Sound Devices',
  'bluetooth speaker': 'Sound Devices',
  'wireless earbuds': 'Sound Devices',
  'audio': 'Sound Devices',

  // Storage Devices
  'flash': 'Storage Devices',
  'flash drive': 'Storage Devices',
  'usb': 'Storage Devices',
  'usb drive': 'Storage Devices',
  'sd card': 'Storage Devices',
  'micro sd': 'Storage Devices',
  'microsd': 'Storage Devices',
  'memory card': 'Storage Devices',
  'external drive': 'Storage Devices',
  'external ssd': 'Storage Devices',
  'storage': 'Storage Devices',

  // Car Accessories
  'car': 'Car Accessories',
  'car charger': 'Car Accessories',
  'vehicle charger': 'Car Accessories',
  'mount': 'Car Accessories',
  'phone mount': 'Car Accessories',
  'dashboard mount': 'Car Accessories',
  'dash mount': 'Car Accessories',
  'vent mount': 'Car Accessories',
  'windshield mount': 'Car Accessories',

  // PC Accessories
  'mouse': 'PC Accessories',
  'mice': 'PC Accessories',
  'computer mouse': 'PC Accessories',
  'wireless mouse': 'PC Accessories',
  'sound card': 'PC Accessories',
  'sound cards': 'PC Accessories',
  'audio card': 'PC Accessories',
  'usb sound card': 'PC Accessories',
};

export function getQueryIntent(query: string): string | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;

  // Direct exact match first
  if (QUERY_TO_CATEGORY_MAP[needle]) {
    return QUERY_TO_CATEGORY_MAP[needle];
  }

  // Word matching boundary check
  for (const [key, category] of Object.entries(QUERY_TO_CATEGORY_MAP)) {
    if (needle.includes(key) || key.includes(needle)) {
      return category;
    }
  }

  return null;
}

/**
 * 4. Query Search Matcher combining direct search with query intent matches
 * to prevent false empty states on header categories.
 */
export function matchesQuery(product: ProductPublicDto, query: string): boolean {
  if (!query) return true;
  const needle = query.trim().toLowerCase();

  // A. Direct field matching (name, SKU, model number, specs)
  const nameMatch = product.name.toLowerCase().includes(needle);
  const skuMatch = product.sku?.toLowerCase().includes(needle) ?? false;
  const modelMatch = product.modelNumber?.toLowerCase().includes(needle) ?? false;
  
  if (nameMatch || skuMatch || modelMatch) {
    return true;
  }

  // B. Search Query Intent mapping (charger -> Power Devices, earbuds -> Sound Devices, etc.)
  const intentCategory = getQueryIntent(query);
  if (intentCategory && product.categoryName === intentCategory) {
    return true;
  }

  return false;
}

/**
 * 5. Stable sorting implementation for storefront products.
 */
export function sortProducts(products: ProductPublicDto[], sortKey: string): ProductPublicDto[] {
  const list = [...products];

  switch (sortKey) {
    case 'price_low_high':
      return list.sort((a, b) => {
        const pA = a.retailPriceUgx ?? 0;
        const pB = b.retailPriceUgx ?? 0;
        return pA - pB || a.name.localeCompare(b.name);
      });
    case 'price_high_low':
      return list.sort((a, b) => {
        const pA = a.retailPriceUgx ?? 0;
        const pB = b.retailPriceUgx ?? 0;
        return pB - pA || a.name.localeCompare(b.name);
      });
    case 'name_az':
      return list.sort((a, b) => a.name.localeCompare(b.name));
    case 'featured':
    default:
      // Keep static index/id sorting as stable default
      return list.sort((a, b) => a.id.localeCompare(b.id));
  }
}

/**
 * 6. Filters out stale/legacy products from the API/DB results and merges with the canonical LOCAL_SEED_PRODUCTS.
 */
export const STALE_SLUGS = new Set([
  'generic-fast-charger',
  'wireless-earbuds',
  'reinforced-usb-c-cable',
  'heavy-duty-power-bank',
  'bluetooth-rugged-speaker',
  'car-dashboard-mount',
  'usb-3-flash-drive-128gb',
  'portable-audio-headset'
]);

export function getCleanCatalog(apiProducts: ProductPublicDto[]): ProductPublicDto[] {
  // Filter out any stale products from the API array
  const cleanApi = (apiProducts || []).filter(p => p && p.slug && !STALE_SLUGS.has(p.slug));

  // Build a merged array starting with all canonical LOCAL_SEED_PRODUCTS
  const merged = [...LOCAL_SEED_PRODUCTS];

  // Append any non-stale API products if they don't already exist in LOCAL_SEED_PRODUCTS
  for (const apiProd of cleanApi) {
    if (!merged.some(p => p.slug === apiProd.slug)) {
      merged.push(apiProd);
    }
  }

  // Ensure all category metadata is normalized correctly
  return merged.map(p => normalizeProductCategory(p));
}

