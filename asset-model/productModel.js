import db from '../config/asset-db.js';
import checklistPool from '../config/db.js';

// Self-healing schema migration for initial_entry_date, machine_id, running_hours
const ensureSchema = async () => {
    try {
        await db.query(`
            ALTER TABLE products 
                ADD COLUMN IF NOT EXISTS machine_id INTEGER,
                ADD COLUMN IF NOT EXISTS initial_entry_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                ADD COLUMN IF NOT EXISTS initial_running_hours NUMERIC DEFAULT 0,
                ADD COLUMN IF NOT EXISTS running_hours NUMERIC DEFAULT 0,
                ADD COLUMN IF NOT EXISTS operational_status VARCHAR(50) DEFAULT 'Running',
                ADD COLUMN IF NOT EXISTS installation_date DATE;

            ALTER TABLE asset_location
                ADD COLUMN IF NOT EXISTS division VARCHAR(255),
                ADD COLUMN IF NOT EXISTS machine_area VARCHAR(255);

            ALTER TABLE maintenance_config
                ADD COLUMN IF NOT EXISTS running_hours NUMERIC DEFAULT 0,
                ADD COLUMN IF NOT EXISTS operational_status VARCHAR(50) DEFAULT 'Running',
                ADD COLUMN IF NOT EXISTS installation_date DATE;
        `);
    } catch (err) {
        console.error("Schema init error for products:", err.message);
    }
};
ensureSchema();

class ProductModel {
    /**
     * Map a raw DB product row heavily joined across all tables into the flat Context structure
     */
    static _mapToContextFormat(row) {
        if (!row) return null;
        return {
            id: row.id,
            sn: row.sn,
            productName: row.product_name,
            category: row.category,
            type: row.type,
            brand: row.brand,
            model: row.model,
            serialNo: row.serial_no,
            sku: row.sku,
            mfgDate: row.mfg_date,
            installationDate: row.installation_date,
            initialRunningHours: Number(row.initial_running_hours || row.running_hours || 0),
            runningHours: Number(row.running_hours || 0),
            operationalStatus: row.operational_status || 'Running',
            machineId: row.machine_id || null,
            initialEntryDate: row.initial_entry_date || row.created_date || row.asset_date || null,
            isFromMachineParts: Boolean(row.machine_id),
            origin: row.origin,
            status: row.status || 'Active',
            assetDate: row.asset_date,
            invoiceNo: row.invoice_no,
            cost: row.cost,
            quantity: String(row.quantity || 1),
            supplierName: row.supplier_name,
            supplierPhone: row.supplier_phone,
            supplierEmail: row.supplier_email,
            paymentMode: row.payment_mode,
            location: row.location,
            department: row.department,
            division: row.division,
            machineArea: row.machine_area,
            assignedTo: row.assigned_to,
            usageType: row.usage_type,
            storageLoc: row.storage_loc,
            responsiblePerson: row.responsible_person,
            warrantyAvailable: row.warranty_available,
            warrantyProvider: row.warranty_provider,
            warrantyStart: row.warranty_start,
            warrantyEnd: row.warranty_end,
            amc: row.amc,
            amcProvider: row.amc_provider,
            amcStart: row.amc_start,
            amcEnd: row.amc_end,
            serviceContact: row.service_contact,
            maintenanceRequired: row.maintenance_required,
            maintenanceType: row.maintenance_type,
            frequency: row.frequency,
            nextService: row.next_service,
            priority: row.priority,
            technician: row.technician,
            maintenanceNotes: row.maintenance_notes,
            assetValue: row.asset_value,
            depMethod: row.dep_method,
            depRate: row.dep_rate,
            assetLife: String(row.asset_life || ''),
            residualValue: row.residual_value,
            internalNotes: row.internal_notes,
            usageRemarks: row.usage_remarks,
            condition: row.condition,
            createdBy: row.created_by,
            createdDate: row.created_date,
            updatedBy: row.updated_by,
            updatedDate: row.updated_date,
            // Arrays
            specs: row.specs || [],
            // Simple repair summary mapped for the list
            lastRepairDate: row.last_repair_date || null,
            repairCost: row.recent_repair_cost || "0",
            totalRepairCost: row.total_repair_cost || "0",
            repairCount: String(row.repair_count || 0),
            partChanged: row.recent_part_changed || "No",
            partNames: row.recent_part_names || []
        };
    }

    static async getAllProducts() {
        const query = `
            SELECT 
                p.*,
                ai.asset_date, ai.invoice_no, ai.cost, ai.quantity, ai.payment_mode,
                s.name as supplier_name, s.number as supplier_phone, s.email_id as supplier_email,
                al.location, al.department, al.division, al.machine_area, al.assigned_to, al.usage_type, al.storage_loc, al.responsible_person,
                w.warranty_available, w.warranty_provider, w.warranty_start, w.warranty_end, w.amc, w.amc_provider, w.amc_start, w.amc_end, w.service_contact,
                mc.maintenance_required, mc.maintenance_type, mc.frequency, mc.next_service, mc.priority, mc.technician, mc.maintenance_notes,
                d.asset_value, d.dep_method, d.dep_rate, d.asset_life, d.residual_value,
                pn.internal_notes, pn.usage_remarks, pn.condition,
                (SELECT json_agg(json_build_object('name', spec_name, 'value', spec_value)) FROM product_specs ps WHERE ps.product_id = p.id) as specs,
                
                (SELECT COUNT(id) FROM repairs r WHERE r.product_id = p.id) as repair_count,
                (SELECT SUM(total_repair_cost) FROM repairs r WHERE r.product_id = p.id) as total_repair_cost,
                (SELECT repair_date FROM repairs r WHERE r.product_id = p.id ORDER BY repair_date DESC LIMIT 1) as last_repair_date,
                (SELECT repair_cost FROM repairs r WHERE r.product_id = p.id ORDER BY repair_date DESC LIMIT 1) as recent_repair_cost,
                (SELECT part_changed FROM repairs r WHERE r.product_id = p.id ORDER BY repair_date DESC LIMIT 1) as recent_part_changed,
                (
                   SELECT json_agg(rp.part_name) 
                   FROM repair_parts rp 
                   JOIN repairs r ON rp.repair_id = r.id 
                   WHERE r.product_id = p.id AND r.id = (SELECT id FROM repairs WHERE product_id = p.id ORDER BY repair_date DESC LIMIT 1)
                ) as recent_part_names

            FROM products p
            LEFT JOIN asset_information ai ON p.id = ai.product_id
            LEFT JOIN suppliers s ON ai.supplier_id = s.id
            LEFT JOIN asset_location al ON p.id = al.product_id
            LEFT JOIN warranty_details w ON p.id = w.product_id
            LEFT JOIN maintenance_config mc ON p.id = mc.product_id
            LEFT JOIN depreciation_details d ON p.id = d.product_id
            LEFT JOIN product_notes pn ON p.id = pn.product_id
            ORDER BY p.id DESC;
        `;
        const { rows } = await db.query(query);
        return rows.map(this._mapToContextFormat);
    }

    static async getProductById(id) {
        const query = `
            SELECT 
                p.*,
                ai.asset_date, ai.invoice_no, ai.cost, ai.quantity, ai.payment_mode,
                s.name as supplier_name, s.number as supplier_phone, s.email_id as supplier_email,
                al.location, al.department, al.division, al.machine_area, al.assigned_to, al.usage_type, al.storage_loc, al.responsible_person,
                w.warranty_available, w.warranty_provider, w.warranty_start, w.warranty_end, w.amc, w.amc_provider, w.amc_start, w.amc_end, w.service_contact,
                mc.maintenance_required, mc.maintenance_type, mc.frequency, mc.next_service, mc.priority, mc.technician, mc.maintenance_notes,
                d.asset_value, d.dep_method, d.dep_rate, d.asset_life, d.residual_value,
                pn.internal_notes, pn.usage_remarks, pn.condition,
                (SELECT json_agg(json_build_object('name', spec_name, 'value', spec_value)) FROM product_specs ps WHERE ps.product_id = p.id) as specs,
                
                (SELECT COUNT(id) FROM repairs r WHERE r.product_id = p.id) as repair_count,
                (SELECT SUM(total_repair_cost) FROM repairs r WHERE r.product_id = p.id) as total_repair_cost,
                (SELECT repair_date FROM repairs r WHERE r.product_id = p.id ORDER BY repair_date DESC LIMIT 1) as last_repair_date,
                (SELECT repair_cost FROM repairs r WHERE r.product_id = p.id ORDER BY repair_date DESC LIMIT 1) as recent_repair_cost,
                (SELECT part_changed FROM repairs r WHERE r.product_id = p.id ORDER BY repair_date DESC LIMIT 1) as recent_part_changed,
                (
                   SELECT json_agg(rp.part_name) 
                   FROM repair_parts rp 
                   JOIN repairs r ON rp.repair_id = r.id 
                   WHERE r.product_id = p.id AND r.id = (SELECT id FROM repairs WHERE product_id = p.id ORDER BY repair_date DESC LIMIT 1)
                ) as recent_part_names

            FROM products p
            LEFT JOIN asset_information ai ON p.id = ai.product_id
            LEFT JOIN suppliers s ON ai.supplier_id = s.id
            LEFT JOIN asset_location al ON p.id = al.product_id
            LEFT JOIN warranty_details w ON p.id = w.product_id
            LEFT JOIN maintenance_config mc ON p.id = mc.product_id
            LEFT JOIN depreciation_details d ON p.id = d.product_id
            LEFT JOIN product_notes pn ON p.id = pn.product_id
            WHERE p.id = $1;
        `;
        const { rows } = await db.query(query, [id]);
        return rows.length ? this._mapToContextFormat(rows[0]) : null;
    }

    static async createProduct(data) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            let sn = data.sn;
            if (!sn) {
                const countRes = await client.query('SELECT COUNT(*) FROM products');
                const nextNum = parseInt(countRes.rows[0]?.count || 0) + 1;
                sn = `AST-${String(nextNum).padStart(3, '0')}`;
            }

            // Check & sync with machine_parts table
            let linkedMachineId = data.machineId || null;
            let initialEntry = data.initialEntryDate ? new Date(data.initialEntryDate) : (data.createdDate ? new Date(data.createdDate) : new Date());

            try {
                if (data.productName) {
                    const existingMachine = await checklistPool.query(
                        'SELECT id, created_at, machine_department, machine_division, machine_area FROM machine_parts WHERE LOWER(TRIM(machine_name)) = LOWER(TRIM($1)) LIMIT 1',
                        [data.productName]
                    );

                    if (existingMachine.rows.length > 0) {
                        const m = existingMachine.rows[0];
                        if (!linkedMachineId) linkedMachineId = m.id;
                        if (!data.initialEntryDate && m.created_at) initialEntry = new Date(m.created_at);
                        if (!data.department && m.machine_department) data.department = m.machine_department.trim();
                        if (!data.division && m.machine_division) data.division = m.machine_division.trim();
                        if (!data.machineArea && m.machine_area) data.machineArea = m.machine_area.trim();
                    } else {
                        // New machine: auto-create in machine_parts table
                        const partsArray = (data.specs && Array.isArray(data.specs))
                            ? data.specs.map(s => s.value || s.name).filter(Boolean)
                            : [];

                        const newMp = await checklistPool.query(
                            'INSERT INTO machine_parts (machine_name, machine_department, machine_division, machine_area, part_name) VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at',
                            [
                                data.productName.trim(),
                                data.department || null,
                                data.division || null,
                                data.machineArea || data.location || null,
                                partsArray.length > 0 ? partsArray : null
                            ]
                        );
                        if (newMp.rows.length > 0) {
                            linkedMachineId = newMp.rows[0].id;
                            initialEntry = newMp.rows[0].created_at;
                        }
                    }
                }
            } catch (syncErr) {
                console.error("Warning: Sync with machine_parts failed:", syncErr.message);
            }

            // 1. Insert base Product
            const prodRes = await client.query(`
                INSERT INTO products (
                    sn, product_name, category, type, brand, model, serial_no, sku, 
                    mfg_date, origin, status, created_by, updated_by, machine_id, initial_entry_date, initial_running_hours, running_hours, operational_status, installation_date
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
                RETURNING id;
            `, [
                sn, data.productName, data.category || 'Machinery', data.type || 'Asset', data.brand || '', data.model || '', data.serialNo || '',
                data.sku || sn, data.mfgDate ? new Date(data.mfgDate) : null, data.origin || '', data.status || 'Active', data.createdBy || 'admin', data.updatedBy || 'admin',
                linkedMachineId, initialEntry,
                data.initialRunningHours || data.runningHours || 0, data.runningHours || 0, data.operationalStatus || 'Running', data.installationDate ? new Date(data.installationDate) : null
            ]);
            
            const productId = prodRes.rows[0].id;

            // 2. Insert or get Supplier
            let supplierId = null;
            if (data.supplierName) {
                const supCheck = await client.query('SELECT id FROM suppliers WHERE name = $1 LIMIT 1', [data.supplierName]);
                if (supCheck.rows.length > 0) {
                    supplierId = supCheck.rows[0].id;
                } else {
                    const supRes = await client.query(
                        'INSERT INTO suppliers (name, number, email_id) VALUES ($1, $2, $3) RETURNING id',
                        [data.supplierName, data.supplierPhone || '', data.supplierEmail || '']
                    );
                    supplierId = supRes.rows[0].id;
                }
            }

            // 3. Asset Information
            await client.query(`
                INSERT INTO asset_information (product_id, asset_date, invoice_no, cost, quantity, supplier_id, payment_mode)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [productId, data.assetDate ? new Date(data.assetDate) : null, data.invoiceNo || '', data.cost || 0, data.quantity || 1, supplierId, data.paymentMode || '']);

            // 4. Asset Location
            await client.query(`
                INSERT INTO asset_location (product_id, location, department, division, machine_area, assigned_to, usage_type, storage_loc, responsible_person)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `, [productId, data.location || '', data.department || '', data.division || '', data.machineArea || '', data.assignedTo || '', data.usageType || 'Internal', data.storageLoc || '', data.responsiblePerson || '']);

            // 5. Warranty Details
            await client.query(`
                INSERT INTO warranty_details (product_id, warranty_available, warranty_provider, warranty_start, warranty_end, amc, amc_provider, amc_start, amc_end, service_contact)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            `, [productId, data.warrantyAvailable || 'No', data.warrantyProvider || '', data.warrantyStart ? new Date(data.warrantyStart) : null, data.warrantyEnd ? new Date(data.warrantyEnd) : null, data.amc || 'No', data.amcProvider || '', data.amcStart ? new Date(data.amcStart) : null, data.amcEnd ? new Date(data.amcEnd) : null, data.serviceContact || '']);

            // 6. Maintenance config
            await client.query(`
                INSERT INTO maintenance_config (product_id, maintenance_required, maintenance_type, frequency, next_service, priority, technician, maintenance_notes, running_hours, operational_status, installation_date)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            `, [productId, data.maintenanceRequired || 'No', data.maintenanceType || 'Preventive', data.frequency || 'Monthly', data.nextService ? new Date(data.nextService) : null, data.priority || 'Medium', data.technician || '', data.maintenanceNotes || '', data.runningHours || 0, data.operationalStatus || 'Running', data.installationDate ? new Date(data.installationDate) : null]);

            // 7. Depreciation Details
            await client.query(`
                INSERT INTO depreciation_details (product_id, asset_value, dep_method, dep_rate, asset_life, residual_value)
                VALUES ($1, $2, $3, $4, $5, $6)
            `, [productId, data.assetValue || 0, data.depMethod || 'Straight Line', data.depRate || 0, data.assetLife || 0, data.residualValue || 0]);

            // 8. Product Notes
            await client.query(`
                INSERT INTO product_notes (product_id, internal_notes, usage_remarks, condition)
                VALUES ($1, $2, $3, $4)
            `, [productId, data.internalNotes || '', data.usageRemarks || '', data.condition || '']);

            // 9. Specs array (if any)
            if (data.specs && Array.isArray(data.specs)) {
                for (let spec of data.specs) {
                    const specName = typeof spec === 'string' ? spec : (spec.name || spec.value || '');
                    const specValue = typeof spec === 'string' ? '' : (spec.value || '');
                    if (specName && String(specName).trim()) {
                        await client.query(
                            'INSERT INTO product_specs (product_id, spec_name, spec_value) VALUES ($1, $2, $3)',
                            [productId, String(specName).trim(), specValue ? String(specValue).trim() : '']
                        );
                    }
                }
            }

            await client.query('COMMIT');
            return await this.getProductById(productId);

        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    static async updateProduct(id, data) {
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Update Base Product
            await client.query(`
                UPDATE products SET
                    product_name = COALESCE($1, product_name),
                    category = COALESCE($2, category),
                    type = COALESCE($3, type),
                    brand = COALESCE($4, brand),
                    model = COALESCE($5, model),
                    serial_no = COALESCE($6, serial_no),
                    sku = COALESCE($7, sku),
                    mfg_date = $8,
                    origin = COALESCE($9, origin),
                    status = COALESCE($10, status),
                    machine_id = COALESCE($11, machine_id),
                    initial_entry_date = COALESCE($12, initial_entry_date),
                    running_hours = COALESCE($13, running_hours),
                    operational_status = COALESCE($14, operational_status),
                    installation_date = COALESCE($15, installation_date),
                    updated_by = $16,
                    updated_date = CURRENT_TIMESTAMP
                WHERE id = $17
            `, [
                data.productName, data.category, data.type, data.brand, data.model, data.serialNo, data.sku,
                data.mfgDate ? new Date(data.mfgDate) : null, data.origin, data.status,
                data.machineId !== undefined ? data.machineId : null,
                data.initialEntryDate ? new Date(data.initialEntryDate) : null,
                data.runningHours !== undefined ? data.runningHours : null,
                data.operationalStatus,
                data.installationDate ? new Date(data.installationDate) : null,
                data.updatedBy || 'admin', id
            ]);

            // 2. Update Asset Info
            await client.query(`
                UPDATE asset_information SET
                    asset_date = $1,
                    invoice_no = COALESCE($2, invoice_no),
                    cost = COALESCE($3, cost),
                    quantity = COALESCE($4, quantity),
                    payment_mode = COALESCE($5, payment_mode)
                WHERE product_id = $6
            `, [data.assetDate ? new Date(data.assetDate) : null, data.invoiceNo, data.assetValue || data.cost || 0, data.quantity || 1, data.paymentMode, id]);

            // 3. Update Location
            await client.query(`
                UPDATE asset_location SET
                    location = COALESCE($1, location),
                    department = COALESCE($2, department),
                    division = COALESCE($3, division),
                    machine_area = COALESCE($4, machine_area),
                    assigned_to = COALESCE($5, assigned_to),
                    usage_type = COALESCE($6, usage_type),
                    storage_loc = COALESCE($7, storage_loc),
                    responsible_person = COALESCE($8, responsible_person)
                WHERE product_id = $9
            `, [data.location, data.department, data.division, data.machineArea, data.assignedTo, data.usageType, data.storageLoc, data.responsiblePerson, id]);

            // 4. Update Warranty Details
            await client.query(`
                UPDATE warranty_details SET
                    warranty_available = COALESCE($1, warranty_available),
                    warranty_provider = COALESCE($2, warranty_provider),
                    warranty_start = $3,
                    warranty_end = $4,
                    amc = COALESCE($5, amc),
                    amc_provider = COALESCE($6, amc_provider),
                    amc_start = $7,
                    amc_end = $8,
                    service_contact = COALESCE($9, service_contact)
                WHERE product_id = $10
            `, [
                data.warrantyAvailable, data.warrantyProvider, data.warrantyStart ? new Date(data.warrantyStart) : null,
                data.warrantyEnd ? new Date(data.warrantyEnd) : null, data.amc, data.amcProvider,
                data.amcStart ? new Date(data.amcStart) : null, data.amcEnd ? new Date(data.amcEnd) : null,
                data.serviceContact, id
            ]);

            // 5. Update Maintenance Config
            await client.query(`
                UPDATE maintenance_config SET
                    maintenance_required = COALESCE($1, maintenance_required),
                    maintenance_type = COALESCE($2, maintenance_type),
                    frequency = COALESCE($3, frequency),
                    next_service = $4,
                    priority = COALESCE($5, priority),
                    technician = COALESCE($6, technician),
                    maintenance_notes = COALESCE($7, maintenance_notes),
                    running_hours = COALESCE($8, running_hours),
                    operational_status = COALESCE($9, operational_status),
                    installation_date = COALESCE($10, installation_date)
                WHERE product_id = $11
            `, [
                data.maintenanceRequired, data.maintenanceType, data.frequency,
                data.nextService ? new Date(data.nextService) : null, data.priority,
                data.technician, data.maintenanceNotes, data.runningHours || 0,
                data.operationalStatus || 'Running', data.installationDate ? new Date(data.installationDate) : null, id
            ]);

            // 6. Update Financial / Depreciation Details
            await client.query(`
                UPDATE depreciation_details SET
                    asset_value = COALESCE($1, asset_value),
                    dep_method = COALESCE($2, dep_method),
                    dep_rate = COALESCE($3, dep_rate),
                    asset_life = COALESCE($4, asset_life),
                    residual_value = COALESCE($5, residual_value)
                WHERE product_id = $6
            `, [data.assetValue || 0, data.depMethod, data.depRate || 0, data.assetLife || 0, data.residualValue || 0, id]);

            // 7. Update Notes & Remarks
            await client.query(`
                UPDATE product_notes SET
                    internal_notes = COALESCE($1, internal_notes),
                    usage_remarks = COALESCE($2, usage_remarks),
                    condition = COALESCE($3, condition)
                WHERE product_id = $4
            `, [data.internalNotes, data.usageRemarks, data.condition, id]);

            // 8. Specs Update (if passed)
            if (data.specs && Array.isArray(data.specs)) {
                await client.query('DELETE FROM product_specs WHERE product_id = $1', [id]);
                for (let spec of data.specs) {
                    const specName = typeof spec === 'string' ? spec : (spec.name || spec.value || '');
                    const specValue = typeof spec === 'string' ? '' : (spec.value || '');
                    if (specName && String(specName).trim()) {
                        await client.query(
                            'INSERT INTO product_specs (product_id, spec_name, spec_value) VALUES ($1, $2, $3)',
                            [id, String(specName).trim(), specValue ? String(specValue).trim() : '']
                        );
                    }
                }
            }

            // Sync updates with machine_parts table
            if (data.productName) {
                try {
                    await checklistPool.query(`
                        UPDATE machine_parts SET
                            machine_department = COALESCE($2, machine_department),
                            machine_division = COALESCE($3, machine_division),
                            machine_area = COALESCE($4, machine_area)
                        WHERE LOWER(TRIM(machine_name)) = LOWER(TRIM($1))
                    `, [
                        data.productName.trim(),
                        data.department || null,
                        data.division || null,
                        data.machineArea || data.location || null
                    ]);
                } catch (syncErr) {
                    console.error("Warning: Sync update to machine_parts failed:", syncErr.message);
                }
            }

            await client.query('COMMIT');
            return await this.getProductById(id);

        } catch(e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    static async deleteProduct(id) {
        const query = 'DELETE FROM products WHERE id = $1 RETURNING id';
        const { rows } = await db.query(query, [id]);
        return rows[0];
    }
}

export default ProductModel;
