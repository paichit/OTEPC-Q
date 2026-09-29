# คู่มือตั้งค่าและใช้งาน Supabase MCP บน Codex

ระบบจัดคิวออนไลน์อัตโนมัติ OTEPC Q — สำนักงาน ก.ค.ศ.

เอกสารนี้สำหรับผู้ที่เปิด `D:\Project\OTEPC-Q` ด้วย Codex และต้องการให้เอเจนต์ตรวจ schema, RLS, RPC และ Realtime ของระบบคิวอย่างปลอดภัย ค่าเริ่มต้นเป็นโหมดอ่านอย่างเดียว

> ตรวจจาก URL ใน `.env.local` ของโปรเจกต์แล้ว Project ref คือ `pvuhrnvyhyxffudqjams` (ไม่ใช่ข้อมูลลับ) เว็บ React เชื่อม Supabase ได้แล้ว แต่การเชื่อม Codex ผ่าน MCP เป็นการตั้งค่าแยกต่างหาก

**สถานะล่าสุด (29 ก.ย. 2569):** เพิ่ม Supabase MCP แบบอ่านอย่างเดียวใน Codex แล้ว ผู้ใช้ได้ลองขั้นตอน OAuth อีกครั้ง แต่ยังต้องทดสอบเรียก `list_tables` เพื่อยืนยันการใช้งาน MCP จริง Supabase CLI เข้าสู่ระบบสำเร็จ ฐาน OTEPC Q เปลี่ยนเป็นบัญชีเจ้าหน้าที่แบบชื่อผู้ใช้/รหัสผ่านโดยไม่มีอีเมลแล้ว และถอน Edge Function `staff-login` รุ่นเดิม ขั้นต่อไปคือสร้างบัญชีเจ้าหน้าที่ ดู [README.md](./README.md#บัญชีเจ้าหน้าที่และชื่อผู้ใช้)

อ้างอิงทางการ: [การเพิ่ม MCP ใน Codex](https://developers.openai.com/learn/docs-mcp) · [Supabase MCP Server](https://supabase.com/docs/guides/ai-tools/mcp)

## สารบัญ

1. [ข้อมูลโปรเจกต์](#ข้อมูลโปรเจกต์)
2. [สิ่งที่ต้องมีก่อนเริ่ม](#สิ่งที่ต้องมีก่อนเริ่ม)
3. [ตั้งค่า](#ตั้งค่า)
4. [ล็อกอิน](#ล็อกอิน)
5. [ใช้งานในเซสชัน](#ใช้งานในเซสชัน)
6. [MCP กับ Environment ของเว็บ](#mcp-กับ-environment-ของเว็บ)
7. [เปิดสิทธิ์เขียนชั่วคราว](#เปิดสิทธิ์เขียนชั่วคราว)
8. [ปัญหาที่พบบ่อย](#ปัญหาที่พบบ่อย)

## ข้อมูลโปรเจกต์

| รายการ | ค่า |
|---|---|
| MCP URL | `https://mcp.supabase.com/mcp` |
| Project ref | `pvuhrnvyhyxffudqjams` |
| สถานะ MCP ใน Codex | ลงทะเบียน MCP แบบอ่านอย่างเดียวแล้ว; รอทดสอบ `list_tables` เพื่อยืนยัน OAuth และสิทธิ์อ่านจริง |
| โหมดเริ่มต้นที่แนะนำ | อ่านอย่างเดียว `read_only=true` |
| กลุ่มเครื่องมือที่แนะนำ | `database`, `docs` |
| ไฟล์คอนฟิกของ Codex | `%USERPROFILE%\.codex\config.toml` |

Project ref ไม่ใช่ความลับ รหัสผ่านฐานข้อมูล, service role key และค่าใน `.env` เป็นความลับ ทางนี้ใช้หน้าล็อกอิน Supabase ไม่ต้องวางโทเค็นลงไฟล์ และไม่ต้องส่ง connection string ให้เอเจนต์

URL ที่ล็อกกับโปรเจกต์นี้

```text
https://mcp.supabase.com/mcp?project_ref=pvuhrnvyhyxffudqjams&read_only=true&features=database,docs
```

| พารามิเตอร์ | ผล |
|---|---|
| `project_ref` | เห็นเฉพาะโปรเจกต์นี้ เครื่องมือระดับบัญชีถูกปิด |
| `read_only=true` | SQL รันด้วยผู้ใช้อ่านอย่างเดียว |
| `features=database,docs` | จำกัดกลุ่มเครื่องมือไว้ที่ฐานข้อมูลและเอกสาร; `read_only=true` เป็นตัวป้องกันการเขียน SQL |

## สิ่งที่ต้องมีก่อนเริ่ม

1. ติดตั้ง Codex แล้ว หาก PowerShell พิมพ์ `codex` แล้วขึ้นว่า `The term 'codex' is not recognized` ให้ใช้วิธีพาธเต็มในหัวข้อ "ล็อกอิน" ด้านล่าง
2. บัญชี Supabase ที่ถูกเชิญเข้าองค์กรเจ้าของโปรเจกต์นี้
3. เบราว์เซอร์บนเครื่องเดียวกัน สำหรับหน้าอนุญาต
4. ไม่ต้องเตรียม `DATABASE_URL` จาก `.env` มาใส่ในคอนฟิก

Codex เก็บเซิร์ฟเวอร์ MCP ที่ไฟล์ส่วนตัวเครื่อง ไม่ได้อ่าน `.cursor/mcp.json` ของ repo นี้

## ตั้งค่า

เปิด PowerShell แล้วรันคำสั่งนี้ทั้งก้อน ต้องใส่เครื่องหมายคำพูดครอบ URL เพราะใน URL มีเครื่องหมาย `&`

```powershell
codex mcp add supabase_otepc_q --url "https://mcp.supabase.com/mcp?project_ref=pvuhrnvyhyxffudqjams&read_only=true&features=database,docs"
```

คำสั่งนี้เพิ่มบล็อกใน `%USERPROFILE%\.codex\config.toml` โดยไม่ลบเซิร์ฟเวอร์ MCP อื่นที่มีอยู่แล้ว ผลที่ควรเห็นในไฟล์คือ

```toml
[mcp_servers.supabase_otepc_q]
url = "https://mcp.supabase.com/mcp?project_ref=pvuhrnvyhyxffudqjams&read_only=true&features=database,docs"
```

ตรวจรายการที่ลงทะเบียนแล้ว

```powershell
codex mcp list
```

ต้องเห็นชื่อ `supabase_otepc_q` พร้อม URL ด้านบน

ถ้าเพิ่มซ้ำเพราะ URL ผิด ให้ลบแล้วเพิ่มใหม่

```powershell
codex mcp remove supabase_otepc_q
codex mcp add supabase_otepc_q --url "https://mcp.supabase.com/mcp?project_ref=pvuhrnvyhyxffudqjams&read_only=true&features=database,docs"
```

อย่าใช้คีย์ `serverUrl` จากคู่มือ Antigravity และอย่าวางก้อน JSON ของ Cursor ลงใน `config.toml`

## ล็อกอิน

บนเครื่องนี้ Codex CLI อยู่ที่ `C:\Users\HP\AppData\Local\OpenAI\Codex\bin\faa963e871dd422c\codex.exe` แต่ PowerShell บางหน้าต่างไม่มีตำแหน่งนี้ใน `PATH` ให้ใช้คำสั่งพาธเต็มต่อไปนี้ได้ทันที (เครื่องหมาย `&` หน้าเครื่องหมายคำพูดจำเป็นใน PowerShell):

```powershell
& 'C:\Users\HP\AppData\Local\OpenAI\Codex\bin\faa963e871dd422c\codex.exe' mcp login supabase_otepc_q
```

ถ้า Codex อัปเดตแล้วชื่อโฟลเดอร์รหัสเปลี่ยน ให้หาพาธล่าสุดด้วย `Get-ChildItem "$env:LOCALAPPDATA\OpenAI\Codex\bin" -Recurse -Filter codex.exe | Select-Object -ExpandProperty FullName` แล้วแทนที่พาธในคำสั่งข้างบน

ถ้า `codex` ใช้ได้ใน PowerShell ของคุณอยู่แล้ว ใช้รูปแบบสั้นนี้ได้:

```powershell
codex mcp login supabase_otepc_q
```

เบราว์เซอร์จะเปิดหน้า Supabase ให้เลือกองค์กร OTEPC ที่มีโปรเจกต์ OTEPC Q แล้วกดอนุญาต หากเครื่องเปิดเบราว์เซอร์ไม่ได้ ให้ดูตัวเลือกใน `codex mcp login --help` ของ Codex รุ่นที่ติดตั้ง

ถ้าเข้าผิดบัญชี

```powershell
codex mcp logout supabase_otepc_q
codex mcp login supabase_otepc_q
```

เซสชัน Codex ที่เปิดค้างอยู่ก่อนล็อกอินจะยังไม่เห็นเครื่องมือใหม่ ให้ปิดเซสชันนั้นแล้วเปิดใหม่ในโฟลเดอร์ repo

เปิดงาน Codex ใหม่ แล้วสั่งให้ใช้ Supabase MCP เรียก `list_tables` แบบอ่านอย่างเดียว ต้องเห็น `public.queues` และ `public.queue_call_events` จึงนับว่าเชื่อมและใช้งานได้จริง การที่เว็บเปิดได้หรือ `codex mcp list` แสดงชื่อเซิร์ฟเวอร์เพียงอย่างเดียวยังไม่พอ

## ใช้งานในเซสชัน

### สิ่งที่ควรพบในฐาน OTEPC Q

Schema อ้างอิงอยู่ที่ `D:\Project\OTEPC-Q\supabase\schema.sql`

- ตาราง `public.queues` มี `id`, `created_at`, `queue_date`, `queue_number`, `service_group`, `counter_number`, `status`, `called_at`, `cancelled_at`, `updated_at`, `request_id`
- สถานะมี `waiting`, `calling`, `completed`, `skipped` (ค่าเดิม), `cancelled`; กลุ่มบริการมี `A`, `B`
- มีตาราง `public.queue_call_events` สำหรับประวัติเรียกซ้ำ และ `public.staff_accounts`/`public.staff_sessions` สำหรับชื่อผู้ใช้กับ session เจ้าหน้าที่ โดยไม่มีอีเมล
- มี unique constraint สำหรับเลขคิวต่อวันและ `request_id` รวมถึง index ที่ให้มีคิว `calling` ได้หนึ่งคิวต่อวัน เพราะปัจจุบันมีจุดเรียกคิวเดียว
- RPC คือ `issue_queue`, `queue_snapshot`, `staff_login`, `staff_session`, `staff_logout`, `call_next`, `recall_current`, `cancel_waiting`, `queue_call_history`, `reset_today`; ไม่มี `skip_queue`
- เปิด RLS; anonymous อ่านเฉพาะคิววันปัจจุบัน และการเขียนทำผ่าน RPC
- RPC เจ้าหน้าที่ตรวจ session token ที่ฐานเก็บเฉพาะแฮช ไม่มีการใช้ `app_metadata` หรือ Supabase Auth สำหรับเจ้าหน้าที่
- `public.queues` อยู่ใน publication `supabase_realtime`
- วันที่คิวคำนวณด้วย timezone `Asia/Bangkok`

Prompt ตรวจระบบที่แนะนำ:

> ใช้ Supabase MCP ตรวจ schema จริงเทียบกับ `supabase/schema.sql` แบบอ่านอย่างเดียว รายงานเฉพาะความต่างของ columns, constraints, indexes, RLS, grants, functions และ Realtime publication ห้ามเรียก RPC ที่เขียนข้อมูล

ห้ามทดลองเรียก `issue_queue`, `call_next`, `recall_current`, `cancel_waiting` หรือ `reset_today` บน production เพราะ function เหล่านี้เปลี่ยนข้อมูล

เปิด Codex ที่โฟลเดอร์ `D:\Project\OTEPC-Q` แล้วสั่งเป็นภาษาไทยได้ เช่น

> มีตารางอะไรในฐานข้อมูลบ้าง ใช้เครื่องมือ Supabase MCP

> ตรวจ migration ล่าสุดและเปรียบเทียบกับ `supabase/schema.sql` ใช้ MCP แบบอ่านอย่างเดียว

> ค้นเอกสาร Supabase เรื่อง read-only SQL ผ่าน MCP

สิ่งที่เอเจนต์ทำได้ด้วยคอนฟิกนี้

| กลุ่ม | เครื่องมือ | ใช้เมื่อ |
|---|---|---|
| Database | `list_tables`, `list_extensions`, `list_migrations`, `execute_sql` | ดูโครงสร้าง สคีมา และคิวรีอ่าน |
| Docs | `search_docs` | ค้นเอกสาร Supabase |

`execute_sql` ในโหมดนี้รันด้วยผู้ใช้อ่านอย่างเดียว คำสั่ง `INSERT`, `UPDATE`, `DELETE`, `apply_migration` จะไม่ผ่าน

ตอนเอเจนต์จะเรียกเครื่องมือ ให้ดูชื่อเครื่องมือและ SQL ก่อนกดยอมรับ การอนุมัติของ Codex ขึ้นกับการตั้งค่าแอป/CLI ที่ใช้อยู่ ไม่ควรคัดลอกคีย์ TOML ที่ไม่อยู่ในคู่มือ Codex ปัจจุบันลงไปเอง

อย่าสั่งให้เอเจนต์อ่าน `.env` แล้วเอา `DATABASE_URL` ไปคิวรีเอง ทาง MCP ไม่ใช้รหัสนั้น

ตัวอย่างงานที่เหมาะกับโหมดอ่าน

- เทียบฐานจริงกับ `supabase/schema.sql` โดยตรวจตาราง `public.queues`, constraints, indexes, RLS, grants, RPC และ Realtime publication
- ดูรายการ migration ที่ขึ้นฐานแล้ว
- นับแถวหรือตรวจค่าที่สงสัย โดยไม่แก้ข้อมูล
- ค้นวิธีใช้ Postgres หรือ Supabase จากเอกสารทางการ


## MCP กับ Environment ของเว็บ

MCP ใช้ OAuth ของบัญชีนักพัฒนา ส่วน React SPA ใช้ `.env.local`:

```dotenv
VITE_SUPABASE_URL=https://pvuhrnvyhyxffudqjams.supabase.co
VITE_SUPABASE_ANON_KEY=<SUPABASE_ANON_OR_PUBLISHABLE_KEY>
```

ค่า `VITE_*` ถูกฝังใน JavaScript จึงใช้เฉพาะ Anon/Publishable key ความปลอดภัยของเว็บอยู่ที่ RLS และ RPC ห้ามใส่ service role, Secret key, database password หรือ PAT ใน repo, MCP URL หรือแชท

## เปิดสิทธิ์เขียนชั่วคราว

ค่าเริ่มต้นเป็นอ่านอย่างเดียว เพราะฐาน production อาจมีข้อมูลคิวจริง เมื่องานนั้นต้องรัน migration ให้สลับ URL แล้วล็อกอินใหม่

```powershell
codex mcp remove supabase_otepc_q
codex mcp add supabase_otepc_q --url "https://mcp.supabase.com/mcp?project_ref=pvuhrnvyhyxffudqjams&features=database,docs,debugging,development"
codex mcp login supabase_otepc_q
```

URL นี้เปิดเครื่องมือพัฒนาแบบเขียนได้ ควรทดสอบบน development project หรือ Supabase branch สำรองข้อมูล ตรวจ SQL diff, RLS, ผลกระทบและแผน rollback ก่อนอนุมัติ เสร็จแล้วให้กลับโหมดอ่านทันที `supabase/schema.sql` เป็น initial setup; ถ้าฐานมีข้อมูลแล้วให้สร้าง migration เฉพาะส่วนต่าง

```powershell
codex mcp remove supabase_otepc_q
codex mcp add supabase_otepc_q --url "https://mcp.supabase.com/mcp?project_ref=pvuhrnvyhyxffudqjams&read_only=true&features=database,docs"
codex mcp login supabase_otepc_q
```

## ปัญหาที่พบบ่อย

| อาการ | สาเหตุที่พบบ่อย | ทางแก้ |
|---|---|---|
| PowerShell ตัด URL ตรงเครื่องหมาย `&` | ไม่ได้ใส่เครื่องหมายคำพูดครอบ URL | รันคำสั่ง `codex mcp add` ตามบล็อกในหัวข้อตั้งค่า |
| `/mcp` ไม่เห็น `supabase_otepc_q` | เซสชันเปิดอยู่ก่อนเพิ่มเซิร์ฟเวอร์ | ปิดแล้วเปิดเซสชันใหม่ |
| ล็อกอินแล้วไม่เห็นตาราง | เลือกองค์กรผิด หรือบัญชียังไม่ถูกเชิญ | `codex mcp logout supabase_otepc_q` แล้ว login ใหม่ |
| เอเจนต์บอกว่าแก้ข้อมูลไม่ได้ | ตั้ง `read_only=true` อยู่ | ดูหัวข้อเปิดสิทธิ์เขียนชั่วคราว |
| วาง JSON แล้ว Codex ไม่โหลด | Codex ใช้ TOML ไม่ใช่ JSON | ใช้ `[mcp_servers.supabase_otepc_q]` และคีย์ `url` |
| เว็บต่อฐานไม่ได้ | `.env.local` ไม่มีหรือค่าไม่ถูกต้อง | ตั้ง URL/key แล้ว restart Vite |
| Realtime ไม่อัปเดต | `queues` ไม่อยู่ใน publication | ตรวจ `supabase_realtime` และใช้ migration ที่ผ่านการตรวจ |

หาก OAuth ยังไม่สำเร็จ ให้รัน `codex mcp login supabase_otepc_q` อีกครั้งและอนุญาตผ่านเบราว์เซอร์ ไม่ต้องสร้าง Personal Access Token สำหรับการใช้งานปกติ และอย่าใส่รหัสผ่านหรือ secret key ในแชต
