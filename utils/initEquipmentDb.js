import pool from "../config/db.js";

export async function initEquipmentDb() {
  try {
    // 1. Create equipment_master table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.equipment_master (
          id SERIAL PRIMARY KEY,
          equipment_id TEXT UNIQUE NOT NULL,
          equipment_name TEXT NOT NULL,
          model TEXT,
          serial_no TEXT,
          machine_division TEXT,
          machine_department TEXT,
          machine_area TEXT,
          purchase_date DATE,
          installation_date DATE,
          running_hours NUMERIC DEFAULT 0,
          status TEXT DEFAULT 'Running',
          remarks TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // 2. Add columns to machine_parts table if they don't exist
    await pool.query(`
      ALTER TABLE public.machine_parts 
        ADD COLUMN IF NOT EXISTS equipment_master_id BIGINT REFERENCES public.equipment_master(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS equipment_id TEXT;
    `);

    // 3. Add equipment_id column to repair_tasks table if it doesn't exist
    await pool.query(`
      ALTER TABLE public.repair_tasks 
        ADD COLUMN IF NOT EXISTS equipment_id TEXT;
    `);

    // 4. Seed initial equipment records from distinct machine_parts where equipment_master is empty or missing records
    const { rows: existingCount } = await pool.query(`SELECT COUNT(*) FROM public.equipment_master`);
    
    if (parseInt(existingCount[0]?.count || "0") === 0) {
      await pool.query(`
        INSERT INTO public.equipment_master (equipment_id, equipment_name, machine_area, machine_department, machine_division)
        SELECT 
          'EQ-' || LPAD((ROW_NUMBER() OVER (ORDER BY MIN(created_at)))::text, 3, '0') AS equipment_id,
          TRIM(machine_name) AS equipment_name,
          MAX(machine_area) AS machine_area,
          MAX(machine_department) AS machine_department,
          MAX(machine_division) AS machine_division
        FROM public.machine_parts
        WHERE machine_name IS NOT NULL AND TRIM(machine_name) != ''
        GROUP BY TRIM(machine_name)
        ON CONFLICT (equipment_id) DO NOTHING;
      `);

      // Update machine_parts.equipment_master_id link
      await pool.query(`
        UPDATE public.machine_parts mp
        SET 
          equipment_master_id = em.id,
          equipment_id = em.equipment_id
        FROM public.equipment_master em
        WHERE LOWER(TRIM(mp.machine_name)) = LOWER(TRIM(em.equipment_name))
        AND mp.equipment_master_id IS NULL;
      `);
      console.log("✅ Equipment Master initialized and seeded from machine_parts");
    } else {
      console.log("✅ Equipment Master table verified");
    }
  } catch (error) {
    console.error("❌ Error initializing Equipment Master DB:", error.message);
  }
}
