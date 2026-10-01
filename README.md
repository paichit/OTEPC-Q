# OTEPC Q — ระบบจัดคิวออนไลน์

React + Vite + Tailwind CSS + Supabase SPA ภาษาไทย ฟอนต์ Kanit รองรับ PC / Tablet / Mobile

คู่มือเชื่อม Codex กับฐานข้อมูลผ่าน MCP: [`คู่มือ-ตั้งค่า-supabase-mcp-codex.md`](./คู่มือ-ตั้งค่า-supabase-mcp-codex.md)

## 1. Database Setup

สร้าง Supabase Project แล้วเปิด SQL Editor และรัน **`supabase/schema.sql` ทั้งไฟล์หนึ่งครั้งในโปรเจกต์ใหม่** ไฟล์นี้มีตารางคิว, ประวัติการเรียก, บัญชีเจ้าหน้าที่แบบไม่มีอีเมล, session, RLS, RPC และ Realtime โปรเจกต์ OTEPC Q เดิมติดตั้งแล้ว **อย่ารัน `schema.sql` ซ้ำ**; migration ประวัติสำหรับฐานเดิมอยู่ใน `supabase/` และการเปลี่ยนมาใช้ username-only อยู่ที่ `supabase/migrate-username-only-auth.sql`

คอลัมน์ตามโจทย์: `id`, `created_at`, `queue_date`, `queue_number`, `service_group`, `counter_number`, `status`, `called_at` เพิ่ม `request_id` สำหรับป้องกันการออกคิวซ้ำเมื่อ retry และ `updated_at` สำหรับเรียงประวัติล่าสุด

- `issue_queue`: นับคิวรายวันแยกกลุ่มภายใน transaction ที่ล็อกระดับวัน แล้วออก `กลุ่มทั่วไป001` / `กลุ่มประสบการณ์001`; A/B ยังคงเป็นรหัสภายในฐานข้อมูล และคิวเก่าที่ออกไปแล้วไม่ถูกเปลี่ยนเลข
- `call_next_in_group`: เลือก waiting ที่เก่าสุดภายในกลุ่มที่ระบุ ปิดเฉพาะคิวปัจจุบันของกลุ่มนั้น และเปลี่ยนคิวถัดไปเป็น calling ใน transaction เดียวกัน แต่ละกลุ่มมีคิวปัจจุบันได้หนึ่งรายการ ถ้าไม่มีคิวรอจะเก็บคิวปัจจุบันของกลุ่มนั้นไว้
- `p_expected`: ตรวจว่าคิวปัจจุบันยังตรงกับที่เจ้าหน้าที่เห็น ป้องกันสองหน้าจอเรียกข้ามคนโดยไม่ได้ตั้งใจ
- `recall_current`: เรียกคิวปัจจุบันซ้ำโดยบันทึกเหตุการณ์ใหม่และส่ง Realtime ไปยังจอแสดงผล
- `cancel_waiting`: ยกเลิกได้เฉพาะคิวสถานะ waiting โดยเจ้าหน้าที่
- `restore_cancelled`: เจ้าหน้าที่คืนคิวที่ยกเลิกในรอบปัจจุบันด้วยเลขเดิม โดยย้ายไปท้ายแถวคิวรอของกลุ่มตนเองและบันทึกเหตุการณ์คืนคิว
- `queue_report`: ส่งออกเหตุการณ์รับคิว เรียกคิว เรียกซ้ำ ยกเลิก และคืนคิว เป็น CSV, Excel (.xlsx) หรือ PDF รวมทุกกลุ่มหรือแยกกลุ่ม เลือกช่วงวันที่ได้
- `queue_call_history`: เจ้าหน้าที่ดูประวัติการเรียกทุกช่วงเวลา พร้อมจำนวนครั้งและเวลาของการเรียกแต่ละครั้ง
- `queue_call_history_current`: เจ้าหน้าที่ดูการเรียกและการยกเลิกของคิวที่ยังอยู่ในรอบปัจจุบัน ไม่รวมคิวจากรอบที่รีเซ็ตแล้ว
- `reset_today`: ลบคิววันนี้ทั้งสองกลุ่มและเริ่มลำดับใหม่ หลังยืนยันใน Custom Modal; ประวัติการเรียกใน `queue_call_events` และรายการยกเลิกใน `queue_cancel_events` ยังคงอยู่
- `queue_snapshot`: คืน waiting/calling ทั้งหมดและประวัติล่าสุด 50 รายการใน snapshot เดียว

วันใหม่คำนวณโดย PostgreSQL ด้วย `Asia/Bangkok` ไม่ต้องลบประวัติทุกคืน เลขคิวเกิน 999 จะเป็น `กลุ่มทั่วไป1000` หรือ `กลุ่มประสบการณ์1000` ไม่ตัดเหลือสามหลัก ทุก RPC ที่เขียนข้อมูลใช้ advisory transaction lock เดียวกันต่อวัน จึงทำงานสอดคล้องกันเมื่อรับคิว เรียกคิว คืนคิว และรีเซ็ตพร้อมกัน

### อัปเดตการเรียกคิวแยกกลุ่ม

สถานะวันที่ 1 ตุลาคม 2569: ติดตั้ง `migrate-group-calling.sql` บนโปรเจกต์ **OTEPC Q (`pvuhrnvyhyxffudqjams`)** แล้ว และตรวจ API จริงได้ `calling_mode = by_group` คิว ประวัติ บัญชีเจ้าหน้าที่ และข้อมูลล็อกเสียงเดิมยังอยู่ครบ ปัจจุบันใช้ฐานร่วมกับ UAT; ทุกเครื่องต้องใช้หน้าเว็บรุ่นรองรับการเรียกแยกกลุ่มและรีเฟรชหลังอัปเดต หน้าเว็บรุ่นรวมกลุ่มเดิมจะเรียกคิวถัดไปไม่ได้

หน้าจัดการคิวแสดงกลุ่มที่ 1 ทางซ้ายและกลุ่มที่ 2 ตรงกลาง แต่ละกลุ่มมีคิวปัจจุบัน ปุ่มเรียกซ้ำ/เรียกถัดไป และรายการรออยู่ใต้กัน ส่วนประวัติล่าสุดทุกกลุ่มอยู่ทางขวา จอแสดงคิวแบ่งซ้าย–ขวาเท่ากัน พร้อมจำนวนรอและ 5 คิวถัดไปของแต่ละกลุ่ม ชื่อและสีใช้ค่ากลุ่มที่ตั้งไว้

สำหรับ **ฐานข้อมูลเดิม** ใช้ไฟล์ [`supabase/migrate-group-calling.sql`](./supabase/migrate-group-calling.sql):

1. แนะนำให้ทดสอบบน Supabase project สำหรับ Dev ก่อน และตรวจ Project ID ก่อนเริ่ม หากเลือกใช้ฐานร่วมกับ UAT ต้องหยุดการเรียกคิวบนหน้าเว็บเก่าและเตรียมอัปเดตหน้าเว็บให้ตรงกับ SQL
2. เปิด SQL Editor ของโปรเจกต์ที่เลือก → New query → วางเนื้อหาทั้งไฟล์ → Run ไฟล์นี้ไม่ลบคิว ประวัติ บัญชี หรือข้อมูล `queue_audio_lease`
3. ตรวจ `.env.local` ให้ชี้โปรเจกต์ที่ติดตั้ง SQL หากเปลี่ยนค่าให้หยุด/เริ่ม `npm run dev` ใหม่ แล้วรีเฟรชหน้าเว็บในเครื่อง
4. ตรวจสถานะด้วย `select public.queue_snapshot()->>'calling_mode';` ต้องได้ `by_group`
5. เรียกคิวของกลุ่มที่ 1 และกลุ่มที่ 2 ตรวจว่าคิวปัจจุบันอยู่พร้อมกันสองกลุ่ม เรียกถัดไป/เรียกซ้ำในกลุ่มหนึ่งต้องไม่เปลี่ยนอีกกลุ่ม และคืนคิวที่ยกเลิกต้องไปท้ายแถวของกลุ่มตนเอง

สำหรับ **ฐานใหม่ที่ยังไม่มีตาราง** ให้รัน `schema.sql` รุ่นปัจจุบันหนึ่งครั้ง ซึ่งรวมการเรียกแยกกลุ่มแล้ว ไม่ต้องรัน migration นี้ซ้ำ

หน้าเว็บจะยังแสดงเค้าโครงแยกกลุ่ม แต่ปิดปุ่มเรียกคิวหาก snapshot ยังไม่มี `calling_mode = by_group` เพื่อป้องกันเรียกผ่าน API แบบรวมกลุ่ม เมื่อเตรียมนำไปใช้กับ UAT ต้องติดตั้ง SQL พร้อมหน้าเว็บรุ่นใหม่และรีเฟรชหน้าจัดการคิวทุกเครื่อง API เดิม `call_next` จะปฏิเสธคำขอจากหน้าเว็บรุ่นเก่าและแจ้งให้รีเฟรช ห้ามรัน migration รุ่นเก่าที่เปลี่ยนระบบกลับเป็นจุดเรียกเดียวหลัง migration นี้

เสียงยังออกจากจอส่วนกลางเพียงเครื่องเดียวและเรียงประกาศทีละรายการทั้งสองกลุ่ม SQL ไฟล์นี้ไม่มีการ deploy Edge Function หรือ push GitHub อัตโนมัติ

### บัญชีเจ้าหน้าที่และชื่อผู้ใช้

หน้าจัดการคิวรับ **ชื่อผู้ใช้ + รหัสผ่าน** โดยไม่ใช้ Supabase Auth และไม่มีอีเมลหรือเบอร์โทรในบัญชีเจ้าหน้าที่ PostgreSQL ตรวจรหัสผ่านผ่าน bcrypt และออก session token แบบสุ่ม 12 ชั่วโมงสำหรับการเข้าสู่ระบบใหม่ หลังรัน [`supabase/migrate-staff-session-12-hours.sql`](./supabase/migrate-staff-session-12-hours.sql) บนฐานเดิม; ฐานเก็บเฉพาะแฮชของรหัสผ่านและ token ตารางบัญชีและ session เปิด RLS และไม่มีสิทธิ์อ่านโดยตรงจากเว็บ คำสั่งเจ้าหน้าที่ทุกตัวตรวจ session ในฐานข้อมูลก่อนทำงาน โปรเจกต์ OTEPC Q ติดตั้ง [`supabase/migrate-username-only-auth.sql`](./supabase/migrate-username-only-auth.sql) แล้วเมื่อ 29 ก.ย. 2569

สร้างบัญชีแรกโดยเจ้าของโปรเจกต์:

1. **ไม่ต้องกด Add user ใน Authentication → Users** บัญชีนี้แยกจาก Supabase Auth โดยสิ้นเชิง
2. Supabase Dashboard → SQL Editor: รันคำสั่งด้านล่างหลังแทน `staff01` ด้วยชื่อผู้ใช้ที่ต้องการ และแทน `รหัสผ่านที่ตั้งเองอย่างน้อย12ตัว` ด้วยรหัสผ่านใหม่ที่คุณตั้งเอง ห้ามใส่รหัสผ่านใน repo หรือแชต

```sql
insert into public.staff_accounts (username, password_hash)
values ('staff01', extensions.crypt('CHANGE_TO_YOUR_OWN_LONG_PASSWORD', extensions.gen_salt('bf', 12)))
returning username;
```

3. ตรวจว่าผล SQL แสดงชื่อผู้ใช้หนึ่งแถว ชื่อผู้ใช้ต้องเป็นอังกฤษตัวเล็ก 3–32 ตัวและขึ้นต้นด้วยตัวอักษร รหัสผ่านต้องยาวอย่างน้อย 12 ตัวและไม่เกิน 72 ไบต์ (ข้อจำกัดของ bcrypt)
4. เปิดหน้าเว็บ OTEPC Q → จัดการคิว แล้วเข้าสู่ระบบด้วยชื่อผู้ใช้และรหัสผ่านที่ตั้งในข้อ 2 การออกจากระบบเพิกถอน token ทันที

คำสั่ง SQL สำหรับสร้างบัญชีควรรันจาก Dashboard ของเจ้าของโปรเจกต์เท่านั้น และไม่ควรบันทึกรหัสผ่านตัวจริงไว้ในไฟล์ SQL หรือภาพหน้าจอ หากรหัสผ่านหลุด ให้สร้างแฮชใหม่และลบ session เดิม การเข้าสู่ระบบผิด 5 ครั้งจะล็อกบัญชี 15 นาที ไม่เก็บรหัสผ่านหรือ token แบบตัวอักษรธรรมดาในตาราง

เพราะไม่มีอีเมล ระบบจึงไม่มีปุ่ม "ลืมรหัสผ่าน" ทางอีเมล หากลืมรหัส เจ้าของโปรเจกต์ต้องตั้งใหม่จาก SQL Editor และเพิกถอน session เดิม:

```sql
with updated as (
  update public.staff_accounts
  set password_hash = extensions.crypt('CHANGE_TO_YOUR_NEW_LONG_PASSWORD', extensions.gen_salt('bf', 12)),
      failed_attempts = 0, locked_until = null
  where username = 'staff01'
  returning id
)
delete from public.staff_sessions where staff_id in (select id from updated);
```

ผู้ใช้ทั่วไปออกคิวและดูคิววันนี้ได้ แต่เรียกคิว เรียกซ้ำ ยกเลิก รีเซ็ต หรืออ่านประวัติการเรียกผ่าน RPC ไม่ได้หากไม่มี session token เจ้าหน้าที่ที่ยังใช้งานได้

## 2. Project Structure

```text
supabase/schema.sql         # PostgreSQL, RLS, RPC, Realtime
supabase/migrate-username-only-auth.sql # เปลี่ยนฐานเดิมเป็นบัญชีไม่มีอีเมล
src/
  App.jsx                   # Navigation + shared state + lazy views
  main.jsx
  styles.css                # Tailwind + responsive display styles
  supabaseClient.js
  components/
    CustomerKiosk.jsx
    StaffDashboard.jsx
    QueueDisplay.jsx
    Settings.jsx
    Modal.jsx               # accessible native dialog, custom appearance
  hooks/
    useQueues.js            # initial snapshot + Realtime + reconnect
    useAction.js            # immediate ref lock + loading state
    useAnnouncements.js     # Web Speech API + sequential announcement queue
  lib/queue.js              # settings validation, date, TTS formatting
  services/refreshQueue.js  # serialized snapshot reads
scripts/measure-build.mjs    # initial JS / CSS / gzip size report
docs/architecture-performance.md
tests/                      # unit / database / migration / browser tests
.env.example
.gitignore
vite.config.js
vercel.json
```

## 3. Environment & Security

คัดลอก `.env.example` เป็น `.env.local`:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

ใช้ **Anon key หรือ Publishable key** เท่านั้น ห้ามใส่ `service_role` / Secret key ค่า `VITE_*` จะถูกฝังใน JavaScript ที่ผู้ใช้เปิดดูได้ ดังนั้น `.env` แยก configuration และป้องกัน commit โดยไม่ตั้งใจ แต่ไม่ได้ซ่อน key จากผู้ใช้ ความปลอดภัยของข้อมูลอยู่ที่ RLS และ RPC permissions

`.gitignore` ไม่เก็บ `node_modules`, `dist`, `.env`, `.env.*`, `.vercel` และ logs แต่เก็บ `.env.example` ที่ไม่มีข้อมูลจริง

## 4. Supabase Client

`src/supabaseClient.js` อ่านค่าด้วย `import.meta.env` แล้วสร้าง client ด้วย `createClient(url, key)` มี RPC wrapper ที่โยนข้อผิดพลาดให้ UI แสดงผ่าน Modal หากยังไม่มี config หน้าจอจะบอกขั้นตอนตั้งค่า และปิดปุ่มรับคิว

## 5. Components และพฤติกรรม

- **CustomerKiosk.jsx**: ปุ่มกลุ่มทั่วไปสี `#B1F8F2` และกลุ่มประสบการณ์สี `#AAF683` พร้อมข้อความสีดำ แสดงหมายเลขคิวใน Modal โดยไม่มีปุ่มพิมพ์; retry ใช้ request ID เดิมเพื่อไม่ออกเลขซ้ำ
- **StaffDashboard.jsx**: login ด้วยชื่อผู้ใช้/รหัสผ่าน, เรียกคิวแยกกลุ่มตามลำดับเวลาภายในกลุ่ม, Next/เรียกซ้ำแยกกลุ่ม, ยกเลิกเฉพาะคิวรอ, ยืนยัน reset และการ์ด 3 คอลัมน์ (กลุ่มที่ 1, กลุ่มที่ 2, ประวัติล่าสุด) ประวัติในหน้าหลักไม่เกิน 50 รายการ มีหน้าต่างประวัติรอบปัจจุบันและประวัติทั้งหมดแยกกัน
- รายงานคิว: เจ้าหน้าที่เลือกช่วงวันที่ รูปแบบ CSV / Excel (.xlsx) / PDF และส่งออกข้อมูลรวมทุกกลุ่มหรือแยกกลุ่มได้ PDF ฝังฟอนต์ Sarabun ภาษาไทยจาก `public/fonts/` พร้อมใบอนุญาต OFL
- ชื่อกลุ่ม: เข้าสู่ระบบเจ้าหน้าที่ก่อน แล้วไปหน้าตั้งค่าเพื่อแก้ชื่อกลุ่มทั้งสอง (1–40 ตัวอักษร ชื่อไม่ซ้ำกัน) ชื่อเก็บส่วนกลางใน Supabase และใช้ร่วมกันในปุ่มรับคิว หมายเลขที่แสดง จอคิว ประวัติ รายงาน และเสียงประกาศ ตัวระบุกลุ่ม A/B และเลขลำดับที่บันทึกในฐานข้อมูลยังคงเดิม การเปลี่ยนชื่อจึงไม่เริ่มเลขใหม่
- สี: พิมพ์รหัส HEX ฐาน 16 จำนวน 6 หลัก เช่น `#B1F8F2` หรือ `B1F8F2` ได้ทุกช่องสี หรือเลือกจากตัวเลือกสี การตั้งค่าสียังเก็บเฉพาะเบราว์เซอร์เครื่องนั้น

สำหรับฐานเดิม ให้ติดตั้งชื่อกลุ่มส่วนกลางก่อนใช้หน้าเว็บรุ่นนี้ และ deploy ฟังก์ชันเสียงที่อ่านชื่อใหม่:

```powershell
npx supabase db query --linked --project-ref <project-ref> --file supabase/migrate-shared-group-names.sql
npx supabase functions deploy queue-tts --project-ref <project-ref>
```
- **QueueDisplay.jsx**: overlay คลิกเริ่มเสียง, ปุ่มเต็มจอ, จอแบ่งซ้าย–ขวาตามกลุ่ม แต่ละกลุ่มมีคิวปัจจุบัน จำนวนรอ และ 5 คิวถัดไปของตัวเอง สีตามการตั้งค่า และข้อความวิ่งแม้ยังไม่มีคิวถูกเรียก
- **Settings.jsx**: ข้อความวิ่งสำหรับช่วงมีคิวและช่วงยังไม่มีคิว พร้อมสีจอแสดงผล, เสียง Google Cloud `th-TH-Standard-A` เท่านั้น, ปรับความเร็ว/ความดัง และทดสอบเสียงบนเครื่องจอแสดงผล การตั้งค่าเฉพาะเครื่องเก็บใน `localStorage`

Realtime ใช้ `.channel().on('postgres_changes', ...).subscribe()` รับ event แล้วอ่าน snapshot ใหม่ ไม่มี polling ข้อมูลคิวหรือการ reload หน้าอัตโนมัติ (นาฬิกาใช้ timer แยกเฉพาะ UI) มีการอ่านใหม่หนึ่งครั้งเมื่อเชื่อมต่อสำเร็จ กลับมา online/เปิดแท็บ และที่ขอบเขตเที่ยงคืนไทยเพื่อเปลี่ยนวันที่ แม้ไม่มี event ใหม่

เสียงประกาศออกเฉพาะหน้าจอ Display หลังผู้ใช้คลิกเริ่มระบบ และใช้ Google Cloud Text-to-Speech เสียง `th-TH-Standard-A` เท่านั้น ประโยคเริ่มต้นคือ “ขอเชิญบัตรคิว … ที่ห้องประชุมค่ะ” โดยอ่านเลขทีละหลัก ฟังก์ชันตรวจคิวที่กำลังเรียกจริงก่อนสร้าง MP3 แล้วเก็บไฟล์ไว้ใช้ซ้ำกับหมายเลขเดิม หาก Cloud หรืออินเทอร์เน็ตขัดข้อง จอจะแสดงข้อผิดพลาดโดยไม่เปลี่ยนไปใช้เสียงอื่น เปิดเสียงบนจอส่วนกลางเพียงเครื่องเดียวเพื่อไม่ให้ประกาศซ้อนกัน ดู [คู่มือเชื่อม Cloud TTS](docs/google-cloud-tts.md)
## 6. Local และ Deployment

ใช้ Node.js 22.12+ หรือ Node.js 24:

```powershell
npm install
Copy-Item .env.example .env.local
# แก้ค่าใน .env.local และรัน SQL ใน Supabase
npm run dev
```

เปิด `http://localhost:5173` แล้วเลือกหน้าจาก Navigation ด้านบน ต้อง restart Vite เมื่อแก้ `.env.local`

```powershell
npm test
npm run test:browser
npm run build
npm run preview
```

Browser tests ใช้ Google Chrome ที่ติดตั้งในเครื่องและ mock API; หากไม่มี Chrome ให้ติดตั้งด้วย `npx playwright install chrome` ก่อนรัน

### Vercel

1. Push โปรเจกต์ไป Git repository แล้ว Import Project ใน Vercel
2. เลือก Framework Preset **Vite**, Build Command `npm run build`, Output Directory `dist`
3. ใน Project Settings → Environment Variables เพิ่ม `VITE_SUPABASE_URL` และ `VITE_SUPABASE_ANON_KEY` ตั้ง scope Production และ Preview ตามต้องการ
4. Deploy; เมื่อเปลี่ยนตัวแปรต้อง Redeploy เพราะ Vite อ่านค่าตอน build มี `vercel.json` สำหรับ SPA fallback
5. ทดสอบรับคิวจากมือถือพร้อมเปิด Display อีกเครื่อง ทดสอบเจ้าหน้าที่เรียกคิว แล้วตรวจว่า Realtime และเสียงทำงานจริง

### ขอบเขตการตรวจสอบ

Unit tests ตรวจข้อความเสียง เขตเวลา และ settings; database tests ใช้ PostgreSQL แบบ embedded ผ่าน PGlite ตรวจ RPC, constraints, สิทธิ์, bcrypt และ session ไม่จำลอง Supabase Realtime/WebSocket จริง การทดสอบ race ข้ามหลาย database connections, การใช้งานเต็มจอบนอุปกรณ์จริง และคุณภาพเสียงต้องตรวจใน staging Supabase/อุปกรณ์จริงเพิ่มเติม

ระบบออกคิว anonymous ตามโจทย์ หากเปิดให้รับคิวจากอินเทอร์เน็ตสาธารณะที่มีปริมาณสูง ควรเพิ่มการจำกัดจำนวนคำขอต่ออุปกรณ์หรือ CAPTCHA ผ่าน Edge Function ตามนโยบายหน่วยงาน

เอกสารอ้างอิง: [Supabase Realtime](https://supabase.com/docs/guides/realtime/postgres-changes), [Database functions](https://supabase.com/docs/guides/database/functions), [API keys](https://supabase.com/docs/guides/getting-started/api-keys), [Tailwind + Vite](https://tailwindcss.com/docs/installation/using-vite), [Vercel environment variables](https://vercel.com/docs/environment-variables)





ประวัติการเรียกเก็บแยกจากตารางคิวและไม่ถูกลบเมื่อรีเซ็ต หากย้ายจากระบบรุ่นก่อน migration จะสร้างเหตุการณ์เรียกครั้งแรกจาก called_at เท่าที่มีอยู่ แต่ไม่สามารถกู้จำนวนการเรียกซ้ำในอดีตที่ไม่เคยบันทึกได้


การเปลี่ยนเลขคิวเป็นชื่อกลุ่ม การคืนคิว และรายงาน UAT **ต้องใช้** [`supabase/migrate-uat-groups-and-restore.sql`](supabase/migrate-uat-groups-and-restore.sql) ตามด้วย [`supabase/migrate-uat-cancellation-audit.sql`](supabase/migrate-uat-cancellation-audit.sql) บนฐานเดิม คิวที่ออกก่อน migration ยังใช้เลข A/B เดิม ส่วนคิวใหม่ใช้ชื่อกลุ่ม ระบบจะนับเลขต่อจากคิวเก่าในวันเดียวกัน รายงานเก็บเหตุการณ์ออกคิว เรียก ยกเลิก และคืนคิวต่อจากนี้แม้รีเซ็ตคิวแล้ว และ backfill การออกคิวจากแถวที่ยังอยู่ในฐานก่อน migration; คิวที่ถูกรีเซ็ตจนลบไปก่อนหน้านี้ไม่สามารถกู้เหตุการณ์รับคิวที่ไม่เคยบันทึกได้ การตั้งค่าสีใหม่อยู่ใน localStorage ของแต่ละเครื่อง โดยค่าสีน้ำเงิน/เขียวเริ่มต้นเก่าจะเปลี่ยนเป็นสีพาสเทลเมื่อเปิดเว็บรุ่นใหม่

## โครงสร้างและประสิทธิภาพรุ่นล่าสุด

อ่านรายละเอียดและผลวัดก่อน–หลังใน [architecture-performance.md](docs/architecture-performance.md) หน้า React แยกโหลดตามการใช้งาน, นาฬิกาแยกจากสถานะคิว, คำขอ snapshot ทำทีละคำขอ และลบ CSS เก่าที่ไม่ได้ใช้ โดยไม่เพิ่ม dependency ฝั่ง production

สำหรับฐานข้อมูลที่มีระบบเรียกซ้ำแล้ว ให้รัน [migrate-snapshot-performance.sql](supabase/migrate-snapshot-performance.sql) ก่อน แล้วตามด้วย [migrate-recent-history-50.sql](supabase/migrate-recent-history-50.sql), [migrate-current-and-full-call-history.sql](supabase/migrate-current-and-full-call-history.sql), [migrate-current-history-cancellations.sql](supabase/migrate-current-history-cancellations.sql), [migrate-all-history-cancellations.sql](supabase/migrate-all-history-cancellations.sql) และ [migrate-single-audio-output.sql](supabase/migrate-single-audio-output.sql) เพื่อรองรับ snapshot ล่าสุด 50 คิว, ประวัติรอบปัจจุบันและประวัติทั้งหมดที่รวมคิวถูกยกเลิก รวมถึงล็อกเสียงกลางที่ป้องกันการประกาศจากหลายอุปกรณ์พร้อมกัน; migration เหล่านี้ไม่ลบข้อมูลหรือเปลี่ยน RLS ของคิว สำหรับโปรเจกต์ใหม่ใช้ schema.sql ล่าสุดครั้งเดียว ไม่ต้องรัน migration ย้อนหลัง หลังเพิ่ม migration เสียงแล้ว ให้ deploy Edge Function `queue-audio-lock` ด้วย `npx supabase functions deploy queue-audio-lock --project-ref <project-ref>` การแก้ไฟล์ SQL ในโครงการไม่ได้เปลี่ยนฐานข้อมูล Supabase จริงโดยอัตโนมัติ

ตรวจทั้งหมดด้วย `npm run check` และวัดขนาดหลัง build ด้วย `npm run size`

## 7. คำสั่งสำคัญสำหรับพัฒนาและ UAT

คำสั่งตัวอย่างใช้ PowerShell และไม่ใส่ค่า secret ลงในคำสั่งหรือ Git

### ติดตั้งและเปิดเว็บในเครื่อง

```powershell
npm ci
Copy-Item .env.example .env.local  # ทำครั้งแรกเท่านั้น; ถ้ามี .env.local อยู่แล้วให้ข้าม
# ใส่ Supabase URL และ Anon/Publishable key ใน .env.local
npm run dev
```

เปิด `http://localhost:5173` หากแก้ `.env.local` ให้หยุดแล้วเริ่ม `npm run dev` ใหม่

### ตรวจสอบก่อนส่งขึ้น UAT

```powershell
npm test                # unit และ PostgreSQL จำลอง (PGlite)
npm run test:browser    # browser tests ด้วย Playwright
npm run build            # สร้างเว็บสำหรับ deploy ใน dist/
npm run check            # รัน tests, browser tests และ build ตามลำดับ
npm run size             # สรุปขนาด build
```

ใช้ `npm run check` ก่อน push เพื่อให้ได้ผลตรวจครบชุด หาก Browser test แจ้งว่าไม่มี Chrome ให้รัน `npx playwright install chrome` หนึ่งครั้ง

### Supabase CLI และ migration

```powershell
npx supabase login
npx supabase projects list
npx supabase db query --linked --project-ref pvuhrnvyhyxffudqjams --file supabase/migrate-all-history-cancellations.sql
npx supabase functions deploy queue-audio-lock --project-ref pvuhrnvyhyxffudqjams
npx supabase functions deploy queue-tts --project-ref pvuhrnvyhyxffudqjams
npx supabase db query --linked --project-ref pvuhrnvyhyxffudqjams --file supabase/migrate-uat-groups-and-restore.sql
npx supabase db query --linked --project-ref pvuhrnvyhyxffudqjams --file supabase/migrate-uat-cancellation-audit.sql
```

คำสั่ง migration ใช้กับฐานข้อมูล OTEPC Q ที่มีอยู่แล้วและควรตรวจไฟล์ SQL ก่อนรันทุกครั้ง สามารถใช้ Supabase Dashboard → SQL Editor แล้ววางเนื้อหาไฟล์ migration แทน CLI ได้เช่นกัน **ห้ามรัน `supabase/schema.sql` ซ้ำบนโปรเจกต์เดิม** เพราะเป็นสคริปต์สร้างฐานข้อมูลใหม่ทั้งชุด Secret ของ Google Cloud ให้ตั้งใน Supabase → Edge Function Secrets ตาม [คู่มือ Cloud TTS](docs/google-cloud-tts.md); อย่าใส่ JSON key หรือ service-role key ใน `.env.local`, README หรือ Git

หากใช้ Codex Supabase MCP ตาม [คู่มือ MCP](./คู่มือ-ตั้งค่า-supabase-mcp-codex.md) ให้ตรวจการตั้งค่าและ login ด้วย:

```powershell
codex mcp list
codex mcp login supabase_otepc_q
```

MCP ในคู่มือตั้งเป็นอ่านอย่างเดียว; ใช้ Supabase CLI หรือ Dashboard SQL Editor สำหรับ migration

### ล้างข้อมูลเพื่อเริ่ม UAT ใหม่

ไฟล์ [`supabase/reset-uat-data.sql`](supabase/reset-uat-data.sql) จะล้างคิว เหตุการณ์รับ/เรียก/ยกเลิก/คืนคิว, session เจ้าหน้าที่ และชื่อกลุ่มที่เคยตั้ง แล้วสร้างชื่อกลุ่มเริ่มต้นกลับมา (`กลุ่มทั่วไป` / `กลุ่มประสบการณ์`) คำสั่งทำงานใน transaction เดียวและรีเซ็ตเลข ID ของตารางเหตุการณ์ ส่วนเลขคิวที่ออกใหม่จะเริ่ม `001` ของแต่ละกลุ่ม ID ของคิวเป็น UUID แบบสุ่ม จึงไม่เริ่มจากเลข 1

**คำสั่งนี้ลบประวัติและรายงานเดิมถาวร** หากต้องเก็บไว้ ให้ส่งออกรายงานก่อน ตรวจ Project ID ให้ตรงกับฐาน UAT ที่ต้องการ และหยุดการรับ/เรียกคิวชั่วคราวระหว่างล้างข้อมูล Vercel Preview ของโปรเจกต์นี้เชื่อม Supabase ชุดเดียวกับที่กำหนดไว้ใน Preview

วิธีที่ 1 — เปิด Supabase Dashboard → โปรเจกต์ OTEPC Q → SQL Editor → New query → คัดลอกเนื้อหาไฟล์ `supabase/reset-uat-data.sql` ทั้งไฟล์ → กด Run

วิธีที่ 2 — รันจาก PowerShell ในโฟลเดอร์โปรเจกต์ หลัง `npx supabase login`:

```powershell
npx supabase db query --linked --project-ref pvuhrnvyhyxffudqjams --file supabase/reset-uat-data.sql
```

ตรวจผลใน SQL Editor ด้วยคำสั่งนี้ ตารางที่ล้างต้องเป็น `0` ส่วน `staff_accounts` และ `queue_audio_lease` ต้องยังมีข้อมูล; `queue_group_config` ต้องมี 1 แถว:

```sql
select 'queues' as table_name, count(*) as row_count from public.queues
union all select 'queue_issue_events', count(*) from public.queue_issue_events
union all select 'queue_call_events', count(*) from public.queue_call_events
union all select 'queue_cancel_events', count(*) from public.queue_cancel_events
union all select 'queue_restore_events', count(*) from public.queue_restore_events
union all select 'staff_sessions', count(*) from public.staff_sessions
union all select 'queue_group_config', count(*) from public.queue_group_config
union all select 'staff_accounts', count(*) from public.staff_accounts
union all select 'queue_audio_lease', count(*) from public.queue_audio_lease
order by table_name;
```

หลังล้างข้อมูล ให้รีเฟรชหน้าเว็บทุกแท็บและทุกเครื่อง แล้วเข้าสู่ระบบเจ้าหน้าที่อีกครั้งเพราะ session เดิมถูกลบ `queue_audio_lease` เก็บสิทธิ์จอที่เปิดเสียง ไม่ใช่ไฟล์ MP3; ไฟล์เสียงใน Supabase Storage ไม่ถูกลบโดยคำสั่งนี้

### ส่ง branch เพื่อสร้าง Vercel Preview

```powershell
npm install --global vercel  # ติดตั้งครั้งแรกเท่านั้น
vercel login
vercel link                  # เชื่อม repo กับ Vercel ครั้งแรกเท่านั้น
vercel env ls preview        # ตรวจชื่อ environment variables โดยไม่แสดงค่า
npm run check
git status --short
git switch uat-preview
git add <ไฟล์ที่ต้องการส่ง>
git diff --cached --check
git diff --cached --name-only
git commit -m "Describe the UAT change"
git push
vercel ls
vercel inspect <preview-deployment-url>
```

ครั้งแรกที่สร้าง branch ใช้ `git switch -c uat-preview` และ push ด้วย `git push -u origin uat-preview`; ครั้งต่อไปใช้ `git switch uat-preview` แล้ว `git push` ตามตัวอย่าง หลีกเลี่ยง `git add .` เพื่อให้ตรวจไฟล์ก่อน commit ได้ชัดเจน การ push branch นี้สร้าง Preview; อย่า push เข้า production branch `main` จนกว่าจะพร้อมเผยแพร่

Vercel Preview ของโปรเจกต์นี้ใช้ Supabase OTEPC Q ชุดเดียวกับที่ตั้งไว้ใน Environment Variables ของ Preview ดังนั้นการรับคิว เรียก ยกเลิก หรือรีเซ็ตขณะ UAT จะเปลี่ยนข้อมูลในฐานข้อมูลจริงของโปรเจกต์นี้
