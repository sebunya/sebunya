# Luganda: first-pass draft (v1, 2026-10-26)

**Status: DRAFT for a native Luganda speaker to correct. Not live anywhere.**
Written by Claude from the English originals. Machine-drafted Luganda is often stiff or wrong in tone;
nothing here may reach a customer until a fluent speaker has signed off each line.
Placeholders in `{braces}` stay exactly as they are. Prices stay as "UGX 45,000".

| Key | English (live) | Luganda draft | Reviewer fix |
|---|---|---|---|
| nav.shop_all | Shop All | Laba byonna | |
| nav.power | Power | Amasannyalaze | |
| nav.sound | Sound | Eddoboozi | |
| cart.add | Add to basket | Teeka mu kibbo | |
| cart.basket | Basket | Ekibbo | |
| cart.checkout | Checkout | Sasula | |
| stock.in | In stock | Weeri | |
| stock.out | Out of stock | Waggwaawo | |
| delivery.free_pickup | Collect free from our shop | Jjangu okime ku dduuka lyaffe ku bwereere | |
| sms.order_received_unpaid | {shop}: we have your order {ref} for {total}. It is not paid yet. Our team will call you to confirm it. | {shop}: tufunye oda yo {ref} eya {total}. Tennasasulwa. Ttiimu yaffe ejja kukukubira essimu okugikakasa. | |
| sms.payment_success | {shop}: we have your payment of {total} for order {ref}. Your items are being prepared. Track it: {track} | {shop}: tufunye ssente zo {total} ku oda {ref}. Ebintu byo biri mu kutegekebwa. Bigoberere wano: {track} | |
| sms.dispatched | {shop}: your order {ref} is on its way with our rider. Please keep your phone on. | {shop}: oda yo {ref} eri mu kkubo ne boda waffe. Kuuma essimu yo nga eri ku. | |
| sms.delivered | {shop}: your order {ref} has been delivered. Thank you. How was it? | {shop}: oda yo {ref} etuuse. Webale nnyo. Yali etya? | |
| sms.payment_reminder | {shop}: your order {ref} for {due} is saved but not paid yet. Pay here: {track} If you already paid, do not pay again. | {shop}: oda yo {ref} eya {due} ekuumiddwa naye tennasasulwa. Sasula wano: {track} Bw'oba wasasula dda, tosasula nate. | |
| sms.otp | Your {shop} code is {code}. It expires in {min} minutes. Never share this code with anyone. | Koodi yo eya {shop} ye {code}. Eggwaako mu ddakiika {min}. Togiwa muntu yenna. | |
| sms.basket_reminder | {shop}: you left {items} in your basket. It is still here: {url} | {shop}: walekayo {items} mu kibbo kyo. Kikyali wano: {url} | |

## How it goes live once reviewed

1. The reviewer fills the last column (or writes "OK").
2. Claude moves the approved lines into the message templates behind a per-customer language choice
   (default English), and adds a language switch to My preferences.
3. Goldie already answers in Luganda when the shopper writes in it; it does not depend on this file.
