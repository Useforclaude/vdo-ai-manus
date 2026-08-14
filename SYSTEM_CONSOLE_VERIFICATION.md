# System Console Verification

## Browser smoke check

วันที่ตรวจสอบ: 2026-08-14

| เส้นทาง | ผลการตรวจสอบ | ข้อสังเกต |
|---|---|---|
| `/` | ผ่าน | หน้า editor หลักยังโหลดได้ตามปกติ พร้อม navigation ไปยัง System และ Settings |
| `/settings` | ผ่าน | แสดง administrator access gate เมื่อยังไม่ได้กำหนด bootstrap secret |
| `/system` | ผ่าน | แสดง administrator access gate เดียวกัน จึงไม่เปิดเผยสถานะโครงสร้างพื้นฐานให้ผู้ที่ไม่ได้รับอนุญาต |

Admin console จะเปิดได้หลังกำหนด `CINEFLOW_ADMIN_TOKEN` และผู้ดูแลปลดล็อก session ผ่านหน้าเว็บ โดยการบันทึก provider credentials จะต้องมี `CINEFLOW_CONFIG_ENCRYPTION_KEY` เพิ่มเติมด้วย
