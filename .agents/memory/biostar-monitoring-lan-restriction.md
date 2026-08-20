---
name: BioStar X monitoring API LAN restriction
description: BioStar X monitoring endpoints (scan_picture, monitoring/events) return 403 "Permission Denied" code 20 when called from outside the local LAN — this is not a permissions issue, it's a network-level restriction by BioStar X.
---

## Rule
BioStar X `/api/monitoring/scan_picture` and `/api/monitoring/events` ONLY work when the calling client is on the **same local network (LAN)** as the BioStar X server. Remote access via ngrok, internet, or cloud always gets 403 code 20 `"by":"web"` regardless of operator permissions.

**Why:** BioStar X is an on-premise system. Its monitoring APIs send real-time commands to physical devices. Suprema intentionally restricts this to LAN for security — remote control of biometric devices over the internet is blocked at the application layer.

**How to apply:**
- When BioVisitor X backend is deployed on-premise (same 192.168.x.x LAN as BioStar X), scan_picture WILL work.
- In Replit/ngrok dev environment, device capture will always fail with 403. Webcam is the correct alternative.
- Error signature: `{"Response":{"code":"20","message":"Permission Denied","by":"web"}}`
- Frontend should show "Network restriction" (blue box) not "Permission required" (amber box) for this error.

**Confirmed via:** Live test with BioStar X at supremalatamco.bsx.ngrok.app, device BioStation 3 (192.168.0.26), admin user with Monitoring permission enabled in BioStar X UI.
