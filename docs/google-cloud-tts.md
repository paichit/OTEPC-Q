# เปิดเสียง Google Cloud Text-to-Speech ใน OTEPC Q

เสียงที่ระบบใช้เท่านั้น: `th-TH-Standard-A` (ภาษาไทย เสียงผู้หญิง) ประโยคเสียง Cloud คือ “ขอเชิญหมายเลขคิว … ที่ห้องประชุมค่ะ” โดยอ่านตัวเลขทีละหลัก ระบบสร้างเสียงครั้งแรกแล้วเก็บ MP3 ใน Supabase Storage แบบส่วนตัวไว้ใช้ซ้ำกับหมายเลขเดิม

## 1. Google Cloud

ใน Google Cloud Project ID `otepc-q` ให้เปิด Billing และ Cloud Text-to-Speech API ก่อน สร้าง Service Account แยกสำหรับ OTEPC Q ใน **IAM & Admin → Service Accounts** หากเลือกวิธี JSON key ให้เข้า Service Account → **Keys → Add key → Create new key → JSON** แล้วเก็บไฟล์ที่ดาวน์โหลดอย่างปลอดภัย ไม่ต้องวางไฟล์นี้ในโปรเจกต์หรือส่งในแชต หากองค์กรปิดการสร้าง JSON key ให้ใช้ Workload Identity Federation แทน ซึ่งต้องปรับส่วนยืนยันตัวตนของ Edge Function เพิ่ม

## 2. Supabase Secret

ไปที่ [Supabase Edge Function Secrets ของ OTEPC Q](https://supabase.com/dashboard/project/pvuhrnvyhyxffudqjams/settings/functions) เพิ่ม Secret ชื่อ `GOOGLE_TTS_SERVICE_ACCOUNT_JSON` โดยนำ **เนื้อหา JSON ทั้งไฟล์** ใส่ในช่อง Value แล้วบันทึก ฟังก์ชันตรวจ `project_id` ใน JSON ว่าเป็น `otepc-q` ไม่ต้องเพิ่ม Secret ที่ขึ้นต้น `VITE_` และไม่ต้องใส่ JSON ลงในไฟล์หน้าเว็บ

ฟังก์ชัน `queue-tts` และถังเก็บเสียงส่วนตัว `queue-tts` ติดตั้งใน Supabase แล้ว Secret จะพร้อมใช้โดยไม่ต้อง deploy ฟังก์ชันซ้ำ

## 3. ทดสอบบนเครื่องจอแสดงผล

เปิด OTEPC Q ในเบราว์เซอร์เครื่องจอแสดงผล เสียงถูกกำหนดเป็น **Google Cloud — ไทยผู้หญิง Standard-A** อยู่แล้ว ไปที่ **ตั้งค่าระบบ** ตรวจว่าสวิตช์เสียงเปิดอยู่ ต้องมีคิวที่กำลังเรียกอยู่ก่อนจึงจะกด **ทดสอบเสียงบนเครื่องนี้** ได้ จากนั้นเปิด **จอแสดงคิว** แล้วกด **เริ่มระบบและเปิดเสียง** หนึ่งครั้ง

การเรียกคิวถัดไปและเรียกซ้ำใช้เสียง Cloud ผ่าน Edge Function หาก Cloud หรืออินเทอร์เน็ตขัดข้อง จอจะแสดงข้อผิดพลาดและไม่เปลี่ยนไปใช้เสียงอื่น การตั้งค่าความดังและความเร็วเก็บเฉพาะเบราว์เซอร์เครื่องนั้น

## 4. การตรวจปัญหา

- ข้อความว่า Secret ยังไม่ได้ตั้งค่า: ตรวจชื่อ Secret ให้ตรงกับ `GOOGLE_TTS_SERVICE_ACCOUNT_JSON`
- Secret ไม่ถูกต้องหรือ Project ID ไม่ตรง: ตรวจ `project_id` ในไฟล์ JSON ต้องเป็น `otepc-q`
- Google OAuth 401/403: ตรวจ Service Account key และสิทธิ์ของบัญชี
- Google Text-to-Speech 403: ตรวจว่าเปิด API และ Billing ใน Google Cloud Project ที่ถูกต้อง
- ปุ่มทดสอบแจ้งว่าไม่มีคิว: เรียกคิวหนึ่งหมายเลขจากหน้าจัดการคิวก่อน
- จอไม่ดัง: ตรวจลำโพงของเครื่องจอแสดงผล สวิตช์เสียง และกด **เริ่มระบบและเปิดเสียง** บนเครื่องนั้น

ไม่ควรส่ง JSON key ทางแชตหรือ commit ลง Git หากรั่วไหลให้ลบ key ใน Google Cloud แล้วออก key ใหม่
